# GoalOS Backend API

Frontend integration reference for GoalOS. All endpoints live under `/api`.

**Base URL (local):** `http://localhost:3000/api`

**Content-Type:** `application/json` for all POST requests

**Auth:** None (single demo user on backend)

**IDs:** MongoDB ObjectId strings (24-char hex), e.g. `"674a1b2c3d4e5f6789012345"`

---

## Quick start

```bash
cp .env.example .env
npm install
npm run db:init
npm run dev
```

---

## Recommended frontend flow

```
1. Onboarding
   POST /generate  →  show roadmap preview
   POST /goals     →  save goal + create tasks

2. Dashboard
   GET /dashboard  →  stats (progress, streak, etc.)
   GET /tasks      →  task checklist

3. User checks a task ✓
   POST /interview/start   →  first AI question
   POST /interview/respond →  loop until complete: true

   OR (single-shot, no interview)
   POST /checkin     →  one answer, instant verdict

4. End of day
   POST /recalculate →  update ETA, delay, confidence
```

---

## Endpoints overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (ping / ngrok test) |
| POST | `/generate` | AI generates roadmap from goal inputs |
| POST | `/goals` | Save goal + roadmap, create tasks |
| GET | `/dashboard` | Goal stats for home screen |
| GET | `/tasks` | List tasks for active goal |
| POST | `/interview/start` | Start AI verification after checkmark |
| POST | `/interview/respond` | Answer interview question(s) |
| POST | `/checkin` | Single-answer task verification |
| POST | `/recalculate` | Recalculate timeline after day ends |

---

## 0. GET `/health`

Simple health check. Use to verify server + ngrok are working.

### Request

No body. No query params.

### Success response `200`

```json
{
  "status": "ok",
  "service": "GoalOS API",
  "timestamp": "2026-06-27T12:00:00.000Z"
}
```

### Test URLs

```bash
# Local
curl http://localhost:3000/api/health

# ngrok (replace with your URL)
curl https://YOUR-NGROK-URL.ngrok-free.dev/api/health
```

---

## 1. POST `/generate`

Generate an AI roadmap. Does **not** save to database.

### Request body

