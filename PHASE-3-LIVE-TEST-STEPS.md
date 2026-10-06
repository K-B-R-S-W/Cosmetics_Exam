# Phase 3 live verification: full steps with SQL

Everything here runs against the **development** Supabase project, never production.
None of the SQL below has been executed by me. If a block errors, paste the error back.

## Run order

| # | Part | Worker | Time |
|---|---|---|---|
| A | Guard and heartbeat live test | Running (you start and stop it) | about 20 min |
| B | Two-session lock test (SQL editor) | **Stopped** | about 30 min |
| C | Manual checks, two laptops | Running | about 60 min |
| D | Android tablet checks | Running | about 45 min |
| E | Exit checklist | n/a | 10 min |

Before Part A: use the **rotated** service-role key in the worker env. Rotating it is also an exit item.

## Not verifiable in Phase 3 (move to the Phase 4 checklist)

`ExamScreen` passes `mediaTracks: []` and no `video` element, and LiveKit arrives in Phase 4. So there is no real camera or mic (`CAMERA_LOST`, `MIC_LOST`, real snapshots, black-frame skip), and the admin timeline, badge, threshold control and Realtime toast are built but unmounted. Part C replaces what it can with API-level and SQL-level checks.

---

# Part A. Worker guard and heartbeat live test (6A.1 and 6A.6)

Windows PowerShell, from the repo root. Use the **rotated** service-role key.

```powershell
cd worker
npm run build
$env:SUPABASE_URL = "https://YOUR-PROJECT.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "YOUR-ROTATED-KEY"
node dist/index.cjs
```

**Prerequisite fix (found on first run):** `esbuild.mjs` bundles CommonJS into `dist/index.js`, but `worker/package.json` has `"type": "module"`, so Node loads it as ESM and crashes with `module is not defined in ES module scope`. `npm run test:dist` still passed because it copies `dist` to a temp folder outside the package scope. Apply `worker-cjs-fix.patch` (outputs `dist/index.cjs`, updates `start` and `test:dist`), commit it, then rebuild and run `node dist/index.cjs`. Run `node` directly rather than through `npm start`, so `$LASTEXITCODE` is the worker's own exit code.

Watch the row from the SQL editor:

```sql
select component, status, last_heartbeat_at,
       now() - last_heartbeat_at as heartbeat_age, detail
from public.system_health;
```

| Step | Action | Expected |
|---|---|---|
| 1 | Start worker 1 | Row `worker`, status `ok`, age under 30 s, `detail` has an `instance` value (copy it down) |
| 2 | Wait 35 s and rerun the query | `last_heartbeat_at` advanced |
| 3 | Start worker 2 in a second terminal (same env) | It sees worker 1's heartbeat advance and exits within about 35 s (not the full 65 s). In PowerShell run `$LASTEXITCODE` right after and expect **3** |
| 4 | Check worker 1 | Still running, heartbeat still advancing, `instance` unchanged |
| 5 | Press Ctrl+C in worker 1 | Row becomes `down` within about a second, exit code 0 |
| 6 | Start worker 1 again | Starts immediately (row is `down`), no 65 s wait |
| 7 | Crash test: find the worker PID, then kill only that PID (see below) | Row stays `ok` with a stale heartbeat |
| 8 | Start a new worker straight away | It polls, sees no heartbeat advance, and takes over within 65 s (immediately if the age is already 60 s or more) |
| 9 | Stay idle 2 minutes with both lanes running | Lifecycle and proctoring logs continue, heartbeat continues |

Crash test commands for step 7 (do not use `-Name node`, it also kills your Next dev server):

```powershell
Get-CimInstance Win32_Process -Filter "name='node.exe'" | Select ProcessId, CommandLine
Stop-Process -Id <worker pid> -Force
```

Plan row 8.76 ("start a second worker while one is alive: it exits") is steps 3 and 4.

---

# Part B. Two-session lock test (migrations 006 and 007)

**Stop the worker first.** If it is running it will insert `DISCONNECTED` rows itself and ruin the expectations.

