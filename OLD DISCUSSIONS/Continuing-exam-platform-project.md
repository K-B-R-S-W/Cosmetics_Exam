> From: https://claude.ai/chat/fbd80df7-c778-40e5-8601-c122b882560e

# you asked

message time: 2026-10-01 09:45:43

here we have to continue with the new project exam platform. check the current files zip, and the last discussions. lets start where you left off

---

# claude response

I'll start by looking at the discussion file and the zip.

The last open question in that chat was whether Section 1 is fully folded into the implementation plan, so I'll check that now.

Now I'll look at how the implementation plan handles each of those tasks.

Still checking Section 1 against the plan. I'm filing the project notes, then I'll give you the verdict.

Section 1 is almost fully in the implementation plan. Two of the Section 1 edits and one piece of Section 1 content are missing.

I did not run the SQL, because my sandbox has no Postgres. I compared the plan text and the function signatures by reading them.

## What matches

- **Migration tasks:** 1A.1–1A.6 correctly point to `001_initial.sql` and the smoke test, and the old hand-written schema rows are gone.
- **The edit table:** 1C.3, 1D.3, 2C.2, 2E.4, 2F.1, 2F.2, 2F.5, 2F.6, 3A.1, 3B.1, 3C.2, 4C.2, 6B.1, 6C.2, 6D.4 and 5B.10 are all there. The `rpc()` parameter lists in 2E.4 and 2F.6 match the SQL function signatures exactly.
- **Result mapping:** the result-to-HTTP and result-to-client mappings are in 2E.4 and 2F.6.
- **Reference table:** the "What the migration provides" table matches the SQL.

## What's missing or wrong

1. **7.3 (PDF page) still says "Reads from `question_scores`".** Section 1 says it must read `current_scores`. This one matters: reading the raw table would show regraded or overridden marks wrongly in the PDF. 6D.4 and 6C.2 are already correct. Fix: change 7.3 to read from `current_scores`.
2. **The test-data cleanup script is not in the plan.** You said you'd clean test data after testing. The script (delete test exams and candidates, clear `login_attempts`, `alerts` and `admin_actions`) exists only in `section-1-migration.md`. It also needs a manual step to empty the `snapshots` storage bucket, which SQL can't do. Fix: add it as a task in Phase 8 and in the exam-day runbook.
3. **The migration's run notes are not in the plan.** These are: use a fresh Supabase project because the file isn't re-runnable, and it needs Postgres 15+. The plan also doesn't say the SQL was never executed, so the smoke test is the real proof. Fix: add them to 1A.1 and 1A.2, and make "smoke test prints SMOKE TEST PASSED" the "Done when" for Phase 1A. Phase 1 currently has no Done-when for the database step.

## Smaller things

- **Stale cross-references:** the tables near the end of the plan (around lines 483–568) still point to tasks 1A.8–1A.20, which no longer exist. They should say "`001_initial.sql`", or the fixes become hard to trace.
- **5A.3 (force-end):** it should say to call `rpc('submit_attempt', { p_reason: 'forced' })` for each attempt, like 2F.5 does. Right now it only says "submit with `submit_reason = 'forced'`", which could be coded as a direct table update that skips the DB rules.
- **Navigation lock:** `navigation_mode` is not locked in the database. It is only locked by the plan's UI rule and test 8.26. Add the check to the exam update route in 1D.4 (reject changes once the status is live or later), or the lock is only cosmetic.

Want me to make these edits in `implementation-plan.md` now? After that, Section 2 (design system and screen specs) is next.

---

# you asked

message time: 2026-10-01 10:00:15

here check? are we goon or issues or gaps? if not we can move to section API contracts. (we can do "Design system and screen specs" in the end)

---

# claude response

I'll compare the new plan with the earlier one and check each item I flagged.

The plan is in good shape, and I'd say we're good to move on. All the items from my last check are in. There is one real gap and one small leftover.

## What's now in the plan

- **7.3:** the PDF page now reads from `current_scores`.
- **Cleanup:** the test-data cleanup script is new task 8.30, with a runbook step in 8.12. It includes the manual step of emptying the `snapshots` bucket.
- **Run notes:** the fresh-project, Postgres 15+ and never-executed warnings are in 1A.1 and 1A.2. 1A now has a Done-when: "SMOKE TEST PASSED".
- **5A.3:** force-end now calls `rpc('submit_attempt', …'forced')` for each attempt.
- **1D.4:** the server rejects changes to `navigation_mode`, `questions_per_paper` and `shuffle` once the exam is live.
- **Cross-references:** the stale 1A.8–1A.20 references were replaced with `001_initial.sql`, and there is a Round 7 table.

