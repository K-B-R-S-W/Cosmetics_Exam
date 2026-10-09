# Backup and restore runbook

Last checked against the Supabase documentation: 9 October 2026.

This is a manual Windows PowerShell runbook. Run it before the real exam, immediately after the exam and grading are complete, and before any destructive test or project change. Keep the encrypted archive in two places, with at least one copy off the PC used for the exam.

## What the backup contains

Keep all of these together:

- PostgreSQL roles, schema and data. This includes candidates, attempts, paper assignments, answers, violation events, scores, results, audits and grading state.
- The private `question-images` Storage bucket. It is durable exam content and belongs in the long-kept backup.
- The Git commit ID and the checked-in `supabase/migrations` directory.
- A human-readable CSV export from Admin > Results after finalization.
- A separate, protected record of the configuration and secrets listed below.

The `snapshots` bucket is deliberately excluded from every long-kept backup. Copying it into an ordinary archive would extend proctoring-image retention beyond the promised 14 days. The optional same-day safety-copy procedure below is the only exception; keep that copy separate and delete it the same day (the absolute limit is 14 days). LiveKit rooms, Redis state, signed URLs, browser sessions, worker leases and generated build output are disposable runtime state. They are not restored.

Deleting an exam cascades its database events and snapshot-purge queue rows, but it does **not** remove objects from Storage. When deleting test data, also remove `snapshots/<exam_id>/` through the Storage API or Supabase Dashboard. Never delete Storage metadata with SQL.

## Current Free-plan facts

As documented by Supabase on 9 October 2026:

- An account can use two active Free projects across organizations where it is an Owner or Administrator. Paused projects do not count toward that limit.
- A Free project with low activity over a seven-day period may be paused. Supabase does not promise an exact query threshold; a paused project can currently be restored from the Dashboard for up to one year.
- Automatic daily database backups are documented for Pro, Team and Enterprise, not Free. Supabase recommends regular CLI dumps for Free projects.
- A database backup contains Storage metadata, not the actual Storage objects. Export `question-images` separately; do not add `snapshots` to the long-kept archive.
- Current Free quotas list 500 MB database size and 1 GB Storage per project. Check the pricing/billing page again before the real exam because limits can change.

What cannot be guaranteed from the documentation: that this account will have a spare Free-project slot on restore day, the exact activity level that prevents pausing, or that experimental CLI Storage commands will keep the same flags. Run `supabase storage cp --help` before each backup. If no hosted scratch slot is available, use the local Docker restore drill below.

Official references:

- <https://supabase.com/docs/guides/platform/backups>
- <https://supabase.com/docs/guides/platform/free-project-pausing>
- <https://supabase.com/docs/guides/platform/billing-on-supabase>
- <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>
- <https://supabase.com/docs/guides/storage/management/download-objects>
- <https://supabase.com/docs/reference/cli/global-flags#supabase-storage-cp>
- <https://supabase.com/docs/guides/platform/clone-project>
- <https://supabase.com/docs/guides/realtime/postgres-changes>

## Tools and install check

Docker Desktop must be running. Use the stable Supabase CLI, PostgreSQL client at least as new as the hosted server, Git and 7-Zip.

```powershell
supabase --version
supabase db dump --help
supabase storage cp --help
docker version
psql --version
pg_dump --version
git --version
& "$env:ProgramFiles\7-Zip\7z.exe" i | Select-Object -First 5
```

If `supabase` is missing, follow the current official Windows installation page. A project-local alternative is `npm install --save-dev supabase` followed by `npx supabase ...`; pin the installed version if that option is used. Do not install it globally with `npm -g`.

## Create a backup

### 1. Prepare an isolated folder

Run from the repository root:

```powershell
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupRoot = Join-Path $env:USERPROFILE "Documents\CosmeticsExamBackups\$Stamp"
$CliWork = Join-Path $BackupRoot '_cli'
New-Item -ItemType Directory -Force -Path $BackupRoot,$CliWork | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $BackupRoot 'database') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $BackupRoot 'storage\question-images') | Out-Null
git rev-parse HEAD | Set-Content -LiteralPath (Join-Path $BackupRoot 'repo-commit.txt') -Encoding utf8
Copy-Item -Recurse -LiteralPath 'supabase\migrations' -Destination (Join-Path $BackupRoot 'migrations')
```

### 2. Dump roles, schema and data