## How the two sessions work in the Supabase SQL editor

Each editor tab is a separate connection, but a "Run" is one request. So we hold a lock by putting `pg_sleep` inside a transaction in **Tab A**, and run the probe in **Tab B** during the sleep. Open three tabs:

- **Tab A** holds locks (scripts below)
- **Tab B** is the probe
- **Tab C** shows who is waiting (run it while A is sleeping)

Tab C query:

```sql
select pid, state, wait_event_type, wait_event,
       now() - query_start as running_for, left(query, 70) as query
from pg_stat_activity
where datname = current_database() and pid <> pg_backend_pid() and state <> 'idle'
order by query_start;
```

If the editor does not keep the transaction open for the whole sleep, use `psql` in two terminals with the direct connection string from Supabase, port 5432. The same scripts work there.

Use a sleep of 40 s. The editor may time out long scripts, so keep it at 40.

## B0. Fixture (run once, Tab B, committed)

```sql
do $$
declare
  v_exam uuid := gen_random_uuid();
  v_i int;
  v_c uuid;
  v_a uuid;
begin
  insert into public.exams (id, title, duration_min, status, started_at, ends_at)
  values (v_exam, 'P3LOCK exam', 60, 'live',
          now() - interval '10 minutes', now() + interval '50 minutes');
  for v_i in 1..3 loop
    v_c := gen_random_uuid();
    insert into public.candidates (id, mer_code, full_name, nic_hash)
    values (v_c, 'P3LOCK-' || v_i, 'Lock Test ' || v_i, 'synthetic-hash');
    insert into public.exam_candidates (exam_id, candidate_id) values (v_exam, v_c);
    select id into v_a from public.attempts where exam_id = v_exam and candidate_id = v_c;
    update public.attempts
       set status = 'in_progress',
           acknowledged_at = now() - interval '9 minutes',
           joined_at = now() - interval '9 minutes',
           last_seen_at = now() - interval '40 seconds'
     where id = v_a;
    insert into public.sessions (candidate_id, attempt_id) values (v_c, v_a);
  end loop;
end $$;
```

Check it:

```sql
select c.mer_code, a.id as attempt_id, a.status, a.last_seen_at, s.id as session_id
from public.candidates c
join public.attempts a on a.candidate_id = c.id
join public.sessions s on s.attempt_id = a.id
where c.mer_code like 'P3LOCK-%'
order by c.mer_code;
```

Expect 3 rows, all `in_progress`.

## Reset (run before every test L1 to L5)

```sql
delete from public.violation_events
 where attempt_id in (select a.id from public.attempts a
                       join public.exams e on e.id = a.exam_id
                      where e.title = 'P3LOCK exam');
update public.attempts a
   set status = 'in_progress', violation_count = 0,
       last_seen_at = now() - interval '40 seconds'
  from public.exams e
 where e.id = a.exam_id and e.title = 'P3LOCK exam';
```

## Verification query V1 (use after each test)

```sql
select c.mer_code,
       count(*) filter (where v.type = 'DISCONNECTED') as disconnected,
       count(*) filter (where v.type = 'RECONNECTED')  as reconnected,
       a.violation_count
from public.candidates c
join public.attempts a on a.candidate_id = c.id
left join public.violation_events v on v.attempt_id = a.id
where c.mer_code like 'P3LOCK-%'
group by c.mer_code, a.violation_count
order by c.mer_code;
```

Timeline for attempt 1 (V2):

```sql
select v.occurred_at, v.type, v.counts, v.duration_ms, v.meta
from public.violation_events v
join public.attempts a on a.id = v.attempt_id
join public.candidates c on c.id = a.candidate_id
where c.mer_code = 'P3LOCK-1'
order by v.occurred_at, v.id;
```

## L1. Pass 1 skips a locked attempt (`SKIP LOCKED`)

Run Reset, then:

**Tab A** (start first):

