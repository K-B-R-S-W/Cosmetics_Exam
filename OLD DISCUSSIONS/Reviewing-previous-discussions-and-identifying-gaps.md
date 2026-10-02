> From: https://claude.ai/chat/800aed91-d341-47ad-ae66-790505b10687

# you asked

message time: 2026-10-01 10:35:02

[text/markdown] Continuing-exam-platform-project.md

check the discussions and lets continue where left off. tell me any issues or gaps?

---

# claude response

I'll look at the uploaded files first, then compare the plan with the Section 3 contracts.

I read the plan, the Section 3 contracts and the migration files. The previous round fixed almost everything, but a few stale lines are left, and all of them are in the docs. I checked by reading the text only, so nothing was run.

## Mismatches that still need fixing

1. **Heartbeat state shape (plan 3B.4).** It still says the heartbeat returns `phase`, `remaining_s` and `broadcast`. Tasks 2B.3 and 2B.5 now say it returns the contract's full state body (`server_time`, exam, attempt). If someone codes from 3B.4, the waiting-room countdown breaks.
2. **Retention is still 30 in the contract.** `section-3-api-contracts.md` says 30 in four places: the issue table (line 31), the `/api/auth/me` example (line 264), the env-var note (line 741) and the open-questions list (line 809). The plan says 14.
3. **Per-IP login limit.** The plan (2A.3) says 50 or more per 10 minutes, and the contract says 40. Pick one number. I'd use 50, since all 23 candidates share one IP.
4. **Old unassign wording (plan, Round 9 table, line 649).** It still says "refuse started, `409 blocked`". The real rule is `200 { removed, blocked }`, as in 1D.3. It is only a history table, but it contradicts the task.

## Files I'd edit, and what changes

- `implementation-plan.md`:
  - Line 211 (3B.4): replace the old state shape with "same full state body as `/api/exam/state`".
  - Line 649: change "`409 blocked`" to "`200 { removed, blocked }`".
  - Line 120 (2A.3): leave it at 50+, unless you prefer 40.
  - Line 681: delete the "Contract fix needed" warning once the contract is fixed.
- `SECTIONS/section-3-api-contracts.md`:
  - Lines 31, 264, 741 and 809: change 30 to 14, and mark the retention question as decided.
  - Line 229: change the IP limit from 40 to 50.

## One real gap for Section 4

**Disconnects and false flags.** The worker writes `DISCONNECTED` with `counts = true` after 30 seconds without a heartbeat (3B.6). The heartbeat runs every 10 seconds, so the window is only three missed beats. That creates two problems:

- **Tablet Wi-Fi blips.** A 30-second blip on a tablet adds a violation, even though the candidate did nothing wrong.
- **Double counting.** Chrome slows timers in a backgrounded tab. A candidate who switches tabs already gets a `FOCUS_LOST` violation, and the slowed heartbeat could add a `DISCONNECTED` violation on top of it.

My suggestion for the proctoring spec:
- Log every `DISCONNECTED` event, but set `counts = true` only when the gap is long, for example over 2 minutes.
- Never count a gap that overlaps a `FOCUS_LOST` event.
- Show the admin the gap length either way, so staff can judge a suspicious one.

Do you want short blips to count at all, and if so, after how many minutes? Your answer decides the numbers I write into Section 4.

Shall I apply the edits above first? After that I'll start Section 4 (proctoring spec): the event list, the thresholds, incident merging, the snapshot rules and the disconnect rule.

---

# you asked

message time: 2026-10-01 10:40:17

check now and tell me any more issues or gaps?

---

# claude response

I'll check the new uploads against the four mismatches from last time.

The four mismatches from last time are fixed in your new uploads. There is one new issue with the disconnect rule you added in 3B.6.

## Confirmed fixed
- **Heartbeat state shape:** 3B.4 now returns the full state body.
- **Retention:** the contract says 14 in all four places.
- **Per-IP limit:** both files say 50.
- **Unassign response:** the Round 9 table now says `200 { removed, blocked }`.

## New issue: the 2-minute disconnect rule can't work as written

3B.6 says `DISCONNECTED` should count only when the gap exceeds 2 minutes. But the worker inserts the row after 30 seconds of silence, so the gap length isn't known yet. In `001_initial.sql`, the trigger `bump_violation_count` runs only `AFTER INSERT`, and it adds 1 only if `counts` is true at that moment. Nothing re-evaluates the row later. As written, the worker has to choose `counts` blind. If it picks `true`, every blip counts. If it picks `false`, nothing ever counts.