In Supabase Dashboard, use Connect > Session pooler and copy the PostgreSQL connection string. Percent-encode special characters in the password. The secure prompt below keeps the URL out of PowerShell history, though any command-line database tool can expose its arguments briefly to local administrators.

```powershell
$SecureDbUrl = Read-Host 'Paste the source database URL' -AsSecureString
$Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureDbUrl)
try {
  $DbUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer)
  supabase db dump --db-url $DbUrl -f (Join-Path $BackupRoot 'database\roles.sql') --role-only
  if ($LASTEXITCODE -ne 0) { throw 'roles dump failed' }
  supabase db dump --db-url $DbUrl -f (Join-Path $BackupRoot 'database\schema.sql')
  if ($LASTEXITCODE -ne 0) { throw 'schema dump failed' }
  supabase db dump --db-url $DbUrl -f (Join-Path $BackupRoot 'database\data.sql') --use-copy --data-only -x 'storage.buckets_vectors' -x 'storage.vector_indexes'
  if ($LASTEXITCODE -ne 0) { throw 'data dump failed' }

  $RowCountSql = @'
select 'admin_profiles' as table_name, count(*) as row_count from public.admin_profiles
union all select 'candidates', count(*) from public.candidates
union all select 'exams', count(*) from public.exams
union all select 'questions', count(*) from public.questions
union all select 'mcq_options', count(*) from public.mcq_options
union all select 'attempts', count(*) from public.attempts
union all select 'attempt_questions', count(*) from public.attempt_questions
union all select 'answers', count(*) from public.answers
union all select 'violation_events', count(*) from public.violation_events
union all select 'question_scores', count(*) from public.question_scores
union all select 'results', count(*) from public.results
union all select 'admin_actions', count(*) from public.admin_actions
order by table_name;
'@
  psql --dbname $DbUrl --csv --command $RowCountSql |
    Set-Content -LiteralPath (Join-Path $BackupRoot 'source-row-counts.csv') -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw 'source row-count capture failed' }

  $KnownQuestionImagePath = psql --dbname $DbUrl --tuples-only --no-align --command `
    "select image_path from public.questions where image_path is not null order by id limit 1;" |
    Select-Object -First 1
  if ($LASTEXITCODE -ne 0) { throw 'question-image path lookup failed' }
  $KnownQuestionImagePath = if ($null -eq $KnownQuestionImagePath) { '' } else { $KnownQuestionImagePath.Trim() }
  $KnownQuestionImagePath |
    Set-Content -LiteralPath (Join-Path $BackupRoot 'known-question-image-path.txt') -Encoding utf8
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer)
  $DbUrl = $null
  $SecureDbUrl = $null
}
```

### 3. Export durable Storage

The Storage CLI commands are currently marked experimental. Supabase CLI 2.111.0 help and the current CLI reference define `cp -r ss:///bucket/path .` as a recursive directory download and `cp -r local-folder ss:///bucket/path` as the corresponding upload. They do not explicitly promise, in prose, whether a future CLI will preserve the source directory basename. This runbook therefore treats `storage\question-images` as the bucket's object root and verifies a real database object path after every transfer. The required archive layout is:

```text
storage/
  question-images/
    <each object key exactly as stored in questions.image_path>
```

There must not be a second `question-images` directory below that root. First authenticate and link from the isolated working folder. Never paste an access token into a script or commit it.

```powershell
$ProjectRef = Read-Host 'Source Supabase project ref'
Push-Location $CliWork
try {
  supabase init
  supabase login
  supabase link --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) { throw 'Supabase link failed' }

  Push-Location (Join-Path $BackupRoot 'storage\question-images')
  try { supabase storage cp -r 'ss:///question-images' . --experimental --linked } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw 'question-images export failed' }
} finally {
  Pop-Location
}
Remove-Item -Recurse -Force -LiteralPath $CliWork

$QuestionImagesRoot = Join-Path $BackupRoot 'storage\question-images'
$KnownQuestionImagePath = (Get-Content -LiteralPath (Join-Path $BackupRoot 'known-question-image-path.txt') -Raw).Trim()
if (Test-Path -LiteralPath (Join-Path $QuestionImagesRoot 'question-images')) {
  throw 'Unexpected double-nested question-images folder; inspect CLI output before continuing'
}
if ($KnownQuestionImagePath) {
  $KnownQuestionImageFile = Join-Path $QuestionImagesRoot ($KnownQuestionImagePath.Replace('/', '\'))
  if (-not (Test-Path -LiteralPath $KnownQuestionImageFile -PathType Leaf)) {
    throw "Known question image is not at its exact object-key path: $KnownQuestionImagePath"
  }
} else {
  Write-Warning 'No question has an image_path; record the known-object export check as not applicable.'
}
```

