# Cosmetics Exam — Improvement Plan (post-exam round 1)

Date: 20 October 2026
Source reviewed: `ALL.zip` (apps/web, worker, supabase migrations 001–013, infra, docs). The `.env.local` file in the zip was not opened.
Status of the platform: the Palmer's exam ran with 23 candidates and 3 admins with no issues. **Everything below must be additive. The exam path that worked stays as it is.**

How to read this file: every claim about the current code cites the file it comes from. Where I could not confirm a cause by reading, it is marked **UNCONFIRMED** and the first task is a reproduction test.

---

## 1. Safety rules for every phase

1. **Baseline first.** Tag the current commit `exam-proven-2026-10-13` before any change, and take the backup in `docs/BACKUP.md` (database, `question-images` bucket, commit ID, results CSV).
2. **Additive migrations only.** New columns get safe defaults, new tables are new. No `drop`, no `alter ... type`, no change to the existing RPCs (`start_grading`, `recompute_results`, `submit_attempt`, `finalize_exam_if_closed`, `save_question`, `create_broadcast`). Migration numbers continue at `014`.
3. **Off by default.** Every risky feature sits behind a per-exam or per-attempt setting whose default reproduces today's behaviour.
4. **Do-not-touch list** (change only with a separate written reason and a rehearsal):
   - `apps/web/lib/hashing.ts` — Argon2 policy (`NIC_HASH_POLICY`) and the canonical 12-digit hash input. Existing hashes depend on both.
   - `apps/web/lib/candidate-login.ts` — rate limits, dummy-hash timing protection.
   - `apps/web/lib/livekit-server.ts` — `buildCandidateLiveKitToken` grants (`canSubscribe: false`, camera and mic only). Voice talk uses a **separate** room (see D1).
   - `supabase/migrations/001`–`013` — never edited, only followed by new files.
   - `worker/` — no changes in Phases A–C. The worker finalizes exams (`worker/src/scheduler.ts:263`) and is the riskiest thing to redeploy.
   - Proctoring rules (`lib/proctoring-rules.ts`, `lib/proctoring-contract.ts`) except the media-bypass guard in C1.
5. **Regression gate before merge of each phase:** `npm run typecheck`, `npm run lint`, `npm test` in `apps/web` (737 web tests in 152 files; 95 worker tests in 21 files, measured on 21 October) and the worker suite must pass unchanged. Add tests; never delete or loosen existing ones.
6. **Rehearsal after each phase** on a throwaway exam with at least 5 browsers (details in section 8).
7. **Security note.** `ALL.zip` contained `apps/web/.env.local`. If that zip was shared outside your machine, rotate the Supabase service-role key, `NIC_PEPPER`, the LiveKit secret and the session secret. Changing `NIC_PEPPER` invalidates every stored NIC hash, so plan that separately.

---

## 2. What the code review found (evidence)

| # | Topic | Finding | Where |
|---|---|---|---|
| 1 | Admin landing | The page is a hard-coded "Admin setup complete" placeholder. | `app/(admin)/admin/page.tsx` |
| 2 | Messages | Each component keeps its own inline `message` banner ("Question saved." etc.). There is no shared toast. | `QuestionBuilder.tsx:177`, plus 12 more admin components (list in A2) |
| 3 | Candidate list | An "Edit" link and an "Unlock login" button. Delete lives inside `CandidateForm.tsx` and calls `DELETE /api/admin/candidates/[id]`, which already refuses candidates who started an attempt (`has_attempts`, "Mark them inactive instead"). | `CandidateList.tsx:220`, `candidates/[id]/route.ts:127` |
| 4 | "Unsaved changes" | One global `dirty` boolean is set by `updateSelected`, which every editor `onChange` calls. `TiptapEditor` calls `onChange` from `onUpdate`. Reading the code, I could not find a path that fires on mount. **UNCONFIRMED.** Must be reproduced in a test first. | `QuestionBuilder.tsx:111-120`, `TiptapEditor.tsx:58-80` |
| 5a | Printed order | The print items come in the candidate's paper order (`attempt_questions.position`). Each item carries `paper_number` (candidate saw it as) and `admin_number` (original). The heading prints `Question {paper_number} (question {admin_number} in the exam)`. Your PDF matches this. | `attempt-review.ts`, `PrintResult.tsx` |
| 5b | Results table | The wide **Paper** column prints every question number on every row, which is why the summary page is so wide. | `ResultsSummary.tsx` |
| 6 | NIC without V | NIC is stored only as an Argon2 hash. `normalizeNic` accepts 9 digits + `V`/`X`, or 12 digits. A bare 9-digit value (`848280356`) throws `InvalidNicError`, so the import row is rejected as `invalid_nic` and login also fails for anyone who types it that way. Nothing stored needs to change. | `lib/hashing.ts`, `candidates/import/route.ts` |
| 7 | Admin accounts | `admin_profiles` (id → `auth.users`, name, role). There is no UI to create admins. `requireSuperAdmin` already exists. | `lib/auth.ts`, `001_initial.sql:20` |
| 8 | Voice | Admin tokens are `hidden`, `canPublish: false`. Candidate tokens are `canSubscribe: false`, `canPublishData: false`. "Listen" subscribes to one candidate's mic (`useAdminLiveKit.ts`). There is no admin-to-candidate audio path. | `lib/livekit-server.ts`, `useAdminLiveKit.ts` |
| 9 | Candidate scroll | `.exam-content { overflow: hidden }`. The sidebar `<nav class="candidate-question-sidebar w-60 shrink-0 ...">` has **no `overflow-y`**, while the question pane has `.exam-scroll-region` (`overflow-y: auto`). With many questions the list is clipped and cannot scroll. The mobile drawer (`fixed inset-0`) also has no overflow rule. This is a CSS-level cause, not a logic bug. | `QuestionList.tsx`, `styles/tablet.css` |
| 10 | MCQ results | `submit_attempt` does **not** compute marks. Marks come from `start_grading`, which requires `exams.status = 'finalized'`. It already supports `p_mcq_only = true` (SQL-scored, no AI, no jobs, run is `done` at once) and ends with `recompute_exam_results`. The `/grade` route additionally demands an active Gemini key even for MCQ-only. | `011_grading_rpcs.sql:96-245`, `grade/route.ts` |
| 11 | Candidate screens after exam | `/done` signs the candidate out immediately and clears local state. Login rejects submitted or finalized attempts. Sessions are bound to one attempt. So a candidate cannot currently come back to see anything. | `done/page.tsx`, `login/route.ts`, `candidate-session.ts` |
| 12 | Camera/mic check | The Continue button needs `mediaPassed` (camera and mic connected). Live status "Camera off" is derived client-side from missing video. Camera or mic loss in the exam raises `CAMERA_LOST` / `MIC_LOST` events. | `CheckScreen.tsx`, `admin-live.ts`, `useProctoring.ts` |
| 13 | Deleting exams | `DELETE /api/admin/exams/[id]` only allows `draft` exams with no started attempts. Every child table cascades on delete, so a real delete of a finalized exam would erase scores and results. The backup doc notes deletes do not remove Storage objects. | `exams/[id]/route.ts:165`, `001_initial.sql`, `docs/BACKUP.md` |
| 14 | Live grid speed | The admin room already uses `adaptiveStream: true` and subscribes to every camera at once (`setSubscribed(true)` for each). So "turn on adaptive streaming" is not a new fix. The slowness needs measurement. | `useAdminLiveKit.ts` |
| 15 | Import patterns | The candidate import already has a `dry_run` mode, batch limits, and a CSV damage detector (replacement characters, scientific notation). `papaparse` is already a dependency. `save_question` (15 parameters) is the single write path for questions. | `candidates/import/route.ts`, `candidate-csv.ts`, `005_question_rpcs.sql` |
| 16 | Results data | `loadResultsSummary` returns one row per attempt with marks and percent. Rank can be computed from it with no schema change. CSV export is built from the same rows. | `results-summary.ts`, `results/export/route.ts` |