The "overlaps `FOCUS_LOST`" rule has a second problem. A backgrounded tablet tab may send its `FOCUS_LOST` incident only when the candidate returns, so the event may not exist yet when the worker decides.

**Suggested fix:**
1. The worker inserts `DISCONNECTED` at 30 seconds with `counts = false`.
2. A second worker pass, when the same attempt is still silent after 2 minutes, flips it to `counts = true`. If the candidate returns before that, the row stays informational.
3. Before flipping, the worker checks for any `TAB_HIDDEN`, `FOCUS_LOST`, `FULLSCREEN_EXIT` or `VIEWPORT_CHANGED` event within about 10 seconds of the gap. If there is one, the row stays `false`.
4. The trigger also fires on an update of `counts`: +1 when it goes false→true, −1 for the reverse.

A candidate who comes back late with a queued `FOCUS_LOST` could still end up double counted. That is rare, and the admin timeline shows both events, so staff can judge it.

## Smaller gaps
- **The contract doesn't have the new rule.** Line 734 still says `counts = true` and "for the proctoring spec to decide". Line 413 (the server's `counts` rules) doesn't mention `DISCONNECTED` at all. The plan and contract now disagree.
- **Test 8.49 doesn't cover the rule.** It only checks that the events appear. It needs two cases: a 40-second blip (logged, not counted) and a 3-minute drop (counted, with `violation_count` +1).
- **Admin timeline:** the plan says staff see the gap length, but 3C doesn't list a task that shows a `DISCONNECTED` row with its duration. The duration only exists on the `RECONNECTED` row, so the UI has to pair the two.

## Files I'd edit, and what changes
- `SECTIONS/001_initial.sql`: change the trigger to also fire `AFTER UPDATE OF counts`, with +1 / −1 logic. The SQL has never been run, so editing it in place is safe.
- `implementation-plan.md`: rewrite 3B.6 as the two-pass rule above, extend 8.49, and add one line to 3C for pairing `DISCONNECTED` with `RECONNECTED`.
- `SECTIONS/section-3-api-contracts.md`: update line 734 and the `counts` rules at line 413.

I only had the older `001_initial.sql` from the zip, since you didn't re-upload it. If you've changed it since, send me the new one first.

Should I apply these edits? Or do you want to keep the rule simpler, for example counting only disconnects that last more than 2 minutes and skipping the `FOCUS_LOST` overlap check?

---

# you asked

message time: 2026-10-01 10:46:53

check adn tell me

---

# claude response

The edits from last time are all in, and they match across the SQL, the plan and the contract. I found one real gap in how the overlap check works, plus a few smaller ones. This is a read-through only, and I didn't run the SQL.

## Confirmed in
- **Trigger:** `001_initial.sql` now fires on `AFTER INSERT OR UPDATE OF counts`, with +1 for false→true and −1 for true→false (floored at 0).
- **Plan:** 3B.6 has the two-pass rule, 3C.4 pairs `DISCONNECTED` with `RECONNECTED`, and 8.49 has both cases (a 40-second blip and a 3-minute drop).
- **Contract:** line 734 and the `counts` rules at line 413 match the plan.

## The gap: the ±10s overlap check will double-count backgrounded tabs
Pass 2 skips the flip only if a focus event falls within ±10 seconds of the disconnect start. As far as I know, Chrome slows a tab's timers heavily after it has been hidden for about 5 minutes, to roughly one run per minute. When that happens, the 10-second heartbeat goes silent for more than 30 seconds.

A candidate who switches tabs and stays away would then:
1. get a `FOCUS_LOST` violation at the start, and
2. get a `DISCONNECTED` row about 5 minutes later, far outside ±10 seconds, which flips to `counts = true`.

That is exactly the double count the rule was meant to prevent. The same can happen on Android if Chrome freezes the backgrounded tab.

**Fix:** check for overlap with the whole away period, not the start. Skip the flip if a `TAB_HIDDEN`, `FOCUS_LOST`, `FULLSCREEN_EXIT` or `VIEWPORT_CHANGED` incident started before the disconnect and either lasted into it (`occurred_at + duration_ms`) or has no recorded end yet. I'd also keep the ±10s window as a fallback.

