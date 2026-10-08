# Section 6 — Infrastructure and operations

Covers: the EC2 box (t3.small), LiveKit and Caddy, the worker service, environment variables, alerts, backups, monitoring, the exam-day runbook (replaces §18 of the old plan) and a failure playbook.

**Verification status.** The config files have been reviewed, every shell script has passed `bash -n`, and the production compose file has been parsed. A narrow Docker Desktop sanity test verified `livekit-client` 2.22.3 publishing camera and microphone over UDP 7882 to LiveKit Server v1.13.7, and a hidden admin-grant subscriber receiving both tracks with the local single-port UDP configuration and `node_ip: 127.0.0.1`. **The stack has not run on your EC2, and the sanity test did not exercise the complete application UI, reconnect/device recovery, TLS, TURN, mobile data or load, so none of those is treated as live deployment evidence.** Items marked *(verify)* depend on AWS, LiveKit, Let's Encrypt, DuckDNS or Supabase behaviour that changes. The rehearsal (Phase 8) is the real proof.

---

## 0. Problems found while writing this section

1. **The single-instance guard can leave the worker dead after a crash or deploy.** Section 5 §7.1 says a new worker exits if `system_health('worker')` has a heartbeat under 60 s old from a different instance. After a crash, systemd restarts the worker after 5 s, and the dead worker's last heartbeat is still under 60 s old. The new worker would exit with code 3, and `RestartPreventExitStatus=3` then stops systemd from trying again. The same happens on every `systemctl restart` and every deploy. Nobody gets an alert, because the alert sender is the worker.
   - **Fix (new rule, goes in 6A.1 and Section 5 §7.1):** when the guard sees a fresh heartbeat from a different instance, it does **not** exit at once. It waits and re-reads `last_heartbeat_at` every 5 s for up to 65 s.
     - If the value never changes, the other worker is dead: take over and continue.
     - If the value advances, another worker is alive: exit with code 3.
   - A graceful stop (SIGTERM) also writes `status = 'down'` to the row (the table only allows `ok`, `degraded` or `down`), and the guard treats `down` as "not alive", so planned restarts take no wait.
   - Test 8.87 covers this.
2. **`pg_dump` version mismatch.** The current Supabase server is PostgreSQL **17.11**. Install and verify PostgreSQL client 17 (or newer); an older `pg_dump` may refuse the backup. Record both `pg_dump --version` and `select version()` in the rehearsal evidence (§8).
3. **`infra/livekit/.env` was missing.** `docker-compose.yml` reads `LIVEKIT_HOST` and `ACME_EMAIL` from it, but no template existed. Added `livekit.env.example`.
4. **No deploy or check script.** Added `deploy-worker.sh` and `check-stack.sh`.
5. **Memory is tight on 2 GB.** The limits add up to LiveKit 900 + Caddy 200 + Redis 100 + worker 400 = 1.6 GB, before the OS and Docker. The 2 GB swap file covers spikes, but heavy swapping during an exam would stall the SFU. See §9 for what to watch and what to cut first.

---

## 1. What lives where

| Piece | Where | Started by |
|---|---|---|
| Next.js app (candidate + admin + API) | Vercel | Git push |
| Postgres, auth, Realtime, `snapshots` bucket | Supabase | — |
| LiveKit, Caddy, Redis | EC2, Docker, host networking, `/opt/exam-livekit` | `docker compose up -d` |
| Worker (scheduler, disconnect rules, grading, heartbeat, key check, snapshot retention, unattached-question-image cleanup) | EC2, systemd, `/opt/exam-worker` | `exam-worker.service` |
| Gemini keys | `/etc/exam-worker.env` only | — |

Repo layout (replaces §14.6 for these folders):

```
infra/
  livekit/   docker-compose.yml  Caddyfile  livekit.yaml.example  livekit.env.example
  ec2/       setup-ec2.sh  deploy-worker.sh  check-stack.sh  backup-db.sh  exam-worker.service
  env/       web.env.example  worker.env.example
```

Never commit `livekit.yaml`, `.env` files, or `/etc/exam-worker.env`.

---

## 2. AWS setup (once)