Test footprint today (measured by running the suites): 737 tests in 152 files in `apps/web` (Vitest, `mockReset: true`), and 95 tests in 21 files in `worker`.

---

## 3. Phase overview

| Phase | Theme | Items | Schema change | Risk |
|---|---|---|---|---|
| 0 | Safety baseline | tag, backup, green suites | none | none |
| A | UI fixes and the two cause-known bugs | A1–A8 | none | low |
| B | Admin tools | B1 create admins, B2 duplicate and delete exams, B3 ranks, B4 question import | 014 | low–medium |
| C | Exam-day features | C1 media bypass, C2 provisional score and admin results button | 015, 016 | medium |
| D | Candidate-facing and real-time | D1 voice talk, D2 candidate profiles + results release, D3 live-grid performance | 017, 018 | highest |

Dependencies: C2's Results button shows the rank column from B3. B3's "ranks in profiles" needs D2. D1 needs a spike first. D3 needs measurements from a real exam.

---

## 4. Phase 0 — Safety baseline

Tasks
1. `git tag exam-proven-2026-10-13` on the commit that ran the real exam; push the tag.
2. Run `docs/BACKUP.md` (database, `question-images`, commit ID, results CSV).
3. Run `npm run typecheck && npm run lint && npm test` in `apps/web`, and the worker tests. Record counts.
4. Create a branch per phase (`phase-a-ui`, `phase-b-admin`, ...). Merge only after the gate and rehearsal.

Exit criteria: tag exists, backup stored in two places, all suites green and counts recorded.

---

## 5. Phase A — UI fixes and cause-known bugs (no schema change)

### A1. Admin landing page
- **Change:** `/admin` redirects to `/admin/live?exam=<live exam>` when an exam is live, otherwise `/admin/exams`.
- **Files modified:** `app/(admin)/admin/page.tsx`.
- **Files added:** `lib/admin-landing.ts` (pure function: pick destination from the exams list), `lib/admin-landing.test.ts`.
- **Tests:**
  - destination is `/admin/live` when one exam is live;
  - destination is `/admin/exams` when none is live, when only scheduled exams exist, and on load failure;
  - with two live exams, the earliest started is chosen.

