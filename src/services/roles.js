const { ObjectId } = require('mongodb');
const { getDb } = require('../db/mongo');

const ROLES = {
  GOAL_CREATOR: 'goal_creator',
  DOUBT_SOLVER: 'doubt_solver',
};

const PACKAGES = [
  { id: 'pkg_1h', hours: 1, price: 10, label: '1 Hour Mentorship' },
  { id: 'pkg_2h', hours: 2, price: 18, label: '2 Hours Mentorship' },
  { id: 'pkg_5h', hours: 5, price: 40, label: '5 Hours Mentorship' },
];

const PRICE_PER_HOUR = 10;

async function getDefaultUser() {
  const db = getDb();
  let user = await db.collection('users').findOne({}, { sort: { createdAt: 1 } });

  if (!user) {
    const result = await db.collection('users').insertOne({
      role: ROLES.GOAL_CREATOR,
      name: 'Goal Creator',
      mentorshipHoursRemaining: 0,
      createdAt: new Date(),
    });
    user = await db.collection('users').findOne({ _id: result.insertedId });
  }

  if (!user.role) {
    await db.collection('users').updateOne(
      { _id: user._id },
      {
        $set: {
          role: ROLES.GOAL_CREATOR,
          name: user.name || 'Goal Creator',
          mentorshipHoursRemaining: user.mentorshipHoursRemaining || 0,
        },
      }
    );
    user = await db.collection('users').findOne({ _id: user._id });
  }

  return user;
}

async function getUserProfile() {
  const user = await getDefaultUser();
  return {
    id: user._id.toString(),
    role: user.role,
    name: user.name || 'Goal Creator',
    mentorshipHoursRemaining: user.mentorshipHoursRemaining || 0,
  };
}

async function switchRole({ role }) {
  if (![ROLES.GOAL_CREATOR, ROLES.DOUBT_SOLVER].includes(role)) {
    const err = new Error('Invalid role. Use goal_creator or doubt_solver');
    err.status = 400;
    throw err;
  }

  const db = getDb();
  const user = await getDefaultUser();

  await db.collection('users').updateOne(
    { _id: user._id },
    {
      $set: {
        role,
        name: role === ROLES.DOUBT_SOLVER ? 'Doubt Solver' : 'Goal Creator',
      },
    }
  );

  return {
    success: true,
    role,
    message:
      role === ROLES.DOUBT_SOLVER
        ? 'Switched to Doubt Solver mode'
        : 'Switched to Goal Creator mode',
  };
}

function getMentorshipPackages() {
  return { packages: PACKAGES, pricePerHour: PRICE_PER_HOUR };
}

async function buyMentorship({ hours, packageId }) {
  const user = await getDefaultUser();

  if (user.role !== ROLES.GOAL_CREATOR) {
    const err = new Error('Only goal creators can buy mentorship hours');
    err.status = 403;
    throw err;
  }

  let purchaseHours = Number(hours);
  let totalPrice = purchaseHours * PRICE_PER_HOUR;

  if (packageId) {
    const pkg = PACKAGES.find((p) => p.id === packageId);
    if (!pkg) {
      const err = new Error('Invalid packageId');
      err.status = 400;
      throw err;
    }
    purchaseHours = pkg.hours;
    totalPrice = pkg.price;
  }

  if (!purchaseHours || purchaseHours <= 0) {
    const err = new Error('hours must be a positive number');
    err.status = 400;
    throw err;
  }

  const db = getDb();
  const newBalance = (user.mentorshipHoursRemaining || 0) + purchaseHours;

  await db.collection('users').updateOne(
    { _id: user._id },
    { $set: { mentorshipHoursRemaining: newBalance } }
  );

  await db.collection('mentorship_purchases').insertOne({
    userId: user._id,
    hours: purchaseHours,
    totalPrice,
    packageId: packageId || null,
    purchasedAt: new Date(),
  });

  return {
    success: true,
    hoursPurchased: purchaseHours,
    totalPrice,
    hoursRemaining: newBalance,
    message: `Purchased ${purchaseHours} hour${purchaseHours === 1 ? '' : 's'} of mentorship`,
  };
}

async function getMentorshipBalance() {
  const user = await getDefaultUser();
  const db = getDb();

  const purchases = await db
    .collection('mentorship_purchases')
    .find({ userId: user._id })
    .sort({ purchasedAt: -1 })
    .toArray();

  const totalPurchased = purchases.reduce((sum, p) => sum + p.hours, 0);

  return {
    hoursRemaining: user.mentorshipHoursRemaining || 0,
    totalPurchased,
    purchases: purchases.map((p) => ({
      id: p._id.toString(),
      hours: p.hours,
      totalPrice: p.totalPrice,
      purchasedAt: p.purchasedAt.toISOString(),
    })),
  };
}

async function getDoubtSolvers() {
  const db = getDb();
  const solvers = await db
    .collection('users')
    .find({ role: ROLES.DOUBT_SOLVER, available: { $ne: false } })
    .sort({ rating: -1 })
    .toArray();

  return {
    solvers: solvers.map((s) => ({
      id: s._id.toString(),
      name: s.name,
      expertise: s.expertise || [],
      ratePerHour: s.ratePerHour || PRICE_PER_HOUR,
      rating: s.rating || 5,
      bio: s.bio || '',
    })),
  };
}