1. **Launch** Ubuntu Server 24.04 LTS, `t3.small`, 20 GB gp3 disk. Create a key pair (`.pem`) and keep it safe.
2. **Elastic IP:** allocate one and associate it with the instance. Without it the public IP changes when the instance stops, and the DuckDNS name and certificate break.
3. **Security group** (inbound):

| Port | Protocol | Source | Used for |
|---|---|---|---|
| 22 | TCP | your IP only | SSH (Tabby) |
| 80 | TCP | anywhere | Let's Encrypt certificate checks and renewal |
| 443 | TCP | anywhere | LiveKit signalling through Caddy |
| 7881 | TCP | anywhere | LiveKit ICE/TCP fallback |
| 3478 | UDP | anywhere | TURN |
| 50000–60000 | UDP | anywhere | LiveKit media |

   Check these against the current LiveKit deployment docs *(verify)*. Do **not** open 7880 or 6379. LiveKit signalling and Redis listen on `127.0.0.1` only.
4. **SSH from your IP only:** if your home or office IP changes, you are locked out. Keep the AWS console open as a fallback (edit the rule, or use EC2 Instance Connect).
5. **DuckDNS:** create `cosmetics.duckdns.org` and point it at the Elastic IP. Creation and DNS pointing are deployment steps; the IP then remains stable:
   `curl "https://www.duckdns.org/update?domains=cosmetics&token=YOUR_TOKEN&ip=ELASTIC_IP"` (it answers `OK`).
6. **CloudWatch:** enable the `CPUCreditBalance` and `CPUUtilization` graphs for the instance. A t3 earns credits at a baseline of 40% of two vCPUs and spends them above that *(verify)*. Check the instance's credit mode: **unlimited** keeps performance but can add charges, **standard** throttles when credits run out.

### Connecting with Tabby

New profile → SSH → host = Elastic IP, user = `ubuntu`, authentication = the `.pem` private key. Tabby's SFTP panel can upload files, but the simplest route is `git clone` on the box. If you do upload files by hand, put them in your home folder and `sudo cp` them into place.

---

## 3. Prepare the box

1. `git clone` the repo into `/home/ubuntu/exam-platform`.
2. `sudo bash infra/ec2/setup-ec2.sh`. It installs Node 22 LTS, Docker, Chrony (time sync), the available PostgreSQL client, rclone, unattended security updates **without automatic reboot**, a 2 GB swap file, a no-login `exam` user, and the folders `/opt/exam-worker`, `/opt/exam-livekit`, `/var/backups/exam`. Before backups, install PostgreSQL client 17 as described in §8 and confirm `pg_dump --version`; the generic Ubuntu client is not accepted as proof. The box stays on UTC on purpose; the app converts Colombo time.
3. Run `bash infra/ec2/check-stack.sh`. Right now it should report the worker and containers as not running. Everything else should be OK.

---

## 4. LiveKit, Caddy, Redis

### 4.0 Local Docker Desktop server

For the Phase 4 local build, copy `infra/livekit/livekit.local.yaml.example` to the ignored `infra/livekit/livekit.local.yaml`, replace its secret, and put the same key and secret in `apps/web/.env.local`. Use `LIVEKIT_URL=ws://localhost:7880` and `NEXT_PUBLIC_LIVEKIT_URL=ws://localhost:7880`, then start `infra/livekit/docker-compose.local.yml`. It pins LiveKit Server v1.13.7 and exposes signalling on TCP 7880, ICE/TCP on 7881 and media on UDP 7882. The local file deliberately uses `node_ip: 127.0.0.1`; it is not the EC2 configuration.

The exact local commands and browser checks are in `PHASE-4-TEST-STEPS.md`. The two Phase 3 prerequisites remain in the root `PHASE-3-FINISH-RUNBOOK.md` and `PHASE-3-LIVE-TEST-STEPS.md`; reference their named parts and steps rather than copying their SQL or operational instructions.

### 4.1 Install

```
sudo cp infra/livekit/docker-compose.yml infra/livekit/Caddyfile /opt/exam-livekit/
sudo cp infra/livekit/livekit.yaml.example /opt/exam-livekit/livekit.yaml
sudo cp infra/livekit/livekit.env.example   /opt/exam-livekit/.env
```