### A2. Toast notifications (top right)
- **Change:** one global toast provider in the admin layout. Success toasts auto-dismiss after about 4 s. Errors stay until closed. Container is `aria-live="polite"` (`assertive` for errors). Inline field errors stay where they are.
- **Files added:** `components/ui/Toast.tsx` (provider, `useToast`), `components/ui/Toast.test.tsx`.
- **Files modified:** `app/(admin)/admin/layout.tsx` (mount provider); replace the success `message` banners with `toast.success(...)` in `QuestionBuilder.tsx`, `candidates/CandidateList.tsx`, `candidates/CandidateImport.tsx`, `exams/ExamForm.tsx`, `exams/ExamCandidates.tsx`, `AdminExamControls.tsx`, `ThresholdControl.tsx`, `OverrideForm.tsx`, `CandidateActions.tsx`, `GradingProgress.tsx`, `SnapshotCleanup.tsx`; `LiveGrid.tsx` and `HealthDashboard.tsx` only if their messages are transient.
- **Scope (settled after the Gate 1 report):** migrate only transient success and action results. Keep inline: `SnapshotCleanup` preview and result counts, the `CandidateImport` completion summary (add only a brief success toast), field-level errors, login errors, `LiveGrid` reconnect and video status (only its threshold notice moves), and `AdminExamControls`' `message` state (it is the broadcast text box, not feedback). `OverrideForm` and `CandidateActions` move both success (auto-dismiss) and failure (persistent) to the toast.
- **Rule:** migrate one component per commit. Existing tests that assert on `role="status"` text must be updated in the same commit to look inside the toast container, not deleted.
- **Tests:** shows and auto-dismisses success; error persists until closed; stacking order; max 4 visible; screen-reader live region present; each migrated component's existing test still passes.

### A3. "Remove" button next to "Edit" on the candidates list
- **Change:** a Remove button per row with a confirm dialog. It calls the existing `DELETE /api/admin/candidates/[id]`. On `has_attempts` (409) the dialog explains and offers **Mark inactive** (existing `PATCH` with `active:false`). No API change.
- **Files modified:** `components/admin/candidates/CandidateList.tsx`, `CandidateList.test.tsx`.
- **Tests:** confirm dialog appears; cancel does nothing; success removes the row and shows a toast; `has_attempts` shows the inactive option and the row stays; network error keeps the row.

### A4. False "You have unsaved changes"
- **Step 1 (reproduce):** write a failing component test that renders `QuestionBuilder` with two saved questions, selects question 1, then question 2, with no edits, and asserts the leave dialog never opens. Run it against the real `TiptapEditor` (jsdom). If it passes, the cause is browser-only; capture it with the exact steps and a console log of which `onChange` fires.
- **Likely directions (UNCONFIRMED):** an editor `onUpdate` or normalisation on load flips `dirty`; or the `dirty` flag is global rather than per question.
- **Fix approach:** compare the current question to its saved snapshot (`savedQuestions` already exists) instead of trusting a boolean. `dirty = !deepEqual(normalise(current), normalise(saved))`, where `normalise` canonicalises the editor HTML. The same fix removes the "click save every time" annoyance.
- **Files modified:** `components/admin/questions/QuestionBuilder.tsx`, `QuestionBuilder.test.tsx`. **Added:** `components/admin/questions/question-dirty.ts` + test.
- **Do not change:** the save payload (`payload()`), the PATCH/PUT behaviour, the lock rules for live exams.
- **Tests:** switching with no edit never prompts; a real text edit prompts; an edit that is undone back to the original does not prompt; marks edit prompts; adding a new unsaved question prompts; save clears it; discard restores the snapshot.

### A5. Results page redesign (admin)
- **Change:** keep the data and routes; improve presentation.
  - Remove the **Paper** column from the main table (it stays in the per-candidate review page).
  - Add summary cards at the top (taken, absent, final, average %, highest, lowest).
  - Score shown as value + bar, status chips, violation badge using the exam's `flag_threshold`, sticky header, filters kept.
  - Rank column is added in B3 (placeholder space reserved).
- **Files modified:** `components/admin/ResultsSummary.tsx`, `ResultsSummary.test.tsx`, `ResultsTabs.tsx`, `app/(admin)/admin/results/summary/page.tsx`; styles stay in the existing token system (`styles/tokens.css`; `npm run lint:colors` must pass).
- **Files added:** `components/admin/ResultsStats.tsx` + test; `lib/grading/results-stats.ts` + test (pure statistics).
- **Do not change:** `results-summary.ts` row shape (only additions allowed), CSV export route in A5.
- **Tests:** statistics with empty, absent-only and mixed data; percent formatting; filter behaviour unchanged; table renders with 21+ rows; accessibility names preserved.

### A6. Printed paper in original order
- **Confirmed intent:** print in original exam order 1–50; the number is the original question number; a note shows how the candidate saw it.
- **Change:** in `PrintResult`, sort items by `admin_number`. Heading becomes `Question {admin_number}` with the note `(candidate saw this as Q{paper_number})`. The on-screen review page and `AttemptReview` are **not** changed.
- **Files modified:** `components/admin/PrintResult.tsx`, `PrintResult.test.tsx`, `app/(print)/admin/results/[attempt]/print/page.test.tsx` if it asserts order.
- **Do not change:** `attempt-review.ts` data shape.
- **Tests:** a shuffled attempt prints 1..N in ascending order; each heading shows the right "saw this as" number; papers with fewer questions than the exam (no missing numbers invented); includes-model-answers toggle still works.

### A7. NIC without V
- **Change:** `normalizeNic` also accepts exactly 9 digits and treats it as the old format (digits + `V`). Also accept lowercase `v`/`x` (already upper-cased). 12-digit values unchanged. The canonical hash input is unchanged, so **every existing hash still verifies**.
- **Files modified:** `lib/hashing.ts` (only the pattern/normaliser, not the policy), `lib/hashing.test.ts`; message text in `InvalidNicError` and the import UI hint (`CandidateImport.tsx`) updated to say a trailing V is optional for 9-digit IDs.
- **Do not change:** `NIC_HASH_POLICY`, `hashNic`/`verifyNic` flow, pepper handling, the invalid-input timing guard.
- **Tests:** `848280356` and `848280356V` normalise to the same 12-digit value; a hash created from `…V` verifies against the 9-digit login and the reverse; 12-digit IDs unchanged; 8- and 10-digit inputs still invalid; import `dry_run` accepts the 9-digit row; known-vector test pinning one existing hash so the policy cannot drift.
- **Risk note:** a 9-digit value could be a mistyped 12-digit one (the notice above makes this visible); the import preview keeps masking IDs and shows a generic per-row notice ("ID read as old format, V added") without revealing the number.