## Smaller gaps
1. **"`last_seen_at` has not advanced" has no reference value.** Pass 1 should save the attempt's `last_seen_at` in the row's `meta` (for example `meta.last_seen_at`). Pass 2 then compares against it and uses it as the real disconnect start for the overlap check.
2. **The 2-minute threshold is really about 2.5 to 3 minutes.** Pass 2 measures the age of the row, which is inserted 30 seconds or more after the last heartbeat. Either measure from `meta.last_seen_at` or write "about 3 minutes" in the docs. A 2m45 drop could surprise you in testing.
3. **The smoke test doesn't cover the new trigger path.** `001_smoke_test.sql` is unchanged. Test 7 only covers inserts. Add three checks: inserting with `counts = false` gives no increment, flipping to `true` gives +1, and flipping back gives −1.
4. **Test 8.49 lacks the backgrounded-tab case.** Add a third case: hide the tab for more than 5 minutes and confirm `violation_count` goes up by 1 (the tab switch) and not 2.

## Files I'd edit, and what changes
- `implementation-plan.md`: rewrite 3B.6 (save `meta.last_seen_at`, use the interval overlap and the ±10s fallback, state the real threshold) and add the third case to 8.49.
- `SECTIONS/section-3-api-contracts.md`: make the same change to the section 7 row (line 734).
- `SECTIONS/001_smoke_test.sql`: add the three trigger checks above.

`001_initial.sql` needs no change. Once these are in, Section 4 (the proctoring spec) is next. Shall I apply the edits?

---

# you asked

message time: 2026-10-01 10:57:08

check and tell me any issues or gaps?

---

# claude response

Last round's edits are all in: `meta.last_seen_at`, the interval overlap check, the ±10s fallback, the three smoke-test checks (7b–7d, which read correctly but which I haven't run) and the third case in 8.49. The plan and the contract agree. I found one real gap and a few smaller ones, and I also need to correct something I told you last time.

## Correction to my last message
I said Chrome throttling would make the heartbeat go silent and cause a double count. Throttling only slows the heartbeat to about one per minute, so the gaps stay under 2 minutes. You would see a `DISCONNECTED`/`RECONNECTED` pair every minute, all with `counts = false`. A real double count needs the tab to be frozen or discarded, for example an Android tablet with the screen off.

Test case (c) in 8.49 can't be reproduced by hiding a tab. To test it, block only the heartbeat requests (for example with DevTools request blocking), or lock the tablet for more than 3 minutes.

## The gap: the overlap check can't see events that haven't arrived
`POST /api/events` is one insert per incident. There is no update route, and the client sends the event with its duration only when the incident ends. For a frozen tab:
1. The candidate is away, so the `FOCUS_LOST` event doesn't exist on the server yet.
2. Pass 2 finds no overlap and flips the `DISCONNECTED` row to `counts = true`.
3. The candidate returns and the late `FOCUS_LOST` arrives and counts too, so the same absence counts twice.

3B.6 treats this as rare, but for a frozen tab it is the normal case. The trigger can now reverse a count, so the fix is small. When a focus-type incident is inserted, the events route sets `counts = false` on any counted `DISCONNECTED` row of that attempt whose `meta.last_seen_at` falls inside the incident's interval (plus ±10s). The trigger then gives −1.

One related limit: `occurred_ago_ms` is capped at 600000 (10 minutes). A longer absence is either rejected or gets a wrong timestamp. I'd raise the cap to at least the exam length, or clamp instead of returning `400`.

## Smaller gaps
1. **"No recorded end yet" is too broad.** The rule skips the flip if any earlier focus incident has no `duration_ms`. A brief alt-tab an hour ago, sent without a duration, would then block every later disconnect from counting. Restrict it to the most recent focus-type incident, and only if no later event shows the candidate came back.
2. **The `last_seen_at` equality check can fail.** Postgres keeps microseconds and JavaScript dates keep milliseconds. If the worker parses the value and writes it back, `attempts.last_seen_at = meta.last_seen_at` is never true and nothing ever flips. Store the exact string from the database, or compare with `<=`.
3. **There is no skip reason.** A row left uncounted because of an overlap gets re-checked every 30 seconds until the candidate returns. 3C.4 also shows "informational" without saying why. Save a marker such as `meta.count_reason` (`'long_gap'`, `'overlap'` or `'short_gap'`) when a row is decided.
4. **Timeline noise.** Hidden tabs will produce a pair of rows every minute. I'd skip Pass 1 while the attempt has an open focus-type incident, or group the pairs in the admin timeline.
5. **Cosmetic:** `section-3-api-contracts.md` now starts with a hidden byte-order mark (BOM) character on line 1. It is harmless in most editors, but it can stop the first heading from rendering. Strip it.

