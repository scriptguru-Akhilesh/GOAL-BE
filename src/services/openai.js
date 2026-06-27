const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateRoadmap({ goal, timeline, hoursPerDay, difficulty }) {
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a goal planning assistant. Return JSON only with this exact shape:
{"months":[{"title":"Month 1","weeks":[{"week":1,"tasks":["task description"]}]}]}
Create a realistic month-by-month roadmap. Each month has weeks with concrete daily tasks.`,
      },
      {
        role: 'user',
        content: `Goal: ${goal}
Timeline: ${timeline}
Hours per day: ${hoursPerDay}
Difficulty: ${difficulty}`,
      },
    ],
  });

  const parsed = JSON.parse(completion.choices[0].message.content);
  return { months: parsed.months || [] };
}

async function evaluateCheckin({ taskTitle, answer }) {
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a strict coach evaluating task completion. Be honest and rigorous.
Return JSON only: {"status":"verified"|"partial"|"failed","confidence":0-100}
- verified: clearly completed with evidence
- partial: some progress but incomplete
- failed: not done or insufficient effort`,
      },
      {
        role: 'user',
        content: `Task: ${taskTitle}\nUser answer: ${answer}`,
      },
    ],
  });

  const result = JSON.parse(completion.choices[0].message.content);
  const status = ['verified', 'partial', 'failed'].includes(result.status)
    ? result.status
    : 'failed';
  const confidence = Math.min(100, Math.max(0, Number(result.confidence) || 0));

  return { status, confidence };
}

async function startInterviewQuestion({ taskTitle, goalTitle }) {
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a strict but fair coach conducting a brief verification interview after a user checked off a task.
Ask ONE sharp follow-up question that proves they actually did the work. Be specific to the task.
Return JSON only: {"question":"your question here"}`,
      },
      {
        role: 'user',
        content: `Goal: ${goalTitle}\nTask marked complete: ${taskTitle}`,
      },
    ],
  });

  const result = JSON.parse(completion.choices[0].message.content);
  return result.question || 'Walk me through exactly what you did for this task.';
}

async function continueInterview({ taskTitle, goalTitle, messages, step, maxSteps }) {
  const transcript = messages
    .map((m) => `${m.role === 'assistant' ? 'Coach' : 'User'}: ${m.content}`)
    .join('\n');

  const isLastStep = step >= maxSteps;

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: isLastStep
          ? `You are a strict coach finishing a verification interview.
Review the full transcript. Return JSON only:
{"complete":true,"status":"verified"|"partial"|"failed","confidence":0-100,"feedback":"one sentence coach note"}
- verified: clearly completed with convincing evidence
- partial: some progress but incomplete or vague
- failed: not done, copied answers, or insufficient effort`
          : `You are a strict coach in a verification interview (question ${step} of ${maxSteps}).
Review the transcript. Either ask ONE deeper follow-up OR finish early if you have enough evidence.
Return JSON only:
{"complete":false,"question":"next question"} OR {"complete":true,"status":"verified"|"partial"|"failed","confidence":0-100,"feedback":"one sentence coach note"}`,
      },
      {
        role: 'user',
        content: `Goal: ${goalTitle}\nTask: ${taskTitle}\n\nTranscript:\n${transcript}`,
      },
    ],
  });

  const result = JSON.parse(completion.choices[0].message.content);

  if (result.complete) {
    const status = ['verified', 'partial', 'failed'].includes(result.status)
      ? result.status
      : 'failed';
    const confidence = Math.min(100, Math.max(0, Number(result.confidence) || 0));
    return { complete: true, status, confidence, feedback: result.feedback || '' };
  }

  return {
    complete: false,
    question: result.question || 'Can you give more specific details about what you accomplished?',
  };
}

async function generateDailyCoach(stats) {
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a strict but motivating goal coach for GoalOS.
Return JSON only: {"message":"2-3 sentence daily briefing","tone":"motivating"|"warning"|"celebration","tip":"one actionable tip for today"}
Be direct. Reference their stats honestly.`,
      },
      {
        role: 'user',
        content: JSON.stringify(stats),
      },
    ],
  });

  const result = JSON.parse(completion.choices[0].message.content);
  const tone = ['motivating', 'warning', 'celebration'].includes(result.tone)
    ? result.tone
    : 'motivating';

  return {
    message: result.message || 'Stay focused on today\'s tasks.',
    tone,
    tip: result.tip || 'Complete one task and verify it with proof.',
  };
}

module.exports = {
  generateRoadmap,
  evaluateCheckin,
  startInterviewQuestion,
  continueInterview,
  generateDailyCoach,
};