### A8. Candidate question-list scroll
- **Change:** make the sidebar scroll independently: add `overflow-y: auto; min-height: 0` (reuse `.exam-scroll-region`) to `.candidate-question-sidebar`, add the same to the mobile drawer container, and scroll the active question into view on change.
- **Files modified:** `components/exam/QuestionList.tsx`, `styles/tablet.css`; tests in `QuestionList.test.tsx`.
- **Do not change:** `.exam-shell` grid, the answer pane scrolling, fullscreen logic.
- **Tests:** unit — sidebar and drawer carry the scroll class; active item `scrollIntoView` called on change. **Manual (required):** an exam with 60 questions on a laptop-height window, a tablet-width window and a phone-width window; sidebar scrolls without moving the answer pane; keyboard focus follows.

### Phase A exit criteria
Gate green, new tests green, one rehearsal exam with 60 questions and shuffle on, candidate print checked by eye against the original paper order.

---

## 6. Phase B — Admin tools (additive)

### B1. Create admins in the super-admin area
- **Design:** `/admin/admins` (super admin only, new nav item with `superAdminOnly: true`). Form: name, email, role (`admin` | `super_admin`), initial password (min 12 characters, shown once, never stored). Server route uses the service-role client: `auth.admin.createUser({ email, password, email_confirm: true })`, then inserts the `admin_profiles` row; if the profile insert fails, delete the auth user (no orphans). List admins with disable/enable (ban via `auth.admin.updateUserById`) and reset password. Guards: cannot disable or demote the last super admin; cannot act on yourself in ways that lock you out.
- **Files added:** `app/(admin)/admin/admins/page.tsx`, `components/admin/admins/AdminList.tsx`, `AdminForm.tsx` (+ tests), `app/api/admin/admins/route.ts` (GET, POST), `app/api/admin/admins/[id]/route.ts` (PATCH disable/enable/role, POST reset), `lib/admins.ts` (zod schemas) + tests.
- **Files modified:** `components/admin/AdminNav.tsx` (new item).
- **Audit:** `recordAdminAction` for create, disable, enable, role change, reset (same helper other routes use; never log the password).
- **Tests:** non-super-admin gets 403; duplicate email gives a clear error; profile-insert failure rolls back the auth user; last super admin cannot be removed; password policy; audit row written without secrets; list never returns password fields.

### B2. Duplicate exams and delete exams (with a clear warning)
- **Duplicate (safe):** new RPC `duplicate_exam(p_exam_id, p_created_by)` in migration `014`: creates a `draft` copy ("Copy of <title>"), copies settings, questions (new ids), MCQ options (new ids with the correct option remapped), answer keys and calibration. **Not copied:** candidates, attempts, scores, announcements, schedule. Question images: copy the Storage object to a new path so deleting the original cannot break the copy.
- **Delete (your decision: real delete, no archive):** the existing `DELETE /api/admin/exams/[id]` only allows drafts. It will be widened to `draft`, `scheduled`, `ended` and `finalized`.
  - **Blocked** while the exam is `live`, while it is `ended` but not yet finalized (the short collection window), and while a grading run is `running` or `paused`. The message says why and what to do.
  - **Confirmation dialog** (always): "Are you sure you want to delete this exam and its results too? This cannot be undone." The dialog shows what will be lost (number of questions, candidates assigned, attempts, results rows) and has an **Export results CSV first** link for finalized exams.
  - **Storage cleanup:** deleting an exam row cascades the database rows but does not remove Storage objects (`docs/BACKUP.md`). Left alone, proctoring snapshots would outlive the promised 14-day retention and question images would be orphaned. The delete route therefore also removes `snapshots/<exam_id>/` and the exam's question images through the Storage API after the row is deleted, and reports any leftovers instead of hiding them.
  - **Audit:** an `exam_delete` admin action is recorded with title, status and row counts (no personal data).
  - **Recommendation (your call):** require a super admin to delete `ended` or `finalized` exams, since that destroys results. Easy to drop if you want any admin to do it.
- **Files added:** `supabase/migrations/014_exam_duplicate.sql`, `app/api/admin/exams/[id]/duplicate/route.ts`, `lib/exam-storage-cleanup.ts` (+ tests).
- **Files modified:** `app/api/admin/exams/[id]/route.ts` (DELETE rules), `components/admin/exams/ExamList.tsx` (Duplicate and Delete buttons, dialog), `lib/exams.ts` (helper `isExamDeletable(status, hasRunningGrading)`), plus their tests. No change to the candidate login or lists.
- **Do not change:** the cascade rules in the schema; `PATCH`, `start`, `force-end` routes.
- **Tests:** duplicate copies N questions, options, keys and remaps the correct option; duplicate never copies attempts or candidates; image object is copied; delete allowed for draft, scheduled and finalized; blocked for live, ended and for a running grading run; dialog shows counts and requires confirmation; cancelling deletes nothing; Storage cleanup is called with the right prefixes and a failure there is reported but does not resurrect the exam; audit row has no personal data; non-admin gets 403; super-admin rule (if kept).

