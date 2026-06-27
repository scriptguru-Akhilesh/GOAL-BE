const { ObjectId } = require('mongodb');
const { getDb } = require('../db/mongo');

async function getDefaultUserId() {
  const db = getDb();
  let user = await db.collection('users').findOne({}, { sort: { createdAt: 1 } });
  if (!user) {
    const result = await db.collection('users').insertOne({
      role: 'goal_creator',
      name: 'Goal Creator',
      mentorshipHoursRemaining: 0,
      createdAt: new Date(),
    });
    return result.insertedId;
  }
  return user._id;
}

async function getActiveGoal() {
  const db = getDb();
  const userId = await getDefaultUserId();
  return db.collection('goals').findOne({ userId }, { sort: { createdAt: -1 } });
}

function parseTimelineMonths(timeline) {
  const match = String(timeline).match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 6;
}

function extractTasksFromRoadmap(roadmap) {
  const tasks = [];
  const months = roadmap?.months || [];

  months.forEach((month, monthIndex) => {
    const weeks = month.weeks || [];
    weeks.forEach((week, weekIndex) => {
      const weekTasks = week.tasks || [];
      weekTasks.forEach((title) => {
        tasks.push({
          title: typeof title === 'string' ? title : String(title),
          monthIndex: monthIndex + 1,
          weekIndex: weekIndex + 1,
        });
      });
    });
  });

  return tasks;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function mapTask(t) {
  return {
    id: t._id.toString(),
    title: t.title,
    status: t.status,
    dueDate: t.dueDate,
    monthIndex: t.monthIndex,
    weekIndex: t.weekIndex,
  };
}

function daysBetween(from, to) {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

async function saveGoal({ goal, roadmap }) {
  const db = getDb();
  const userId = await getDefaultUserId();
  const months = roadmap?.months?.length || parseTimelineMonths(6);
  const targetDate = addDays(new Date(), months * 30);

  const goalResult = await db.collection('goals').insertOne({
    userId,
    goal,
    roadmap,
    progress: 0,
    confidence: 80,
    delayDays: 0,
    streak: 0,
    targetDate: formatDate(targetDate),
    createdAt: new Date(),
  });

  const goalId = goalResult.insertedId;
  const taskRows = extractTasksFromRoadmap(roadmap);
  const daysPerTask = Math.max(1, Math.floor((months * 30) / Math.max(taskRows.length, 1)));

  if (taskRows.length > 0) {
    const tasks = taskRows.map((row, i) => ({
      goalId,
      title: row.title,
      monthIndex: row.monthIndex,
      weekIndex: row.weekIndex,
      status: 'pending',
      dueDate: formatDate(addDays(new Date(), (i + 1) * daysPerTask)),
      createdAt: new Date(),
    }));
    await db.collection('tasks').insertMany(tasks);
  }

  return goalId;
}

async function getDashboard() {
  const goal = await getActiveGoal();
  if (!goal) {
    return {
      goal: '',
      progress: 0,
      confidence: 0,
      delayDays: 0,
      tasksCompleted: 0,
      tasksMissed: 0,
      streak: 0,
    };
  }

  const db = getDb();
  const [completed, missed, total] = await Promise.all([
    db.collection('tasks').countDocuments({ goalId: goal._id, status: 'completed' }),
    db.collection('tasks').countDocuments({ goalId: goal._id, status: 'missed' }),
    db.collection('tasks').countDocuments({ goalId: goal._id }),
  ]);

  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    goal: goal.goal,
    progress,
    confidence: goal.confidence,
    delayDays: goal.delayDays,
    tasksCompleted: completed,
    tasksMissed: missed,
    streak: goal.streak,
  };
}

async function recalculate({ completedTasks = [], missedTasks = [] }) {
  const goal = await getActiveGoal();
  if (!goal) {
    return {
      delayDays: 0,
      newETA: formatDate(new Date()),
      confidence: 0,
      message: 'No active goal found',
    };
  }

  const db = getDb();
  const toObjectIds = (ids) =>
    ids.map((id) => {
      try {
        return new ObjectId(id);
      } catch {
        return null;
      }
    }).filter(Boolean);

  const completedIds = toObjectIds(completedTasks);
  const missedIds = toObjectIds(missedTasks);

  if (completedIds.length > 0) {
    await db.collection('tasks').updateMany(
      { _id: { $in: completedIds }, goalId: goal._id },
      { $set: { status: 'completed' } }
    );
  }

  if (missedIds.length > 0) {
    await db.collection('tasks').updateMany(
      { _id: { $in: missedIds }, goalId: goal._id },
      { $set: { status: 'missed' } }
    );
  }

  const delayDays = missedTasks.length * 2;
  const newDelayDays = goal.delayDays + delayDays;
  const confidence = Math.max(
    0,
    Math.min(100, goal.confidence - missedTasks.length * 4 + completedTasks.length * 2)
  );

  let streak = goal.streak;
  if (completedTasks.length > 0 && missedTasks.length === 0) {
    streak += 1;
  } else if (missedTasks.length > 0) {
    streak = 0;
  }

  const baseDate = goal.targetDate ? new Date(goal.targetDate) : new Date();
  const newETA = formatDate(addDays(baseDate, delayDays));

  const completed = await db.collection('tasks').countDocuments({
    goalId: goal._id,
    status: 'completed',
  });
  const total = await db.collection('tasks').countDocuments({ goalId: goal._id });
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  await db.collection('goals').updateOne(
    { _id: goal._id },
    {
      $set: {
        delayDays: newDelayDays,
        confidence,
        streak,
        targetDate: newETA,
        progress,
      },
    }
  );

  const message =
    missedTasks.length > 0
      ? `Skipping today's task delayed goal by ${delayDays} day${delayDays === 1 ? '' : 's'}`
      : `Great work! Completed ${completedTasks.length} task${completedTasks.length === 1 ? '' : 's'}`;

  return {
    delayDays: newDelayDays,
    newETA,
    confidence,
    message,
  };
}

async function applyVerificationResult({ taskId, answer, status, confidence, source = 'checkin' }) {
  const db = getDb();
  const objectId = taskId instanceof ObjectId ? taskId : new ObjectId(taskId);

  await db.collection('checkins').insertOne({
    taskId: objectId,
    answer,
    status,
    confidence,
    source,
    createdAt: new Date(),
  });

  const taskStatus =
    status === 'verified' ? 'completed' : status === 'partial' ? 'pending' : 'missed';
  await db.collection('tasks').updateOne({ _id: objectId }, { $set: { status: taskStatus } });

  const task = await db.collection('tasks').findOne({ _id: objectId });
  if (task) {
    const goal = await db.collection('goals').findOne({ _id: task.goalId });
    if (goal) {
      const completed = await db.collection('tasks').countDocuments({
        goalId: goal._id,
        status: 'completed',
      });
      const total = await db.collection('tasks').countDocuments({ goalId: goal._id });
      const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
      const goalConfidence = Math.round((goal.confidence + confidence) / 2);

      await db.collection('goals').updateOne(
        { _id: goal._id },
        { $set: { progress, confidence: goalConfidence } }
      );
    }
  }

  return { status, confidence };
}

async function getTasks() {
  const goal = await getActiveGoal();
  if (!goal) {
    return { tasks: [] };
  }

  const db = getDb();
  const tasks = await db
    .collection('tasks')
    .find({ goalId: goal._id })
    .sort({ dueDate: 1, createdAt: 1 })
    .toArray();

  return {
    tasks: tasks.map(mapTask),
  };
}

async function getGoalDetails() {
  const goal = await getActiveGoal();
  if (!goal) {
    return {
      goal: '',
      roadmap: { months: [] },
      targetDate: '',
      progress: 0,
      confidence: 0,
      delayDays: 0,
      streak: 0,
      createdAt: null,
    };
  }

  return {
    goal: goal.goal,
    roadmap: goal.roadmap || { months: [] },
    targetDate: goal.targetDate || '',
    progress: goal.progress || 0,
    confidence: goal.confidence,
    delayDays: goal.delayDays,
    streak: goal.streak,
    createdAt: goal.createdAt ? goal.createdAt.toISOString() : null,
  };
}

async function getTodayTasks() {
  const goal = await getActiveGoal();
  const today = formatDate(new Date());

  if (!goal) {
    return { date: today, tasks: [], overdueCount: 0, dueTodayCount: 0 };
  }

  const db = getDb();
  const allTasks = await db
    .collection('tasks')
    .find({ goalId: goal._id, status: 'pending' })
    .sort({ dueDate: 1 })
    .toArray();

  const overdue = allTasks.filter((t) => t.dueDate && t.dueDate < today);
  const dueToday = allTasks.filter((t) => t.dueDate === today);
  const tasks = [...overdue, ...dueToday.filter((t) => !overdue.find((o) => o._id.equals(t._id)))];

  return {
    date: today,
    tasks: tasks.map(mapTask),
    overdueCount: overdue.length,
    dueTodayCount: dueToday.length,
  };
}

async function getCheckins(limit = 10) {
  const goal = await getActiveGoal();
  if (!goal) {
    return { checkins: [] };
  }

  const db = getDb();
  const tasks = await db.collection('tasks').find({ goalId: goal._id }).toArray();
  const taskMap = new Map(tasks.map((t) => [t._id.toString(), t.title]));
  const taskIds = tasks.map((t) => t._id);

  const checkins = await db
    .collection('checkins')
    .find({ taskId: { $in: taskIds } })
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 10, 50))
    .toArray();

  return {
    checkins: checkins.map((c) => ({
      id: c._id.toString(),
      taskId: c.taskId.toString(),
      taskTitle: taskMap.get(c.taskId.toString()) || '',
      status: c.status,
      confidence: c.confidence,
      source: c.source || 'checkin',
      createdAt: c.createdAt ? c.createdAt.toISOString() : null,
    })),
  };
}