Edit both copies:
- `.env`: set `LIVEKIT_HOST=cosmetics.duckdns.org` and `ACME_EMAIL`.
- `livekit.yaml`: replace `REPLACE_API_KEY: REPLACE_API_SECRET` with a pair from `docker run --rm livekit/livekit-server generate-keys`. Then `sudo chmod 600 /opt/exam-livekit/livekit.yaml`.

Put the same key and secret in the Vercel variables `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.

### 4.2 Start and check

```
cd /opt/exam-livekit && sudo docker compose up -d
sudo docker compose ps
sudo docker compose logs caddy | tail -30     # look for "certificate obtained"
```

- First start takes a minute while Caddy gets the certificate. Ports 80 and 443 must be reachable from the internet and the DuckDNS name must already resolve to the Elastic IP.
- If the log shows rate-limit errors from Let's Encrypt, stop and wait. Do not keep restarting. The `caddy_data` volume keeps the certificate between restarts, so **do not delete volumes** (`docker compose down -v`).
- `curl -I https://cosmetics.duckdns.org` should answer (a LiveKit status or `404`/`200` is fine, a TLS error is not).
- The real test is a browser: the candidate pre-exam check must publish video to the server and the admin grid must show the tile.

### 4.3 TURN and strict networks

TURN/UDP on 3478 is enabled. Browser signalling uses WSS/TLS through Caddy on 443. TURN/TLS is **not enabled** in `livekit.yaml.example`; candidates behind a firewall that blocks UDP instead fall back to ICE/TCP on 7881. Rehearsal must test normal Wi-Fi, mobile data, a restrictive network, ICE selection, TURN/UDP fallback, WSS/TLS, reconnect, camera/microphone recovery, and candidate/admin Realtime behavior. If the real restrictive-network test blocks both UDP and ICE/TCP, add a second hostname and trusted certificate, enable LiveKit `turn.tls_port` (443 when there is no load balancer, per the LiveKit deployment guide), open the matching TCP security-group port, and retest TURN/TLS before declaring LiveKit production-ready. Video failure must not stop the exam itself.

### 4.4 Pinning

`docker-compose.yml` pins LiveKit `v1.13.7`. On 2 Oct 2026 the exact Docker image pulled successfully and reported `livekit-server version 1.13.7`; this proves the published image/tag, not the EC2 network configuration. Pull and run the same pin during rehearsal. After the first successful rehearsal, never change image tags before the real exam.

### 4.5 `use_external_ip`

On EC2 the instance only sees its private address. `use_external_ip: true` makes LiveKit find the public one. If video connects in the admin's browser but not for candidates (or the advertised IP in the logs is the private one), set `use_external_ip: false` and `node_ip: <Elastic IP>`, then restart.

---

## 5. The worker service

Task 2F.5 implements the restart-safe 10-second exam lifecycle scheduler. Phase 3 adds a separate 30-second proctoring lane with its own non-overlap guard, so a slow disconnect pass cannot skip a lifecycle tick. The proctoring lane calls `record_disconnects`, `resolve_disconnects`, and `reverse_recent_disconnects`; each call is isolated and neither lane broadcasts. The single-instance guard (6A.1) and 30-second database heartbeat (6A.6) are locally implemented; production use still requires the guard/crash/takeover checks in §13.

Phase 6 adds a fourth independent grading lane with its own guard and adaptive timer: 30 seconds while idle and 2 seconds while jobs remain, with at most one in-flight call per usable slot and three total. Its key check runs at most every five minutes inside that lane. A slow grading/key call never delays lifecycle, proctoring or health. The explicit `npm run dry-run` and `npm run test:prompt` commands are operator-only and never run at worker startup.

The scheduler logs only state changes and errors, never one routine line per 10-second tick. An unready scheduled exam stays scheduled; its error log contains only the exam ID and missing category names. One failed lifecycle RPC is isolated and does not prevent the other exams or attempts in that tick from being processed.

### 5.1 Environment file

