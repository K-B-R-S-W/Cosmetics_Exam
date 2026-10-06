# Phase 4 local verification steps

Date: 6 October 2026

Run these checks in Chrome. They deliberately separate the already verified SDK/server sanity test from the application and device behaviour that mocks cannot prove. Do not use real candidate identity numbers or production secrets.

## Run order

1. Prepare and start the local LiveKit server.
2. Complete the Phase 3 guard/lock prerequisites by reference.
3. Create the local test exam and open candidate/admin sessions.
4. Verify candidate publishing and snapshots.
5. Verify the admin grid and one-speaker audio.
6. Verify LiveKit outage/recovery, terminal republish and device recovery.
7. Run the two-candidate check and optional local load observation.
8. Record deferred EC2/mobile-network work separately.

## Part A. Start local LiveKit

From the repository root in PowerShell:

```powershell
Copy-Item -LiteralPath infra/livekit/livekit.local.yaml.example -Destination infra/livekit/livekit.local.yaml
```

1. Replace the example secret in the ignored `livekit.local.yaml` with a random value of at least 32 characters.
2. Put the same key and secret in `apps/web/.env.local`:

```text
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=<same local secret>
NEXT_PUBLIC_LIVEKIT_URL=ws://localhost:7880
```

3. Start and inspect the pinned server:

```powershell
docker compose -f infra/livekit/docker-compose.local.yml up -d
docker compose -f infra/livekit/docker-compose.local.yml ps
docker compose -f infra/livekit/docker-compose.local.yml logs --tail 100 livekit
```

4. Start the web app after changing `.env.local` so the server and browser bundles both receive the local URL.
5. Confirm no key, secret, token or `.env.local` value appears in Git status or logs.

Expected: LiveKit Server v1.13.7 listens on TCP 7880/7881 and UDP 7882. The previously completed sanity test verified that `livekit-client` 2.22.3 can publish camera/microphone and a hidden admin-grant subscriber can receive both through this local configuration. Do not treat the remaining parts below as verified until you run them.

### Report Part A

```text
Part A: compose up pass/fail; server version; ports; unexpected log lines
```

## Part B. Phase 3 prerequisites by reference

Do not copy or improvise the SQL/worker procedures here.

1. Run `PHASE-3-LIVE-TEST-STEPS.md` Part A steps 1–9 and Part B L1–L6 if they are not already recorded as passed on this project.
2. Use `PHASE-3-FINISH-RUNBOOK.md` Part C C0–C8 and Part D D0–D3 as the authoritative Phase 3 browser/device checklist. In this Phase 4 pass, repeat Part C with real camera/microphone media instead of the earlier API-only snapshot substitute.
3. Keep the two runbooks' own cleanup and result formats.

### Report Part B

```text
Phase 3 runbook: file + part/step; pass/fail; date; unresolved note
```

## Part C. Prepare the local exam and sessions

1. Use synthetic candidates only. Prepare a live exam with questions and at least two acknowledged candidates.
2. Open each candidate in a separate Chrome Guest/profile window. Open the admin in a different Chrome profile so cookies cannot cross.
3. In Chrome site settings, allow camera and microphone. Select the intended devices.
4. Candidate 1: go through Check → Waiting → Exam using client-side navigation.
5. Keep DevTools Network open and filter for `livekit`, `token`, `events`, `heartbeat` and `state`.

Expected:

- The camera/microphone permission prompt occurs during Check, not later during Waiting or Exam.
- One LiveKit token request/connection is reused across Check → Waiting → Exam; route changes do not create a second room.
- The mirrored camera preview remains playing and visibly non-zero-size on Waiting and Exam. It is never `display:none`.
- Reload recovery uses the browser's granted camera/microphone permission silently. If the Permissions API is unavailable or does not report granted, the page shows the banner and does not trigger a surprise permission prompt.
- Navigating to Done stops and releases media once and does not reconnect.

### Report Part C

