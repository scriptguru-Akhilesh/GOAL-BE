require('dotenv').config({ override: true });
const { connect, close, getDb } = require('./mongo');

const SEED_SOLVERS = [
  {
    role: 'doubt_solver',
    name: 'Alex Mentor',
    expertise: ['JavaScript', 'React', 'Node.js'],
    ratePerHour: 10,
    rating: 4.9,
    bio: 'Full-stack dev with 8 years experience. Helps with roadmaps and debugging.',
    available: true,
    createdAt: new Date(),
  },
  {
    role: 'doubt_solver',
    name: 'Priya Sharma',
    expertise: ['Python', 'Data Science', 'ML basics'],
    ratePerHour: 12,
    rating: 4.8,
    bio: 'Data scientist who breaks down complex topics into simple steps.',
    available: true,
    createdAt: new Date(),
  },
  {
    role: 'doubt_solver',
    name: 'Jordan Lee',
    expertise: ['System Design', 'AWS', 'Interview prep'],
    ratePerHour: 15,
    rating: 5,
    bio: 'Ex-FAANG engineer. Great for career goals and technical doubts.',
    available: true,
    createdAt: new Date(),
  },
];

async function init() {
  await connect();
  const db = getDb();

  await db.collection('users').createIndex({ createdAt: 1 });
  await db.collection('users').createIndex({ role: 1 });
  await db.collection('goals').createIndex({ userId: 1, createdAt: -1 });
  await db.collection('tasks').createIndex({ goalId: 1, status: 1 });
  await db.collection('checkins').createIndex({ taskId: 1, createdAt: -1 });
  await db.collection('interviews').createIndex({ taskId: 1, status: 1 });
  await db.collection('mentorship_purchases').createIndex({ userId: 1, purchasedAt: -1 });
  await db.collection('meetings').createIndex({ creatorId: 1, scheduledAt: 1 });
  await db.collection('meetings').createIndex({ solverId: 1, scheduledAt: 1 });

  let user = await db.collection('users').findOne({ role: 'goal_creator' });
  if (!user) {
    const result = await db.collection('users').insertOne({
      role: 'goal_creator',
      name: 'Goal Creator',
      mentorshipHoursRemaining: 0,
      createdAt: new Date(),
    });
    console.log('Default goal creator id:', result.insertedId.toString());
  } else if (!user.role) {
    await db.collection('users').updateOne(
      { _id: user._id },
      { $set: { role: 'goal_creator', name: 'Goal Creator', mentorshipHoursRemaining: 0 } }
    );
    console.log('Updated existing user with goal_creator role');
  } else {
    console.log('Goal creator already exists.');
  }

  const solverCount = await db.collection('users').countDocuments({ role: 'doubt_solver' });
  if (solverCount === 0) {
    await db.collection('users').insertMany(SEED_SOLVERS);
    console.log(`Seeded ${SEED_SOLVERS.length} doubt solvers.`);
  } else {
    console.log(`${solverCount} doubt solvers already exist.`);
  }

  await close();
}

init().catch((err) => {
  console.error(err);
  process.exit(1);
});