Open Admin > Results, select the exam, export the CSV, and copy it into `$BackupRoot`. The CSV is a second, human-readable results copy; it does not replace the database dump.

### 4. Hash and encrypt

Create a manifest before archiving. Keep the manifest's own hash separately so it can be checked immediately after extraction:

```powershell
$Manifest = Join-Path $BackupRoot 'manifest.csv'
Get-ChildItem -LiteralPath $BackupRoot -Recurse -File |
  Where-Object FullName -ne $Manifest |
  Get-FileHash -Algorithm SHA256 |
  Select-Object @{Name='Path';Expression={$_.Path.Substring($BackupRoot.Length + 1)}},Hash |
  Export-Csv -LiteralPath $Manifest -NoTypeInformation -Encoding utf8
(Get-FileHash -LiteralPath $Manifest -Algorithm SHA256).Hash |
  Set-Content -LiteralPath (Join-Path $BackupRoot 'manifest.sha256.txt') -Encoding ascii
```

Create an AES-256 encrypted 7-Zip archive. `-p` prompts for the password and `-mhe=on` encrypts file names. Store the password in a password manager, not beside the archive.

```powershell
$SevenZip = "$env:ProgramFiles\7-Zip\7z.exe"
$Archive = "$BackupRoot.7z"
& $SevenZip a -t7z -mhe=on -p $Archive "$BackupRoot\*"
if ($LASTEXITCODE -ne 0) { throw '7-Zip archive failed' }
& $SevenZip t -p $Archive
if ($LASTEXITCODE -ne 0) { throw '7-Zip verification failed' }
Get-FileHash -LiteralPath $Archive -Algorithm SHA256
```

After verifying both encrypted copies, securely remove the unencrypted backup folder. Do not use a broad or variable recursive delete unless `$BackupRoot` has been manually checked.

### Optional same-day snapshot safety copy

This is not part of the long-term backup. Use it only for a same-day operation that genuinely requires a short-lived rollback copy. Keep it in a separate encrypted archive, record its expiry, and delete every copy before midnight on the day it was created. An archive containing snapshots must never survive for 14 days, even if a copied snapshot was already close to its retention deadline.

The local bucket root is `storage\snapshots`. Because every stored snapshot key is already `snapshots/<exam_id>/<attempt_id>/<event_id>.jpg`, the resulting exact layout is `storage\snapshots\snapshots\<exam_id>\<attempt_id>\<event_id>.jpg`; do not strip that first key segment.

```powershell
$SnapshotStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$SnapshotSafetyRoot = Join-Path $env:USERPROFILE "Documents\CosmeticsExamSnapshotSafety\$SnapshotStamp"
$SnapshotObjectRoot = Join-Path $SnapshotSafetyRoot 'storage\snapshots'
$SnapshotCli = Join-Path $SnapshotSafetyRoot '_cli'
New-Item -ItemType Directory -Force -Path $SnapshotObjectRoot,$SnapshotCli | Out-Null
"Delete every copy before $((Get-Date).Date.AddDays(1).ToString('o')); absolute maximum 14 days." |
  Set-Content -LiteralPath (Join-Path $SnapshotSafetyRoot 'DELETE-BY.txt') -Encoding utf8

Push-Location $SnapshotCli
try {
  supabase init
  supabase link --project-ref $ProjectRef
  Push-Location $SnapshotObjectRoot
  try { supabase storage cp -r 'ss:///snapshots' . --experimental --linked } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw 'snapshot safety export failed' }
} finally {
  Pop-Location
}

$SnapshotArchive = "$SnapshotSafetyRoot.7z"
& $SevenZip a -t7z -mhe=on -p $SnapshotArchive "$SnapshotSafetyRoot\*"
if ($LASTEXITCODE -ne 0) { throw 'snapshot safety archive failed' }
& $SevenZip t -p $SnapshotArchive
if ($LASTEXITCODE -ne 0) { throw 'snapshot safety archive verification failed' }
```

If this optional copy is restored during its same-day window, upload the local `storage\snapshots` directory to `ss:///snapshots` using the same source-root/destination-root pattern as `question-images`, verify one still-unexpired snapshot, then delete the restored test objects and every local/archive copy. Never merge this folder into `$BackupRoot`.