`sudo nano /etc/exam-worker.env`, paste `worker.env.example`, fill in the values, then `sudo chmod 600 /etc/exam-worker.env`. Keep `GEMINI_MODEL=gemini-3.7-flash` and set each key's current free-tier limit in `GEMINI_DAILY_LIMITS`; no quota is hardcoded and no fallback model is configured.

### 5.2 Deploy and update

`bash infra/ec2/deploy-worker.sh` builds the worker as a self-contained Node bundle (use `esbuild`, `tsup`, or an equivalently verified bundler), copies the bundle and required runtime files to `/opt/exam-worker`, installs the systemd unit, and restarts the service. Shared TypeScript imported from outside the worker folder must be included in the bundle.

The worker package must define `npm run test:dist`. That test copies only `dist/` into a newly created empty temporary directory and starts `WORKER_SELF_TEST=1 node dist/index.js` there. Self-test mode must eagerly load the bundled entry point and every shared module, validate a complete set of safe placeholder configuration, make **no network calls**, print `WORKER DIST SELF-TEST PASSED`, and exit 0. A missing module, import outside `dist/`, `MODULE_NOT_FOUND`, timeout, signal, unexpected output, or non-zero exit fails. The test always removes its temporary directory. `deploy-worker.sh` runs it before copying files or restarting systemd, so a failed bundle can never replace the installed worker.

### 5.3 The service file

`exam-worker.service` restarts the worker 5 s after a crash, allows 10 starts in 5 minutes, caps memory at 400 MB (Node heap 256 MB), and runs as the unprivileged `exam` user. **Exit code 3 means "another worker is alive"** and is never restarted, so a stray worker cannot fight the real one.

### 5.4 The guard rule (replaces Section 5 §7.1 step 2)

See §0 item 1. In order:
1. Read `system_health('worker')`.
2. If the row is missing, or `status = 'down'`, or the heartbeat is 60 s or older: continue. (The seed row starts as `down`, so a first start never waits.)
3. Otherwise (a different instance with a fresh heartbeat): poll the row every 5 s for up to 65 s. If `last_heartbeat_at` stays the same, take over. If it changes, exit with code 3.
4. On SIGTERM or SIGINT: write `status = 'down'`, finish the loop iteration, exit 0. In-flight Gemini calls are abandoned. The "reset stuck jobs" step on the next start puts them back to `pending`.

A **laptop** worker pointed at the production database is still rejected by this rule (its heartbeat keeps advancing). Do not run a local worker against production data at all. Use separate Supabase projects or stop the EC2 worker first (§11 item 5).

### 5.5 Day-to-day commands

| Task | Command |
|---|---|
| Status | `systemctl status exam-worker` |
| Live logs | `journalctl -u exam-worker -f` |
| Last 100 lines | `journalctl -u exam-worker -n 100 --no-pager` |
| Restart | `sudo systemctl restart exam-worker` |
| Stopped after exit code 3 | `sudo systemctl reset-failed exam-worker && sudo systemctl start exam-worker` |

Worker logs never contain answers, prompts or keys (Section 5 §7.9). Keep it that way.

---

## 6. Alerts

Operational alerts are rows in the Supabase `alerts` table and appear on the super-admin Health page. The worker inserts/upserts them using the dedup key; the web app reads them through authenticated admin UI. There is no Discord, Telegram, or generic chat webhook configuration.

**Message format:** `[SEVERITY] Exam platform — <what happened>. <what to do>.` Severity is `INFO`, `WARNING` or `CRITICAL`. Never include candidate names, answers or keys. Key labels (`key2`) are fine.

| Dedup key (Section 5 §7.10) | Severity | Text |
|---|---|---|
| `key_disabled:{label}` | CRITICAL | `{label} was rejected by Gemini. Grading continues on the other keys. Replace the key in /etc/exam-worker.env and restart the worker.` |
| `keys_exhausted:{run}` | WARNING | `Gemini quota used up. Grading paused, will resume at {resume_at}.` |
| `model_not_found` | CRITICAL | `Gemini 3.7 Flash was not found. Grading paused. Check GEMINI_MODEL.` |
| `jobs_failed:{run}` | WARNING | `{n} grading jobs failed. Check the results page.` |
| `blocked:{run}` | WARNING | `{n} answers were blocked by Gemini. Override those marks by hand.` |
| `run_done:{run}` | INFO | `Grading finished: {candidates} candidates, {calls} calls, {review} need review, {failed} failed.` |

