## Live results, 7 October 2026

Real Chrome, local stack (Docker LiveKit v1.13.7, local web app, Supabase). Items marked "reported" were run by hand and reported as passing; the DevTools and admin-timeline evidence was seen for the items marked "seen".

### C3/C4: one token, one room across Check → Waiting → Exam: PASS

- Cause of the earlier duplicate: the route guard's transient redirect rendered "Loading…" in `CandidateProvider`, which unmounted `CandidateLiveKitProvider` inside it. The unmount ran `stop()`, and `/waiting` then silently reacquired (second `POST /api/livekit/token`, second WebSocket).
- Fix: commit `332344f` (`fix(web): preserve candidate LiveKit session across redirects`). `CandidateLiveKitProvider` now wraps `CandidateProvider`; only the exposed context `stop()` marks the session terminal and suppresses silent reacquire; redirects and loading frames never stop media.
- Seen: one `localhost:7880` WebSocket held open on the Exam screen (previously two). Teardown (sign out: camera light off, socket closed, no reconnect): reported.

### Phase 3 Part C/D/E with real media: PASS (reported)

- Preview visible with non-zero size on Waiting and Exam; reload recovers camera and microphone without a new permission prompt; Done stops media once with no reconnect.
- Real 320x240 snapshots for eligible incidents; black frame skipped; no snapshot for camera, microphone, LiveKit, reload, clipboard or context-menu events.
- Admin: real audio playback per selected candidate (switching silences the previous one, Audio Off silences all); filters, stable MER order, panel Escape and focus return, dismiss/restore, one threshold toast; Realtime interruption shows "Live updates paused. Reconnecting…", 10 s polling continues, banner clears on recovery.

### False RELOAD on exam entry: FIXED

- Cause: `useProctoring` recorded a counted `RELOAD` whenever `enabled && inProgress`. Waiting joins the attempt (`loadPaper`) and refreshes state before navigating, so first entry and a real reload both look `in_progress` on first render.
- Fix: an in-memory, non-consuming handoff marker in `CandidateProvider`, cleared in `resetCandidateSession` and wiped by any full page load. It is set by `WaitingRoom` (after `loadPaper` and `refreshState`, before `/exam`) and by `CheckScreen` Continue. `ExamScreen` captures `resumed` once per mount (state `in_progress` and no marker); `useProctoring` records `RELOAD` once per mount only when `resumed`.
- Commits: the handoff-marker commit, then `a853ec1` (`fix(web): exclude check handoffs from reload incidents`), which closed the kicked-candidate re-login path (spec test 8.59).
- Effective rule: `RELOAD` is recorded only on a full page load directly onto `/exam` for an attempt already in progress. Waiting → Exam, Check → Exam, a late join, and a re-login after a kick are not reloads.
- Manual retest (reported): Waiting → Exam, 0 `RELOAD` (seen: admin timeline had no `RELOAD`); F5 in exam, exactly one `RELOAD`; late join, none; kick then re-login via Check, none.
- Unchanged by design: a candidate who is not fullscreen when the exam starts opens a counted `FULLSCREEN_EXIT` once they restore fullscreen (Section 4, exam-start rule). A candidate already fullscreen from the waiting room starts with 0.

### Local test prerequisites learned

- The worker is a separate process. Scheduled exams are started only by the worker's 10 s scheduler (`status = 'scheduled'` and `scheduled_start_at` due). Auto-submit and `DISCONNECTED` events also need it. Locally: `npm start` in `worker/` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set in the shell (the worker does not read `.env` files). In production systemd runs it.
- `select * from public.start_exam('<EXAM_ID>', false);` in the SQL editor starts an exam by hand.
- Resetting an exam for a re-run: attempts, events, papers and answers are not reset by changing the `exams` row alone.
- Starting the exam while the candidate tab is in the background produces a real tab-away incident on entry, which contaminates a "0 violations" check.

### Still unchecked in this record

Not covered by the results above: the two-minute LiveKit outage recovery test, webcam unplug/replug with republish, Android/tablet, mobile data and restrictive networks, TURN/ICE/TCP, TLS and EC2, and the optional 23-publisher capacity rehearsal. Section 4 table row for `RELOAD` still reads "reload or back/forward, or any load when this tab already has the exam-page marker" and should be reworded to match the rule above.
