const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateRoadmap({ goal, timeline, hoursPerDay, difficulty }) {
  const timelineText = String(timeline || '').toLowerCase();
  const timelineMatch = timelineText.match(/(\d+)/);
  const rawDays = timelineText.includes('month')
    ? Math.max(14, Number(timelineMatch?.[1] || 1) * 30)
    : timelineText.includes('week')
      ? Math.max(7, Number(timelineMatch?.[1] || 1) * 7)
      : timelineText.includes('day')
        ? Math.max(7, Number(timelineMatch?.[1] || 1))
        : 30;
  const planDays = Math.min(Math.max(rawDays, 14), 30);

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a goal planning assistant. Return JSON only with this exact shape:
{"days":[{"day":1,"title":"...","description":"...","durationMinutes":90,"priority":"high","dependsOn":[]}]}
Create a realistic day-by-day execution plan. Every item must be completable in a single day.
Include a concise description, a realistic duration in minutes, and a priority of high, medium, or low.
Generate exactly ${planDays} days. Use small, actionable tasks that build toward the goal in sequence.`,
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
  const days = Array.isArray(parsed.days) ? parsed.days : [];
  return {
    days,
    planDays,
  };
}

async function evaluateCheckin({ taskTitle, answers }) {
  const responsePayload = typeof answers === 'string' ? answers : JSON.stringify(answers);
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a strict daily task coach evaluating a user's completion check-in.
Return JSON only with this exact shape:
{
  "status":"verified"|"partial"|"failed",
  "completionScore":0-100,
  "focusRating":1-5,
  "productivityRating":1-5,
  "confidenceRating":1-5,
  "summary":"short summary",
  "feedback":"personalized feedback",
  "suggestions":["one suggestion for tomorrow"]
}
Be honest and specific. Use the reflection answers to score the work and suggest how tomorrow should adapt.
Map missing blockers or weak focus to lower scores.`,
      },
      {
        role: 'user',
        content: `Task: ${taskTitle}\nCheck-in answers:\n${responsePayload}`,
      },
    ],
  });

  const result = JSON.parse(completion.choices[0].message.content);
  const status = ['verified', 'partial', 'failed'].includes(result.status)
    ? result.status
    : 'failed';
  const completionScore = Math.min(100, Math.max(0, Number(result.completionScore) || 0));
  const focusRating = Math.min(5, Math.max(1, Number(result.focusRating) || 1));
  const productivityRating = Math.min(5, Math.max(1, Number(result.productivityRating) || 1));
  const confidenceRating = Math.min(5, Math.max(1, Number(result.confidenceRating) || 1));

  return {
    status,
    confidence: Math.round((completionScore + confidenceRating * 20) / 2),
    completionScore,
    focusRating,
    productivityRating,
    confidenceRating,
    summary: result.summary || 'Task check-in completed.',
    feedback: result.feedback || '',
    suggestions: Array.isArray(result.suggestions) ? result.suggestions.slice(0, 3) : [],
  };
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
Review the transcript and ask exactly one deeper follow-up question.
Do not complete early. You must ask all ${maxSteps} questions before giving a rating.
Return JSON only: {"complete":false,"question":"next question"}`,
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