### B3. Ranks (results, CSV)
- **Rule:** ties share a place (1, 2, 2, 4). Absent candidates are unranked. Only attempts with `is_final` count toward ranking; non-final rows show "—" until graded.
- **Change:** pure function `rankRows(rows)` in `lib/grading/rank.ts`; a **Rank** column in the summary table; `rank` added to the CSV **at the end** of the header list so existing spreadsheets keep their column positions.
- **Files added:** `lib/grading/rank.ts` + test.
- **Files modified:** `lib/grading/results-summary.ts` (add `rank` to the row type only), `components/admin/ResultsSummary.tsx`, `app/api/admin/results/export/route.ts` (append column) and their tests.
- **Tests:** ties, all-equal, single candidate, absent excluded, non-final excluded, percent equal but marks different (rank by percent, then keep ties), CSV header order has the old 14 columns first.

### B4. Question import with template and answer key
- **Template (CSV, UTF-8 with BOM so Sinhala survives Excel):**
  `type, question, option_a … option_j, correct, marks, model_answer, grading_notes`.
  - The importer **auto-detects** `mcq` (options present), `written` (no options, model answer present) or a mix.
  - Options: it reads however many `option_*` cells are filled (the editor supports 2–10 options), and `correct` accepts a letter (`A`) or the option text.
  - Image columns are not part of v1 (images are added afterwards in the builder).
- **Flow (mirrors the candidate import):** pick file → parse in the browser (`papaparse`) → **dry run** on the server returns a row-by-row report → admin fixes or skips rows → confirm → rows are saved through the existing `save_question` RPC in small batches. Nothing is written before confirmation.
- **Checks in the report:** missing question text; MCQ with fewer than 2 options; missing or unmatched `correct`; written row without model answer; marks out of range; encoding damage (reuse the damage-detector idea: `\uFFFD`, long runs of `?`); over-limit text lengths (`QUESTION_BODY_MAX`, `OPTION_TEXT_MAX`).
- **Duplicate detection:** normalise to plain text (existing `gradingHtmlToText`), lowercase, collapse whitespace, strip punctuation; for MCQ also compare the sorted option set. Compared against (1) other rows in the file, (2) the target exam, (3) all other exams. Report shows which exam the match is in. Exact-after-normalising matches are blocked by default with a per-row "import anyway".
- **Locked exams:** import is allowed only while the exam is `draft` or `scheduled` (same rule as adding questions, because `save_question` already rejects locked exams).
- **Files added:** `lib/question-import.ts` (parse, validate, normalise, duplicate keys) + test; `lib/question-csv.ts` (template builder, damage check) + test; `app/api/admin/questions/import/route.ts` (+ test, supports `dry_run`); `app/(admin)/admin/exams/[id]/questions/import/page.tsx`; `components/admin/questions/QuestionImport.tsx` (+ test); a downloadable template served from `app/api/admin/questions/import/template/route.ts`.
- **Files modified:** `components/admin/questions/QuestionBuilder.tsx` (an "Import questions" button only), `components/admin/exams/ExamTabs.tsx` if the tab needs a link.
- **Do not change:** `save_question`, `lib/questions.ts` schemas (import reuses them).
- **Tests:** detection of mcq/written/mixed; 4-option and 7-option rows; `correct` as letter and as text; letter beyond the option count rejected; Sinhala text round-trip; BOM handling; duplicates inside the file, against the exam, against another exam, with different punctuation and case; dry run writes nothing (assert no rows inserted); batch partial failure reports the failed rows and leaves earlier ones saved; locked exam rejected; 200-row file performance; the template downloads and re-imports cleanly (round trip).
- **Also added to the question builder (cheap, addresses "never checked our questions"):** a pre-schedule checklist that blocks scheduling if any question has a missing key, using the existing `questionKeyComplete` rule. Needs one extra server-side check in the schedule path; keep it as a warning first, a block later.

### Phase B exit criteria
Gate green; rehearsal that creates a second admin, duplicates the Palmer's exam, imports a 60-question CSV with 3 planted duplicates and 2 bad rows, deletes a finished test exam (checking the warning dialog, the Storage cleanup and that a live exam cannot be deleted), and exports a CSV with a rank column.

---

## 7. Phase C — Exam-day features

### C1. Bypass camera and mic (admin grants per candidate)
- **Design:** new column `attempts.media_bypass boolean not null default false`, plus `media_bypassed_by uuid`, `media_bypassed_at timestamptz` (migration `015`). Admin opens a candidate in the live grid (candidate panel) and presses **Allow without camera/mic**. One button covers both.
- **Candidate side:** the check screen already refreshes state via `/api/exam/state`. When `media_bypass` is true, step 2 shows **Bypassed by the exam team** and Continue no longer requires `mediaPassed`. Fullscreen, connection and Chrome checks **still apply**. The permission persists for that attempt across refresh and re-login. The state payload gets one new boolean.
- **Proctoring:** when bypassed, do not raise `CAMERA_LOST` / `MIC_LOST`, and hide the camera-lost banner (`useProctoring` options and `ExamScreen.tsx`). Other proctoring (fullscreen exit, copy/paste, multi-screen) remains active.
- **Live grid:** show a **No camera (allowed)** badge instead of "Camera off", never counted as a violation; the results review and CSV can show the flag.
- **Revoke:** same button toggles it off (audit logged).
- **Files added:** `supabase/migrations/015_attempt_media_bypass.sql`, `app/api/admin/attempts/[id]/media-bypass/route.ts` (+ test, uses `requireAdmin`, `assertSameOrigin`, `recordAdminAction`).
- **Files modified:** `app/api/exam/state/route.ts` (+ test), `lib/candidate-types.ts`, `components/candidate/CheckScreen.tsx` (+ test), `components/exam/ExamScreen.tsx` and `hooks/useProctoring.ts` (guard only), `components/admin/CandidatePanel.tsx` (+ test), `components/admin/VideoTile.tsx`, `lib/admin-live.ts` (status derivation), `app/api/admin/live/route.ts` (return the flag).
- **Do not change:** the LiveKit candidate token grants, the normal (non-bypassed) check flow.
- **Tests:** flag false keeps current behaviour exactly (existing `CheckScreen.test.tsx` unchanged and passing); flag true enables Continue without media but still requires fullscreen and connection; no `CAMERA_LOST` events when bypassed and none lost for a normal candidate; revoke re-requires media; non-admin cannot call the route; live status derivation covers bypassed vs "Camera off"; audit entry written.
- **Open point to verify in code during implementation:** that a candidate who has not connected media still sends heartbeats from `/check` (so they appear in the grid). Add a test for it.

