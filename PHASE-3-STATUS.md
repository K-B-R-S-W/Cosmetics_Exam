# Phase 3 Status

Date: 5 October 2026

## Current gate

Phase 3 Commit 1 is prepared for review. Migration 007 and smoke-test block 16 have **not** been executed. No Phase 3 application or worker code has been started. Commit 2 remains blocked until migration 007 and the full smoke test pass on the development project.

## Commit 1 database scope

- `record_candidate_event` owns event idempotency, status and rate guards, server-side counting, snapshot-path reservation, and late-focus disconnect reversal in one transaction.
- `candidate_heartbeat` uses the database clock to update `last_seen_at`, write `RECONNECTED`, classify the gap, and return candidate state. Commit 2 must normalize every returned timestamp through `toISOString()` and contract-test the real RPC-shaped output.
- `classify_disconnect` is shared by heartbeat and Pass 2. Below two minutes it writes `short_gap`; at two minutes or later it applies the common overlap rule and writes `overlap` or counted `long_gap`.
- `record_disconnects` and `resolve_disconnects` each lock at most 500 eligible attempts using `FOR UPDATE SKIP LOCKED` in UUID order. Their eligibility predicates are in the locking query. Rows beyond 500 stay eligible for the next tick.
- `reverse_recent_disconnects` is the bounded late-event safety net. It processes distinct attempts in UUID order before their event ids. Snapshot-failure repair, login violations and admin dismiss/restore are separate service-role-only RPCs.
- The proposed high-churn `idx_attempts_in_progress_last_seen` index was dropped. At the expected maximum of 23 attempts, the scan is cheaper than maintaining an index entry on every 10-second heartbeat. Migration 007 adds only three violation-event indexes.

## Lock-order review

Candidate event and heartbeat transactions lock session → exam → attempt → event rows. Worker Pass 1 and Pass 2 need no exam row and lock attempts in UUID order with `SKIP LOCKED`. The recent-reversal function retains locks until return, so it groups by distinct attempt and acquires those attempt locks in UUID order, matching finalization. Single-event reversal and dismiss/restore lock one attempt before changing its violation rows. The count trigger updates that same attempt.

No new path holds an attempt and then requests an exam lock. This introduces no cycle with `save_answer`, `advance_position`, `generate_paper`, `submit_due_attempt`, `finalize_exam_if_closed`, unassignment or the question RPCs. The single-session smoke test cannot prove concurrent row-lock behaviour; the two-session rehearsal remains required.

## Traffic accounting

The Phase 2 temporary state poll currently costs about **138 Data API calls per minute** at 23 candidates: 23 candidates × 6 polls × 2 calls (candidate authorization plus state read). Phase 3 heartbeat replaces that poll and has the same steady profile: 23 × 6 × 2 = **138 calls per minute** (candidate authorization plus one heartbeat RPC). It does not add a second poll; the earlier 276 figure was double-counting both mechanisms.

The heartbeat RPC writes `attempts.last_seen_at` once per acknowledged/in-progress candidate every 10 seconds. It adds violation writes only on a qualifying reconnect. This is the only new high-frequency attempt-table write. Realtime consumers must ignore attempt updates where only `last_seen_at` changed.

Worker proctoring adds three RPC calls every 30-second pass: Pass 1, Pass 2 and the recent-reversal safety net. Each failure is isolated so proctoring cannot delay Phase 2 due submission or finalization. Database call profiles and observed timings will be reported after Commit 2 tests; nothing in Commit 1 has been run.

## Approved client and deployment rules for Commit 2

- The event queue holds 50 entries and drops the **oldest** on overflow. Network errors, 5xx and 429 retry with backoff; 400, 401 and 403 are permanent drops.
- Every write schema is strict. Unknown keys fail, so client/server contract changes deploy together and never during an active exam.
- Heartbeat replaces the temporary state poll and stops on Done. A 401 must settle loading and show the correct unauthenticated or session-revoked screen, including in React Strict Mode.
- The heartbeat route normalizes RPC timestamp values with `toISOString()`; its contract test starts from the real RPC output shape.
- `useViolationRealtime` ignores attempt updates where only `last_seen_at` changed.

## Done-when interpretation

Every Section 4 §8.1 event type must appear in the admin log. A snapshot is required only for snapshot-eligible types when a usable camera frame exists: `TAB_HIDDEN`, `FOCUS_LOST`, `FULLSCREEN_EXIT`, `VIEWPORT_CHANGED`, and `MULTI_SCREEN`. Camera/mic loss, disconnect/reconnect, multi-login, copy, paste, context-menu and reload events intentionally have no snapshot. Split view and side-panel cases still require device rehearsal, and one alt-tab must remain one merged incident rather than three.

## Still unverified

- Migration 007 execution, block 16, function grants and query behaviour on Supabase.
- Two-session Pass 1/Pass 2 locking, skip-locked behaviour and race interaction with heartbeat/save/advance.
- Browser/device detection, snapshots, split view, side panel, fullscreen/orientation and pagehide beacon behaviour.
- Phase 4 camera/mic and LiveKit integration; Phase 3 uses injected media interfaces only and will not add LiveKit code.