```json
{
  "goal": "Become a full-stack developer",
  "timeline": "6 months",
  "hoursPerDay": 2,
  "difficulty": "medium"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `goal` | string | yes | User's goal description |
| `timeline` | string | yes | e.g. `"6 months"`, `"12 months"` |
| `hoursPerDay` | number | yes | Daily hours available |
| `difficulty` | string | yes | e.g. `"easy"`, `"medium"`, `"hard"` |

### Success response `200`

```json
{
  "roadmap": {
    "months": [
      {
        "title": "Month 1: HTML & CSS Foundations",
        "weeks": [
          {
            "week": 1,
            "tasks": [
              "Complete HTML basics tutorial (2 hours)",
              "Build a simple landing page",
              "Practice CSS flexbox for 30 minutes"
            ]
          },
          {
            "week": 2,
            "tasks": [
              "Learn CSS grid layout",
              "Rebuild landing page with responsive design"
            ]
          }
        ]
      },
      {
        "title": "Month 2: JavaScript Fundamentals",
        "weeks": [
          {
            "week": 1,
            "tasks": [
              "Complete JavaScript variables and functions module",
              "Solve 5 basic coding exercises"
            ]
          }
        ]
      }
    ]
  }
}
```

### Response shape

```typescript
{
  roadmap: {
    months: Array<{
      title: string;
      weeks: Array<{
        week: number;
        tasks: string[];
      }>;
    }>;
  };
}
```

### Error response `500`

```json
{
  "error": "Failed to generate roadmap"
}
```

---

## 2. POST `/goals`

Save the goal and roadmap. Backend creates individual **tasks** from roadmap weeks.

### Request body

```json
{
  "goal": "Become a full-stack developer",
  "roadmap": {
    "months": [
      {
        "title": "Month 1: HTML & CSS Foundations",
        "weeks": [
          {
            "week": 1,
            "tasks": ["Complete HTML basics tutorial", "Build a landing page"]
          }
        ]
      }
    ]
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `goal` | string | yes | Goal title/text |
| `roadmap` | object | yes | Same shape returned by `/generate` |

### Success response `200`

```json
{
  "success": true
}
```

### Error response `500`

```json
{
  "error": "Failed to save goal"
}
```

---

## 3. GET `/dashboard`

Returns stats for the **most recent active goal**.

### Request

No body. No query params.

### Success response `200`

**With active goal:**

```json
{
  "goal": "Become a full-stack developer",
  "progress": 35,
  "confidence": 84,
  "delayDays": 2,
  "tasksCompleted": 7,
  "tasksMissed": 1,
  "streak": 3
}
```

**No goal saved yet:**

```json
{
  "goal": "",
  "progress": 0,
  "confidence": 0,
  "delayDays": 0,
  "tasksCompleted": 0,
  "tasksMissed": 0,
  "streak": 0
}
```

### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `goal` | string | Goal text |
| `progress` | number | 0–100 completion percentage |
| `confidence` | number | 0–100 AI confidence score |
| `delayDays` | number | Total days goal is delayed |
| `tasksCompleted` | number | Count of completed tasks |
| `tasksMissed` | number | Count of missed tasks |
| `streak` | number | Current completion streak |

### Error response `500`

```json
{
  "error": "Failed to load dashboard"
}
```

---

## 4. GET `/tasks`

List all tasks for the active goal. Use task `id` for checkin/interview.

### Request

No body. No query params.

### Success response `200`

```json
{
  "tasks": [
    {
      "id": "674a1b2c3d4e5f6789012345",
      "title": "Complete HTML basics tutorial (2 hours)",
      "status": "pending",
      "dueDate": "2026-07-15",
      "monthIndex": 1,
      "weekIndex": 1
    },
    {
      "id": "674a1b2c3d4e5f6789012346",
      "title": "Build a simple landing page",
      "status": "completed",
      "dueDate": "2026-07-20",
      "monthIndex": 1,
      "weekIndex": 1
    },
    {
      "id": "674a1b2c3d4e5f6789012347",
      "title": "Practice CSS flexbox for 30 minutes",
      "status": "missed",
      "dueDate": "2026-07-25",
      "monthIndex": 1,
      "weekIndex": 1
    }
  ]
}
```

### Task status values

| Status | Meaning |
|--------|---------|
| `pending` | Not done yet (or partial checkin) |
| `completed` | Verified as done |
| `missed` | Failed verification or marked missed |

### Empty state

```json
{
  "tasks": []
}
```

### Error response `500`

```json
{
  "error": "Failed to load tasks"
}
```

---

## 5. POST `/interview/start`

Start AI verification interview when user **checks off** a task.

Call this immediately after the user marks a task complete.

### Request body

```json
{
  "taskId": "674a1b2c3d4e5f6789012345"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `taskId` | string | yes | Task `id` from `GET /tasks` |

### Success response `200`

```json
{
  "interviewId": "674a1b2c3d4e5f678901abcd",
  "question": "You marked 'Build a simple landing page' as done. What HTML elements did you use and why?"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `interviewId` | string | Use in `/interview/respond` |
| `question` | string | First coach question to show user |

### Error responses

`400` — invalid taskId:
```json
{ "error": "Invalid taskId" }
```

`404` — task not found:
```json
{ "error": "Task not found" }
```

`500`:
```json
{ "error": "Failed to start interview" }
```

---

## 6. POST `/interview/respond`

User answers an interview question. May return another question or final verdict.

### Request body

```json
{
  "interviewId": "674a1b2c3d4e5f678901abcd",
  "answer": "I used semantic HTML with header, nav, main, and footer. I chose them for accessibility and SEO."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `interviewId` | string | yes | From `/interview/start` |
| `answer` | string | yes | User's text answer |

### Success response — more questions `200`

```json
{
  "complete": false,
  "question": "Can you share one specific challenge you hit while building the layout?"
}
```

**Frontend action:** Show the new `question`, collect answer, call `/interview/respond` again.

### Success response — interview finished `200`

```json
{
  "complete": true,
  "status": "verified",
  "confidence": 92,
  "feedback": "Solid evidence of hands-on work. Keep this momentum."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `complete` | boolean | `true` when interview is done |
| `status` | string | `"verified"` \| `"partial"` \| `"failed"` |
| `confidence` | number | 0–100 |
| `feedback` | string | One-sentence coach note |

### Status → task update

| `status` | Task becomes |
|----------|--------------|
| `verified` | `completed` |
| `partial` | `pending` |
| `failed` | `missed` |

### Error responses

`400`:
```json
{ "error": "Invalid interviewId" }
```

`404`:
```json
{ "error": "Interview not found or already completed" }
```

---

## 7. POST `/checkin`

Single-shot verification (no multi-turn interview). Same verdict fields as interview finish.

Use when you want **one text box** instead of the interview flow.

### Request body

```json
{
  "taskId": "674a1b2c3d4e5f6789012345",
  "answer": "I finished the landing page today. Used flexbox for the hero section and deployed it on Netlify."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `taskId` | string | yes | Task `id` from `GET /tasks` |
| `answer` | string | yes | User proof / description |

### Success response `200`

```json
{
  "status": "verified",
  "confidence": 92
}
```

```json
{
  "status": "partial",
  "confidence": 55
}
```

```json
{
  "status": "failed",
  "confidence": 20
}
```

| Field | Type | Values |
|-------|------|--------|
| `status` | string | `"verified"` \| `"partial"` \| `"failed"` |
| `confidence` | number | 0–100 |

### Error responses

`400`:
```json
{ "error": "Invalid taskId" }
```

`404`:
```json
{ "error": "Task not found" }
```

---

## 8. POST `/recalculate`

Update timeline and stats after a day ends. Pass task IDs completed or missed today.

### Request body

```json
{
  "completedTasks": [
    "674a1b2c3d4e5f6789012346"
  ],
  "missedTasks": [
    "674a1b2c3d4e5f6789012347"
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `completedTasks` | string[] | no | Task IDs completed today (default `[]`) |
| `missedTasks` | string[] | no | Task IDs missed today (default `[]`) |

### Success response `200`

**When tasks were missed:**

```json
{
  "delayDays": 2,
  "newETA": "2026-10-15",
  "confidence": 84,
  "message": "Skipping today's task delayed goal by 2 days"
}
```

**When only completions:**

```json
{
  "delayDays": 0,
  "newETA": "2026-10-13",
  "confidence": 88,
  "message": "Great work! Completed 2 tasks"
}
```

**No active goal:**

```json
{
  "delayDays": 0,
  "newETA": "2026-06-27",
  "confidence": 0,
  "message": "No active goal found"
}
```

### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `delayDays` | number | **Total** accumulated delay (not just today) |
| `newETA` | string | Updated target date `YYYY-MM-DD` |
| `confidence` | number | Updated confidence 0–100 |
| `message` | string | Human-readable summary |

### Backend logic (for UI copy)

- Each missed task today adds **2 days** delay
- Missed tasks reduce confidence by **4** each
- Completed tasks increase confidence by **2** each
- Streak increments if completions > 0 and misses = 0; resets to 0 on any miss

### Error response `500`

```json
{
  "error": "Failed to recalculate"
}
```

---

## TypeScript types (copy-paste for frontend)

```typescript
// --- Shared ---
type TaskStatus = 'pending' | 'completed' | 'missed';
type VerificationStatus = 'verified' | 'partial' | 'failed';

interface RoadmapMonth {
  title: string;
  weeks: Array<{
    week: number;
    tasks: string[];
  }>;
}

interface Roadmap {
  months: RoadmapMonth[];
}

interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate: string; // YYYY-MM-DD
  monthIndex: number;
  weekIndex: number;
}

// --- POST /generate ---
interface GenerateRequest {
  goal: string;
  timeline: string;
  hoursPerDay: number;
  difficulty: string;
}

interface GenerateResponse {
  roadmap: Roadmap;
}

// --- POST /goals ---
interface SaveGoalRequest {
  goal: string;
  roadmap: Roadmap;
}

interface SaveGoalResponse {
  success: true;
}

// --- GET /dashboard ---
interface DashboardResponse {
  goal: string;
  progress: number;
  confidence: number;
  delayDays: number;
  tasksCompleted: number;
  tasksMissed: number;
  streak: number;
}

// --- GET /tasks ---
interface TasksResponse {
  tasks: Task[];
}

// --- POST /interview/start ---
interface InterviewStartRequest {
  taskId: string;
}

interface InterviewStartResponse {
  interviewId: string;
  question: string;
}

// --- POST /interview/respond ---
interface InterviewRespondRequest {
  interviewId: string;
  answer: string;
}

type InterviewRespondResponse =
  | { complete: false; question: string }
  | {
      complete: true;
      status: VerificationStatus;
      confidence: number;
      feedback: string;
    };

// --- POST /checkin ---
interface CheckinRequest {
  taskId: string;
  answer: string;
}

interface CheckinResponse {
  status: VerificationStatus;
  confidence: number;
}

// --- POST /recalculate ---
interface RecalculateRequest {
  completedTasks?: string[];
  missedTasks?: string[];
}

interface RecalculateResponse {
  delayDays: number;
  newETA: string;
  confidence: number;
  message: string;
}

// --- Error ---
interface ApiError {
  error: string;
}
```

---

## Fetch examples

```javascript
const API = 'http://localhost:3000/api';

// Generate roadmap
const { roadmap } = await fetch(`${API}/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    goal: 'Learn React',
    timeline: '3 months',
    hoursPerDay: 2,
    difficulty: 'medium',
  }),
}).then((r) => r.json());

// Save goal
await fetch(`${API}/goals`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ goal: 'Learn React', roadmap }),
});

