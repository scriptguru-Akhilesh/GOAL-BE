require('dotenv').config({ override: true });
const express = require('express');
const cors = require('cors');
const { connect, pingDb } = require('./db/mongo');
const { generateRoadmap, evaluateCheckin, generateDailyCoach } = require('./services/openai');
const {
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
} = require('./services/goals');
const { startInterview, respondInterview } = require('./services/interview');
const {
  getUserProfile,
  getRole,
  switchRole,
  getMentorshipPackages,
  buyMentorship,
  getMentorshipBalance,
  getDoubtSolvers,
  createMeeting,
  getMeetings,
  completeMeeting,
} = require('./services/roles');
const { apiLogger, logServerError } = require('./middleware/apiLogger');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(apiLogger);

app.get('/api/health', async (req, res) => {
  try {
    const dbStatus = await pingDb();
    res.json({
      status: 'ok',
      service: 'GoalOS API',
      database: dbStatus.database,
      dbConnected: true,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      service: 'GoalOS API',
      database: null,
      dbConnected: false,
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/api/generate', async (req, res) => {
  try {
    const { goal, timeline, hoursPerDay, difficulty } = req.body;
    const roadmap = await generateRoadmap({ goal, timeline, hoursPerDay, difficulty });
    res.json({ roadmap });
  } catch (err) {
    logServerError(err, req);
    res.status(500).json({ error: 'Failed to generate roadmap' });
  }
});

app.post('/api/goals', async (req, res) => {
  try {
    const { goal, roadmap } = req.body;
    await saveGoal({ goal, roadmap });
    res.json({ success: true });
  } catch (err) {
    logServerError(err, req);
    res.status(500).json({ error: 'Failed to save goal' });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const dashboard = await getDashboard();
    res.json(dashboard);
  } catch (err) {
    logServerError(err, req);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

app.get('/api/tasks', async (req, res) => {
  try {
    const result = await getTasks();
    res.json(result);
  } catch (err) {
    logServerError(err, req);
    res.status(500).json({ error: 'Failed to load tasks' });
  }
});

app.post('/api/interview/start', async (req, res) => {
  try {
    const { taskId } = req.body;
    const result = await startInterview({ taskId });
    res.json(result);
  } catch (err) {
    logServerError(err, req);
    res.status(err.status || 500).json({ error: err.message || 'Failed to start interview' });
  }
});

app.post('/api/interview/respond', async (req, res) => {
  try {
    const { interviewId, answer } = req.body;
    const result = await respondInterview({ interviewId, answer });
    res.json(result);
  } catch (err) {
    logServerError(err, req);
    res.status(err.status || 500).json({ error: err.message || 'Interview response failed' });
  }
});

app.post('/api/checkin', async (req, res) => {
  try {
    const { taskId, answer } = req.body;
    const result = await submitCheckin({ taskId, answer, evaluateCheckin });
    res.json(result);
  } catch (err) {
    logServerError(err, req);
    res.status(err.status || 500).json({ error: err.message || 'Checkin failed' });
  }
});

app.post('/api/recalculate', async (req, res) => {
  try {
    const { completedTasks, missedTasks } = req.body;
    const result = await recalculate({ completedTasks, missedTasks });
    res.json(result);
  } catch (err) {
    logServerError(err, req);
    res.status(500).json({ error: 'Failed to recalculate' });
  }
});

// --- NEW endpoints ---

app.get('/api/goal', async (req, res) => {
  try {
    const result = await getGoalDetails();
    res.json(result);
  } catch (err) {
    logServerError(err, req);
    res.status(500).json({ error: 'Failed to load goal' });
  }
});

app.get('/api/today', async (req, res) => {
  try {
    const result = await getTodayTasks();
    res.json(result);
  } catch (err) {
    logServerError(err, req);
    res.status(500).json({ error: 'Failed to load today tasks' });
  }
});

app.get('/api/summary', async (req, res) => {
  try {
    const result = await getSummary();
    res.json(result);
  } catch (err) {
    logServerError(err, req);
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

app.get('/api/checkins', async (req, res) => {
  try {
    const result = await getCheckins(req.query.limit);
    res.json(result);
  } catch (err) {
    logServerError(err, req);
    res.status(500).json({ error: 'Failed to load checkins' });
  }
});

app.post('/api/coach/daily', async (req, res) => {
  try {
    const stats = await getCoachStats();
    const coach = await generateDailyCoach(stats);
    res.json(coach);
  } catch (err) {
    logServerError(err, req);
    res.status(500).json({ error: 'Failed to generate coach message' });
  }
});

app.post('/api/tasks/skip', async (req, res) => {
  try {
    const { taskId } = req.body;
    const result = await skipTask({ taskId });
    res.json(result);
  } catch (err) {
    logServerError(err, req);
    res.status(err.status || 500).json({ error: err.message || 'Failed to skip task' });
  }
});

// --- ROLES & MENTORSHIP ---

app.get('/api/user/profile', async (req, res) => {
  try {
    const result = await getUserProfile();
    res.json(result);
  } catch (err) {
    logServerError(err, req);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

app.get('/api/role', async (req, res) => {
  try {
    const result = await getRole();
    res.json(result);
  } catch (err) {
    logServerError(err, req);
    res.status(500).json({ error: 'Failed to load role' });
  }
});

app.post(['/api/role', '/api/user/role'], async (req, res) => {
  try {
    const { role } = req.body;
    const result = await switchRole({ role });
    res.json(result);
  } catch (err) {
    logServerError(err, req);
    res.status(err.status || 500).json({ error: err.message || 'Failed to switch role' });
  }
});

app.get('/api/mentorship/packages', async (req, res) => {
  try {
    res.json(getMentorshipPackages());
  } catch (err) {
    logServerError(err, req);
    res.status(500).json({ error: 'Failed to load packages' });
  }
});

app.post('/api/mentorship/buy', async (req, res) => {
  try {
    const { hours, packageId } = req.body;
    const result = await buyMentorship({ hours, packageId });
    res.json(result);
  } catch (err) {
    logServerError(err, req);
    res.status(err.status || 500).json({ error: err.message || 'Failed to buy mentorship' });
  }
});

app.get('/api/mentorship/balance', async (req, res) => {
  try {
    const result = await getMentorshipBalance();
    res.json(result);
  } catch (err) {
    logServerError(err, req);
    res.status(500).json({ error: 'Failed to load balance' });
  }
});

app.get('/api/doubt-solvers', async (req, res) => {
  try {
    const result = await getDoubtSolvers();
    res.json(result);
  } catch (err) {
    logServerError(err, req);
    res.status(500).json({ error: 'Failed to load doubt solvers' });
  }
});

app.post('/api/meetings', async (req, res) => {
  try {
    const { solverId, doubt, scheduledAt, durationHours } = req.body;
    const result = await createMeeting({ solverId, doubt, scheduledAt, durationHours });
    res.json(result);
  } catch (err) {
    logServerError(err, req);
    res.status(err.status || 500).json({ error: err.message || 'Failed to create meeting' });
  }
});

app.get('/api/meetings', async (req, res) => {
  try {
    const result = await getMeetings();
    res.json(result);
  } catch (err) {
    logServerError(err, req);
    res.status(500).json({ error: 'Failed to load meetings' });
  }
});

app.post('/api/meetings/complete', async (req, res) => {
  try {
    const { meetingId } = req.body;
    const result = await completeMeeting({ meetingId });
    res.json(result);
  } catch (err) {
    logServerError(err, req);
    res.status(err.status || 500).json({ error: err.message || 'Failed to complete meeting' });
  }
});

async function start() {
  await connect();
  console.log('\n✅ API logging enabled — requests/responses/errors print in this terminal\n');
  app.listen(PORT, () => {
    console.log(`GoalOS API running on http://localhost:${PORT}/api`);
    console.log(`Health check: http://localhost:${PORT}/api/health\n`);
  });
}

start().catch((err) => {
  console.error('\n[STARTUP ERROR]', err.message, '\n');
  process.exit(1);
});
