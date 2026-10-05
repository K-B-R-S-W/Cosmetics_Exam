# Implementation Plan — Exam Platform

Detailed task breakdown for each phase. Tasks are ordered by dependency within each phase.

> [!IMPORTANT]
> This plan incorporates all fixes from `Issues.md` (rounds 1–22). Changes are marked with 🔧 (fix) or ➕ (new task).
> Round 2: 🔧². Round 3: 🔧³. Round 4: 🔧⁴. Round 5: 🔧⁵. Round 6: 🔧⁶. Round 7: 🔧⁷. Round 8: 🔧⁸. Round 9: 🔧⁹. Round 10: 🔧¹⁰. Round 11: 🔧¹¹. Round 12: 🔧¹². Round 13: 🔧¹³. Round 14: 🔧¹⁴. Round 15: 🔧¹⁵. Round 16: 🔧¹⁶. Round 17: 🔧¹⁷. Round 18: 🔧¹⁸. Round 19: 🔧¹⁹. Round 20: 🔧²⁰. Round 21: 🔧²¹. Round 22: 🔧²².

---

## Phase 0 — Setup (0.5–1 day)

**Dependencies:** none

### Tasks

| # | Task | Files | Details |
|---|---|---|---|
| 0.1 | Initialize Next.js + TypeScript | `apps/web/` | `npx create-next-app@latest` with App Router, TypeScript, ESLint |
| 0.2 | Install core dependencies | `package.json` | `@supabase/supabase-js`, `@supabase/ssr`, `iron-session`, 🔧 `sanitize-html` (replaces `dompurify` — needs browser DOM on server), `@node-rs/argon2` |
| 0.3 | Supabase project setup | Supabase dashboard | Create project, note URL + anon key + service role key |
| 0.4 | Environment config | `.env.local`, `.env.example`, `infra/env/` | All variables from §14.1; template files in `infra/env/web.env.example` and `infra/env/worker.env.example` (Section 6 §1). No Discord or Telegram webhook. 🔧⁹ **Add `SNAPSHOT_RETENTION_DAYS`** (default `14`), **`NEXT_PUBLIC_LIVEKIT_URL`**. 🔧²¹ **Add worker-only variables** (never on Vercel): `GEMINI_KEY_1`..`GEMINI_KEY_3`, `GEMINI_MODEL` (`gemini-3.7-flash`), `GEMINI_DAILY_LIMITS`, `GRADING_CHUNK_SIZE` (10), `GRADING_SLOT_MIN_INTERVAL_MS` (12000), `GRADING_RESERVE` (1), `GRADING_REQUEST_TIMEOUT_MS` (90000), `GRADING_MAX_TRIES` (4), `GRADING_PAUSE_AFTER_MIN` (15), `GRADING_MARK_STEP` (0.5), `REVIEW_CONFIDENCE` (0.6), `REVIEW_CONFIDENCE_SINGLISH` (0.75), `GRADING_MAX_ANSWER_CHARS` (6000), `GRADING_PROMPT_VERSION` (`g1`), `GEMINI_THINKING`. 🔧²² **Credentials persistence**: `SESSION_SECRET` and `NIC_PEPPER` must be stored in a password manager and must never change once candidates are imported (Section 6 §7) |
| 0.5 | Supabase client helpers | `lib/supabase/server.ts`, `lib/supabase/client.ts` | Server client (service role), browser client (anon key for admin Realtime only) |
| 0.6 | iron-session config | `lib/session.ts` | Session options with `secure: process.env.NODE_ENV === 'production'`, cookie name, TTL = exam duration + 2 hours |
| 0.7 | Vercel project | Vercel dashboard | Connect repo, set env vars, confirm auto-deploy |
| 0.8 | Git repo + structure | root | Create folder structure from §14.6; initial commit. 🔧²² Add `infra/livekit`, `infra/ec2`, and `infra/env` directories (Section 6 §1) |
| ➕ 0.9 | Logger config | `lib/logger.ts` | 🔧 Configure logger to **never log request bodies** — NIC/ID data must not appear in logs |
| ➕ 0.10 | Public health endpoint | `app/api/health/route.ts` | 🔧🔧⁹ Simple public endpoint for UptimeRobot. Response: `{ ok: true, time }` on success; `503 { ok: false }` on Supabase failure. No detail |
| ➕ 0.11 | Design foundation | `styles/`, `app/layout.tsx`, `public/brand/` | Tailwind v4 CSS `@theme` tokens; global and tablet rules; Atkinson Hyperlegible + Noto Sans Sinhala via `next/font`; approved PNG logos and logo favicon; raw colours linted outside `styles/tokens.css`. Do not create `tailwind.config` |

**Done when:** deployed app reads a row from Supabase and iron-session creates a test cookie on localhost.

---

## Phase 1 — Schema, Admin Auth, Candidates, Questions (2–3 days)

**Dependencies:** Phase 0

### 1A — Database (0.5 day)

