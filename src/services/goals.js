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

function normalizePriority(priority) {
  const value = String(priority || '').toLowerCase();
  if (['low', 'medium', 'high'].includes(value)) {
    return value;
  }
  return 'medium';
}

function extractTasksFromRoadmap(roadmap) {
  const tasks = [];
  const days = Array.isArray(roadmap?.days) ? roadmap.days : [];

  if (days.length > 0) {
    days.forEach((day, index) => {
      tasks.push({
        dayIndex: Number(day?.day) || index + 1,
        title:
          typeof day?.title === 'string' && day.title.trim()
            ? day.title.trim()
            : `Day ${index + 1}`,
        description:
          typeof day?.description === 'string' && day.description.trim()
            ? day.description.trim()
            : '',
        durationMinutes: Math.max(15, Number(day?.durationMinutes) || 60),
        priority: normalizePriority(day?.priority),
        dependsOn: Array.isArray(day?.dependsOn) ? day.dependsOn : [],
      });
    });
    return tasks;
  }

  const months = roadmap?.months || [];
  months.forEach((month, monthIndex) => {
    const weeks = month.weeks || [];
    weeks.forEach((week, weekIndex) => {
      const weekTasks = week.tasks || [];
      weekTasks.forEach((title, taskIndex) => {
        tasks.push({
          dayIndex: tasks.length + 1,
          title: typeof title === 'string' ? title : String(title),
          description: `Task ${taskIndex + 1} for ${month.title || `month ${monthIndex + 1}`}`,
          durationMinutes: 60,
          priority: 'medium',
          dependsOn: [],
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
    description: t.description || '',
    durationMinutes: t.durationMinutes || 60,
    priority: t.priority || 'medium',
    status: t.status,
    dueDate: t.dueDate,
    dayIndex: t.dayIndex,
    monthIndex: t.monthIndex,
    weekIndex: t.weekIndex,
    startedAt: t.startedAt ? new Date(t.startedAt).toISOString() : null,
  };
}

function daysBetween(from, to) {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

async function shiftPendingTasks(goalId, fromDate, days, excludeTaskId = null) {
  if (!days) {
    return;
  }

  const db = getDb();
  const tasks = await db.collection('tasks').find({
    goalId,
    status: { $in: ['pending', 'in_progress'] },
  }).toArray();

  const updates = tasks.filter((task) => {
    if (excludeTaskId && task._id.equals(excludeTaskId)) {
      return false;
    }
    return !fromDate || (task.dueDate && task.dueDate > fromDate);
  });

  await Promise.all(
    updates.map((task) =>
      db.collection('tasks').updateOne(
        { _id: task._id },
        {
          $set: {
            dueDate: formatDate(addDays(new Date(task.dueDate), days)),
            dayIndex: (task.dayIndex || 0) + days,
          },
        }
      )
    )
  );
}

async function setActiveTask({ goal, task }) {
  const db = getDb();
  const activeTask = await db.collection('tasks').findOne({
    goalId: goal._id,
    status: 'in_progress',
  });

  if (activeTask && !activeTask._id.equals(task._id)) {
    await db.collection('tasks').updateOne(
      { _id: activeTask._id },
      { $set: { status: 'pending' } }
    );
  }

  await db.collection('tasks').updateOne(
    { _id: task._id },
    {
      $set: {
        status: 'in_progress',
        startedAt: new Date(),
      },
    }
  );

  await db.collection('goals').updateOne(
    { _id: goal._id },
    {
      $set: {
        activeTaskId: task._id,
        activeTaskStartedAt: new Date(),
      },
    }
  );

  return db.collection('tasks').findOne({ _id: task._id });
}

async function saveGoal({ goal, roadmap }) {
  const db = getDb();
  const userId = await getDefaultUserId();
  const existingGoal = await getActiveGoal();

  let goalId;
  const taskRows = extractTasksFromRoadmap(roadmap);
  const months = Array.isArray(roadmap?.months) && roadmap.months.length > 0
    ? roadmap.months.length
    : parseTimelineMonths(6);
  const totalGoalDays = Math.max(months * 30, taskRows.length || 1);
  const targetDate = addDays(new Date(), totalGoalDays);

  if (existingGoal) {
    const existingTaskIds = await db
      .collection('tasks')
      .find({ goalId: existingGoal._id }, { projection: { _id: 1 } })
      .toArray();
    const taskIds = existingTaskIds.map((task) => task._id);

    if (taskIds.length > 0) {
      await Promise.all([
        db.collection('checkins').deleteMany({ taskId: { $in: taskIds } }),
        db.collection('interviews').deleteMany({ taskId: { $in: taskIds } }),
        db.collection('tasks').deleteMany({ goalId: existingGoal._id }),
      ]);
    }

    await db.collection('goals').updateOne(
      { _id: existingGoal._id },
      {
        $set: {
          userId,
          goal,
          roadmap,
          activeTaskId: null,
          activeTaskStartedAt: null,
          progress: 0,
          confidence: 80,
          delayDays: 0,
          streak: 0,
          targetDate: formatDate(targetDate),
          createdAt: new Date(),
        },
      }
    );
    goalId = existingGoal._id;
  } else {
    const goalResult = await db.collection('goals').insertOne({
      userId,
      goal,
      roadmap,
      activeTaskId: null,
      activeTaskStartedAt: null,
      progress: 0,
      confidence: 80,
      delayDays: 0,
      streak: 0,
      targetDate: formatDate(targetDate),
      createdAt: new Date(),
    });

    goalId = goalResult.insertedId;
  }

  if (taskRows.length > 0) {
    const tasks = taskRows.map((row, i) => ({
      goalId,
      title: row.title,
      description: row.description,
      durationMinutes: row.durationMinutes,
      priority: row.priority,
      monthIndex: row.monthIndex,
      weekIndex: row.weekIndex,
      dayIndex: row.dayIndex || i + 1,
      status: 'pending',
      dueDate: formatDate(addDays(new Date(), i)),
      startedAt: null,
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

  const delayDays = missedTasks.length;
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

  if (delayDays > 0) {
    await shiftPendingTasks(goal._id, formatDate(new Date()), delayDays);
  }

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
      if (taskStatus === 'completed' && goal.activeTaskId && goal.activeTaskId.toString && goal.activeTaskId.toString() === objectId.toString()) {
        await db.collection('goals').updateOne(
          { _id: goal._id },
          { $set: { activeTaskId: null, activeTaskStartedAt: null } }
        );
      }

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
      activeTaskId: null,
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
    activeTaskId: goal.activeTaskId ? goal.activeTaskId.toString() : null,
    createdAt: goal.createdAt ? goal.createdAt.toISOString() : null,
  };
}

async function getTodayTasks() {
  const goal = await getActiveGoal();
  const today = formatDate(new Date());

  if (!goal) {
    return { date: today, tasks: [], overdueCount: 0, dueTodayCount: 0, activeTaskId: null };
  }

  const db = getDb();
  const allTasks = await db
    .collection('tasks')
    .find({ goalId: goal._id, status: { $in: ['pending', 'in_progress', 'completed'] } })
    .sort({ dueDate: 1 })
    .toArray();

  const overdue = allTasks.filter((t) => t.dueDate && t.dueDate < today && t.status !== 'completed');
  const dueToday = allTasks.filter((t) => t.dueDate === today);
  const tasks = allTasks.filter((task) => task.dueDate === today || task.status === 'in_progress');

  return {
    date: today,
    tasks: tasks.map(mapTask),
    overdueCount: overdue.length,
    dueTodayCount: dueToday.length,
    activeTaskId: goal.activeTaskId ? goal.activeTaskId.toString() : null,
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

async function activateTask({ taskId }) {
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
    const err = new Error('Cannot activate a completed task');
    err.status = 400;
    throw err;
  }

  const goal = await db.collection('goals').findOne({ _id: task.goalId });
  if (!goal) {
    const err = new Error('Active goal not found');
    err.status = 404;
    throw err;
  }

  await setActiveTask({ goal, task });

  return {
    success: true,
    taskId: objectId.toString(),
    startedAt: new Date().toISOString(),
  };
}

async function getCoachStats() {
  const dashboard = await getDashboard();
  const today = await getTodayTasks();
  const summary = await getSummary();
  return { ...dashboard, ...summary, todayTasks: today.tasks.map((t) => t.title) };
}

async function submitCheckin({ taskId, answer, answers, evaluateCheckin }) {
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

  const evaluation = await evaluateCheckin({
    taskTitle: task.title,
    answers: answers || answer,
  });

  const completedAt = new Date();
  const goal = await db.collection('goals').findOne({ _id: task.goalId });
  if (!goal) {
    const err = new Error('Active goal not found');
    err.status = 404;
    throw err;
  }

  await db.collection('tasks').updateOne(
    { _id: objectId },
    {
      $set: {
        status: 'completed',
        completedAt,
        startedAt: task.startedAt || null,
      },
    }
  );

  if (goal.activeTaskId && goal.activeTaskId.toString && goal.activeTaskId.toString() === objectId.toString()) {
    await db.collection('goals').updateOne(
      { _id: goal._id },
      { $set: { activeTaskId: null, activeTaskStartedAt: null } }
    );
  }

  const isLowScore = (evaluation.completionScore || 0) < 60;
  const penaltyDays = isLowScore ? 1 : 0;

  if (penaltyDays > 0) {
    await shiftPendingTasks(goal._id, task.dueDate, penaltyDays, objectId);
    await db.collection('goals').updateOne(
      { _id: goal._id },
      {
        $set: {
          delayDays: (goal.delayDays || 0) + penaltyDays,
          targetDate: formatDate(addDays(new Date(goal.targetDate || task.dueDate || new Date()), penaltyDays)),
        },
      }
    );

    await db.collection('tasks').insertOne({
      goalId: goal._id,
      title: `Revision: ${task.title}`,
      description: `Review the concepts from ${task.title} and close the gaps noted in the check-in.`,
      durationMinutes: 30,
      priority: 'high',
      status: 'pending',
      dueDate: formatDate(addDays(new Date(task.dueDate || completedAt), 1)),
      dayIndex: (task.dayIndex || 0) + 1,
      createdAt: new Date(),
    });
  }

  const completed = await db.collection('tasks').countDocuments({
    goalId: goal._id,
    status: 'completed',
  });
  const total = await db.collection('tasks').countDocuments({ goalId: goal._id });
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
  const confidence = Math.max(
    0,
    Math.min(100, Math.round((goal.confidence + evaluation.confidence) / 2))
  );

  await db.collection('goals').updateOne(
    { _id: goal._id },
    {
      $set: {
        progress,
        confidence,
      },
    }
  );

  await db.collection('checkins').insertOne({
    taskId: objectId,
    answer: JSON.stringify(answers || { answer }),
    status: evaluation.status,
    confidence: evaluation.confidence,
    completionScore: evaluation.completionScore,
    focusRating: evaluation.focusRating,
    productivityRating: evaluation.productivityRating,
    confidenceRating: evaluation.confidenceRating,
    summary: evaluation.summary,
    feedback: evaluation.feedback,
    suggestions: evaluation.suggestions,
    source: 'checkin',
    createdAt: completedAt,
  });

  return {
    status: evaluation.status,
    confidence: evaluation.confidence,
    completionScore: evaluation.completionScore,
    focusRating: evaluation.focusRating,
    productivityRating: evaluation.productivityRating,
    confidenceRating: evaluation.confidenceRating,
    summary: evaluation.summary,
    feedback: evaluation.feedback,
    suggestions: evaluation.suggestions,
  };
}

module.exports = {
  saveGoal,
  getDashboard,
  recalculate,
  activateTask,
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
