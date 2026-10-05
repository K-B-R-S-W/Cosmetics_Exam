# Phase 3 Status

Date: 5 October 2026

## Current status

Phase 3 is locally implemented through 3A, 3B and the reusable 3C admin components. Migration 007 was applied to the development Supabase project and the full smoke test returned **SMOKE TEST PASSED**, with `generate_paper` for 100 questions measured at **4.29 ms**. Browser/device rehearsal and Phase 4 integration remain unverified.

The Phase 3 commits are split into event/heartbeat services, candidate proctoring, heartbeat replacement, and admin/status work. No Phase 3 code has been deployed or pushed by the implementation agent.

## Database behaviour and lock review

- `record_candidate_event` owns idempotency, status and rate guards, server-side counting, snapshot-path reservation, and late-focus disconnect reversal in one transaction.
- `candidate_heartbeat` uses the database clock to update `last_seen_at`, write `RECONNECTED`, classify the gap, and return candidate state. All route timestamps are normalized to ISO strings.
- `classify_disconnect` is shared by heartbeat and Pass 2. Below two minutes it writes `short_gap`; at two minutes or later it applies the common overlap rule and writes `overlap` or counted `long_gap`.
- `record_disconnects` and `resolve_disconnects` each lock at most 500 eligible attempts using `FOR UPDATE SKIP LOCKED` in UUID order. Eligibility is rechecked in the locking query. Overflow remains eligible on the next 30-second proctoring tick.
- `reverse_recent_disconnects` processes distinct attempts in UUID order before event ids. Snapshot repair, login violations, and admin dismiss/restore are separate service-role-only RPCs.
- The high-churn `attempts.last_seen_at` column is deliberately not indexed at the expected maximum of 23 attempts.

Candidate event and heartbeat transactions lock session, then exam, then attempt, then event rows. Worker Passes 1 and 2 do not request an exam lock and lock attempts in UUID order with `SKIP LOCKED`. Recent reversal groups and locks distinct attempts in UUID order. Dismiss/restore locks one attempt before changing its violation row, and the count trigger updates that same attempt. No new path holds an attempt and later requests an exam lock, so the reviewed scheduler, answer, paper, unassign, question and proctoring paths contain no lock-order cycle.

The smoke and mocked tests cannot prove concurrent row-lock or `SKIP LOCKED` behaviour. The documented two-session test remains required.

## Request and worker call profiles

- `POST /api/events`: candidate authorization, then `record_candidate_event` = 2 database calls. A reserved snapshot adds one private Storage upload. Only an upload failure adds `mark_violation_snapshot_failed` = 1 more RPC.
- `POST /api/heartbeat`: candidate authorization, then `candidate_heartbeat` = 2 database calls and one `attempts.last_seen_at` write for an acknowledged/in-progress attempt. A qualifying reconnect also inserts `RECONNECTED` and classifies the gap inside the RPC.
- `PATCH /api/admin/events/[id]`: cached admin authentication costs at most Auth `getUser` plus one profile query, then one `dismiss_violation_event` RPC. The event update, count-trigger update and audit insert are atomic in the RPC.
- Successful sequential Next: its existing route work completes and the next question renders; a queued immediate heartbeat then adds 2 database calls. The heartbeat never delays rendering.

The former Phase 2 state sync cost about **138 calls per minute** at 23 candidates. Phase 3 heartbeat replaces that poll and retains the approved **138-call-per-minute** steady profile; it does not run alongside a second state poll. Realtime consumers ignore attempt updates where only `last_seen_at` changed.

The worker has two independent non-overlapping lanes:

- Lifecycle lane every 10 seconds: unchanged from Phase 2. Idle profile is its three bounded lifecycle reads/RPC stages; due-attempt work remains database-clock authoritative and isolated per item.
- Proctoring lane every 30 seconds: exactly 3 RPC calls (`record_disconnects`, `resolve_disconnects`, `reverse_recent_disconnects`) whether idle or with 23 in-progress attempts. Each failure is isolated. Its separate timer and guard mean a hanging proctoring pass does not skip a lifecycle tick.