```sql
begin;
select a.id from public.attempts a
  join public.candidates c on c.id = a.candidate_id
 where c.mer_code = 'P3LOCK-1'
   for update of a;
select pg_sleep(40);
commit;
```

**Tab B** (within the 40 s):

```sql
with r as materialized (select public.record_disconnects() as inserted)
select r.inserted, clock_timestamp() - statement_timestamp() as elapsed from r;
```

Expect `inserted = 2` and `elapsed` under about 1 s. It must not wait for A.

After A finishes, run the same probe again: expect `inserted = 1` (attempt 1). Run V1: each of the 3 attempts has exactly 1 `disconnected`.

## L2. Two workers cannot double-insert (Pass 1 against Pass 1)

Run Reset, then:

**Tab A**:

```sql
begin;
select public.record_disconnects();
select pg_sleep(40);
commit;
```

**Tab B** (within the 40 s), the same probe as L1.

Expect `inserted = 0` and `elapsed` under about 1 s. After A commits, run the probe once more: still `0`. Run V1: each attempt has exactly **1** `disconnected`. Two workers running at once is the failure the 6A.1 guard exists to prevent. This shows the database tolerates it anyway.

## L3. Heartbeat waits behind a worker pass, then classifies a short gap

Run Reset immediately before this test, because the gap must stay under 2 minutes.

**Tab A**:

```sql
begin;
select public.record_disconnects();
select pg_sleep(40);
commit;
```

**Tab B** (right after A starts):

```sql
with r as materialized (
  select out_result, out_state->>'phase' as phase
  from public.candidate_heartbeat(
    (select s.id from public.sessions s
       join public.candidates c on c.id = s.candidate_id
      where c.mer_code = 'P3LOCK-1'))
)
select r.*, clock_timestamp() - statement_timestamp() as elapsed from r;
```

Expect `out_result = ok`, `phase = live`, and `elapsed` roughly equal to the remaining sleep (it blocks, then completes). No deadlock error. Run V2: one `DISCONNECTED` with `counts = false` and `meta.count_reason = short_gap`, followed by one `RECONNECTED`.

## L4. Pass 2 against a heartbeat on a long gap (exactly one count)

Reset, then make attempt 1 three minutes stale with an open `DISCONNECTED`:

```sql
update public.attempts
   set last_seen_at = now() - interval '3 minutes'
 where id = (select a.id from public.attempts a
               join public.candidates c on c.id = a.candidate_id
              where c.mer_code = 'P3LOCK-1');

insert into public.violation_events (attempt_id, type, counts, occurred_at, meta)
select a.id, 'DISCONNECTED', false, now() - interval '150 seconds',
       jsonb_build_object('last_seen_at', a.last_seen_at)
  from public.attempts a
  join public.candidates c on c.id = a.candidate_id
 where c.mer_code = 'P3LOCK-1';
```

**Tab A**:

```sql
begin;
select public.resolve_disconnects();
select pg_sleep(40);
commit;
```

**Tab B**: the L3 heartbeat probe, right after A starts.

Expect the heartbeat to block, then return `ok`. Run V2 and V1: one `DISCONNECTED` with `counts = true` and `count_reason = long_gap`, exactly one `RECONNECTED`, and attempt 1 `violation_count = 1` (counted once, not twice).

## L5. Heartbeat against a candidate event on the same attempt

Reset, then:

**Tab A**:

```sql
begin;
select * from public.record_candidate_event(
  (select s.id from public.sessions s
     join public.candidates c on c.id = s.candidate_id
    where c.mer_code = 'P3LOCK-1'),
  gen_random_uuid(), 'TAB_HIDDEN', array[]::text[], 0, 1500, null, false);
select pg_sleep(40);
commit;
```

**Tab B**: the L3 heartbeat probe.

Expect the heartbeat to block until A commits, then `ok`, no deadlock. V1: attempt 1 `violation_count = 1`.

## L6. Heartbeat against `submit_due_attempt` (006 and 007 interaction)

Create a due exam (Tab B, committed):