async function getSummary() {
  const goal = await getActiveGoal();
  const today = formatDate(new Date());

  if (!goal) {
    return {
      goal: '',
      targetDate: '',
      daysRemaining: 0,
      onTrack: false,
      progress: 0,
      confidence: 0,
      delayDays: 0,
      streak: 0,
      tasksTotal: 0,
      tasksPending: 0,
      tasksToday: 0,
      tasksOverdue: 0,
    };
  }

  const db = getDb();
  const [total, pending, completed, missed] = await Promise.all([
    db.collection('tasks').countDocuments({ goalId: goal._id }),
    db.collection('tasks').countDocuments({ goalId: goal._id, status: 'pending' }),
    db.collection('tasks').countDocuments({ goalId: goal._id, status: 'completed' }),
    db.collection('tasks').countDocuments({ goalId: goal._id, status: 'missed' }),
  ]);

  const pendingTasks = await db
    .collection('tasks')
    .find({ goalId: goal._id, status: 'pending' })
    .toArray();

  const tasksOverdue = pendingTasks.filter((t) => t.dueDate && t.dueDate < today).length;
  const tasksToday = pendingTasks.filter((t) => t.dueDate === today).length;
  const targetDate = goal.targetDate || today;
  const daysRemaining = daysBetween(today, targetDate);
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
  const onTrack = goal.confidence >= 70 && goal.delayDays <= 5 && missed <= completed;

  return {
    goal: goal.goal,
    targetDate,
    daysRemaining,
    onTrack,
    progress,
    confidence: goal.confidence,
    delayDays: goal.delayDays,
    streak: goal.streak,
    tasksTotal: total,
    tasksPending: pending,
    tasksToday,
    tasksOverdue,
  };
}