// Dashboard + tasks
const dashboard = await fetch(`${API}/dashboard`).then((r) => r.json());
const { tasks } = await fetch(`${API}/tasks`).then((r) => r.json());

// Interview flow after checkmark
const { interviewId, question } = await fetch(`${API}/interview/start`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ taskId: tasks[0].id }),
}).then((r) => r.json());

let result = await fetch(`${API}/interview/respond`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ interviewId, answer: 'My answer here...' }),
}).then((r) => r.json());

while (!result.complete) {
  result = await fetch(`${API}/interview/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interviewId, answer: 'Follow-up answer...' }),
  }).then((r) => r.json());
}
// result.status, result.confidence, result.feedback

// End of day recalculate
await fetch(`${API}/recalculate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    completedTasks: ['674a1b2c3d4e5f6789012346'],
    missedTasks: [],
  }),
});
```

---

## UI screen → API mapping

| Screen | APIs to call |
|--------|--------------|
| Goal setup / onboarding | `POST /generate` → `POST /goals` |
| Home / dashboard | `GET /dashboard` |
| Task list / calendar | `GET /tasks` |
| Task checkmark → verify | `POST /interview/start` → `POST /interview/respond` (loop) |
| Quick verify modal | `POST /checkin` |
| Daily wrap-up | `POST /recalculate` then refresh `GET /dashboard` |

---

## Notes for AI-assisted frontend builds

1. **Do not rename response fields** — frontend contract is fixed (`delayDays`, `tasksCompleted`, `newETA`, etc.).
2. **Use `id` from tasks** — not `_id`; backend maps Mongo `_id` → `id` string.
3. **Interview vs checkin** — prefer interview after checkmarks; checkin is simpler fallback.
4. **Refresh after verify** — call `GET /dashboard` and `GET /tasks` after interview/checkin completes.
5. **CORS enabled** — frontend can run on any port (e.g. `localhost:5173)`.
6. **OpenAI required** — `/generate`, `/checkin`, and interview endpoints need `OPENAI_API_KEY` on server.

---

# NEW FEATURES (added below)

> All endpoints below are **new**. Existing endpoints above are unchanged.

## New endpoints overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/goal` | Full active goal + saved roadmap |
| GET | `/today` | Today's + overdue pending tasks |
| GET | `/summary` | Extended stats (days left, onTrack) |
| GET | `/checkins` | Recent verification history |
| POST | `/coach/daily` | AI daily coach briefing |
| POST | `/tasks/skip` | Skip a task (adds delay) |

