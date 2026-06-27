const { ObjectId } = require('mongodb');
const { getDb } = require('../db/mongo');
const { startInterviewQuestion, continueInterview } = require('./openai');
const { applyVerificationResult } = require('./goals');

const MAX_STEPS = 3;

async function startInterview({ taskId }) {
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

  const goal = await db.collection('goals').findOne({ _id: task.goalId });
  const goalTitle = goal?.goal || 'Your goal';

  const existing = await db.collection('interviews').findOne({
    taskId: objectId,
    status: 'active',
  });

  if (existing) {
    const lastQuestion = existing.messages.find((m) => m.role === 'assistant');
    return {
      interviewId: existing._id.toString(),
      question: lastQuestion?.content || 'Walk me through exactly what you did for this task.',
    };
  }

  const question = await startInterviewQuestion({
    taskTitle: task.title,
    goalTitle,
  });

  const insertResult = await db.collection('interviews').insertOne({
    taskId: objectId,
    goalId: task.goalId,
    taskTitle: task.title,
    goalTitle,
    messages: [{ role: 'assistant', content: question }],
    step: 1,
    maxSteps: MAX_STEPS,
    status: 'active',
    createdAt: new Date(),
  });

  return {
    interviewId: insertResult.insertedId.toString(),
    question,
  };
}

async function respondInterview({ interviewId, answer }) {
  const db = getDb();
  let objectId;
  try {
    objectId = new ObjectId(interviewId);
  } catch {
    const err = new Error('Invalid interviewId');
    err.status = 400;
    throw err;
  }

  const interview = await db.collection('interviews').findOne({ _id: objectId, status: 'active' });
  if (!interview) {
    const err = new Error('Interview not found or already completed');
    err.status = 404;
    throw err;
  }

  const messages = [...interview.messages, { role: 'user', content: answer }];
  const nextStep = interview.step + 1;

  const aiResult = await continueInterview({
    taskTitle: interview.taskTitle,
    goalTitle: interview.goalTitle,
    messages,
    step: nextStep,
    maxSteps: interview.maxSteps,
  });

  if (aiResult.complete) {
    await db.collection('interviews').updateOne(
      { _id: objectId },
      {
        $set: {
          messages: [...messages],
          status: 'completed',
          result: {
            status: aiResult.status,
            confidence: aiResult.confidence,
            feedback: aiResult.feedback,
          },
          completedAt: new Date(),
        },
      }
    );

    await applyVerificationResult({
      taskId: interview.taskId,
      answer,
      status: aiResult.status,
      confidence: aiResult.confidence,
      source: 'interview',
    });

    return {
      complete: true,
      status: aiResult.status,
      confidence: aiResult.confidence,
      feedback: aiResult.feedback,
    };
  }

  const updatedMessages = [...messages, { role: 'assistant', content: aiResult.question }];

  await db.collection('interviews').updateOne(
    { _id: objectId },
    { $set: { messages: updatedMessages, step: nextStep } }
  );

  return {
    complete: false,
    question: aiResult.question,
  };
}

module.exports = { startInterview, respondInterview };
