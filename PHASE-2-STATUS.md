# Phase 2 status

**Status:** Batches 1 and 2 locally complete; Supabase-backed manual verification and load timing pending

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

## Batch 2: paper delivery and exam screen

| Task | Local status | Note |
|---|---|---|
| 2C.1 Paper API | Complete | Candidate-authenticated, mode-aware response with explicit candidate columns, saved revisions, `null` free-mode position, and no answer-key or Storage-path data |
| 2C.2 Complete paper creation | Complete | Calls the existing idempotent `generate_paper`; route-level checks use `attemptDeadline()` and `examPhase()` before the RPC |
| 2C.3 Shuffle logic | Complete | Uses only the database-saved question positions and option UUID order; the route never reshuffles |
| 2D.1 Exam frame | Complete for Batch 2 | `100dvh`, overscroll prevention, fixed regions, browser-Back containment, free/sequential layouts, and client-side transitions |
| 2D.2 Question renderer | Complete | Candidate-safe rich text, MCQ order, written input, optional authenticated images, Sinhala language attributes, and marks |
| 2D.3 Timer | Complete | Server-clock offset, per-attempt deadline, zero clamp, token states, and announcements only at 30/10/5/1 minutes |
| 2D.4 Save indicator | Deliberately deferred | It truthfully says "Answers are not saved yet (Phase 2 batch 3)" instead of displaying a false Saved state |
| 2D.5–2D.6 Answer inputs | Complete for Batch 2 | Values and flags are React-memory-only; there is no answer network request or browser persistence |
| 2D.7 Sequential Next | Deliberately disabled | Section 3 sends only the current sequential question. Batch 3 adds the atomic Next route before this control can advance safely |
| 2D.8 Free question list | Complete for Batch 2 | Local navigation, word-and-icon status, flags, portrait drawer, and local review summary; final Submit is disabled |
| 2D.9 Touch layout | Complete locally | Existing tokens, 44 px controls, tablet drawer breakpoint, `100dvh`, and no hover-only action |

### Database/network cost

- `GET /api/exam/paper`: five database calls in four sequential stages: candidate auth; exam/deadline lookup; `generate_paper`; then question/options and saved-answer reads in parallel.
- `GET /api/question-images/[questionId]`: two database calls including candidate auth, then one private Storage download.
- `POST /api/exam/next`: five database calls on an advancement response: candidate authentication, exam/deadline and question-count lookup, `advance_position`, the single target assignment/question row, then only that question's saved answer.
- Waiting-room start handoff: the paper route above followed by the required state refresh (two more database calls) before client-side navigation.
- Unit tests verify the four paper stages and use a synthetic 40 ms paper + 20 ms state-refresh schedule to prove `/exam` is not entered until the full mocked 60 ms handoff completes. Those values are controlled test timings, not production measurements.

### Known deadline race accepted for Batch 2

The route calculates the deadline with the same `attemptDeadline()` and `examPhase()` helpers as the state builder and returns `409 exam_closed` before `generate_paper` when the deadline has passed. The database function does not repeat that deadline check, so a request that crosses the deadline in the milliseconds between the route check and the RPC can still create the paper. The resulting screen has a timer already clamped to zero and grants no extra answering time; the later deadline auto-submit in plan 2F.5 closes the attempt. This accepted race must be revisited during the Phase 6 review.

### Explicit Batch 3 deferrals

- `/api/answers`, autosave, IndexedDB/offline queue, real save indicator, and persisted flags.
- `/api/exam/next`, sequential advancement, blank-answer confirmation, and double-tap/server-idempotency handling.
- `/api/exam/submit`, time-up flushing, final Submit behavior, and the completed Done screen.
- Batch 3 / task 3B.4 must re-derive `locallyExpired` from fresh server state; `extra_minutes` granted after a local lock must unlock the screen.
- Until those exist, the screen always shows "Answers are not saved yet (Phase 2 batch 3)", locks at zero without claiming to send anything, and disables sequential Next and final Submit.

### Reconciled specification differences

- Plan 2D.4's green/yellow/orange wording is superseded by Section 2A's words-and-icons rule; Batch 2 cannot truthfully display any saved state.
- Section 2B's full exam flow assumes the 2E/2F endpoints. The approved Batch 2 boundary keeps answer/navigation state in memory and disables actions that require those endpoints.
- Section 3's free-mode rule wins over its JSON example: `PaperBody.current_position` is `null` in free mode and is ignored by the free UI.
- Sequential mode receives only its current question, so later questions are not exposed merely to simulate local Next.
- The optional image dimensions are omitted because the schema does not store them. The UI reserves an image region and retains aspect ratio after load.
- Candidate image responses use `Cache-Control: private, max-age=300, no-transform`; all JSON candidate responses remain `no-store`.
- The answer limit follows the specific Section 2B/API rule: warning from 19,000 characters and a hard stop at 20,000.
- Paper loading classifies draft/scheduled as `exam_not_live`, but ended/finalized/force-ended and expired attempts as `exam_closed`. This prevents the closed in-progress route guard from bouncing `/exam` to `/waiting` and back.
- Transient paper failures still retry every five seconds. After six consecutive failures both waiting and exam loading show "This is taking longer than expected. Tell the exam team if this continues." while quiet retries continue; a successful load resets the counter.
- Camera, fullscreen, heartbeat, proctoring/events, autosave, announcements, worker changes, and the finished Done page remain outside this batch.

### Manual review additions

1. Force-end the exam while a candidate is `in_progress`, then reload `/exam`. Expect the "Time is up" lock with no redirect loop and no repeated paper requests in the network tab.
2. Set the exam status to `ended` while a candidate is `in_progress`, then reload `/exam`. Expect the same locked state, no redirect loop, and no repeated paper requests.

### How to prepare the paper-burst test exam

Do not run `apps/web/scripts/measure-paper-burst.mjs` against a production exam. Prepare one development exam with all of the following:

1. Exactly 23 synthetic active candidates assigned to the same exam.
2. Every candidate has logged in, accepted the rules, and has an attempt whose status is exactly `acknowledged`.
3. The exam has at least one composed question and has been started, so its status is exactly `live`.
4. `ends_at` is present and safely in the future for all 23 candidates.
5. Set `PAPER_BURST_BASE_URL` and provide the 23 synthetic `{ mer_code, nic, exam_id? }` objects only through `PAPER_BURST_CREDENTIALS` in the process environment.

The script logs in and checks all 23 state responses before issuing any paper request. If any exam is not live, any `ends_at` is absent/past, any attempt is not exactly acknowledged, or the candidates do not share one exam, it exits and sends no paper requests. A successful run moves all 23 attempts to `in_progress` and cannot be repeated on that exam. The script has not been run by the implementation agent.