async function skipTask({ taskId }) {
  const db = getDb();
  let objectId;
  try {
    objectId = new ObjectId(taskId);
  } catch {
    const err = new Error('Invalid taskId');
    err.status = 400;
    throw err;
  }

  const task = await db.collection('tasks').findOne({ _id: objectId });
  if (!task) {
    const err = new Error('Task not found');
    err.status = 404;
    throw err;
  }

  if (task.status === 'completed') {
    const err = new Error('Cannot skip a completed task');
    err.status = 400;
    throw err;
  }

  if (task.status === 'missed') {
    const goal = await getActiveGoal();
    return {
      success: true,
      delayDays: goal?.delayDays || 0,
      newETA: goal?.targetDate || formatDate(new Date()),
      confidence: goal?.confidence || 0,
      message: 'Task was already skipped',
    };
  }

  const result = await recalculate({ completedTasks: [], missedTasks: [taskId] });
  return {
    success: true,
    ...result,
    message: `Task skipped. ${result.message}`,
  };
}

async function getCoachStats() {
  const dashboard = await getDashboard();
  const today = await getTodayTasks();
  const summary = await getSummary();
  return { ...dashboard, ...summary, todayTasks: today.tasks.map((t) => t.title) };
}

async function submitCheckin({ taskId, answer, evaluateCheckin }) {
  const db = getDb();
  let objectId;
  try {
    objectId = new ObjectId(taskId);
  } catch {
    const err = new Error('Invalid taskId');
    err.status = 400;
    throw err;
  }

  const task = await db.collection('tasks').findOne({ _id: objectId });
  if (!task) {
    const err = new Error('Task not found');
    err.status = 404;
    throw err;
  }

  const { status, confidence } = await evaluateCheckin({
    taskTitle: task.title,
    answer,
  });

  return applyVerificationResult({ taskId: objectId, answer, status, confidence, source: 'checkin' });
}

module.exports = {
  saveGoal,
  getDashboard,
  recalculate,
  submitCheckin,
  getTasks,
  getGoalDetails,
  getTodayTasks,
  getCheckins,
  getSummary,
  skipTask,
  getCoachStats,
  applyVerificationResult,
  getActiveGoal,
};
