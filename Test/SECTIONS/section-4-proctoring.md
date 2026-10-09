# Section 4 - Proctoring Spec

> Status: migration 007 and its full smoke block are verified on the development Supabase project. Phase 3 application and worker code and the Phase 4 media integration are locally implemented; anything marked *(test)* still depends on browser/device rehearsal (Phase 8). Appendix A is retained only as superseded design history and must not be run.

### Phase 4 media integration

- The candidate route-group provider owns one camera/microphone stream and one LiveKit room across Check → Waiting → Exam. Done stops the media exactly once before logout. A provider failure never blocks the candidate screens.
- The route-group also owns the requested screen wake lock outside `CandidateProvider`, so loading and redirect frames do not release it. Check is the only page that prompts; session termination releases the lock, while visibility recovery silently re-requests a previously wanted lock.
- The camera preview remains mounted, playing, visible and non-zero-size on Waiting and Exam because snapshot capture reads that same video element. It is mirrored and has an accessible name.
- Candidate publishing uses one 320x240 camera layer with no simulcast. Android is capped at 15 fps; other Chrome clients request 30 fps.
- `stopLocalTrackOnUnpublish` is false. A terminal LiveKit disconnect keeps the app-owned device tracks live, records non-counting `CAMERA_LOST`/`MIC_LOST` episodes with `meta.source = 'livekit'`, and republishes those same tracks after the app-level reconnect.
- A device track that ends or stays muted past the grace period records a counted episode with `meta.source = 'track'`. Silent reacquisition is attempted on `devicechange` and every three seconds only when `navigator.permissions.query` reports `granted`; otherwise the warning remains and the browser is not prompted. Successful replacement rebinds the preview, snapshot source, listeners and LiveKit publication, then closes the episode.
- The admin connection auto-subscribes to no tracks, subscribes to every camera publication, and subscribes/attaches audio for at most one selected candidate. The speaker click calls `room.startAudio()`; autoplay failure is shown as a blocked-audio state. Failed initial connections and terminal disconnects retry with bounded backoff and do not require a page reload.
- While the admin LiveKit connection is down, the grid does not derive Camera off. On reconnection every missing-video timer restarts, giving each tile the full 10-second window before Camera off can appear.

These behaviours have mocked browser/SDK coverage. Real Chrome still must verify autoplay, Permissions API/device behaviour, actual video-element frames and snapshots, UDP/TCP recovery, and camera unplug/replug using `PHASE-4-TEST-STEPS.md`.

---

## 0. Decisions and what this section changes

| # | Decision | Where it came from |
|---|---|---|
| 1 | **One absence counts once.** A tab switch during a disconnect is one violation, not two. | You, this chat |
| 2 | **Default flag threshold = 10** (raised from 5 so a reload, which logs two counted events, does not flag a candidate on its own), and admins can set any whole number from 1 to 100 per exam, including while the exam is live. | You, this chat |
| 3 | Snapshot retention is 14 days. Waiting-room incidents do not count. | Earlier rounds (already in the plan) |

**Approved defaults.** Each client-side value lives in `lib/proctoring-rules.ts`, so rehearsal tuning remains localized:

| Choice | Default | Why |
|---|---|---|
| `COPY`, `PASTE`, `CONTEXT_MENU` | Logged, **do not count** | They are blocked anyway, and a long-press on a tablet fires a context menu by accident. |
| `RELOAD` | Counts | A reload is a deliberate or risky action. An accidental one is absorbed by the threshold, and an admin can dismiss it (section 7.4). |
| `CAMERA_LOST` / `MIC_LOST` | Count only when the **device** track ended or muted; **do not count** when only the LiveKit connection dropped | Plan 4B.4 says a LiveKit or EC2 failure is not the candidate's fault. |
| Admin can **dismiss** a wrongly counted incident | Yes (new route, section 7.4) | The database trigger already supports -1, so false positives can be fixed without touching data by hand. |

**What this section changes in other files** is listed in section 10. The two largest changes are:

1. The overlap rule between `DISCONNECTED` and tab-switch incidents is rewritten (section 5). The old rule only looked at the first 10 seconds of a gap.
2. `POST /api/events` becomes **idempotent** (section 3.6). Without that, the retry queue can double-count an incident, which is unfair to the candidate.

---

## 1. Principles

1. **The browser can only produce evidence.** It cannot see a second phone, a second laptop, a virtual machine, or a screenshot. The logs are for a human to review, and an admin should watch the live grid.
2. **Proctoring never blocks the exam**, except the fullscreen overlay. A camera, LiveKit, snapshot or logging failure is recorded and the exam carries on.
3. **The client reports facts; the server decides what counts.** The client never sends a `counts` flag.
4. **One absence is one incident.** Several browser signals from the same cause are merged (section 3.2), and a disconnect that overlaps one is not counted again (section 5).
5. **Every threshold lives in one place** (section 8), so rehearsal tuning (task 8.11) does not mean hunting through hooks.