## Files I'd edit, and what changes
- `implementation-plan.md`:
  - 3B.1: after inserting a focus-type incident, reverse overlapping counted `DISCONNECTED` rows, and raise the `occurred_ago_ms` cap.
  - 3B.6: restrict the "no end yet" rule, store the exact `last_seen_at` string, and add `meta.count_reason`.
  - 8.49 case (c): rewrite it with the request-blocking or tablet-lock method, and add case (d): a late `FOCUS_LOST` after a flip gives net `violation_count` 1.
  - 3C.4: show the reason from `meta.count_reason`.
- `SECTIONS/section-3-api-contracts.md`: make the same changes in §3.13 and §7, and strip the BOM.
- `SECTIONS/001_smoke_test.sql`: no change needed. The reversal uses the existing −1 path from check 7d.

Shall I apply these edits? Then I'll start Section 4 (the proctoring spec), which will also define what `duration_ms` means for each event type, since the rules above depend on it.

---

# you asked

message time: 2026-10-01 11:06:41

check any more gaps or issues?

---

# claude response

Everything from Round 14 is in, and the plan and contract agree on all of it. I checked the `occurred_ago_ms` cap, the late-`FOCUS_LOST` reversal, the exact-string `last_seen_at`, `meta.count_reason`, the 3C.4 reasons, the four cases in 8.49 and the BOM, which is gone. `001_initial.sql` and the smoke test are unchanged, which is correct because the reversal reuses the existing −1 trigger path. I still haven't run any SQL.

Two small gaps remain, and one rule needs a decision from you before I can write it down.

## Needs a decision: "open incident" and "return event" can't be computed
3B.6 now relies on two ideas:
- Skip Pass 1 while the attempt has an open focus-type incident.
- Treat the most recent focus incident as "still away" if there is no later return event.

Neither can be evaluated with the current design. The event list has no return or restored event type. `POST /api/events` is also one insert per incident, with no update route. So the server can't tell whether an incident has ended. For a frozen tab, no row exists until the candidate comes back.

Test 8.49 case (c) has the same problem. It says `FOCUS_LOST` arrives at the tab switch, but `duration_ms` is only known when the incident ends.

You can pick one of two ways to handle it:
- **A. Send the incident once, when it ends (my recommendation).** This matches the current contract, where `duration_ms` is in the one-shot body and `occurred_ago_ms` handles late arrival. The late-event reversal from 3B.1 is the protection. Remove the "open incident" skip from Pass 1 and the "no later return event" clause, and use only recorded intervals. The cost is that the admin doesn't see a long tab-hide until the candidate returns. A short alt-tab shows up immediately on return anyway.
- **B. Send at the start, then update at the end.** This keeps live visibility but needs a new `PATCH /api/events/[id]` route and handling for a patch that never arrives.

I'll settle this in Section 4, together with what `duration_ms` means for each event type.

## Smaller gaps
1. **Heartbeat's new duty is documented in only one place.** The heartbeat route now sets `meta.count_reason = 'short_gap'` on the open `DISCONNECTED` row when the candidate returns early. That is only in 3B.6 and §7. 3B.4 and contract §3.12 don't mention it, so someone coding the heartbeat from those would skip it. It must also never overwrite `long_gap`, so it should only write when `count_reason` is empty.
2. **Race between the heartbeat and the Pass 2 flip.** Both can touch the same row at the same moment. Make each of them one conditional update:
   - The flip: `UPDATE … WHERE counts = false AND meta->>'count_reason' IS NULL AND attempts.last_seen_at = meta.last_seen_at`.
   - The `short_gap` write: the same `count_reason IS NULL` guard.

## Files I'd edit, and what changes
- `implementation-plan.md`:
  - 3B.4: add the guarded `short_gap` write.
  - 3B.6: use one conditional `UPDATE` for the flip, and (after your decision) drop the "open incident" and "return event" wording.
  - 8.49(c): fix the setup to match your decision.
