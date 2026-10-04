# Section 1 — Database Migration (Phase 1A)

This section replaces the scattered schema tasks in Phase 1A (1A.1, 1A.3–1A.20). The checked-in SQL files are the schema source of truth; this document explains how to run them and does not duplicate their contents.

**Files**

- `001_initial.sql` — save as `supabase/migrations/001_initial.sql` and run first.
- `002_grading.sql` — save as `supabase/migrations/002_grading.sql` and run second.
- `003_function_search_path.sql` — run third. It fixes each application function's execution search path without changing its behavior.
- `004_exam_paper_and_unassign.sql` — run fourth. It assigns every composed question to every paper, removes the superseded `questions_per_paper` column, and adds atomic candidate unassignment.
- `005_question_rpcs.sql` — run fifth. It adds atomic, status-locked question save/delete/reorder and answer-key save functions.
- `001_smoke_test.sql` — run last in the SQL editor; it rolls itself back and reports the observed `generate_paper()` time for 100 questions.

> **Development verification status (4 October 2026):** `001_initial.sql`, `002_grading.sql`, `003_function_search_path.sql`, `004_exam_paper_and_unassign.sql`, and the revised `001_smoke_test.sql` ran without errors on the Supabase development project. The smoke test passed, the Dashboard reported zero tables without RLS, `/api/health` returned HTTP 200, and a manually created `super_admin` Auth user was linked to its `admin_profiles` row.
>
> Function hardening was verified after applying 003 with:
> `select proname, proconfig from pg_proc join pg_namespace on pg_namespace.oid = pg_proc.pronamespace where pg_namespace.nspname = 'public' order by proname;`
> All 15 public functions had an explicit `search_path`: 13 used `public, pg_temp`; `is_admin()` and `is_super_admin()` used `public`.
> The additional all-functions assertion and SQL Editor result-grid `SELECT` added afterward will be exercised the next time the smoke test runs.
>
> **Pending:** `005_question_rpcs.sql` and its smoke-test block have not yet been applied to the development project. Apply them only after review and local PostgreSQL verification.

---

## 1. How to run it

1. Use a **fresh** Supabase project. The initial file creates tables, functions, policies, publication entries and Storage buckets and is not intended to be run twice. Use separate fresh projects for rehearsal and production; never test against production or promote a test database into production.
2. SQL editor → paste `001_initial.sql` → **Run**.
3. SQL editor → paste `002_grading.sql` → **Run**.
4. SQL editor → paste `003_function_search_path.sql` → **Run**.
5. SQL editor → paste `004_exam_paper_and_unassign.sql` → **Run**.
6. SQL editor → paste `005_question_rpcs.sql` → **Run**.
7. SQL editor → paste `001_smoke_test.sql` → **Run**. Expect a `generate_paper 100-question timing: ... ms` notice and the final result **SMOKE TEST PASSED**.
8. Dashboard → Authentication → Users → create each admin and super-admin manually, then add the matching profile:
   `insert into public.admin_profiles (id, name, role) values ('<auth user uuid>', 'Name', 'super_admin');`
   Use `'admin'` for ordinary admins.
9. Dashboard → Database → Replication: confirm `attempts`, `violation_events`, `grading_jobs`, `grading_log`, `alerts`, and `exams` are in `supabase_realtime`.

If an already-created database still has the old exam default, run this only after the implementation migration step becomes due:

```sql
alter table public.exams alter column flag_threshold set default 10;
```

Fresh databases created by the current `001_initial.sql` already use `10` and do not need that extra statement.

---

## 2. What the migration establishes

| Area | Current rule |
|---|---|
| Candidate photos | Removed; everyone is in the office |
| Question images | Optional for MCQ and written questions. Metadata is all-or-none and limited to the approved private image types and size |
| Announcements | Plain text, 1–5,000 characters, unlimited sends, exact all/custom recipient snapshots, one-time claims, and a client-side fixed five-second toast |
| Flagging | `exams.flag_threshold` defaults to 10 and remains configurable from 1 to 100. No automatic kick, eject, penalty or disqualification |
| Attempts | Assignment creates the candidate attempt automatically; unassignment removes it only while `not_started` |
| Exam papers | Every candidate receives every composed question. `shuffle` controls question order and MCQ option order only; reconnects retain the saved order |
| Engine rules | `generate_paper`, `unassign_exam_candidates`, `save_answer`, `advance_position`, and `submit_attempt` enforce paper, assignment, revision, deadline, navigation and submit behavior atomically with the database clock |
| Views | `current_scores`, `attempt_progress`, and `attempt_deadlines` are `security_invoker` views |
| Realtime | `attempts`, `violation_events`, `grading_jobs`, `grading_log`, `alerts`, and `exams` |
| Storage | Private `snapshots` and `question-images` buckets; candidates receive question images only through an authorized API route |
| Data API | One final grants block revokes automatic exposure. `anon` receives no public-schema access. `authenticated` receives only own-profile/admin Realtime SELECT access plus the two RLS helper functions. Server and worker operations use explicit `service_role` grants |
| Default privileges | `FOR ROLE postgres` defaults revoke table/sequence privileges and function `EXECUTE`; future objects must be granted deliberately |

