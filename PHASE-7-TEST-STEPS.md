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

**Status:** Reported passed by the project owner; exact counts, hashes and logs were not recorded. Repeat with recorded evidence during the Phase 8 rehearsal.

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

**Status:** Reported passed by the project owner; exact counts, hashes and logs were not recorded. Repeat with recorded evidence during the Phase 8 rehearsal.

1. Stop the local worker and set `SNAPSHOT_RETENTION_DAYS=0` (then repeat once with it missing).
2. Start the worker.
3. Confirm exactly one `snapshot_purge_disabled` line for that process and no purge RPC/Storage call.
4. Keep it running for at least two lifecycle and two proctoring ticks. Confirm lifecycle, proctoring, health and grading continue normally.
5. Restore `SNAPSHOT_RETENTION_DAYS=14` before any further test.

The 24-hour cadence and non-overlap guard are unit-tested. A real continuous 24-hour run is deferred until hosting is available.

## Part D — Timeline markers

**Status:** Reported passed by the project owner; exact counts, hashes and logs were not recorded. Repeat with recorded evidence during the Phase 8 rehearsal.

1. Open an attempt's violation timeline containing an old eligible snapshot.
2. While a purge claim is held, confirm the event shows **Snapshot cleanup pending**. This state may be too brief to catch manually; if so, leave it unit-test-only rather than changing production timing.
3. After successful deletion, reload the timeline and confirm **Snapshot deleted after 14-day retention** and no broken image control.
4. Confirm a non-purged snapshot still opens normally.

Record these separately from the already verified deletion behavior.

## Part E — Backup and restore drill

**Status:** Reported passed by the project owner; exact counts, hashes and logs were not recorded. The restore target was not recorded, so this does not satisfy the hosted restore rehearsal. Repeat with recorded evidence during the Phase 8 rehearsal.

1. Follow `docs/BACKUP.md` from a clean PowerShell window.
2. Verify the three database files, source row counts, the `question-images` object-root folder, Results CSV, migration copy, commit ID and SHA-256 manifest. Confirm the default archive contains no snapshots.
3. Encrypt with 7-Zip AES-256, test the archive, and copy it to a second location.
4. Restore into a scratch hosted project. If no second active Free-project slot is available, use the documented local Docker fallback.
5. Immediately after extraction, verify the manifest hash and every file hash again. Compare the exact restored counts for the listed key tables with `source-row-counts.csv`.
6. Run the read-only Auth/profile query and confirm every `admin_profiles.user_id` has a matching `auth.users.id`. If it does not, stop and repeat the restore into a clean target; do not rewrite IDs to hide the mismatch.
7. Re-enable missing members of `supabase_realtime`, then verify its exact public-table membership is `alerts`, `attempts`, `exams`, `grading_jobs`, `grading_log`, and `violation_events`.
8. Run `Test/SECTIONS/001_smoke_test.sql` against the restored database and require the final `SMOKE TEST PASSED` result. It rolls back its test data.
9. Verify Results/CSV totals and a known question image at the exact object key recorded from `questions.image_path`. The default drill does not restore or inspect snapshots.
10. Record the date, versions, commit, hashes, counts, Auth check, Realtime list, smoke result, Storage check and pass/fail outside the temporary restore folder. Only then delete the scratch project, or stop the local stack and remove the exact temporary folders.

Optional same-day snapshot safety-copy drill: keep it separate from the long-term archive, verify one still-unexpired snapshot only there, and delete the restored objects plus every copy of the archive the same day. No archive containing snapshots may be kept for 14 days.

## Test-data deletion warning

Deleting an exam cascades its event and purge-queue rows but does not delete Storage objects. After deleting a synthetic exam, use the Storage API or Dashboard to remove `snapshots/<exam_id>/`. Verify the prefix carefully; never delete Storage objects through SQL.

## Deferred until hosted

- Continuous 24-hour purge cadence.
- VPS/systemd restart and crash reclaim.
- Automated backups.
- Hosted restore rehearsal.
- Android B3–B5.
- UptimeRobot.
