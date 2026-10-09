# Backup and restore runbook

Last checked against the Supabase documentation: 9 October 2026.

This is a manual Windows PowerShell runbook. Run it before the real exam, immediately after the exam and grading are complete, and before any destructive test or project change. Keep the encrypted archive in two places, with at least one copy off the PC used for the exam.

## What the backup contains

Keep all of these together:

- PostgreSQL roles, schema and data. This includes candidates, attempts, paper assignments, answers, violation events, scores, results, audits and grading state.
- Both private Storage buckets:
  - `question-images` is durable exam content and must be backed up.
  - `snapshots` contains proctoring images that still fall inside the exact 14-day retention window. Older snapshots are disposable only after the retention purge has completed.
- The Git commit ID and the checked-in `supabase/migrations` directory.
- A human-readable CSV export from Admin > Results after finalization.
- A separate, protected record of the configuration and secrets listed below.

LiveKit rooms, Redis state, signed URLs, browser sessions, worker leases and generated build output are disposable runtime state. They are not restored.

Deleting an exam cascades its database events and snapshot-purge queue rows, but it does **not** remove objects from Storage. When deleting test data, also remove `snapshots/<exam_id>/` through the Storage API or Supabase Dashboard. Never delete Storage metadata with SQL.

## Current Free-plan facts

As documented by Supabase on 9 October 2026:

- An account can use two active Free projects across organizations where it is an Owner or Administrator. Paused projects do not count toward that limit.
- A Free project with low activity over a seven-day period may be paused. Supabase does not promise an exact query threshold; a paused project can currently be restored from the Dashboard for up to one year.
- Automatic daily database backups are documented for Pro, Team and Enterprise, not Free. Supabase recommends regular CLI dumps for Free projects.
- A database backup contains Storage metadata, not the actual Storage objects. Export both buckets separately.
- Current Free quotas list 500 MB database size and 1 GB Storage per project. Check the pricing/billing page again before the real exam because limits can change.

What cannot be guaranteed from the documentation: that this account will have a spare Free-project slot on restore day, the exact activity level that prevents pausing, or that experimental CLI Storage commands will keep the same flags. Run `supabase storage cp --help` before each backup. If no hosted scratch slot is available, use the local Docker restore drill below.

Official references:

- <https://supabase.com/docs/guides/platform/backups>
- <https://supabase.com/docs/guides/platform/free-project-pausing>
- <https://supabase.com/docs/guides/platform/billing-on-supabase>
- <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>
- <https://supabase.com/docs/guides/storage/management/download-objects>

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
New-Item -ItemType Directory -Force -Path (Join-Path $BackupRoot 'storage\snapshots') | Out-Null
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
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer)
  $DbUrl = $null
  $SecureDbUrl = $null
}
```

### 3. Export both Storage buckets

The Storage CLI commands are currently marked experimental. First authenticate and link from the isolated working folder. Never paste an access token into a script or commit it.

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

  Push-Location (Join-Path $BackupRoot 'storage\snapshots')
  try { supabase storage cp -r 'ss:///snapshots' . --experimental --linked } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw 'snapshots export failed' }
} finally {
  Pop-Location
}
Remove-Item -Recurse -Force -LiteralPath $CliWork
```

Open Admin > Results, select the exam, export the CSV, and copy it into `$BackupRoot`. The CSV is a second, human-readable results copy; it does not replace the database dump.

### 4. Hash and encrypt

Create a manifest before archiving:

```powershell
$Manifest = Join-Path $BackupRoot 'manifest.csv'
Get-ChildItem -LiteralPath $BackupRoot -Recurse -File |
  Where-Object FullName -ne $Manifest |
  Get-FileHash -Algorithm SHA256 |
  Select-Object @{Name='Path';Expression={$_.Path.Substring($BackupRoot.Length + 1)}},Hash |
  Export-Csv -LiteralPath $Manifest -NoTypeInformation -Encoding utf8
Get-FileHash -LiteralPath $Manifest -Algorithm SHA256 |
  Format-List | Out-File -LiteralPath (Join-Path $BackupRoot 'manifest.sha256.txt') -Encoding utf8
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
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ScratchPointer)
  $ScratchDbUrl = $null
  $ScratchSecureUrl = $null
}

$ScratchCli = Join-Path $env:TEMP "cosmetics-exam-restore-$([guid]::NewGuid())"
New-Item -ItemType Directory -Force -Path $ScratchCli | Out-Null
Push-Location $ScratchCli
try {
  supabase init
  supabase link --project-ref $ScratchRef
  Push-Location (Join-Path $ExtractRoot 'storage\question-images')
  try { supabase storage cp -r . 'ss:///question-images' --experimental --linked } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw 'question-images restore failed' }
  Push-Location (Join-Path $ExtractRoot 'storage\snapshots')
  try { supabase storage cp -r . 'ss:///snapshots' --experimental --linked } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw 'snapshots restore failed' }
} finally {
  Pop-Location
  Remove-Item -Recurse -Force -LiteralPath $ScratchCli
}
```

Point a local web instance at the scratch project using new scratch-only secrets. Verify admin login, candidate counts, exam/question counts, a question image, an unexpired snapshot, Results totals and CSV export. Do not send email, start a real exam or invoke Gemini during the drill.

## Local Docker restore fallback

If both active Free slots are occupied, restore into a local Supabase stack. Docker Desktop must be running. This stack is for verification only and must not be exposed to the network.

```powershell
$ExtractRoot = Read-Host 'Path to the extracted backup folder'
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

  Push-Location (Join-Path $ExtractRoot 'storage\question-images')
  try { supabase storage cp -r . 'ss:///question-images' --experimental --local } finally { Pop-Location }
  Push-Location (Join-Path $ExtractRoot 'storage\snapshots')
  try { supabase storage cp -r . 'ss:///snapshots' --experimental --local } finally { Pop-Location }
  supabase status
} finally {
  Pop-Location
}
```

Inspect the local Studio URL printed by `supabase status`, verify row counts and open representative Storage objects. When finished, return to `$LocalRestore`, run `supabase stop --no-backup`, then remove that exact temporary directory.

## When to back up

### Before the real exam

1. Make a complete encrypted backup and restore-test it.
2. Record CLI, PostgreSQL client and Git versions plus the repository commit.
3. Confirm both Storage buckets were exported and the manifest verifies.
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