---

## 2. Event catalogue

Event types are exactly those in `001_initial.sql` (the `violation_events.type` check). No new types are needed.

| Event | Detected by | Written by | Counts? | `duration_ms` means | Snapshot |
|---|---|---|---|---|---|
| `TAB_HIDDEN` | `visibilitychange` to `hidden` | client | Yes | hidden until visible again | Yes |
| `FOCUS_LOST` | `window blur`, confirmed by a 1 s `document.hasFocus()` poll | client | Yes | blur until focus again | Yes |
| `FULLSCREEN_EXIT` | `fullscreenchange` (left fullscreen) | client | Yes | exit until fullscreen restored | Yes |
| `VIEWPORT_CHANGED` | 1 s check, **only while in fullscreen**: `innerWidth` below `screen.width x 0.98` on 2 checks in a row (width only on Android) | client | Yes | start until back to normal | Yes |
| `MULTI_SCREEN` | `screen.isExtended`, guarded with `'isExtended' in screen`; desktop only | client | Yes (once per episode) | start until gone | Yes |
| `CAMERA_LOST` | Camera track `ended` or `mute` for 5 s (`meta.source = 'track'`), or LiveKit connection lost (`meta.source = 'livekit'`) | client | `track`: yes. `livekit`: no | loss until restored | No (no camera) |
| `MIC_LOST` | Same as `CAMERA_LOST` for the microphone | client | Same | Same | No |
| `DISCONNECTED` | No heartbeat for 30 s | worker (`resolve_disconnects`) | Worker decides (3B.6, section 5) | `null` (the gap is on `RECONNECTED`) | No |
| `RECONNECTED` | First heartbeat after a gap over 30 s | heartbeat route | No | the gap length | No |
| `MULTI_LOGIN` | A second login revoked a live session | login route | Yes only while the attempt is `in_progress`; waiting-room login events do not count | `null` | No |
| `COPY` / `PASTE` / `CONTEXT_MENU` | Handlers (action blocked) | client | No | `null` | No |
| `RELOAD` | Exam page load that is a reload or back/forward, or any load when this tab already has the exam-page marker | client | Yes | `null` | No |

`RELOAD` is recorded only on a full page load directly onto `/exam` for an attempt that was already in progress; normal in-app entry through Check or the waiting room is not a reload.

Notes:
- `duration_ms` for an attention incident is the length of the **whole incident** (section 3.2), not of the first signal.
- The admin grid's **Offline** label (heartbeat older than 25 s) is a display state only. The logged `DISCONNECTED` event starts at 30 s.
- Every database writer of `DISCONNECTED` or `RECONNECTED` explicitly uses `clock_timestamp()` for `occurred_at`. Their latest-row and gap-end checks order or compare that column, while the table's `now()` default is fixed at transaction start and can misorder multiple writes in one transaction.

---

## 3. Incident lifecycle (client)

### 3.1 Three kinds of event

| Kind | Types | Behaviour |
|---|---|---|
| **Attention incident** | `TAB_HIDDEN`, `FOCUS_LOST`, `FULLSCREEN_EXIT`, `VIEWPORT_CHANGED` | One open incident at a time. Later signals join it. Sent when it ends. |
| **Episode** | `MULTI_SCREEN`, `CAMERA_LOST`, `MIC_LOST` | One open episode per type. Sent when it ends. |
| **Instant** | `COPY`, `PASTE`, `CONTEXT_MENU`, `RELOAD` | Sent immediately with `duration_ms = null`. The same type within 3 s is one event. |

### 3.2 Attention incident rules

1. **Open.** The first signal that passes its debounce (section 3.3) opens an incident. `type` is that signal. The incident start time is that signal's start.
2. **Join.** Any other attention signal that starts **while the incident is open** joins it: its type goes into `merged_types` (no duplicates, never the primary type). There is no 3-second limit. Alt-tab followed by a viewport change 10 seconds later is still one absence.
3. **Close.** The incident ends when **every** joined signal has cleared (page visible, window focused, fullscreen restored, viewport normal). `duration_ms` is end minus start.
4. **Never closed.** If the candidate never restores fullscreen, the incident stays open until the page closes or the exam is submitted (section 3.5).
5. **Timing source.** Use `performance.now()` for all start and end times, not the device clock. The clock can be wrong or changed, and the server already stores `now() - occurred_ago_ms`.

### 3.3 Debounce and drops