---

## NEW — GET `/goal`

Returns the active goal with the full saved roadmap (for roadmap/timeline screens).

### Request

No body.

### Success response `200`

```json
{
  "goal": "Become a full-stack developer",
  "roadmap": {
    "months": [
      {
        "title": "Month 1: HTML & CSS",
        "weeks": [
          {
            "week": 1,
            "tasks": ["Complete HTML basics tutorial"]
          }
        ]
      }
    ]
  },
  "targetDate": "2026-12-15",
  "progress": 35,
  "confidence": 84,
  "delayDays": 2,
  "streak": 3,
  "createdAt": "2026-06-27T08:00:00.000Z"
}
```

### Empty state (no goal)

```json
{
  "goal": "",
  "roadmap": { "months": [] },
  "targetDate": "",
  "progress": 0,
  "confidence": 0,
  "delayDays": 0,
  "streak": 0,
  "createdAt": null
}
```

---

## NEW — GET `/today`

Tasks due **today** plus **overdue** pending tasks. Perfect for a "Today" home widget.

### Request

No body.

### Success response `200`

```json
{
  "date": "2026-06-27",
  "tasks": [
    {
      "id": "674a1b2c3d4e5f6789012345",
      "title": "Practice CSS flexbox for 30 minutes",
      "status": "pending",
      "dueDate": "2026-06-25",
      "monthIndex": 1,
      "weekIndex": 1
    },
    {
      "id": "674a1b2c3d4e5f6789012346",
      "title": "Build a landing page",
      "status": "pending",
      "dueDate": "2026-06-27",
      "monthIndex": 1,
      "weekIndex": 1
    }
  ],
  "overdueCount": 1,
  "dueTodayCount": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | Today `YYYY-MM-DD` |
| `tasks` | array | Overdue + due today (pending only) |
| `overdueCount` | number | Past-due pending tasks |
| `dueTodayCount` | number | Tasks due today |

---

## NEW — GET `/summary`

Extended dashboard stats for progress cards and "on track" indicators.

### Request

No body.

### Success response `200`

```json
{
  "goal": "Become a full-stack developer",
  "targetDate": "2026-12-15",
  "daysRemaining": 171,
  "onTrack": true,
  "progress": 35,
  "confidence": 84,
  "delayDays": 2,
  "streak": 3,
  "tasksTotal": 20,
  "tasksPending": 12,
  "tasksToday": 2,
  "tasksOverdue": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `daysRemaining` | number | Days until `targetDate` |
| `onTrack` | boolean | `true` if confidence ≥ 70, delay ≤ 5, not falling behind |
| `tasksTotal` | number | All tasks |
| `tasksPending` | number | Not done yet |
| `tasksToday` | number | Due today |
| `tasksOverdue` | number | Past due, still pending |

---

## NEW — GET `/checkins`

Recent task verification history (interview + checkin).

### Request

Query param (optional):

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `10` | Max results (max 50) |

Example: `GET /api/checkins?limit=5`

### Success response `200`

```json
{
  "checkins": [
    {
      "id": "674a1b2c3d4e5f678901abcd",
      "taskId": "674a1b2c3d4e5f6789012345",
      "taskTitle": "Build a landing page",
      "status": "verified",
      "confidence": 92,
      "source": "interview",
      "createdAt": "2026-06-27T10:30:00.000Z"
    },
    {
      "id": "674a1b2c3d4e5f678901abce",
      "taskId": "674a1b2c3d4e5f6789012346",
      "taskTitle": "Complete HTML tutorial",
      "status": "failed",
      "confidence": 25,
      "source": "checkin",
      "createdAt": "2026-06-26T18:00:00.000Z"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `source` | string | `"interview"` or `"checkin"` |
| `status` | string | `"verified"` \| `"partial"` \| `"failed"` |

---

## NEW — POST `/coach/daily`

AI-generated daily coach message based on current stats. Great for a home screen banner.

### Request body

No body required (empty `{}` is fine).

### Success response `200`

```json
{
  "message": "You're on a 3-day streak with 35% progress. One overdue task is pulling your timeline — knock it out today.",
  "tone": "warning",
  "tip": "Start with the overdue CSS flexbox task and verify it with the coach interview."
}
```

| Field | Type | Values |
|-------|------|--------|
| `message` | string | 2–3 sentence daily briefing |
| `tone` | string | `"motivating"` \| `"warning"` \| `"celebration"` |
| `tip` | string | One actionable tip for today |

### Error response `500`

```json
{ "error": "Failed to generate coach message" }
```

---

## NEW — POST `/tasks/skip`

Skip a pending task. Marks it missed and recalculates delay (same as missing in `/recalculate`).

### Request body

```json
{
  "taskId": "674a1b2c3d4e5f6789012345"
}
```

### Success response `200`

```json
{
  "success": true,
  "delayDays": 4,
  "newETA": "2026-12-17",
  "confidence": 80,
  "message": "Task skipped. Skipping today's task delayed goal by 2 days"
}
```

### Error responses

`400` — invalid or already completed:
```json
{ "error": "Cannot skip a completed task" }
```

`404`:
```json
{ "error": "Task not found" }
```

---

## NEW — TypeScript types (copy-paste)

```typescript
// GET /goal
interface GoalDetailsResponse {
  goal: string;
  roadmap: Roadmap;
  targetDate: string;
  progress: number;
  confidence: number;
  delayDays: number;
  streak: number;
  createdAt: string | null;
}

// GET /today
interface TodayResponse {
  date: string;
  tasks: Task[];
  overdueCount: number;
  dueTodayCount: number;
}

// GET /summary
interface SummaryResponse {
  goal: string;
  targetDate: string;
  daysRemaining: number;
  onTrack: boolean;
  progress: number;
  confidence: number;
  delayDays: number;
  streak: number;
  tasksTotal: number;
  tasksPending: number;
  tasksToday: number;
  tasksOverdue: number;
}

// GET /checkins
interface CheckinRecord {
  id: string;
  taskId: string;
  taskTitle: string;
  status: VerificationStatus;
  confidence: number;
  source: 'interview' | 'checkin';
  createdAt: string | null;
}

interface CheckinsResponse {
  checkins: CheckinRecord[];
}

// POST /coach/daily
interface CoachDailyResponse {
  message: string;
  tone: 'motivating' | 'warning' | 'celebration';
  tip: string;
}

// POST /tasks/skip
interface SkipTaskRequest {
  taskId: string;
}

interface SkipTaskResponse {
  success: true;
  delayDays: number;
  newETA: string;
  confidence: number;
  message: string;
}
```

---

## NEW — Updated UI screen mapping

| Screen | APIs to call |
|--------|--------------|
| Roadmap / timeline view | `GET /goal` |
| Today widget | `GET /today` |
| Progress cards / on-track badge | `GET /summary` |
| Activity / history feed | `GET /checkins` |
| Daily coach banner | `POST /coach/daily` |
| Skip task button | `POST /tasks/skip` → refresh `GET /dashboard` |

---

## NEW — Fetch examples

```javascript
const API = 'https://YOUR-NGROK-URL.ngrok-free.dev/api';

// Full goal + roadmap
const goalDetails = await fetch(`${API}/goal`).then((r) => r.json());

// Today's tasks
const today = await fetch(`${API}/today`).then((r) => r.json());

// Extended summary
const summary = await fetch(`${API}/summary`).then((r) => r.json());

// Checkin history
const history = await fetch(`${API}/checkins?limit=5`).then((r) => r.json());

// AI daily coach
const coach = await fetch(`${API}/coach/daily`, { method: 'POST' }).then((r) => r.json());

// Skip a task
await fetch(`${API}/tasks/skip`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ taskId: '674a1b2c3d4e5f6789012345' }),
});
```

---

# NEW — ROLES & MENTORSHIP (added below)

> Two user roles: **goal_creator** (default) and **doubt_solver**.
> Goal creators buy mentorship hours when stuck, then book a meeting with a doubt solver.

## Roles overview

| Role | Value | Default | Can do |
|------|-------|---------|--------|
| Goal Creator | `goal_creator` | ✅ yes | Goals, tasks, buy mentorship, book meetings |
| Doubt Solver | `doubt_solver` | no | View & complete booked meetings |

## New endpoints overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/role` | Current role only |
| POST | `/role` | Switch role (simple demo flow) |
| GET | `/user/profile` | Current user role + mentorship balance |
| POST | `/user/role` | Switch role (demo toggle) |
| GET | `/mentorship/packages` | Hour packages to buy |
| POST | `/mentorship/buy` | Purchase mentorship hours |
| GET | `/mentorship/balance` | Remaining hours + purchase history |
| GET | `/doubt-solvers` | List available mentors |
| POST | `/meetings` | Book meeting with a doubt solver |
| GET | `/meetings` | List meetings (by role) |
| POST | `/meetings/complete` | Mark meeting done |

