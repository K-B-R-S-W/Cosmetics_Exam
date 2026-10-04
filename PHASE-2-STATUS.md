# Phase 2 status

**Status:** Batch 1 locally complete; Supabase-backed manual verification and login-load timing pending

This record covers implementation-plan tasks 2A.1 through 2A.8 and 2B.1 through 2B.6 within the explicitly approved Batch 1 scope.

| Task | Local status | Note |
|---|---|---|
| 2A.1 Login page | Complete | MER/ID form, fixed error copy, rate-limit countdown, and an unselected multi-exam picker; the ID exists only in component memory while the picker is open |
| 2A.2 Login API | Complete | Constant-cost unknown-MER path, assignment selection, attempts, one active session, and MULTI_LOGIN/RECONNECTED handling |
| 2A.3 Rate limiting | Complete | Failed attempts only: 5 per MER and 200 per IP over 10 minutes, with calculated retry time and no insert while blocked |
| 2A.4 Candidate session validation | Complete | The cookie contains only the session id; every candidate call validates the joined session/attempt row in one query |
| 2A.5 Confirmation page | Complete | Identity is shown without ID data; confirmation remains in sessionStorage only for the confirm-to-rules step |
| 2A.6 Acknowledge API | Complete | Both consent flags are required; status update is idempotent and guarded by exam/attempt state |
| 2A.7 Me API | Complete | Candidate identity, plain-text exam data, question count, attempt state, and validated retention days |
| 2A.8 Logout API | Complete | Idempotently revokes the server session and clears the sealed cookie |
| 2B.1 Broadcast hook | Complete | Subscribes to `exam:{examId}` and treats every `exam` event and resubscription only as a state-refetch nudge |
| 2B.2 Broadcast publisher | Complete | Uses the current Supabase single-message Realtime REST Broadcast endpoint; failures are logged and swallowed |
| 2B.3 Waiting room | Complete for Batch 1 | Server-corrected countdown, 10 s polling, 3 s zero-gap polling, start-time notices, reconnect banner, and client-side transitions |
| 2B.4 Time sync | Complete | Three midpoint samples, median offset, 60 s resync, and state-response refinement |
| 2B.5 Exam state API | Complete | Exact shared shape, no writes or paper generation, and two database round trips total including candidate authentication |
| 2B.6 Rules screen | Complete | Exact ordered copy, API-sourced retention, navigation-mode text, device setup, and one final acknowledgement call |

## Explicitly deferred by the Batch 1 scope

- Camera preview and camera/microphone status: Phase 4/5 media work.
- Fullscreen overlay and proctoring hook: Phase 3/5.
- Heartbeat: task 3B.4; it will reuse `buildStateBody()`.
- Announcement claim/toast delivery: task 5A.5. The state shape currently returns `announcements: []`.
- Paper loading and the real exam screen: Phase 2 batch 2. The waiting-room transition contains the required TODO at that boundary.
- Done-page behavior: Phase 2 batch 3.

## Reconciled plan differences

- Plan 2B.3 names heartbeat, camera preview, and fullscreen in the waiting room. The approved Batch 1 scope replaces heartbeat with `GET /api/exam/state` polling and explicitly defers the media/fullscreen work.
- Plan 2B.5 says heartbeat and state share a body. Batch 1 implements the exported shared builder on the state route; the later heartbeat route will reuse it.
- The contract normally supplies pending announcement ids. The approved scope keeps the field but returns an empty list until task 5A.5.
- The candidate-screen specification loads the paper before entering `/exam`. The approved scope sends live candidates to the clearly marked placeholder and leaves paper loading to batch 2.

## Verification still requiring local credentials

`apps/web/scripts/measure-login.mjs` performs one login, then exactly 23 parallel logins, and reports Argon2 hash/verify cost plus p50, p95, and slowest HTTP latency without printing credentials. It requires `LOGIN_TIMING_CREDENTIALS` in the process environment. No raw candidate IDs are stored in the repository.

The same script's Argon-only mode measured one policy hash at **24.6 ms** and one verify at **18.2 ms** on this development machine on 2026-10-04. The HTTP p50/p95/slowest values remain pending until the 23 credential objects are supplied at runtime.
