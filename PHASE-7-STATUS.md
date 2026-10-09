# Phase 7 status — results, print and retention

Date: 9 October 2026.

## Status

- Results summary, CSV export and per-candidate print/PDF are locally implemented and were reviewed in the preceding Phase 7 commits.
- Migration 013 is applied to the development Supabase project. Its full smoke test passed, and the reported backfill check found 46 snapshot references with zero missing capture timestamps.
- The manual super-admin purge was live-verified against Supabase: two eligible snapshots were removed, including a reserved path that was never uploaded; recent and live-exam snapshots remained; the audit contained counts only; the queue was empty; and a second Check returned zero.
- Timeline “cleanup pending” and “deleted after 14-day retention” markers are unit-tested only and have not yet been observed with live data.
- The worker daily purge lane is locally implemented and unit-tested. It is **not live-verified** against Supabase and has not completed a real 24-hour interval.

## Worker purge lane

- Independent from lifecycle, proctoring, health and grading, with its own running guard.
- Runs once at worker startup and then every 24 hours.
- Calls the same shared orchestrator as the super-admin route, with the exact configured 14-day retention, 100-object batches and a 20-second run budget.
- Missing or invalid `SNAPSHOT_RETENTION_DAYS` disables only this lane. It performs no database or Storage call and emits one safe change-only `snapshot_purge_disabled` error per process.
- Idle runs produce no log line. Successful changes log counts only. Identical failures are suppressed until their safe error code/count fingerprint changes, and recovery is logged once.
- No candidate identifiers, object paths, row contents, request data, secrets or Storage/DB error text are logged.
- Shutdown and guard-exit stop the purge timer with the other process-owned lanes. A running Storage/RPC operation is not force-cancelled; process shutdown still terminates it, and migration 013's lease makes a later run reclaimable.
- The lane boundary catches an unexpected rejected tick defensively, clears its running guard and permits the next scheduled run; this prevents a fire-and-forget timer from producing an unhandled rejection or leaving the lane stuck.

## Database and Storage call profile

- Invalid retention: zero database calls and zero Storage calls.
- Idle startup/daily pass: one `preview_snapshot_purge` RPC; zero writes and zero Storage calls.
- One non-full successful batch: initial preview + claim RPC + finish RPC + final preview = four database RPCs, plus one Storage `remove` call.
- Each additional batch adds one claim RPC, one finish RPC and one Storage `remove`. A full 100-row batch may add one empty claim RPC before the final preview.
- Partial Storage responses add one `exists` HEAD request for each unconfirmed path, at most 100 per batch. Confirmed, absent and failed event IDs are reconciled in one finish RPC.
- The lane runs only at startup and once per 24 hours, so it adds no per-minute idle traffic after the startup preview.

## Verification boundary

Unit tests prove scheduling, non-overlap, lane isolation, configuration failure, safe logging and calls into the mocked shared orchestrator. The web orchestrator tests cover path validation, leases/RPC shapes, batching, time budget and partial Storage reconciliation. These tests do not prove real timers over 24 hours, Supabase RPC transactions, Storage responses, process-crash reclaim or concurrent workers.

Awaiting local live verification:

- Worker startup purge against the development project.
- Idle second startup with no routine log line.
- Invalid-retention startup with the other worker lanes continuing.
- Live timeline markers after a real queued/deleted event.
- The documented encrypted backup and either the hosted-scratch or local-Docker restore drill, including hashes, counts, Auth, Realtime, smoke and exact question-image checks.

Deferred until hosting:

- A continuous 24-hour cadence observation.
- VPS/systemd restart and crash-reclaim observation.
- Automated backups and hosted restore rehearsal.
- Android B3–B5 and other hosting-dependent checks.

## Backup status

`docs/BACKUP.md` contains the manual Windows PowerShell database and durable `question-images` backup, hashing, AES-256 encryption, hosted scratch restore and local Docker fallback. Long-kept archives deliberately exclude snapshots to preserve the exact 14-day retention promise. A separate optional same-day snapshot safety copy has a same-day deletion rule and a hard 14-day ceiling. Both restore paths now require extracted-manifest verification, key-table count comparison, Auth/admin-profile matching, exact Realtime publication verification, the rollback-wrapped smoke test and a known question-image path check before the drill result is recorded and temporary resources are deleted. The commands are documented but were not executed in this commit. `infra/ec2/backup-db.sh` remains unchanged and is explicitly classified as a public-schema-only partial backup with no Storage export.