---

## NEW — User flow (doubt → mentorship → meeting)

```
1. User is goal_creator (default)
2. User gets stuck on a task → has a doubt
3. GET /mentorship/packages  → show pricing
4. POST /mentorship/buy      → buy hours (e.g. 2 hours)
5. GET /doubt-solvers        → pick a mentor
6. POST /meetings            → book meeting with doubt + solver
7. GET /meetings             → see meeting link + schedule
8. POST /meetings/complete   → mark session done
```

---

## NEW — GET `/user/profile`

### Success response `200`

```json
{
  "id": "674a1b2c3d4e5f6789012345",
  "role": "goal_creator",
  "name": "Goal Creator",
  "mentorshipHoursRemaining": 2
}
```

| Field | Type | Description |
|-------|------|-------------|
| `role` | string | `"goal_creator"` or `"doubt_solver"` |
| `mentorshipHoursRemaining` | number | Hours left to book meetings |

---

## NEW — POST `/user/role`

Switch between roles (useful for demo / testing both UIs).

### Request body

```json
{
  "role": "goal_creator"
}
```

or

```json
{
  "role": "doubt_solver"
}
```

### Success response `200`

```json
{
  "success": true,
  "role": "goal_creator",
  "message": "Switched to Goal Creator mode"
}
```

