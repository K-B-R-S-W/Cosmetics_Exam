# Phase 5 status

Phase 5 is being implemented locally. Nothing in this file is a claim of live verification.

## 5A — Admin controls

Status: locally implemented and unit-tested. Migration `008_admin_controls.sql` is written but has **not** been applied or run by the agent.

- Start and force-end are safe to retry. A recognized force-end repeat also works after worker finalization; it returns stored state without duplicate side effects, or self-heals the missing `force_end` audit row and `exam_ended` Broadcast if the original audit write failed.
- Extend and broadcast are not idempotent. After a 503 or audit failure, the UI reloads server state before offering another attempt because the database change may already have committed.
- Kick revokes sessions before best-effort LiveKit removal. The signed-out candidate lifecycle remains the only browser-side terminal media stop.
- The existing worker remains responsible for submissions after the force-end collection window; the route does not loop over attempts or synthesize answers.

### Database-call profile

Counts include the normal admin authorization (`getUser` plus the cached profile lookup) and count Realtime Broadcast HTTP as an external call.

- Start, first success: 2 auth + 1 `start_exam` RPC + 1 audit insert + 1 Broadcast = **5 calls**.
- Start, recognized retry: 2 auth + 1 `start_exam` RPC + 1 audit lookup = **4 calls**; no write or Broadcast.
- Extend everyone, usual success: 2 auth + 1 exam read + 1 conditional update + 1 audit insert + 1 Broadcast = **6 calls**. Three lost compare-and-set attempts: 2 auth + 6 database calls = **8 calls**, then 409.
- Extend one candidate, usual success: 2 auth + 1 joined attempt/exam read + 1 conditional update + 1 audit insert + 1 Broadcast = **6 calls**; maximum **8** before 409.
- Force-end, first success: 2 auth + 1 `force_end_exam` RPC + 1 audit insert + 1 Broadcast = **5 calls**.
- Force-end, recognized retry with an existing audit: 2 auth + 1 RPC + 1 audit lookup = **4 calls**; no new write or Broadcast. If the audit row is missing: add 1 audit insert + 1 Broadcast = **6 calls**, healing both side effects.
- Force-submit: 2 auth + 1 attempt lookup + 1 `submit_attempt` RPC; on a changed row add 1 audit insert + 1 Broadcast = **4–6 calls**.
- Kick: 2 auth + 1 attempt lookup + 1 session update + 1 LiveKit removal + 1 audit insert + 1 Broadcast = **7 calls**.
- Broadcast send: 2 auth + 1 `create_broadcast` RPC + 1 audit insert + 1 Broadcast = **5 calls**. History load is 2 auth + 1 select = **3 calls**.

## 5B — Pre-exam check

Status: locally implemented and unit-tested; real Chrome/device behavior remains unverified.

- The staged Check page verifies Chrome, live camera plus an unmuted live microphone track, fullscreen, server connectivity and display conditions. A second screen warns but does not block; Android Desktop site blocks.
- Camera/microphone, fullscreen and wake-lock requests originate only from Check. Continue verifies fullscreen again at click time. Waiting and Exam keep the existing blocking fullscreen overlay if fullscreen is later lost.
- `DeviceCheckProvider` sits outside `CandidateProvider`, so route-guard loading and transient redirect frames retain the wake lock. Session reset and terminal candidate screens release it; Done also releases it before logout.
- Wake Lock rejection is intentionally silent and non-blocking. A wanted lock is requested again when the document becomes visible.
- Device verification is still required for UA Client Hints, Android Desktop site, fullscreen/orientation behavior, wake-lock reacquisition and real camera/microphone state.

## 5C — Super-admin health and alerts

Status: locally implemented and unit-tested; no hosted monitor or live service outage has been verified.

- `/admin/health` and `/api/admin/health` require a super admin. The page refreshes every 15 seconds and reports Supabase latency, LiveKit latency/room count, worker freshness, Gemini key state read only from `api_key_state`, and active alerts.
- A failed Supabase or LiveKit check, or worker heartbeat age over 90 seconds, makes the detailed route non-200 while preserving the safe component-status body. Cooling or disabled Gemini keys are displayed but do not make the route non-200.
- The public `/api/health` remains minimal and returns 503 when Supabase is unavailable or the worker row is down, missing, or older than 90 seconds. It exposes no internal detail.
- The top-bar chip is super-admin-only, loads active alerts during the admin layout request, authenticates its Realtime channel, and refreshes its count on alert changes. Resolving is idempotent and writes one `alert_resolve` audit row only on the first change.
- UptimeRobot configuration is a deployment/manual step and was not performed. Snapshot cleanup remains Phase 7.7 and is not part of this build.

### 5C database-call profile

- Admin layout full load, super admin: cached admin authorization costs at most 1 Auth `getUser` plus 1 `admin_profiles` query, followed by 1 active-alert select = **3 calls**. A plain admin makes no alert query.
- Detailed health poll: 2 authorization calls + 3 parallel selects (`system_health`, `api_key_state`, `alerts`) + 1 LiveKit request = **6 calls per poll**. At the fixed 15-second interval, one open page makes **20 Auth/Data API calls plus 4 LiveKit calls per minute**.
- Alert Realtime change: **1 authenticated alerts select** to reconcile the chip; no polling when no event arrives.
- Resolve alert, first change: 2 authorization calls + 1 conditional alert update + 1 audit insert = **4 calls**. A safe repeat uses the update plus 1 lookup and no audit, also **4 calls**.
- Public health: **1 `system_health` select per request**.

## Live verification

No Phase 5 behavior is live-verified yet. Use `PHASE-5-TEST-STEPS.md` after all three local commits and after the user applies migration 008.
