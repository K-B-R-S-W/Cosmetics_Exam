The current plan is OK, and Section 1 (the migration SQL) is written.

these sections still need to be written in:

1. Complete migration SQL: all tables, constraints, indexes, RLS, generate_paper() and the current_scores view. It goes into Phase 1A, so a coding session can paste it in and run it.
2. Design system and screen specs: colours, type, layout rules for laptop and tablet, every candidate and admin screen, the states it can show, and the exact text on the rules, check and error screens.
3. API contracts: request, response and error shapes for every route.
4. Proctoring spec: the event list, thresholds, incident merging and snapshot rules.
5. Grading spec: the final prompt, response schema and worker rules.
6. Infra and ops: env variables, EC2 and LiveKit setup, repo layout and the runbook.


Check of the current plan: all five round-5 edits are in. I found four more things while writing the schema. Three are fixed in the SQL, and one needs an edit in the plan:

Task 5B.10 would block touchscreen laptops. The check "touch-capable and no Android in the user agent" also matches Windows, Mac and ChromeOS laptops with touchscreens. Exclude those too (Windows|Macintosh|CrOS).
Grading jobs collided. Jobs were keyed by (run_id, attempt_id), but a full run needs 2–3 chunk jobs per candidate. I added chunk_index, and a single-question regrade is its own run.
Merged violation incidents had nowhere to be stored. Each row is now one incident, with merged_types and a counts flag, and a trigger updates violation_count.
Nothing created attempts. The live grid needs "Not joined" for all 23 people, so assigning a candidate now creates their attempt automatically.

Files for Section 1:

section-1-migration.md holds the SQL and the exact edits for each Phase 1 and 2 task, plus a cleanup script for test data.
001_initial.sql is the migration to run. It makes the database enforce the rules itself: the revision check, the deadline with the 15-second grace, force-end, the sequential position guard, and Next being safe to retry.
001_smoke_test.sql covers the main rules and rolls itself back.