| Signal | Rule |
|---|---|
| `FOCUS_LOST` | Ignored if focus returns within `FOCUS_GRACE_MS` (1000 ms) |
| `TAB_HIDDEN` | No debounce, but the whole incident is dropped if it lasted less than `MIN_INCIDENT_MS` (1000 ms) and contains nothing else |
| `FULLSCREEN_EXIT` | **Never dropped.** The blocking overlay appears at once, so it is always logged. |
| `VIEWPORT_CHANGED` | Needs 2 consecutive 1 s checks (`VIEWPORT_CONFIRM_TICKS`) |
| `CAMERA_LOST` / `MIC_LOST` | Needs the track to be gone for `MEDIA_LOSS_GRACE_MS` (5000 ms), because browsers briefly mute tracks |

Android notification shade, Samsung edge panel, Google Assistant and Circle to Search can all cause short blur or hidden events (test 8.27). The 1 s grace removes most of them. What is left is handled by the admin dismiss action (section 7.4), not by more client rules. Tune the numbers in the tablet rehearsal *(test)*.

### 3.4 The exam start boundary

- Incidents in the waiting room do not count.
- **At the moment the exam starts** (the first state response with the attempt `in_progress`), the client closes any open attention incident and sends it, then, if the fault is still active (for example fullscreen is still off), **opens a new incident immediately**. The new one counts.
- The server also checks this itself as a backstop: an incident whose start time is before `attempts.joined_at` does not count, whatever the status is when it arrives (section 4.1).

### 3.5 Sending

1. **Client-generated id.** Every incident gets a `crypto.randomUUID()` when it opens. This id is sent as `id` and becomes the event's primary key (section 3.6).
2. **Queue.** Closed incidents go into an in-memory queue, mirrored to `sessionStorage` so a reload does not lose it. Maximum 50 entries; the oldest are dropped first.
3. **Retry.** On a network error, `5xx`, or `429`, retry with backoff (2 s, 5 s, 10 s, then every 30 s; honor a longer `retry_after_s`). A `400`, `401`, or `403` drops the entry because the unchanged request cannot succeed.
4. **`occurred_ago_ms`** is calculated at the moment of each send attempt, so a retried incident keeps the right start time.
5. **Submit.** Before calling the submit route, the page closes any open incident and awaits its send for at most 2 s. After submit, the events route answers `200 { "ignored": true }`, so a late send does no harm.
6. **Page closing.** On `pagehide`, any open incident is sent with `navigator.sendBeacon` (same origin, JSON blob, best-known duration). A beacon cannot be retried, and the id makes a later duplicate harmless. *(test: Android Chrome tab close and lock screen)*
7. **A frozen or killed tab** sends nothing. That case is covered by `DISCONNECTED` and the overlap rule in section 5.

### 3.6 Idempotent send (contract change)

The current contract has the server create the event id and the client retry blindly. If the first request succeeds but the response is lost, the retry inserts a second incident and the candidate's count goes up for one absence.

Change `POST /api/events`:
- The body has a required `id` (UUID, version 4 format). The server uses it as the primary key.
- The server first checks whether the id exists. If it does: `200 { "id": "...", "duplicate": true, "snapshot_saved": false }`, with no insert, no snapshot upload and no overlap reversal.
- A client cannot overwrite anything this way. A reused id from another attempt simply returns `duplicate`.
- The snapshot path keeps using the event id. A Storage "already exists" error on retry counts as success.

---

### 3.7 Candidate warning (new)

Decided: no automatic penalty. The system records, warns the candidate, and shows the log to the admins, who decide what to do in the office.

- **When:** an attention incident that contains `TAB_HIDDEN` or `FOCUS_LOST` (as the primary type or in `merged_types`) **closes**, while the attempt is `in_progress`. That is the moment the candidate is back on the page, so it is the first moment a message can be seen.
- **Not shown** for an incident dropped under section 3.3 (shorter than 1 s, or focus back within 1 s), because nothing was recorded. Not shown in the waiting room (nothing counts there). Not shown for `FULLSCREEN_EXIT` alone, because the blocking overlay already tells the candidate. Not shown for the other types.
- **What:** the client shows the candidate warning toast (Section 2A §4.14a, text in Section 2B §8.7), independent of whether the send to the server has succeeded yet. One toast per incident. A new one replaces one still showing.
- **Admin side:** nothing new. The incident is already sent through `POST /api/events` and appears in the admin's violation timeline for that candidate (7.2). The admin's tile badge updates through Realtime.
- **Tunable:** `WARNING_TOAST_MS` = 10000 (section 8).
- **Known cost:** the notification shade and edge panels can still produce a recorded incident after the 1 s grace (section 3.3). The candidate will see the toast for those, and the admin can dismiss the event (7.4). Tune the grace in the tablet rehearsal.

---

## 4. Counting (server)

### 4.1 Decision order in `POST /api/events`

`counts` is `true` only if all of these hold:

1. The type is a counting type: `TAB_HIDDEN`, `FOCUS_LOST`, `FULLSCREEN_EXIT`, `VIEWPORT_CHANGED`, `MULTI_SCREEN`, `CAMERA_LOST`, `MIC_LOST`, `RELOAD`.
2. For `CAMERA_LOST` and `MIC_LOST`, `meta.source` is `'track'`. Any other value gives `false`.
3. The attempt is `in_progress`.
4. The incident start (`now() - occurred_ago_ms`) is **not before** `attempts.joined_at`.