## Secrets to preserve separately

Store the actual values in a password manager or a separately encrypted operator record. Never commit them:

- `SESSION_SECRET` and `NIC_PEPPER` — these must not change while imported candidates must still authenticate.
- Supabase project URL, anon/publishable key, service-role key, project ref and database password.
- LiveKit URL, API key and API secret.
- Gemini keys, labels and daily limits.
- `ALLOWED_ORIGINS` and `SNAPSHOT_RETENTION_DAYS=14`.
- Future hosted values such as the LiveKit hostname, certificate contact and DNS credentials. **To be filled in after hosting is chosen.**

Do not copy `.env.local`, `/etc/exam-worker.env`, access tokens or plaintext credentials into Git.

## Restore drill into a scratch Supabase project

Use synthetic/dev data only. Never point the restore commands at the real project. Create a new scratch project if a Free slot is available, copy its Session pooler URL, and use a new isolated CLI folder.

```powershell
$ExtractRoot = Read-Host 'Path to the extracted backup folder'
$Manifest = Join-Path $ExtractRoot 'manifest.csv'
$ExpectedManifestHash = (Get-Content -LiteralPath (Join-Path $ExtractRoot 'manifest.sha256.txt') -Raw).Trim()
$ActualManifestHash = (Get-FileHash -LiteralPath $Manifest -Algorithm SHA256).Hash
if ($ActualManifestHash -ne $ExpectedManifestHash) { throw 'Extracted manifest hash mismatch' }
$BadFiles = @(Import-Csv -LiteralPath $Manifest | Where-Object {
  $File = Join-Path $ExtractRoot $_.Path
  (-not (Test-Path -LiteralPath $File -PathType Leaf)) -or
    ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ne $_.Hash)
})
if ($BadFiles.Count -ne 0) { throw "Extracted backup has $($BadFiles.Count) missing or changed file(s)" }
$CountTables = @('admin_profiles','candidates','exams','questions','mcq_options','attempts','attempt_questions','answers','violation_events','question_scores','results','admin_actions')
$RowCountSql = (($CountTables | ForEach-Object {
  "select '$($_)' as table_name, count(*) as row_count from public.$($_)"
}) -join "`nunion all ") + "`norder by table_name;"

$ScratchRef = Read-Host 'Scratch project ref'
$ScratchSecureUrl = Read-Host 'Scratch database URL' -AsSecureString
$ScratchPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ScratchSecureUrl)
try {
  $ScratchDbUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ScratchPointer)
  psql --single-transaction --variable ON_ERROR_STOP=1 `
    --file (Join-Path $ExtractRoot 'database\roles.sql') `
    --file (Join-Path $ExtractRoot 'database\schema.sql') `
    --command 'SET session_replication_role = replica' `
    --file (Join-Path $ExtractRoot 'database\data.sql') `
    --dbname $ScratchDbUrl
  if ($LASTEXITCODE -ne 0) { throw 'database restore failed' }

  $RealtimeSql = @'