Worker-level alerts (add to Section 5 §7.10 and 6A.7):

| Dedup key | Severity | When | Text |
|---|---|---|---|
| `worker_started:{instance_id}` | INFO | Every start | `Worker started (instance {short id}).` Insert it as an already-resolved history row (`resolved_at = created_at`): the per-instance key preserves each start without colliding or inflating the active-alert count. |
| `guard_exit` | CRITICAL | Exit code 3 | `A second worker is running; this one exited.` (Sent best-effort before exiting.) |
| `supabase_outage:{outage_started_at}` | CRITICAL | Inserted **after recovery** from 5 minutes or more of consecutive failed database calls | `Supabase was unreachable from {started_at} until {recovered_at} ({duration}). Check the systemd journal and project status.` During the outage the worker writes structured journal entries locally; it cannot insert a Supabase row while Supabase is unreachable. |
| `heartbeat_stale` | CRITICAL | **Not sent by the worker** | See below |

**Who watches the worker?** If the worker is dead, it cannot alert. Three layers:
1. The super admin health page (5C.2) shows the worker as stale when `last_heartbeat_at` is over 90 s old. Keep it open during the exam.
2. Use a free external uptime monitor (UptimeRobot or similar) on the Vercel health route so the owner receives an availability notification if the app or Supabase health query is down *(verify the free plan)*. This is the live notification path during a Supabase outage.
3. For the worker, the Vercel health route should return a non-200 status when the worker heartbeat is stale, so that the same monitor catches a dead worker. Add this to 5C.2.

During setup, insert a harmless test alert and confirm it appears and resolves in the Health page; run the key-break test in rehearsal to see a real in-app alert arrive.

---

## 7. Supabase and Vercel settings

**Supabase**
- Apply reviewed migrations in numeric order and use the phase status files to determine which deltas are still unapplied. For Phase 6, migration 011 is reported applied and migration 012 is written but not yet applied. Never let the application or worker apply migrations automatically.
- Confirm both private buckets exist: `snapshots` and `question-images`. Verify the **4 MiB**/MIME restrictions and candidate image authorization path. The lower cap leaves multipart overhead below Vercel Functions' 4.5 MB payload ceiling.
- Create the admin users and the `admin_profiles` rows (task 1A.6).
- **Free projects pause after inactivity** *(verify)*. Open the dashboard the week before and again the day before the exam. Rehearsal days count as activity, but do not rely on that.
- Use the **session pooler** connection string for backups (§8), not the direct connection.

**Vercel**
- Set the variables in `web.env.example` for **Production only**. `GEMINI_*` must not exist on Vercel.
- `NEXT_PUBLIC_*` values are baked in at build time. After changing one, redeploy.
- `SESSION_SECRET` and `NIC_PEPPER` must **never change** after candidates are imported (the pepper) or during an exam (the session secret logs everyone out). Store both in a password manager now.
- `LIVEKIT_URL` is what the token route returns to the browser. It must be `wss://cosmetics.duckdns.org`.
- After deploying behind Vercel or the Caddy fallback, send a harmless browser write from the public URL and verify `assertSameOrigin()` accepts that public origin and rejects a different origin. If the proxy changes the effective request origin, set `ALLOWED_ORIGINS` to the exact public origin and repeat the check.
- Hobby plan limits and terms *(verify)*. If Vercel is a problem on exam day, the fallback is to host the app on the EC2 behind Caddy. That fallback has never been tested, so decide in the rehearsal whether to keep it.

**Rate limit and the shared IP.** All 23 candidates sit behind one office IP. The per-IP login limit (counting failed attempts only, task 2A.3) must be well above what 23 people can produce in 10 minutes (suggest about 200), while the per-MER limit stays strict (suggest about 5). Check the numbers before the rehearsal.

---

## 8. Backups

`backup-db.sh` dumps the `public` schema in custom format, keeps the newest 14 dumps locally, and optionally copies to Google Drive.