Everything else is `false`. `COUNTING_TYPES` lives in `lib/proctoring-rules.ts`, which the Next.js app and the worker both import.

**Client-sendable types:** the events route only accepts `TAB_HIDDEN`, `FOCUS_LOST`, `FULLSCREEN_EXIT`, `VIEWPORT_CHANGED`, `MULTI_SCREEN`, `CAMERA_LOST`, `MIC_LOST`, `COPY`, `PASTE`, `CONTEXT_MENU`, `RELOAD`. Everything else (including `DISCONNECTED`, `RECONNECTED`, `MULTI_LOGIN`) returns `400`. `merged_types` may only contain types from this list. Without this allowlist a client could send `RECONNECTED` and cut a real disconnect short in the timeline pairing.

*Honest limit:* the client chooses `meta.source`, so a modified client could label every camera loss as `'livekit'`. A client that hides events can do the same by not sending them. This is why the logs are evidence for review and not proof, and why an admin watches the grid.

### 4.2 Threshold

- `exams.flag_threshold`, default **10**, whole number **1 to 100** (already in the schema and in the exam create and update contract).
- A candidate is **red** when `violation_count >= flag_threshold`.
- Reaching the threshold records/flags evidence only. It never ejects, terminates, signs out, disqualifies, or auto-submits the candidate. Admin review happens after the exam.
- The live grid remains ordered by MER code; incident and threshold updates never reorder candidates.
- The threshold can be edited **while the exam is live** (the exam update route already allows `title` and `flag_threshold` after the start). Every tile recolours at once, because the colour is calculated in the browser from the exam row and the candidate's `violation_count`.
- Changes are written to `admin_actions` with the old and new value.

---

## 5. One absence counts once (disconnects and tab switches)

**Rule:** if an attention incident overlaps a disconnect gap, only the **attention incident** counts. The `DISCONNECTED` row does not.

"Overlaps" means the incident's interval (`occurred_at` to `occurred_at + coalesce(duration_ms, 0)`) touches the gap, which runs from `meta.last_seen_at` (minus a 10 s margin) until the candidate returns, or until now if they have not returned. This replaces the old test, which only looked at the first 10 seconds of the gap. A tab switch 60 seconds into a Wi-Fi drop is now covered.

Both arrival orders are handled:

| Order | What happens |
|---|---|
| Incident is recorded **before** the 2-minute flip | `resolve_disconnects()` finds the overlap and sets `count_reason = 'overlap'`. Nothing is counted for the disconnect. |
| Incident arrives **after** the flip (frozen tab, normal case) | The events route calls `reverse_disconnects_for_incident(event_id)`. The row goes from `long_gap` to `reversed_by_focus` and the trigger subtracts 1. |

The reversal only touches rows with `count_reason = 'long_gap'`, so a row that an admin dismissed or restored is never changed by the system (section 7.4).

Known limits:
- If an admin dismisses the tab-switch incident as a false positive, the matching disconnect stays uncounted. It is still one absence.
- An incident that **starts after the candidate returned** never reverses an earlier disconnect. The reversal checks the gap end, using the next `RECONNECTED` row. If the heartbeat's `RECONNECTED` has not been written yet when an incident arrives (a window of at most one heartbeat), the gap is treated as still open.

The canonical SQL for both parts is in migration 007.

**Reversal safety:** if the events route inserts an attention incident but the `reverse_disconnects_for_incident` call fails, the double count stays. The route retries once (the function is idempotent). As a second safety net, the worker calls `reverse_recent_disconnects()` for relevant attention incidents inserted in the last 5 minutes. Because the function holds locks until return, it groups by distinct attempt and locks those attempts in UUID order before processing event ids. Running it again is harmless.

**Shared gap boundary:** heartbeat and worker Pass 2 both call `classify_disconnect()`. A gap strictly below two minutes is `short_gap`. At exactly two minutes or later, the helper applies the same overlap rule above; an overlap becomes `overlap`, otherwise it becomes counted `long_gap`. This prevents heartbeat from winning the row lock after a long outage and incorrectly labelling it short.

---

## 6. Snapshots

