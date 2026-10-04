# Section 3 — API Contracts

This section defines every HTTP route in the plan: who can call it, the request, the response, the error codes, and which database function it calls. It is written against the real schema and functions in `001_initial.sql`, so the coding session can build each route straight from here.

It does **not** cover pages, components, or the grading prompt (those are later sections). It covers three things the pages depend on: the routes, the Realtime Broadcast messages, and the behaviours the worker must provide for the API to work.

> **Not executed.** Like Section 1, this was checked by reading, not by running. Items marked *(verify)* depend on library or platform details that change (Supabase Realtime REST shape, Vercel function limits, LiveKit SDK calls). Check them when you build.

---

## 0. What I found while writing this (read first)

These are gaps between the plan and the schema. Each one is fixed in the contracts below; the edit list in section 8 says where to change the plan.

| # | Gap | Fix in this section |
|---|---|---|
| 1 | **Snapshot upload cannot work as planned (3B.3).** Candidates have no Supabase access (anon key revoked, `snapshots` bucket private with an admin-only read policy), so "upload to Storage" from the browser would be rejected | The snapshot travels inside `POST /api/events` as base64; the server uploads it with the service role |
| 2 | **Revision counter resets on reconnect.** `save_answer` only accepts a *higher* revision. A candidate who reconnects on another tablet, or after IndexedDB was cleared, restarts at 1 and every save is silently `stale_revision`, so their typing is lost without any error | The paper API returns each saved answer's `revision`; the client continues from `max(server, local) + 1`. The answers API returns `server_revision` on a stale result so the client can recover |
| 3 | **`submit_attempt()` allows submitting from the waiting room.** The DB function accepts `not_started` and `acknowledged` (the scheduler needs that). A candidate could end their own exam before it starts | The candidate submit route requires `in_progress` |
| 4 | **`advance_position()` does not save the answer on the last question** (it returns `last_question` first). Typing on the last question then pressing Next would drop it | The Next route saves the answer itself when the result is `last_question` |
| 5 | **Shuffled option labels.** `mcq_options.label` is fixed (a, b, c, d) but the option order is shuffled per candidate, so the screen would read "c, a, d, b" | The paper API does not return `label`; the UI letters options A, B, C… by position |
| 6 | **Nothing writes `DISCONNECTED` events.** Heartbeat only updates `last_seen_at`; "closed the browser" never reaches the log | Worker writes `DISCONNECTED` after 30 s of silence; the heartbeat route writes `RECONNECTED` with the gap (section 7) |
| 7 | **Gemini keys on Vercel.** The health route (5C.2) would need the keys to list models, but Section 1 keeps key text only in worker env vars | The worker runs the key check and writes `api_key_state`; the health route only reads the database |
| 8 | **`attempt_progress` cannot be Realtime** (views are not in the publication), so "Q 7/20" and "14 answered" would not update live | Admin grid polls the view every 10 s (section 5) |
| 9 | **Unassigning a started candidate leaves an orphan attempt.** The trigger only deletes `not_started` attempts, but the `exam_candidates` row is removed anyway | The unassign route refuses candidates whose attempt has started |
| 10 | **Grading start has gaps:** nothing checks the answer keys are complete, and nothing says who scores MCQs | The grade route checks keys, scores MCQs and auto-zeroes blanks in code, then creates the Gemini jobs |
| 11 | **Two admins extending at once lose an update** (read, add, write) | Compare-and-set on `ends_at` / `extra_minutes` with retry |
| 12 | **Client-supplied `counts` flag** on events is trusted by the plan | The server decides `counts` |
| 13 | **CSV import time:** hashing 300 NICs with argon2 in one Vercel request risks the function time limit | Cap 100 rows per request; the client sends batches |
| 14 | **"Acknowledge" is split across two screens** (2A.5 confirm and 2B.6 rules) but there is one API | One call at the end of the rules screen; `acknowledged` means identity confirmed **and** rules accepted |
| 15 | **`snapshot_retention` is still undecided** but the rules screen and purge job need a number | `SNAPSHOT_RETENTION_DAYS`, default **14** *(decided: 14 days)* |

---

## 1. Conventions

### 1.1 Basics
- Same origin only: `/api/...`. JSON in, JSON out, UTF-8. No CORS headers.
- Every response carries `Cache-Control: no-store`.
- IDs are UUIDs. All timestamps in responses are ISO 8601 UTC (`2026-10-05T04:30:00.000Z`).
- Timestamps in **requests** must include an offset or `Z` (the admin form converts Colombo time to UTC before sending). A timestamp with no offset is rejected with `validation_failed`.
- Validate every request body with `zod`. Unknown keys are stripped, not rejected.
- Success: `200` with a JSON object (no wrapper), `201` for creates, `202` when work continues in the background.
- Never log request bodies (0.9). Log request id, route, status, duration, and the candidate or admin id only.

### 1.1a Origin checks

Browser `POST`, `PUT`, `PATCH`, and `DELETE` handlers call the shared `assertSameOrigin(request)` helper before reading the body or doing candidate/admin authentication work. The `Origin` header must match the request's own origin or an exact origin in the optional comma-separated `ALLOWED_ORIGINS` environment variable. A missing `Origin` is accepted only when `Sec-Fetch-Site: same-origin`; missing without that signal, malformed, and mismatched origins return the standard `403 forbidden` JSON response. `GET`, `HEAD`, and `OPTIONS` are unaffected. Header values are never logged. LiveKit webhooks and worker-to-server routes do not use this browser CSRF check; they authenticate with their own secrets.

### 1.2 Error shape
```json
{ "error": { "code": "exam_closed", "message": "The exam has ended.", "details": null } }
```
`code` is stable and snake_case (the client switches on it). `message` is for humans. `details` is optional. Every response includes an `X-Request-Id` header, and the same id is in the log line.

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `validation_failed` | Bad body. `details` = list of `{ path, message }` |
| 401 | `unauthenticated` | No valid cookie or login |
| 401 | `session_revoked` | Candidate session was revoked (logged in elsewhere, kicked). The client stops the exam and shows the sign-in screen |
| 403 | `forbidden` | Logged in but not allowed (not an admin, or not a super admin) |
| 404 | `not_found` | Unknown id |
| 409 | route-specific | State conflict (see each route) |
| 413 | `payload_too_large` | Body over the route's limit |
| 429 | `rate_limited` | `details.retry_after_s` |
| 500 | `internal_error` | Generic message only. Details go to the log |
| 503 | `service_unavailable` | Dependency (database, LiveKit) down |

### 1.3 Auth kinds

| Kind | How it works |
|---|---|
| `public` | No login |
| `candidate` | `iron-session` cookie `exam_session` holding only `{ sid }`. `requireCandidate()` loads the `sessions` row and rejects if it is missing or `revoked_at` is set (`session_revoked`). It then loads the attempt and returns `{ sessionId, candidateId, attemptId, examId }`. Runs on **every** candidate call (2A.4). Cookie: `httpOnly`, `secure` in production, `sameSite: 'lax'`, `path: '/'`, `maxAge` = exam duration + 2 h |
| `admin` | Supabase Auth cookies via `@supabase/ssr`. `requireAdmin()` calls `supabase.auth.getUser()` (verified by the Auth server, not `getSession()`), then loads the caller's `admin_profiles` row. No row = `403 forbidden`. Called **inside every handler** (1B.5) |
| `super_admin` | `requireSuperAdmin()`: as `admin`, and `role = 'super_admin'` |

All handlers use the **service-role** Supabase client after the auth check. The candidate and admin browsers never write to Supabase directly. (Admins do read some tables directly, see section 5.)

The admin layout's authorization check runs only on full loads; client-side navigation can reuse the mounted layout, so it is not an authorization boundary for page data requests or route handlers. Every admin page's own data-access function and every `/api/admin/*` handler must call `requireAdmin()` or `requireSuperAdmin()` itself before loading or changing data. Do not rely on the layout or Proxy for authorization.

### 1.4 Limits and platform
- Body limits: 64 KB by default. `POST /api/events` 200 KB. Question routes 200 KB. Candidate import 500 KB. `POST /api/admin/question-images` accepts one multipart upload whose decoded file is at most **4 MiB**; reject it before buffering when `Content-Length` exceeds **4 MiB**. Multipart overhead therefore makes the practical maximum source file slightly smaller than 4 MiB. This stays below Vercel Functions' 4.5 MB request-payload limit.
- `export const maxDuration = 30` on the import, grade, force-end and snapshot-purge routes *(verify the Hobby limit)*.
- Rate limits: login (1.5) and events (30 per minute per attempt). Nothing else needs one at 23 candidates.
- Client IP for `login_attempts` and `sessions`: first value of `x-forwarded-for`.

### 1.5 Idempotency
Safe to retry with the same body: `/api/answers` (revision rule), `/api/exam/next` (`expected_position`), `/api/exam/submit`, `/api/auth/acknowledge`, `/api/heartbeat`, all `GET`s, `start`, `force-end`, `force-submit`, `resolve`. Not idempotent (each call does something new): `broadcast`, `extend`, `override`, `regrade`, `grade`.

### 1.6 Admin audit log
Every admin route that changes something writes one `admin_actions` row (`admin_id`, `action`, `target`, `detail`). Action names: `candidate_create`, `candidate_update`, `candidate_delete`, `candidate_import`, `candidate_unlock`, `exam_create`, `exam_update`, `exam_delete`, `exam_assign`, `exam_unassign`, `question_save`, `question_delete`, `question_reorder`, `answer_key_save`, `start`, `extend`, `force_end`, `force_submit`, `kick`, `broadcast`, `grade_start`, `grade_resume`, `override`, `regrade`, `regrade_question`, `alert_resolve`, `snapshot_purge`, `event_dismiss`, `event_restore`.

---

## 2. Route index

New or changed files compared with the plan are marked **NEW**.