1. Get the **session pooler** URI from the Supabase dashboard (Connect → Session pooler). Put it in `/etc/exam-backup.env` as `SUPABASE_DB_URL=...` (and `RCLONE_REMOTE=gdrive:exam-backups` if you set up rclone), `chmod 600`, owner root.
2. Install PostgreSQL client 17, run `pg_dump --version`, and verify it is compatible with the current PostgreSQL 17.11 server:
   `sudo apt-get install -y postgresql-common && sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh && sudo apt-get install -y postgresql-client-17` *(verify repository instructions during deployment)*.
3. Test once: `sudo bash -c 'set -a; . /etc/exam-backup.env; set +a; bash /home/ubuntu/exam-platform/infra/ec2/backup-db.sh'`.
4. Nightly cron during the exam period: `sudo crontab -e` → `0 20 * * * bash -c 'set -a; . /etc/exam-backup.env; set +a; bash /home/ubuntu/exam-platform/infra/ec2/backup-db.sh' >> /var/log/exam-backup.log 2>&1` (20:00 UTC is 01:30 in Colombo).
5. **Take a manual backup** right before the exam, right after the exam, and before the cleanup script (8.30).
6. **Restore drill (once, in the rehearsal):** restore a dump into a scratch Supabase project with `pg_restore --no-owner --dbname=<url> file.dump` and open the app against it. A backup that was never restored is not known to work.
7. The dump covers the database only. `snapshots` and `question-images` objects are not inside it. Snapshot loss is acceptable after the 14-day retention window; **question images are exam source material and must be backed up separately**. During implementation, configure a private Storage/S3 export for `question-images`, restore it into the scratch project, and verify every restored `questions.image_path` resolves before the rehearsal is accepted.
8. Free Supabase projects have no point-in-time recovery *(verify)*. Database dumps plus the separate question-image export are the recovery set.

---

## 9. Capacity and monitoring (t3.small)

Load estimate (from the old plan): 23 publishers at about 250 kbps is about 6 Mbps in, and three admins subscribing is about 17 Mbps out, about 15 GB for a 2-hour exam *(verify EC2 free data transfer allowance)*.

In the rehearsal, with all candidates connected and 2–3 admins watching, check every 15 minutes:

| Check | Where | Worry if |
|---|---|---|
| Memory and swap | `free -m` | swap used over 500 MB and growing |
| Per-container memory | `sudo docker stats --no-stream` | LiveKit near its 900 MB limit |
| CPU credits | CloudWatch `CPUCreditBalance` | trending to zero within the exam length |
| CPU | `htop` | sustained above 80% |
| Disk | `df -h /` | over 80% |

**If it is too tight, in this order:** (1) lower the candidate video to 240p or 15 fps, (2) tell admins to subscribe to fewer tiles at once, (3) resize to `t3.medium` (stop, change type, start; the Elastic IP and the disk stay) before the real exam. Decide this in the rehearsal, not on the day.

Do not run `npm run build` on the box while an exam is live. Deploys happen the day before.

---

## 10. Exam-day runbook (replaces §18)

**One week before**
- [ ] Rehearsal done; restore drill done; load numbers in §9 recorded
- [ ] Worker single-instance guard (6A.1) and 30-second heartbeat (6A.6) are implemented; guard/crash/takeover and stale-heartbeat tests passed. Production scheduler deployment is blocked until this is checked
- [ ] Supabase dashboard opened (project active); backup cron has run at least once
- [ ] Real candidates assigned; the complete composed question list and examiner answer keys are ready
- [ ] Image tags and `.env` values frozen. No more deploys except fixes found in testing.

**Day before**
- [ ] `bash infra/ec2/check-stack.sh` all OK, certificate expiry is more than 14 days away
- [ ] The worker bundle has been deployed to `/opt/exam-worker`, `npm run test:dist` passed before deployment, and the lifecycle scheduler is running. No real exam may proceed without the worker
- [ ] Health page all green: Supabase, LiveKit, worker heartbeat under 60 s, three Gemini keys active
- [ ] Manual backup taken
- [ ] A test alert reaches the phone that will be watched during the exam
- [ ] Tablet candidates have run the pre-exam check (first-time camera permission prompts happen now)
- [ ] Candidates received: login link, requirements (laptop Chrome or Android Chrome, Guest window, camera, mic, stable internet, no second screen)
- [ ] Browser check by every admin on the machine they will use. Test the speaker toggle.