### C2. MCQ-only exams: provisional score for candidates and results for admins
- **What you decided:** (a) the candidate sees a **temporary score immediately on the exam completion page**; (b) after the exam is over, admins can open the finalized results (score, rank, candidate name, MER code) from the exams page.
- **One per-exam setting:** `exams.auto_results boolean not null default false` (migration `016`), a checkbox in the exam form shown only when the exam has no written questions. The server rejects it on exams that contain written questions and re-checks at schedule time.
- **(a) Provisional score on `/done`:**
  - New read-only route `GET /api/exam/provisional-score`. It requires the candidate's own submitted attempt, `auto_results = true`, and an MCQ-only paper. It adds up the marks of questions where the selected option equals the answer key, using the existing `answers`, `answer_keys` and `questions.marks` data. **It writes nothing**, so it cannot disturb grading.
  - Returns `{ earned, max }` only. It never reveals which questions were right or wrong.
  - If any MCQ key is missing, or the setting is off, it returns nothing and the page looks exactly as it does today.
  - The page says "Provisional score — the exam team confirms final results." The score may change if a key is corrected later, which is why it is labelled provisional.
  - The completion page fetches the score **before** the existing sign-out effect runs. If the fetch fails, the page shows the normal message.
- **(b) Admin results after the exam:**
  - When the exam is finalized and `auto_results` is on, the admin results page runs the existing `start_grading(..., p_mcq_only := true)` once (guarded: only if the exam has no grading run). That RPC needs no AI key and ends with `recompute_exam_results`. It is triggered from the admin page load, so the worker is not changed.
  - **Results button on the exams page:** each ended or finalized exam gets a **Results** button (and a Results tab in the exam tabs) that opens the existing summary page for that exam, showing MER code, name, marks, percent and the new **Rank** column (B3), sortable by rank.
- **Files added:** `supabase/migrations/016_exam_auto_results.sql`, `app/api/exam/provisional-score/route.ts` (+ test), `lib/grading/provisional-score.ts` (+ test), `lib/grading/auto-results.ts` (+ test).
- **Files modified:** `app/(candidate)/done/page.tsx` and `done/page.test.tsx`, `components/admin/exams/ExamForm.tsx` (+ test), `components/admin/exams/ExamList.tsx` and `ExamTabs.tsx` (Results button/tab), `lib/exams.ts`, `app/api/admin/exams/route.ts` and `[id]/route.ts` (accept and validate the field), `app/(admin)/admin/results/page.tsx` and `results/summary/page.tsx` (trigger helper).
- **Do not change:** `start_grading`, `recompute_results`, `submit_attempt`, the `/grade` route, the sign-out behaviour of `/done` (score is read first, sign-out stays).
- **Tests:**
  - score arithmetic: all correct, none correct, unanswered, mixed marks per question (0.25 steps), shuffled papers (use the candidate's own paper, not the exam's);
  - route refuses another candidate's attempt, a non-submitted attempt, a written-containing exam, and an exam with the setting off;
  - missing key returns nothing and does not error the page;
  - the response contains no per-question information;
  - `/done` shows the score when available and the old message otherwise; sign-out still happens in both cases;
  - setting hidden or rejected for exams with written questions, and refused at schedule time if a written question was added afterwards;
  - admin helper runs once, not twice, and does nothing when off; missing keys show the existing `missing_answer_keys` error to the admin;
  - Results button visible only for ended and finalized exams and links to the right exam.

### Phase C exit criteria
Gate green; rehearsal: one candidate with the camera blocked is bypassed from the grid, completes the exam without violations; an MCQ-only exam with `after_window` ends and the admin results page is populated without pressing Start grading.

---

## 8. Phase D — Candidate-facing and real-time

### D1. Voice talk (admin to candidates)
- **Decisions you made:** push-to-talk in **Announcements** for all candidates, and push-to-talk in each **candidate panel** for one candidate. One-way (admin speaks, candidates hear). "Listen" stays as is.
- **Design (to be proven by a spike first):** do **not** change the proctoring room or the candidate token. Use a **second LiveKit room per exam**, `talk_<examId>`:
  - Admin joins it with a token that can publish the microphone.
  - Candidates join it with a **subscribe-only** token (no publish, no data), after they are in the exam.
  - For "all", the admin track is open to everyone. For one candidate, the admin restricts who may subscribe using the publisher's track-subscription permissions.
  - This keeps candidates unable to see each other's cameras, because the proctoring room grants stay exactly as they are.