| Rule | Value |
|---|---|
| Which events | `TAB_HIDDEN`, `FOCUS_LOST`, `FULLSCREEN_EXIT`, `VIEWPORT_CHANGED`, `MULTI_SCREEN`. None for the others. |
| How many | At most **1 per incident** and at most `MAX_SNAPSHOTS_PER_ATTEMPT` (60) per attempt |
| Format | 320x240 JPEG, quality 0.6, about 15 KB. The server accepts up to 100 KB. |
| When | At incident **open** if the page is visible. For `TAB_HIDDEN` the frame is usually frozen or black, so take it at incident **close** instead and set `meta.snapshot_at = 'end'`. |
| Black frame | Draw to a canvas and average the pixel brightness. Below `BLACK_LUMA` (12 of 255), do not send a snapshot and set `meta.snapshot_skipped = 'black'`. The event is still sent. |
| Camera off | No snapshot. The event is still sent. |
| Upload | Inside `POST /api/events` as base64, uploaded by the server (unchanged from Section 3). A failed upload keeps the event and sets `meta.snapshot_error = true`. |
| Retention | Exactly 14 days from snapshot capture time (`SNAPSHOT_RETENTION_DAYS`). The exact 14-day boundary is retained; deletion begins only when strictly older. Existing paths receive the migration-013 application time so they get a fresh conservative window. Only `ended` or `finalized` exams with no `in_progress` attempt qualify. The rules screen shows the same number from `/api/auth/me`. |
| Viewing | Admins only, through signed URLs that last 300 s (unchanged). |

Migration 013 assigns `snapshot_captured_at` when the event reserves its Storage path, immediately before the route uploads the file. If upload fails, `mark_violation_snapshot_failed()` clears both fields. Purge staging retains the exact path and original capture time in a durable queue before clearing the event reference. The admin timeline says **Snapshot cleanup pending** while queued and **Snapshot deleted after 14-day retention** only after Storage confirms the object is absent. Event rows, counts and incident metadata stay.

---

## 7. Admin side

### 7.1 Tile colours and the threshold control

- **Red:** `violation_count >= flag_threshold`.
- **Amber:** `violation_count >= ceil(flag_threshold / 2)` and below red. This is a display rule only (5 of 10 by default).
- **Threshold control (new task 3C.5):** a small number field on the live grid header (1 to 100) that saves through the existing exam update route. The exam form (1D.2) keeps the same field for before the exam. The default for a new exam is 10.
- **Toast:** when a tile turns red from a Realtime update, show a short toast with the candidate's MER code. This is client-side only.

### 7.2 Violation timeline (3C.1, 3C.4)

Each row shows the type, merged types, start time, duration, the snapshot (if any), and whether it counted. For `DISCONNECTED` rows, show the gap length (taken from the paired `RECONNECTED` row) and the reason from `meta.count_reason`:

| `count_reason` | Meaning shown |
|---|---|
| `long_gap` | Counted: no heartbeat for at least 2 minutes |
| `short_gap` | Not counted: the candidate returned quickly |
| `overlap` | Not counted: a tab-switch incident already covers this absence |
| `reversed_by_focus` | Was counted, then reversed when the tab-switch incident arrived |
| `dismissed` / `restored` | Changed by an admin (with their note) |

Throttled-tab pairs that repeat within a few minutes are collapsed into one entry with a count.

### 7.3 CSV export

Add two columns to the summary export (7.4): `violations_counted` (`violation_count`) and `violations_logged` (all rows for the attempt).

### 7.4 Dismissing and restoring an incident (new route)

`PATCH /api/admin/events/[id]` - any admin.

Body: `{ "dismissed": true | false, "note": "..." }`. `note` is required, 1 to 300 characters.

- **Dismiss** (`dismissed: true`): allowed when `counts = true`. Sets `counts = false`, sets `meta.dismissed = { by, at, note }`, and for a `DISCONNECTED` row also sets `meta.count_reason = 'dismissed'`. The trigger subtracts 1.
- **Restore** (`dismissed: false`): allowed when `meta.dismissed` exists. Sets `counts = true`, removes `meta.dismissed`, and for a `DISCONNECTED` row sets `count_reason = 'restored'`. The trigger adds 1.
- Errors: `404 not_found`, `409 not_dismissable` (already not counted), `409 not_restorable`, `400 note_required`.
- Writes an `admin_actions` row (`event_dismiss` or `event_restore`) with the event id and the note.
- Realtime updates the badge, because the trigger changes `attempts.violation_count`.

**Null meta guard:** the dismiss route must use `coalesce(meta, '{}'::jsonb)` before merging the `dismissed` object. Client events often have `meta = null`, and in Postgres `jsonb_set(null, ...)` returns `null`, so the dismiss note would be silently lost. The same applies to the heartbeat's `short_gap` write.

Migration 007 provides the atomic dismiss/restore RPC; the route remains required Phase 3 scope.

---

## 8. Tunables

Client values live in `lib/proctoring-config.ts`. Counting rules live in `lib/proctoring-rules.ts`, which the worker imports too.