### Error `400`

```json
{ "error": "Invalid role. Use goal_creator or doubt_solver" }
```

## NEW — GET `/role`

Tiny role-only endpoint for hackathon flows.

### Success response `200`

```json
{
  "role": "goal_creator"
}
```

---

## NEW — GET `/mentorship/packages`

List hour packages for buying mentorship.

### Success response `200`

```json
{
  "packages": [
    { "id": "pkg_1h", "hours": 1, "price": 10, "label": "1 Hour Mentorship" },
    { "id": "pkg_2h", "hours": 2, "price": 18, "label": "2 Hours Mentorship" },
    { "id": "pkg_5h", "hours": 5, "price": 40, "label": "5 Hours Mentorship" }
  ],
  "pricePerHour": 10
}
```

---

## NEW — POST `/mentorship/buy`

Purchase mentorship hours. **Only goal_creator** can buy.

### Request body (option A — package)

```json
{
  "packageId": "pkg_2h"
}
```

### Request body (option B — custom hours)

```json
{
  "hours": 3
}
```

Custom hours billed at `pricePerHour` ($10/hr).

### Success response `200`

```json
{
  "success": true,
  "hoursPurchased": 2,
  "totalPrice": 18,
  "hoursRemaining": 2,
  "message": "Purchased 2 hours of mentorship"
}
```