```sql
do $$
declare
  v_exam uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_a uuid;
begin
  insert into public.exams (id, title, duration_min, status, started_at, ends_at)
  values (v_exam, 'P3LOCK due', 30, 'live',
          now() - interval '31 minutes', now() - interval '1 minute');
  insert into public.candidates (id, mer_code, full_name, nic_hash)
  values (v_c, 'P3LOCK-D', 'Lock Test Due', 'synthetic-hash');
  insert into public.exam_candidates (exam_id, candidate_id) values (v_exam, v_c);
  select id into v_a from public.attempts where exam_id = v_exam and candidate_id = v_c;
  update public.attempts
     set status = 'in_progress', acknowledged_at = now() - interval '30 minutes',
         joined_at = now() - interval '30 minutes', last_seen_at = now()
   where id = v_a;
  insert into public.sessions (candidate_id, attempt_id) values (v_c, v_a);
end $$;
```

**Tab A**:

```sql
begin;
select * from public.submit_due_attempt(
  (select a.id from public.attempts a
     join public.candidates c on c.id = a.candidate_id
    where c.mer_code = 'P3LOCK-D'));
select pg_sleep(40);
commit;
```

**Tab B**:

```sql
with r as materialized (
  select out_result, out_state->>'phase' as phase
  from public.candidate_heartbeat(
    (select s.id from public.sessions s
       join public.candidates c on c.id = s.candidate_id
      where c.mer_code = 'P3LOCK-D'))
)
select r.*, clock_timestamp() - statement_timestamp() as elapsed from r;
```

Expect the heartbeat to wait for A, then return `ok` with `phase = submitted`. Confirm:

```sql
select a.status, a.submit_reason, a.submitted_at
from public.attempts a join public.candidates c on c.id = a.candidate_id
where c.mer_code = 'P3LOCK-D';
```

Expect `submitted` and `auto`.

## B-end. Deadlock log check and cleanup

Dashboard, Logs, Postgres logs: search for `deadlock`. Expect none from this session.

```sql
delete from public.exams where title like 'P3LOCK%';
delete from public.candidates where mer_code like 'P3LOCK-%';
```

Cascades remove the attempts, sessions and events.

## Pass criteria for Part B

- Every blocked probe finishes after A commits with no `deadlock detected` error
- Every `SKIP LOCKED` probe returns in about 1 s without waiting
- V1 shows exactly one `DISCONNECTED` per attempt after L2, and one count after L4
- Postgres logs show no deadlock

---

# Part C. Manual checks (two laptops)

## C0. Setup

Laptop 1 is the admin and runs the web server and the worker. Laptop 2 is a candidate.

1. Find laptop 1's LAN IP: `ipconfig` (use the IPv4 of the Wi-Fi adapter, for example `192.168.1.20`).
2. In `apps/web/.env.local` set `ALLOWED_ORIGINS=http://localhost:3000,http://192.168.1.20:3000`.
3. Start the web app in **dev mode** (the session cookie is `secure` only in production, so production mode would not work over plain http):
   ```powershell
   cd apps/web
   npm run dev -- -H 0.0.0.0
   ```
4. Allow the port (Administrator PowerShell, and remove it afterwards):
   ```powershell
   New-NetFirewallRule -DisplayName "Next dev 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
   # later:
   Remove-NetFirewallRule -DisplayName "Next dev 3000"
   ```
5. Start the worker on laptop 1 (see Part A for env), after Part B is done.
6. In the admin UI create an exam **P3 Rehearsal**: free navigation, 30 minutes, threshold 10, a few questions. Import 3 candidates (MER codes you choose, for example `P3-1`, `P3-2`, `P3-3`) and assign them.
7. If a POST from the other device returns 403 `forbidden`, the origin is not allowed. Fix `ALLOWED_ORIGINS` and restart dev.

Helper queries (replace the MER code):