- `SECTIONS/section-3-api-contracts.md`: make the same changes in §3.12 and §7.
- No SQL or smoke-test changes.

Which do you want for the incident timing, A or B? Once you say, I'll apply the edits and start Section 4.

---

# you asked

message time: 2026-10-01 11:17:58

check any more issues or gaps?

---

# claude response

Round 15 is in. The send-on-end decision is applied, the guarded `short_gap` write is in 3B.4 and contract §3.12, and the race guard is described. But the Pass 2 SQL you wrote won't run as it is, and one rule is still missing from 3A.1. I checked by reading only and didn't run the SQL.

## Real bug: the Pass 2 SQL as written will never flip anything
1. **Undefined alias.** The `UPDATE violation_events` has no alias, but its subquery refers to `ve.meta`. This is an error as written.
2. **Text comparisons will not match.**
   - Pass 2 compares `last_seen_at::text` and `meta->>'last_seen_at'` as strings.
   - It also compares the `meta` string with `(now() - interval '2 minutes')::text`.
   - The stored value is the ISO string the Supabase client returns, with a `T` and `+00:00`. As far as I know, Postgres's `::text` output uses a space and `+00`.
   - Equality would then always fail, and `<` would compare the `T` and the space instead of the times, so neither check works.
3. **Fix:** cast to `timestamptz`, which keeps microseconds exactly, and join instead of using a correlated subquery:
   ```sql
   UPDATE violation_events ve
   SET counts = true, meta = jsonb_set(ve.meta, '{count_reason}', '"long_gap"')
   FROM attempts a
   WHERE a.id = ve.attempt_id AND ve.type = 'DISCONNECTED' AND ve.counts = false
     AND ve.meta->>'count_reason' IS NULL
     AND (ve.meta->>'last_seen_at')::timestamptz < now() - interval '2 minutes'
     AND a.last_seen_at = (ve.meta->>'last_seen_at')::timestamptz
   ```
4. **The overlap check is described separately from the update.** The text says "before flipping, run the overlap check", but the update is one statement. That needs two guarded statements in order:
   - **First:** mark overlapping rows with `count_reason = 'overlap'`.
   - **Second:** flip the remaining rows.

   Each statement keeps the `count_reason IS NULL` guard.

I'd put both statements in one database function, for example `resolve_disconnects()`, and have the worker call it with `rpc`, as the plan already does for `save_answer` and `submit_attempt`. Then the smoke test can cover it. That would add a function to `001_initial.sql` and a few checks to the smoke test. These checks are untested until you run them on a real Postgres.

## Gaps
1. **3A.1 doesn't say when an incident is sent.** The send-on-end decision lives only in 3B.6 and contract §7. 3A.1 (the proctoring hook) still only says to merge events within about 3 seconds. It must define that an incident ends when focus, visibility or fullscreen returns, that the client then sends it once with `duration_ms` and `occurred_ago_ms`, and what happens if the page closes first. Section 4 is the right place, but a note in 3A.1 now would stop the hook being coded the old way.
2. **The overlap window covers only the start of the gap.** Both checks use `meta.last_seen_at ± 10s` as a point. An incident that starts inside the gap but later than 10 seconds after the last heartbeat (for example, offline Wi-Fi, then a tab switch a minute later) is neither skipped nor reversed. It is a judgment call whether that should count twice. I'd decide it in Section 4 and write the rule down.
3. **Test 8.49(d) can't be run by hand.** Two things happening in the same instant can't be triggered manually. Test the guards as SQL in the smoke test: run the `short_gap` update and then the flip, and check that the second one changes zero rows.

## Files I'd edit, and what changes
- `SECTIONS/001_initial.sql`: add `resolve_disconnects()` with the two guarded statements above.
- `SECTIONS/001_smoke_test.sql`: add checks for flip, overlap and guard.
- `implementation-plan.md`: rewrite 3B.6 Pass 2 to call the function with the corrected SQL, replace 8.49(d) with a smoke-test reference, and add the send-on-end line to 3A.1.
- `SECTIONS/section-3-api-contracts.md`: make the same changes in §7.

Shall I apply these? Then I'll start Section 4 (the proctoring spec) and settle gap 2 there.

---

# you asked

message time: 2026-10-01 11:24:25

check any more issues or gaps?

---

# claude response