do $$
declare v_table text;
begin
  foreach v_table in array array['attempts','violation_events','grading_jobs','grading_log','alerts','exams'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;
'@
  psql --dbname $ScratchDbUrl --variable ON_ERROR_STOP=1 --command $RealtimeSql
  if ($LASTEXITCODE -ne 0) { throw 'Realtime publication repair failed' }
  $RealtimeActual = @(psql --dbname $ScratchDbUrl --tuples-only --no-align --command `
    "select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' order by tablename;")
  $RealtimeExpected = @('alerts','attempts','exams','grading_jobs','grading_log','violation_events')
  if (Compare-Object $RealtimeExpected $RealtimeActual) { throw 'Realtime publication membership mismatch' }

  $AdminMismatchSql = @'
select ap.user_id, ap.display_name, 'missing_auth_user' as problem
  from public.admin_profiles ap
  left join auth.users au on au.id = ap.user_id
 where au.id is null
 order by ap.user_id;
'@
  $AdminMismatches = @(psql --dbname $ScratchDbUrl --tuples-only --no-align --command $AdminMismatchSql)
  if ($AdminMismatches.Count -ne 0) { throw 'One or more admin_profiles rows have no matching auth.users row' }

  psql --dbname $ScratchDbUrl --csv --command $RowCountSql |
    Set-Content -LiteralPath (Join-Path $ExtractRoot 'restored-row-counts.csv') -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw 'restored row-count capture failed' }
  $SourceCounts = Import-Csv -LiteralPath (Join-Path $ExtractRoot 'source-row-counts.csv')
  $RestoredCounts = Import-Csv -LiteralPath (Join-Path $ExtractRoot 'restored-row-counts.csv')
  if (Compare-Object $SourceCounts $RestoredCounts -Property table_name,row_count) {
    throw 'Restored key-table row counts differ from the source'
  }

  psql --dbname $ScratchDbUrl --variable ON_ERROR_STOP=1 `
    --file (Resolve-Path 'Test\SECTIONS\001_smoke_test.sql')
  if ($LASTEXITCODE -ne 0) { throw 'restored-database smoke test failed' }

  $ScratchCli = Join-Path $env:TEMP "cosmetics-exam-restore-$([guid]::NewGuid())"
  New-Item -ItemType Directory -Force -Path $ScratchCli | Out-Null
  Push-Location $ScratchCli
  try {
    supabase init
    supabase link --project-ref $ScratchRef
    Push-Location (Join-Path $ExtractRoot 'storage\question-images')
    try { supabase storage cp -r . 'ss:///question-images' --experimental --linked } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'question-images restore failed' }
  } finally {
    Pop-Location
  }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ScratchPointer)
  $ScratchDbUrl = $null
  $ScratchSecureUrl = $null
}
```

The exact Realtime check above must return only these six public tables: `alerts`, `attempts`, `exams`, `grading_jobs`, `grading_log`, and `violation_events`. Supabase documents that Realtime settings need manual reconfiguration after cloning; the `DO` block restores any missing member without duplicating an existing one. If the read-only Auth check returns rows, do not use or delete the scratch project yet: confirm the `auth` schema was included, repeat the full restore into a clean scratch project, and recheck. For a real disaster recovery where a repeat restore cannot repair it, create a replacement admin in Supabase Auth and add a reviewed `admin_profiles` row for its new UUID; never silently repoint an existing profile.

Point a local web instance at the scratch project using new scratch-only secrets. Verify admin login, representative candidates/exams/results and CSV totals. Verify a question image at its exact object path; the default drill has no snapshot check because snapshots are not in the long-term archive. Confirm the smoke-test result grid ends with `SMOKE TEST PASSED`. Do not send email, start a real exam or invoke Gemini during the drill.

Record the date, source commit, CLI/PostgreSQL versions, manifest result, row-count comparison, Auth check, Realtime table list, smoke result, question-image check and pass/fail in a drill record outside `$ExtractRoot`. Only after that record is safe, delete the scratch project in the Dashboard, verify `$ScratchCli` and `$ExtractRoot` are the intended temporary paths, and remove those exact folders. If the optional same-day snapshot copy was used, verify one unexpired snapshot only in that optional drill and delete the scratch objects and all snapshot-copy archives the same day.

## Local Docker restore fallback

If both active Free slots are occupied, restore into a local Supabase stack. Docker Desktop must be running. This stack is for verification only and must not be exposed to the network.

```powershell
$ExtractRoot = Read-Host 'Path to the extracted backup folder'
$Manifest = Join-Path $ExtractRoot 'manifest.csv'
$ExpectedManifestHash = (Get-Content -LiteralPath (Join-Path $ExtractRoot 'manifest.sha256.txt') -Raw).Trim()
$ActualManifestHash = (Get-FileHash -LiteralPath $Manifest -Algorithm SHA256).Hash
if ($ActualManifestHash -ne $ExpectedManifestHash) { throw 'Extracted manifest hash mismatch' }
$BadFiles = @(Import-Csv -LiteralPath $Manifest | Where-Object {
  $File = Join-Path $ExtractRoot $_.Path
  (-not (Test-Path -LiteralPath $File -PathType Leaf)) -or
    ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ne $_.Hash)
})
if ($BadFiles.Count -ne 0) { throw "Extracted backup has $($BadFiles.Count) missing or changed file(s)" }
$CountTables = @('admin_profiles','candidates','exams','questions','mcq_options','attempts','attempt_questions','answers','violation_events','question_scores','results','admin_actions')
$RowCountSql = (($CountTables | ForEach-Object {
  "select '$($_)' as table_name, count(*) as row_count from public.$($_)"
}) -join "`nunion all ") + "`norder by table_name;"