| Name | Default | Used for |
|---|---|---|
| `flag_threshold` (database, per exam) | 10 | Red tile |
| `WARNING_TOAST_MS` | 10000 | How long the candidate warning toast stays |
| `FOCUS_GRACE_MS` | 1000 | `FOCUS_LOST` debounce |
| `MIN_INCIDENT_MS` | 1000 | Drop very short `TAB_HIDDEN`-only incidents |
| `CHECK_INTERVAL_MS` | 1000 | Focus and viewport polling |
| `VIEWPORT_TOLERANCE` | 0.98 | Width ratio below which the viewport counts as changed |
| `VIEWPORT_CONFIRM_TICKS` | 2 | Consecutive failed checks needed |
| `MEDIA_LOSS_GRACE_MS` | 5000 | Camera and mic loss debounce |
| `MAX_SNAPSHOTS_PER_ATTEMPT` | 60 | Storage cap |
| `BLACK_LUMA` | 12 | Black frame test |
| `QUEUE_MAX` | 50 | Client send queue |
| Heartbeat interval | 10 s | Unchanged |
| Offline label after | 25 s | Display only |
| `DISCONNECTED` row after | 30 s | Worker pass 1 |
| Disconnect counts after | 2 min of silence; heartbeat uses the same boundary if it returns before Pass 2 | Shared database helper |
| Overlap margin | 10 s | Before the gap start |
| Events rate limit | 30 per minute per attempt | Unchanged |
| `SNAPSHOT_RETENTION_DAYS` | 14 | Purge job and rules screen |

---

## 9. Limits and rehearsal checks

**Cannot be detected:** a second phone or laptop, a virtual machine, screenshots, someone helping in the room.

**To confirm in the rehearsal (Phase 8)** *(test)*:
1. Chrome split view on a laptop, Windows Snap, the Chrome side panel, Android split screen and a floating window: each one should produce a logged incident. Split view does not fire `visibilitychange`, and interacting with the other pane fires `blur`. How split view interacts with the Fullscreen API is not confirmed.
2. Android notification shade, edge panel and assistant: how many short incidents appear after the 1 s grace.
3. `sendBeacon` on `pagehide` on Android Chrome (tab close, lock screen, app switch).
4. A frozen tab (block heartbeat requests in DevTools, or lock a tablet for over 3 minutes) followed by a tab-switch incident: the net count is 1.
5. Tablet camera frame rate and the black-frame test on the real devices.

---

## 10. Edits to apply

### 10.1 `implementation-plan.md`

| Task | Change |
|---|---|
| 3A.1 | Replace the "merge within ~3 seconds" wording with the lifecycle in section 3 (join while open, close when all clear). Add the client `id`, the queue and retry, the exam-start split, and the flush before submit. |
| 3A.2 to 3A.9 | Point each at its row in the section 2 table (sources, debounce, `meta.source` for camera and mic). |
| 3A.11 | Replace with the snapshot rules in section 6. |
| ➕ 3A.12 | New: `lib/proctoring-config.ts` and `lib/proctoring-rules.ts` (section 8). |
| 3B.1 | Require `id`, add the idempotency check, apply the counting order in section 4.1, and call `reverse_disconnects_for_incident` after inserting an attention incident. |
| 3B.6 | Say that pass 2's overlap test uses the interval rule in section 5 (not the 10 s window). |
| 3C.1, 3C.4 | Show `count_reason` text and the dismiss action. |
| 3C.2 | Red is `violation_count >= flag_threshold`; add the amber rule. |
| ➕ 3C.5 | New: threshold control on the live grid and the red-tile toast. |
| ➕ 3B.7 | New: `app/api/admin/events/[id]/route.ts` (PATCH, section 7.4). |
| 1D.2 | Note that the threshold default is 10 and the range is 1 to 100. |
| 4B.4 | Note that a LiveKit-only loss is logged with `meta.source = 'livekit'` and does not count. |
| 7.4 | Add the two CSV columns. |

### 10.2 `SECTIONS/section-3-api-contracts.md`

- 3.13 `POST /api/events`: add the required `id`, the `duplicate` response, the counting order from section 4.1 (replace the "otherwise `true`" line), and the call to `reverse_disconnects_for_incident`. Replace the paragraph titled "Late FOCUS_LOST reversal" with a reference to section 5 of this file.
- Section 7 (worker): update the `DISCONNECTED` row to the interval overlap rule.
- New route entry for `PATCH /api/admin/events/[id]` (route count goes from 39 to 40).

### 10.3 SQL (`001_initial.sql`, `001_smoke_test.sql`)

Use `supabase/migrations/007_proctoring.sql`; do not copy SQL from this prose section.

---

## 11. New tests (Phase 8)