The Round 16 edits are all in, and the plan, contract, SQL and smoke test agree. The function fixes last round's broken SQL. It joins `attempts`, uses `timestamptz` casts, and runs the overlap marking before the flip. I found one smoke-test bug that will make it fail, plus several smaller gaps. I checked by reading only. This sandbox has no Postgres, so none of the SQL has been run.

## Bug: smoke test 10b will fail
Test 10 sets `violation_count = 0`, then inserts a `FOCUS_LOST` row with `counts = true`. The trigger adds 1 for that insert, so the count is 1 when `resolve_disconnects()` finishes. Assertion `10b` expects 0, so it fails even though the function worked.

**Fix:** insert that `FOCUS_LOST` with `counts = false`. Alternatively, record `violation_count` before calling the function and assert it is unchanged.

## Gaps
1. **There is no test for the main case.** Tests 10a–10d cover the overlap and the guard, but no test checks that a clean disconnect flips to `counts = true`, gets `count_reason = 'long_gap'`, and adds 1. Add a row with `last_seen_at` 10 minutes ago and no nearby focus events, and assert all three.
2. **A null `duration_ms` makes the overlap check skip the event.** The check computes `occurred_at + duration_ms * interval '1 millisecond'`. If `duration_ms` is null, which the schema allows, the result is null and that event is never treated as overlapping. The reversal in 3B.1 has the same problem. Use `coalesce(f.duration_ms, 0)` in both.
3. **`resolve_disconnects()` can be called by any user.** The other database functions have `revoke execute … from public, anon, authenticated` and `grant … to service_role` (lines 732–739). The new function has neither, so it would be callable through the Supabase client. Add the same two lines.
4. **Encoding damage in the contract.** The new §7 row contains `â€”` where the em dashes should be. It looks like a UTF-8 file that was re-saved as Windows-1252. Replace those with plain dashes and save the file as UTF-8.
5. **Disconnects can count after submission.** Pass 2 doesn't check the attempt's status. If a candidate is offline when the exam auto-submits at the deadline, the disconnect can flip to counted afterwards. Either add `a.status = 'in_progress'` to the flip, or accept it. I'd restrict it, because the violation count should stop changing once the exam is over.

## Files I'd edit, and what changes
- `SECTIONS/001_smoke_test.sql`: fix 10b and add the positive flip test.
- `SECTIONS/001_initial.sql`: add `coalesce` in `resolve_disconnects()`, plus the `revoke`/`grant` lines, and (if you agree) the status check.
- `implementation-plan.md`: add `coalesce` to 3B.1's reversal rule, and make the same changes in 3B.6 so it matches the SQL.
- `SECTIONS/section-3-api-contracts.md`: fix the garbled characters in §7 and add the `coalesce` note in §3.13.

Shall I apply these? After that, there are no further open items on the disconnect rule apart from the gap-interval question (an incident starting more than 10 seconds into a gap), which I'll settle in Section 4, the proctoring spec.

---

# you asked

message time: 2026-10-01 11:31:41

check any more issues or gaps? or can we go to section 4 Proctoring spec?

---

# claude response

Yes, we can go to Section 4 once one small smoke-test bug is fixed. Everything from Round 17 is in:
- `coalesce` is in the SQL, in 3B.1 and in contract §3.13.
- The `revoke`/`grant` lines for `resolve_disconnects()` are added.
- The `a.status = 'in_progress'` check is in both statements.
- 10b's `counts = false` fix and the new positive tests 10e–10g are in.
- The garbled characters in the contract are gone.
- The `â€` text on plan line 760 is only a quote of the old problem, so it is harmless.

I checked by reading only. The SQL still hasn't been run on Postgres.

## Bug: smoke test 10 will fail because of the new status check
By the time test 10 runs, the test attempt has already been submitted in step 5, so its status is `submitted`. `resolve_disconnects()` now requires `in_progress`, so it matches nothing:
- 10a fails, because no row gets `overlap`.
- 10e, 10f and 10g fail, because no row flips.
- 10c and 10d pass for the wrong reason, because nothing matches at all and the guard is never exercised.

**Fix:** add `update public.attempts set status = 'in_progress' where id = v_att;` at the top of test 10. The submitted-attempt check (`submit_reason` and `submitted_at` set) only applies to `submitted` and `finalized`, so moving back to `in_progress` is allowed. An optional test 10h could also confirm that a disconnect on a `submitted` attempt does not flip.

