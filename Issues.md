Confirmed fixed
Heartbeat state shape: 3B.4 now returns the full state body.
Retention: the contract says 14 in all four places.
Per-IP limit: both files say 50.
Unassign response: the Round 9 table now says 200 { removed, blocked }.
New issue: the 2-minute disconnect rule can't work as written

3B.6 says DISCONNECTED should count only when the gap exceeds 2 minutes. But the worker inserts the row after 30 seconds of silence, so the gap length isn't known yet. In 001_initial.sql, the trigger bump_violation_count runs only AFTER INSERT, and it adds 1 only if counts is true at that moment. Nothing re-evaluates the row later. As written, the worker has to choose counts blind. If it picks true, every blip counts. If it picks false, nothing ever counts.

The "overlaps FOCUS_LOST" rule has a second problem. A backgrounded tablet tab may send its FOCUS_LOST incident only when the candidate returns, so the event may not exist yet when the worker decides.

Suggested fix:

The worker inserts DISCONNECTED at 30 seconds with counts = false.
A second worker pass, when the same attempt is still silent after 2 minutes, flips it to counts = true. If the candidate returns before that, the row stays informational.
Before flipping, the worker checks for any TAB_HIDDEN, FOCUS_LOST, FULLSCREEN_EXIT or VIEWPORT_CHANGED event within about 10 seconds of the gap. If there is one, the row stays false.
The trigger also fires on an update of counts: +1 when it goes false→true, −1 for the reverse.

A candidate who comes back late with a queued FOCUS_LOST could still end up double counted. That is rare, and the admin timeline shows both events, so staff can judge it.

Smaller gaps
The contract doesn't have the new rule. Line 734 still says counts = true and "for the proctoring spec to decide". Line 413 (the server's counts rules) doesn't mention DISCONNECTED at all. The plan and contract now disagree.
Test 8.49 doesn't cover the rule. It only checks that the events appear. It needs two cases: a 40-second blip (logged, not counted) and a 3-minute drop (counted, with violation_count +1).
Admin timeline: the plan says staff see the gap length, but 3C doesn't list a task that shows a DISCONNECTED row with its duration. The duration only exists on the RECONNECTED row, so the UI has to pair the two.
Files I'd edit, and what changes
SECTIONS/001_initial.sql: change the trigger to also fire AFTER UPDATE OF counts, with +1 / −1 logic. The SQL has never been run, so editing it in place is safe.
implementation-plan.md: rewrite 3B.6 as the two-pass rule above, extend 8.49, and add one line to 3C for pairing DISCONNECTED with RECONNECTED.
SECTIONS/section-3-api-contracts.md: update line 734 and the counts rules at line 413.