| # | Test |
|---|---|
| 8.50 | Alt-tab, then a viewport change 10 s later, then return: **one** incident with `merged_types` containing both, `duration_ms` about 10 s or more. |
| 8.51 | Blur under 1 s: nothing is logged. Fullscreen exit under 1 s: logged. |
| 8.52 | Retry safety: make the first `POST /api/events` succeed but drop the response. The retry returns `duplicate: true` and `violation_count` goes up by 1. |
| 8.53 | Submit with an open incident: it is sent before the submit and appears in the log. |
| 8.54 | Close the tab during an incident: the beacon arrives with a sensible duration. *(Android)* |
| 8.55 | Fault still active when the exam starts: the waiting-room incident does not count and a new exam-phase incident does. |
| 8.56 | Black frame (cover the camera, then switch tab): the event is saved with `snapshot_skipped = 'black'`. |
| 8.57 | `COPY`, `PASTE`, `CONTEXT_MENU`: logged, `counts = false`, and the same type within 3 s is one event. |
| 8.58 | Camera: unplug it (counts) versus kill LiveKit (does not count). |
| 8.59 | Reload during the exam: `RELOAD` logged and counted. A fresh login after a kick is not a `RELOAD`. |
| 8.60 | Change `flag_threshold` from 10 to 3 while live: tiles at 3 or 4 recolour immediately. |
| 8.61 | Dismiss an incident with a note: `violation_count` drops by 1. Restore it: it goes back up. Both appear in the audit log. |
| 8.62 | Wi-Fi drop of 3 minutes with a tab switch 60 s in, **both orders** (event arrives before and after the flip): net `violation_count` is 1 each time. |
| 8.63 | Smoke-test additions 11a to 11c (Appendix A.3) pass. |

---

## Appendix A - Superseded design notes (do not run)

The executable source of truth is `supabase/migrations/007_proctoring.sql`. The snippets below predate its bounded ordered locks, atomic event/heartbeat RPCs, grants and final index decisions; they are retained only to explain the earlier overlap-rule reconciliation.

### A.1 Replace `resolve_disconnects()` (overlap test changed)

Only the overlap condition in statement 1 changes: the upper bound on the incident start is removed, because an incident can now start anywhere inside the gap. The incident must end no earlier than 10 s before the gap start.

```sql
create or replace function public.resolve_disconnects()
returns void language plpgsql as $$
begin
  -- 1. Mark disconnects that an attention incident already explains
  update public.violation_events ve
  set meta = jsonb_set(ve.meta, '{count_reason}', '"overlap"')
  from public.attempts a
  where a.id = ve.attempt_id
    and ve.type = 'DISCONNECTED'
    and ve.counts = false
    and ve.meta->>'count_reason' is null
    and (ve.meta->>'last_seen_at')::timestamptz < now() - interval '2 minutes'
    and a.last_seen_at = (ve.meta->>'last_seen_at')::timestamptz
    and a.status = 'in_progress'
    and exists (
      select 1 from public.violation_events f
      where f.attempt_id = ve.attempt_id
        and f.type in ('TAB_HIDDEN','FOCUS_LOST','FULLSCREEN_EXIT','VIEWPORT_CHANGED')
        and f.occurred_at + (coalesce(f.duration_ms, 0) * interval '1 millisecond')
            >= (ve.meta->>'last_seen_at')::timestamptz - interval '10 seconds'
    );

  -- 2. Flip the rest
  update public.violation_events ve
  set counts = true,
      meta = jsonb_set(ve.meta, '{count_reason}', '"long_gap"')
  from public.attempts a
  where a.id = ve.attempt_id
    and ve.type = 'DISCONNECTED'
    and ve.counts = false
    and ve.meta->>'count_reason' is null
    and (ve.meta->>'last_seen_at')::timestamptz < now() - interval '2 minutes'
    and a.last_seen_at = (ve.meta->>'last_seen_at')::timestamptz
    and a.status = 'in_progress';
end $$;
```

(The `revoke` and `grant` lines already in `001_initial.sql` stay as they are.)

### A.2 New `reverse_disconnects_for_incident()`

Called by `POST /api/events` after it inserts an attention incident. Returns how many disconnect rows it reversed.

```sql
create or replace function public.reverse_disconnects_for_incident(p_event_id uuid)
returns int language plpgsql as $$
declare
  v_n int;
begin
  with inc as (
    select attempt_id,
           occurred_at,
           occurred_at + (coalesce(duration_ms, 0) * interval '1 millisecond') as ends_at
    from public.violation_events
    where id = p_event_id
      and type in ('TAB_HIDDEN','FOCUS_LOST','FULLSCREEN_EXIT','VIEWPORT_CHANGED')
  ), upd as (
    update public.violation_events d
    set counts = false,
        meta = jsonb_set(d.meta, '{count_reason}', '"reversed_by_focus"')
    from inc
    where d.attempt_id = inc.attempt_id
      and d.type = 'DISCONNECTED'
      and d.counts = true
      and d.meta->>'count_reason' = 'long_gap'
      and inc.ends_at >= (d.meta->>'last_seen_at')::timestamptz - interval '10 seconds'
      and inc.occurred_at <= coalesce(
            (select min(r.occurred_at) from public.violation_events r
              where r.attempt_id = d.attempt_id
                and r.type = 'RECONNECTED'
                and r.occurred_at > d.occurred_at),
            now())
    returning 1
  )
  select count(*) into v_n from upd;
  return v_n;
end $$;

revoke execute on function public.reverse_disconnects_for_incident(uuid) from public, anon, authenticated;
grant  execute on function public.reverse_disconnects_for_incident(uuid) to service_role;
```