## Smaller point
The plan row for 3B.6 lost its ➕ marker and the 🔧 superscripts when it was shortened. This is cosmetic, but those markers are how the plan tracks which tasks came from which round, so I'd put them back.

## Files I'd edit, and what changes
- `SECTIONS/001_smoke_test.sql`: add the status line above (and optionally 10h).
- `implementation-plan.md`: restore the ➕ and 🔧 markers on 3B.6.

## Section 4: proctoring spec
It will cover:
- the full event list, and what `duration_ms` means for each type
- thresholds: the default `flag_threshold`, the 3-second merge window, the viewport tolerance and the focus delay
- the rules for when an incident starts and ends, including a closing page
- the snapshot rules: when one is taken, how a hidden tab is handled, and the retention period
- the gap rule for an incident that starts more than 10 seconds into a disconnect

Two decisions only you can make:
1. **A tab switch that starts during a disconnect:** should it count as a second violation, or be treated as part of the same absence? My default is to merge it, so one absence counts once.
2. **Default flag threshold:** what number of counted incidents should turn a candidate red on the admin grid? My default is 5.

If the defaults are fine, say "go". I'll apply the two small edits and write Section 4 as `section-4-proctoring.md`.

---

# you asked

message time: 2026-10-01 11:38:03

[] 001_smoke_test.sql

1. counts once.
2. default is 5 good. (make it changeable in admin side like custom number to make a candidate red)

here the updated file if its good lets go the Section 4 Proctoring spec

---

# claude response

Section 4 is written as `section-4-proctoring.md`. It covers the event list, incident lifecycle, counting rules, snapshots, the admin side, tunables, edits to apply and 14 new tests. The SQL in its appendix has not been run.

Your updated smoke test and plan look right. Test 10 now sets the attempt to `in_progress`, 10h covers a submitted attempt, and 3B.6 has its markers back.

## Your two decisions
1. **Counts once.** If a tab-switch incident overlaps a disconnect, only the tab switch counts. Section 5 covers both arrival orders: the incident arrives before the 2-minute flip, or after it (the frozen-tab case). The old rule only looked at the first 10 seconds of a gap, so a tab switch 60 seconds into a Wi-Fi drop would have counted twice.
2. **Threshold.** The default is 5. Any number from 1 to 100 can be set per exam, including while the exam is live. The schema and the update route already allowed this, so the new part is a number field on the live grid (task 3C.5). Tiles turn red at `violation_count >= flag_threshold`, and amber at half the threshold.

## Gaps this section fixes
- **Retries could double-count.** The current events contract lets the client retry blindly, so a lost response would add a second violation for one incident. `POST /api/events` now needs a client-generated `id`, and a repeat returns `duplicate: true`.
- **Counting was too loose.** Everything the client sent counted. Section 4.1 makes counting depend on the event type, the camera and mic source, the attempt status, and whether the incident started before the exam began.
- **Incident timing is defined.** One absence is one incident. It closes when every signal has cleared. It is sent when it ends, flushed before submit, and sent by beacon if the page closes.

## Defaults I chose that you should confirm
- **`COPY`, `PASTE` and `CONTEXT_MENU`** are logged but do not count, because they are blocked anyway and a tablet long-press triggers a context menu.
- **`RELOAD`** counts.
- **`CAMERA_LOST` and `MIC_LOST`** count only when the device's track ended, not when only LiveKit dropped, which matches plan 4B.4.
- **Admin dismiss and restore** for a wrongly counted incident is a new route. The trigger already supports −1, so it is small. If you don't want it, drop route 3B.7 and test 8.61.

## Things to check when you apply it
- **Smoke test 10e needs one extra line.** The new overlap rule would now match the earlier `FOCUS_LOST` row, so delete it before 10e. It is shown in Appendix A.3.
- **The contract's route count** goes from 39 to 40 with the dismiss route.
- **Browser behavior to test in rehearsal:** split view with fullscreen, `sendBeacon` on Android, and the notification-shade false events. Section 9 lists them.

Shall I apply the edits from section 10 to the plan and contract, and the SQL changes from Appendix A? Or do you want to read Section 4 first?

---

# you asked

message time: 2026-10-01 12:01:45

here check and give me gaps and issues?

---

# claude response

I'm finishing the check by reading the updated SQL function and a few plan rows against the contract.

The SQL itself is fine, but the plan and contract edits dropped some details and missed others. Here is what I found.