$LocalRestore = Join-Path $env:TEMP "cosmetics-exam-local-restore-$([guid]::NewGuid())"
New-Item -ItemType Directory -Force -Path $LocalRestore | Out-Null
Push-Location $LocalRestore
try {
  supabase init
  supabase start
  $LocalDbUrl = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  psql --single-transaction --variable ON_ERROR_STOP=1 `
    --file (Join-Path $ExtractRoot 'database\roles.sql') `
    --file (Join-Path $ExtractRoot 'database\schema.sql') `
    --command 'SET session_replication_role = replica' `
    --file (Join-Path $ExtractRoot 'database\data.sql') `
    --dbname $LocalDbUrl
  if ($LASTEXITCODE -ne 0) { throw 'local database restore failed' }

  $RealtimeSql = @'
do $$
declare v_table text;
begin
  foreach v_table in array array['attempts','violation_events','grading_jobs','grading_log','alerts','exams'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;
'@
  psql --dbname $LocalDbUrl --variable ON_ERROR_STOP=1 --command $RealtimeSql
  $RealtimeActual = @(psql --dbname $LocalDbUrl --tuples-only --no-align --command `
    "select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' order by tablename;")
  $RealtimeExpected = @('alerts','attempts','exams','grading_jobs','grading_log','violation_events')
  if (Compare-Object $RealtimeExpected $RealtimeActual) { throw 'Realtime publication membership mismatch' }

  $AdminMismatches = @(psql --dbname $LocalDbUrl --tuples-only --no-align --command `
    "select ap.user_id from public.admin_profiles ap left join auth.users au on au.id=ap.user_id where au.id is null order by ap.user_id;")
  if ($AdminMismatches.Count -ne 0) { throw 'One or more admin_profiles rows have no matching auth.users row' }

  psql --dbname $LocalDbUrl --csv --command $RowCountSql |
    Set-Content -LiteralPath (Join-Path $ExtractRoot 'local-restored-row-counts.csv') -Encoding utf8
  $SourceCounts = Import-Csv -LiteralPath (Join-Path $ExtractRoot 'source-row-counts.csv')
  $RestoredCounts = Import-Csv -LiteralPath (Join-Path $ExtractRoot 'local-restored-row-counts.csv')
  if (Compare-Object $SourceCounts $RestoredCounts -Property table_name,row_count) {
    throw 'Local restored key-table row counts differ from the source'
  }

  psql --dbname $LocalDbUrl --variable ON_ERROR_STOP=1 `
    --file (Resolve-Path 'Test\SECTIONS\001_smoke_test.sql')
  if ($LASTEXITCODE -ne 0) { throw 'local restored-database smoke test failed' }

  Push-Location (Join-Path $ExtractRoot 'storage\question-images')
  try { supabase storage cp -r . 'ss:///question-images' --experimental --local } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw 'local question-images restore failed' }
  supabase status
} finally {
  Pop-Location
}
```

Inspect the local Studio URL printed by `supabase status`, verify the six-table Realtime list, Auth/profile match, row counts, `SMOKE TEST PASSED`, Results totals and a question image at its exact object path. If the Auth check fails, stop the drill and repeat the restore into a fresh local stack; do not rewrite IDs merely to make the check pass. Record the result outside `$LocalRestore` and `$ExtractRoot` first. Then return to `$LocalRestore`, run `supabase stop --no-backup`, verify both paths are the intended temporary folders, and remove those exact directories. The default local drill does not restore or inspect snapshots; that check belongs only to the optional same-day path.

## When to back up

### Before the real exam

1. Make a complete encrypted backup and restore-test it.
2. Record CLI, PostgreSQL client and Git versions plus the repository commit.
3. Confirm `question-images` was exported at the exact object-key layout and the manifest verifies; confirm no snapshots are in the archive.
4. Confirm the password manager holds the unchanged `SESSION_SECRET` and `NIC_PEPPER`.
5. Keep the prior known-good backup until the exam and grading are complete.

### Immediately after the exam

1. Wait for all attempts to finalize and grading/review to finish.
2. Export the Results CSV.
3. Make and verify a new complete encrypted backup before cleanup or retention deletion.
4. Copy the archive to the second location and test its password.

### Deferred until hosting

- Automated backup scheduling, upload destination, retention rotation and alerting.
- VPS paths, service account, disk monitoring and restore-from-host commands.
- A continuous 24-hour worker purge observation.

`infra/ec2/backup-db.sh` is an older partial backup: it dumps only the `public` schema and does not export either Storage bucket. Do not treat it as a complete backup, and do not modify it as part of this runbook.
