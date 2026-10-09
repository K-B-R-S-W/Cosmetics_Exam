# Phase 7 local verification steps

Date: 9 October 2026. Use synthetic data and the development Supabase project only. Do not run these steps against a real exam.

## Part A — Recorded migration and manual-purge evidence

Already reported by the project owner:

1. Migration 013 applied successfully.
2. `001_smoke_test.sql` ended in `SMOKE TEST PASSED`.
3. Backfill: 46 snapshot references, zero missing `snapshot_captured_at` values.
4. Manual Health-page Check and confirmed Delete removed two eligible snapshots, including a reserved path that had never been uploaded.
5. Recent and live-exam snapshots remained, the audit row held counts only, the queue was empty, and a second Check returned zero.

Do not mark the worker lane or timeline markers live-verified from these results.

## Part B — Worker startup purge

1. Use the development project and synthetic candidates. Stop any other worker connected to that project so the single-instance guard does not reject this process.
2. Prepare an ended or finalized synthetic exam with:
   - one snapshot captured more than 14 days ago;
   - one old event whose reserved `snapshot_path` has no Storage object;
   - one snapshot newer than 14 days;
   - one old snapshot belonging to a live exam.
3. Confirm the old eligible rows are visible to `preview_snapshot_purge`, and record the queue as empty before startup.
4. In `worker/.env` or the process environment, use `SNAPSHOT_RETENTION_DAYS=14` and development-only Supabase/Gemini values. Start the worker once.
5. Confirm the startup lane removes the two eligible references/files, retains the recent and live-exam snapshots, and writes a counts-only `snapshot_purge_completed` log. No path, candidate ID, name, answer, database error text or secret may appear.
6. Stop and start the worker again. With nothing eligible, confirm the purge performs its preview but emits no routine purge log line.
7. Confirm the purge queue is empty. Confirm the event rows remain, `snapshot_path` and `snapshot_captured_at` are null, and `meta.snapshot_deleted_at` is present.

Record:

```text
Part B: date; worker commit; eligible/deleted/failed/remaining counts; queue count; safe-log check; pass/fail
```

## Part C — Lane-only invalid configuration

1. Stop the local worker and set `SNAPSHOT_RETENTION_DAYS=0` (then repeat once with it missing).
2. Start the worker.
3. Confirm exactly one `snapshot_purge_disabled` line for that process and no purge RPC/Storage call.
4. Keep it running for at least two lifecycle and two proctoring ticks. Confirm lifecycle, proctoring, health and grading continue normally.
5. Restore `SNAPSHOT_RETENTION_DAYS=14` before any further test.

The 24-hour cadence and non-overlap guard are unit-tested. A real continuous 24-hour run is deferred until hosting is available.

## Part D — Timeline markers

1. Open an attempt's violation timeline containing an old eligible snapshot.
2. While a purge claim is held, confirm the event shows **Snapshot cleanup pending**. This state may be too brief to catch manually; if so, leave it unit-test-only rather than changing production timing.
3. After successful deletion, reload the timeline and confirm **Snapshot deleted after 14-day retention** and no broken image control.
4. Confirm a non-purged snapshot still opens normally.

Record these separately from the already verified deletion behavior.

## Part E — Backup and restore drill

1. Follow `docs/BACKUP.md` from a clean PowerShell window.
2. Verify the three database files, both Storage folders, Results CSV, migration copy, commit ID and SHA-256 manifest.
3. Encrypt with 7-Zip AES-256, test the archive, and copy it to a second location.
4. Restore into a scratch hosted project. If no second active Free-project slot is available, use the documented local Docker fallback.
5. Verify representative candidate/exam/result counts, a question image, an unexpired snapshot and the CSV totals.
6. Delete the scratch project or stop and remove the exact local restore directory after recording the result.

## Test-data deletion warning

Deleting an exam cascades its event and purge-queue rows but does not delete Storage objects. After deleting a synthetic exam, use the Storage API or Dashboard to remove `snapshots/<exam_id>/`. Verify the prefix carefully; never delete Storage objects through SQL.

## Deferred until hosted

- Continuous 24-hour purge cadence and restart/crash reclaim.
- Scheduled encrypted backups and off-host copy/alerting.
- VPS-specific paths and service account.
- Android B3–B5 and other hosting-dependent checks.