## Client rules implemented

- Event requests use strict schemas and client-generated UUIDs. Unknown keys fail, so client/server write-contract changes must deploy together and never during an active exam.
- The queue is mirrored to session storage, capped at 50, and drops the oldest entry on overflow. Network errors, 5xx and 429 retry with backoff; 400, 401 and 403 are permanent drops.
- Heartbeat is the only 10-second candidate state-sync loop on Waiting and Exam, continues while locked, and stops on Done. A 401 settles loading and shows the correct unauthenticated/session-revoked screen, including under React Strict Mode.
- Heartbeat timestamps are normalized with `toISOString()` and tested from the real RPC-shaped response.
- Snapshot capture is limited to eligible types and a usable injected video element. Phase 3 has no LiveKit dependency.
- `useViolationRealtime` ignores attempt updates where only `last_seen_at` changed.
- The 3C timeline, badge, threshold control and Realtime hook are built and unit-tested but intentionally unmounted. Phase 4 mounts them into the live grid and supplies media tracks and the selected-candidate event loader.

## Done-when interpretation

Every Section 4 section 8.1 event type must appear in the admin log. A snapshot is required only for snapshot-eligible types when a usable camera frame exists: `TAB_HIDDEN`, `FOCUS_LOST`, `FULLSCREEN_EXIT`, `VIEWPORT_CHANGED`, and `MULTI_SCREEN`. Camera/mic loss, disconnect/reconnect, multi-login, copy, paste, context-menu and reload intentionally have no snapshot. Split view and side-panel cases still require device rehearsal, and one alt-tab must remain one merged incident rather than three.

## Manual device checklist

- Enter Waiting in fullscreen, leave fullscreen, and restore it. Confirm the blocking overlay and an uncounted waiting-room event.
- In an active exam, exercise tab hide, focus loss/alt-tab, fullscreen exit, split view/side panel, and an extended display. Confirm one merged alt-tab incident and eligible snapshots when the camera frame is usable.
- Cover the camera for a black frame, then trigger a snapshot-eligible incident. Confirm the event remains and records the black-frame skip.
- Mute/end injected camera and microphone tracks for more than five seconds, then restore them. Confirm `CAMERA_LOST`/`MIC_LOST` with the correct source and no snapshot.
- Try copy, paste, long-press/context menu and reload. Confirm blocking/logging, the paste notice, and no snapshots for these types.
- Block heartbeat for 40 seconds and reconnect: confirm non-counting `short_gap`. Repeat for more than two minutes: confirm `long_gap`, then repeat with an overlapping tab/focus incident and confirm the disconnect does not also count.
- Dismiss and restore a counted event with a note. Confirm the badge count, reason and audit action change once.
- Change the threshold from 10 and confirm amber at half, red at threshold, a single threshold-crossing callback/toast, and unchanged MER ordering.
- On Done, confirm heartbeat stops. Revoke a session during Waiting/Exam and confirm the signed-out screen instead of permanent Loading.

## Still unverified or deferred

- Two-session Pass 1/Pass 2 lock races, `SKIP LOCKED`, and interaction with heartbeat/save/advance.
- Real Chrome tablet/laptop behaviour for focus, notification shade, side panel, split view, fullscreen, orientation, `screen.isExtended`, black-frame capture, pagehide beacon, and throttled timers.
- Phase 4 LiveKit camera/mic tracks and the mounted admin live grid. Phase 3 uses injected media interfaces only.
- Worker single-instance guard 6A.1 and health heartbeat 6A.6 still block production deployment. The worker must be deployed before a real exam only after those are complete.
- Plan row 6A.7 remains stale because Discord/Telegram alerts are a locked-out feature; it is not Phase 3 scope.