> [!IMPORTANT]
> 🔧⁶ **Section 1 is written.** The full migration SQL, smoke test, and per-task edits are in [`SECTIONS/section-1-migration.md`](file:///e:/1.%20Projects/Cosmetics.lk/Projects/Cosmetics_Exam/SECTIONS/section-1-migration.md). The individual schema tasks below are kept for reference, but **do not hand-write SQL from them** — use the written `001_initial.sql` file.

| # | Task | Files | Details |
|---|---|---|---|
| 1A.1 | Run migration | `supabase/migrations/001_initial.sql` | 🔧³🔧⁶🔧⁷ Save `SECTIONS/001_initial.sql` as `supabase/migrations/001_initial.sql`. Run in the Supabase SQL editor. **Requires a fresh Supabase project** (the file creates tables, publications, and a storage bucket — it is not re-runnable). **Requires Postgres 15+** (`security_invoker` views). New Supabase projects have this. The SQL has never been executed — the smoke test is the real proof. Do **not** hand-write schema from the task rows below — the file is the source of truth |
| ➕ 1A.2b | Run grading migration | `supabase/migrations/002_grading.sql` | 🔧²¹ Save `SECTIONS/002_grading.sql` as `supabase/migrations/002_grading.sql`. Run in Supabase SQL editor after `001_initial.sql` (Section 5 §12.3). Adds `model` column to `grading_log` and `grading_jobs`, index `idx_grading_log_usage` for fast daily call budget lookups, and unique index `uq_question_scores_job_question` on `question_scores (job_id, question_id)` for idempotent AI writes |
| 1A.2 | Run smoke test | `SECTIONS/001_smoke_test.sql` | 🔧⁶🔧⁷ Run in SQL editor after migrations. It verifies explicit Data API grants by role, denied anon/authenticated behavior, service-role RPC access, announcement limits, attempt auto-creation, paper idempotency, sequential Next + idempotency, position guard, revision rule, submit + closed saves, override-wins scoring, incident counting, alert dedup, multi-chunk grading jobs, disconnect resolution/reversal (blocks 10–11), and 🔧²¹ idempotent AI score writes (block 12). Rolls itself back. **Expect the notice `SMOKE TEST PASSED`** |
| 1A.3 | Verify RLS and grants | Dashboard + SQL smoke test | RLS is enabled on every application table. `anon` has no public-schema access. `authenticated` has read-only access only to its own admin profile and the six Realtime tables, with admin/super-admin RLS. All writes and other reads use server routes with `service_role` |
| 1A.4 | Verify Realtime | Dashboard → Replication | 🔧⁶ Done in the migration: `attempts`, `violation_events`, `grading_jobs`, `grading_log`, `alerts`, `exams` |
| 1A.5 | Verify Storage | Dashboard | 🔧⁶ Done in the migration: private `snapshots` bucket + admin read policy |
| 1A.6 | Seed admin users | Dashboard + SQL | 🔧⁶ Create users in Dashboard → Auth → Users, then `INSERT INTO admin_profiles (id, name, role) VALUES ('<uuid>', 'Name', 'super_admin')`. `api_key_state` (key1–key3) and `system_health` (worker) are seeded by the migration |

**What the migration provides (reference — do not duplicate):**

| Area | What |
|---|---|
| Tables | `admin_profiles`, `candidates` (🔧⁵ no `photo_url`), `exams` (incl. `ends_at`, `force_ended_at`, `navigation_mode`), `exam_candidates`, `questions`, `mcq_options`, `answer_keys`, `attempts` (incl. `current_position`, `submit_reason`, `extra_minutes`, `violation_count`), `attempt_questions` (incl. `option_order`), `sessions`, `answers` (incl. `revision`, `flagged`), `violation_events` (🔧⁶ one row per incident: `type`, `merged_types`, `counts`, `snapshot_path`), `grading_runs` (incl. `kind`), `grading_jobs` (🔧⁶ `chunk_index` added, unique on `(run_id, attempt_id, chunk_index)`), `question_scores` (incl. `details`, `needs_review`, `job_id`), `results`, `api_key_state`, `grading_log`, `login_attempts` (incl. `success`), `alerts` (incl. `severity`, `unique_key`; dedup via partial unique index), `system_health`, `admin_actions`, `broadcasts` |
| Functions | `generate_paper(p_attempt_id)` — atomic paper creation, locks attempt row, moves to `in_progress`; `save_answer(...)` — revision check, deadline+15s, force-end, position guard, option validation, all with DB clock; `advance_position(...)` — sequential Next, idempotent via `expected_position`; `submit_attempt(p_attempt_id, p_reason)` — idempotent submit |
| Triggers | `sync_attempt_on_assign` (🔧⁶ auto-creates attempt on `exam_candidates` insert), `bump_violation_count` (increments `attempts.violation_count` only for `counts = true` incidents), `set_updated_at` on results |
| Views | `current_scores` (override always wins, then latest `created_at`), `attempt_progress` (for admin grid: `current_position`, `total_questions`, `answered_count`, `flagged_count`), `attempt_deadlines` (per-attempt `deadline` and `grace_deadline` for the scheduler) |
| Hardening | One final grants block revokes Data API defaults, sets `FOR ROLE postgres` default privileges, gives `anon` no access, gives `authenticated` only admin-profile/Realtime reads, and grants explicit table, view, sequence and RPC access to `service_role` |

**Done when:** 🔧⁷🔧²¹ migrations `001_initial.sql` and `002_grading.sql` run without errors; smoke test (blocks 1–12) prints `SMOKE TEST PASSED`; Dashboard shows RLS enabled on all tables, Realtime on the 6 listed tables, and the `snapshots` bucket exists.

### 1B — Admin Auth + Layout (0.5 day)

| # | Task | Files |
|---|---|---|
| 1B.1 | Admin login page | `app/(admin)/admin/login/page.tsx` |
| 1B.2 | Auth middleware | `middleware.ts` or layout-level check |
| 1B.3 | Admin layout with sidebar | `app/(admin)/admin/layout.tsx` |
| 1B.4 | Role-based access helper | `lib/auth.ts` — `requireAdmin()`, `requireSuperAdmin()` |
| 🔧 1B.5 | Auth in route handlers | All admin API routes | 🔧 Call `requireAdmin()` **inside every admin route handler**, not only in middleware. Defense in depth against Next.js middleware bypass |

### 1C — Candidates (0.5 day)

| # | Task | Files |
|---|---|---|
| 1C.1 | NIC hashing utility | `lib/hashing.ts` — 🔧 **normalize before hashing**: trim whitespace, uppercase, convert old NIC format (9-digit + V/X) ↔ new format (12-digit). Use `@node-rs/argon2` (native `argon2` breaks on Vercel) + pepper |
| 1C.2 | Candidate list page | `app/(admin)/admin/candidates/page.tsx` |
| 1C.3 | Add/edit candidate form | `app/(admin)/admin/candidates/[id]/page.tsx` — 🔧⁵🔧⁶ **No photo field** (everyone is in the office; `photo_url` removed from schema) |
| 1C.4 | CSV import | `app/api/admin/candidates/import/route.ts` — 🔧⁹ **Cap 100 rows per request** (hashing 300 NICs with argon2 risks the Vercel function time limit). Client sends batches of 50. Support `dry_run` mode and `on_duplicate` strategy |
| 1C.5 | Candidate API routes | `app/api/admin/candidates/route.ts` — 🔧⁹ **Add `app/api/admin/candidates/[id]/route.ts`** (PATCH, DELETE) and optional `[id]/unlock/route.ts` (clears `login_attempts` for that MER) |

### 1D — Exams (0.5 day)

| # | Task | Files |
|---|---|---|
| 1D.1 | Exam list page | `app/(admin)/admin/exams/page.tsx` |
| 1D.2 | Create/edit exam form | `app/(admin)/admin/exams/[id]/page.tsx` — includes `shuffle`, `flag_threshold`, and schedule. There is no fixed question count: every candidate receives every question the admin composes. 🔧 **Convert Colombo time input to UTC** before storing. 🔧³ **Add `navigation_mode` toggle** (sequential / free). Locked once exam is live. 🔧¹⁹ `flag_threshold` defaults to **10**, range **1–100** (Section 4 §4.2) |
| 1D.3 | Assign candidates to exam | Same page or sub-page. 🔧⁶ **Assigning a candidate auto-creates their attempt** (DB trigger on `exam_candidates`). Unassigning removes the attempt only if still `not_started`. The admin live grid shows "Not joined" for all assigned candidates before anyone logs in. 🔧⁹ **Add `app/api/admin/exams/[id]/candidates/route.ts`** (GET, POST, DELETE). 🔧¹⁰ Unassign returns `200 { removed: [...], blocked: [...] }` (not 409) — tells the admin which candidates couldn’t be removed because their attempt has started |
| 1D.4 | Exam API routes | `app/api/admin/exams/route.ts` — enforce settings locks server-side: navigation, shuffle, duration, scheduled time, instructions and practice status lock once live. `flag_threshold` remains editable through ended and locks at finalized; title remains editable. 🔧⁹ **Add `app/api/admin/exams/[id]/route.ts`** (GET, PATCH, DELETE). `status` only changes `draft` ↔ `scheduled` here |

### 1E — Question Builder (1 day)

| # | Task | Files |
|---|---|---|
| 1E.1 | Install Tiptap | `package.json` — `@tiptap/react`, `@tiptap/starter-kit`, extensions |
| 1E.2 | Tiptap editor component | `components/editor/TiptapEditor.tsx` — toolbar matches Section 3: bold, italic, underline, strike, lists, headings 2–3 and a small custom font-size extension; no subscript, superscript or inline image tool. Add the separate optional question-image upload/preview/replace/remove control for JPEG, PNG and WebP up to 4 MiB with required alt text |
| 1E.3 | Question builder page | `app/(admin)/admin/exams/[id]/questions/page.tsx` |
| 1E.4 | MCQ option editor | `components/editor/McqOptions.tsx` — add/remove options, mark correct |
| 1E.5 | Written answer fields | Model answer, grading notes, calibration examples |
| 1E.6 | Drag-and-drop ordering | Question position reordering. 🔧⁹ **Add `app/api/admin/questions/reorder/route.ts`** |
| 1E.7 | Question API routes | `app/api/admin/questions/route.ts`, `app/api/admin/questions/[id]/route.ts`, `app/api/admin/questions/reorder/route.ts`, `app/api/admin/answer-keys/route.ts`, and `app/api/admin/question-images/route.ts`. Sanitize in TypeScript, verify uploaded image metadata against private Storage, then use migration 005's atomic `save_question`, `delete_question`, `reorder_questions`, and `save_answer_key` functions. Question/option/image changes lock once live; answer-key edits remain allowed except while grading is running or paused. Stable client-generated question and option UUIDs make retries idempotent. The HTML allowlist is Section 3 §4.3: `p br strong b em i u s ul ol li span h2 h3`; option text excludes headings, `span` allows only the contractual font-size style, and sub/sup are not offered or stored |
| 1E.8 | Server-side HTML sanitization | 🔧 Use `sanitize-html` (not `dompurify`) — sanitize all HTML before DB write |

**Done when:** an admin builds an exam with any number of mixed MCQ and written questions, assigns 23 candidates, and every candidate receives the complete composed paper.

---

## Phase 2 — Candidate Login and Exam Engine (3–4 days)

**Dependencies:** Phase 1

### 2A — Candidate Auth (0.5 day)

| # | Task | Files |
|---|---|---|
| 2A.1 | Login page | `app/(candidate)/login/page.tsx` — MER code + NIC input. 🔧 **Show which exam** the candidate is joining if multiple exist |
| 2A.2 | Login API | `app/api/auth/login/route.ts` — 🔧 Normalize NIC → hash → verify; check `login_attempts` rate limit (**failed only**); 🔧 **check candidate is assigned to the exam**; create iron-session; revoke older sessions. 🔧⁹ **Exam selection**: if the candidate is assigned to exactly one live/scheduled exam, use it. If multiple, require `exam_id` in the request or return `409 multiple_exams`. Log a `MULTI_LOGIN` event when revoking a session that was in-progress; log `RECONNECTED` when the previous session was not in-progress. **Unknown MER timing:** verify against a real dummy hash made with the same Argon2 policy and `NIC_PEPPER`; create and cache it once per server process so an unknown MER is not a faster path |
| 2A.3 | Rate limit check | Query `login_attempts` for count of 🔧 **`success = false`** in last 10 min per MER and per IP. 🔧¹⁰ **All 23 candidates share one office IP** — set the per-IP threshold high enough so legitimate logins are never blocked. The per-MER limit (5 failures) is the real protection. 🔧²² Set per-IP threshold at ~200 failed attempts per 10 min and per-MER limit at 5 (Section 6 §7) |
| 2A.4 | Session middleware | `lib/session.ts` — `getSession()` helper for candidate routes. 🔧 **Check session ID against `sessions.revoked_at`** on every candidate API call (not just at login) — makes session revocation actually enforced |
| 2A.5 | Confirmation page | `app/(candidate)/confirm/page.tsx` — 🔧⁵ show name and outlet **(no photo)**, acknowledge button. 🔧⁹ **This page only navigates** — no API call. The actual acknowledge call happens from the rules screen |
| 2A.6 | Acknowledge API | `app/api/auth/acknowledge/route.ts` — 🔧⁹ **Called once from the rules screen** with both `identity_confirmed` and `rules_accepted` flags. `acknowledged` means identity confirmed **and** rules accepted. Idempotent |
| ➕ 2A.7 | Me API | 🔧⁹ `app/api/auth/me/route.ts` — `GET /api/auth/me`. Returns candidate name, outlet, exam title, and attempt status. Used by the confirm and rules screens to show identity and exam info |
| ➕ 2A.8 | Logout API | 🔧⁹ `app/api/auth/logout/route.ts` — `POST /api/auth/logout`. Revokes the session and clears the cookie. Called from the Done page |

### 2B — Waiting Room + Broadcast (0.5 day)

| # | Task | Files |
|---|---|---|
| 2B.1 | Broadcast channel hook | `lib/broadcast.ts` — subscribe to `exam:{examId}` channel |
| 2B.2 | Broadcast publish helper | `lib/broadcast-server.ts` — server-side publish for admin actions |
| 2B.3 | Waiting room page | `app/(candidate)/waiting/page.tsx` — countdown, camera preview, Broadcast listener. 🔧 **Enforce fullscreen here too** with blocking overlay. 🔧² **Add 5–10 second interval poll** of exam state API as fallback. 🔧⁹ **Heartbeat is the poll**: `POST /api/heartbeat` every 10s returns the state body. 🔧¹⁰ **State body uses the contract's shape** (not `{ phase, remaining_s, broadcast }`): returns `server_time`, exam details (including `scheduled_start_at`, `ends_at`, `navigation_mode`), and attempt details (including `deadline`). The plan's simpler shape couldn't drive the countdown when the admin starts the exam manually or changes the time |
| 2B.4 | Time sync | `app/api/time/route.ts` + `lib/time.ts` — server clock offset calculation |
| 2B.5 | Exam state API (fallback) | `app/api/exam/state/route.ts` — 🔧²🔧⁹🔧¹⁰ Returns the same full state body as the heartbeat (server_time + exam + attempt). Heartbeat returns this same shape, so the waiting room doesn't need a separate poll |
| ➕ 2B.6 | Consent / rules screen | `app/(candidate)/rules/page.tsx` | 🔧 Display: camera and audio are monitored live, snapshots are stored, and when they'll be deleted. 🔧² **Include specific deletion timeframe**. 🔧¹⁰ **Show the retention number from `/api/auth/me`** (14 days). 🔧³ **State which navigation mode applies** (sequential or free). 🔧⁵ **Include candidate setup instructions**: Laptops — use a Chrome Guest window, no second screen, camera and mic on. Tablets — Chrome only, "Desktop site" off, run the pre-exam check the day before (for first-time OS camera permissions). These instructions currently live only in the old main plan. Must be acknowledged before proceeding |

### 2C — Paper Delivery (0.5 day)

| # | Task | Files |
|---|---|---|
| 2C.1 | Paper API | `app/api/exam/paper/route.ts` | 🔧³ **Mode-aware**: in `free` mode, return all questions. In `sequential` mode, return **only the current question** (by `current_position`) plus the total count ("Question 7 of 20"). 🔧⁹ **Options have no `label`** — the fixed `mcq_options.label` (a,b,c,d) would read "c,a,d,b" after shuffling. The UI letters options A,B,C… by position instead. **Return saved `revision`** for each answer so the client can resume its counter after reconnect |
| 2C.2 | Complete paper creation | 🔧🔧⁶ Call `supabase.rpc('generate_paper', { p_attempt_id })`. The DB function atomically assigns every composed question, handles shuffle and option order, and moves the attempt to `in_progress`. If `attempt_questions` already exist, it returns the saved paper (idempotent). Map raised exceptions: `not_acknowledged` → 403, `attempt_closed`/`exam_not_live` → 409, `exam_has_no_questions` → 409 |
| 2C.3 | Shuffle logic | 🔧⁶ **Handled inside `generate_paper()`** — if `shuffle` is enabled, question order and option order are both randomized atomically. The API route does not implement shuffle separately |

### 2D — Exam UI (1 day)

| # | Task | Files |
|---|---|---|
| 2D.1 | Exam page layout | `app/(candidate)/exam/page.tsx` — timer, save indicator. 🔧² **All candidate page transitions must be client-side navigation** (`router.push` / `<Link>`), never full page loads — a full reload kills fullscreen and the LiveKit connection. 🔧³ **Two layout modes**: free mode shows a question list sidebar (answered/unanswered indicators, Previous/Next, summary screen before submit); sequential mode shows one question at a time with a Next button only. 🔧³ **Block browser Back button** (`history.pushState` loop or `beforeunload`) so it doesn't leave the exam page. 🔧⁴ **Set `overscroll-behavior: none`** on the exam page — pull-to-refresh on Android reloads the page, exits fullscreen, and drops the camera. 🔧⁴ **Use `100dvh`** (not `100vh`) for layouts — on Android the on-screen keyboard resizes the viewport; `dvh` keeps the timer/Next/Submit button visible above it |
| 2D.2 | Question renderer | `components/exam/QuestionCard.tsx` — renders HTML body, MCQ radios 🔧 **using saved `option_order`**, written textarea |
| 2D.3 | Timer component | `components/exam/Timer.tsx` — server-synced with offset. 🔧 Deadline = `exams.ends_at + attempts.extra_minutes` |
| 2D.4 | Save indicator | `components/exam/SaveIndicator.tsx` — word-and-icon Waiting, Saving, Saved, Offline, Retrying and Failed states; colour is secondary and announcements are limited to problem transitions and recovery |
| 2D.5 | MCQ answer handler | Radio button selection → state |
| 2D.6 | Written answer handler | Textarea with Unicode Sinhala support. 🔧⁴ **Disable `autocorrect`, `autocomplete`, and `spellcheck`** on the answer textarea. Never rely on `keydown` events (Android keyboards report generic key codes) — use `input` events instead |
| ➕ 2D.7 | Sequential mode Next button | 🔧³ `components/exam/NextButton.tsx` — warns when answer is blank ("You can't come back to this question"). On the last question, button becomes "Submit Exam". Waits for server confirmation before advancing; if connection is down, shows "Reconnecting…" instead of advancing. IndexedDB still protects the text locally. 🔧⁴ **Debounce / disable on click** to prevent double-taps (see 2F.6 for server-side idempotency) |
| ➕ 2D.8 | Free mode question list | 🔧³ `components/exam/QuestionList.tsx` — sidebar listing all questions with answered/unanswered/🔧⁴ **flagged** indicators (reads `answers.flagged`). Click to jump to any question. 🔧⁴ **Flag toggle button** on each question. Summary screen before final submit shows unanswered and flagged questions |
| ➕ 2D.9 | Touch layout | 🔧⁴ `styles/tablet.css` or responsive rules — **768–1024px widths** in both orientations. Minimum **44px touch targets** on all interactive elements. No hover-only controls. Ensure question list sidebar is usable on tablet portrait |

### 2E — Autosave + Offline (0.5 day)

| # | Task | Files |
|---|---|---|
| 2E.1 | IndexedDB helper | `lib/indexeddb.ts` — save/load/queue operations |
| 2E.2 | Autosave hook | `hooks/useAutosave.ts` — debounce 1s, periodic 10s, IndexedDB write before server upsert, and a ready gate that disables inputs until restore finishes. 🔧 **Increment `revision` integer per question per save** (client-side counter). 🔧⁹ **Revision recovery on reconnect**: a dirty local draft wins only while the server revision equals this device's last confirmed revision; if the server is ahead, discard the local draft. Retry `stale_revision` once with `server_revision + 1` |
| 2E.3 | Retry queue | Retry only network and 5xx failures. `wrong_position`, `not_in_paper`, and `bad_option` are dropped; every other 4xx stays dirty for final `pending_answers` and shows Failed until the value changes. The indicator has word-and-icon states and degraded copy when IndexedDB is unavailable |
| 2E.4 | Answers API | `app/api/answers/route.ts` — 🔧⁶ **Call `supabase.rpc('save_answer', { p_attempt_id, p_question_id, p_answer_text, p_selected_option_id, p_flagged, p_revision })`**. The DB function enforces: revision check (only higher overwrites), deadline + 15s grace (DB clock), force-end, attempt/exam status, sequential position guard (current question only), and option validation — all atomically. Map results: `saved` → 200, `stale_revision` → 200 (client drops queued write; 🔧⁹ **return `server_revision`** so client can recover), `closed` → 409 (client locks UI), `wrong_position` → 409, `not_in_paper`/`bad_option` → 400, `not_found` → 404 |

### 2F — Submit + Reconnect (0.5 day)

| # | Task | Files |
|---|---|---|
| 2F.1 | Submit API | `app/api/exam/submit/route.ts` — idempotent and restricted to `in_progress`. Accept up to 200 `pending_answers`, save them with concurrency at most 8, return per-answer results, and call `submit_attempt` even when an individual save fails. The client reason is only a hint: derive `manual` while live, `auto` after the ordinary deadline, and `forced` after admin force-end; reject a client-supplied `forced` |
| 🔧² 2F.2 | Manual submit + auto-submit | Manual **Submit exam** opens the Section 2B dialog: **Submit your exam?** / **You can't change your answers after you submit.** with the optional unanswered count. In sequential mode, the last question button becomes Submit exam. At the deadline lock all inputs, drain `/api/answers`, send the remainder as `pending_answers` with the `auto` hint during the 15-second grace, and show the terminal unsent-answer notice when collection closes |
| 2F.3 | Done page | `app/(candidate)/done/page.tsx` — "Submitted" confirmation |
| 2F.4 | Reconnect flow | Login with same MER + ID → load existing attempt, saved answers, same complete paper with the same question and option order, remaining time. 🔧³ **In sequential mode, resume at `current_position`** (not question 1). The paper API returns only that question |
| 2F.5 | Worker scheduler | `worker/` runs a non-overlapping scheduler tick every 10 seconds. Three conservative discovery reads identify work up to 60 seconds early; database-authoritative `start_exam`, `submit_due_attempt`, and `finalize_exam_if_closed` RPCs make every transition. Ordinary open attempts submit after their own `grace_deadline` as `auto`; force-ended open attempts submit after `force_ended_at + 15 seconds` as `forced`; no answers are synthesized. An ordinary exam is `ended` for one tick before finalization. The worker sends no start Broadcast and logs only changes/errors |
| 2F.6 | Next question API | `app/api/exam/next/route.ts` — apply the route-level deadline rule with no grace, then call `advance_position`. `advanced`, `already_advanced`, and `out_of_sync` return the single target question and answer. `last_question` saves a non-blank direct answer and returns `{ result: "last_question", position }` with no `submit_now`. The client shows Submit exam. A cleared answer is confirmed through `/api/answers` before Next |

**Done when:** a test candidate gets every composed question, answers some, disconnects, reconnects and sees the same paper with saved answers and the same shuffled question/option order, and gets auto-submitted at deadline. In sequential mode, reconnect resumes at the correct position and earlier questions can't be re-answered.

**Current local status:** Phase 2 is locally complete, including mocked scheduler and standalone-bundle verification. Credential-backed browser/Supabase rehearsal remains manual. Production worker deployment is blocked until the single-instance guard (6A.1) and heartbeat (6A.6) exist, and the worker must be deployed before any real exam.

---

## Phase 3 — Proctoring and Logs (2–3 days)

**Dependencies:** Phase 2

### 3A — Proctoring Events (1 day)

| # | Task | Files |
|---|---|---|
| 3A.1 | Proctoring hook | `hooks/useProctoring.ts` — 🔧¹⁹ Full incident lifecycle from Section 4 §3. Attention signals merge while open; episodes send on end; instants send immediately. Each incident gets a client UUID. The queue is mirrored to `sessionStorage`, capped at 50, and **drops the oldest** on overflow. Retry network errors, 5xx and 429 with 2s/5s/10s/30s backoff (honor a longer retry hint); drop 400/401/403. Recalculate `occurred_ago_ms` per send. Split an open incident at exam start, flush for up to 2s before submit, and use an idempotent `sendBeacon` fallback on pagehide. A frozen tab is covered by disconnect handling. Server decides `counts`. |
| 3A.2 | Visibility change handler | `visibilitychange` → `TAB_HIDDEN`. 🔧¹⁹ No debounce, but the whole incident is dropped if it lasted < `MIN_INCIDENT_MS` (1000ms) and contains nothing else (Section 4 §3.3) |
| 3A.3 | Focus handler | `window blur` + 1s `document.hasFocus()` check → `FOCUS_LOST`. 🔧¹⁹ Ignored if focus returns within `FOCUS_GRACE_MS` (1000ms) — removes Android notification shade / edge panel false events (Section 4 §3.3) |
| 3A.4 | Fullscreen handler | `fullscreenchange` → `FULLSCREEN_EXIT` + blocking overlay. 🔧⁴🔧⁵ **Lock orientation** after entering fullscreen — lock to **the orientation the candidate is already in** (`screen.orientation.lock(screen.orientation.type)` on Android — only works in fullscreen). Do NOT hardcode `'portrait'` — tablets are often held in landscape and forcing portrait would cause an unwanted rotation. Unlock orientation when fullscreen ends. 🔧¹⁹ Never dropped — the overlay appears at once, so it is always logged (Section 4 §3.3) |
| 3A.5 | Viewport check | 🔧 **Only run while in fullscreen**. 1s interval: `innerWidth` vs `screen.width` × `VIEWPORT_TOLERANCE` (0.98) → `VIEWPORT_CHANGED` (width-only on Android). 🔧⁴ "Desktop site" mode warning. 🔧¹⁹ Needs `VIEWPORT_CONFIRM_TICKS` (2) consecutive failed checks (Section 4 §3.3) |
| 3A.6 | Multi-screen check | 🔧⁴ Guard `screen.isExtended`. `MULTI_SCREEN` only on desktop. 🔧¹⁹ Episode kind: one open episode, sent when it ends (Section 4 §3.1) |
| 3A.7 | Camera/mic loss handler | MediaStreamTrack `ended`/`mute` → `CAMERA_LOST` / `MIC_LOST`. 🔧¹⁹ Episode kind. Set `meta.source = 'track'` for device loss (counts) or `meta.source = 'livekit'` for LiveKit-only loss (does not count). Grace period: `MEDIA_LOSS_GRACE_MS` (5000ms) — browsers briefly mute tracks (Section 4 §2, §3.3) |
| 3A.8 | Copy/paste/context menu | Block and log `COPY`, `PASTE`, `CONTEXT_MENU`. 🔧¹⁹ Instant kind: logged but **do not count** (blocked anyway, tablet long-press triggers context menu). Same type within 3s = one event (Section 4 §2) |
| 3A.9 | Reload detection | On page load during in-progress attempt → `RELOAD`. 🔧¹⁹ Instant kind, **counts** (Section 4 §2) |
| 3A.10 | Fullscreen overlay | `components/exam/FullscreenOverlay.tsx` — blocking until restored |
| ➕ 3A.11 | Snapshot rules | 🔧¹⁹ **Section 4 §6**: At most 1 per incident, max `MAX_SNAPSHOTS_PER_ATTEMPT` (60). 320×240 JPEG quality 0.6 (~15KB, server accepts up to 100KB). Capture at incident **open** if page is visible; for `TAB_HIDDEN` capture at **close** instead (`meta.snapshot_at = 'end'`). Black frame detection: average pixel brightness below `BLACK_LUMA` (12/255) → skip snapshot, set `meta.snapshot_skipped = 'black'`. Camera off = no snapshot. Failed upload keeps the event with `meta.snapshot_error = true`. Retention: `SNAPSHOT_RETENTION_DAYS` (14) |
| ➕ 3A.12 | Proctoring config | 🔧¹⁹ `lib/proctoring-config.ts` (client tunables: grace periods, intervals, limits) and `lib/proctoring-rules.ts` (counting rules, `COUNTING_TYPES` set — imported by both the Next.js app and the worker). All thresholds from Section 4 §8 |

### 3B — Event Logging (0.5 day)

| # | Task | Files |
|---|---|---|
| 3B.1 | Events API | `app/api/events/route.ts` — strict 200 KB schema; unknown keys are rejected, so client/server write-contract changes deploy together and never during an exam. After auth and parse, call migration 007 `record_candidate_event(...)`, which atomically handles duplicate ids, status, 30/min client-event rate limiting, server-side counting, 60-snapshot reservation and late-focus reversal while locking session → exam → attempt. Upload only a returned snapshot path; on failure call `mark_violation_snapshot_failed(id)`. Duplicate ids return 200 without another upload/count; submitted/finalized attempts return ignored. Never return database error text. |
| 3B.2 | Snapshot capture | `lib/snapshot.ts` — capture 320x240 JPEG from video element |
| 3B.3 | Snapshot upload | 🔧⁹ **Removed as a separate step** — the snapshot travels inside `POST /api/events` as base64. The server uploads it to the `snapshots` bucket using the service-role client. **Do not** attempt a direct Storage upload from the browser (the anon key is revoked and the bucket is admin-only) |
| 3B.4 | Heartbeat API | `app/api/heartbeat/route.ts` — after auth, call migration 007 `candidate_heartbeat(session_id)`. It locks session → exam → attempt, updates `last_seen_at`, writes any `RECONNECTED`, and calls the shared gap classifier: `< 2 minutes` is `short_gap`; `>= 2 minutes` applies overlap/long-gap logic. Normalize `server_time` and every returned timestamp with `toISOString()`; contract-test the real RPC-shaped output. This replaces the temporary state poll: two calls per heartbeat including auth, about **138 Data API calls/minute** for 23 candidates, not 276. |
| 3B.5 | Heartbeat hook | `hooks/useHeartbeat.ts` — POST every 10s, replacing `useExamStatePoll` rather than running beside it. Stop on Done. On 401, settle loading and route to the existing unauthenticated/session-revoked screen; test both inside React Strict Mode. |
| ➕ 3B.6 | Worker DISCONNECTED events | Every 30s, a separate proctoring timer and non-overlap guard call migration 007 `record_disconnects()`, `resolve_disconnects()` and `reverse_recent_disconnects()`. It is independent of the 10s lifecycle lane, so a slow proctoring pass cannot skip due submission/finalization. Passes 1 and 2 select at most 500 `in_progress` attempts in UUID order with `FOR UPDATE SKIP LOCKED`; their eligibility predicates are inside the locking SELECT. Pass 1 inserts one unresolved row after 30s unless the latest D/R row is already disconnected. Pass 2 calls the same classifier as heartbeat. The safety net groups by distinct attempt and acquires retained attempt locks in UUID order before processing event ids, matching finalization and preventing a lock-order cycle. Overflow remains eligible next tick. |
| ➕ 3B.7 | Dismiss/restore route | `app/api/admin/events/[id]/route.ts` — strict PATCH body `{ "dismissed": boolean, "note": "..." }` (1–300 chars), then migration 007 `dismiss_violation_event(...)`. The RPC atomically changes `counts`/`meta`, lets the trigger adjust `violation_count`, and writes `event_dismiss`/`event_restore` audit detail. Errors: 404, 409 not_dismissable/not_restorable, 400 note_required. |


### 3C — Admin Violation View (0.5 day)

| # | Task | Files |
|---|---|---|
| 3C.1 | Violation timeline | `components/admin/ViolationTimeline.tsx` — per candidate, all events with snapshots. 🔧¹⁹ Show dismiss/restore action per incident (Section 4 §7.4) |
| 3C.2 | Violation count badges | `components/admin/CandidateBadge.tsx` — 🔧🔧⁶ Read `attempts.violation_count` directly (DB trigger keeps it updated). 🔧¹⁹ **Red**: `violation_count >= flag_threshold`. **Amber**: `violation_count >= ceil(flag_threshold / 2)` and below red (Section 4 §7.1). Subscribe to `attempts` Realtime for live updates. **Toast**: when a tile turns red, show a short toast with the candidate's MER code |
| 3C.3 | Realtime violation updates | Subscribe to `violation_events`. `useViolationRealtime` also listens to `attempts`, but ignores payloads where only high-frequency `last_seen_at` changed. |
| ➕ 3C.4 | DISCONNECTED/RECONNECTED pairing | 🔧¹²🔧¹⁴🔧¹⁹ In the violation timeline, pair each `DISCONNECTED` row with its matching `RECONNECTED` row. Show `count_reason` meaning: `long_gap` (counted), `short_gap` (returned quickly), `overlap` (tab-switch already covers this), `reversed_by_focus` (was counted, then reversed), `dismissed`/`restored` (admin action with note). Group throttled pairs |
| ➕ 3C.5 | Threshold control | 🔧¹⁹ A number field (1–100) on the live grid header that saves through the existing exam update route. Default for new exams: 10. The exam form (1D.2) keeps the same field. Changes are written to `admin_actions` with old and new value (Section 4 §7.1) |

Phase 3 builds and unit-tests the 3C components as reusable, unmounted pieces. Phase 4 mounts them in the live grid when candidate tiles, the selected-attempt event loader, and LiveKit media are available.

**Done when:** every event type in §8.1 appears in the admin log; every **snapshot-eligible** type has a snapshot when a usable camera frame exists, including split view and side panel cases. Camera/mic loss, disconnect/reconnect, multi-login, clipboard/context-menu and reload are intentionally not snapshot-eligible. Alt-tabbing counts as 1 incident, not 3.

---

## Phase 4 — Live Video and Audio (2–3 days)

**Dependencies:** Phase 2 (candidate auth and exam engine must work)

### 4A — LiveKit Cloud Setup (0.5 day)

| # | Task | Files |
|---|---|---|
| 4A.1 | Install LiveKit SDK | `package.json` — `livekit-client`, `@livekit/components-react` |
| 4A.2 | LiveKit Cloud account | Create free account, get API key + secret. 🔧²² Stays for local development only (production uses self-hosted EC2 per Section 6 §2–§4) |
| 4A.3 | Token generation | `app/api/livekit/token/route.ts` — 🔧⁹🔧¹⁰ candidate token: identity = **`c_{attempt_id}`** (not `cand_{candidateId}` — the kick route needs attempt_id to match), name = `{mer_code} {full_name}`, publish video+audio, subscribe none. Admin token: identity = `admin_{adminId}`, name = `Admin`, publish none, subscribe all, hidden. Use `as: 'candidate' | 'admin'` in the request to select the grant. Admin tokens set `autoSubscribe: false` (grid subscribes selectively) |

### 4B — Candidate Publishing (0.5 day)

| # | Task | Files |
|---|---|---|
| 4B.1 | Camera/mic hook | `hooks/useLiveKit.ts` — connect, publish camera at 320x240 + mic. 🔧⁴🔧⁵ **Cap Android camera**: `frameRate: { ideal: 15, max: 15 }` (4 GB tablets struggle at higher rates). Detect Android via UA. **Laptops stay at 30 fps**. Tune the Android value in the tablet rehearsal (8.27) |
| 🔧 4B.2 | LiveKit layout provider | `app/(candidate)/layout.tsx` | 🔧 **Put LiveKit connection in a layout-level provider** inside the `(candidate)` route group. This keeps the camera alive across waiting room → exam → done without reconnecting. Route groups with separate root layouts trigger full page reload, which kills fullscreen |
| 4B.3 | Integrate into waiting room + exam | Both pages consume the layout-level LiveKit context |
| 4B.4 | Degradation banner | `components/exam/CameraBanner.tsx` — 🔧 **"Camera disconnected. Please reconnect. Your exam continues and this is logged."** (not "marks may be reduced" — if EC2 goes down, candidates shouldn't panic over something that isn't their fault). State any penalty policy on the rules screen instead. 🔧¹⁹ A LiveKit-only loss is logged as `CAMERA_LOST` / `MIC_LOST` with `meta.source = 'livekit'` and **does not count** (Section 4 §2, §4.1) |

### 4C — Admin Grid (1 day)

| # | Task | Files |
|---|---|---|
| 4C.1 | Live grid page | `app/(admin)/admin/live/page.tsx` |
| 4C.2 | Video tile component | `components/admin/VideoTile.tsx` — MER label, name, status badge, violation count, speaker button. 🔧³🔧⁶ **Progress label**: read from `attempt_progress` view. 🔧⁹ **Poll the view every 10s** (views are not in Realtime publications). Show "Q 7/20" (`current_position + 1`/`total_questions` in sequential) or "14 answered" (`answered_count` in free) per candidate |
| 4C.3 | Manual subscription | Subscribe to all video tracks; audio only when speaker toggled on |
| 4C.4 | Tile enlarge | Click tile to enlarge + show violation timeline |
| 4C.5 | Status badges | Not joined, Ready, In exam, Offline, Submitted, Camera Off |

### 4D — Self-hosted LiveKit on EC2 (1 day)

| # | Task | Files | Details |
|---|---|---|---|
| 4D.1 | EC2 setup | `infra/ec2/setup-ec2.sh`, `check-stack.sh` | Ubuntu Server 24.04 LTS, `t3.small`, 20 GB gp3 disk, Elastic IP (Section 6 §2). Run `setup-ec2.sh` to install Docker, Node 22, Chrony, postgresql-client, rclone, unattended security updates without auto-reboot, swap, and `exam` user (Section 6 §3). Run `check-stack.sh` to verify |
| 4D.2 | DuckDNS setup | AWS / DuckDNS | 🔧²² Register DuckDNS subdomain, set update URL with Elastic IP once (Section 6 §2.5). 🔧² Second TURN hostname not required if single domain used with Caddy |
| 4D.3 | LiveKit Docker Compose | `infra/livekit/docker-compose.yml`, `livekit.yaml.example`, `livekit.env.example` | 🔧²² Pinned LiveKit `v1.13.7`, Caddy, Redis with host networking in `/opt/exam-livekit` (Section 6 §4.1, §4.4). Generate keys via `docker run --rm livekit/livekit-server generate-keys` |
| 4D.4 | Caddy config | `infra/livekit/Caddyfile` | 🔧²² Automated HTTPS reverse proxy for DuckDNS domain to LiveKit signaling on 127.0.0.1:7880 via Let's Encrypt (Section 6 §4.1) |
| 4D.5 | Security group | AWS Console | 🔧²² Inbound rules (Section 6 §2.3): TCP 22 (SSH from admin IP only), TCP 80 (HTTP / Let's Encrypt), TCP 443 (HTTPS / signaling), TCP 7881 (ICE/TCP fallback), UDP 3478 (TURN/UDP), UDP 50000–60000 (media). Ports 7880 and 6379 strictly closed to internet |
| 4D.6 | Swap file | EC2 system | 🔧²² 2 GB swap file created by `setup-ec2.sh` to prevent OOM on 2 GB RAM `t3.small` (Section 6 §3, §9) |
| 4D.7 | Switch `LIVEKIT_URL` | Vercel dashboard | Point `LIVEKIT_URL` to self-hosted DuckDNS instance (`wss://<your DuckDNS name>`) |
| 4D.8 | Load test | LiveKit CLI / test scripts | Test with 🔧 **23 simulated publishers** using LiveKit's load-test tool; monitor CPU and bandwidth |

**Done when:** grid stays smooth with test tiles; any candidate can be heard on demand; LiveKit disconnect shows the warning without blocking the exam; 🔧²² video from one candidate on mobile data reaches the admin grid (Section 6 §4.3).

---

## Phase 5 — Admin Controls, Pre-exam Check, Super Admin (1–2 days)

**Dependencies:** Phase 2 (exam engine), Phase 4 (LiveKit for pre-exam check)

### 5A — Admin Controls (0.5 day)

| # | Task | Files |
|---|---|---|
| 5A.1 | Start now API | `app/api/admin/exams/[id]/start/route.ts` — set `started_at`, 🔧 **set `ends_at = now() + duration_min`**, publish Broadcast `exam_started`. 🔧⁹ **Conditional update**: only if `status = 'draft' OR status = 'scheduled'`. Same logic shared with the worker’s scheduled start |
| 5A.2 | Extend API | `app/api/admin/exams/[id]/extend/route.ts` — all or one; 🔧 **add minutes to `exams.ends_at`** (or `attempts.extra_minutes` for individual); publish time update. 🔧⁹🔧¹⁰ **Server-side compare-and-set with retry** — the server reads `ends_at`, adds minutes, and writes with a `WHERE ends_at = old_value` guard. If stale, it retries internally (up to 3 times). The client does NOT need to send `expected_ends_at`. This prevents two admins extending at once from losing an update, without complicating the admin page |
| 5A.3 | Force-end API | `app/api/admin/exams/[id]/force-end/route.ts` — atomically set `status = 'ended'`, `ends_at = now()` and `force_ended_at = now()` only from `live`; publish `exam_ended`; require `confirm: true`. Leave every still-open attempt (`not_started`, `acknowledged`, `in_progress`) open for the fixed 15-second final-collection window. Connected in-progress candidates may flush pending answers; after the window the worker calls `submit_due_attempt` for every remaining attempt, which derives `forced` from database state. Do not loop over `submit_attempt` in the route and do not synthesize answers |
| 5A.4 | Force-submit + kick | `app/api/admin/attempts/[id]/force-submit/route.ts`, `/kick/route.ts` — 🔧⁹ Force-submit requires `confirm: true`; kick revokes sessions and removes from LiveKit |
| 5A.5 | Broadcast API | `app/api/admin/exams/[id]/broadcast/route.ts` — save to `broadcasts`, snapshot all/custom recipients, and publish a content-free nudge. Messages are 1–5,000 characters, sends per exam are unlimited, and candidate toasts display top-right for a fixed 5 seconds. Publish failure is logged but **never fails the admin action** (the 10s heartbeat is the backup) |
| 5A.6 | Admin action logging | Write all actions to `admin_actions`. 🔧⁹ **Use action names from Section 3 §1.6** |
| 5A.7 | Exam edit restrictions | UI disables fields based on exam status (draft/scheduled: full edit; live: extend/force-end only) |

### 5B — Pre-exam Check (0.5 day)

| # | Task | Files |
|---|---|---|
| 5B.1 | Pre-exam check page | `app/(candidate)/check/page.tsx` |
| 5B.2 | Chrome check | 🔧⁴ `navigator.userAgentData.brands` check — **fall back to `navigator.userAgent` string** on older Chrome where `userAgentData` is undefined |
| 5B.3 | Camera preview | Show video feed, confirm working |
| 5B.4 | Mic level | Show mic input level indicator |
| 5B.5 | Fullscreen test | Request fullscreen, confirm it works |
| 5B.6 | Network check | Test API connectivity |
| 5B.7 | Monitor check | `screen.isExtended` warning (🔧⁴ guarded — skip on Android where it doesn't exist) |
| 5B.8 | Wake Lock | Request Screen Wake Lock. 🔧⁴ **Re-request wake lock on `visibilitychange`** — wake lock is released whenever the page is hidden (e.g. notification shade on Android), so re-acquire it when the page becomes visible again |
| 🔧⁴🔧⁵🔧⁶ 5B.10 | Desktop site check | On Android, detect "Desktop site" mode: after entering fullscreen, if `window.innerWidth > screen.width`, or the UA is touch-capable and contains **none of** `Android`, `Windows`, `Macintosh`, `CrOS` (Chrome's "Desktop site" mode reports a Linux X11 UA) — **block the check and show a message** asking the candidate to turn "Desktop site" off, then retry. The previous check (`touch && !Android`) would false-positive on touchscreen Windows/Mac/ChromeOS laptops |
| 🔧 5B.9 | All permission prompts here | 🔧 **All browser permission prompts (camera, mic, fullscreen, wake lock) must happen in this pre-exam check page only**. Permission prompts and Android system dialogs cause blur events that would trigger false violations during the exam |

### 5C — Super Admin (0.5 day)

| # | Task | Files |
|---|---|---|
| 5C.1 | Health check page | `app/(admin)/admin/health/page.tsx` |
| 5C.2 | Health API | `app/api/admin/health/route.ts` — check Supabase, LiveKit. 🔧⁹ **Gemini key status is read from `api_key_state` table only** (the worker writes it). The health route does NOT hold or check Gemini keys directly. Worker heartbeat from `system_health` table. 🔧²² Return non-200 status when worker heartbeat is over 90s old so an external uptime monitor (UptimeRobot) catches a dead worker (Section 6 §6 item 3) |
| 5C.3 | Alerts display | Show active alerts from `alerts` table via Realtime |
| 5C.4 | Resolve alert API | `app/api/admin/alerts/[id]/resolve/route.ts` |
| ➕ 5C.5 | UptimeRobot setup | 🔧 Configure free UptimeRobot monitor pinging the public health endpoint (0.10). Prevents Supabase free-tier pausing |

**Done when:** Start now triggers Broadcast and sets `ends_at`; extend/force-end update `ends_at`; pre-exam check validates all requirements with all permission prompts; health page shows all-green status.

---

## Phase 6 — AI Grading (3–4 days)

**Dependencies:** Phase 1 (schema), Phase 2 (attempts and answers must exist)

### 6A — Worker Core (1 day)

| # | Task | Files | Details |
|---|---|---|---|
| 6A.1 | Worker entry point | `worker/src/index.ts` | Main loop. 🔧²¹ Startup sequence: validate config, initialize slots and rebuild `used_today` from `grading_log`, reset stuck jobs (>2 min), start 30s heartbeat, 5-min key check, and timers. 🔧²² **Single-instance guard rule (Section 6 §5.4)**: read `system_health('worker')`; if row missing, `status = 'down'`, or heartbeat ≥ 60s: continue; if fresh heartbeat from different instance: poll every 5s for up to 65s; if `last_heartbeat_at` does not advance (previous worker crashed), take over and continue; if it advances, exit code 3. On SIGTERM/SIGINT: write `status = 'down'` and exit 0 for instant planned restarts |
| 6A.2 | Slot manager | `worker/src/slots.ts` | 🔧²¹ Replaces key manager. Tracks per (key, model) slot (§2.3, §7.3): `cooldown_until`, `disabled`, `last_call_at`, `used_today` (rebuilt from `grading_log` since Pacific midnight), `limit`. Enforces `GRADING_SLOT_MIN_INTERVAL_MS` (12s) and skips slots where `used_today >= limit - GRADING_RESERVE` |
| 6A.3 | Key state table init | Database / seed | Seed `api_key_state` with key1, key2, key3 |
| 6A.4 | Job picker | `worker/src/grader.ts` | 🔧²¹ Pick oldest pending job from running runs. Claim with atomic conditional update (`WHERE id = job.id AND status = 'pending' AND tries = <read_tries> RETURNING *`) per §7.2 |
| 6A.5 | Stuck job reset | `worker/src/grader.ts` | Reset jobs stuck in 'running' for >2 min back to 'pending' |
| 6A.6 | Health heartbeat | `worker/src/heartbeat.ts` | 🔧 Write to `system_health('worker')` every 30s (not `alerts`). 🔧²¹ Include JSON `detail` (§7.8) with instance UUID, queue counts (pending, running, failed), and per-slot status/usage |
| ➕ 6A.7 | Alert webhook | `worker/src/alerts.ts` | 🔧 Send critical alerts via **Telegram or Discord webhook**. 🔧²¹ Dedup keys (§7.10): `key_disabled:{label}`, `keys_exhausted:{run}`, `model_not_found`, `jobs_failed:{run}`, `blocked:{run}`, `run_done:{run}`. 🔧²² Format payload by hostname: Discord (`{ "content": text }`) vs Telegram (`{ "text": text }`) with 5s timeout and 1 retry (Section 6 §6). Worker-level alert dedup keys: `worker_started` (INFO, once per start), `guard_exit` (CRITICAL, exit code 3), `supabase_unreachable` (CRITICAL, 5 min failed DB calls) |
| ➕ 6A.8 | Quota pre-check | `worker/src/dry-run.ts` | 🔧🔧² Dry-run generation call to verify key works. 🔧²¹ Counts toward daily budget: run once per key, not on every start. Live quotas must be checked in AI Studio |
| ➕ 6A.9 | Worker key check | `worker/src/key-check.ts` | 🔧⁹ Every 5 minutes, per key: call Gemini model-listing endpoint, write `api_key_state` (`active`, or `disabled` on 400/403). Only place keys are used outside grading |
| ➕ 6A.10 | Pacific day calculator | `lib/grading/quota-day.ts` | 🔧²¹ Start of current Pacific day and next Pacific midnight using `Intl.DateTimeFormat` with `America/Los_Angeles`. Unit-tested across November DST clock change (§7.7) |

### 6B — Gemini Integration (1 day)

| # | Task | Files | Details |
|---|---|---|---|
| 6B.1 | Prompt builder | `worker/src/prompt.ts`, `lib/grading/html-to-text.ts` | 🔧² One grading job per candidate. 🔧³ **Cap at ~10 questions per Gemini call** (`GRADING_CHUNK_SIZE`). 🔧⁶ `grading_jobs` keyed by `(run_id, attempt_id, chunk_index)`. 🔧²¹ System instruction version `g1` (§5.1). User message is a single JSON document (§5.2) with stringified candidate text to prevent prompt injection. Item IDs are `"1"`..`"n"` mapped back to question UUIDs. HTML converted to plain text via `lib/grading/html-to-text.ts` (`sanitize-html`, entity decoding, 2,000 char cap per §4). Truncate candidate answers >6,000 chars and set `truncated = true` |
| 6B.2 | Gemini API caller | `worker/src/gemini.ts` | 🔧²¹ `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with `x-goog-api-key` header (never in URL). Structured JSON schema (§5.3), `temperature: 0`, `maxOutputTokens: 8192`, timeout `GRADING_REQUEST_TIMEOUT_MS` (90s). Returns typed outcomes (§7.4) |
| 6B.3 | Response parser & validation | `worker/src/parser.ts` | 🔧²¹ Per-item validation (§6.1): check required fields, clamp marks to 0..max, round to `GRADING_MARK_STEP` (0.5). Evaluate `needs_review` rules in code (§6.2): confidence < 0.6 (< 0.75 for Singlish/mixed), verdict mismatch, points mismatch, clamped marks, truncated answer, empty reason, fallback model. Write to `question_scores` with `source = 'ai'` and `ON CONFLICT (job_id, question_id) DO NOTHING`. Partial accept (§6.4): save valid items, re-queue missing items in a new job |
| 6B.4 | Error classifier & actions | `worker/src/errors.ts` | 🔧²¹ Outcome table (§7.4): 200 ok (count call, validate); 429 RPM (slot cooldown 30s/2m/10m, job to pending, no try charged); 429 daily quota (cool slot until next Pacific midnight); 400/403 bad key (disable key, critical alert); 404 model not found (pause all runs, critical alert); 5xx transient (backoff retry up to `GRADING_MAX_TRIES`); safety block (job failed, manual override); unparseable JSON or `MAX_TOKENS` cutoff (split chunk into two half-size jobs). Tested against saved 429 fixtures |
| 6B.5 | Logging | `worker/src/logger.ts` | 🔧²¹ Write events to `grading_log` (§7.9): `worker_start`, `call`, `done`, `rate_limited`, `key_disabled`, `retry`, `requeued`, `blocked`, `paused`, `resumed`, `run_done`, `run_failed`. Every `call` row records `key_label`, `model`, item count, and latency ms. Never log raw answers, prompts, or API keys |
| ➕ 6B.6 | Run lifecycle & auto-resume | `worker/src/runner.ts` | 🔧²¹ Finishing and pausing (§7.5, §7.6): when all slots exhausted (`handleNoSlot`), pause runs with `keys_exhausted` and `resume_at`, send alert. Worker polls every 30s to **auto-resume** runs when slots become available. On attempt job completion, trigger `recomputeResults(attempt)`. Set run `done` or `failed` with completion alert |
| ➕ 6B.7 | Grading unit test suite | `worker/tests/grading.test.ts` | 🔧²¹ Unit tests in vitest: `buildItems`, `htmlToText`, `validateItem`, `needsReview`, `classifyError` (against 429 fixtures), `nextPacificMidnight`, `roundMark` |

### 6C — MCQ Scoring + Results (0.5 day)

| # | Task | Files |
|---|---|---|
| 6C.1 | MCQ scorer | Code-based: compare `selected_option_id` with `answer_keys.correct_option_id`. 🔧 **Write to `question_scores`** with source = `mcq` |
| 6C.2 | Results calculator | `total_marks` = sum from 🔧² **`current_scores` view** for candidate's assigned questions; `total_percent` = `(mcq + written) / total * 100` |
| 6C.3 | Results write | Upsert into `results` table (totals only — detail is in `question_scores`, read via `current_scores` view) |

### 6D — Grading API + Admin UI (1 day)

| # | Task | Files | Details |
|---|---|---|---|
| 6D.1 | Start grading API | `app/api/admin/exams/[id]/grade/route.ts` | 🔧 **Guard: only after exam is finalized** (all attempts submitted/expired). The grade-start transaction takes `FOR UPDATE` on the exam row before checking keys and creating the run; this conflicts with `save_answer_key`'s `FOR SHARE` lock so a key edit cannot race grading start. 🔧⁹ **Check answer keys are complete** — return `409 missing_answer_keys` with the list of questions that have no answer key. **Score MCQs in code** (compare `selected_option_id` with `answer_keys.correct_option_id`, write to `question_scores` with source=`mcq`). **Auto-zero blank written answers** (no Gemini job needed). Create `grading_runs` + `grading_jobs` for remaining non-empty written answers. 🔧²¹ **Response includes `estimated_calls`** (candidates × ceil(questions / chunk_size)). UI displays this alongside AI Studio quota check reminder |
| 6D.2 | Resume API | `app/api/admin/grading/[run]/resume/route.ts` | 🔧¹⁰ **Body**: `{ failed_only?: boolean }`. If `failed_only` is true (default), only retry `failed` jobs. If false, retry both `failed` and `pending`. Returns `{ resumed: number }` |
| 6D.3 | Grading progress page | `app/(admin)/admin/results/page.tsx` | Progress bar, key states, log. 🔧²¹ Shows per-slot usage from `system_health.detail` (`used_today / limit`, cooldowns), queue counts by status, live log tail, and "N not graded" count (§6D.3, §7.8, §8.1) |
| 6D.4 | Review screen | `app/(admin)/admin/results/[attempt]/page.tsx` | Per-question candidate answer, model answer, AI marks, reason, matched/missing points, confidence, 🔧³ `candidate_meaning_english`. 🔧 Reads from `current_scores` view. 🔧²¹ Display model name and prompt version (`details.model`, `details.prompt_version`). Filter for "needs review" items. Display "N questions not graded" banner (§8.1) |
| 6D.5 | Override API | `app/api/admin/results/[attempt]/override/route.ts` | 🔧 **Writes to `question_scores`** with source = `override`. 🔧² Override rows are never replaced by regrading (the view guarantees this). 🔧¹⁰ **Rules**: `note` is required (the admin must explain the override), and the attempt must be `finalized`. Returns `override_present: true` so the review screen can show the indicator |
| 6D.6 | Regrade API | `app/api/admin/results/[attempt]/regrade/route.ts` | 🔧⁹ Regrade single question for one candidate → new grading job with 🔧³ `question_ids = [that_id]`. Preconditions: attempt must be `finalized` (`409 not_finalized`); question must be written with a non-blank answer (`409 nothing_to_grade`). 🔧² Override always wins; latest `created_at` wins if no override (`current_scores` view). Recalculate totals |
| ➕ 6D.7 | Shared `recomputeResults()` | `lib/grading/recompute.ts` | 🔧¹⁰ Written once and imported by grade route (6D.1), override route (6D.5), and worker. Reads `current_scores` view (never raw `question_scores`), sums totals, upserts `results` |
| ➕ 6D.8 | Bulk regrade question API | `app/api/admin/exams/[id]/regrade-question/route.ts` | 🔧²¹ Section 5 §8.4: `POST` with `{ question_id }`. Preconditions: exam must be finalized, else `409 exam_not_finalized`; no grading run active (`409 grading_in_progress`); question is written with model answer (`400 not_written` / `409 missing_answer_key`). Creates run (`kind = 'regrade'`) and one job per attempt that has this question with a non-blank answer. Existing overrides preserved. Writes `admin_actions` (`regrade_question`). Response: `202 { run_id, jobs, overrides_kept }` |

### 6E — Prompt Testing (0.5 day)

| # | Task | Files | Details |
|---|---|---|---|
| 6E.1 | Test script | `worker/scripts/test-prompt.ts` | 🔧²¹ Run prompt harness on 15 test cases from `grading-test-cases.json` (§10.1). Sends in chunks of 10, repeats each chunk 3 times to measure score stability (differ by ≤0.5) |
| 6E.2 | Test with Singlish/Sinhala | `worker/scripts/grading-test-cases.json` | 🔧²¹ Sample answers across English, Sinhala, Singlish, negation (`epa`, `naha`), and prompt injection (§10.1, §10.2). Sinhala reader verifies `candidate_meaning_english` |
| 6E.3 | Calibration tuning | Answer keys / prompt notes | 🔧²¹ Adjust grading notes and calibration examples based on test results (do not alter system prompt rules unless clearly flawed) |
| ➕ 6E.4 | Capture 429 fixtures | `worker/test-fixtures/gemini-429-rpm.json` | 🔧²¹ Section 5 §10.3: deliberately exceed RPM limit with a spare key to save raw 429 JSON response. Unit-test error classifier against fixture to verify Google's error payload structure |

**Done when:** full 23-paper run completes; one key deliberately broken → worker fails over and alerts super admin via webhook; MCQ + written scores calculated correctly in `question_scores`; prompt test passes (≥90% within range, stability ≤0.5, injection case A8 scores 0); deliberately exhausted key fails over; all keys exhausted causes clean pause and auto-resumes after cooldown; worker crash during write produces zero duplicate score rows on re-run.

---

## Phase 7 — Results and Exports (1–2 days)

**Dependencies:** Phase 6

### Tasks

| # | Task | Files |
|---|---|---|
| 7.1 | Results summary page | `app/(admin)/admin/results/summary/page.tsx` — all 23 candidates, total scores |
| 7.2 | ~~Per-candidate detail page~~ | 🔧 **Removed** — duplicate of 6D.4 (`results/[attempt]/page.tsx`) |
| 7.3 | Print/PDF page | `app/(admin)/admin/results/[attempt]/print/page.tsx` — print-styled, Noto Sans Sinhala, optional examiner answers. 🔧🔧⁷ **Reads from `current_scores`** (not raw `question_scores` — the raw table would show regraded or overridden marks incorrectly) |
| 7.4 | Summary CSV export | `app/api/admin/results/export/route.ts` — all scores + which questions each candidate received. 🔧⁹🔧¹⁰ **Formula-injection guard**: prefix cell values starting with `=`, `+`, `-`, `@` with `'`. Include Sinhala names with UTF-8 BOM for Excel compatibility. 🔧¹⁹ **Add two columns** (Section 4 §7.3): `violations_counted` (`violation_count`) and `violations_logged` (count of all `violation_events` rows for the attempt). 🔧²¹ **Add column** (Section 5 §8.1): `unscored_count` placed after `needs_review_count` (count of written questions without a score row) |
| 7.5 | Paper indicator | Show the complete ordered question list saved for the candidate |
| ➕ 7.6 | Post-exam backup export | 🔧 Export results and PDFs. Copy to Google Drive immediately after the exam (free Supabase projects don't have reliable backups) |
| ➕ 7.7 | Snapshot deletion | 🔧²🔧⁹ **Dual purge**: (1) `POST /api/admin/snapshots/purge` (super-admin route, `maxDuration = 30`), and (2) worker daily cron job calling the same shared function. Retention default = `SNAPSHOT_RETENTION_DAYS` = **14 days**. Deletes Storage objects and nulls the `snapshot_path` on `violation_events` rows. The rules screen promises this retention to staff |

**Done when:** PDF exports correctly with Sinhala text; CSV contains all scores and question assignments; backup exported.

---

## Phase 8 — Rehearsal and Hardening (2 days)

**Dependencies:** All previous phases

### Tasks

| # | Task | Details |
|---|---|---|
| 8.1 | Create practice exam | Flag `is_practice`, add 10 dummy questions |
| 8.2 | Rehearsal with 3–5 people | Real laptops + Android tabs |
| 8.3 | Test split view | Chrome split view, Windows Snap, side panel |
| 8.4 | Test Android split-screen | Split-screen mode, floating window |
| 8.5 | Test network drop | Disconnect for 2 min, reconnect |
| 8.6 | Test LiveKit disconnect | Kill LiveKit → warning banner, exam continues |
| 8.7 | Test multi-login | Same MER in two browsers |
| 8.8 | Test complete paper shuffle | Verify every candidate gets every composed question; when shuffle is enabled, reconnect keeps the same question and option order |
| 8.9 | Test auto-submit | Deadline reached → auto-submit |
| 8.10 | Test grading | Full grading run with sample answers |
| 8.11 | Tune thresholds | Adjust `flag_threshold`, viewport % tolerance, focus delay |
| 8.12 | Finalize runbook | 🔧²² Exam-day runbook points to Section 6 §10 (replaces §18 of old plan) and 12-scenario failure playbook (Section 6 §11). 🔧⁴ Tablet users run pre-exam check day before. 🔧⁷ Clean rehearsal test data before real exam (see 8.30). Manual backups taken before and after exam |
| 8.13 | Fix issues | Address any bugs found during rehearsal |
| ➕ 8.14 | Test browser zoom + OS display scaling | 🔧 In pre-exam check (rehearsal), verify zoom levels and display scaling don't trigger false viewport violations |
| ➕ 8.15 | Test incident dedup | 🔧 Alt-tab during exam → verify it logs as 1 incident, not 3 separate violations |
| ➕ 8.16 | Test rate limit from shared IP | 🔧 Multiple candidates from same IP → verify legitimate logins aren't blocked |
| ➕ 8.17 | Test double-refresh at exam start | 🔧 Verify `generate_paper()` prevents duplicate paper rows and preserves the first generated order |
| ➕ 8.18 | Test option order persistence | 🔧 Reconnect → verify MCQ options are in the same shuffled order |
| ➕ 8.19 | Test missed start signal | 🔧² Disconnect Wi-Fi during exam start → verify waiting room catches up within 5–10 seconds via poll fallback |
| ➕ 8.20 | Test force-end with extra time | 🔧² Give one candidate extra minutes → force-end exam → verify the screen locks immediately, pending answers are accepted only through `force_ended_at + 15 seconds`, and later saves are rejected. Verify the worker force-submits every remaining attempt immediately after that fixed collection window with reason `forced`; individual `extra_minutes` do not extend a force-end |
| ➕ 8.21 | Test manual submit | 🔧² Click submit → confirm dialog → verify attempt is marked submitted and exam UI locks |
| ➕ 8.22 | Test regrade after override | 🔧² Override a score → regrade same question → verify override is preserved (not replaced by new AI score) |
| ➕ 8.23 | Test sequential mode reconnect | 🔧³ Reconnect in sequential mode → verify candidate lands on `current_position`, not question 1. Previous questions are not accessible |
| ➕ 8.24 | Test sequential position guard | 🔧³🔧⁴ In sequential mode, attempt to save an answer for **any question ≠ current** (earlier or later, via API) → verify server rejects both |
| ➕ 8.25 | Test browser Back button block | 🔧³ Press browser Back during exam → verify it doesn't leave the exam page. 🔧⁴ **Test on Android** — system Back gesture may exit fullscreen first, then navigate. `beforeunload` is unreliable on Android |
| ➕ 8.26 | Test navigation mode lock | 🔧³ Set navigation mode before start → start exam → verify mode cannot be changed while live |
| ➕ 8.27 | Full Android tablet rehearsal | 🔧⁴ **Dedicated tablet run** on real 4GB RAM Android tabs with Chrome. Test all of: pull-to-refresh blocked, on-screen keyboard with fullscreen + Sinhala input, orientation lock, wake lock re-acquisition after notification shade, camera at reduced FPS, touch targets, Desktop site mode off, system Back gesture, Samsung edge panel / notification shade / Google Assistant / Circle to Search causing false focus events |
| ➕ 8.28 | Test Next button double-tap | 🔧⁴ Rapidly double-tap Next → verify `expected_position` idempotency prevents question skip |
| ➕ 8.29 | Test question flagging | 🔧⁴ Flag a question → verify flag persists across saves and shows in question list and pre-submit summary |
| ➕ 8.30 | Clean test data | 🔧⁷ After rehearsal and before the real exam, run the cleanup script from `SECTIONS/section-1-migration.md` §5: `DELETE FROM exams WHERE is_practice OR title ILIKE 'test%'` (cascades to attempts, answers, scores, violations, grading runs); `DELETE FROM candidates WHERE mer_code ILIKE 'TEST%'`; `DELETE FROM login_attempts`; `DELETE FROM alerts`; `DELETE FROM admin_actions`. **Also manually empty the Storage → snapshots bucket** in the dashboard (SQL cannot delete storage objects) |
| ➕ 8.31 | Test login errors | 🔧⁹ Wrong ID, unknown MER, and inactive candidate all return the same `401`. The sixth wrong try for one MER returns `429`. 23 correct logins from one IP never hit the IP limit |
| ➕ 8.32 | Test multi-login | 🔧⁹ Login twice for one candidate: the first session’s next call returns `401 session_revoked`, and a `MULTI_LOGIN` row exists when the first was live; `RECONNECTED` when it was not |
| ➕ 8.33 | Test multiple exams | 🔧⁹ A candidate assigned to two open exams gets `409 multiple_exams`, then logs in with `exam_id` |
| ➕ 8.34 | Test paper before live | 🔧⁹ `GET /api/exam/paper` before the exam is live returns `409 exam_not_live` and creates no `attempt_questions` |
| ➕ 8.35 | Test sequential paper | 🔧⁹ Sequential mode: the paper response contains exactly one question; a save for a different question returns `wrong_position`; two identical Next calls return `advanced` then `already_advanced` |
| ➕ 8.36 | Test last-question save | 🔧⁹ Type an answer on the last question and press Submit — the answer is stored. Also call `POST /api/exam/next` directly on the last question with an answer: the result is `last_question` and the answer is still stored |
| ➕ 8.37 | Test revision recovery | 🔧⁹ Save revision 5, clear IndexedDB, reconnect, type again: the new save is accepted (paper API returns the server revision) |
| ➕ 8.38 | Test submit from waiting room | 🔧⁹ `POST /api/exam/submit` from the waiting room returns `409 not_started` |
| ➕ 8.39 | Test submit with pending answers | 🔧⁹ Submit with `pending_answers` at the deadline stores them and closes the attempt; one more save afterwards returns `closed` |
| ➕ 8.40 | Test events edge cases | 🔧⁹ `POST /api/events` with a bad JPEG keeps the event and sets `meta.snapshot_error`; `DISCONNECTED` from a client returns `400`; waiting-room events have `counts = false` |
| ➕ 8.41 | Test auth boundaries | 🔧⁹ Candidate calls to any `/api/admin/*` route return `401` or `403`; an admin without a profile row gets `403` |
| ➕ 8.42 | Test live-lock on questions | 🔧⁹ `PATCH` on `navigation_mode` after start returns `409 exam_locked`; question create, delete and reorder after start do the same; an answer-key edit after start succeeds |
| ➕ 8.43 | Test concurrent extend | 🔧⁹ Two admins extend the exam at the same moment: both extensions are applied (compare-and-set with retry) |
| ➕ 8.44 | Test force-end all | 🔧⁹ Force-end: every attempt (including not joined) is `submitted` with reason `forced`, and a save one second later returns `closed` |
| ➕ 8.45 | Test unassign started | 🔧⁹ Unassigning a started candidate returns them in `blocked` |
| ➕ 8.46 | Test grading guard | 🔧⁹ `grade` before finalization returns `409`; with a missing answer key returns `missing_answer_keys`; a blank written answer is scored 0 with no Gemini job |
| ➕ 8.47 | Test override then regrade | 🔧⁹ Override then regrade the same question: the override stays current and `override_present` is `true` |
| ➕ 8.48 | Test CSV export | 🔧⁹ The CSV opens in Excel with Sinhala names intact and no cell starts with an unescaped `=` |
| ➕ 8.50 | Test merged incident | 🔧¹⁹ Alt-tab, then viewport change 10s later, then return: **one** incident with `merged_types` containing both, `duration_ms` ≥ 10s |
| ➕ 8.51 | Test debounce rules | 🔧¹⁹ Blur under 1s: nothing logged. Fullscreen exit under 1s: logged. TAB_HIDDEN under 1s with no other signal: dropped |
| ➕ 8.52 | Test idempotent retry | 🔧¹⁹ First `POST /api/events` succeeds but response is dropped. Retry returns `duplicate: true` and `violation_count` goes up by 1 (not 2) |
| ➕ 8.53 | Test submit flush | 🔧¹⁹ Submit with an open incident: it is sent before the submit and appears in the log |
| ➕ 8.54 | Test sendBeacon | 🔧¹⁹ Close the tab during an incident: the beacon arrives with a sensible duration *(Android test)* |
| ➕ 8.55 | Test exam-start split | 🔧¹⁹ Fault active when exam starts: waiting-room incident does not count, new exam-phase incident does |
| ➕ 8.56 | Test black frame | 🔧¹⁹ Cover camera then switch tab: event saved with `snapshot_skipped = 'black'` |
| ➕ 8.57 | Test non-counting events | 🔧¹⁹ `COPY`, `PASTE`, `CONTEXT_MENU`: logged with `counts = false`. Same type within 3s = one event |
| ➕ 8.58 | Test camera source | 🔧¹⁹ Unplug camera (`meta.source = 'track'`): counts. Kill LiveKit (`meta.source = 'livekit'`): does not count |
| ➕ 8.59 | Test reload | 🔧¹⁹ Reload during exam: `RELOAD` logged and counted. Fresh login after kick is not a `RELOAD` |
| ➕ 8.60 | Test threshold change | 🔧¹⁹ Change `flag_threshold` from 10 to 3 while live: tiles at 3 or 4 recolour immediately |
| ➕ 8.61 | Test dismiss/restore | 🔧¹⁹ Dismiss an incident with a note: `violation_count` drops by 1. Restore it: goes back up. Both appear in the audit log |
| ➕ 8.62 | Test one-absence rule | 🔧¹⁹ Wi-Fi drop of 3 min with a tab switch 60s in, **both orders** (event before flip and after flip): net `violation_count` = 1 each time |
| ➕ 8.63 | Test smoke 11a–11c | 🔧¹⁹ Smoke-test additions 11a–11c (one-absence SQL tests) pass |
| ➕ 8.64 | Test plain Wi-Fi blip | 🔧²⁰ 40-second Wi-Fi blip: `DISCONNECTED` appears with `counts = false`, candidate returns, heartbeat writes `RECONNECTED` and sets `meta.count_reason = 'short_gap'`, `violation_count` unchanged |
| ➕ 8.65 | Test clean 3-minute drop | 🔧²⁰ 3-minute network drop with no tab switch: `DISCONNECTED` starts at `counts = false`, `resolve_disconnects()` flips to `counts = true` with `count_reason = 'long_gap'`, `violation_count` increments by exactly 1 |
| ➕ 8.66 | Test RPM 429 cooldown | 🔧²¹ A 429 per-minute error cools one slot; the job goes to the next slot and is not charged a try |
| ➕ 8.67 | Test daily quota 429 | 🔧²¹ A daily-quota 429 cools the slot until the next Pacific midnight |
| ➕ 8.68 | Test 429 fixture classification | 🔧²¹ 429 classification passes against the saved real fixtures (RPM and daily) |
| ➕ 8.69 | Test invalid key disabled | 🔧²¹ An invalid key becomes disabled, a critical alert is sent, grading continues on other keys |
| ➕ 8.70 | Test 404 model not found | 🔧²¹ 404 model-not-found pauses the run with a critical alert and no key rotation |
| ➕ 8.71 | Test all slots exhausted pause & auto-resume | 🔧²¹ All slots used up: run paused with resume_at, webhook sent; after cooldown resumes by itself |
| ➕ 8.72 | Test all keys disabled pause | 🔧²¹ All keys disabled: run paused and does not resume by itself |
| ➕ 8.73 | Test partial accept | 🔧²¹ A response missing 2 of 10 items saves 8 scores and re-queues exactly those 2 |
| ➕ 8.74 | Test unparseable JSON split | 🔧²¹ Invalid JSON or MAX_TOKENS cut-off re-queues the chunk as two half-size jobs |
| ➕ 8.75 | Test idempotent score writes | 🔧²¹ Kill worker after scores written but before job marked done: restart creates no duplicate rows |
| ➕ 8.76 | Test single-instance worker guard | 🔧²¹ Start a second worker while one is alive: it exits |
| ➕ 8.77 | Test restart usage rebuild | 🔧²¹ Daily usage rebuilt from grading_log after restart; slot stops at limit - reserve |
| ➕ 8.78 | Test score clamping and rounding | 🔧²¹ Marks above max are clamped and flagged clamped; 1.3 becomes 1.5 (step 0.5) and flagged adjusted |
| ➕ 8.79 | Test needs_review rules | 🔧²¹ Each needs_review rule in Section 5 §6.2 fires on a crafted response |
| ➕ 8.80 | Test answer truncation | 🔧²¹ A 7,000-character answer is cut at 6,000 and flagged truncated_answer |
| ➕ 8.81 | Test prompt injection resistance | 🔧²¹ Candidate text with JSON delimiters cannot change prompt structure (JSON string input) |
| ➕ 8.82 | Test injection case A8 | 🔧²¹ The injection case (A8) scores 0 in the real prompt test |
| ➕ 8.83 | Test Singlish negation | 🔧²¹ Singlish negation cases (A6, B3) score as expected in real prompt test |
| ➕ 8.84 | Test regrade question route | 🔧²¹ POST /exams/[id]/regrade-question creates one job per candidate with non-blank answer and keeps overrides |
| ➕ 8.85 | Test recomputeResults with unscored | 🔧²¹ recomputeResults equals hand-calculated total for paper with MCQ, AI, override, unscored; unscored_count is 1 |
| ➕ 8.86 | Test Pacific midnight DST | 🔧²¹ nextPacificMidnight is correct on both sides of the November 2026 clock change |
| ➕ 8.87 | Test guard after crash | 🔧²² Kill worker with `kill -9`; systemd restarts it; new instance polls up to 65s, sees heartbeat not advancing, takes over; grading/scheduler continue, exit code is not 3 |
| ➕ 8.88 | Test guard after graceful restart | 🔧²² `systemctl restart exam-worker` starts without waiting (previous instance wrote `status = 'down'`) |
| ➕ 8.89 | Test guard against live second worker | 🔧²² Start second worker manually while service runs; second one exits with code 3 after wait; service keeps running |
| ➕ 8.90 | Test alert delivery | 🔧²² `curl` webhook manually, then trigger real alert (break one key); message reaches phone with no keys or candidate names |
| ➕ 8.91 | Test dead worker visibility | 🔧²² Stop worker; within 90s health page shows it stale and health route returns non-200 |
| ➕ 8.92 | Test reboot recovery | 🔧²² `sudo reboot` EC2; LiveKit, Caddy, Redis (`restart: unless-stopped`) and worker (systemd enabled) recover automatically; TLS cert valid |
| ➕ 8.93 | Test restore drill | 🔧²² Section 6 §8 item 6: restore latest DB dump into scratch Supabase project with `pg_restore --no-owner --dbname=<url>`; verify app connects and lists exams and candidates |
| ➕ 8.94 | Test capacity | 🔧²² Section 6 §9: 23 candidates connected for 30 min, 3 admins subscribed; monitor every 15 min (`free -m`, `docker stats`, CloudWatch CPU credits); verify no swap thrash; resize to `t3.medium` if needed |
| ➕ 8.95 | Test mobile-data publisher | 🔧²² One candidate on mobile data publishes video; admin sees tile on live grid |
| ➕ 8.96 | Test shared-IP login | 🔧²² 23 logins from one IP within 2 min all succeed; 6 wrong attempts on one MER limited by per-MER threshold |
| ➕ 8.97 | Test deployed Origin checks | On the deployed Vercel URL and, if enabled, the Caddy fallback, verify a harmless browser write from the public origin passes `assertSameOrigin()` and a mismatched origin returns `403 forbidden`. If the proxy changes the effective request origin, set `ALLOWED_ORIGINS` to the exact public origin and repeat before production use |
| ➕ 8.98 | Test deployed Argon2 capacity | On the real web host, measure Argon2 hash and verify latency with the production policy. Simulate the expected exam-start login burst and confirm Node thread-pool async verifications do not exhaust memory or cause unacceptable login latency; record concurrency, peak memory and timings |


**Done when:** full rehearsal passes with no blocking issues; runbook is finalized; 🔧²² restore drill passed; capacity numbers recorded; alert test message received (Section 6 §12).

---

## Phase Dependency Map

```mermaid
flowchart TD
  P0[Phase 0: Setup] --> P1[Phase 1: Schema + Admin]
  P1 --> P2[Phase 2: Candidate Engine]
  P1 --> P6[Phase 6: AI Grading]
  P2 --> P3[Phase 3: Proctoring]
  P2 --> P4[Phase 4: LiveKit Video]
  P2 --> P5[Phase 5: Admin Controls]
  P4 --> P5
  P6 --> P7[Phase 7: Results + Exports]
  P3 --> P8[Phase 8: Rehearsal]
  P4 --> P8
  P5 --> P8
  P7 --> P8
```

> [!TIP]
> **Phase 4 (LiveKit) and Phase 6 (AI Grading) can run in parallel** since they don't depend on each other. If you want to see the exam working end-to-end faster, prioritize Phases 0→1→2→6→7, then come back to Phases 3→4→5.

---

## Quick Reference: Total File Count

| Category | Estimated files |
|---|---|
| Pages (candidate) | ~8 (login, confirm, rules, check, waiting, exam, done, fallback) |
| Pages (admin) | ~10 (login, dashboard, candidates, exams, questions, live, results, review, print, health) |
| API routes | ~23 |
| Components | ~18 |
| Hooks | ~5 (useAutosave, useProctoring, useHeartbeat, useLiveKit, useBroadcast) |
| Lib utilities | ~9 (supabase, session, hashing, time, broadcast, snapshot, indexeddb, livekit, logger) |
| Styles | ~1 (tablet/responsive) |
| Worker | ~7 (index, grader, keys, scheduler, prompt, health, alerts) |
| Infra | ~3 (docker-compose, Caddyfile, LiveKit config) |
| **Total** | **~83 files** |

---

## Issues Cross-Reference

All issues from `Issues.md` (rounds 1–22) are addressed in this plan:

### Round 1 Issues

| Issue | Where Addressed |
|---|---|
| `exams.ends_at` for force-end/extension | `001_initial.sql`, 2D.3, 2F.5, 5A.1–5A.3 |
| `question_scores` table | `001_initial.sql`, 6B.3, 6C.1, 6D.4–6D.6, 7.3 |
| Autosave revision number | `001_initial.sql`, 2E.2, 2E.4 |
| Option order persistence | `001_initial.sql`, 2C.2–2C.3, 2D.2, 2F.4, 8.18 |
| Rate limit: failed only | `001_initial.sql`, 2A.2–2A.3, 8.16 |
| `system_health` table | `001_initial.sql`, 6A.6 |
| Alert dedup | `001_initial.sql` |
| Paper generation race condition | `004_exam_paper_and_unassign.sql`, 2C.2, 8.17 |
| Session revocation enforcement | 2A.4 |
| NIC normalization | 1C.1 |
| `@node-rs/argon2` (not native) | 0.2, 1C.1 |
| Never log request bodies | 0.9 |
| 15s deadline grace + UI lock | 2E.4, 2F.2 |
| `sanitize-html` (not dompurify) | 0.2, 1E.8 |
| Auth in every route handler | 1B.5 |
| LiveKit layout provider | 4B.2 |
| Fullscreen in waiting room | 2B.3 |
| Incident dedup (~3s merge) | 3A.1, 3A.11, 3C.2, 8.15 |
| Viewport check only in fullscreen | 3A.5 |
| Permission prompts in pre-exam only | 5B.9 |
| LiveKit banner wording | 4B.4 |
| EC2 TCP 80 for certs | 4D.5 |
| AI quota + batch size | 6A.8, 6B.1 |
| Skip empty answers | 6D.1 |
| Parse 429 details | 6B.4 |
| Health check: key-listing endpoint | 5C.2 |
| Grade only after finalized | 6D.1 |
| Regrade "current" rule | 6D.6 |
| Telegram/Discord webhook alerts | 6A.7 |
| UptimeRobot | 0.10, 5C.5 |
| Post-exam backup to Drive | 7.6 |
| Consent on rules screen | 2B.6 |
| Show which exam on login | 2A.1, 2A.2 |
| Colombo → UTC conversion | 1D.2 |
| `current_scores` view | `001_initial.sql`, 6D.4, 6C.2, 7.3 |

### Round 2 Issues

| Issue | Where Addressed |
|---|---|
| Alert dedup: partial unique index (not constraint) | `001_initial.sql` (SQL corrected) |
| Regrade erases override: priority rule + `created_at` + view | `001_initial.sql`, 6D.5, 6D.6, 8.22 |
| Batch grading: per-candidate jobs, array response | 6B.1 (restructured) |
| Quota check: no API exists, use dry-run | 6A.8 (replaced) |
| Exam state machine: live → ended → finalized | 2F.5 (transitions added) |
| Force-end with extra time: check status not just deadline | 2E.4, 5A.3, 8.20 |
| Missed start signal: poll fallback | 2B.3, 2B.5, 8.19 |
| Snapshot deletion: honor consent promise | 7.7 (new task) |
| Client-side routing + manual submit button | 2D.1, 2F.2, 8.21 |
| LiveKit TURN hostname | 4D.2, 4D.4 |
| No Discord/Telegram webhook; Gemini model and per-key limits are explicit | 0.4 |
| Docs out of sync warning | ⚠️ Note below |

### Round 3 Issues

| Issue | Where Addressed |
|---|---|
| Status values mismatch: `force_ended`/`force_submitted` vs CHECK constraints | `001_initial.sql` (`force_ended_at`), `001_initial.sql` (`submit_reason`), 5A.3, 2F.1, 2F.2, 2F.5 |
| `question_scores` missing AI detail columns | `001_initial.sql` (`details` jsonb, `needs_review`), 6B.3, 6D.4 |
| AI response dropped `candidate_meaning_english` | 6B.1, 6D.4 |
| Grading job regrade key collision | 6B.1 (`question_ids` scope column), 6D.6 |
| Cap questions per Gemini call at ~10 | 6B.1 |
| Finalization sequence undetectable → scheduler-driven | 2F.5 (revised) |
| Navigation mode: sequential vs free | `001_initial.sql`, 1D.2, 1D.4, 2B.6, 2C.1, 2D.1, 2D.7, 2D.8, 2E.4, 2F.2, 2F.4, 2F.6, 4C.2, 8.23–8.26 |
| Migration consolidation | 1A.1 (replaced with section reference) |

### Round 4 Issues

| Issue | Where Addressed |
|---|---|
| Pull-to-refresh on Android | 2D.1 (`overscroll-behavior: none`) |
| On-screen keyboard + fullscreen + Sinhala | 2D.1 (`100dvh`), 2D.6, 8.27 |
| Android keyboard: `input` events, no autocorrect | 2D.6 |
| "Desktop site" mode breaks viewport | 3A.5, 5B.10 (new check) |
| Orientation lock after fullscreen | 3A.4 |
| System Back gesture on Android | 8.25 (Android test), 8.27 |
| Wake lock re-request on visibility | 5B.8 |
| Camera FPS cap on Android | 4B.1 |
| `screen.isExtended` guard on Android | 3A.6 |
| `userAgentData` fallback | 5B.2 |
| Touch layout (768–1024px, 44px targets) | 2D.9 (new task) |
| System overlays false events + tablet rehearsal | 8.12 (runbook step), 8.27 (new test) |
| Scheduler extra-time bug | 2F.5 (per-attempt deadline), 8.20 |
| Next button double-tap / idempotency | 2D.7, 2F.6 (`expected_position`), 8.28 |
| Position guard: current-only, not just earlier | 2E.4, 8.24 |
| "Flagged" indicator undefined → `answers.flagged` | `001_initial.sql`, 2D.8, 8.29 |
| Submitted check consolidation | 2E.4 |

### Round 5 Issues

| Issue | Where Addressed |
|---|---|
| Confirmation page: no photo | 2A.5 |
| Orientation lock: current, not hardcoded portrait | 3A.4 |
| Camera FPS: ideal:15, max:15 on Android | 4B.1 |
| Desktop site detection: specific method | 5B.10 |
| Rules screen: candidate setup instructions | 2B.6 |

### Round 6 Issues

| Issue | Where Addressed |
|---|---|
| 5B.10 touchscreen laptop false positive | 5B.10 (exclude `Windows\|Macintosh\|CrOS`) |
| Grading jobs: `chunk_index` + regrade is own run | 1A (migration), 6B.1 |
| Violation events: one row per incident | 1A (migration), 3A.1, 3B.1, 3C.2 |
| Auto-create attempts on candidate assignment | 1A (migration trigger), 1D.3 |
| Section 1 integration: migration SQL written | 1A (replaced with section reference), 2C.2, 2E.4, 2F.1, 2F.5, 2F.6, 4C.2 |

### Round 7 Issues

| Issue | Where Addressed |
|---|---|
| 7.3 reads raw `question_scores` instead of `current_scores` | 7.3 |
| Test-data cleanup script missing from plan | 8.30 (new task), 8.12 (runbook step) |
| Migration run notes (fresh project, Postgres 15+, never executed) | 1A.1, 1A.2 |
| Phase 1A missing Done-when | 1A (added after reference table) |
| Stale cross-refs to 1A.8–1A.20 | All updated to `001_initial.sql` |
| 5A.3 force-end: direct update instead of rpc | 5A.3 (now uses `rpc('submit_attempt')`) |
| `navigation_mode` lock only cosmetic | 1D.4 (server-side reject once live) |

### Round 8 Issues

| Issue | Where Addressed |
|---|---|
| Question routes unlocked while exam is live | 1E.7 (lock rule added; full spec in Section 3) |
| 6D.6 stale reference to 1A.17 | 6D.6 (changed to `001_initial.sql`) |

### Round 9 Issues (Section 3 API Contracts)

| Issue | Where Addressed |
|---|---|
| Snapshot upload: candidates have no Supabase access | 3B.1 (snapshot inside events API), 3B.3 (removed browser upload) |
| Revision counter resets on reconnect | 2C.1 (return server revision), 2E.2 (recovery logic), 2E.4 (return `server_revision` on stale) |
| Submit from waiting room allowed | 2F.1 (require `in_progress`), 8.38 |
| Last question answer lost on Next | 2F.6 (save answer on `last_question`), 8.36 |
| Shuffled option labels read wrong | 2C.1 (no labels), 2D.2 (UI letters by position) |
| Gemini keys on Vercel | 5C.2 (reads `api_key_state` only), 6A.9 (worker key check) |
| Progress views not in Realtime | 4C.2 (poll every 10s) |
| Unassign started candidate leaves orphan | 1D.3 (🔧¹¹ returns `200 { removed, blocked }`), 8.45 |
| Grading start gaps: no key check, no MCQ scoring | 6D.1 (check keys, score MCQs, auto-zero blanks), 8.46 |
| Two admins extending loses update | 5A.2 (compare-and-set), 8.43 |
| Client `counts` flag trusted | 3A.1, 3B.1 (server decides `counts`) |
| CSV import too slow for 300 NICs | 1C.4 (cap 100 rows, batches) |
| Acknowledge split across two screens | 2A.5 (no API), 2A.6 (called from rules, both flags) |
| Snapshot retention undecided | 0.4, 7.7 (`SNAPSHOT_RETENTION_DAYS` = 14) |
| Waiting-room incidents counting | 3A.1, 3B.1 (waiting-room = `counts: false`; exam-phase = `counts: true`) |
| New routes needed | 1C.5, 1D.3, 1D.4, 1E.6, 1E.7, 2A.7, 2A.8, 6D.6 (files added) |
| Section 3 reference | [`SECTIONS/section-3-api-contracts.md`](file:///e:/1.%20Projects/Cosmetics.lk/Projects/Cosmetics_Exam/SECTIONS/section-3-api-contracts.md) |
| Phase 8 API tests | 8.31–8.65 |

### Round 10 Issues (Plan vs Contract Conflicts)

| Issue | Where Addressed |
|---|---|
| State response shape too simple for manual start/time changes | 2B.3, 2B.5 (use contract’s full shape: server_time + exam + attempt) |
| LiveKit identity `cand_{candidateId}` doesn’t match kick route | 4A.3 (changed to `c_{attempt_id}`) |
| Extend race: client-side retry is complex | 5A.2 (server-side compare-and-set with internal retry) |
| CSV formula guard: tab vs single quote | 7.4 (single quote, matches contract) |
| Unassign response: 409 vs 200 | 1D.3 (200 `{ removed, blocked }`) |
| Retention still 30 in contract, 2B.6 missing source | 2B.6 (shows retention from `/api/auth/me`), contract needs manual fix to 14 |
| Question HTML allowlist missing | 1E.7 (allowlist added from Section 3 §4.3) |
| Override rules: note required, attempt must be finalized | 6D.5 (rules added) |
| Resume body undocumented | 6D.2 (`{ failed_only? }`, returns `{ resumed }`) |
| Broadcast limits missing | 5A.5 (5,000 characters, unlimited sends, fixed 5-second toast, publish failure non-blocking) |
| `recomputeResults()` shared function missing | 6D.7 (new task — `lib/grading/recompute.ts`) |
| Per-IP login limit could lock out office | 2A.3 (per-IP threshold 50+; per-MER limit is the real protection) |

### Round 11 Issues (Remaining Mismatches)

| Issue | Where Addressed |
|---|---|
| 3B.4 heartbeat still returns old `{ phase, remaining_s, broadcast }` | 3B.4 (now returns full state body matching 2B.5) |
| Contract retention still 30 in 4 places | `section-3-api-contracts.md` lines 31, 264, 741, 809 (changed to 14) |
| Per-IP login limit: plan says 50, contract says 40 | Contract line 229 (changed to 50) |
| Round 9 xref still says `409 blocked` for unassign | Round 9 xref (changed to `200 { removed, blocked }`) |
| DISCONNECTED counts on short Wi-Fi blips | 3B.6 (counts only for gaps > 2 min; never count if overlaps FOCUS_LOST) |

### Round 12 Issues (Two-Pass DISCONNECTED Rule)

| Issue | Where Addressed |
|---|---|
| Single-pass can't decide `counts` at insert time (gap unknown at 30s) | 3B.6 (two-pass: insert `counts=false` at 30s, flip to `true` at 2 min) |
| `FOCUS_LOST` may not exist yet when worker decides (tablet queues it) | 3B.6 pass 2 (check ±10s window; late-queued edge case accepted) |
| `bump_violation_count` trigger only fires on INSERT | `001_initial.sql` (trigger now fires `AFTER INSERT OR UPDATE OF counts`, +1/−1 logic) |
| Contract line 734 still says `counts = true` | `section-3-api-contracts.md` §7 (rewritten as two-pass) |
| Contract line 413 doesn't mention DISCONNECTED in counts rules | `section-3-api-contracts.md` §3.13 (DISCONNECTED = `false`, worker handles it) |
| Test 8.49 doesn't cover the 2-min rule | 8.49 (two cases: 40s blip not counted, 3-min drop counted) |
| Admin timeline doesn't show DISCONNECTED gap duration | 3C.4 (new task: pair DISCONNECTED/RECONNECTED, show gap length) |

### Round 13 Issues (Interval Overlap for Backgrounded Tabs)

| Issue | Where Addressed |
|---|---|
| ±10s check misses backgrounded-tab FOCUS_LOST (5 min later → double count) | 3B.6 (interval overlap: event started before gap AND lasted into it or has no end) |
| Pass 2 has no reference value for "last_seen_at has not advanced" | 3B.6 Pass 1 (saves `meta.last_seen_at` on the DISCONNECTED row) |
| Heartbeat and worker disconnect thresholds could diverge | 3B.4 and 3B.6 (both call the shared database classifier; `< 2 min` is `short_gap`, while `>= 2 min` applies overlap or `long_gap` from `meta.last_seen_at`) |
| Smoke test doesn't cover UPDATE OF counts trigger path | `001_smoke_test.sql` tests 7b–7d (insert counts=false → no increment, flip true → +1, flip false → −1) |
| Test 8.49 missing backgrounded-tab case | 8.49 case (c): hide tab > 5 min, FOCUS_LOST overlaps gap, violation_count = 1 not 2 |
| Contract line 734 still had ±10s-only check | `section-3-api-contracts.md` §7 (rewritten with interval overlap + ±10s fallback + meta.last_seen_at) |

### Round 14 Issues (Late FOCUS_LOST Reversal & Precision)

| Issue | Where Addressed |
|---|---|
| Frozen tab: late FOCUS_LOST arrives after flip → double count | 3B.1 (events route reverses counted DISCONNECTED rows when focus-type event overlaps) |
| `occurred_ago_ms` capped at 10 min — rejects long-frozen tab events | 3B.1 (raised to `exam.duration_min * 60000`, clamp don't reject) |
| "No recorded end yet" too broad — old alt-tab blocks all future flips | 3B.6 (restrict to most recent focus-type event with no later return event) |
| `last_seen_at` equality fails (Postgres microseconds vs JS milliseconds) | 3B.6 (store exact string from DB, no parsing) |
| No skip reason — uncounted rows re-checked every 30s | 3B.6 (`meta.count_reason`: `long_gap`, `overlap`, `short_gap`, `reversed_by_focus`) |
| Throttled-tab timeline noise (DISCONNECTED/RECONNECTED every minute) | 3B.6 (skip Pass 1 while open focus-type incident), 3C.4 (group throttled pairs) |
| BOM in `section-3-api-contracts.md` | Stripped (UTF-8 without BOM) |
| Test 8.49 case (c) can't be reproduced by hiding tab | 8.49 (c) rewritten: use DevTools request-blocking or tablet-lock |
| Missing test for late FOCUS_LOST after flip | 8.49 case (d): late FOCUS_LOST reverses flip, net violation_count = 1 |
| 3C.4 shows "informational" without saying why | 3C.4 (shows `meta.count_reason` text; groups throttled pairs) |

### Round 15 Issues (Send-on-End Model & Race Guard)

| Issue | Where Addressed |
|---|---|
| "Open incident" and "return event" can't be computed (no return event type, one-shot API) | 3B.6 (🔧¹⁵ design decision: send-on-end model, use only recorded intervals, reversal is the safety net) |
| Pass 1 "open incident" skip removed (can't evaluate) | 3B.6 (removed — timeline noise handled by 3C.4 grouping instead) |
| Pass 2 "no later return event" clause removed (can't evaluate) | 3B.6 (removed — use only `occurred_at` to `occurred_at + duration_ms` from recorded events) |
| 8.49(c) assumed FOCUS_LOST arrives at tab switch (it's sent on end) | 8.49(c) (rewritten: no focus event until return, Pass 2 flips, then reversal fires) |
| Heartbeat `short_gap` write not documented in 3B.4 or contract §3.12 | 3B.4 and contract §3.12 (both now specify the guarded UPDATE) |
| Race between heartbeat and Pass 2 disconnect classification | 3B.4 and 3B.6 (both call the same row-locking classifier, so the result follows one two-minute boundary and one overlap rule) |
| 8.49(d) changed from "late FOCUS_LOST" to race test | 8.49(d) (verifies no row gets `counts=true` with `count_reason='short_gap'`) |

### Round 16 Issues (Broken SQL & RPC Function)

| Issue | Where Addressed |
|---|---|
| Undefined alias `ve` in the Pass 2 UPDATE | 3B.6 (`resolve_disconnects()` uses `FROM attempts a` join with alias `ve`) |
| `::text` comparison fails (ISO `T`+`+00:00` vs Postgres space+`+00`) | 3B.6 (all comparisons use `::timestamptz` casts) |
| Overlap check described separately but was inline in one UPDATE | 3B.6 (two guarded statements in `resolve_disconnects()`: mark overlaps first, then flip) |
| Logic should be an RPC function for testability | `001_initial.sql` (`resolve_disconnects()` added), `001_smoke_test.sql` (tests 10a–10d) |
| 3A.1 doesn't document send-on-end model | 3A.1 (added: incident ends on return, client sends once with `duration_ms` + `occurred_ago_ms`, sendBeacon fallback) |
| Overlap window only covers disconnect start (incidents > 10s into gap) | 3B.6 (documented as known limitation, deferred to Section 4) |
| 8.49(d) race can't be tested by hand | 8.49(d) (moved to `001_smoke_test.sql` as SQL: short_gap then resolve, verify zero changes) |

### Round 17 Issues (Smoke Test Bug, Coalesce, Security, Status)

| Issue | Where Addressed |
|---|---|
| Smoke test 10b fails (FOCUS_LOST counts=true triggers +1) | `001_smoke_test.sql` (FOCUS_LOST inserted with `counts = false`) |
| No test for clean disconnect flip (positive case) | `001_smoke_test.sql` tests 10e–10g (flip, long_gap, violation_count +1) |
| Null `duration_ms` makes overlap check skip the event | `001_initial.sql` `resolve_disconnects()` uses `coalesce(f.duration_ms, 0)` |
| Null `duration_ms` in 3B.1 reversal has same bug | 3B.1 and contract §3.13 reversal (use `coalesce(duration_ms, 0)`) |
| `resolve_disconnects()` callable by any user | `001_initial.sql` (added `revoke`/`grant` lines) |
| Encoding damage in contract §7 (â€" for em dashes) | `section-3-api-contracts.md` §7 (rewritten with clean UTF-8) |
| Disconnects can count after submission | `resolve_disconnects()` both statements include `a.status = 'in_progress'` |

### Round 18 Issues (Status vs Smoke Test)

| Issue | Where Addressed |
|---|---|
| Smoke test 10 fails: attempt is `submitted` by step 5, so `resolve_disconnects()` matches nothing | `001_smoke_test.sql` (added `set status = 'in_progress'` at top of test 10) |
| 10c/10d pass for wrong reason (guard never exercised if nothing matches) | `001_smoke_test.sql` (status reset fixes all tests) |
| No test confirming submitted attempts are excluded | `001_smoke_test.sql` test 10h (submitted disconnect must not flip) |
| 3B.6 lost ➕ marker and 🔧 superscripts | `implementation-plan.md` 3B.6 (restored ➕ and 🔧⁹ through 🔧¹⁸) |

### Round 19 Issues (Section 4 Integration)

| Issue | Where Addressed |
|---|---|
| One absence could count twice (tab-switch + disconnect) | `001_initial.sql` `resolve_disconnects()` overlap uses full interval rule; `reverse_disconnects_for_incident()` added |
| Retry could double-count an incident | 3B.1 and contract §3.13: client-generated `id`, idempotent insert |
| Counting was too loose (everything counted) | 3B.1: counting order per Section 4 §4.1 (`COUNTING_TYPES`, `meta.source`, status, `joined_at`) |
| No incident lifecycle defined | 3A.1: full lifecycle (attention/episode/instant, join-while-open, client id, queue+retry, exam-start split, flush, sendBeacon) |
| No debounce rules | 3A.2-3A.9: per-signal debounce and grace periods from Section 4 §3.3 |
| Snapshot rules incomplete | 3A.11: Section 4 §6 (1 per incident, 60 max, black frame, TAB_HIDDEN at close) |
| No central config for tunables | 3A.12: `lib/proctoring-config.ts` + `lib/proctoring-rules.ts` |
| LiveKit loss counted as candidate fault | 3A.7 and 4B.4: `meta.source = 'livekit'` does not count |
| COPY/PASTE/CONTEXT_MENU counted | 3A.8: logged but `counts = false` |
| No threshold control on live grid | 3C.5: number field (1-100), amber rule in 3C.2 |
| No dismiss/restore for false positives | 3B.7 and contract §4.15: `PATCH /api/admin/events/[id]` |
| CSV missing violation columns | 7.4: `violations_counted` + `violations_logged` |
| 1D.2 missing threshold range | 1D.2: default 10, range 1-100 |
| Smoke test 10e fails with broader overlap | `001_smoke_test.sql`: delete FOCUS_LOST before 10e |
| No SQL test for one-absence rule | `001_smoke_test.sql` test block 11 (11a-11c) |
| Tests 8.50-8.63 missing | Implementation plan: 14 new tests for Section 4 |

### Round 20 Issues (Post-Integration Cleanup)

| Issue | Where Addressed |
|---|---|
| Old DISCONNECTED E2E tests (8.49) gone | Tests 8.64 and 8.65 restore the plain Wi-Fi blip and clean 3-minute drop cases |
| History range "8.31–8.49" stale | Round 9 table updated to "8.31–8.65" |
| 3B.6 lost the Pass 1 skip rule | 3B.6: restored "skip if most recent is already a DISCONNECTED" |
| 3A.4 lost the orientation lock warning | 3A.4: restored full orientation lock text (lock to current, don't hardcode portrait, unlock on end) |
| Contract §7 old overlap wording | Contract §7: rewritten with full interval rule |
| `admin_actions` list missing dismiss/restore | Contract §1.6: added `event_dismiss`, `event_restore` |
| Route table missing dismiss route | Contract route table: added row 40 |
| §3.13 lost status guard | 3B.1 and contract §3.13: restored "allowed only for acknowledged and in_progress" |
| No client type allowlist | 3B.1 and contract §3.13: explicit 11-type allowlist, everything else returns 400 |
| Dismiss can lose note (null meta) | 3B.7 and contract §4.15: `coalesce(meta, '{}'::jsonb)` |
| `short_gap` write can lose reason (null meta) | 3B.4: same coalesce fix |
| Reversal failure is silent | 3B.1: retry once; 3B.6: worker safety net runs reversal for recent incidents |
| Section 4 missing type allowlist | `section-4-proctoring.md` §4.1 |
| Section 4 missing coalesce note | `section-4-proctoring.md` §7.4 |
| Section 4 missing reversal retry | `section-4-proctoring.md` §5 |

### Round 21 Issues (Section 5 Grading Integration)

| Issue | Where Addressed |
|---|---|
| Single-instance worker guard | 6A.1 (worker checks `system_health('worker')`, exits if active instance with different id exists) |
| Slot manager replaces key manager | 6A.2 (tracks per (key, model): cooldown, daily budget, min interval; skips exhausted slots) |
| Atomic conditional job claim | 6A.4 (claim query checks `status = 'pending'` and repeats read `tries` to avoid race) |
| Heartbeat detailed slot status | 6A.6 (writes `detail` JSON with instance id, queue stats, and per-slot usage) |
| Alert webhook deduping | 6A.7 (uses deduplication keys: `key_disabled:{label}`, `keys_exhausted:{run}`, etc.) |
| Dry-run call quota accounting | 6A.8 (counts against daily budget; run once per key, not on every start) |
| Pacific midnight tracking | 6A.10 (`lib/grading/quota-day.ts` handles PDT/PST resets with unit tests across clock change) |
| JSON batch prompt & HTML sanitize | 6B.1 (JSON array input, stringified text prevents injection, item IDs "1".."n", HTML stripped) |
| API call & schema enforcement | 6B.2 (key in header, strict JSON response schema, temperature 0, timeout) |
| Code-side score validation & partial accept | 6B.3 (step 0.5 rounding, `needs_review` rules in code, `ON CONFLICT DO NOTHING`, partial saves re-queue missing) |
| Error handling & quota cooldown | 6B.4 (distinguishes RPM vs daily quota; 404 pauses runs; 5xx retries; invalid JSON splits job) |
| Audit logging per model and key | 6B.5 (logs `call` with `key_label` and `model`; never logs answers or keys) |
| Auto-resuming run pause | 6B.6 (`handleNoSlot` pauses run on quota exhaustion and automatically resumes after cooldown) |
| Grading worker unit test suite | 6B.7 (vitest unit tests for prompt formatting, validation, review rules, error classifier) |
| Call estimation in grade route | 6D.1 (`202` response includes `estimated_calls` alongside quota reminder) |
| Progress screen per-slot usage | 6D.3 (shows slot usage from heartbeat `detail`, queue counts, and unscored count) |
| Review screen model details & unscored count | 6D.4 (shows model, prompt version, needs-review filter, and not-graded count) |
| Bulk regrade question route | 6D.8 (`POST /api/admin/exams/[id]/regrade-question` creates jobs for all attempts with answer, keeps overrides) |
| Prompt test harness & 429 fixtures | 6E.1–6E.4 (`test-prompt.ts` with 15 cases; capture real 429 error fixtures) |
| Grading completion criteria | Phase 6 "Done when" (prompt tests pass, failover verified, auto-resume verified, crash idempotency) |
| Unscored questions in CSV export | 7.4 (added `unscored_count` column placed after `needs_review_count`) |
| Worker environment configuration | 0.4 (added worker-only variables: `GEMINI_KEY_1..3`, `GEMINI_MODEL`, `GEMINI_DAILY_LIMITS`, `GRADING_*`, `REVIEW_*`) |
| 002_grading.sql migration missing | 1A.2b added, 1A.2 updated (smoke block 12), Phase 1A Done-when updated |
| 6D.8 precondition wording trap | 6D.8 clarified to "exam must be finalized, else 409 exam_not_finalized" |
| Chunk size configurable from worker env | Contract §4.6 and plan 6B.1/6D.1 specify chunk size from worker config (default 10, `GRADING_CHUNK_SIZE`) |
| Regrade single vs bulk wording distinction | 6D.6 (single-candidate) and 6D.8 (bulk for all candidates) clearly distinguished in plan and contracts |
| Phase 8 tests 8.66–8.86 | Phase 8 (21 new tests covering quota, errors, partial accepts, prompt injection, and DST) |


### Round 22 Issues (Section 6 Infra & Ops Integration)

| Issue | Where Addressed |
|---|---|
| Single-instance guard crash/deploy trap | 6A.1 (replaces exit on fresh heartbeat with 65s polling check, takes over if heartbeat stalled, exit code 3 if advancing; graceful SIGTERM marks row `down`) |
| pg_dump server version mismatch | 8.12, 8.93 (check Supabase PG version, install matching postgresql-client-17 from PGDG) |
| Missing infra templates & scripts | 0.8, 4D.1, 4D.3 (`setup-ec2.sh`, `deploy-worker.sh`, `check-stack.sh`, `backup-db.sh`, `exam-worker.service`, `livekit.env.example`, `web.env.example`, `worker.env.example`) |
| Tight memory on t3.small (2 GB) | 4D.6 (2 GB swap), 8.94 (capacity check, watch `free -m` and docker stats, resize to t3.medium if needed) |
| Dead worker unmonitored | 5C.2 (health route returns non-200 if worker heartbeat > 90s stale so UptimeRobot alerts) |
| Telegram/Discord webhook formats | 6A.7 (detects format from webhook hostname, 5s timeout, 1 retry) |
| Worker-level alerts & dedup keys | 6A.7 (`worker_started`, `guard_exit`, `supabase_unreachable`) |
| Credentials persistence in password manager | 0.4 (`SESSION_SECRET` and `NIC_PEPPER` saved in password manager, never changed once candidates imported) |
| LiveKit Cloud local dev only | 4A.2 (cloud for local dev only, production on self-hosted EC2) |
| EC2 security group rules | 4D.5 (port 22 restricted to admin IP, 80, 443, 7881, 3478/udp, 50000-60000/udp; 7880 and 6379 internal only) |
| Exam-day runbook & failure playbook | 8.12 (points to Section 6 §10 runbook replacing §18, plus 12-scenario failure playbook from §11) |
| Phase 4 mobile data check | Phase 4 Done-when (candidate on mobile data publishes to admin grid) |
| Phase 8 verification criteria | Phase 8 Done-when (restore drill passed, capacity numbers recorded, alert test received) |
| Phase 8 tests 8.87–8.96 | Phase 8 (10 new tests for worker takeover, alerts, reboot, restore drill, capacity check, and shared-IP login) |

> [!WARNING]
> **Docs out of sync**: The main plan (`exam-platform-plan.md`) SQL schema and worker sections are still v3. The authoritative schema is now `SECTIONS/001_initial.sql`, the API contracts in `SECTIONS/section-3-api-contracts.md`, and the task edits in `SECTIONS/section-1-migration.md`. **Do not copy SQL from the main plan** — use the Section files. The main plan should be updated separately once implementation begins.
