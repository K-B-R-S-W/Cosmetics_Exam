# Phase 2 status

**Status:** Phase 2 locally complete except task 2F.5 (worker scheduler); credential-backed manual verification and load timing pending

This record covers the locally implemented Phase 2 candidate flow. Task 2F.5 has its own upcoming Gate 1 and no worker application exists yet.

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
| 2D.4 Save indicator | Complete | Word-and-icon waiting, saving, saved, offline, retrying and failed states; only problem transitions and recovery are announced |
| 2D.5–2D.6 Answer inputs | Complete | IndexedDB-first persistence, server autosave, revision recovery, durable/degraded offline behavior, and saved flags |
| 2D.7 Sequential Next | Complete | Blank-answer confirmation, cleared-answer save, double-tap guard, idempotent server advance and current-question resync |
| 2D.8 Free question list | Complete | Local navigation with a bounded flush, word-and-icon status, flags, review summary, and final Submit flow |
| 2D.9 Touch layout | Complete locally | Existing tokens, 44 px controls, tablet drawer breakpoint, `100dvh`, and no hover-only action |

### Database/network cost

- `GET /api/exam/paper`: five database calls in four sequential stages: candidate auth; exam/deadline lookup; `generate_paper`; then question/options and saved-answer reads in parallel.
- `GET /api/question-images/[questionId]`: two database calls including candidate auth, then one private Storage download.
- `POST /api/exam/next`: five database calls on an advancement response: candidate authentication, exam/deadline and question-count lookup, `advance_position`, the single target assignment/question row, then only that question's saved answer.
- Waiting-room start handoff: the paper route above followed by the required state refresh (two more database calls) before client-side navigation.
- Unit tests verify the four paper stages and use a synthetic 40 ms paper + 20 ms state-refresh schedule to prove `/exam` is not entered until the full mocked 60 ms handoff completes. Those values are controlled test timings, not production measurements.

### Known deadline race accepted for Batch 2

The route calculates the deadline with the same `attemptDeadline()` and `examPhase()` helpers as the state builder and returns `409 exam_closed` before `generate_paper` when the deadline has passed. The database function does not repeat that deadline check, so a request that crosses the deadline in the milliseconds between the route check and the RPC can still create the paper. The resulting screen has a timer already clamped to zero and grants no extra answering time; the later deadline auto-submit in plan 2F.5 closes the attempt. This accepted race must be revisited during the Phase 6 review.

## Batch 3: autosave, navigation and submit

| Task | Local status | Note |
|---|---|---|
| 2E.1 IndexedDB | Complete | Per-attempt rows load independently of paper delivery; late and sequential questions use the revision merge, including under StrictMode, and inputs stay gated until ready |
| 2E.2–2E.3 Autosave/retry | Complete | 1 s debounce, 10 s periodic save, latest-wins coalescing, revision-aware reconnect merge, transient backoff and failed-draft retention |
| 2E.4 Answers API | Complete | 96 KiB request cap; the 20,000-character Zod rule accepts maximum-length UTF-8 Sinhala text |
| 2F.1–2F.2 Submit | Complete | Manual/auto hints, server-derived reason, up to 200 pending answers at concurrency 8, exact dialog copy, deadline lock and 15 s client retry window |
| 2F.3 Done | Complete | Reason-specific confirmation, no scores, local-draft cleanup, media/fullscreen cleanup and one logout call |
| 2F.4 Reconnect | Complete locally | Same attempt/paper plus server-vs-device revision merge; server wins when another device is ahead |
| 2F.5 Worker scheduler | **Deferred** | Requires its own Gate 1. A closed tab is not server-side auto-submitted until this task exists |
| 2F.6 Sequential Next | Complete | No-grace route check, five database calls on advancement, direct last-answer save, no `submit_now`, and 1/2/4/8/10 s transient retry backoff |