- **Spike (half a day, before any UI):** with two browsers and the production LiveKit config, verify (1) a subscribe-only candidate hears the admin, (2) per-identity restriction really silences others, (3) candidate browser autoplay works after the existing fullscreen click, (4) the extra connection per candidate is acceptable at about 30 candidates. If any answer is no, I will report it and propose the closest alternative before building anything.
- **Candidate UI:** a small "Exam team is speaking" indicator; no way for the candidate to mute or reply. Playback stops when the admin releases the button.
- **Files added:** `lib/talk-server.ts` (tokens for the talk room), `app/api/livekit/talk-token/route.ts`, `hooks/useAdminTalk.ts`, `hooks/useCandidateTalk.ts`, `components/admin/TalkButton.tsx`, `components/candidate/TalkIndicator.tsx` (+ tests for each).
- **Files modified:** `components/admin/AdminExamControls.tsx` (Announcement dialog gets the push-to-talk), `components/admin/CandidatePanel.tsx`, `components/candidate/LiveKitContext.tsx` or a sibling provider mounted only on `/exam` (not touching `useLiveKit.ts`).
- **Audit:** log who talked, to whom, start and stop time (no audio stored).
- **Tests:** token grants (admin publish mic only, candidate subscribe only, correct room name); a candidate cannot obtain a publish token; talk-token route requires an admin or a live candidate session for that exam; UI state machine (idle, talking, released, mic permission denied); candidate indicator appears and clears; failure of the talk room never affects the exam (assert the exam screen still renders and autosaves when the talk connection fails); manual two-browser test.