`position` and `current_position` are **0-based** everywhere.

Every new database function must explicitly set its own safe `search_path`; do not rely on the caller's or database's default path.

The Security Advisor warnings for `is_admin()` and `is_super_admin()` are accepted for the current design. Their `EXECUTE` grant to `authenticated` is intentional because RLS policies invoke them as the caller, and revoking it breaks authenticated Realtime reads. Moving these two helpers into a private schema is a possible later hardening cleanup, not a Phase 1 blocker.

---

## 3. Implementation-plan bindings

| Task | Required implementation |
|---|---|
| 1A.1 | Save the checked-in `001_initial.sql` as the migration. Never hand-write schema from task tables |
| 1A.2b | Run the checked-in `002_grading.sql` after `001_initial.sql` |
| 1A.2c | Run `003_function_search_path.sql` after the schema migrations; every new function must set its own safe search path |
| 1D.2–1D.3 | Run `004_exam_paper_and_unassign.sql`; every paper contains all composed questions and mixed unassignment is atomic |
| 1E.6–1E.7 | Run `005_question_rpcs.sql`; question save/delete/reorder and answer-key save are atomic and lock the exam row |
| 1A.2 | Run the checked-in smoke test after all migrations and require `SMOKE TEST PASSED` |
| 1A.3 | Verify RLS plus the explicit `anon`, `authenticated`, and `service_role` ACL assertions in the smoke test |
| 1A.4 | Verify the six Realtime publication tables listed above |
| 1A.5 | Verify both private Storage buckets and the authenticated admin read policies |
| 1A.6 | Create Auth users manually, then insert their `admin_profiles` rows. The migration seeds `api_key_state` and worker health |
| 1C.3 | No candidate photo field |
| 1D.3 | Assignment creates the attempt; unassignment removes only an unstarted attempt |
| 2C.2 | The server route calls `generate_paper`; the browser cannot execute it directly |
| 2E.4 | The server route calls `save_answer`; position, revision, option and closure checks stay inside the function |
| 2F.1 / 2F.2 | The server route calls `submit_attempt` with `manual` or `auto` |
| 2F.5 / 5A.3 | Ordinary timeout uses `auto`; admin force-end uses `forced` after the final 15-second collection window |
| 2F.6 | The server route calls `advance_position` with the expected position and current answer revision |
| 3C.2 | The browser receives `attempts.violation_count` changes through authenticated Realtime SELECT |
| 4C.2 | The server polls `attempt_progress`; the browser has no direct view grant |
| 5A.5 | The server calls `create_broadcast(uuid, text, text, uuid[])`; claims use `claim_broadcast(uuid, uuid, uuid)` and return no duration field |

### `save_answer` result → HTTP

| Returned text | Meaning | Response |
|---|---|---|
| `saved` | Stored | 200 |
| `stale_revision` | A newer revision already stored | 200; client drops its queued write |
| `closed` | Outside the permitted in-progress or final-collection window | 409 `exam_closed`; client locks the UI |
| `wrong_position` | Sequential mode, not the current question | 409 |
| `not_in_paper`, `bad_option` | Invalid input | 400 |
| `not_found` | Unknown attempt | 404 |

### `advance_position` result → client

| `out_result` | Client action |
|---|---|
| `advanced` | Fetch and show the question at `out_position` |
| `already_advanced` | The earlier reply was lost; show `out_position` |
| `out_of_sync` | Reload the current question from the server |
| `last_question` | Show Submit instead of Next |
| `closed` | Lock the UI |
| `wrong_question`, `not_sequential` | Programming error; reload state |

---

## 4. Canonical SQL files

The migration and smoke test are intentionally not embedded here. Use these checked-in files directly:

- [`001_initial.sql`](./001_initial.sql)
- [`002_grading.sql`](./002_grading.sql)
- [`003_function_search_path.sql`](../../supabase/migrations/003_function_search_path.sql)
- [`004_exam_paper_and_unassign.sql`](../../supabase/migrations/004_exam_paper_and_unassign.sql)
- [`005_question_rpcs.sql`](../../supabase/migrations/005_question_rpcs.sql)
- [`001_smoke_test.sql`](./001_smoke_test.sql)

This prevents the documentation copy from drifting away from the executable source of truth.

### Test-data cleanup (after testing, before the real exam)

```sql
delete from public.exams where is_practice or title ilike 'test%';
delete from public.candidates where mer_code ilike 'TEST%';
delete from public.login_attempts;
delete from public.alerts;
delete from public.admin_actions;
-- Snapshot files are not removed by SQL; empty the Storage > snapshots bucket in the dashboard.
```