| # | Method and path | Auth | Plan task | Calls |
|---|---|---|---|---|
| 1 | `GET /api/health` | public | 0.10 | `select` ping |
| 2 | `GET /api/time` | public | 2B.4 | none |
| 3 | `POST /api/auth/login` | public | 2A.2 | tables; creates session |
| 4 | `GET /api/auth/me` **NEW (2A.7)** | candidate | | tables |
| 5 | `POST /api/auth/acknowledge` | candidate | 2A.6 | `attempts` update |
| 6 | `POST /api/auth/logout` **NEW (2A.8)** | candidate | | `sessions` update |
| 7 | `GET /api/exam/state` | candidate | 2B.5 | tables |
| 8 | `GET /api/exam/paper` | candidate | 2C.1 | `rpc generate_paper` |
| 9 | `POST /api/answers` | candidate | 2E.4 | `rpc save_answer` |
| 10 | `POST /api/exam/next` | candidate | 2F.6 | `rpc advance_position` |
| 11 | `POST /api/exam/submit` | candidate | 2F.1 | `rpc save_answer`, `rpc submit_attempt` |
| 12 | `POST /api/heartbeat` | candidate | 3B.4 | `attempts` update |
| 13 | `POST /api/events` | candidate | 3B.1, 3B.3 | `violation_events` insert, Storage upload |
| 14 | `POST /api/livekit/token` | candidate or admin | 4A.3 | LiveKit SDK |
| 15 | `GET, POST /api/admin/candidates` | admin | 1C.5 | tables |
| 16 | `PATCH, DELETE /api/admin/candidates/[id]` **NEW** | admin | 1C.5 | tables |
| 17 | `POST /api/admin/candidates/import` | admin | 1C.4 | tables |
| 18 | `POST /api/admin/candidates/[id]/unlock` **NEW (optional)** | admin | | `login_attempts` delete |
| 19 | `GET, POST /api/admin/exams` | admin | 1D.4 | tables |
| 20 | `GET, PATCH, DELETE /api/admin/exams/[id]` **NEW** | admin | 1D.4 | tables |
| 21 | `GET, POST, DELETE /api/admin/exams/[id]/candidates` **NEW** | admin | 1D.3 | `exam_candidates` |
| 22 | `GET, POST /api/admin/questions` | admin | 1E.7 | tables |
| 23 | `PATCH, DELETE /api/admin/questions/[id]` **NEW** | admin | 1E.7 | tables |
| 24 | `POST /api/admin/questions/reorder` **NEW** | admin | 1E.6, 1E.7 | `questions` update |
| 25 | `GET, PUT /api/admin/answer-keys` | admin | 1E.7 | `answer_keys` |
| 26 | `POST /api/admin/exams/[id]/start` | admin | 5A.1 | `exams` update |
| 27 | `POST /api/admin/exams/[id]/extend` | admin | 5A.2 | `exams` / `attempts` update |
| 28 | `POST /api/admin/exams/[id]/force-end` | admin | 5A.3 | `exams` update, `rpc submit_attempt` |
| 29 | `POST /api/admin/exams/[id]/broadcast` | admin | 5A.5 | `rpc create_broadcast` |
| 30 | `POST /api/admin/attempts/[id]/force-submit` | admin | 5A.4 | `rpc submit_attempt` |
| 31 | `POST /api/admin/attempts/[id]/kick` | admin | 5A.4 | `sessions` update, LiveKit |
| 32 | `GET /api/admin/health` | super admin | 5C.2 | tables, LiveKit |
| 33 | `POST /api/admin/alerts/[id]/resolve` | super admin | 5C.4 | `alerts` update |
| 34 | `POST /api/admin/snapshots/purge` **NEW** | super admin | 7.7 | Storage, `violation_events` |
| 35 | `POST /api/admin/exams/[id]/grade` | admin | 6D.1 | tables |
| 36 | `POST /api/admin/grading/[run]/resume` | admin | 6D.2 | tables |
| 37 | `POST /api/admin/results/[attempt]/override` | admin | 6D.5 | `question_scores` insert |
| 38 | `POST /api/admin/results/[attempt]/regrade` **NEW path (6D.6)** | admin | 6D.6 | tables |
| 39 | `GET /api/admin/results/export` | admin | 7.4 | tables |
| 40 | `PATCH /api/admin/events/[id]` **NEW (3B.7)** | admin | 3B.7 | `violation_events` update |
| 41 | `POST /api/admin/exams/[id]/regrade-question` **NEW (6D.8)** | admin | 6D.8 | `grading_runs`, `grading_jobs` insert |
| 42 | `GET /api/question-images/[questionId]` **NEW** | candidate | 1E.2 | private Storage download |
| 43 | `POST, DELETE /api/admin/question-images` **NEW** | admin | 1E.2 | private Storage upload/delete |
| 44 | `POST /api/exam/announcements/[id]/claim` **NEW** | candidate | 5A.5 | `rpc claim_broadcast` |

Candidate page flow and which routes each page uses:

| Page | Routes |
|---|---|
| Login | 3 |
| Confirm (name and outlet) | 4 |
| Rules | 4, then 5 on accept |
| Pre-exam check | 2, 14, 12 |
| Waiting room | 7 and Broadcast, 12 (every 10 s), 13, 14, 44 |
| Exam | 8, 9, 10, 11, 12, 13, 7, 44 |
| Done | 6 |

---

## 3. Public and candidate routes

### 3.0 Shared shapes

```ts
type Phase = 'waiting' | 'live' | 'submitted' | 'closed';

type Question = {
  id: string;
  position: number;            // 0-based position in THIS candidate's paper
  type: 'mcq' | 'written';
  body_html: string;           // already sanitized
  image: { url: string; alt_text: string; width?: number; height?: number } | null;
  marks: number;
  options?: { id: string; text_html: string }[];   // mcq only, in this candidate's saved order.
                                                   // No `label` and no correct flag, ever.
};

type SavedAnswer = {
  answer_text: string | null;
  selected_option_id: string | null;
  flagged: boolean;
  revision: number;
};

type StateBody = {
  server_time: string;
  phase: Phase;
  exam: {
    id: string; title: string;
    status: 'draft' | 'scheduled' | 'live' | 'ended' | 'finalized';
    navigation_mode: 'free' | 'sequential';
    scheduled_start_at: string | null;
    started_at: string | null;
    ends_at: string | null;
    force_ended: boolean;
    question_count: number;
  };
  attempt: {
    id: string;
    status: 'not_started' | 'acknowledged' | 'in_progress' | 'submitted' | 'finalized';
    current_position: number;
    extra_minutes: number;
    deadline: string | null;   // exams.ends_at + extra_minutes; null until the exam starts
    submit_reason: 'manual' | 'auto' | 'forced' | null;
  };
  announcements: { id: string; sent_at: string }[]; // unclaimed rows targeted to this candidate, last 10 min, oldest first
};
```

**Phase rules** (computed on the server so the client has one switch):

| Phase | When |
|---|---|
| `submitted` | attempt status is `submitted` or `finalized` |
| `live` | exam `live`, not force-ended, and `now <= deadline` |
| `waiting` | exam `draft` or `scheduled` |
| `closed` | anything else (exam ended or force-ended, or the deadline passed, and the attempt is not submitted yet). The client locks inputs and flushes. Ordinary timeout submits as `auto`; on force-end the server derives `forced` and accepts the final flush during the 15-second collection window |

The answer key tables are never read by any route in this section. Candidate routes select explicit columns only.

---

### 3.1 `GET /api/health` — public
Pinged by UptimeRobot (it also keeps the free Supabase project awake).
- `200 { "ok": true, "time": "<iso>" }` after a trivial query (`select component from system_health limit 1`).
- `503 { "ok": false }` if the query fails. No other detail is ever returned.

### 3.2 `GET /api/time` — public
- `200 { "server_time_ms": 1759300000000 }`.
- Client: take 3 to 5 samples, compute `offset = server - (t_send + t_recv) / 2` for each, keep the median, and re-sync every 60 s. The `server_time` field in state, heartbeat and paper responses can refine it.

### 3.3 `POST /api/auth/login` — public
Request:
```json
{ "mer_code": "MER-0412", "nic": "199012345678", "exam_id": "<uuid, optional>" }
```
`mer_code`: 1 to 64 chars, trimmed, uppercased. `nic`: 1 to 20 chars, normalized by the 1C.1 utility.

Steps, in order:
1. **Rate limit** (failed attempts only, last 10 minutes): 5 per MER, about 200 per IP (Section 6 §7; plan 2A.3). Over the limit returns `429 rate_limited` with `retry_after_s`. The IP limit is high on purpose: all 23 people share one office network.
2. Find the active candidate by `mer_code`. Always run one argon2 verify, even for an unknown MER, so response time does not reveal which MER codes exist. The unknown-MER path verifies against a **real dummy hash created with the current Argon2 policy and `NIC_PEPPER`**. Create it once per server process and cache the resulting promise/hash; never generate a fresh dummy hash per login and never use a malformed or cheaper hash.
3. Failure: insert `login_attempts (success=false)` and return `401 invalid_credentials`. The same code covers unknown MER, wrong ID, and inactive candidate.
4. Success: insert `login_attempts (success=true)`.
5. **Pick the exam.** Eligible = assigned exams with status `scheduled` or `live`.
   - none eligible and the candidate has an assigned exam that already ended: `403 exam_closed`
   - none at all: `403 no_exam_available`
   - more than one and no `exam_id` sent: `409 multiple_exams` with `details.exams = [{ id, title, status, scheduled_start_at }]`. The client shows a picker and sends the login again with `exam_id` (the credentials were already proven, so this leaks nothing to strangers)
   - `exam_id` not among the eligible ones: `403 not_assigned`
6. Load the attempt for (exam, candidate) (it exists from the assign trigger; create it if somehow missing). If it is `submitted` or `finalized`: `409 already_submitted`, no session is created.
7. **One session at a time:** `update sessions set revoked_at = now() where candidate_id = X and revoked_at is null` (returning the rows), then insert the new session (`candidate_id`, `attempt_id`, `ip`, `user_agent`), then set the cookie.
8. If step 7 revoked at least one session and the attempt is `in_progress`: insert a `violation_events` row. If the attempt's `last_seen_at` is within the last 30 s, the old session was still live, so log `MULTI_LOGIN` (`counts = true`, `meta: { previous_ip, new_ip }`). Otherwise log `RECONNECTED` (`counts = false`).