**30 minutes before**
- [ ] Admins logged in, grid shows everyone *Ready*; fix camera/mic problems
- [ ] Confirm exactly one worker instance is active and its heartbeat advances; do not start a laptop worker against production
- [ ] `check-stack.sh` once more, `journalctl -u exam-worker -n 20` has no errors
- [ ] Super admin has the health page and the alert phone open

**Start**
- [ ] Paper appears at the scheduled time (worker). If not within 60 s, press **Start now**, then see §11 item 1.

**During**
- [ ] Watch violation badges; extend, kick and broadcast as needed
- [ ] Super admin watches the health page and alerts
- [ ] Every 15 minutes: `free -m` and `docker stats` (only if you changed anything or see lag)

**After**
- [ ] All attempts *Submitted* or *Finalized*
- [ ] Manual backup taken
- [ ] Run AI grading. Watch the progress page. Review needs-review items; override where needed.
- [ ] Export PDFs and the summary CSV
- [ ] Afterwards (not before the exam): the test-data cleanup (8.30) is only for rehearsal data. Do **not** run it after the real exam.

---

## 11. Failure playbook

| # | What you see | Do this |
|---|---|---|
| 1 | Exam did not start at the scheduled time | Press **Start now**. Then `systemctl status exam-worker` and the journal. The worker catches up when restarted, because the scheduler works from database state. |
| 2 | Worker dead mid-exam | `sudo systemctl restart exam-worker` (no 60 s wait; see §5.4). Until it is back: no auto-finalize, no `DISCONNECTED` events, no grading. Candidates keep working and saving. Use **Force end** if the time is up. Disconnect gaps during the outage are recorded as soon as the worker is back, and the two-pass rule (Section 4) judges them by `last_seen_at`. |
| 3 | Video tiles missing for everyone | `cd /opt/exam-livekit && sudo docker compose ps` / `logs livekit`. Restart with `sudo docker compose restart livekit`. Candidates see the warning banner; the exam continues. Do not mark anyone down for a server-side outage. |
| 4 | Video missing for one candidate | Ask them to turn the camera back on; check the browser permission. If their network blocks UDP and TCP 7881, they cannot publish (§4.3). Note it for the override. |
| 5 | Worker exits at once with code 3 and stays down | Another worker is alive. Stop any development worker. Then `sudo systemctl reset-failed exam-worker && sudo systemctl start exam-worker`. |
| 6 | Supabase unreachable / paused | Open the dashboard, restore the project. The app and the worker recover without restarting. Candidates' offline queue (IndexedDB) re-sends answers. |
| 7 | Vercel down or slow | Candidates keep their local queue and the exam clock is server-side. Wait; announce by phone or WhatsApp. If it stays down, consider the EC2 fallback only if it was tested. |
| 8 | Many candidates lose login at once | Someone changed `SESSION_SECRET` or redeployed with a different one. Restore the old value and redeploy. |
| 9 | Grading paused (`keys_exhausted`) | It resumes by itself at the stated time. If urgent, add a key. Do not restart the worker. |
| 10 | Grading paused (`model_not_found` or all keys disabled) | Fix `GEMINI_MODEL`, `GEMINI_DAILY_LIMITS`, or the keys in `/etc/exam-worker.env`, restart the worker, then press **Resume** in the admin UI. These do not auto-resume. |
| 11 | Certificate expired or HTTPS fails | `sudo docker compose logs caddy`. Usually DNS or port 80/443. Do not delete volumes. |
| 12 | Disk full | `df -h`; `sudo journalctl --vacuum-size=200M`; remove old dumps in `/var/backups/exam`. |

---

## 12. Edits to make in `implementation-plan.md` and the other files