```sql
-- H1: ids
select a.id as attempt_id, e.id as exam_id, a.status, a.violation_count, a.last_seen_at,
       (select s.id from public.sessions s where s.attempt_id = a.id order by s.created_at desc limit 1) as session_id
from public.attempts a
join public.candidates c on c.id = a.candidate_id
join public.exams e on e.id = a.exam_id
where c.mer_code = 'P3-1';

-- H2: event timeline
select v.occurred_at, v.type, v.merged_types, v.counts, v.duration_ms, v.snapshot_path, v.meta, v.id
from public.violation_events v
join public.attempts a on a.id = v.attempt_id
join public.candidates c on c.id = a.candidate_id
where c.mer_code = 'P3-1'
order by v.occurred_at, v.id;

-- H3: stored count against counted rows (must match)
select a.violation_count,
       (select count(*) from public.violation_events v where v.attempt_id = a.id and v.counts) as counted_rows
from public.attempts a join public.candidates c on c.id = a.candidate_id
where c.mer_code = 'P3-1';
```

Run H3 after every test in this part. The two numbers must be equal.

## C1. Waiting-room fullscreen

1. Candidate on laptop 2 logs in, passes the rules and check screens and reaches Waiting. Enter fullscreen.
2. Press Esc to leave fullscreen.

Expect: the blocking overlay appears. Restore fullscreen with the button and the overlay clears. H2 shows a `FULLSCREEN_EXIT` with `counts = false` (waiting room). H3 matches, count stays 0.

## C2. Start the exam and exercise events (candidate on laptop 2, fullscreen)

Admin starts the exam. After each action run H2 and H3.

| Action | Expect |
|---|---|
| Switch to another browser tab for 5 s, then return | **One** counted row (`TAB_HIDDEN`, with `FOCUS_LOST` in `merged_types`), duration about 5000 ms. Count +1 |
| Alt+Tab to another window for 5 s, then return | **One** merged counted incident, not three. Count +1 |
| Exit fullscreen with Esc, then restore | One counted `FULLSCREEN_EXIT` |
| Select text, Ctrl+C | `COPY`, `counts = false`, the copy is blocked |
| Ctrl+V in an answer field | `PASTE`, `counts = false`, a paste notice shows for about 4 s |
| Right-click | `CONTEXT_MENU`, `counts = false` |
| Press F5 | `RELOAD`, counted |
| Windows snap (Win+Left) so the window is not full size | A counted `VIEWPORT_CHANGED` about 2 s later (two confirmation ticks), or merged into the fullscreen exit. At least one counted attention incident, not a burst |

For all of these, `snapshot_path` must be **null** (no camera in Phase 3). Within one second, repeating the same instant event (copy, context menu) is deduplicated for 3 s. That is expected.

Extended display (`MULTI_SCREEN`): you have no second monitor, so skip it. It stays unit-tested only.

## C3. Snapshot pipeline through the API (replaces the camera)

This proves the route, the Storage upload and the repair path without a camera. In the candidate tab DevTools Console:

```js
// create a small valid JPEG
const c = document.createElement('canvas'); c.width = 320; c.height = 240;
const g = c.getContext('2d'); g.fillStyle = '#888'; g.fillRect(0, 0, 320, 240);
const b64 = c.toDataURL('image/jpeg', 0.6).split(',')[1];
const id = crypto.randomUUID();
const r = await fetch('/api/events', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id, type: 'FOCUS_LOST', merged_types: [], occurred_ago_ms: 0,
                         duration_ms: 1200, meta: null, snapshot_jpeg_base64: b64 })
});
console.log(r.status, await r.json(), id);
```

Expect `200` and `{ id, snapshot_saved: true }`. Then:

```sql
select id, type, counts, snapshot_path from public.violation_events
where id = '<ID FROM THE CONSOLE>';
```

`snapshot_path` is not null. In the dashboard, Storage, bucket `snapshots`, the object exists at that path. Repeat the same fetch with the same `id`: expect `{ duplicate: true }` and no second row.

Rejection checks (run in the console, expect 400):