Response `200`:
```json
{
  "next": "confirm",
  "candidate": { "mer_code": "MER-0412", "full_name": "A. Perera", "outlet": "Galle" },
  "exam": { "id": "<uuid>", "title": "Beauty Product Knowledge" },
  "attempt": { "status": "not_started" }
}
```
`next` is `confirm` when the attempt is `not_started`, otherwise `check`. A returning candidate always repeats the pre-exam check, because fullscreen and camera permission need a fresh click on every page load.

### 3.4 `GET /api/auth/me` — candidate (NEW, task 2A.7)
Feeds the confirm and rules screens.
```json
{
  "candidate": { "mer_code": "MER-0412", "full_name": "A. Perera", "outlet": "Galle" },
  "exam": {
    "id": "<uuid>", "title": "...", "instructions": "plain text",
    "scheduled_start_at": "<iso|null>", "duration_min": 45,
    "navigation_mode": "sequential", "question_count": 20, "status": "scheduled"
  },
  "attempt": { "id": "<uuid>", "status": "not_started" },
  "rules": { "snapshot_retention_days": 14 }
}
```
`instructions` is plain text, shown with `white-space: pre-wrap`. It is never rendered as HTML. `question_count` is the number of composed questions in the exam; every candidate receives all of them.

### 3.5 `POST /api/auth/acknowledge` — candidate
Called once, when the candidate presses accept on the **rules** screen. The confirm screen only navigates.
```json
{ "identity_confirmed": true, "rules_accepted": true }
```
Both must be `true`, otherwise `400 validation_failed`.
- `update attempts set status='acknowledged', acknowledged_at=now() where id = X and status = 'not_started'`.
- Exam must be `scheduled` or `live`, otherwise `409 exam_closed`.
- Already `acknowledged` or `in_progress`: `200` with the current status (idempotent).
- `submitted` or `finalized`: `409 already_submitted`.

Response: `200 { "attempt": { "status": "acknowledged" } }`.

### 3.6 `POST /api/auth/logout` — candidate (NEW, task 2A.8, optional)
Called by the done page. Sets `revoked_at` on the current session, clears the cookie. `200 { "ok": true }`. A candidate who refreshes the done page afterwards lands on login, which is fine.

### 3.7 `GET /api/exam/state` — candidate
Returns `StateBody` (3.0): attempt joined with exam plus pending announcement ids addressed to this candidate. It never calls `generate_paper`, so asking for state cannot start anyone's exam. Called on page load, on every Broadcast nudge, and on reconnect.

`announcements` joins `broadcast_recipients` to `broadcasts` and returns at most 50 rows where `candidate_id` is the authenticated candidate, `shown_at is null`, and `sent_at >= now() - interval '10 minutes'`, ordered by `sent_at, id`. It returns ids and times only—not message content. The client queues ids locally and uses route 44 immediately before each display. Once claims drain the first 50, the next heartbeat returns the next batch. Realtime payload text is never authoritative.

### 3.7a `POST /api/exam/announcements/[id]/claim` — candidate (route 44)

Request: `{ "claim_token": "<client-generated UUID v4>" }`. Immediately before displaying the next queued toast, the client creates one token and retries any lost HTTP reply with that same token.

The route calls `rpc('claim_broadcast', { p_broadcast_id: id, p_candidate_id: authenticatedCandidateId, p_claim_token: claim_token })`. The database atomically sets `shown_at` and `claim_token` only for an unclaimed recipient row belonging to this candidate and sent within the last 10 minutes. The same token can replay the successful response; a different token, an unaddressed candidate, an expired announcement or an unknown id all return `200 { "display": false }` without revealing which condition applied.

Success: `200 { "display": true, "announcement": { "id": "...", "message": "...", "sent_at": "..." } }`. The message is escaped plain text. Show it once for a fixed 5 seconds, remove the component, leave a one-second empty gap, then claim the next queued id. There is no candidate announcement-history endpoint, reopen control or persistent indicator. The SQL signature is `claim_broadcast(uuid, uuid, uuid)` and returns only `out_display`, `out_message`, and `out_sent_at`.

### 3.8 `GET /api/exam/paper` — candidate
Starts or resumes the paper. Calls `rpc('generate_paper', { p_attempt_id })`, which is idempotent: the first call assigns every composed question, saves the shuffled question/option order, and moves the attempt to `in_progress`; later calls return the saved paper unchanged. Calling it before the exam is live fails, which is how "the paper is not loaded until the time" is enforced on the server.

```json
{
  "server_time": "<iso>",
  "navigation_mode": "free",
  "total_questions": 27,
  "current_position": 0,
  "questions": [ /* Question[] */ ],
  "answers": { "<question_id>": { /* SavedAnswer */ } }
}
```
- `free`: all questions in paper order, and saved answers for all of them. `current_position` is `null`.
- `sequential`: exactly **one** question, the one at `attempts.current_position`, and its saved answer if any. Nothing later is sent.
- Implementation: after `generate_paper`, fetch `questions` and `mcq_options` by id with explicit columns (`id, type, body_html, image_path, image_alt_text, marks` and `id, text_html`). Order options by the saved `option_order`. Never join `answer_keys`. When `image_path` exists, expose only the authenticated `/api/question-images/{questionId}` URL plus alt text; never expose the private bucket path or a service key.

**`GET /api/question-images/[questionId]`** verifies that the authenticated candidate's `attempt_questions` contains the question, downloads the object from the private `question-images` bucket with the service role, and streams it with the stored MIME type, `X-Content-Type-Options: nosniff`, and a private cache policy. It returns `404` for both a question outside the paper and a missing image, so paper membership cannot be probed. Admin previews use the admin image route or a short-lived signed URL after `requireAdmin()`.

Errors (from the function):

| DB exception | HTTP | `code` |
|---|---|---|
| `attempt_not_found` | 404 | `not_found` |
| `not_acknowledged` | 403 | `not_acknowledged` |
| `attempt_closed` | 409 | `attempt_closed` |
| `exam_not_live` | 409 | `exam_not_live` |
| `exam_has_no_questions` | 409 | `exam_has_no_questions` |

### 3.9 `POST /api/answers` — candidate
Request:
```json
{
  "question_id": "<uuid>",
  "answer_text": "text or null (max 20000 chars)",
  "selected_option_id": "<uuid or null>",
  "flagged": false,
  "revision": 7
}
```
`revision` is an integer of 1 or more. Over-long text is rejected with `400 validation_failed` before the database sees it (the table has a length check that would otherwise surface as a 500).

Calls `rpc('save_answer', ...)`. Mapping:

| Function result | HTTP | Body |
|---|---|---|
| `saved` | 200 | `{ "result": "saved", "server_time": "<iso>" }` |
| `stale_revision` | 200 | `{ "result": "stale_revision", "server_revision": 9, "server_time": "<iso>" }` |
| `closed` | 409 | `exam_closed` (client locks the UI) |
| `wrong_position` | 409 | `wrong_position` (sequential mode, not the current question) |
| `not_in_paper`, `bad_option` | 400 | same codes |
| `not_found` | 404 | `not_found` |

**Revision rule for the client (important):**
- On load, set each question's counter to `max(server revision from the paper response, local IndexedDB revision)`, and use `counter + 1` for every save.
- On `stale_revision`: if `server_revision >= the revision I sent`, either an older request arrived late (harmless) or my counter was behind. Set the counter to `server_revision` and re-send the latest local value once with `server_revision + 1`.
- `server_revision` is read with one extra select, only in the stale case.

### 3.10 `POST /api/exam/next` — candidate (sequential mode)
Request:
```json
{
  "expected_position": 6,
  "question_id": "<uuid of the question being left>",
  "answer_text": null,
  "selected_option_id": "<uuid or null>",
  "revision": 4
}
```
Calls `rpc('advance_position', ...)` and maps `out_result`:

| `out_result` | HTTP | Body |
|---|---|---|
| `advanced` | 200 | `{ result, position, total_questions, question, answer, server_time }` where `question` is the new current question (3.0 shape) and `answer` is its saved answer or `null` |
| `already_advanced` | 200 | same body as `advanced` (the earlier reply was lost; the client just shows it) |
| `out_of_sync` | 200 | same body; the client replaces what it shows with the server's current question |
| `last_question` | 200 | `{ result: "last_question", position }`. **The route also calls `save_answer` for this question when the answer is not blank**, because the function returns before saving. The client then shows Submit |
| `closed` | 409 | `exam_closed` |
| `wrong_question`, `not_sequential` | 409 | `invalid_state` with `details.position`. The client reloads `GET /api/exam/paper` |
| `not_found` | 404 | `not_found` |
| any save failure | as 3.9 | `wrong_position`, `bad_option`, `not_in_paper` |

