# Phase 5 live test steps

These steps separate local automated coverage from behavior that needs the development Supabase project, LiveKit, real Chrome, or a real device. The agent did not run migration 008, deploy, configure UptimeRobot, or perform these live checks.

## Before testing

1. Review and run `supabase/migrations/008_admin_controls.sql` in the Supabase SQL editor, then run `Test/SECTIONS/001_smoke_test.sql` yourself.
2. Start the web app, worker, and the already-verified local LiveKit stack. Sign in as the manually created super admin.
3. Prepare one scheduled exam with questions and assigned synthetic candidates. Keep raw IDs out of screenshots and logs.

## Part A — 5A admin controls

1. Press **Start now**. Confirm status becomes Live, `started_at` and `ends_at` use the database clock, candidates move from Waiting by polling/Broadcast, and one `start` audit exists.
2. Retry the same Start request body. Confirm `already_started: true`, unchanged timestamps, and no second audit or Broadcast.
3. Extend the whole exam, then one candidate. Confirm timers update and the candidate-specific deadline includes `extra_minutes`.
4. Simulate a 503 after an Extend or announcement commit. Confirm the UI reloads current state before allowing a retry; these actions are not idempotent.
5. Send all-candidate and selected-candidate announcements. Confirm exact recipients see one top-right toast for 5 seconds and history is newest-first. Send two announcements quickly and confirm they appear one after the other with a one-second empty gap. Refresh during a toast and confirm it does not return. Confirm a candidate omitted from a custom audience sees nothing.
6. Force-submit one candidate using the confirmation dialog. Confirm partial saved answers remain and the candidate reaches Done.
7. Kick one candidate. Confirm active sessions are revoked before LiveKit removal, the browser reaches the signed-out screen within the heartbeat interval, media stops once, saved answers remain, and signing in again resumes.
8. Force-end a live exam. Confirm the screen locks immediately, the 15-second collection window remains, and the worker submits remaining attempts as `forced` without synthetic answers. Wait for the worker to finalize the exam, retry force-end, and confirm 200 `already_ended: true` with no duplicate audit or Broadcast. To simulate a missing audit in your own SQL editor, delete the `force_end` `admin_actions` row for that exam, retry, and confirm exactly one new row appears.

## Part B — 5B pre-exam check

1. **device-verify — Laptop Chrome:** run Check in Chrome Guest. Confirm browser passes, camera/mic prompts occur before fullscreen, the preview is live/mirrored, mic must be live and unmuted, fullscreen persists through Waiting and Exam, and only one LiveKit token/socket exists.
2. **device-verify — Non-Chrome:** open Check in another browser. Confirm the Chrome step blocks Continue with the specified message.
3. **device-verify — Android Chrome:** with Desktop site off, complete Check. Turn Desktop site on and retry; confirm step 5 blocks and explains how to turn it off.
4. **device-verify — Second monitor:** connect a second screen on a laptop. Confirm the warning appears in words but Continue remains available.
5. **device-verify — Wake lock:** enter fullscreen, open/close the notification shade, return visible, and confirm the wake lock is requested again. Confirm a transient route redirect does not release it and terminal sign-out/Done does.
6. Exit fullscreen just before pressing Continue. Confirm navigation is refused. Then restore fullscreen and continue.
7. Reload on Waiting and Exam. Confirm the existing fullscreen overlay stays on that page; Exam records exactly one valid `RELOAD` and does not return to Check.

## Part C — 5C health and alerts

1. Open Health as super admin. Confirm Supabase/LiveKit/Worker say OK, latencies and room count appear, Gemini rows come from `api_key_state`, and Last checked updates every 15 seconds.
2. Open `/admin/health` as a regular admin. Confirm the fixed no-access screen and no Health navigation item or alert chip.
3. Stop the worker. Within 90 seconds confirm Worker says **Not responding** and both detailed and public health endpoints return non-200. Restart and confirm recovery.
4. Stop LiveKit. Confirm detailed health returns non-200 and says **Not responding**; restart and confirm recovery. Public health remains governed by Supabase/worker only.
5. Insert a synthetic alert in your own Supabase SQL editor. Confirm the authenticated Realtime chip appears without reload and shows critical count when appropriate. Resolve it; confirm toast, table removal, chip decrement, and one `alert_resolve` audit.
6. Retry the resolve request. Confirm 200 `already_resolved: true` and no second audit row.
7. Configure UptimeRobot only during deployment to monitor public `/api/health`; confirm a worker-stale 503 creates the expected external incident and recovery. This step is not locally verified.