### A.3 Smoke test changes

**Required fix to test 10e.** With the broader overlap rule, the earlier `FOCUS_LOST` row (about 5 minutes ago) lies inside the 10-minute gap that test 10e creates, so that row would now be marked `overlap` instead of flipping. Add this line just before test 10e inserts its `DISCONNECTED` row:

```sql
delete from public.violation_events where attempt_id = v_att and type = 'FOCUS_LOST';
```

**New block 11** (insert after test 10, inside the same `do` block, before `raise notice`). The attempt must be `in_progress` again, and old rows are cleared so each case starts clean.

```sql
  -- 11. One absence counts once (section 5)
  declare v_d1 uuid; v_d2 uuid; v_f2 uuid; v_d3 uuid; v_f3 uuid;
  begin
    -- 11a. Incident starts 60 s INTO the gap (outside the old 10 s window), recorded before the flip
    delete from public.violation_events where attempt_id = v_att;
    update public.attempts
      set status = 'in_progress', violation_count = 0,
          last_seen_at = now() - interval '6 minutes'
      where id = v_att;
    insert into public.violation_events (attempt_id, type, counts, meta)
    values (v_att, 'DISCONNECTED', false,
            jsonb_build_object('last_seen_at', (now() - interval '6 minutes')::timestamptz::text))
    returning id into v_d1;
    insert into public.violation_events (attempt_id, type, occurred_at, duration_ms, counts)
    values (v_att, 'FOCUS_LOST', now() - interval '5 minutes', 30000, false);
    perform public.resolve_disconnects();
    assert (select meta->>'count_reason' from public.violation_events where id = v_d1) = 'overlap',
      '11a: incident inside the gap must mark the disconnect overlap';

    -- 11b. Flip first, then the late incident arrives: the disconnect is reversed, net count 1
    delete from public.violation_events where attempt_id = v_att;
    update public.attempts
      set violation_count = 0, last_seen_at = now() - interval '6 minutes'
      where id = v_att;
    insert into public.violation_events (attempt_id, type, counts, meta)
    values (v_att, 'DISCONNECTED', false,
            jsonb_build_object('last_seen_at', (now() - interval '6 minutes')::timestamptz::text))
    returning id into v_d2;
    perform public.resolve_disconnects();
    assert (select counts from public.violation_events where id = v_d2) = true, '11b-pre: flips to counted';
    insert into public.violation_events (attempt_id, type, occurred_at, duration_ms, counts)
    values (v_att, 'FOCUS_LOST', now() - interval '5 minutes', 30000, true)
    returning id into v_f2;
    assert public.reverse_disconnects_for_incident(v_f2) = 1, '11b: one disconnect reversed';
    assert (select meta->>'count_reason' from public.violation_events where id = v_d2) = 'reversed_by_focus',
      '11b: reason must be reversed_by_focus';
    assert (select violation_count from public.attempts where id = v_att) = 1,
      '11b: net count must be 1 (the tab switch), not 2';

    -- 11c. An incident that starts AFTER the candidate returned must not reverse the disconnect
    delete from public.violation_events where attempt_id = v_att;
    update public.attempts
      set violation_count = 0, last_seen_at = now() - interval '6 minutes'
      where id = v_att;
    insert into public.violation_events (attempt_id, type, occurred_at, counts, meta)
    values (v_att, 'DISCONNECTED', now() - interval '5 minutes', false,
            jsonb_build_object('last_seen_at', (now() - interval '6 minutes')::timestamptz::text))
    returning id into v_d3;
    perform public.resolve_disconnects();
    insert into public.violation_events (attempt_id, type, occurred_at, counts, duration_ms)
    values (v_att, 'RECONNECTED', now() - interval '2 minutes', false, 240000);
    insert into public.violation_events (attempt_id, type, occurred_at, duration_ms, counts)
    values (v_att, 'FOCUS_LOST', now() - interval '1 minute', 10000, true)
    returning id into v_f3;
    assert public.reverse_disconnects_for_incident(v_f3) = 0,
      '11c: incident after the reconnect must not reverse the disconnect';
    assert (select counts from public.violation_events where id = v_d3) = true,
      '11c: disconnect stays counted';
  end;
```

In 11c the `DISCONNECTED` row is given an explicit `occurred_at` (5 minutes ago) so that the `RECONNECTED` row (2 minutes ago) falls after it, as it would in real use. Without that, the default `now()` would put the disconnect after the reconnect and the gap-end lookup would find nothing.
