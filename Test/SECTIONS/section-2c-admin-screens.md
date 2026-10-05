# Section 2C: Admin screens

*Built on Section 2A (design system), Section 3 (API contracts), Section 4 (proctoring), Section 5 (grading) and the plan's admin tasks (1B–1E, 3C, 4C, 5A, 5C, 6D, 7). Status: spec only. Nothing here has been built or rendered. The interface is English only (decided in 2B). Questions, answers and announcements can be Sinhala, English, mixed or Singlish, and use the content rules in Section 2B §11.*

---

## 0. What I found while designing, and what I decided

These are gaps between the plan, the contracts and the sections. Each one is settled below so you do not have to decide again. Items marked **contract** changed `section-3-api-contracts.md` in this round.

1. **No way to "accept" an AI mark.** Section 5 §8.1 says a reviewer "clears reviews by overriding or accepting", but no accept route exists. **Decided:** *Accept AI marks* is a one-click **override with the same marks** and a prefilled note ("Accepted AI marks after review."), through the existing override route (37). Side effect, shown in the button's dialog: an accepted mark becomes an override, so a later regrade will not replace it.
2. **Announcements.** The current rule is **5,000 characters per announcement and unlimited announcements per exam**. They are in-app website notifications; Discord and Telegram are not part of this system.
3. **Correcting an MCQ answer key after grading would burn Gemini quota.** The only way to rescore MCQs was to run the whole grading again, which re-creates a Gemini job for every written answer. **Decided: contract:** the grade route takes an optional body `{ "mcq_only": true }` that rescores MCQs and recomputes results without any Gemini job. The answer-key form offers it.
4. **CSV column name.** The contract said `violation_count`, the plan and Section 4 say `violations_counted`. **Contract** now says `violations_counted`.
5. **The live grid status words had no rules.** Section 4 only defines "Offline" (no heartbeat for 25 s). §7.2 defines all six statuses and the order they win in.
6. **The grid stays in MER order.** Suspicion, status and violation updates never change candidate order. Admins use filters and the visible incident count instead of an attention-first sort.
7. **The admin's own live connection can drop.** The plan covers the candidates' connection loss but not the admin's. §7.7 adds a "Live updates paused" banner and a 10-second refetch fallback.
8. **Regrade-after-key-change only works once scores exist,** and scores only exist after the exam is finalized, so the regrade button appears only when `regrade_needed` is true. The answer-key form is locked while a grading run is active (`409 grading_in_progress`), and the screen says why.
9. **No screen to create admins.** Admins are created by hand in the Supabase dashboard plus an `admin_profiles` row (task 1A.6). This spec adds no admin-management screen. If you want one later it is a separate small task.
10. **Where the candidate "unlock" button lives:** on each candidate row and in the live candidate panel (the honest-typo case on exam morning).
11. **The Section 2A reference to "Section 2D" for empty-table copy** now points to §11 here. **2A** edited.
12. **Plain admins can't read the key and health tables.** Row-level security limits `system_health`, `api_key_state` and `alerts` to a super admin, so the Keys table and time estimate on the Grading tab are super admin only (§8.2). Everything else on that tab comes from tables every admin can read.
13. **"Snapshot deleted" could not be told apart from "no snapshot".** The purge only nulled `snapshot_path`. **Contract:** the purge now also writes `meta.snapshot_deleted_at`, and the timeline reads it (§7.6).
14. **Extend had no error for losing the race three times.** **Contract:** `409 concurrent_update` added to the extend route (§6.2).
15. **Current question-image rule.** MCQ and written questions both support one optional image, stored separately from rich text and rendered between question text and answer controls (§4.2).

---

## 1. Admin shell

### 1.1 Layout (2A §3)

- **Top bar**, 56 px: logo, current page name, then on the right the alert chip (super admin only, §10), the signed-in admin's name and role, and **Sign out** (Quiet button).
- **Left nav**, 200 px: **Exams**, **Candidates**, **Live**, **Results**, and **Health** (super admin only; an admin never sees the link).
- Content fills the rest. Admin screens are designed for 1280 px and up. Below that they scroll sideways inside tables and nothing breaks, but there is no layout work.
- Tables are flat with hairline dividers. No cards. One primary button per screen.
- **All times are Colombo time** (`Asia/Colombo`), shown as `5 Oct 2026, 9:30 am` in tables and `9:30:12 am` in the timeline. Inputs are labelled "Colombo time". The page converts to UTC before sending (plan 1D.2).

### 1.2 Pages and where they come from

| Screen | Route (plan file) | Plan tasks | Contract routes |
|---|---|---|---|
| Sign in | `admin/login` | 1B.1 | Supabase Auth |
| Exam list | `admin/exams` | 1D.1 | 19 |
| Exam settings | `admin/exams/[id]` | 1D.2, 1D.4 | 19, 20 |
| Exam candidates (new sub-page) | `admin/exams/[id]/candidates` | 1D.3 | 21 |
| Question builder | `admin/exams/[id]/questions` | 1E.3–1E.8 | 22, 23, 24, 25 |
| Candidate list, form, import | `admin/candidates`, `[id]` | 1C.2–1C.5 | 15, 16, 17, 18 |
| Live grid and candidate panel | `admin/live` | 4C, 3C, 5A | 14, 20, 26–31, 40 |
| Results: grading tab | `admin/results` | 6D.1–6D.3 | 35, 36, 41 |
| Results: summary | `admin/results/summary` | 7.1, 7.4, 7.5 | 39 |
| Review | `admin/results/[attempt]` | 6D.4–6D.6 | 37, 38 |
| Print | `admin/results/[attempt]/print` | 7.3 | none (reads `current_scores`) |
| Health and alerts | `admin/health` | 5C | 32, 33, 34 |

### 1.3 Access rules

- Every page is inside the admin layout, which calls `requireAdmin()` (plan 1B.2, 1B.5). Not signed in: go to the sign-in page. Signed in but no `admin_profiles` row: the "not set up" message in §2.
- **Super admin only:** Health, the snapshot cleanup panel, and resolving alerts. A plain admin who opens `/admin/health` gets the 403 page: **"You don't have access to this page."** with one button, **Go to Exams**.
- A page left open for hours must not lose the session mid-exam. The Supabase cookie refreshes itself, and the rehearsal tests it (§13).

### 1.4 Component choices

The shell, tables, badges, banners, dialogs, toast and rich-text editor are the Section 2A components: status badge (4.10), violation badge (4.11), video tile (4.12), data table (4.13), toast (4.14), Tiptap editor (4.15), empty/loading/error (4.16). New components used here are defined in Section 2A: **Tabs** (§4.17), **Side panel** (§4.18), **Filter chips** (§4.19) and **Step indicator** (§4.20). All follow ink on paper, words with every colour, 44 px targets and the focus ring.

---

## 2. Sign in (1B.1)

One centred form, 28 rem wide, the logo above it.

| Part | Text |
|---|---|
| Title | **Admin sign in** |
| Fields | **Email**, **Password** (show/hide toggle, 44 px, `aria-pressed`) |
| Button | **Sign in** (Primary) |
| Wrong email or password | **Email or password is not correct.** (one message for both, never says which) |
| Signed in but no admin profile | **This account is not set up as an admin. Ask the super admin to add you.** |
| Session ended | **You were signed out. Sign in again.** |
| Too many tries (Supabase) | **Too many attempts. Wait a minute and try again.** |

No "forgot password" link: the super admin resets passwords in the Supabase dashboard (stated in the runbook, Section 6).

---

## 3. Exams

### 3.1 Exam list (1D.1)

A Data table, newest first. Columns:

| Column | Content |
|---|---|
| Title | link to settings; a **Practice** tag when `is_practice` |
| Status | **Draft**, **Scheduled**, **Live**, **Ended**, **Finalized** (word plus the same dot/icon rules as 2A 4.10). `ended` shows **Ended, finalizing** until the worker marks it finalized |
| Start | `scheduled_start_at` in Colombo time, or "Not set" |
| Duration | `45 min` |
| Questions | `question_count` |
| Candidates | `assigned_count` |
| Action | one Secondary button by status: Draft or Scheduled: **Edit**; Live: **Open live view**; Ended or Finalized: **Results** |

Header: the page title and **New exam** (Primary). Empty state: **No exams yet. Create the first one to add questions and candidates.** with the **New exam** button.

### 3.2 Exam settings (1D.2, 1D.4)

A single page with a Tabs row: **Settings**, **Questions**, **Candidates**. Under the tabs, a **Readiness** list (§3.3) and then the form.

| Field | Control and rules |
|---|---|
| Title | Text, 1–150. Always editable |
| Instructions | Textarea, plain text, up to 4000. Help: "Shown to candidates on the rules screen." |
| Start date and time | Date and time inputs, labelled "Colombo time". Help: "The waiting room opens when candidates sign in. The exam starts at this time, or sooner if you press Start now." |
| Duration | Number, minutes, 1–480 |
| Navigation | Radio: **Free** ("Candidates can go back and forth between questions") and **Sequential** ("One question at a time. No going back.") |
| Shuffle | Checkbox: **Shuffle question and multiple-choice option order for each candidate** |
| Flag threshold | Number, 1–100, default **10**. Help: "A candidate turns red when their counted violations reach this number, and amber at half of it." Editable while the exam is live |
| Practice exam | Checkbox: **This is a rehearsal exam.** Help: "Practice exams carry a Practice tag and are removed by the cleanup script after the rehearsal." |

**Locked fields.** While `live` or `ended`, only **Title** and **Flag threshold** can change. At `finalized`, only **Title** can change. Every other field is disabled and shows the line **Locked while the exam is live.** under it. A server `409 exam_locked` (should the page be out of date) shows the banner **This exam has started, so those settings can no longer change. Reload the page.**

**Buttons**
- **Save** (Primary). Disabled when nothing changed. Success toast: **Saved.**
- **Schedule exam** (Secondary, shown while Draft). Calls PATCH `status: 'scheduled'`. Becomes **Move back to draft** (Secondary) while Scheduled.
- **Delete exam** (Destructive, only while Draft with no started attempts). Dialog: title **Delete this exam?**, body **"{title}" and its {n} questions will be deleted. This cannot be undone.**, buttons **Delete exam** / **Keep exam**, with focus on **Keep exam**.

**Unsaved changes.** Leaving the page with unsaved edits opens a dialog: **You have unsaved changes.** buttons **Leave without saving** / **Stay**.

### 3.3 Readiness list

Shown for Draft and Scheduled exams, built from `GET /api/admin/exams/[id]` (`question_count`, `assigned_count`, `warnings`). Each line has an icon and words:

| Line | Done when | Not done text |
|---|---|---|
| Questions | `question_count` ≥ 1 | **No questions yet.** (link: Add questions) |
| Candidates | `assigned_count` ≥ 1 | **No candidates assigned.** (link: Assign candidates) |
| Start time (needed to schedule) | `scheduled_start_at` is set and at least 1 minute in the future | **No start time set.** or **The start time has passed. Choose a new one.** |
| Answer keys | no `missing_answer_key` warning | **{n} questions have no answer key yet. You can add them before grading.** (a warning, not a blocker) |

If **Schedule exam** returns `409 not_ready`, the page lists `details.missing` as the same lines in words ("Add at least one question", "The start time must be at least 1 minute from now"), not as a code.

### 3.4 Exam candidates (1D.3)

A new sub-page: `admin/exams/[id]/candidates`. Two tables stacked, with a one-line count under the tabs: **{assigned} assigned**.

**Assigned** (from `GET /api/admin/exams/[id]/candidates`): checkbox, MER code, name, outlet, **Attempt** (**Not joined**, **Ready**, **In exam**, **Submitted**: the same words as the live grid, §7.2). Button **Remove selected** (Destructive, enabled with a selection).
- Result `{ removed, blocked }`: toast **3 removed.** If anyone was blocked, a Notice stays on the page: **{k} could not be removed because they have already joined the exam.** with the names.

**Add candidates**: a search box (name, MER or outlet), a **Select all shown** checkbox, the list of active candidates who are **not** assigned (checkbox, MER, name, outlet), and **Add selected ({n})** (Primary, disabled at zero). Success toast: **{n} added.** and, if any were already assigned, **{m} were already assigned.**

- Late assignment while the exam is live is allowed (contract 4.2). A Notice says so: **This exam is live. New candidates can sign in and get the same end time as everyone else.**
- Once the exam is `ended`, both controls are disabled with **The exam has ended, so candidates can no longer be added or removed.**

---

## 4. Question builder (1E)

`admin/exams/[id]/questions`. Two panes on laptop: a **question list** on the left (320 px) and the **editor** on the right.

### 4.1 Question list