Returning the next question in the same response saves a round trip, which matters on the tablets. A blank answer is allowed (the function skips the save and still advances, after the client's warning dialog).

### 3.11 `POST /api/exam/submit` — candidate
Request:
```json
{
  "reason": "manual",
  "pending_answers": [
    { "question_id": "<uuid>", "answer_text": "...", "selected_option_id": null, "flagged": false, "revision": 12 }
  ]
}
```
- `reason`: `manual` (default) or `auto`. A candidate-supplied `forced` is rejected with `400`. When the exam is force-ended and still inside its 15-second collection window, the server ignores the requested reason and derives `forced` from `exams.force_ended_at`. Ordinary deadline expiry remains `auto`.
- `pending_answers` (optional, at most 50 **per request**, not per paper): answers the client has not been able to send yet. This transport batch size does not limit question count. If more than 50 are queued, the client flushes earlier batches through `/api/answers` before this final request. The route calls `save_answer` for each provided item, then submits. In sequential mode only the current question can be saved, and the others come back as `wrong_position` in `save_results`.
- Guard: the attempt must be `in_progress`. An `acknowledged` or `not_started` attempt gets `409 not_started`. A force-ended attempt may make this final request until `force_ended_at + 15 seconds`; later calls return `409 collection_closed`.
- Then call `rpc('submit_attempt', { p_attempt_id, p_reason: effectiveReason })`, where `effectiveReason` is derived as above. It has no deadline check on purpose: the route performs the authorization/window checks before closing the attempt.

Response: `200 { "submitted": true, "already_submitted": false, "save_results": [{ "question_id": "...", "result": "saved" }], "server_time": "<iso>" }`.
`already_submitted` is `true` when the function returned `false` (for example the scheduler got there first).

Client rule: when submitting manually, wait for the autosave queue to drain first, or put what is left in `pending_answers`. After a successful submit the client stops autosave, heartbeat is allowed to continue until the done page, then calls logout.

### 3.12 `POST /api/heartbeat` — candidate
Request body: `{}` (empty is fine). Sent every 10 s from the waiting room and the exam page.
- `update attempts set last_seen_at = now() where id = X and status in ('acknowledged','in_progress')`.
- If the previous `last_seen_at` was more than 30 s ago and the attempt is `in_progress`: insert `RECONNECTED` (`counts = false`, `duration_ms` = the gap). This pairs with the worker's `DISCONNECTED` (section 7). Also run: `UPDATE violation_events SET meta = jsonb_set(meta, '{count_reason}', '"short_gap"') WHERE attempt_id = X AND type = 'DISCONNECTED' AND counts = false AND meta->>'count_reason' IS NULL AND id = (most recent DISCONNECTED for this attempt)`. The `IS NULL` guard prevents overwriting a `long_gap` that the worker's Pass 2 set in the same instant.
- Response: the same `StateBody` as `GET /api/exam/state`. So the heartbeat is also the 5 to 10 s state poll that the waiting room needs as a backup for a missed Broadcast (2B.3), and the way a kicked client finds out (`401 session_revoked`, within 10 s).

### 3.13 `POST /api/events` — candidate
One call per incident (Section 4 §3). This route also carries the snapshot.
```json
{
  "id": "a1b2c3d4-...",
  "type": "FULLSCREEN_EXIT",
  "merged_types": ["FOCUS_LOST", "VIEWPORT_CHANGED"],
  "occurred_ago_ms": 1200,
  "duration_ms": 5400,
  "meta": { "width": 640, "screen_width": 1280 },
  "snapshot_jpeg_base64": "/9j/4AAQ..."
}
```
- **`id`** (required, UUID v4): client-generated at incident open. The server uses it as the primary key. **Idempotency**: if the id already exists, return `200 { "id": "...", "duplicate": true, "snapshot_saved": false }` — no insert, no snapshot upload, no reversal. This prevents retry double-counting.
- **Client type allowlist**: `type` must be one of `TAB_HIDDEN`, `FOCUS_LOST`, `FULLSCREEN_EXIT`, `VIEWPORT_CHANGED`, `MULTI_SCREEN`, `CAMERA_LOST`, `MIC_LOST`, `COPY`, `PASTE`, `CONTEXT_MENU`, `RELOAD`. Everything else (including `DISCONNECTED`, `RECONNECTED`, `MULTI_LOGIN`) returns `400`. `merged_types` may only contain types from this list.
- `occurred_ago_ms` (0 to `exam.duration_min * 60000`, clamped to cap if over): how long ago the incident started. The server stores `now() - occurred_ago_ms`.
- `meta`: JSON object, at most 2 KB.
- **Counting order (Section 4 §4.1)**: `counts = true` only if ALL of: (1) type is in `COUNTING_TYPES` (TAB_HIDDEN, FOCUS_LOST, FULLSCREEN_EXIT, VIEWPORT_CHANGED, MULTI_SCREEN, CAMERA_LOST, MIC_LOST, RELOAD), (2) for CAMERA_LOST/MIC_LOST `meta.source` must be `'track'`, (3) attempt is `in_progress`, (4) incident start (`now() - occurred_ago_ms`) is not before `attempts.joined_at`. Everything else is `false`.
- **Status guard**: allowed only for `acknowledged` and `in_progress` attempts. After submission return `200 { "ignored": true }` rather than an error, so late events from a closing page cause no noise.
- Rate limit: 30 per 60s per attempt → `429 rate_limited`.
- **Snapshot** (optional): decoded ≤ 100 KB, JPEG signature required. Path: `snapshots/{exam_id}/{attempt_id}/{event_id}.jpg`. A Storage "already exists" error on retry counts as success. Failed upload → `meta.snapshot_error = true`.

Response: `200 { "id": "<event id>", "snapshot_saved": true }`. The `bump_violation_count` trigger updates `attempts.violation_count`.

**Disconnect reversal (Section 4 §5):** after inserting an attention incident (TAB_HIDDEN, FOCUS_LOST, FULLSCREEN_EXIT, VIEWPORT_CHANGED), the route calls `reverse_disconnects_for_incident(event_id)`. This RPC reverses any `DISCONNECTED` rows with `count_reason = 'long_gap'` whose gap overlaps the incident's interval. It only touches `long_gap` rows — admin-dismissed rows are never changed by the system.

### 3.14 `POST /api/livekit/token` — candidate or admin
Request: `{ "as": "candidate" }` or `{ "as": "admin", "exam_id": "<uuid>" }`. The explicit `as` avoids guessing when one browser holds both a candidate cookie and an admin login (which happens during testing).

**Candidate:** `requireCandidate()`. The attempt must be `acknowledged` or `in_progress` and the exam `scheduled` or `live`, otherwise `409 exam_closed`.
- Room `exam_{exam_id}`, identity `c_{attempt_id}`, name = the MER code, metadata `{ "attempt_id", "mer_code" }`.
- Grants: `roomJoin`, `canPublish: true`, `canPublishSources: [camera, microphone]`, `canSubscribe: false`, `canPublishData: false`.
- TTL 4 hours. A second connection with the same identity replaces the first, which is what we want when someone moves to another device.

**Admin:** `requireAdmin()`.
- Room `exam_{exam_id}`, identity `a_{admin_id}`, `hidden: true`, `canSubscribe: true`, `canPublish: false`, `canPublishData: false`, `canUpdateOwnMetadata: false`. TTL 12 hours.
- Muting is client-side only. The admin page connects with `autoSubscribe: false`, subscribes to every video track, and subscribes to a person's **audio** only while that person is un-muted. No API call is involved.

Response: `200 { "token": "<jwt>", "url": "<LIVEKIT_URL>", "room": "exam_<id>", "identity": "c_<id>" }`.

---

## 4. Admin routes

All admin routes: `requireAdmin()` (or `requireSuperAdmin()` where stated) inside the handler, an `admin_actions` row for every change (1.6), and the standard errors from 1.2.

### 4.1 Candidates

**`GET /api/admin/candidates?q=&exam_id=&active=&page=1&page_size=50&include=exam_options`**
`page_size` max 200. `q` matches MER code, name or outlet. `exam_id` limits to candidates assigned to that exam.
`200 { "items": [{ "id", "mer_code", "full_name", "outlet", "active", "created_at", "assigned_exam_count" }], "total": 23 }`. `nic_hash` is never returned. `exam_options` is included only when the exact query `include=exam_options` is present (the list page requests it on its first load); searches, filters and later pages omit it.

**`GET /api/admin/candidates/[id]`** (NEW)
Returns `200 { "candidate": { "id", "mer_code", "full_name", "outlet", "active", "created_at", "assigned_exam_count" } }`. It never returns `nic_hash`; `404 not_found` for an unknown UUID.

**`POST /api/admin/candidates`**
`{ "mer_code": "MER-0412", "full_name": "A. Perera", "outlet": "Galle", "nic": "199012345678" }`
The MER code is trimmed and uppercased. Limits are MER code **64**, full name **200**, and outlet **200** characters; these are validation limits, not transliteration rules, and Sinhala/English/mixed content is preserved exactly. The ID is normalized, checked against the old format (9 digits then `V` or `X`) or the new one (12 digits), hashed with the pepper, and the plain value is discarded. `201 { "candidate": {...} }`.
Errors: `409 duplicate_mer`, `400 invalid_nic`.

**`PATCH /api/admin/candidates/[id]`** (NEW file)
`{ "full_name"?, "outlet"?, "nic"?, "active"? }`. The MER code cannot be changed (it is the login key): to change it, create a new candidate. Setting `active: false` blocks login without deleting history.

**`DELETE /api/admin/candidates/[id]`** (NEW)
Allowed only if the candidate has no attempt that has left `not_started`. Otherwise `409 has_attempts` (the cascade would erase their answers and scores): deactivate instead. The UI steers admins to deactivate whenever any exam history exists. This remains a known guard-then-delete race: a newly started attempt between the guard query and delete can still be cascaded; removing that limitation later requires a transactional database function or restrictive schema change.

**`POST /api/admin/candidates/import`**
```json
{ "rows": [{ "mer_code": "...", "full_name": "...", "outlet": "...", "nic": "..." }], "on_duplicate": "skip", "dry_run": true }
```
- At most **100 rows per request** (argon2 time against the function limit). The page parses the CSV in the browser (Papaparse) and sends batches of 50 in sequence, with `dry_run: true` first to show errors before anything is written.
- `on_duplicate`: `skip` (default) or `update`. Update mode replaces the existing full name, outlet and ID hash; a blank outlet is stored as `null` (clearing the existing outlet), and every applied update replaces the old ID hash with a new hash of the supplied ID.
- The browser's Check step finds repeated normalized MER codes across the **whole file** before batching. The first occurrence is checked normally; every later occurrence is a row error and is never sent for import. The server independently rejects later repetitions within each batch as a backstop.
- `dry_run: true` performs validation and the existing-MER pre-query only: it does **no Argon2 hashing and no writes**.
- A real batch hashes only rows that will be applied, then performs one bulk upsert. Counts come from the pre-query. `skip` uses `ignoreDuplicates`; `update` replaces name, outlet and NIC hash for matching MERs.
- The bulk upsert is one database statement. If it fails, the whole batch is reported as not applied; the route does not report or imply partial success.
- Response `200 { "dry_run": true, "created": 18, "updated": 0, "skipped": 2, "errors": [{ "row": 7, "mer_code": "MER-0099", "code": "invalid_nic", "message": "..." }] }`. Rows are independent: one bad row does not stop the others.

**`POST /api/admin/candidates/[id]/unlock`** (NEW, optional)
Deletes this candidate's failed `login_attempts` from the last 10 minutes so a candidate who mistyped their ID five times can log in at once. `200 { "cleared": 5 }`. (You said lockout abuse is not a worry for this exam; this is only the cheap safety valve for honest typos on exam morning.)

### 4.2 Exams

Exam status moves: `draft` ↔ `scheduled` (admin, by PATCH), `draft/scheduled` → `live` (admin Start or the worker at the scheduled time), `live` → `ended` (force-end, or the worker after the last deadline), `ended` → `finalized` (worker). Nothing else.

**`GET /api/admin/exams`**
`200 { "items": [{ ...exam columns, "question_count", "assigned_count" }] }`, newest first.

**`POST /api/admin/exams`**
```json
{
  "title": "Beauty Product Knowledge",
  "instructions": "plain text, optional, max 4000",
  "duration_min": 45,
  "scheduled_start_at": "2026-10-05T04:00:00Z",
  "navigation_mode": "sequential",
  "shuffle": true,
  "flag_threshold": 10,
  "is_practice": false
}
```
Ranges: `title` 1 to 150, `duration_min` 1 to 480, `flag_threshold` 1 to 100. `navigation_mode` defaults to `free`. Every candidate receives every question the admin composes; there is no fixed-count field. Creates the exam as `draft`. `201 { "exam": {...} }`.

**`GET /api/admin/exams/[id]`** (NEW file)
`200 { "exam": {...}, "question_count", "assigned_count", "warnings": [...] }`. `warnings` is non-blocking, for example `{ "code": "missing_answer_key", "question_ids": [...] }`. Answer keys are only needed at grading time, so a missing one is a warning, not an error.

**`PATCH /api/admin/exams/[id]`**
Any field from the create body, plus `status: 'scheduled' | 'draft'`.
- While `draft` or `scheduled`: all fields editable.
- While `live` or `ended`: only `title` and `flag_threshold`. At `finalized`, only `title`. Any other supplied field returns `409 exam_locked` with `details.locked_fields`. This locks navigation, shuffle, duration, scheduled time, instructions and practice status. A threshold change audits `old_flag_threshold` and `new_flag_threshold`.
- `status: 'scheduled'` requires `scheduled_start_at` at least 1 minute in the future, at least one question and at least one assigned candidate (`409 not_ready` with `details.missing`). While an exam is already scheduled, supplying `scheduled_start_at` again also requires a non-null value at least 1 minute in the future; edits that omit it, such as a title-only edit, remain allowed. `status: 'draft'` un-schedules. The update is conditional on the status read for validation; if the status changed concurrently, return `409 exam_locked` and ask the admin to reload.
- Setting `status` to `live`, `ended` or `finalized` here returns `400 use_control_route`.

**`DELETE /api/admin/exams/[id]`** (NEW)
Only while `draft` and with no started attempts, otherwise `409 exam_not_deletable`. This cascades to its questions, so the admin page asks for confirmation. (Test exams after rehearsal are removed with the cleanup script, task 8.30.)

**`GET /api/admin/exams/[id]/candidates`** (NEW file)
`200 { "exam": { "id", "title", "status" }, "items": [{ "candidate_id", "mer_code", "full_name", "outlet", "attempt_id", "attempt_status" }] }`.

`GET /api/admin/exams/[id]/candidates?view=available&q=&page=1&page_size=50` returns active candidates not assigned to this exam: `200 { "exam": { "id", "title", "status" }, "items": [{ "candidate_id", "mer_code", "full_name", "outlet" }], "total", "scan_limit": 1000, "scanned_count" }`. At the expected office scale, the server fetches at most 1,000 active candidates matching `q`, removes assigned IDs in memory, then paginates in memory. It never builds a long `not.in` URL. When `scanned_count` reaches `scan_limit`, the UI says **Search to narrow the list.** If active candidates may exceed 1,000 later, replace this bounded scan with a database RPC or view before relying on results beyond that limit.

**`POST /api/admin/exams/[id]/candidates`**
`{ "candidate_ids": ["<uuid>", ...] }` (1 to 100). The UI splits larger selections into sequential batches of at most 100 and aggregates `added` and `already_assigned`. Before writing, the server verifies every requested candidate exists and is active. If any are missing or inactive, the whole request returns `400 validation_failed`; the message gives only the invalid count and asks the admin to refresh. Inserts into `exam_candidates`; the trigger creates each attempt. Allowed while `draft`, `scheduled` or `live` (a late assignment can still log in and gets the same shared deadline). `409 exam_locked` once `ended`. Response `200 { "added": 21, "already_assigned": 2 }`.

Known limitation: assignment checks the exam status before inserting. If the exam ends between that check and the insert, the assignment can still be created. This is harmless for exam access because the candidate cannot start an ended exam; eliminating the race later would require an atomic database operation.

**`DELETE /api/admin/exams/[id]/candidates`**
`{ "candidate_ids": [...] }` (1 to 100). The UI splits larger selections into sequential batches and aggregates `removed` and `blocked`. The route calls `unassign_exam_candidates`: it waits for requested attempt-row locks, removes only assignments whose attempt is still `not_started` (the trigger deletes the attempt), and ignores unknown or unassigned IDs. The rest are listed in `blocked`: `200 { "removed": ["<candidate uuid>"], "blocked": [{ "candidate_id", "reason": "attempt_started" }] }`. The RPC rejects ended/finalized exams. The UI says blocked candidates have **already joined the exam**.

### 4.3 Questions and answer keys

**Lock rule (1E.7):** once the exam is `live` or later (`live`, `ended`, `finalized`), these return `409 exam_locked`: create, delete, reorder, change of `body_html`, `marks`, or options. **Answer-key edits stay allowed** (`PUT /api/admin/answer-keys`, below), because keys are only used at grading time.

Question RPC errors map consistently: `exam_locked` → `409 exam_locked`; `grading_in_progress` → `409 grading_in_progress`; `exam_not_found` and `not_found` → `404 not_found`; `type_immutable` → `400 type_immutable`; `validation_failed` and `bad_correct_option` → `400 validation_failed`. Unexpected database failures are logged without request bodies or database messages and return the generic `500 internal_error` response; raw PostgreSQL messages are never returned to the client.

**Sanitizing:** all HTML goes through `sanitize-html` before it is stored.
- Allowed tags: `p br strong b em i u s ul ol li span h2 h3` (options: no headings).
- Allowed attributes: `span` may carry `style` with **only** `font-size` and a value matching `^\d{1,3}(px|em|rem|%)$`. Everything else (classes, links, images, scripts, event attributes) is removed.
- Limits: question body 50,000 chars, option 5,000 chars.

**`GET /api/admin/questions?exam_id=`**
```json
{ "items": [{
  "id": "<uuid>", "position": 0, "type": "mcq", "body_html": "...", "marks": 1,
  "image": null,
  "options": [{ "id": "<uuid>", "position": 0, "label": "a", "text_html": "..." }],
  "answer_key": { "correct_option_id": "<uuid>", "model_answer": null, "grading_notes": null, "calibration": null }
}] }
```
Admin only. This is the only route that returns answer keys together with questions.
When an image exists, `image` contains the four stored metadata fields plus an admin-only `preview_url` signed for five minutes. The URL is generated at read time, is never stored, and is never returned by a candidate route.

**`POST /api/admin/questions`**
```json
{
  "id": "<client-generated uuid>",
  "exam_id": "<uuid>",
  "type": "mcq",
  "body_html": "<p>Which ingredient ...</p>",
  "image": null,
  "marks": 1,
  "position": null,
  "options": [{ "id": "<client-generated uuid>", "text_html": "Niacinamide" }, { "id": "<client-generated uuid>", "text_html": "Water" }],
  "answer_key": { "correct_option_id": "<option uuid>", "model_answer": null, "grading_notes": null, "calibration": [] }
}
```
- `marks`: **optional**. When the admin leaves it out it is saved as `1` (the column default, and grading needs a number). When given: above 0, at most 999.99 (the column is `numeric(5,2)`). `position` defaults to the end.
- The question and option UUIDs are generated once by the editor and retained across retries. A UUID collision with another exam is returned as `404 not_found`; reusing a question UUID with a different type is `400 type_immutable`.
- `mcq`: 2 to 10 options and exactly one `answer_key.correct_option_id`, which must belong to the question. Labels (`a`, `b`, `c`…) are assigned by the server from the order.
- `written`: no `options`. `answer_key.model_answer` is optional here.
- `image` is `null` or the complete upload metadata from `/api/admin/question-images`; the server rejects partial or mismatched metadata before the database all-or-none constraint does.
- After TypeScript sanitization and Storage metadata verification, the route calls `save_question(...)`. The function locks the exam row `FOR NO KEY UPDATE`, which both prevents a concurrent status change and serializes next-position allocation for concurrent creates. It rejects statuses other than `draft` and `scheduled`, then writes `questions`, `mcq_options`, and `answer_keys` in one transaction. A failure rolls back every step. Retrying the same client-generated IDs safely repairs a lost response without duplicating rows.
- `201 { "question": { ...same shape as GET } }`.

**`PATCH /api/admin/questions/[id]`** (NEW file)
`{ "body_html"?, "marks"?, "options"?, "image"?, "answer_key"? }`. The route loads the existing values, validates a complete replacement document, sanitizes it, then calls the same atomic `save_question(...)` function. `image` is either `null` (remove it) or the complete metadata returned by the upload route. `type` cannot change (`400 type_immutable`): delete and recreate. `options` is a full replacement list using stable client-generated ids; ids missing from the list are deleted. Same MCQ rules as create.

**`POST /api/admin/question-images`** accepts `multipart/form-data` with one file plus required `alt_text` of 1–500 trimmed characters and runs only in the Node.js runtime. Allow only JPEG, PNG and WebP after checking both the declared MIME type and decoded file signature; maximum **4 MiB (4,194,304 bytes)**. Reject a `Content-Length` above 4 MiB before buffering. Sharp 0.35.5 decodes under a 25 MP pixel ceiling, rejects animated or malformed input, auto-orients, scales the long edge to at most 1,600 px without enlargement, strips metadata, and re-encodes in the detected approved format. Generate the object path server-side (`questions/{admin_id}/{uuid}.{ext}`), upload to the private `question-images` bucket, and return MIME and size from the processed output with the other all-or-none metadata. Do not trust a client path or filename. **`DELETE`** accepts `{ "path": "...", "question_id"?: "..." }` and permits an authenticated admin to remove their own unattached upload or an image attached to the identified question they may edit. For an attached image it first calls `save_question` with the stored complete document and a null image, so the exam lock and database update complete before object removal. Question PATCH and DELETE use the same database-first order for replacement/removal. A Storage deletion failure gets one immediate retry. If both attempts fail, the object remains unreferenced for the Phase 6 worker's daily purge. The worker purges objects older than 24 hours that are not referenced by any `questions.image_path`, covering abandoned create forms and failed saves.

**`DELETE /api/admin/questions/[id]`** (NEW)
Calls `delete_question(exam_id, question_id)`, which takes the same exam-row lock and deletes only in draft or scheduled exams.

**`POST /api/admin/questions/reorder`** (NEW)
`{ "exam_id": "<uuid>", "ordered_ids": ["<uuid>", ...] }`. Calls `reorder_questions(exam_id, ordered_ids)`. Under the exam-row lock, the list must be exactly the set of the exam's question ids, otherwise `400 validation_failed`; the function atomically assigns positions `0..n-1`. Draft or scheduled only.

**`GET /api/admin/answer-keys?exam_id=`**
`200 { "items": [{ "question_id", "correct_option_id", "model_answer", "grading_notes", "calibration" }] }`.

**`PUT /api/admin/answer-keys`**
```json
{
  "question_id": "<uuid>",
  "correct_option_id": null,
  "model_answer": "Niacinamide reduces ...",
  "grading_notes": "Accept any two of the three effects.",
  "calibration": [{ "answer": "it helps pores", "marks": 0.5, "note": "vague" }]
}
```
- `correct_option_id` only for MCQ and must belong to the question; `model_answer`, `grading_notes`, `calibration` only for written (`400 type_mismatch` otherwise). `model_answer` max 10,000, `grading_notes` 4,000, `calibration` up to 10 items with `marks` between 0 and the question's marks.
- Calls `save_answer_key(...)`. The function locks the exam row `FOR SHARE` and upserts the row in any exam status, except `409 grading_in_progress` while a grading run for the exam is `running` or `paused` (changing the key mid-run would grade candidates against different keys). Grade start takes `FOR UPDATE` on the same exam row before checking keys and creating its run, so the two operations serialize.
- Response: `200 { "answer_key": {...}, "regrade_needed": true }`. `regrade_needed` is `true` when scores already exist for that question, so the admin page can offer a regrade.

### 4.4 Exam controls

**`POST /api/admin/exams/[id]/start`**
Empty body. Preconditions: status `draft` or `scheduled`, at least one question, at least one assigned candidate (`409 invalid_status`, `409 exam_has_no_questions`, `409 no_candidates_assigned`).
Implementation: one conditional update, `status='live', started_at=now(), ends_at=now() + duration_min` **where status in ('draft','scheduled')**, returning the row. Zero rows means someone else (the worker's scheduled start, or another admin) won the race: `409 invalid_status`. Then publish `exam_started`.
`200 { "exam": { "status": "live", "started_at": "<iso>", "ends_at": "<iso>" } }`.
The worker's scheduled start must use the same conditional update, so the two cannot both fire.

**`POST /api/admin/exams/[id]/extend`**
`{ "minutes": 10, "attempt_id": "<uuid, optional>" }` with `minutes` from 1 to 120.
- Without `attempt_id`: `ends_at += minutes` for everyone. Exam must be `live`, not force-ended, and `now < ends_at` (`409 deadline_passed` otherwise: candidate screens lock at the deadline, so extending after the fact is refused). Publishes `time_updated`.
- With `attempt_id`: `extra_minutes += minutes` for that person. The attempt must be `acknowledged` or `in_progress` and its own deadline must not have passed. Publishes `attempt_changed`.
- Both updates are **compare-and-set**: read the current value, then `update ... where ends_at = <value read>` (or `extra_minutes = <value read>`), retry up to 3 times if no row matched. This stops two admins extending at the same moment from overwriting each other. If all three tries lose the race, the route returns `409 concurrent_update` and changes nothing; the admin page tells the admin to check the time shown and try again.
- `200 { "ends_at": "<iso>" }` or `200 { "attempt": { "id", "extra_minutes", "deadline" } }`.

**`POST /api/admin/exams/[id]/force-end`**
`{ "confirm": true }` (required, `400` without it). Exam must be `live` (`409 invalid_status`).
1. Atomically `update exams set status='ended', ends_at=now(), force_ended_at=now() where id = X and status='live'`. Candidate screens lock immediately.
2. Immediately submit `not_started` and `acknowledged` attempts as `forced`. Leave `in_progress` attempts open only for final answer collection: `save_answer` and the submit route accept their pending answers until `force_ended_at + 15 seconds`; no navigation or continued editing is allowed.
3. Publish `exam_ended`. Connected clients flush `pending_answers`; the submit route derives `forced` server-side and closes each attempt.
4. After 15 seconds the worker submits every remaining attempt as `forced` from the latest answers already stored, then finalizes. Partial written answers are graded like any other non-blank answer.

`202 { "exam": { "status": "ended", "ends_at": "<iso>", "force_ended_at": "<iso>" }, "collection_deadline": "<iso>", "collecting": 21, "already_submitted": 2 }`. Final counts are available after the collection window.

**`POST /api/admin/attempts/[id]/force-submit`**
`{ "confirm": true }`. `rpc('submit_attempt', { p_reason: 'forced' })`. `200 { "submitted": true }`, or `false` if already submitted. Publishes `attempt_changed`.

**`POST /api/admin/attempts/[id]/kick`**
Empty body. Revokes every active session of that attempt's candidate (`revoked_at = now()`), and removes the participant `c_{attempt_id}` from the LiveKit room (best effort, `livekit_removed` reports whether it worked). The attempt itself is unchanged: the candidate can log in again and resume. Publishes `attempt_changed` so the candidate's page refetches state and gets `401 session_revoked` immediately.
`200 { "revoked_sessions": 1, "livekit_removed": true }`.

**`POST /api/admin/exams/[id]/broadcast`**
Request examples:

```json
{ "message": "Five minutes left.", "audience": "all" }
{ "message": "Please reconnect your camera.", "audience": "custom", "candidate_ids": ["<candidate uuid>"] }
```

- `message`: 1 to **5,000** characters after trimming, plain text.
- Toast duration is not configurable and is absent from the request schema; if supplied, it is stripped as an unknown key under §1.1. Every candidate toast displays for a fixed **5 seconds**.
- `audience = "all"`: `candidate_ids` must be absent. The database snapshots every candidate currently assigned to the exam.
- `audience = "custom"`: `candidate_ids` contains at least one unique candidate id, and every id must currently be assigned to the exam. Duplicates collapse to one recipient.
- There is **no per-exam count limit**. The exam must be `scheduled` or `live`.

The route calls `create_broadcast(uuid, text, text, uuid[])`, which atomically inserts the announcement and exact recipient rows. Map `no_recipients` to `400 no_recipients`, `invalid_recipient` to `409 invalid_recipient`, and the other validation exceptions to `400 validation_failed`. Then write the `broadcast` admin action with audience and recipient count—but not a duplicate copy of the message—publish the content-free `message` nudge, and return `200 { "id": "<uuid>", "recipient_count": 23 }`. Publish failure does not fail the send; the heartbeat is the backup. Discord and Telegram are not used.

### 4.5 Operations (super admin)

**`GET /api/admin/health`**
```json
{
  "checked_at": "<iso>",
  "supabase": { "ok": true, "latency_ms": 42 },
  "livekit": { "ok": true, "latency_ms": 120, "rooms": 1, "error": null },
  "worker": { "ok": true, "status": "ok", "last_heartbeat_at": "<iso>", "age_s": 12 },
  "gemini_keys": [{ "label": "key1", "status": "active", "cooldown_until": null, "last_error": null, "checked_at": "<iso>" }],
  "active_alerts": 0
}
```
- `livekit`: `RoomServiceClient.listRooms()` with a 3 s timeout.
- `worker.ok` is `age_s < 90` (it writes every 30 s).
- `gemini_keys` is read from `api_key_state` only. **This route never sees a Gemini key**; the worker does the key check (section 7).

**`POST /api/admin/alerts/[id]/resolve`**
`update alerts set resolved_at = now() where id = X and resolved_at is null`. `200 { "resolved": true }`, or `false` if it was already resolved. `404` if the id does not exist.

**`POST /api/admin/snapshots/purge`** (NEW, task 7.7)
`{ "older_than_days": 30, "exam_id": "<uuid, optional>", "dry_run": false, "confirm": true }`.
- `older_than_days` defaults to `SNAPSHOT_RETENTION_DAYS`. `0` deletes everything (post-exam cleanup) and then needs `confirm: true`.
- Finds `violation_events` with a `snapshot_path` older than the cutoff, removes the files from Storage in batches of 100, then sets `snapshot_path = null` and `meta.snapshot_deleted_at = now()` (use `coalesce(meta, '{}'::jsonb)` first). The marker lets the admin timeline say "Snapshot deleted" instead of guessing from the event's age. The event rows themselves stay.
- `200 { "deleted": 412, "failed": 0, "dry_run": false }`. The worker runs the same shared function once a day.

### 4.6 Grading

**`POST /api/admin/exams/[id]/grade`**
Body is optional: `{ "mcq_only": true }` rescores the multiple-choice questions and recomputes results **without creating any Gemini jobs** (step 2 skips the written bullets, the run is `kind='full'` and is `done` at once). It exists for the case where an examiner corrects an MCQ answer key after grading: without it the only way to rescore MCQs would be to run the whole grading again and spend the Gemini quota on every written answer a second time. Without a body the route behaves as below. Preconditions (each its own `409`):
- `exam_not_finalized`: status must be `finalized`.
- `grading_in_progress`: no run in `running` or `paused` (`details.run_id`).
- `missing_answer_keys`: every question that appears in any paper has a key (MCQ: `correct_option_id`; written: non-empty `model_answer`). `details.question_ids` lists the gaps.

Steps:
1. Insert a `grading_runs` row (`kind='full'`, `started_by`).
2. For each attempt that has a paper (people who never joined have no `attempt_questions` and get no scores; they show as "absent" with a null percent):
   - **MCQ, in code:** insert `question_scores (source='mcq')`, full marks when `selected_option_id = correct_option_id`, otherwise 0 (`reason: 'No answer'` when blank). `max_marks` = the question's marks.
   - **Written and blank:** insert `question_scores (source='ai', marks=0, reason='No answer submitted', details={auto_zero:true})`. No Gemini call.
   - **Written and not blank:** group into chunks of `GRADING_CHUNK_SIZE` (default 10) per attempt and insert `grading_jobs` (`chunk_index` 0, 1, …; `question_ids` = that chunk).
3. Recompute `results` for each attempt (formula in 4.6.1).
4. If no jobs were created (for example an all-MCQ exam), set the run to `done` right away.

`202 { "run_id": "<uuid>", "attempts": 23, "jobs": 46, "estimated_calls": 46, "mcq_scored": 160, "auto_zero": 12 }`.
Running grading again after a finished run is allowed. It adds new MCQ and zero rows, and the `current_scores` view keeps overrides on top.

**4.6.1 Results formula** (shared function `recomputeResults(attemptId)`, used by this route, the override route, and the worker when a candidate's last job finishes):
- `mcq_marks` = sum of `current_scores.marks` for MCQ questions in the candidate's paper.
- `written_marks` = same for written questions.
- `total_marks` = sum of the **max marks of the candidate's own paper** (use `questions.marks` for any question that has no score row yet).
- `total_percent` = `(mcq_marks + written_marks) / total_marks * 100`, rounded to 2 decimals; `null` when `total_marks` is 0.
- Upsert into `results`.

**`POST /api/admin/grading/[run]/resume`**
Empty body. The run must be `paused` or `failed` (`409 not_resumable`). Sets `failed` jobs and `running` jobs older than 2 minutes back to `pending` (`tries = 0`, `error = null`, `locked_at = null`), sets the run to `running`, and writes a `resumed` row to `grading_log`. Key cooldowns are the worker's business and are not touched.
`200 { "run": { "id", "status": "running" }, "requeued_jobs": 4 }`.

**`POST /api/admin/results/[attempt]/override`**
```json
{ "question_id": "<uuid>", "marks": 1.5, "note": "Mentioned both effects in Sinhala." }
```
`note` is required (1 to 1000 chars). The question must be in the attempt's paper (`400 not_in_paper`). `marks` from 0 to the question's max marks (`400 marks_out_of_range`). The attempt must be `finalized` (`409 not_finalized`).
Inserts `question_scores (source='override', created_by = admin)`, then recomputes `results`.
`200 { "current": { "question_id", "marks", "max_marks", "source": "override" }, "results": { "mcq_marks", "written_marks", "total_marks", "total_percent" } }`.
There is no "undo override": override again with the value you want. A regrade never replaces an override (the view guarantees it).

**`POST /api/admin/results/[attempt]/regrade`** — Single-candidate regrade (6D.6)
`{ "question_id": "<uuid>" }`. Regrades one question for a single candidate's attempt. Preconditions: attempt must be `finalized` (`409 not_finalized`); question must be written and in paper with a non-blank answer (`409 nothing_to_grade` otherwise). Creates a `grading_runs` row (`kind='regrade'`) and exactly one `grading_jobs` row for this attempt (`chunk_index 0`, `question_ids: [id]`). Overrides stay current (`current_scores` view). Writes `admin_actions` (`regrade`). Response: `202 { "run_id": "<uuid>", "job_id": "<uuid>", "override_present": true }`. When `override_present` is `true`, the new AI score is stored but the override stays current, and the review screen should say so.

**`POST /api/admin/exams/[id]/regrade-question`** — Bulk regrade one question for all candidates (NEW route 41 for 6D.8, Section 5 §8.4)
`{ "question_id": "<uuid>" }`. Regrades one question across all candidates who answered it.
- Preconditions (each its own `409`): `exam_not_finalized` (exam status must be `finalized`); `grading_in_progress` (no run `running` or `paused`); question is written and has a non-empty `model_answer` (`400 not_written` / `409 missing_answer_key`).
- Creates a `grading_runs` row (`kind = 'regrade'`) and one `grading_jobs` row per attempt that received this question with a non-blank answer (`chunk_index 0`, `question_ids = [id]`).
- Overrides stay current (the `current_scores` view guarantees this).
- Writes an `admin_actions` row (`regrade_question`).
- Response: `202 { "run_id": "<uuid>", "jobs": 21, "overrides_kept": 2 }`.

**`GET /api/admin/results/export?exam_id=`**
Returns `text/csv; charset=utf-8` with a UTF-8 BOM (so Excel opens Sinhala names correctly) and `Content-Disposition: attachment; filename="results-<exam-slug>-<yyyy-mm-dd>.csv"`.
Columns: `mer_code, full_name, outlet, attempt_status, submit_reason, violations_counted, violations_logged, questions_received, mcq_marks, written_marks, total_marks, total_percent, needs_review_count, unscored_count`.
- `questions_received`: the admin-order question numbers (position + 1) of the questions on that candidate's paper, joined with `;`.
- Every assigned candidate is a row, including people who did not join (empty marks).
- Any cell that starts with `=`, `+`, `-` or `@` gets a leading `'` so Excel cannot run it as a formula.

### 4.15 `PATCH /api/admin/events/[id]` — any admin (NEW, Section 4 §7.4)

Dismiss or restore a wrongly counted incident.

```json
{ "dismissed": true, "note": "Notification shade, not a real tab switch" }
```

- `note` is required (1 to 300 chars): `400 note_required`.
- **Dismiss** (`dismissed: true`): allowed when `counts = true`. Use `coalesce(meta, '{}'::jsonb)` before merging — a null `meta` (common for client events) would silently lose the dismiss note. Sets `counts = false`, `meta.dismissed = { by, at, note }`, and for a `DISCONNECTED` row also `meta.count_reason = 'dismissed'`. The trigger subtracts 1 from `violation_count`.
- **Restore** (`dismissed: false`): allowed when `meta.dismissed` exists. Sets `counts = true`, removes `meta.dismissed`, and for a `DISCONNECTED` row sets `count_reason = 'restored'`. The trigger adds 1.
- `404 not_found`, `409 not_dismissable` (already not counted and not dismissed), `409 not_restorable` (no `meta.dismissed`).
- Writes an `admin_actions` row (`event_dismiss` or `event_restore`) with the event id and the note.
- Realtime: the badge updates because the trigger changes `attempts.violation_count`.

`200 { "id", "counts", "violation_count" }`.

---

## 5. Admin read and live-update sources

Initial page loads, joins, view polling, review data, health data and broadcast history go through authenticated admin API routes using the server-only `service_role` client. Writing also always goes through section 4. The browser Supabase client uses the signed-in admin session only to read its own `admin_profiles` row and subscribe to the six published Realtime tables: `attempts`, `violation_events`, `grading_jobs`, `grading_log`, `alerts`, and `exams`. It has no direct DML, sequence, RPC, view, or other table access.

| Data | Source | Live updates |
|---|---|---|
| Grid rows: status, `last_seen_at`, violation count, `current_position` | Server route reads `attempts` joined with `candidates (mer_code, full_name, outlet)` | Browser Realtime on `attempts`, filtered by `exam_id` |
| Progress label ("Q 7/20", "14 answered") | Server route reads `attempt_progress` | Server poll every 10 s; views are not in the Realtime publication |
| Violation timeline | Server route reads `violation_events` by `attempt_id` | Browser Realtime on `violation_events` (the table has no `exam_id`, so filter in the page) |
| Snapshot images | Server route creates a five-minute signed URL after authorization | none |
| Exam status | Server route reads `exams` | Browser Realtime on `exams` |
| Review screen | Server route reads `current_scores`, `answers`, `attempt_questions`, `questions`, `mcq_options`, `answer_keys` | none |
| Grading progress | Server route reads `grading_runs`, `grading_jobs`, `grading_log` | Browser Realtime on `grading_jobs` and `grading_log` |
| Alerts, worker health, key states | Super-admin route reads `alerts`, `system_health`, `api_key_state` | Browser Realtime on `alerts` |
| Broadcast history | Server route reads `broadcasts` | none |

Candidate status words (4C.5) are derived on the page. The rules and their order are in Section 2C §7.2; in short: **Submitted** = `submitted` or `finalized`; **Not joined** = `not_started`; **Offline** = `acknowledged` or `in_progress` with `last_seen_at` older than 25 s (display only; the logged `DISCONNECTED` event starts at 30 s, Section 4); **Camera off** = heartbeat fine but no video track from LiveKit participant `c_{attempt_id}` for 10 s; **In exam** = `in_progress`; **Ready** = `acknowledged`. Only Camera off needs LiveKit; the rest come from `attempts`.

---

## 6. Realtime Broadcast contract

- Channel `exam:{exam_id}`, event name `exam`. Anyone with the public key can publish on it, so **a message is only a nudge**: on any message the candidate page calls `GET /api/exam/state` and acts on that answer (this is also why a spoofed message is harmless).
- Payloads carry no authority and no content:

| `type` | Sent by | Extra fields |
|---|---|---|
| `exam_started` | start route | none |
| `exam_ended` | force-end route | none |
| `time_updated` | extend (everyone) | none |
| `attempt_changed` | extend (one person), force-submit, kick | `attempt_id` (only that candidate's page needs to refetch, but a refetch by anyone is harmless) |
| `message` | announcement route | none (the client refetches targeted pending ids, then claims its own message) |

- Server publishing uses the Supabase Realtime REST broadcast endpoint, or the JS client's HTTP send *(verify the current method)*. A failed publish is logged and **never** fails the admin action, because the 10 s heartbeat is the backup.
- A client that reconnects to the channel refetches state once.

---

## 7. What the worker must provide for these routes to work

These are worker-side behaviours the contracts above depend on. The proctoring spec (Section 4) and the infra spec (Section 6) will tighten them; the contract is fixed here.

| Behaviour | Rule |
|---|---|
| Scheduled start | Every 30 s: for exams `scheduled` with `scheduled_start_at <= now()`, run the **same conditional update as the Start route** |
| Exam end and finalize | Ordinary deadlines: submit each attempt after its own `grace_deadline` with reason **`auto`**. Admin force-end: wait only until `force_ended_at + 15 seconds`, then submit remaining attempts with **`forced`** from their latest stored answers. Finally mark submitted attempts `finalized`. Partial non-blank written answers always receive Gemini grading |
| `DISCONNECTED` events | **Two-pass rule (send-on-end model).** **Pass 1 (30s):** every 30 s, for `in_progress` attempts with `last_seen_at` older than 30 s, insert `DISCONNECTED` with `counts = false`, `meta.last_seen_at` = the attempt's current `last_seen_at` (exact timestamptz string from the DB), and no `meta.count_reason`. Skip if the attempt's most recent `DISCONNECTED`/`RECONNECTED` is already a `DISCONNECTED`. **Pass 2:** every 30 s, call `resolve_disconnects()` (RPC, `revoke execute from public, anon, authenticated; grant to service_role`). This function runs two guarded statements: **(1) Mark overlaps** — rows where a focus-type event's interval (using `coalesce(f.duration_ms, 0)`) starts inside the gap get `count_reason = 'overlap'`. The interval rule (Section 4 §5): only the lower bound matters (`incident_end >= gap_start - 10s`); the old upper-bound check on `f.occurred_at` is removed, so an incident starting anywhere inside the gap counts as overlap. **(2) Flip remaining** — unmatched rows get `counts = true, count_reason = 'long_gap'`. Both include `a.status = 'in_progress'`, `coalesce(f.duration_ms, 0)`, `count_reason IS NULL` guard, and `timestamptz` casts. The trigger handles +1/-1. If a late focus event arrives after a flip, the events route calls `reverse_disconnects_for_incident(event_id)` — only touches `long_gap` rows. The heartbeat route sets `count_reason = 'short_gap'` (uses `coalesce(meta, '{}'::jsonb)` and `IS NULL` guard). **Worker reversal safety net:** after Pass 2, call `reverse_disconnects_for_incident()` for any attention incidents inserted in the last 5 minutes (idempotent) |
| Key check | Every 5 minutes, per key: call the model-listing endpoint, then write `api_key_state` (`active`, or `disabled` with `last_error` on 400/403). This is the only place Gemini keys are used outside grading |
| Grading jobs | See Section 5 §7. When the last job of an attempt finishes, call `recomputeResults(attemptId)`. The worker auto-resumes pauses it caused itself (`keys_exhausted`) |
| Snapshot purge | Once a day, the same shared function as `POST /api/admin/snapshots/purge` with the default retention |
| Unattached question images | Once a day, delete `question-images` objects older than 24 hours that no `questions.image_path` references; never delete referenced exam content |
| Worker heartbeat | `system_health` row every 30 s (6A.6) |
| Shared code | `recomputeResults`, the conditional start update, and the snapshot purge are written once and imported by both the Next.js app and the worker |

New environment variables: `SNAPSHOT_RETENTION_DAYS` (default `14`), `NEXT_PUBLIC_LIVEKIT_URL`. Already planned: `NIC_PEPPER`, the session secret, the Supabase keys, and the LiveKit key and secret. Gemini keys go **only** in the worker environment. There is no Discord/Telegram alert webhook.

---

## 8. Edits to make in `implementation-plan.md`

| Task | Change |
|---|---|
| 0.10 | Response is `{ ok, time }`, `503 { ok: false }` on failure; no detail |
| 1C.4 | Cap 100 rows per request, batches of 50 from the client, `dry_run` first, `on_duplicate` |
| 1C.5 | Add files `app/api/admin/candidates/[id]/route.ts` (PATCH, DELETE) and optional `[id]/unlock/route.ts` |
| 1D.3 | Add `app/api/admin/exams/[id]/candidates/route.ts` (GET, POST, DELETE). Unassign refuses started attempts (`blocked`) |
| 1D.4 | Add `app/api/admin/exams/[id]/route.ts` (GET, PATCH, DELETE). `status` only changes `draft` ↔ `scheduled` here; lock navigation, shuffle, duration, scheduled time, instructions and practice status from `live`, and lock `flag_threshold` at `finalized` |
| 1E.6 / 1E.7 | Add `questions/[id]/route.ts`, `questions/reorder/route.ts`. Lock rule and sanitizer allowlist from 4.3. `answer-keys/route.ts` is `GET` + `PUT` |
| 2A.2 | Add the exam-selection rules, `multiple_exams`, and the MULTI_LOGIN / RECONNECTED rule (3.3) |
| 2A.5 / 2A.6 / 2B.6 | The confirm screen only navigates. Acknowledge is called once from the rules screen with both flags |
| ➕ 2A.7 | `GET /api/auth/me` (3.4) |
| ➕ 2A.8 | `POST /api/auth/logout` (3.6) |
| 2B.3 / 2B.5 | Heartbeat returns the same `StateBody` and is the 10 s poll. Add `phase` and `announcements` to state |
| 2C.1 | Response shape from 3.8. Options have no `label`; the UI letters them A, B, C… by position |
| 2E.2 / 2E.4 | Revision rule from 3.9 (continue from the server revision; recover on `stale_revision` using `server_revision`) |
| 2F.1 / 2F.2 | Submit accepts `pending_answers` and requires `in_progress` (3.11) |
| 2F.6 | On `last_question` the route saves the answer; the other results return the new question in the same response (3.10) |
| 3B.1 / 3B.3 | Snapshot is sent inside `POST /api/events` as base64; **remove "upload to Storage" from the browser**. Server decides `counts`. Add `occurred_ago_ms` |
| 3B.4 | Heartbeat writes `RECONNECTED` with the gap and returns state |
| ➕ 3B.6 | Worker writes `DISCONNECTED` (section 7) |
| 4A.3 | Token rules from 3.14 (identities, grants, `as` field, admin `autoSubscribe: false`) |
| 4C.2 | Poll `attempt_progress` every 10 s |
| 5A.1 to 5A.5 | Bodies, preconditions and compare-and-set from 4.4. Force-end and force-submit need `confirm: true` |
| 5A.6 | Use the action names in 1.6 |
| 5C.2 | The health route reads `api_key_state` and never holds Gemini keys. Add the listing check to the worker |
| ➕ 6A.9 | Worker key check every 5 minutes |
| 6D.1 | Add `missing_answer_keys`, MCQ scoring and auto-zero in the route, and the results formula (4.6.1) |
| 6D.2, 6D.5 | Bodies and errors from 4.6 |
| 6D.6 | Path is `app/api/admin/results/[attempt]/regrade/route.ts` |
| ➕ 6D.8 | Add route `app/api/admin/exams/[id]/regrade-question/route.ts` (Section 5 §8.4) |
| 7.4 | CSV columns (including `unscored_count` after `needs_review_count`) and formula-injection guard from 4.6 |
| 7.7 | Both: daily worker job and `POST /api/admin/snapshots/purge` |
| 0.4 / §14.1 | Add `SNAPSHOT_RETENTION_DAYS`, `NEXT_PUBLIC_LIVEKIT_URL` |
| Phase 8 | Add the tests in section 9 |

---

## 9. Tests to add to Phase 8

1. Login: wrong ID, unknown MER and inactive candidate all return the same `401`; the sixth wrong try for one MER returns `429`; 23 people logging in correctly from one IP never hit the IP limit.
2. Login twice for one candidate: the first session's next call returns `401 session_revoked`, and a `MULTI_LOGIN` row exists when the first was live, `RECONNECTED` when it was not.
3. A candidate with two assigned open exams gets `409 multiple_exams`, then logs in with `exam_id`.
4. `GET /api/exam/paper` before the exam is live returns `409 exam_not_live` and creates no `attempt_questions`.
5. Sequential mode: the paper response contains exactly one question; a save for a different question returns `wrong_position`; two identical Next calls return `advanced` then `already_advanced`.
6. Last question: type an answer and press Submit; the answer is stored. Also call `POST /api/exam/next` directly on the last question with an answer: the result is `last_question` and the answer is still stored (item 4 of section 0).
7. Revision recovery: save revision 5, clear IndexedDB, reconnect, type again: the new save is accepted (item 2 of section 0).
8. `POST /api/exam/submit` from the waiting room returns `409 not_started`.
9. Submit with `pending_answers` at the deadline stores them and closes the attempt; one more save afterwards returns `closed`.
10. `POST /api/events` with a bad JPEG keeps the event and sets `meta.snapshot_error`; `DISCONNECTED` from a client returns `400`; waiting-room events have `counts = false`.
11. Candidate calls to any `/api/admin/*` route return `401` or `403`; an admin without a profile row gets `403`.
12. `PATCH` on `navigation_mode` after start returns `409 exam_locked`; question create, delete and reorder after start do the same; an answer-key edit after start succeeds.
13. Two admins extend the exam at the same moment: both extensions are applied.
14. Force-end: screens lock immediately; a connected candidate's pending and partial written answer is accepted inside the 15-second collection window and submitted as `forced`; a later write is rejected; the worker force-submits disconnected and never-started attempts after the window.
15. Unassigning a started candidate returns them in `blocked`.
16. `grade` before finalization returns `409`; with a missing key returns `missing_answer_keys`; a blank written answer is scored 0 with no Gemini job.
17. Override then regrade the same question: the override stays current and `override_present` is `true`.
18. The CSV opens in Excel with Sinhala names intact and no cell starts with an unescaped `=`.
19. Pull the worker: `DISCONNECTED` appears about 30 s after a candidate closes the tab, and `RECONNECTED` with a duration appears when they return.
20. On the real web host, measure Argon2 hash and verify latency with the production policy. Exercise the expected concurrent exam-start login burst and record Node thread-pool concurrency, peak memory and response latency; the rehearsal fails if async verifications exhaust memory or make login unacceptably slow.

---

## 10. Two things I need from you

1. ~~**Snapshot retention:** is **30 days** right for the rules screen?~~ **Decided: 14 days.** Updated in all four places.
2. ~~**Waiting-room incidents:** I set them to not count toward the flag threshold.~~ **Decided: waiting-room incidents have `counts = false`. If the same fault continues into the exam without being fixed, exam-phase incidents count.**