### D2. Candidate profiles
- **Goal:** candidates sign in to a home area to see their exams, join a live exam, and view released results, ranks and progress.
- **Why separate routes:** today sessions are bound to one attempt, login rejects finished attempts and `/done` signs out (finding 11). So the profile uses its **own** session cookie and routes. The existing candidate flow (`/login` → `/confirm` → `/check` → `/exam`) is untouched. "Join live exam" from the profile starts the existing login path server-side for that exam.
- **Login:** same MER + NIC credentials and the same Argon2 verification and rate limiting (reuse `verifyNic`, `assertLoginAllowed`; do not fork them).
- **Release control (privacy):** new `exams.results_visible_to_candidates boolean default false` and `exams.rank_visible boolean default false` (migration `017`). Candidates see nothing about an exam until an admin releases it; with C2's `after_window` an MCQ-only exam can release automatically once finalized. What a candidate can see: score, percent, rank (if released) and, if the admin enables it, their own answer review. Never other candidates' data.
- **Pages:** `/me` (upcoming/live/finished exams), `/me/results/[examId]`, `/me/progress` (scores over time).
- **Files added:** `supabase/migrations/017_candidate_profiles.sql`, `app/(profile)/me/...` pages, `app/api/me/login/route.ts`, `app/api/me/exams/route.ts`, `app/api/me/results/[examId]/route.ts`, `lib/profile-session.ts` (separate iron-session cookie name), `lib/profile-data.ts` (+ tests for all).
- **Files modified:** `lib/session.ts` only to add the second cookie options (no change to the existing candidate cookie), `proxy.ts` only to allow the new routes through.
- **Do not change:** `candidate-session.ts`, `candidate-routing.ts`, the `/done` behaviour.
- **Tests:** profile login uses the same credential check (including 9-digit NIC); wrong credentials rate-limited and indistinguishable; a candidate can read only their own results (try another candidate's attempt id → 404); unreleased exams return nothing; rank only when `rank_visible`; ties displayed correctly; the existing candidate flow tests unchanged and passing; session isolation (profile cookie cannot call exam APIs, exam cookie cannot call profile APIs).
- **Needs confirmation before build:** that one `candidates` row is reused across exams (it is: `exam_candidates` links candidate to exams, `candidates.mer_code` is unique). Good.

### D3. Live-grid camera loading
- **Step 1 — measure, don't guess:** during the next real or rehearsal exam, capture: time until each tile shows video, admin machine CPU, browser network tab for the LiveKit connection, and LiveKit server stats. The existing `scripts/measure-*.mjs` scripts are a pattern for a `measure-live-grid.mjs`.
- **Already in place:** `adaptiveStream: true` and a reconnect loop. So the likely levers are: subscribing only to visible tiles (pagination or virtualized grid), a low-resolution grid with full quality on click, and the hosting/network of the LiveKit server.
- **Change (after measurement):** subscribe by visibility; keep "Flagged" and "Offline" filters able to subscribe on demand.
- **Files likely modified:** `hooks/useAdminLiveKit.ts` (+ test), `components/admin/LiveGrid.tsx` (+ test), `VideoTile.tsx`.
- **Do not change:** candidate publishing settings during an exam.
- **Tests:** only visible tiles are subscribed; scrolling subscribes and unsubscribes; clicking a tile upgrades quality; reconnect logic unchanged and tested; manual check with 30 simulated or real participants.

### Phase D exit criteria
Spike result recorded and approved before D1 UI; profile and voice rehearsed with 5+ real browsers; one load rehearsal near 30 candidates comparing live-grid time-to-first-video before and after.

---

## 9. Test strategy (summary)

| Layer | Tooling | What it covers |
|---|---|---|
| Unit | Vitest (existing) | pure helpers: landing choice, dirty compare, NIC normaliser, rank, stats, import parser/duplicates, auto-results guard, talk tokens |
| Route | Vitest with mocked Supabase (existing pattern: `*.route.test.ts`) | auth, validation, rollback, audit entries, idempotency, forbidden access |
| Component | Vitest + Testing Library | toast, candidate Remove, question dirty state, results table, check screen bypass, talk indicator |
| Migration | the project's smoke-test SQL (`Test/SECTIONS/001_smoke_test.sql`) extended | new columns default correctly; duplicate RPC copies correctly; existing rows unchanged |
| Contract/regression | existing 737 web and 95 worker tests | must pass unchanged at every phase |
| Rehearsal (manual) | throwaway exam, 5+ real browsers incl. a phone | scroll, bypass, talk, import, delete warning, results/print/CSV |
| Load | extend `scripts/measure-login.mjs` pattern | login burst with 9-digit NICs, live grid with 30 publishers |

Rehearsal checklist (run after each phase on a non-production exam with synthetic data):
1. Log in as 5 candidates (include one typing a 9-digit NIC and one with no camera).
2. Run a 60-question shuffled exam; verify the sidebar scrolls on laptop, tablet and phone widths.
3. As admin: toast appears top right; open candidate panel; bypass; remove a candidate with no attempts; try removing one with attempts.
4. End the exam; open results; check rank, CSV, print order, and that no results disappeared.

---

## 10. Decisions — all settled

1. **Candidate score:** provisional score on the completion page (MCQ-only exams, per-exam option), plus an admin Results button for finalized exams with score, rank, name and MER code. Built in C2.
2. **Voice:** admin-to-candidate audio only; "Listen" is unchanged. D1 starts with a short technical test (the spike) to prove the approach works before any UI is built.
3. **Delete exam:** real delete with a confirmation naming the results too; blocked only while live, closing, or grading. Storage cleanup is part of the delete.

Also settled: toast, landing redirect, Remove button, original-order print, NIC with optional V, set-a-password for new admins, one-button bypass, ties as shared places, import template with auto-detect and dry run, ranks in CSV.

Remaining recommendation you can accept or drop: super admin only for deleting ended or finalized exams (B2).

---

## 11. File-change index

**New files (by phase)**
- A: `lib/admin-landing.ts`, `components/ui/Toast.tsx`, `components/admin/questions/question-dirty.ts`, `components/admin/ResultsStats.tsx`, `lib/grading/results-stats.ts` (+ tests)
- B: `app/(admin)/admin/admins/*`, `components/admin/admins/*`, `app/api/admin/admins/*`, `lib/admins.ts`, `supabase/migrations/014_exam_duplicate.sql`, `app/api/admin/exams/[id]/duplicate/route.ts`, `lib/exam-storage-cleanup.ts`, `lib/grading/rank.ts`, `lib/question-import.ts`, `lib/question-csv.ts`, `app/api/admin/questions/import/*`, `app/(admin)/admin/exams/[id]/questions/import/page.tsx`, `components/admin/questions/QuestionImport.tsx` (+ tests)
- C: `supabase/migrations/015_attempt_media_bypass.sql`, `app/api/admin/attempts/[id]/media-bypass/route.ts`, `supabase/migrations/016_exam_auto_results.sql`, `app/api/exam/provisional-score/route.ts`, `lib/grading/provisional-score.ts`, `lib/grading/auto-results.ts` (+ tests)
- D: `lib/talk-server.ts`, `app/api/livekit/talk-token/route.ts`, `hooks/useAdminTalk.ts`, `hooks/useCandidateTalk.ts`, `components/admin/TalkButton.tsx`, `components/candidate/TalkIndicator.tsx`, `supabase/migrations/017_candidate_profiles.sql`, `app/(profile)/me/*`, `app/api/me/*`, `lib/profile-session.ts`, `lib/profile-data.ts`, `scripts/measure-live-grid.mjs` (+ tests)

**Modified existing files (by phase)**
- A: `app/(admin)/admin/page.tsx`, `app/(admin)/admin/layout.tsx`, 11 admin components for toasts (list in A2), `candidates/CandidateList.tsx`, `questions/QuestionBuilder.tsx`, `ResultsSummary.tsx`, `ResultsTabs.tsx`, `PrintResult.tsx`, `lib/hashing.ts` (normaliser only), `candidates/CandidateImport.tsx`, `exam/QuestionList.tsx`, `styles/tablet.css`
- B: `AdminNav.tsx`, `exams/ExamList.tsx`, `lib/exams.ts`, `app/api/admin/exams/route.ts`, `app/api/admin/exams/[id]/route.ts` (DELETE rules), `lib/grading/results-summary.ts` (add rank), `ResultsSummary.tsx`, `results/export/route.ts` (append column), `QuestionBuilder.tsx` (import button)
- C: `app/api/exam/state/route.ts`, `lib/candidate-types.ts`, `CheckScreen.tsx`, `ExamScreen.tsx`, `hooks/useProctoring.ts`, `CandidatePanel.tsx`, `VideoTile.tsx`, `lib/admin-live.ts`, `app/api/admin/live/route.ts`, `ExamForm.tsx`, `app/api/admin/exams/[id]/route.ts`, `app/(admin)/admin/results/page.tsx`
- D: `AdminExamControls.tsx`, `CandidatePanel.tsx`, `LiveKitContext.tsx` (or a sibling provider), `lib/session.ts` (add second cookie options), `proxy.ts`, `hooks/useAdminLiveKit.ts`, `LiveGrid.tsx`, `VideoTile.tsx`

**Never modified:** migrations 001–013, `worker/`, `NIC_HASH_POLICY`, the candidate LiveKit token grants, `candidate-session.ts`, `candidate-routing.ts`, `start_grading`, `recompute_results`, `submit_attempt`.
