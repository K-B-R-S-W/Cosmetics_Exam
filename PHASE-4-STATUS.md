# Phase 4 Status

Date: 6 October 2026

## Current status

Phase 4's local application build is complete through 4A.1/4A.3, 4B.1–4B.4 and 4C.1–4C.5. The candidate publishes camera and microphone through a route-group provider, the admin Live page selectively subscribes to media, and the Phase 3 proctoring UI is mounted. Tasks 4D.1–4D.8 remain deployment and rehearsal work. Nothing from Phase 4 has been deployed or pushed by the implementation agent.

No database migration was needed. Existing Phase 3 event, heartbeat, snapshot and Realtime contracts remain authoritative.

## Live-verified boundary

One narrow local sanity test is live-verified:

- `livekit-client` 2.22.3 connected to `livekit-server` v1.13.7 in Docker Desktop.
- A token produced by the application route with candidate grants published camera and microphone over UDP 7882.
- A hidden subscriber with admin grants received both video and audio.
- The local single-port UDP configuration and `node_ip: 127.0.0.1` worked.

That test proves the pinned client/server pairing and local transport/configuration only. It did **not** verify the complete candidate provider, route continuity, banners, device recovery, admin speaker click/autoplay, admin grid reconnect, snapshots from real frames, EC2, Caddy/TLS, TURN, mobile data or 23-publisher capacity. Those remain unchecked until `PHASE-4-TEST-STEPS.md` is run in real Chrome.

## Implemented candidate media behaviour

- `POST /api/livekit/token` uses explicit candidate/admin modes. Candidate identity is `c_{attempt_id}` and admin identity is `a_{admin_id}`; secrets remain server-only.
- The candidate provider owns one room and one app-owned `MediaStream` across Check → Waiting → Exam. Done performs cleanup once and does not reconnect.
- The same mirrored `CameraPreview` stays mounted, playing, visible and non-zero-size on Waiting and Exam so Phase 3 snapshots have a real video element.
- One 320x240 camera layer is published without simulcast. Android requests at most 15 fps; other Chrome clients request 30 fps.
- LiveKit terminal disconnects do not stop local tracks. They open non-counting `CAMERA_LOST`/`MIC_LOST` episodes with source `livekit`, show the reconnecting banner, and republish the same live tracks after reconnect.
- Ended device tracks open counted source `track` episodes. With camera/microphone permission still granted, recovery retries on `devicechange` and every three seconds without prompting, then replaces the ended track everywhere and closes the episode. If permission is not granted or the Permissions API is unavailable, the banner remains and no silent prompt is attempted.
- Media/provider failure never blocks the candidate screens.

## Implemented admin live behaviour

- The live grid remains in MER order and derives Not joined, Ready, In exam, Offline, Submitted and Camera off using server-clock offset plus LiveKit track state.
- The admin room starts with `autoSubscribe: false`, subscribes to all camera publications and only one selected microphone. Speaker clicks call `room.startAudio()`, attach the remote audio track, detach the previous speaker, and show a blocked-audio state if Chrome refuses playback.
- Failed initial connects and terminal disconnects retry at 2, 4, 8 and then 10-second intervals. The grid recovers without reload.
- Camera off is suppressed while the admin room is disconnected. Missing-video timers are cleared and restart only after reconnection, so no tile can flash Camera off during the first 10 seconds after recovery.
- The selected candidate panel is a complementary region, not a modal dialog. Its event timeline reloads after relevant Realtime changes. Escape closes it only when no nested dialog is open.
- The Phase 3 badge, timeline, event detail, dismiss/restore and threshold controls are mounted. The live grid stays in MER order when counts change.

## Additions to Section 3

Phase 4 added three authenticated admin read routes:

- `GET /api/admin/live?exam=<uuid>&view=full|progress`
- `GET /api/admin/live/[attemptId]/events`
- `GET /api/admin/events/[id]`

Their exact response shapes, authorization rules and call profiles are recorded in Section 3 §5.1. They return no NIC or candidate-answer content.

## Database-call profile

- Full live-grid request: cached admin Auth `getUser`, one `admin_profiles` lookup, exams, attempts joined to candidates, and `attempt_progress` = **5 database calls**. The attempts and progress calls run in parallel.
- Ten-second progress poll: cached admin auth plus `attempt_progress` = **3 database calls per request**, **18 calls/minute** while the page is open.
- Selected event timeline: cached admin auth plus `violation_events` = **3 database calls**, plus one batched Storage signing request when snapshots exist.
- One event snapshot detail: cached admin auth plus one event lookup = **3 database calls**, plus one optional Storage signing request.
- Quiet Realtime adds zero route calls. An isolated attempt/event refresh costs 5 database calls; when the selected panel also reloads, it costs 8 plus optional Storage signing. With the two-second trailing/max-wait debounce, the theoretical continuous ceiling is 150 calls/minute without a panel and 240 with one. At the expected 23-candidate scale, an attempts-only refresh is a sensible later optimization but not required for correctness.

## Configuration

- Exact web dependencies: `livekit-client@2.22.3` and `livekit-server-sdk@2.19.1`.
- Local server: `livekit/livekit-server:v1.13.7`, TCP 7880/7881 and UDP 7882, with an ignored `livekit.local.yaml` copied from its example.
- Local app URL: `ws://localhost:7880`. Production remains `wss://cosmetics.duckdns.org` after the EC2/Caddy deployment is tested.
- Local key and secret must match the ignored YAML and `.env.local`. Real values must never enter Git.

## Mocked versus live limits

Unit tests cover grants, provider lifetime, track ownership, terminal reconnect, silent device reacquisition, retry cancellation, media-source escalation into Phase 3, admin selective subscription/audio attachment, clock offset, camera-off suppression, route contracts, error states and accessibility. SDK/browser doubles cannot prove actual Chrome autoplay, physical unplug/replug, permission persistence, playable frames, WebRTC route selection, network recovery, bandwidth or server capacity.

Use the root runbooks rather than duplicating Phase 3 procedures:

- `PHASE-3-LIVE-TEST-STEPS.md`: Parts A–E, including Part A steps 1–9 and Part B L1–L6.
- `PHASE-3-FINISH-RUNBOOK.md`: Parts A–E and its Phase 4 hand-off list.

## Remaining before Phase 4 is live-verified

- Run every real-Chrome check in `PHASE-4-TEST-STEPS.md`, including audio after the speaker click, a two-minute LiveKit outage/recovery, webcam unplug/replug and republish after terminal disconnect.
- Repeat Phase 3 Part C with actual camera/microphone media and verify eligible snapshots, black-frame skipping and the mounted admin timeline.
- Run Android/tablet, mobile-data, restrictive-network, TURN/ICE/TCP, TLS and EC2 checks.
- Run the optional 23-publisher capacity rehearsal on the final host; a Docker Desktop result is not EC2 capacity evidence.

Phase 4 is therefore **locally implemented, with only the narrow pairing/transport sanity test live-verified**.