## Remaining issues

1. **Questions can still be changed while the exam is live (1E.7).**
   - 1D.4 locks the exam settings, but nothing locks the question routes.
   - The schema cascades deletes, so deleting a question mid-exam silently removes it from every candidate's saved paper, along with their answer to it. Adding a question would not appear in papers that were already generated.
   - Suggested rule: once the exam is live, reject adding or deleting questions, changing question type, and adding or removing MCQ options. Allow edits to the examiner's answer key, since it's only used at grading time.
   - Typos in the question text would not update on screens that have already loaded the paper, so I'd block those too and say so in the admin UI.
   - I'd put this rule in the API contracts section rather than patching the plan separately.
2. **One stale reference:** 6D.6 still says "`current_scores` view (1A.17)". Change it to "`001_initial.sql`".

## Not a gap, just still open

The plan still points to the old main plan for §8.1 (proctoring events), §12.2 (grading prompt), §14.1 (env variables), §14.6 (repo layout) and §18 (runbook). Those are covered by the later sections on the roadmap, so don't treat them as a problem now.

## API contracts

I'll build the route list from every `app/api/...` task in the plan, so nothing gets missed. For each route it will give the auth rule, request body, response, error codes and the DB function it calls. It will also cover the `rpc` result mappings and the lock rule from issue 1.

Do you want me to go ahead, with the small fix to 6D.6 included in the edit list?

---

# you asked

message time: 2026-10-01 10:08:43

if we are good lets go to section API contracts

---

# claude response

I'm reading the database functions and remaining plan rows so the API contracts match the real schema, then I'll write the section.

I have what I need. Writing Section 3 now, in three parts.

Section 3 (API contracts) is written: `section-3-api-contracts.md`. It defines all 39 routes, with auth, request, response, error codes and the database function each one calls. It also covers the Realtime Broadcast messages, a list of what the worker must provide, a table of plan edits, and 19 new tests for Phase 8.

I checked it against `001_initial.sql` and the plan by reading, not by running anything. Anything marked *(verify)* depends on Supabase, Vercel or LiveKit details that change.

## Problems I found while writing it

These are listed in section 0 of the file, and each is fixed in the contracts:

1. **Snapshot upload can't work as planned.** Candidates have no Supabase access, so the snapshot now travels inside `POST /api/events` and the server uploads it.
2. **Lost typing after a reconnect.** The database only accepts a higher revision number, so a candidate reconnecting on another tablet would have every save silently rejected. The paper API now returns the saved revisions, and the client continues from the highest one.
3. **A candidate could submit from the waiting room.** The database function allows it, so the submit route now requires `in_progress`.
4. **Typing on the last question was lost on Next.** The database function returns before saving, so the Next route now saves it.
5. **Shuffled option letters would read "c, a, d, b".** The paper API no longer sends labels, and the UI letters options A, B, C by position.
6. **Nothing wrote `DISCONNECTED` events.** The worker now writes them after 30 s of silence, and the heartbeat writes the matching `RECONNECTED`.
7. **Gemini keys would have had to live on Vercel** for the health route. The worker now checks the keys and the health route only reads the database.
8. **Progress labels couldn't update live**, because views aren't in Realtime. The admin grid polls them every 10 s.
9. **Unassigning a started candidate left an orphan attempt.** The unassign route now refuses candidates who have started.
10. **Grading start had gaps.** It now checks the answer keys are complete, scores MCQs and blank answers in code, and creates the Gemini jobs.
11. **Two admins extending at once lost an update.** Extensions now use compare-and-set.
12. **The client-sent `counts` flag was trusted.** The server now decides it.

Smaller fixes (CSV import size, the acknowledge semantics) are in the file too. The plan also needs about 10 new route files, listed in the edit table.

## Two things I need from you

1. **Snapshot retention:** is **30 days** right for the rules screen? It is a setting, but the screen promises it to staff.
2. **Waiting-room incidents:** I set them to not count toward the flag threshold, because the fullscreen blocker handles that phase. Say if you want them to count.