### Error `403`

```json
{ "error": "Only goal creators can buy mentorship hours" }
```

---

## NEW — GET `/mentorship/balance`

### Success response `200`

```json
{
  "hoursRemaining": 2,
  "totalPurchased": 5,
  "purchases": [
    {
      "id": "674a1b2c3d4e5f678901abcd",
      "hours": 2,
      "totalPrice": 18,
      "purchasedAt": "2026-06-27T10:00:00.000Z"
    }
  ]
}
```

---

## NEW — GET `/doubt-solvers`

List available doubt solvers (seeded mentors).

### Success response `200`

```json
{
  "solvers": [
    {
      "id": "674a1b2c3d4e5f678901aaaa",
      "name": "Alex Mentor",
      "expertise": ["JavaScript", "React", "Node.js"],
      "ratePerHour": 10,
      "rating": 4.9,
      "bio": "Full-stack dev with 8 years experience."
    },
    {
      "id": "674a1b2c3d4e5f678901aaab",
      "name": "Priya Sharma",
      "expertise": ["Python", "Data Science", "ML basics"],
      "ratePerHour": 12,
      "rating": 4.8,
      "bio": "Data scientist who breaks down complex topics."
    }
  ]
}
```

---

## NEW — POST `/meetings`

Book a mentorship meeting when user has a doubt. Deducts hours from balance.

**Only goal_creator** can book.

### Request body