The temporary exam-state mechanism is one replaceable 10-second poll. It continues while locked, backs off silently offline, stops when `/done` unmounts `/exam`, and is supplemented by an immediate refresh after successful Next. It costs two database round trips per poll, including authentication: at 23 candidates that is about **138 database calls per minute** (23 × 6 polls × 2 calls), excluding Next and save traffic. Task 3B.4 replaces this hook with heartbeat without adding a second poll.

### Reconciled specification differences

- Plan 2D.4's former green/yellow/orange wording is superseded by Section 2A's words-and-icons rule. Batch 2 used a truthful placeholder; Batch 3 now supplies the real six-state indicator.
- Section 2B's full exam flow assumes the 2E/2F endpoints. The approved Batch 2 boundary keeps answer/navigation state in memory and disables actions that require those endpoints.
- Section 3's free-mode rule wins over its JSON example: `PaperBody.current_position` is `null` in free mode and is ignored by the free UI.
- Sequential mode receives only its current question, so later questions are not exposed merely to simulate local Next.
- The optional image dimensions are omitted because the schema does not store them. The UI reserves an image region and retains aspect ratio after load.
- Candidate image responses use `Cache-Control: private, max-age=300, no-transform`; all JSON candidate responses remain `no-store`.
- The answer limit follows the specific Section 2B/API rule: warning from 19,000 characters and a hard stop at 20,000.
- Paper loading classifies draft/scheduled as `exam_not_live`, but ended/finalized/force-ended and expired attempts as `exam_closed`. This prevents the closed in-progress route guard from bouncing `/exam` to `/waiting` and back.
- Transient paper failures still retry every five seconds. After six consecutive failures both waiting and exam loading show "This is taking longer than expected. Tell the exam team if this continues." while quiet retries continue; a successful load resets the counter.
- Camera, fullscreen, heartbeat, proctoring/events, announcements and worker changes remain outside this batch. Autosave and the finished Done page are now implemented.

### Batch 3 accepted limitations and races

- `POST /api/exam/next` checks the deadline before `advance_position`, but the database RPC does not repeat it. A request crossing the boundary by milliseconds can advance once; the screen immediately locks from the timer or next state poll and no extra answering time is granted. Revisit with the paper-route race during Phase 6.
- Without task 2F.5, a candidate who closes the page cannot be auto-submitted by the server. The Phase 2 done-when line's server-side auto-submit outcome therefore remains unmet until the worker gate.
- A force-end is observed through state refresh. The client submits immediately on observation, so polling delay consumes part of the 15-second collection window; the future worker remains the authoritative closer for disconnected candidates.

### Batch 3 manual checklist

1. Type Sinhala and English answers, wait for `Saved HH:mm`, reload, and verify the same answers and flags return.
2. Go offline while typing. Verify durable storage copy, reconnect, and confirm the newest edit saves. Repeat with IndexedDB disabled and verify the keep-window-open copy.
3. Open the same attempt in a second browser, save a newer revision there, then reconnect the first browser. Verify the newer server answer wins.
4. In sequential mode, save text, clear it, choose Next, confirm the blank warning, and verify the server answer is blank before the next question appears. Double-click Next and verify only one advance.
5. In free mode, review unanswered/flagged questions and verify the exact Submit dialog. Simulate one failed answer save and confirm submit still completes with that draft in `pending_answers`.
6. Let the timer reach zero. Verify all inputs lock, pending answers flush, submit uses the `auto` hint, and success reaches Done. Test `collection_closed` both with and without a pending device draft and verify the matching terminal notice.
7. Force-end while typing. Verify **The exam has ended**, immediate final submission, and the Done page's forced reason after the server derives it.
8. Grant extra minutes after a local lock and verify the next state poll unlocks the screen and the timer uses the new deadline.
9. Verify question images stay within about 60% of viewport height and the Waiting Room manual Retry appears after eight seconds in the unexpected-phase branch.
10. Throttle the network and verify the 10-second state poll backs off without an additional banner, while autosave alone communicates connection state.

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