- add an unknown key `x: 1` to the body
- set `snapshot_jpeg_base64` to `"AAAA"` (not a JPEG)

## C4. Short gap, long gap and overlap (DevTools request blocking)

Worker must be running. In the candidate tab: DevTools, Network, "Network request blocking", add the pattern `*api/heartbeat*`, enable it. Only the heartbeat is blocked, so events still post.

**Short gap**

1. Block heartbeats for about 40 s. Unblock. Heartbeat backoff can delay the next call up to 60 s.
2. Wait until H2 shows a `RECONNECTED`.

Expect: `DISCONNECTED` with `counts = false` and `count_reason = short_gap`, then `RECONNECTED`. H3 unchanged.

**Long gap**

1. Block for about 150 s with no other incidents. Unblock.

Expect: while still blocked, after about 2 minutes the worker classifies it: `DISCONNECTED` with `counts = true` and `count_reason = long_gap`. After unblock, a `RECONNECTED`. Count +1.

**Overlap**

1. Block heartbeats. During the block, Alt+Tab away for 10 s and return (this event posts normally).
2. Keep the block on past 2 minutes, then unblock.

Expect: the `DISCONNECTED` is `counts = false` with `count_reason` `overlap` (or `reversed_by_focus` if the long-gap count landed first). The attention incident counts once. Total count +1, not +2.

## C5. Dismiss and restore (console on the admin tab)

Pick a counted event id from H2, and run in the **admin** tab Console:

```js
const eventId = '<EVENT ID>';
const call = (dismissed, note) => fetch(`/api/admin/events/${eventId}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dismissed, note })
}).then(async r => [r.status, await r.json()]);
console.log(await call(true, 'rehearsal dismiss'));
console.log(await call(false, 'rehearsal restore'));
console.log(await call(true, ''));      // expect 400
console.log(await call(false, 'again')); // expect 409 not_restorable
```

Expect: first call `200` and the count drops by 1; second `200` and the count returns; third `400`; fourth `409`. Then:

```sql
select id, admin_id, action, target, detail, at
from public.admin_actions
where action in ('event_dismiss', 'event_restore')
order by id desc limit 5;
```

One audit row per successful call, none for the rejected ones. H3 matches after each call.

## C6. Threshold change (admin tab Console)

```js
const examId = '<EXAM ID>';
const r = await fetch(`/api/admin/exams/${examId}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ flag_threshold: 4 })
});
console.log(r.status, await r.json());
```

Expect `200`. Then:

```sql
select action, target, detail, at from public.admin_actions
where detail ? 'new_flag_threshold' order by id desc limit 3;
```

`detail` shows `old_flag_threshold` 10 and `new_flag_threshold` 4. Try `0` and `101`: expect `400`. The amber/red badge and the single threshold toast are unmounted, so they move to Phase 4.

## C7. Session revocation (twice: once in Waiting, once in the exam)

1. Candidate sits on Waiting (then repeat in the exam).
2. Revoke:
   ```sql
   update public.sessions set revoked_at = now()
   where candidate_id = (select id from public.candidates where mer_code = 'P3-2')
     and revoked_at is null;
   ```
3. Within about 10 s the candidate sees the signed-out or session-revoked screen, **not** a permanent "Loading".
4. In the Network tab, `/api/heartbeat` stops after the 401.

## C8. Done stops the heartbeat

Candidate submits the exam. On the Done screen, the Network tab shows no more `/api/heartbeat` calls.

---

# Part D. Android tablet checks

The goal here is to learn what Chrome on Android actually does, and to confirm nothing breaks. Where behaviour differs between devices, record it in the table below instead of treating it as a failure.

## D0. Setup

1. Tablet on the same Wi-Fi as laptop 1.
2. Open `http://<laptop 1 IP>:3000` in Chrome. Log in as `P3-3` (or another candidate whose attempt is not already done).
3. Optional: Chrome remote debugging over USB lets you use DevTools on the tablet (`chrome://inspect` on the laptop). It is not required, because airplane mode covers the offline cases.
4. Use H1 to H3 with the right MER code.

## D1. Run these and note what you see

| # | Action on the tablet | Expect | Record |
|---|---|---|---|
| 1 | Waiting room: enter fullscreen, swipe the system gesture to leave, restore | Overlay appears, uncounted event | |
| 2 | In the exam: pull down the notification shade, wait 5 s, close it | Observe whether Chrome reports blur or visibility change. Anything logged must be **one** incident | |
| 3 | Switch to another app for 10 s and back | One merged counted incident, not several | |
| 4 | Split-screen with another app (recents menu, split) | `VIEWPORT_CHANGED`, counted, after about 2 s. Overlay if fullscreen is lost | |
| 5 | Samsung side panel or pop-up view if your tablet has it | Same as 4 | |
| 6 | Rotate the device | Overlay or orientation lock behaviour as designed. No false storm of events | |
| 7 | Long-press on text | `CONTEXT_MENU`, uncounted, menu blocked | |
| 8 | Copy and paste into an answer | Blocked and logged, paste notice | |
| 9 | Pull-to-refresh or reload | `RELOAD` counted | |

## D2. Offline queue and throttled timers

1. **Offline queue**: turn on airplane mode. Trigger three **different** instant events (for example context menu, copy, paste, spaced more than 3 s apart). Turn airplane mode off.
   Expect: after reconnect, all three appear in H2 with believable `occurred_at` times (the queue sends `occurred_ago_ms`). No duplicates.
2. **Short gap on a real device**: airplane mode for about 40 s, then off. Expect `short_gap` as in C4.
3. **Throttled timers**: lock the screen for 60 s, unlock. Expect either a `short_gap` (heartbeat paused) or nothing, plus a `TAB_HIDDEN` or `FOCUS_LOST` incident, merged once. Record exactly which.
4. **Long gap**: lock or sleep the tablet for 3 minutes, unlock. Expect a counted `long_gap` unless it overlaps a hidden-tab incident, in which case `overlap`.
5. **Page-hide beacon**: trigger an instant event and immediately close the tab. Expect the event to arrive anyway (check H2 after a few seconds).
6. **Back to the exam** after each: the exam is usable, answers are intact, the timer is correct.

## D3. Cross-device check

Log in as the same candidate on laptop 2 while the tablet is in the exam. Expect `MULTI_LOGIN`. In waiting it should be uncounted, and in the exam counted. The older session is revoked and shows the signed-out screen within about 10 s.

---

# Part E. Exit checklist and hand-off to Phase 4

## Phase 3 is done when

- [ ] Part A: guard test steps 1 to 9 pass, tests green, `PHASE-3-STATUS.md` updated
- [ ] Part B: L1 to L6 pass, no deadlock in the Postgres logs, cleanup run
- [ ] Part C: C1 to C8 pass and H3 matched after every step
- [ ] Part D: table filled in, no unexplained event storms, offline queue delivered
- [ ] Phase 2 Run B (sequential navigation and force-end) result recorded
- [ ] Service-role key rotated (the old one was pasted in chat)
- [ ] The service role key used in the worker env is the new one

## Moves to the Phase 4 checklist

- Real camera and microphone tracks: `CAMERA_LOST`, `MIC_LOST`, snapshots on eligible incidents, and the black-frame skip with the camera covered
- Mounted admin grid: `ViolationTimeline`, `CandidateBadge` (neutral/amber/red), `ThresholdControl`, and the single threshold toast
- `useViolationRealtime` with the live list as `initialAttempts`
- Extended display (`MULTI_SCREEN`) on a machine with a second monitor
- Tablet behaviours you recorded in D1 and D2 that need a design decision

## Paste results back in this shape

```
Part A: steps 1-9 pass/fail, exit code in step 3, notes
Part B: L1 inserted/elapsed, L2, L3 elapsed + V2 rows, L4 V1 row, L5, L6; any error text
Part C: any step that did not match, with the H2 rows
Part D: the filled D1 table and D2 results
```