async function createMeeting({ solverId, doubt, scheduledAt, durationHours }) {
  const user = await getDefaultUser();

  if (user.role !== ROLES.GOAL_CREATOR) {
    const err = new Error('Only goal creators can book mentorship meetings');
    err.status = 403;
    throw err;
  }

  const duration = Number(durationHours) || 1;
  if (duration <= 0) {
    const err = new Error('durationHours must be positive');
    err.status = 400;
    throw err;
  }

  if ((user.mentorshipHoursRemaining || 0) < duration) {
    const err = new Error(
      `Not enough mentorship hours. Need ${duration}, have ${user.mentorshipHoursRemaining || 0}`
    );
    err.status = 402;
    throw err;
  }

  if (!doubt || !String(doubt).trim()) {
    const err = new Error('doubt is required');
    err.status = 400;
    throw err;
  }

  let solverObjectId;
  try {
    solverObjectId = new ObjectId(solverId);
  } catch {
    const err = new Error('Invalid solverId');
    err.status = 400;
    throw err;
  }

  const db = getDb();
  const solver = await db.collection('users').findOne({
    _id: solverObjectId,
    role: ROLES.DOUBT_SOLVER,
  });

  if (!solver) {
    const err = new Error('Doubt solver not found');
    err.status = 404;
    throw err;
  }

  const meetingDate = scheduledAt ? new Date(scheduledAt) : new Date(Date.now() + 3600000);
  if (Number.isNaN(meetingDate.getTime())) {
    const err = new Error('Invalid scheduledAt date');
    err.status = 400;
    throw err;
  }

  const hoursRemaining = (user.mentorshipHoursRemaining || 0) - duration;

  await db.collection('users').updateOne(
    { _id: user._id },
    { $set: { mentorshipHoursRemaining: hoursRemaining } }
  );

  const meetingResult = await db.collection('meetings').insertOne({
    creatorId: user._id,
    solverId: solverObjectId,
    doubt: String(doubt).trim(),
    scheduledAt: meetingDate,
    durationHours: duration,
    hoursCost: duration,
    status: 'scheduled',
    createdAt: new Date(),
  });

  const meetingId = meetingResult.insertedId.toString();

  return {
    success: true,
    meeting: {
      id: meetingId,
      solverId: solver._id.toString(),
      solverName: solver.name,
      doubt: String(doubt).trim(),
      scheduledAt: meetingDate.toISOString(),
      durationHours: duration,
      hoursCost: duration,
      status: 'scheduled',
      meetingLink: `https://meet.goalos.app/room/${meetingId}`,
    },
    hoursRemaining,
    message: `Meeting booked with ${solver.name}`,
  };
}

async function getMeetings() {
  const user = await getDefaultUser();
  const db = getDb();

  const filter =
    user.role === ROLES.DOUBT_SOLVER
      ? { solverId: user._id }
      : { creatorId: user._id };

  const meetings = await db
    .collection('meetings')
    .find(filter)
    .sort({ scheduledAt: 1 })
    .toArray();

  const userIds = [
    ...new Set(
      meetings.flatMap((m) => [m.creatorId.toString(), m.solverId.toString()])
    ),
  ].map((id) => new ObjectId(id));

  const users = await db.collection('users').find({ _id: { $in: userIds } }).toArray();
  const userMap = new Map(users.map((u) => [u._id.toString(), u.name]));

  return {
    role: user.role,
    meetings: meetings.map((m) => ({
      id: m._id.toString(),
      creatorId: m.creatorId.toString(),
      creatorName: userMap.get(m.creatorId.toString()) || 'Goal Creator',
      solverId: m.solverId.toString(),
      solverName: userMap.get(m.solverId.toString()) || 'Doubt Solver',
      doubt: m.doubt,
      scheduledAt: m.scheduledAt.toISOString(),
      durationHours: m.durationHours,
      hoursCost: m.hoursCost,
      status: m.status,
      meetingLink: `https://meet.goalos.app/room/${m._id.toString()}`,
    })),
  };
}

async function completeMeeting({ meetingId }) {
  const user = await getDefaultUser();
  let objectId;
  try {
    objectId = new ObjectId(meetingId);
  } catch {
    const err = new Error('Invalid meetingId');
    err.status = 400;
    throw err;
  }

  const db = getDb();
  const meeting = await db.collection('meetings').findOne({ _id: objectId });

  if (!meeting) {
    const err = new Error('Meeting not found');
    err.status = 404;
    throw err;
  }

  const isSolver = user.role === ROLES.DOUBT_SOLVER && meeting.solverId.equals(user._id);
  const isCreator = user.role === ROLES.GOAL_CREATOR && meeting.creatorId.equals(user._id);

  if (!isSolver && !isCreator) {
    const err = new Error('Not allowed to update this meeting');
    err.status = 403;
    throw err;
  }

  await db.collection('meetings').updateOne(
    { _id: objectId },
    { $set: { status: 'completed', completedAt: new Date() } }
  );

  return {
    success: true,
    meetingId,
    status: 'completed',
    message: 'Meeting marked as completed',
  };
}

module.exports = {
  ROLES,
  getUserProfile,
  switchRole,
  getMentorshipPackages,
  buyMentorship,
  getMentorshipBalance,
  getDoubtSolvers,
  createMeeting,
  getMeetings,
  completeMeeting,
};