```text
Part C: prompt timing; token/connect count; preview Waiting/Exam; reload result; Done cleanup
```

## Part D. Real media, proctoring and snapshots

With Candidate 1 in progress:

1. Repeat `PHASE-3-FINISH-RUNBOOK.md` Part C C1–C8 with the real preview attached.
2. Trigger each snapshot-eligible event: tab/focus loss, fullscreen exit, split view or browser side panel, viewport change and multi-screen when hardware permits.
3. Confirm one alt-tab produces one merged incident, not three.
4. In the candidate panel, confirm eligible events have real 320x240 snapshots when the camera frame is usable.
5. Cover the camera fully and trigger an eligible event. Confirm the event remains but the black frame is skipped.
6. Confirm camera/microphone loss, LiveKit loss, disconnect/reconnect, multi-login, clipboard/context menu and reload events do not claim snapshots.

Expected: the event timeline updates, the tile count/colour follows the server count, MER ordering does not change, and no proctoring failure blocks answering.

### Report Part D

```text
Part D: event types seen; snapshot-eligible results; split/side-panel result; alt-tab count; black-frame result
```

## Part E. Admin grid and audio

1. Open `/admin/live`, choose the live exam and keep the candidate visible on camera.
2. Confirm the tile shows the right MER/name, status, violation count and progress. The server-clock-offset behaviour is unit-test covered but is **not live-verifiable on a one-PC setup**, because the Next server and admin browser use the same machine clock. If a second machine is available, turn off its automatic time synchronization, skew its clock by about one minute, use it only as the admin browser, and confirm Offline and time-left still follow the route's `server_time` rather than that browser's clock. Restore automatic time synchronization immediately after this check.
3. Click Candidate 1's speaker control. This click must invoke Chrome audio start and attach the remote microphone track.
4. Speak near Candidate 1's microphone and confirm the admin hears it.
5. Switch the speaker to Candidate 2. Confirm Candidate 1 becomes silent and only Candidate 2 can be heard.
6. Turn the speaker off and confirm all candidate audio is detached.
7. If Chrome blocks playback, confirm the visible blocked-audio message appears; after a new user click, confirm audio can start.
8. Exercise every filter and compare the displayed count with the matching tiles. Confirm changing filters never changes MER order.
9. Open a candidate panel. Confirm it is a complementary region, its event timeline refreshes after a new incident, and Escape closes it only when no nested dialog is open. Confirm keyboard focus returns to the tile that opened it.
10. Dismiss and restore a counted incident with a review note. Confirm the timeline and tile count update once.
11. Change the threshold, then create enough counted events to cross it. Confirm one red threshold toast appears, the tile says Flagged, and the grid does not reorder.
12. Interrupt the admin Realtime connection. Confirm “Live updates paused. Reconnecting…” appears and clears after recovery while the ten-second progress poll continues.

### Report Part E

```text
Part E: tile/progress/status; server-clock skew; speaker 1; switch to speaker 2; speaker off; blocked-audio state; filters/MER order; panel/focus; dismiss/restore; threshold/toast; Realtime pause
```

## Part F. Failure and recovery in real Chrome

### F1. LiveKit outage for about two minutes

With Candidate 1 in progress and the admin grid connected:

```powershell
docker compose -f infra/livekit/docker-compose.local.yml stop livekit
```

Wait about two minutes, then restart it:

```powershell
docker compose -f infra/livekit/docker-compose.local.yml start livekit
docker compose -f infra/livekit/docker-compose.local.yml logs --tail 100 livekit
```

While stopped and after restart, confirm all of these:

- The candidate's local preview stays mounted and live; its device tracks do not end.
- The candidate sees: “Your exam continues. We're reconnecting your video to the exam team. You don't need to do anything.”
- The exam, answers, timer and heartbeat continue.
- The incident closes after recovery as source `livekit` and does **not** increase the violation count. There is no counted device-source `CAMERA_LOST` caused by the server outage.
- The admin shows its connection warning and recovers video without reloading the page.
- Tiles do not show Camera off while the admin connection is down, and there is no Camera off flash during the first 10 seconds after reconnect.