## What is correct
- **`resolve_disconnects()`** uses the full-interval overlap rule, keeps `a.status = 'in_progress'` and `coalesce` in both statements, and still has the `revoke`/`grant` lines.
- **`reverse_disconnects_for_incident()`** matches Appendix A.2 of my spec, with the grants.
- **Smoke tests 10e and 11a–11c.** I traced these by hand against the SQL and the trigger, and the arithmetic works:
  - 11a ends as `overlap`.
  - 11b ends at net 1 (+1 flip, +1 incident, −1 reversal).
  - 11c returns 0 reversals, because the incident starts after the `RECONNECTED` row.
- **Nesting.** Blocks 10 and 11 are closed correctly. These are reads only, and none of the SQL has been run.
- **Everything else from section 10:** the events contract (`id`, idempotency, counting order), contract 4.15 (the new dismiss route), plan tasks 3A.12, 3B.7 and 3C.5, the CSV columns, and the other plan edits you applied.

## Real gaps from the edits
1. **The old DISCONNECTED end-to-end tests are gone.** Test 8.49 was replaced by 8.50–8.63, and its row in the Round 9 table was deleted. That removed the plain Wi-Fi blip (gives `short_gap`, no count) and the clean 3-minute drop (counts once). 8.62 only covers a drop with a tab switch. Put the two plain cases back as 8.64 and 8.65. The history tables still mention 8.49, and the "Phase 8 API tests" row still says 8.31–8.49, so update the range.
2. **3B.6 lost the Pass 1 skip rule.** The rewrite dropped "skip if the attempt's most recent `DISCONNECTED`/`RECONNECTED` is already a `DISCONNECTED`". The contract's §7 row still has it, and it exists only in worker code, not in the SQL. Without it, the worker adds a new `DISCONNECTED` row every 30 seconds for as long as the candidate is offline.
3. **3A.4 lost the orientation warning.** The plan no longer says to lock to the orientation the candidate is already in, not to hardcode `'portrait'`, and to unlock when fullscreen ends. That warning was added for tablets held in landscape. Put it back.
4. **Contract §7 still has the old overlap rule.** It still says the ±10 s window "covers disconnect start only", which is now wrong. It should describe the interval rule from section 5.
5. **Contract housekeeping:**
   - The `admin_actions` name list (line 86) lacks `event_dismiss` and `event_restore`. The column has no check constraint, so nothing breaks, but the list is the reference for what to write.
   - The route table still ends at 39, with no row for `PATCH /api/admin/events/[id]`.
   - 3.13 lost "allowed only for `acknowledged` and `in_progress` attempts". Events from a `not_started` attempt are no longer excluded.

## Gaps in my Section 4 itself
6. **Client-sendable types are not listed.** The contract only blocks `DISCONNECTED` and `MULTI_LOGIN` from clients. A client could also send `RECONNECTED` (it would not count, but it could cut a real disconnect short in the timeline pairing). Add an explicit allowlist for clients: the four attention types, `MULTI_SCREEN`, `CAMERA_LOST`, `MIC_LOST`, `COPY`, `PASTE`, `CONTEXT_MENU` and `RELOAD`. Everything else returns `400`.
7. **Dismiss can lose its note.** Events from the client often have `meta = null`. In Postgres, merging into a null `meta` gives null, so `meta.dismissed` would silently not be saved. The route must use `coalesce(meta, '{}'::jsonb)`. The same applies when the heartbeat writes `short_gap`.
8. **A failed reversal call is silent.** If the events route inserts the incident but the `reverse_disconnects_for_incident` call fails, the double count stays. Make the route retry once. Also run the reversal for recent attention incidents from the worker as a safety net. The function is idempotent, so running it again is harmless.

## Files I'd edit, and what changes
- `implementation-plan.md`: restore the 3B.6 skip rule and the 3A.4 orientation text, add tests 8.64/8.65, and fix the 8.31–8.49 range and the history rows.
- `SECTIONS/section-3-api-contracts.md`: rewrite the §7 overlap wording, add the two action names, add the route table row, restore the status rule, and add the client type allowlist.
- `SECTIONS/section-4-proctoring.md`: add the type allowlist (§4.1), the `coalesce` note (§7.4) and the reversal retry (§5).
- The SQL needs no change.

Shall I apply these? Once they are in, I'd call Section 4 done and move to the next section on the roadmap.