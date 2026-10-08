# Phase 6 status — AI grading

Status: locally implemented with mocked/unit verification only. Migration 011 is reported applied by the project owner; migration 012 is written but **not applied**. No Gemini call, SQL execution, Supabase project test, server start, deployment, or hosted test was performed in this build.

Final local verification on 8 October 2026: web typecheck, ESLint, colour lint, 139 test files / 637 tests and production build passed; worker typecheck, ESLint, 19 test files / 68 tests, build and isolated `test:dist` passed.

## Implemented

- Independent worker grading lane: 30-second idle / 2-second active cadence, own overlap guard, and at most three jobs selected per tick.
- Exactly `gemini-3.7-flash`; each configured key requires a positive environment limit. Key text, prompts, candidate answers and model response text are excluded from logs and alerts.
- Deterministic MCQ scoring and blank-written auto-zero remain in migration 011's `start_grading`. Totals use `current_scores` through `recompute_results`, so overrides win.
- Prompt `g1`, HTML-to-text conversion, parsing, mark clamping/rounding, review flags, partial requeue, bounded chunk-index collision retry, quota slots, safe logs and race-safe in-app alerts.
- The worker ships the complete Section 5 `g1` system instruction. Database write failures are not treated as parse failures, permanent blocked responses fail immediately, model-not-found requeues the claimed job before pausing, transient retries use the process-local 2 / 6 / 20-second schedule, and consecutive RPM cooldowns use 30 seconds / 2 minutes / 10 minutes.
- Admin start/resume/progress/review/override/single regrade/bulk regrade routes and pages. Progress returns labels/counts only and caps logs at 50.
- Operator commands: `npm run dry-run` and `npm run test:prompt` in `worker/`. Neither runs at startup.
- The production build cleans `worker/dist`, emits the deployment-required `dist/index.js`, and `test:dist` executes that exact artifact from an isolated directory.
- Gemini daily limits are read once when the worker process starts. The Results page shows the slot limits from the latest worker heartbeat, not directly from the env file; after changing `GEMINI_DAILY_LIMITS`, restart the worker and allow up to 30 seconds for the first grading-state heartbeat. Use the worker heartbeat age and instance/version on Health to distinguish a stale process/report.

## Database-call profile

- Idle grading tick: resume-due read + pending-job read + running-run completion read + active-work count + queue counts for health = 5 reads, zero writes when unchanged.
- Startup adds usage reconstruction, stuck-job reset and one safe `worker_start` log write. Every five minutes the key check makes one external model-list request and, when it returns, one `api_key_state` write per configured label; a failure for one label does not stop the others or the grading tick.
- Active job: claim update, input read, one Gemini call, call-log insert, one normal batch score insert, job completion update, recompute RPC and done-log insert. On a crash-retry `23505`, the score insert falls back to at most one insert per item (maximum 10) so partial unique-index duplicates are ignored safely. Partial/error paths add only their requeue/split/pause writes. Up to three jobs run concurrently, one per usable key slot.
- `GET /api/admin/grading`: six parallel initial reads (including worker health for label usage counts) plus two parallel exact not-graded reads (paper assignments and `current_scores`) = 8 reads. Start grading: active-key read, one RPC and one audit insert. Resume: one RPC and one audit insert. Single/bulk regrade: one RPC whose transaction includes its audit row. Override: attempt read, paper-question read, score insert, recompute RPC and audit insert.

## Not live-verified

Migration 012 behavior/grants; SQL locks; real model availability/schema; quota payloads; real 429 classification; failover; pause/auto-resume; crash idempotency; grading quality; Sinhala/Singlish results; real admin rows; EC2 operation.

Synthetic 429 fixtures contain top-level `"synthetic": true` and `.synthetic` in their filenames. They are not real captures.