Once you've applied the edits from section 8 to the plan, the next section on the roadmap is the proctoring spec (event list, thresholds, incident merging, snapshot rules).

---

# you asked

message time: 2026-10-01 10:18:50

Snapshot retention: is 30 days right for the rules screen? It is a setting, but the screen promises it to staff.
Waiting-room incidents: I set them to not count toward the flag threshold, because the fullscreen blocker handles that phase. Say if you want them to count.

explain briefly what is this

---

# claude response

Those are the two open questions I asked you at the end of the API contracts section. Both need a decision from you before the plan is final.

**1. Snapshot retention (30 days)**
When a candidate breaks a rule (leaves fullscreen, switches tab), the system takes a small camera photo and saves it with the violation log. The rules screen has to tell staff how long those photos are kept, and a purge job then deletes them after that time. I suggested 30 days. The question is whether 30 days is right for Cosmetics.lk, or whether you want something shorter or longer, such as 7 or 14 days. It's a setting, so it's easy to change, but staff will be shown the number, so it should be the one you actually mean to keep.

**2. Waiting-room incidents**
Before the exam starts, candidates sit in a waiting room. If one of them leaves fullscreen or switches tabs there, I set it to be logged but not counted toward the violation limit that flags a person. The fullscreen blocker already stops them there, and the exam hasn't started yet. If you'd rather those count as violations too, tell me and I'll change it.

If you don't want to think about it, "30 days, and waiting-room incidents don't count" is the default I've built in.

---

# you asked

message time: 2026-10-01 10:28:29

all other issue fixed? any more issues or gaps? briefly tell me

---

# claude response

Most of the Section 3 edits are in the plan, but some of them don't match the contracts, and five of those conflicts matter. Nothing is broken yet, because nothing is coded.

## What's fixed
The main problems from Section 3 are in the plan:
- The snapshot now goes through the events API, and options have no labels.
- Revision recovery, last-question saving, and submit requiring `in_progress` are there.
- The worker now writes `DISCONNECTED` events, and Gemini keys stay in the worker.
- Unassigning a started candidate is blocked, and grading checks the answer keys first.
- The new route files and tests 8.31–8.49 are added.
- Snapshot retention is set to 14 days, and waiting-room incidents are set not to count.

## Conflicts between the plan and the contracts
These are the places where the plan and Section 3 say different things. Pick one version for each and make both files match.

1. **State response shape (2B.3, 2B.5, 3B.4).** The plan returns `{ phase, remaining_s, broadcast }`. The contract returns `server_time`, the exam (including `scheduled_start_at`, `ends_at` and `navigation_mode`) and the attempt (including `deadline`). The plan's version can't drive the waiting-room countdown when the admin starts the exam manually or changes the time. I'd use the contract's version.
2. **LiveKit identity (4A.3).** The plan uses `cand_{candidateId}`, but the contract and the kick route use `c_{attempt_id}`. I'd change the plan to the contract's version.
3. **Extend race (5A.2).** The plan makes the client send `expected_ends_at` and retry on `409`. The contract retries on the server and needs no extra field. I'd use the contract's version, because it's simpler for the admin page.
4. **CSV formula guard (7.4).** The plan prefixes a tab character and the contract prefixes `'`. Either works, but pick one.
5. **Unassign response (1D.3).** The plan says `409 blocked` and the contract returns `200 { removed, blocked }`. I'd use the contract's version.

## Small gaps
- **Retention:** the contract still says 30 days, so it needs to say 14. 2B.6 should say it shows the retention number from `/api/auth/me`.
- **Contract details not in the plan:** the question HTML allowlist (1E.7), the override rules (note required, attempt must be finalized, 6D.5), the resume body (6D.2), broadcast limits (5A.5), and the shared `recomputeResults()` function, which the grade route, the override route and the worker should all call.
- **Rate limit:** the plan doesn't say that all 23 candidates share one IP, so the per-IP login limit has to be high. Without that, the office network could lock everyone out on exam morning.

## Still open
**Disconnect counting:** should a short Wi-Fi blip on a tablet count toward the flag threshold? The worker currently logs every disconnect as counting. I'll settle this in the proctoring spec (Section 4), but it's the biggest false-flag risk for the tablet users.

I can update `section-3-api-contracts.md` (14 days, plus the five conflicts) and give you an exact edit list for the plan. Do you want me to do that before starting the proctoring spec?