```json
{
  "solverId": "674a1b2c3d4e5f678901aaaa",
  "doubt": "I'm stuck on React useEffect — my API call runs infinitely",
  "scheduledAt": "2026-06-28T14:00:00.000Z",
  "durationHours": 1
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `solverId` | string | yes | From `GET /doubt-solvers` |
| `doubt` | string | yes | User's question / what they're stuck on |
| `scheduledAt` | string | no | ISO date (defaults to 1 hour from now) |
| `durationHours` | number | no | Default `1` |

### Success response `200`

```json
{
  "success": true,
  "meeting": {
    "id": "674a1b2c3d4e5f678901bbbb",
    "solverId": "674a1b2c3d4e5f678901aaaa",
    "solverName": "Alex Mentor",
    "doubt": "I'm stuck on React useEffect — my API call runs infinitely",
    "scheduledAt": "2026-06-28T14:00:00.000Z",
    "durationHours": 1,
    "hoursCost": 1,
    "status": "scheduled",
    "meetingLink": "https://meet.goalos.app/room/674a1b2c3d4e5f678901bbbb"
  },
  "hoursRemaining": 1,
  "message": "Meeting booked with Alex Mentor"
}
```

### Errors

`402` — not enough hours:
```json
{ "error": "Not enough mentorship hours. Need 1, have 0" }
```

`403` — wrong role:
```json
{ "error": "Only goal creators can book mentorship meetings" }
```

---

## NEW — GET `/meetings`

Returns meetings based on current role:
- **goal_creator** → meetings they booked
- **doubt_solver** → meetings assigned to them

### Success response `200`

```json
{
  "role": "goal_creator",
  "meetings": [
    {
      "id": "674a1b2c3d4e5f678901bbbb",
      "creatorId": "674a1b2c3d4e5f6789012345",
      "creatorName": "Goal Creator",
      "solverId": "674a1b2c3d4e5f678901aaaa",
      "solverName": "Alex Mentor",
      "doubt": "I'm stuck on React useEffect",
      "scheduledAt": "2026-06-28T14:00:00.000Z",
      "durationHours": 1,
      "hoursCost": 1,
      "status": "scheduled",
      "meetingLink": "https://meet.goalos.app/room/674a1b2c3d4e5f678901bbbb"
    }
  ]
}
```

Meeting `status`: `"scheduled"` | `"completed"` | `"cancelled"`

---

## NEW — POST `/meetings/complete`

Mark a meeting as completed.

### Request body

```json
{
  "meetingId": "674a1b2c3d4e5f678901bbbb"
}
```

### Success response `200`

```json
{
  "success": true,
  "meetingId": "674a1b2c3d4e5f678901bbbb",
  "status": "completed",
  "message": "Meeting marked as completed"
}
```

---

## NEW — TypeScript types (roles)

```typescript
type UserRole = 'goal_creator' | 'doubt_solver';

interface UserProfileResponse {
  id: string;
  role: UserRole;
  name: string;
  mentorshipHoursRemaining: number;
}

interface SwitchRoleRequest {
  role: UserRole;
}

interface MentorshipPackage {
  id: string;
  hours: number;
  price: number;
  label: string;
}

interface BuyMentorshipRequest {
  hours?: number;
  packageId?: string;
}

interface BuyMentorshipResponse {
  success: true;
  hoursPurchased: number;
  totalPrice: number;
  hoursRemaining: number;
  message: string;
}

interface DoubtSolver {
  id: string;
  name: string;
  expertise: string[];
  ratePerHour: number;
  rating: number;
  bio: string;
}

interface CreateMeetingRequest {
  solverId: string;
  doubt: string;
  scheduledAt?: string;
  durationHours?: number;
}

interface Meeting {
  id: string;
  creatorId: string;
  creatorName: string;
  solverId: string;
  solverName: string;
  doubt: string;
  scheduledAt: string;
  durationHours: number;
  hoursCost: number;
  status: 'scheduled' | 'completed' | 'cancelled';
  meetingLink: string;
}
```

---

## NEW — Full doubt flow fetch example

```javascript
const API = 'https://YOUR-NGROK-URL.ngrok-free.dev/api';

// 1. Check role (default: goal_creator)
const profile = await fetch(`${API}/user/profile`).then((r) => r.json());

// 2. User has a doubt — buy mentorship
await fetch(`${API}/mentorship/buy`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ packageId: 'pkg_2h' }),
}).then((r) => r.json());

// 3. Pick a doubt solver
const { solvers } = await fetch(`${API}/doubt-solvers`).then((r) => r.json());

// 4. Book meeting
const booking = await fetch(`${API}/meetings`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    solverId: solvers[0].id,
    doubt: 'How do I structure my React project for scalability?',
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    durationHours: 1,
  }),
}).then((r) => r.json());

// booking.meeting.meetingLink → show join button

// 5. Switch to doubt solver view (demo)
await fetch(`${API}/user/role`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ role: 'doubt_solver' }),
});

// 6. Solver sees their meetings
const solverMeetings = await fetch(`${API}/meetings`).then((r) => r.json());
```

---

## NEW — UI screen mapping (roles)

| Screen | APIs |
|--------|------|
| Profile / role badge | `GET /user/profile` |
| Role toggle (demo) | `POST /user/role` |
| "I'm stuck" / buy mentorship | `GET /mentorship/packages` → `POST /mentorship/buy` |
| Mentorship wallet | `GET /mentorship/balance` |
| Pick a mentor | `GET /doubt-solvers` |
| Book session form | `POST /meetings` |
| My meetings / calendar | `GET /meetings` |
| Mark session done | `POST /meetings/complete` |

---

## Setup — seed doubt solvers

Run once to create default goal creator + 3 doubt solvers:

```bash
npm run db:init
```