### F2. Republish after terminal disconnect

1. Keep DevTools and the admin tile visible.
2. Cause a terminal candidate room disconnect without ending the browser's camera/microphone tracks (the two-minute server stop above may exercise this; otherwise use Chrome's network controls and wait for terminal disconnect).
3. Record the device track ids/readyState before and after.
4. Confirm the app-level retry obtains a new token/room connection and republishes the **same live tracks**; the admin tile returns without candidate reload.
5. Confirm the episode source is `livekit`, it does not count, and no device-source camera/microphone loss is added.

### F3. Webcam unplug/replug

1. With permission granted and Candidate 1 in progress, physically unplug the webcam.
2. Wait beyond the five-second media grace. Confirm the camera warning and one counted `CAMERA_LOST` with source `track`.
3. Reconnect the webcam without clicking a new permission prompt.
4. Allow the `devicechange` path or three-second retry loop to reacquire it.
5. Confirm the preview changes to the replacement live track, the track is republished, the admin video returns, the banner clears and the episode closes.
6. Repeat for microphone mute/unmute or unplug/replug where the device/OS supports it.
7. Revoke permission and repeat. Confirm recovery stays lost and does not prompt silently; restore permission through Chrome site settings, then retry.

### Report Part F

```text
F1: preview/banner/count/admin recovery/Camera-off flash
F2: old/new track ids + readyState/republish/count
F3: unplug event/retry count/replug recovery/permission-revoked behaviour
```

## Part G. Two candidates and optional local observation

1. Keep two candidates publishing and the admin grid open for at least 15 minutes.
2. Switch audio between them several times. Confirm exactly one audio track is attached.
3. Trigger events on each candidate and confirm panels, snapshots, threshold colours and MER order remain candidate-specific.
4. Confirm the 10-second progress poll continues and no repeated token/connect storm appears.
5. Optional: add simulated publishers only to observe the development PC. Record CPU, memory, receive bandwidth and tile smoothness. Do not treat this as final-host capacity evidence and do not run an unapproved burst script.

### Report Part G

```text
Part G: duration; candidates; audio switching; event isolation; poll/connect behaviour; optional local resource notes
```

## Part H. Deferred production checks

Do not mark Phase 4 fully live-verified until the later deployment/rehearsal covers this table:

| Deferred item | Why it is deferred | Later evidence required |
|---|---|---|
| Android tablet, notification shade and split view | Plain HTTP camera access is limited to localhost; the tablet needs HTTPS | Run `PHASE-3-LIVE-TEST-STEPS.md` Part D on the target tablet |
| Two-laptop `MULTI_LOGIN` | This local pass uses one PC and Chrome profiles | Repeat across two physical devices and inspect the event timeline |
| Mobile-data candidate | The local LiveKit server is not publicly reachable | Publish from mobile data to the deployed admin grid |
| Second-monitor `MULTI_SCREEN` | Requires a second display and browser support | Connect a second display and verify one counted episode with an eligible snapshot |
| EC2/Caddy/Redis and public DNS | Deployment is outside this local build | Run the Section 6 install/check commands on the approved host |
| WSS/TLS, restrictive network, UDP, ICE/TCP and TURN | Docker localhost does not exercise the public network path | Record selected ICE paths on normal Wi-Fi, mobile data and a restrictive network |
| Final 23-publisher capacity | Development-PC numbers do not predict the final host | Run the approved load test on the final host and record CPU, memory and bandwidth |
| Restart/reboot recovery | No deployment was authorized | Complete the Phase 8 reboot/recovery rehearsal |

### Final result format

```text
Phase 4 local date/browser/device:
Part A:
Phase 3 prerequisite references:
Part C:
Part D:
Part E:
F1:
F2:
F3:
Part G:
Deferred Part H items:
Blocking issue, if any:
```