- Header: **{n} questions · {m} MCQ · {w} written**. Every candidate receives every question in this composed list.
- Buttons: **Add MCQ** and **Add written question** (Secondary; the page's one Primary is **Save question** in the editor).
- Each row (button, 56 px): drag handle, number, a type word (**MCQ** or **Written**), the first 60 characters of the question (plain text, `lang` set per content), and the key status in words: **Key complete** or **Key missing**.
- **Reorder:** drag by the handle, **and** a **Move up** / **Move down** pair in the row's menu, so it works with a keyboard (2A §5). Saving the new order calls the reorder route.
- A **Show only: Key missing** filter chip with the count.
- **Empty:** **No questions yet. Add a multiple-choice or written question to start.**

### 4.2 Editor

| Field | Rules |
|---|---|
| Type | Chosen when the question is created, shown as a label after that. Help: "The type can't be changed. To switch, delete the question and add a new one." |
| Question text | Tiptap editor (2A 4.15). Toolbar only offers what the allowlist allows: bold, italic, underline, strike, lists, headings 2–3, sub/superscript is **not** offered, and font size through the custom extension. Max 50,000 characters |
| Optional image | Checkbox **Add image**. When enabled: upload/select JPEG, PNG or WebP up to 4 MiB; required alt text (1–500 characters); preview plus **Replace image** and **Remove image**. Help: **Describe only what the candidate needs from the image. Do not include the answer or a hint.** Upload through the admin image route to the private `question-images` bucket. The database saves all four metadata fields together or none; a partial record is rejected |
| Marks | Number, step 0.25, **optional**. Placeholder **1**. Help: "Leave empty for 1 mark. Candidates see this next to the question." Range above 0, up to 999.99 |

**MCQ** also has:
- **Options**: 2 to 10 rows, each a small rich-text field (no headings, max 5,000 characters), a **Correct answer** radio, and a **Remove** (Quiet) button. **Add option** (Secondary) adds a row. The row letters (A, B, C…) are an editing aid only. Help under the list: "Candidates see letters by their own position, and the order can be shuffled."
- Exactly one correct answer is required. If none is chosen on save: **Choose the correct answer.**

**Written** also has the answer key block (§4.4).

**Buttons:** **Save question** (Primary; saves the question, then the key) and **Delete question** (Destructive; Draft or Scheduled only). Delete dialog: title **Delete question {n}?**, body **This cannot be undone.**, buttons **Delete question** / **Keep question**.

### 4.3 Locked while live

From `live` onward (contract 4.3, task 1E.7) the editor shows this Warning banner at the top:

> **Questions are locked while the exam is live.** You can still edit answer keys.

The question text, marks, options, **Add**, **Delete** and reordering are disabled. The **answer key** fields stay editable (§4.4) and save through `PUT /api/admin/answer-keys`.

Why the full lock is shown to the admin in words: "Deleting or changing a question now would change the papers candidates already have." One short line under the banner.

### 4.4 Answer key

Shown for every question. A heading **Answer key** and a status word (**Complete** or **Missing**).

- **MCQ:** the **Correct answer** radio already in the options. Before the exam goes live it saves with the question. Once live it saves through the answer-key route (the options themselves are locked, the correct one is not).
- **Written:** four fields in the order of importance (Section 5 §9):
  1. **Model answer** (textarea, max 10,000). Help: "The ideal answer in one or two sentences. English is best. Sinhala is fine."
  2. **Grading notes** (textarea, max 4,000). Help: "Most important. List the key points and their marks. Say how many are needed for full marks and what to accept or reject. Example: 'Four key points, 1 mark each, any two earn full marks. Accept Sinhala or Singlish.'"
  3. **Calibration examples** (up to 10 rows: **Answer**, **Marks** 0 to the question's marks, **Note**). Help: "Add 2 to 4 short sample answers with the marks you would give: one full, one partial, one zero. Include one Singlish answer if you can. Use answers you invent, not real staff answers."
  4. A collapsible **How to write a good answer key** panel containing the worked niacinamide example from Section 5 §9.

**Save answer key** (Secondary) is its own button when the question is locked, so an examiner can fix a key during or after the exam without touching the question.

**Answer key states**
| Situation | Screen |
|---|---|
| A grading run is `running` or `paused` | The key fields are disabled with **Answer keys are locked while grading is running, so every candidate is graded against the same key. You can edit them once it finishes.** (contract `409 grading_in_progress`) |
| Saved and `regrade_needed` is true (written question) | Notice under the key: **Scores already exist for this question. Regrade it so the new key is used.** with the button **Regrade this question for everyone** (Secondary). It calls route 41 and then shows the run in the grading tab: toast **Regrading {n} answers.** If the response says overrides exist: **{m} candidates keep their manual marks.** |
| Saved and `regrade_needed` is true (MCQ) | Notice: **The correct answer changed after grading. Rescore the multiple-choice questions.** with the button **Rescore MCQs** (Secondary). It calls the grade route with `{ "mcq_only": true }`. Help line: **This does not use any Gemini calls.** |
| Missing key found by the grade route (`409 missing_answer_keys`) | Shown in the grading tab (§8.2) with a link to each question |

### 4.5 Saving and errors

- **Save question** sends the complete question, options, image metadata and answer key through the atomic `save_question` function. Any failure rolls back the whole save. The editor retains its client-generated question and option ids, so retrying after a lost response updates the same records without duplicates. **Save answer key** remains separate when the question is locked or the examiner explicitly saves only the key.
- Leaving with unsaved edits opens the same **You have unsaved changes.** dialog as §3.2.
- Error copy for every code is in §11.

---

## 5. Candidates

### 5.1 List (1C.2)

Header: **Add candidate** (Primary) and **Import CSV** (Secondary). Under it: a search box (**Search by MER code, name or outlet**), a status filter (**Active**, **Inactive**, **All**; default Active) and an exam filter (**All exams** or one exam).

Table columns: **MER code**, **Name**, **Outlet**, **Status** (Active or Inactive, word and icon), **Exams** (assigned count), and the actions **Edit** (Secondary) and **Unlock login** (Quiet). Page size 50, with Previous/Next under the table when there is more than one page. The ID number is never shown (the route never returns it).

**Unlock login** calls route 18. Toast **Cleared 5 failed login attempts for MER-0412.** or **There were no failed attempts to clear.** It needs no confirmation: it is the safe, cheap fix for a candidate who mistyped their ID five times.

Empty: **No candidates yet. Add one, or import a CSV.**

### 5.2 Add and edit (1C.3)

| Field | Rules |
|---|---|
| MER code | Text, uppercased as typed. **Disabled when editing.** Help: "The MER code is the login key and can't be changed. To use a different code, create a new candidate." |
| Full name | Text, may be Sinhala |
| Outlet | Text, may be Sinhala |
| ID number | Add: required. Edit: empty keeps the current one. Help: "Old format (9 digits then V or X) or new format (12 digits). It is stored hashed and can't be shown again." |
| Active | Edit only. Checkbox: **Active.** Help: "Inactive candidates can't sign in. Their history is kept." |

Buttons: **Save** (Primary), **Cancel** (Secondary), and on edit **Delete candidate** (Destructive). Delete dialog: **Delete this candidate?** / **This removes {name} and cannot be undone.** / **Delete candidate** / **Keep candidate**. A `409 has_attempts` shows **This candidate has taken part in an exam, so they can't be deleted. Mark them inactive instead.**

There is **no photo field** (plan 1C.3).

### 5.3 CSV import (1C.4)

A three-step page with a Step indicator: **1 Choose file**, **2 Check**, **3 Import**.

1. **Choose file.** A file picker for `.csv` and a **Download template** link (columns `mer_code, full_name, outlet, nic`). Help: "Save from Excel as **CSV UTF-8** so Sinhala names stay correct." Notice: **The file contains ID numbers. Delete it from your computer after importing.** The page parses the file in the browser (Papaparse). Shows the row count and the first 10 rows.
2. **Check.** Option **If a MER code already exists:** **Skip it** (default) or **Update it**. Help under the options: **Update replaces the full name, outlet and ID hash. A blank outlet clears the existing outlet.** Button **Check file** (Primary) runs `dry_run: true` in batches of 50 and then shows **{a} will be added, {u} will be updated, {s} skipped, {e} have errors.** Errors are a table (**Row**, **MER code**, **Problem**) with the plain-language message, for example **This ID number isn't valid.**
3. **Import.** **Import {n} candidates** (Primary, enabled when at least one row is valid; rows with errors are skipped and the button says so). A progress line **Imported 100 of 230** updates after each batch. Finish: **Done. {a} added, {u} updated, {s} skipped.** with **Back to candidates**.

A failed batch stops the import with **The import stopped after {n} rows. Nothing after that was saved. Fix the problem and run the file again with "Skip" selected.** (Rows are independent and re-running with Skip is safe.)

---

## 6. Exam controls (on the live page)

The controls sit in the live page header (§7.1). Each opens one dialog (2A 4.7: named buttons, one dialog at a time, focus on the safe button for anything destructive). Every control writes an `admin_actions` row (contract 1.6) and publishes its Broadcast message.

| Control | Shown when | Button style |
|---|---|---|
| **Start now** | Draft or Scheduled | Primary (the page's one primary) |
| **Announcement** | Scheduled or Live | Secondary |
| **Extend time** | Live and the end time has not passed | Secondary |
| **End exam** | Live | Destructive |
| Flag threshold field | Any status except Finalized | Number field in the header |

In Draft the **Announcement** button is disabled and a tooltip-free line under the header says **Schedule the exam to send messages.** (the route needs `scheduled` or `live`).

### 6.1 Start now (route 26)

| Part | Text |
|---|---|
| Title | **Start the exam now?** |
| Body | **{n} candidates are assigned and {k} have accepted the rules (status **Ready**). They will have {duration} minutes from now.** If a start time is scheduled: **The scheduled start ({time}) will be replaced.** |
| Buttons | **Start exam** / **Not yet** (focus on **Not yet**) |
| Errors | `409 invalid_status`: **The exam has already started or ended. Reload the page.** `409 exam_has_no_questions`: **Add at least one question first.** `409 no_candidates_assigned`: **Assign at least one candidate first.** |

### 6.2 Extend time (route 27)

- A segmented control **Everyone** / **One candidate** (preselected when opened from a candidate panel, with the candidate named).
- **Minutes:** quick buttons 5, 10, 15, 30 and a number field (1–120).
- A live preview line: **The exam will end at 12:45 pm (now 12:35 pm).** For one candidate: **{name}'s time will end at 12:50 pm.**
- Buttons **Extend time** (solid ink) / **Cancel**.
- Success toast: **Added 10 minutes for everyone.** or **Added 10 minutes for MER-0412.**
- Errors: `409 deadline_passed`: **The time is already up, so it can't be extended.** For one candidate whose own deadline has passed or who has submitted: **This candidate's time is already up or they have submitted.**
- Server compare-and-set retries are invisible to the admin. If all three retries lose, the route returns `409 concurrent_update` (contract 4.4) and the dialog shows **Someone else changed the time at the same moment. Check the time shown and try again.**

### 6.3 Announcement (route 29)

| Part | Text |
|---|---|
| Title | **Send announcement** |
| Field | Textarea, plain text, with a counter **0 / 5000**. May be Sinhala, English, mixed or Singlish |
| Recipients | Radio buttons **All assigned candidates** (default) / **Selected candidates**. Selected mode shows a searchable checkbox list with MER code and name, a selected count, and requires at least one candidate. Only candidates assigned to this exam can be selected |
| Display time | No control. Every candidate announcement displays for a fixed **5 seconds** |
| Help | **Each selected candidate sees this once as a top-right notification. It disappears after 5 seconds and cannot be reopened. You can send as many announcements as needed.** |
| Buttons | **Send message** (solid ink) / **Cancel** |
| Previous messages | Admin-only list below the field: Colombo time, text, and **All ({count})** or **Selected ({count})**. Candidates never receive this history |
| Errors | Validation errors are shown beside the field. An empty custom selection says **Select at least one candidate.** A stale/unassigned selection says **One or more selected candidates are no longer assigned to this exam. Refresh and try again.** There is no per-exam count limit |

Publish failure never fails the send (contract 4.4): the candidate gets the message on their next 10-second heartbeat. The admin sees **Sent.**

### 6.4 End exam for everyone (route 28)

| Part | Text |
|---|---|
| Title | **End the exam for everyone?** |
| Body | **{k} candidates are still working. Their screens will lock now, their latest available answers (including partial written answers) will be collected and submitted, and they won't be able to continue. This cannot be undone.** |
| Buttons | **End exam for everyone** (solid ink with the verb, per 2A 4.1) / **Keep exam running** (focus here) |
| Result toast | **Exam ended. Collecting final answers from {working} candidates.** The finalized counts update after the 15-second collection window |

The request carries `confirm: true` (contract 4.4). The dialog is the only confirmation. It does not ask the admin to type anything: on exam day speed matters, and the safe button holds the focus.

### 6.5 Force-submit and kick one candidate (routes 30, 31)

From the candidate panel (§7.5).

| Action | Dialog |
|---|---|
| **Submit exam for this candidate** (Destructive) | Title **Submit {name}'s exam now?** Body **Their answers so far are saved and submitted. They can't continue.** Buttons **Submit their exam** / **Cancel**. Sends `confirm: true`. Toast **Submitted {MER}'s exam.** If the response says it was already submitted: **{MER} had already submitted.** |
| **Sign out this candidate** (Secondary) | Title **Sign {name} out?** Body **They are signed out and can sign in again to continue. Their time keeps running.** Buttons **Sign out candidate** / **Cancel**. Toast **Signed out {MER}.** If LiveKit removal failed (`livekit_removed: false`): add **Their video may stay on the grid for a moment.** |
| **Unlock login** (Quiet) | No dialog. Same toast as §5.1 |

---

## 7. Live view (4C, 3C, 5A)

### 7.1 Layout

`admin/live?exam=<id>`. With no `exam` parameter the page opens the one exam that is Live; if none is live, the next Scheduled one; if several fit, a short list to choose from. If there is nothing: **No exam is live or scheduled. Open Exams to schedule one.** with a **Go to Exams** button.

Top to bottom:
1. **Header (sticky):**
   - Exam title, status badge, and the **Timer** (2A 4.4): **Time left 32:10** when live, **Starts in 12:05** when scheduled, **Ended** after. It uses the server clock offset, not the device clock.
   - A summary line with every status that has at least one candidate, for example **23 assigned · 20 in exam · 1 offline · 2 not joined.** (Updates are announced politely at most every 10 seconds.)
   - The controls from §6 and the flag threshold field **Flag at [10]**. It saves on Enter or when it loses focus, with the toast **Flag threshold set to 8.** An out-of-range value shows **Enter a number from 1 to 100.** and is not sent.
2. **Banners** (at most two): the "Live updates paused" banner (§7.7), the video-down banner, a **This exam has ended** Notice with **Open results**.
3. **Filter chips and sort** (§7.4).
4. **The grid.**
5. **The candidate panel** slides in from the right over the grid (§7.5); it does not push the grid around.

**Grid size.** At 1280 px wide the grid is 5 columns of 4:3 tiles (23 tiles = 5 rows), 6 columns from 1600 px. Tiles have a minimum width of 200 px. The page scrolls vertically.

### 7.2 Status words (4C.5, 2A 4.10)

One status per tile. The first rule that matches wins:

| Order | Status | Rule |
|---|---|---|
| 1 | **Submitted** | `attempts.status` is `submitted` or `finalized` |
| 2 | **Not joined** | `attempts.status` is `not_started` |
| 3 | **Offline** | `acknowledged` or `in_progress`, `last_seen_at` is set, and it is older than 25 s (display only, Section 4 §2; the logged `DISCONNECTED` event starts at 30 s). A candidate who has not sent a first heartbeat yet is not Offline |
| 4 | **Camera off** | `acknowledged` or `in_progress`, heartbeat fine, and no video track from LiveKit participant `c_{attempt_id}` for 10 s (a new rule of this spec). It uses the video track only: Section 4 sends `CAMERA_LOST` when the loss ends, so an open one can't be seen |
| 5 | **In exam** | `in_progress` |
| 6 | **Ready** | `acknowledged` (accepted the rules, has not loaded the paper) |

**Camera off** can mean a stopped camera or a LiveKit-only fault (the camera works but the video isn't reaching the server). The candidate panel says only what is known: **No video received. The camera may be off, or the connection to the video server may be down.** Once the loss ends, the timeline shows a `CAMERA_LOST` row, and its source (`track` is the device, `livekit` is the connection) tells which it was.

Progress label under the tile (2A 4.12): **Q 7/20** in sequential mode, **14 answered** in free mode, from `attempt_progress` (polled every 10 s). Not shown for Not joined or Submitted.

### 7.3 Video tile (2A 4.12)

- 4:3 video (low-resolution layer), then below it: **MER code** (bold), name, the status badge, the violation badge, the progress label, and a speaker toggle (`aria-pressed`, 44 px).
- **Violation badge:** the number and the word (2A 4.11): **0 violations**, **3 violations**, amber warning icon from half the threshold, alert icon and **Flagged** at the threshold. The accessible name is complete, for example **MER-0412 A. Perera, In exam, 3 violations, flagged**.
- **No coloured border** on a tile. Flagged is the word and icon only.
- **Missing video:** a neutral placeholder with the words **No camera**.
- **Speaker toggle:** only **one candidate's audio plays at a time**. Turning on another turns the first off. This avoids a pile of overlapping voices in one room (decision of this spec). Audio is subscribed only while the toggle is on (task 4C.3).
- **Click or Enter** on the tile opens the candidate panel. The tile is one focus stop. The speaker toggle is a second focus stop inside it.
- When the tile turns red from a live update, a bottom-right toast says **MER-0412 reached the flag threshold.** (client-side, task 3C.2). It stays for 6 s and does not steal focus.

### 7.4 Filters and sort

- **Filter chips with counts**, single choice: **All 23**, **Flagged 2**, **Offline 1**, **Camera off 0**, **Not joined 2**. The count updates live. An empty filter shows **No candidates match.**
- **Order:** always ascending by normalized MER code. There is no "Needs attention first" sort and live incidents never move tiles. Filters narrow the fixed-order list without changing relative MER order.

### 7.5 Candidate panel (4C.4)

A 440 px side panel over the right side of the grid, opened from a tile. It stays open when updates arrive. **Escape** or **Close** closes it and returns focus to the tile.

From top to bottom:
1. Title **{MER code} {name}**, outlet, and **Close**.
2. The video, larger (higher-resolution layer), with its own speaker toggle.
3. Status badge, violation badge, progress, **Last seen 12 s ago**, and the signal line from §7.2 when the status is Camera off.
4. Buttons: **Extend time for this candidate** (Secondary, opens §6.2 with this person selected), **Sign out this candidate** (Secondary), **Submit exam for this candidate** (Destructive), **Unlock login** (Quiet). Buttons for actions that don't apply are disabled with the reason as visible text (for example **Submitted**).
5. The **Violation timeline** (§7.6).

### 7.6 Violation timeline (3C.1, 3C.4, 3B.7)

Phase 3 provides the reusable `ViolationTimeline`, `CandidateBadge`, `ThresholdControl`, and `useViolationRealtime` building blocks with unit tests. They remain unmounted until the Phase 4 live grid supplies the selected attempt, media tiles, and event-loading route; Phase 3 does not add a second temporary admin screen.

A Data table (2A 4.13) inside the panel (and reused on the review screen, §9.2). Newest first. A summary line sits above it: **4 counted · 9 logged · 5 snapshots.** A checkbox **Hide events that didn't count** (off by default; uncounted rows are muted with the reason in words).

Columns: **Time** (`9:30:12 am`), **Event**, **Length**, **Counted**, **Snapshot**, **Action**.

| Event type | Admin wording |
|---|---|
| `TAB_HIDDEN` | Switched tab or minimised |
| `FOCUS_LOST` | Left the exam window |
| `FULLSCREEN_EXIT` | Left fullscreen |
| `VIEWPORT_CHANGED` | Screen size changed (split view or side panel) |
| `MULTI_SCREEN` | Second screen detected |
| `CAMERA_LOST` | Camera stopped |
| `MIC_LOST` | Microphone stopped |
| `DISCONNECTED` + `RECONNECTED` | Connection lost, then **Back after 3 m 20 s** (paired into one row, 3C.4) |
| `MULTI_LOGIN` | Signed in on another device |
| `COPY` | Copy attempted |
| `PASTE` | Paste attempted |
| `CONTEXT_MENU` | Right-click attempted |
| `RELOAD` | Page reloaded |

- **Merged types** show under the event as **Also: Left fullscreen**.
- **Counted:** **Yes** or **No**, and for disconnections the reason in words from `count_reason` (Section 4 §7.2): `long_gap` **Counted: no heartbeat for about 3 minutes**; `short_gap` **Not counted: returned quickly**; `overlap` **Not counted: a tab switch already covers this**; `reversed_by_focus` **Reversed: a tab switch covers this**; `dismissed` and `restored` **Changed by an admin**, with their note. Repeating throttled pairs collapse into one row with a count (**×3**).
- **Snapshot:** a 48 px thumbnail button (alt text **Snapshot at 9:30:12 am**). It opens a dialog with the image large. The image URL is a signed URL valid for 300 s, so the dialog fetches a fresh one each time it opens. A row with no snapshot says why in words: **No snapshot: camera was off** or **No snapshot: black frame** (from `meta.snapshot_skipped`), **Upload failed** (`meta.snapshot_error`), **Snapshot deleted** (`meta.snapshot_deleted_at`, set by the purge, contract 4.5), and plain **No snapshot** for event types that never take one
- **Action:** **Dismiss** on a counted row and **Restore** on a dismissed row, both through route 40. The dialog needs a note (1–300 characters): title **Dismiss this event?**, body **It will no longer count toward {name}'s total. Say why, for example "Notification shade, not a real tab switch."**, field **Note**, buttons **Dismiss event** / **Cancel**. Restore is the same with **Restore this event?** The dismissed row then shows **Dismissed: {note}** and who and when.
- Errors: `400 note_required` **Add a note.** `409 not_dismissable` **This event isn't counted, so there is nothing to dismiss.** `409 not_restorable` **This event wasn't dismissed.**

### 7.7 Live updates and when they fail

| Data | Source | How it updates |
|---|---|---|
| Status, last seen, violation count | `attempts` | Realtime on `attempts` filtered by `exam_id` |
| Progress label | `attempt_progress` | Poll every 10 s (views are not in Realtime) |
| Exam status, end time | `exams` | Realtime on `exams` |
| Timeline | `violation_events` | Realtime, filtered in the page, only while a panel is open |
| Video and audio | LiveKit | Admin token from route 14 |

- **Admin connection lost.** If Realtime disconnects, the Warning banner **Live updates paused. Reconnecting…** appears, with **Last updated 12:31:05 pm**. The page falls back to refetching `attempts` every 10 s until Realtime returns, then the banner goes away by itself. Video is separate: a LiveKit problem shows **Video is not available. Status, progress and violations still update.**
- **Stale data is never shown as live.** While the banner shows, the summary line is labelled **(as of 12:31 pm)**.

---

## 8. Results and grading (6D, 7)

### 8.1 The Results page

`admin/results?exam=<id>`. An exam select at the top (Finalized or Ended exams), then Tabs: **Grading** and **Summary** (the Summary tab is the `results/summary` page).

### 8.2 Grading tab (6D.1–6D.3)

The tab shows one state at a time, from the exam and the latest run.

| State | What is shown |
|---|---|
| **Exam not finalized** | Exam live: **The exam is still running. Grading starts after it ends.** Exam ended: **The exam has ended and is being finalized. This takes less than a minute.** (the worker finalizes on its next tick). **Start grading** is disabled with that reason as visible text |
| **Ready, no run** | A short list of what will happen: **MCQs are scored by code. Blank written answers get 0. Written answers are graded by AI.** and the reminder **Grading uses your free Gemini quota. Check your limits in AI Studio before you start.** Button **Start grading** (Primary) |
| **Running** | See below |
| **Paused** | A Warning banner with the reason (below) and a **Resume** button when the admin has to act |
| **Failed** | **Some grading jobs failed.** with the count and **Resume** (retries the failed jobs; the resume route takes no options, and jobs that never ran are picked up by the worker anyway) |
| **Done** | **Grading finished. {n} candidates graded, {r} questions need review, {u} not graded.** with buttons **Open summary** and **Show questions to review** |

**Start grading** results and errors:
- `202`: the page switches to Running and shows **Started. About {estimated_calls} Gemini calls.** (the route returns `estimated_calls`; the page can't know it earlier) and the line **{mcq_scored} MCQ answers scored, {auto_zero} blank answers set to 0.**
- `409 missing_answer_keys`: a Notice lists each question without a key as a link to that question in the builder: **These questions have no answer key. Add them, then start grading.**
- `409 grading_in_progress`: **A grading run is already running. Open it below.**
- `409 exam_not_finalized`: the first state above.
- **Rescore MCQs only:** a Secondary button **Rescore MCQs only** in the Done state (and in the answer-key Notice, §4.4) calls the grade route with `{ "mcq_only": true }`. Help: **Use this after fixing an MCQ answer key. It does not use any Gemini calls.**

**Running view** (Realtime on `grading_jobs` and `grading_log`, plus the worker's `system_health` detail):
- A progress bar with words: **Jobs done 18 of 46** and, for a super admin only (it needs the slot data), a time estimate **About 12 minutes left**.
- A **Keys** table, one row per key and model slot from `system_health.detail`: **Key** (label such as key1), **Model**, **Used today** (`12 / 20`), **Status** (**Active**, **Cooling until 2:05 pm**, **Disabled**). **Super admin only**: `system_health` can only be read by a super admin (row-level security). A plain admin sees the line **Key details are shown to the super admin.** instead, and still sees the progress bar, queue, log and the paused banner, which come from `grading_jobs` and `grading_log`
- **Queue:** pending, running, failed counts.
- **Not graded:** **N questions not graded** (written questions without a score row).
- **Log:** the last 50 `grading_log` rows (time, event, key label, model, detail). It never shows answers, prompts or keys.
- Quota reset: **Quota resets at 12:30 pm Colombo time** (the next Pacific midnight, converted by the same `quota-day` helper the worker uses).

**Paused reasons** (from the latest `paused` log row):
| `detail` | Banner text | Button |
|---|---|---|
| `keys_exhausted` | **All keys are used for today. Grading resumes by itself at {resume_at}.** | none (auto-resume) |
| `all_keys_disabled` | **Every key is disabled. Fix the keys, then resume.** (link to Health for a super admin) | **Resume** |
| anything else | **Grading is paused.** | **Resume** |

`Resume` calls route 36 and shows **Resumed. {n} jobs queued again.** A `409 not_resumable` shows **This run can't be resumed.**

---

## 9. Results summary, review, override, print

### 9.1 Summary tab (7.1, 7.4, 7.5)

Header line: **{k} of {n} results are final.** A result is **final** when it has no unscored questions and no question that needs review (Section 5 §8.1). **{n} counts only candidates who took the exam** (absent candidates are listed but never counted). Actions: **Export CSV** (Secondary, route 39).

A Data table, one row per assigned candidate:

| Column | Content |
|---|---|
| MER code, Name, Outlet | |
| Status | **Absent** (never joined), **Submitted**, **Forced** (the exam team ended it: submit reason `forced`), **Auto** (time ran out: submit reason `auto`, which is also what the worker uses at the deadline) |
| Violations | **{counted} counted · {logged} logged** |
| MCQ, Written, Total | marks, tabular digits |
| % | one decimal. Blank for Absent |
| Review | **{n} to review** |
| Not graded | **{n}** |
| Final | **Yes** or **Not final** |

Filter chips: **All**, **Needs review**, **Not graded**, **Flagged**, **Absent**. Sort by any column header. A row opens the review screen (§9.2). Absent candidates are listed but have no review link (**Did not take the exam**).

**Export CSV:** downloads with the UTF-8 byte-order mark. If the export is requested while some results are not final, a Notice sits above the button: **{n} results are not final yet.** (the file still downloads).

### 9.2 Review screen (6D.4, 7.5)

`admin/results/[attempt]`. Header: candidate name, MER code, outlet, **Total 17.5 / 24 (73%)**, a **Final** or **Not final** word, **Violations: 4 counted, 7 logged** (a link that opens the §7.6 timeline in a side panel), and buttons **Print** (Secondary, opens the print page) and **Back to summary**.

- A Warning banner if any written question has no score: **{n} questions not graded.**
- Filter: **Show all** / **Needs review ({n})**.
- **Question subset (7.5):** a line **Questions on this paper: 3, 7, 9, 12…** (admin numbers).

One block per question on the candidate's paper, in the order the candidate saw it:

1. Heading: **Question {paper number}** and **(question {admin number} in the exam)**, the marks **1.5 / 2**, and a source word: **MCQ**, **AI**, or **Override**.
2. The question text, followed by the optional question image with its alt text. A failed private-image load shows **Image unavailable** and does not hide the answer or marks.
3. **Candidate's answer.** Written: the text in a box with `lang` set per content (Sinhala sizing). MCQ: the selected option, and **No answer** when blank.
4. **Model answer** (collapsed by default) and, for MCQ, the correct option.
5. For AI-graded questions: the **reason**; **Matched points**, **Missing points**, **Incorrect claims** as short lists; **Confidence 82%**; **Language** (English, Sinhala, Singlish, mixed); **In English:** the `candidate_meaning_english` line for Sinhala and Singlish answers; and in small type **Graded by {model}, prompt {version}**.
6. **Review reasons** in plain words when the question needs review: `low_confidence` **Low confidence**; `low_confidence_singlish` **Low confidence on a Singlish or mixed answer**; `verdict_mismatch` **Verdict and marks don't agree**; `no_answer_on_nonblank` **Marked "no answer" but the candidate wrote something**; `points_mismatch` **Points and marks don't agree**; `clamped` **Marks were outside the allowed range and were adjusted**; `truncated_answer` **The answer was cut before grading**; `empty_reason` **No reason was given**.
7. Buttons on each block: **Override marks** (Secondary), **Accept AI marks** (Secondary, only when the question needs review), **Regrade this question** (Secondary; disabled with the reason in words for MCQ, blank answers, and exams that are not finalized).

**Override and accept:** both use route 37, which requires the attempt to be `finalized`, a note, and marks from 0 to the question's marks.
- **Override marks** dialog: title **Override marks for question {n}**, a **Marks** field (shows **out of 2**), a **Note** field (required, 1–1000 characters; help **Explain why, for example "Mentioned both effects in Sinhala."**), buttons **Save marks** (solid ink) / **Cancel**.
- **Accept AI marks** dialog: title **Accept the AI marks?**, body **The marks stay at 1.5 and the question is marked as reviewed. It then counts as a manual mark, so a regrade won't replace it.**, with the note prefilled **Accepted AI marks after review.** (editable), buttons **Accept marks** / **Cancel**.
- After saving, the block shows **Override** with the note, who and when (**Override by {name}, 3 Oct 2026, 11:04 am: "{note}"**), and the totals at the top update from the response. An override can only be changed by overriding again (there is no undo, contract 4.6). The dialog says so in one line: **To change this later, override again.**
- Errors: `400 marks_out_of_range` **Marks must be between 0 and {max}.** `400 not_in_paper` **This question isn't on this candidate's paper.** `409 not_finalized` **This result can't be changed until the exam is finalized.** `400 note_required` **Add a note.**

**Regrade this question (route 38):** body **Grade this answer again with the current answer key. A manual mark for this question is kept.** Buttons **Regrade** / **Cancel**. Toast **Regrading started.** The page then updates from Realtime when the job finishes. `409 nothing_to_grade` **There's no written answer to grade for this question.**

### 9.3 Print page (7.3)

`admin/results/[attempt]/print`. Reads `current_scores`, never the raw table.

- A control row (hidden when printing): checkbox **Include model answers** (off by default), **Print or save as PDF** (Primary, the browser print dialog) and **Back**.
- The page itself is A4, black on white, Noto Sans Sinhala for Sinhala text (2A §1.2). **No colour carries meaning** in print: marks, source (**AI** or **Override**) and **Final / Not final** are words.
- Content: exam title and date, candidate name, MER code and outlet, the total and percent; then each question with its text, optional image scaled within the printable width, the candidate's answer, the marks, and the reason; with model answers when the checkbox is on. Page breaks never split a question block.
- The footer on each page: **{name} · {MER} · page {n} of {total}**. The header says **Not final** when any question is unscored or needs review.

---

## 10. Health and alerts (5C, super admin only)

`admin/health`. Refreshes itself every 15 s, with **Last checked 8 s ago** and a **Check now** button (Secondary).

| Row | Shows |
|---|---|
| **Supabase** | **OK** or **Not responding**, and the latency **42 ms** |
| **LiveKit** | **OK** or **Not responding**, latency, and **1 room** |
| **Worker** | **OK** with **Last heartbeat 12 s ago**, or **Not responding. Last heartbeat 3 minutes ago.** when it is over 90 s old (a Warning with the words, not only colour) |
| **Gemini keys** | A table from `api_key_state`: **Key**, **Status** (Active, Cooling until {time}, Disabled), **Last error**, **Checked** |
| **Active alerts** | A table (severity icon and word, message, time, **Resolve**), newest first. **No active alerts.** when empty |

- **Resolve** (route 33) is Quiet and needs no confirmation. Toast **Alert resolved.**
- The alert **chip in the top bar** (super admin only) says **{n} alerts** and links here. It is hidden at zero. Critical alerts say **{n} alerts, 1 critical**.
- **Snapshot cleanup** (task 7.7, route 34) is a section at the bottom:
  - **Delete snapshots older than [14] days.** A **Check** button (`dry_run: true`) shows **412 snapshots would be deleted.** Then **Delete snapshots** (Destructive) opens a dialog: **Delete {n} snapshots?** / **The photos are removed. The event records stay.** / **Delete snapshots** / **Cancel**.
  - **Delete all snapshots for an exam** (post-exam cleanup, `older_than_days: 0`): an exam select and the same two-step flow with `confirm: true`. The dialog adds **This removes every snapshot for "{title}".**
  - The line **Snapshots are also deleted automatically after {retention} days.** shows the real number.

---

## 11. Empty states, errors and accessibility

### 11.1 Empty states (2A 4.16: what this is, why it's empty, one next step)

| Screen | Text |
|---|---|
| Exam list | **No exams yet. Create the first one to add questions and candidates.** [New exam] |
| Question list | **No questions yet. Add a multiple-choice or written question to start.** |
| Candidate list | **No candidates yet. Add one, or import a CSV.** |
| Candidate list, search with no match | **No candidates match "{q}". Clear the search to see everyone.** [Clear search] |
| Exam candidates, available list empty | **Every active candidate is already assigned.** |
| Live view, no exam | **No exam is live or scheduled. Open Exams to schedule one.** [Go to Exams] |
| Live view, filter with no match | **No candidates match.** |
| Timeline, nothing logged | **Nothing has been logged for this candidate.** |
| Results summary, nothing graded | **No results yet. Start grading from the Grading tab.** |
| Alerts | **No active alerts.** |
| Keys table (no worker data yet) | **No key data yet. The worker writes it every 30 seconds once it is running.** |

### 11.2 Error messages

The server returns a code (contract 1.2). The page shows the sentence, never the code. A `details` list is shown as a short list under the sentence.

| Code | Message |
|---|---|
| `unauthorized` | **You were signed out. Sign in again.** |
| `forbidden` | **You don't have access to this.** |
| `not_found` | **That item no longer exists. Reload the page.** |
| `validation_failed` | **Check the highlighted fields.** (each field shows its own sentence) |
| `exam_locked` | **This exam has started, so that can no longer change. Answer keys can still be edited.** |
| `exam_not_deletable` | **Only a draft exam with no started attempts can be deleted.** |
| `not_ready` | **The exam isn't ready to schedule.** + the `details.missing` lines |
| `invalid_status` | **The exam isn't in the right state for that. Reload the page.** |
| `exam_has_no_questions` | **Add at least one question first.** |
| `no_candidates_assigned` | **Assign at least one candidate first.** |
| `concurrent_update` | **Someone else changed the time at the same moment. Check the time shown and try again.** |
| `deadline_passed` | **The time is already up, so it can't be extended.** |
| `type_immutable` | **A question's type can't be changed. Delete it and add a new one.** |
| `type_mismatch` | **That field doesn't apply to this type of question.** |
| `duplicate_mer` | **This MER code already exists.** |
| `invalid_nic` | **This ID number isn't valid. Use 9 digits then V or X, or 12 digits.** |
| `has_attempts` | **This candidate has taken part in an exam. Mark them inactive instead.** |
| `grading_in_progress` | **Grading is running, so this can't change right now.** |
| `missing_answer_keys` | **Some questions have no answer key.** + links to each |
| `missing_answer_key` | **This question has no model answer yet.** |
| `not_written` | **Only written questions can be regraded.** |
| `exam_not_finalized`, `not_finalized` | **This can't be done until the exam is finalized.** |
| `nothing_to_grade` | **There's no written answer to grade.** |
| `not_resumable` | **This run can't be resumed.** |
| `marks_out_of_range` | **Marks must be between 0 and {max}.** |
| `not_in_paper` | **That question isn't on this candidate's paper.** |
| `note_required` | **Add a note.** |
| `not_dismissable`, `not_restorable` | See §7.6 |
| `rate_limited` | **Too many requests. Wait a moment and try again.** |
| Network failure | **Can't reach the server. Check the connection and try again.** [Retry] |
| Anything else (5xx) | **Something went wrong on our side. Try again. If it keeps happening, tell the super admin.** [Retry] |

A button that triggered the request goes back to its normal state after any error, so the admin can try again. Nothing is shown twice (a toast **or** an inline message, not both).

### 11.3 Accessibility for the admin screens (2A §5 plus these)

- Every table is a real `<table>` with a caption, column headers, and `aria-sort` on sortable headers. Status and violation are always words as well as icons.
- **Tile grid:** the tile is one focus stop with a full accessible name (see §7.3). The speaker toggle is a second focus stop. The grid is not a trap: Tab moves through tiles in order, and the filter chips and header controls come before it.
- **Side panel:** opening it moves focus to its title. **Escape** and **Close** return focus to the tile that opened it. Screen readers get the panel as a `dialog`-less region (`role="complementary"` with a label), since the grid underneath stays usable.
- **Live regions:** the summary line, the toasts (including "reached the flag threshold", Section 2A §4.14) are polite (`role="status"`). The "Live updates paused" banner is a Warning banner with `role="alert"` (2A §4.6). Nothing announces more often than every 10 seconds.
- **Drag and drop** always has the **Move up** and **Move down** alternative (§4.1).
- **Dialogs** follow 2A 4.7. For End exam, Force submit, Delete and Purge the focus starts on the safe button.
- Colour never carries meaning alone. In print, no colour at all.
- Admin screens meet the same 2A contrast numbers. The muted text and the alert, warning and ok colours are used only on the surfaces that 2A lists.

---

## 12. Edits to make in `implementation-plan.md`

You said you will update the plan after all of Section 2 is done. These rows are for that pass. Rows already listed in 2A §7.3 and 2B §13 are not repeated.

| # | Task | Change |
|---|---|---|
| 1 | 1B.3 | Left nav: Exams, Candidates, Live, Results, Health (super admin only). Top bar with the alert chip (super admin), name, role, Sign out (§1) |
| 2 | 1B.1 | The sign-in messages in §2. No "forgot password" link |
| 3 | 1C.2, 1C.3, 1C.5 | Unlock login button on the list and in the live panel; the edit form rules in §5.2 |
| 4 | 1C.4 | The three-step import page and its copy (§5.3) |
| 5 | 1D.2 | Default flag threshold is **10** (plan still says 5). Field help text and the locked-field line (§3.2) |
| 6 | 1D.3 | **New file** `app/(admin)/admin/exams/[id]/candidates/page.tsx` (§3.4) |
| 7 | 1D.2 | Readiness list from the GET exam `warnings` (§3.3) |
| 8 | 1E.3–1E.7 | The two-pane builder, marks optional (default 1), the locked banner, a separate Save answer key, **Move up / Move down** for keyboard reordering (§4) |
| 9 | 1E.2 | The toolbar offers only the contract allowlist (no sub or superscript) |
| 10 | 3C.1, 3C.4, 3B.7 | Timeline columns, event wording, snapshot dialog, dismiss and restore dialogs (§7.6) |
| 11 | 4C.2 | Only one speaker on at a time (§7.3) |
| 12 | 4C.4 | The candidate side panel (§7.5) instead of an enlarged tile |
| 13 | 4C.5 | The status rules and their order (§7.2) |
| 14 | New | Filter chips with a fixed MER-code order; remove attention-first sorting (§7.4) |
| 15 | New | "Live updates paused" banner and the 10 s fallback (§7.7) |
| 16 | 5A.1–5A.4 | The five dialogs in §6, with focus on the safe button |
| 17 | 5A.5 | Announcements are **5,000 characters**, unlimited per exam, and appear as top-right 5-second toasts |
| 18 | 5C.1, 5C.3 | Health layout and alerts list (§10) |
| 19 | 7.7 | The snapshot cleanup panel on the Health page (§10) |
| 20 | 6D.1 | Optional body `{ "mcq_only": true }`. The UI shows `estimated_calls` after the start response (§8.2) |
| 21 | 6D.3 | The Grading tab states, key table, log and quota reset time (§8.2) |
| 22 | 6D.4, 6D.5 | **Accept AI marks** is an override with the same marks and a prefilled note (§9.2). Review reasons in plain words |
| 23 | 6D.6, 6D.8 | Regrade buttons on the review block and in the answer-key form (§4.4, §9.2) |
| 24 | 7.1 | Final / Not final column and the "k of n results are final" line (§9.1) |
| 25 | 7.3 | Print page controls, optional model answers, no colour in print (§9.3) |
| 26 | 7.4 | CSV column is `violations_counted` (the contract now matches the plan) |
| 27 | 7.7 | The purge function also sets `meta.snapshot_deleted_at` (contract 4.5) |
| 28 | 5A.2 | Extend returns `409 concurrent_update` after three lost races (contract 4.4) |
| 29 | 6D.3 | The Keys table and time estimate are shown to a super admin only (§8.2) |
| 30 | 2F.5 | Worker submits at the deadline with `auto` (see 2B §13 row 23). The summary's Forced / Auto labels depend on it (§9.1) |
| 31 | 4C.5 | Camera off uses the video track only; no open-`CAMERA_LOST` rule (§7.2) |
| 32 | 6D.3 | Remove the "retry jobs that never ran" checkbox: the resume route has no options (§8.2) |
| 33 | 1E.2 | Tiptap font size is a custom extension; optional question image uses the separate secure upload/select control (§4.2) |

**Already changed in the contract:** unlimited 5,000-character announcements, `violations_counted` in the CSV, the optional `mcq_only` body on the grade route, `409 concurrent_update` on extend, question images, and `meta.snapshot_deleted_at` on purge.

---

## 13. New tests (rehearsal and Phase 8)

IDs continue after Section 2B at 8.136. Each line is one test.

**Access and sign in**
- **8.136** — Wrong password shows the one message and never says which part was wrong.
- **8.137** — A signed-in user with no admin profile sees the "not set up" message.
- **8.138** — A plain admin who opens Health sees the 403 page. A super admin opens it.
- **8.139** — An admin page left open for 4 hours still works with no sign-in prompt (the cookie refreshes).

**Exams and candidates**
- **8.140** — Colombo 9:30 am saves as 04:00 UTC and displays as 9:30 am again.
- **8.141** — From live onward, only Title and Flag threshold are editable, the rest show "Locked while the exam is live."
- **8.142** — **Schedule exam** with no questions lists the missing items in words.
- **8.143** — Removing a candidate who has started is blocked and named. A late assignment while live works.
- **8.144** — CSV import of 230 rows in batches: a bad row is listed and skipped, the rest import, a Sinhala name from a UTF-8 CSV shows correctly, "Skip" and "Update" behave as labelled.
- **8.145** — Unlock login clears the count and the candidate can sign in.

**Question builder**
- **8.146** — Leaving marks empty saves 1. A question with 2.5 shows "2.5 marks" to the candidate.
- **8.147** — Reordering works by keyboard alone.
- **8.148** — While live, the question is locked, the answer key is still editable and saves through the key route.
- **8.149** — An MCQ with no correct answer shows "Choose the correct answer."
- **8.150** — Editing a key during a running grading shows the locked message.
- **8.151** — After a finished grading, changing a written key shows **Regrade this question for everyone**, and changing an MCQ key shows **Rescore MCQs** and creates **no** Gemini jobs.

**Live view**
- **8.152** — Each of the six statuses appears, and Offline beats Camera off.
- **8.153** — Tiles remain in MER order when status and violation updates arrive.
- **8.154** — Only one speaker is on at a time.
- **8.155** — Changing the threshold turns the right tiles amber or red and shows the red toast once.
- **8.156** — Switch off the admin's network: the "Live updates paused" banner shows, then clears when it returns, with the summary labelled "as of" in between.
- **8.157** — Stop LiveKit: the video-not-available banner shows and status, progress and violations still update.
- **8.158** — Tab to a tile, Enter opens the panel, Escape closes it and focus returns to the tile.
- **8.159** — A candidate whose camera is switched off shows **Camera off** after about 10 s, and the panel says "No video received…" (no claim about the cause). After the camera returns, the timeline row shows the source.
- **8.160** — A candidate who ran out of time offline appears in the summary as **Auto**, not **Forced**.

**Controls**
- **8.161** — **Start now** with a scheduled time says it will be replaced. The preview in **Extend time** shows the right new end time. Extending after the deadline is refused in words.
- **8.162** — Two admins extend at the same moment: neither extension is lost.
- **8.163** — More than 10 announcements can be sent. An **All** announcement reaches every currently assigned candidate; a **Selected** announcement reaches only the chosen MER codes. Every toast disappears after exactly 5 seconds, a 5,000-character Sinhala message renders safely, 5,001 characters are rejected, and each recipient sees each toast once only—even after refresh—with no candidate history or reopen control.
- **8.164** — **End exam** puts the focus on **Keep exam running**. Forcing one candidate submits only that candidate. A kicked candidate gets the session-revoked message and can sign in again.

**Timeline and snapshots**
- **8.165** — Dismiss without a note is refused. Restore brings the count back.
- **8.166** — A snapshot opened after 5 minutes still loads (a fresh signed link is fetched).
- **8.167** — A purged snapshot shows "Snapshot deleted".
- **8.168** — A paired disconnect shows "Back after 3 m 20 s" and its reason in words.

**Grading and review**
- **8.169** — Every state in §8.2 can be reached. A missing answer key lists each question as a link.
- **8.170** — The two pause reasons show the right banner and the right button. Resume requeues jobs. The quota reset time shows in Colombo time.
- **8.171** — The log never shows an answer, prompt or key.
- **8.172** — **Accept AI marks** creates an override with the prefilled note. An override out of range is refused with the max shown. A regrade keeps the override.
- **8.173** — A result with a question needing review shows **Not final**. Print shows Sinhala correctly, uses no colour for meaning, and never splits a question across pages.

**Health**
- **8.174** — Stop the worker: within 90 s the row says "Not responding" in words. Resolve an alert and the chip count drops. The snapshot **Check** shows a count before anything is deleted.

**Current requirement additions**
- **8.175** — Upload, preview, replace and remove an optional JPEG/PNG/WebP question image for both MCQ and written questions; oversize, spoofed MIME and missing alt text are rejected; a half-filled database record fails.
- **8.176** — End an exam while a candidate has an incomplete written answer: the UI reports the collection window, the answer is retained and graded, and final counts appear after collection closes.

---

## 14. Settled choices (change any you disagree with)

These are the choices this spec makes. None blocks the build.

| # | Choice | Result |
|---|---|---|
| 1 | Accepting an AI mark | An override with the same marks and a prefilled note |
| 2 | Announcement limit | 5,000 characters each, unlimited per exam |
| 3 | Rescoring MCQs after a key fix | Optional `mcq_only` body on the grade route, no Gemini jobs |
| 4 | Grid order | MER code, never reorders by itself |
| 5 | Speakers | One candidate's audio at a time |
| 6 | End exam confirmation | A dialog with the safe button focused, no typing required |
| 7 | Admin accounts | Created by hand in Supabase (task 1A.6). No admin-management screen |
| 8 | Language | English interface. Content can be Sinhala, English, mixed or Singlish |
| 9 | Print | Black and white, no colour carries meaning, optional model answers |
| 10 | Images in questions | One optional secure image for every MCQ or written question, with required alt text and a text-only fallback |