| # | Where | Edit |
|---|---|---|
| 1 | 0.4 | Point to `infra/env/*.env.example`. Add that `SESSION_SECRET` and `NIC_PEPPER` are stored in a password manager. |
| 2 | 0.8 / §14.6 | Repo layout: add the `infra/ec2` and `infra/env` folders as in §1 above. |
| 3 | 4D.1–4D.6 (EC2 and LiveKit setup tasks; 4D.3 and 4D.4 are the compose and Caddy files) | Point them to Section 6 §2–§4 and to the files in `infra/`. Add: Elastic IP, DuckDNS, security group, `check-stack.sh`. 4A.2 (LiveKit Cloud) stays for local development only. |
| 4 | 6A.1 and Section 5 §7.1 step 2 | Replace the guard with §5.4 (wait and re-read up to 65 s, `down` status on SIGTERM). |
| 5 | 6A.7 and Section 5 §7.10 | Add the in-app database alert format and worker-level alerts from §6; remove Discord/Telegram webhook configuration. |
| 6 | 5C.2 (health route) | Return a non-200 status when the worker heartbeat is over 90 s old, so an external uptime monitor sees a dead worker. |
| 7 | 2A.3 (rate limit) | Already says the 23 candidates share one IP. Just check the numbers: per-IP about 200 failures per 10 minutes, per-MER about 5. Test 8.16 covers it. |
| 8 | 8.12 | The runbook is §10 of this file. Replace §18 references. Add the failure playbook §11. |
| 9 | Test 8.93 | Restore drill (§8 item 6). |
| 10 | Test 8.94 | Capacity check (§9) with all candidates connected, record the numbers. |
| 11 | Phase 4 Done-when | Add: the complete Wi-Fi/mobile/restrictive-network LiveKit matrix in test 8.95 passes, including ICE, TURN, TLS and recovery evidence. |
| 12 | Phase 8 Done-when | Add: restore drill passed; capacity numbers recorded; alert test message received. |

---

## 13. New tests (continue after 8.86)

| # | Test |
|---|---|
| 8.87 | **Guard after crash:** `sudo kill -9` the worker. systemd restarts it. The new instance waits (at most 65 s), sees the heartbeat is not advancing, takes over, and grading and the scheduler continue. Exit code is not 3. |
| 8.88 | **Guard after graceful restart:** `systemctl restart exam-worker` starts without waiting (the old instance wrote `status = 'down'`). |
| 8.89 | **Guard against a live second worker:** start a second worker by hand while the service runs. The second one exits with code 3 after the wait. The service keeps running. |
| 8.90 | **Alert delivery and database outage:** create and resolve a harmless in-app alert, then trigger one real alert (break one key). It reaches the Health page with no key values or candidate names. Separately block worker access to Supabase for over 5 minutes: structured outage entries remain in the journal, the external health check fails during the outage, and one `supabase_outage:{outage_started_at}` history row appears only after connectivity recovers. |
| 8.91 | **Dead worker visible:** stop the worker. Within 90 s the health page shows it stale and the health route returns non-200. |
| 8.92 | **Reboot recovery:** `sudo reboot` the box. LiveKit, Caddy, Redis (`restart: unless-stopped`) and the worker (systemd enabled) all come back with no manual step. Certificate still valid. |
| 8.93 | **Restore drill:** restore the latest dump into a scratch project; the app lists exams and candidates there. |
| 8.94 | **Capacity:** all candidates connected for 30 minutes, three admins subscribed, numbers from §9 recorded, no swap thrash. |
| 8.95 | **LiveKit network matrix:** publish and monitor on normal Wi-Fi, mobile data, and a restrictive network; record ICE candidate selection, TURN/UDP fallback, WSS/TLS through Caddy, reconnect, camera/microphone recovery, and candidate/admin Realtime recovery. The current config does not claim TURN/TLS. If the restrictive network blocks both UDP and ICE/TCP, enable TURN/TLS as in §4.3 and repeat the matrix before marking LiveKit production-ready. |
| 8.96 | **Shared-IP login:** 23 logins from one IP within two minutes all succeed; 6 wrong attempts on one MER are limited. |
| 8.97 | **Public-origin CSRF check:** on the deployed Vercel URL and, if enabled, the Caddy fallback, a harmless browser write from the public origin passes `assertSameOrigin()` and a mismatched origin returns `403 forbidden`. If the proxy changes the effective request origin, set `ALLOWED_ORIGINS` to the exact public origin and repeat before production use. |
