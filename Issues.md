Section 5 (the grading spec) is written and ready for you to merge. I could not run any of it: there is no Gemini key and no Postgres in my sandbox, so the prompt has never been tested against Gemini.

The biggest finding is the free quota. A September 2026 article says the free Flash models allow about 20 requests a day, and Flash-Lite about 500. That article also says limits apply per project and model, and daily quotas reset at midnight Pacific time, which is about 12:30 pm in Sri Lanka until US clocks change on 1 November, then 1:30 pm. Older articles quote far higher numbers, so none of this is confirmed. Check the real limits for each of your three keys in AI Studio before exam day. 
scriptbyai
scriptbyai

With 23 candidates and about 20 written questions each, one grading run needs roughly 46 calls. That barely fits within three keys at 20 a day, with no room for rehearsal or regrades.

What the section sets up:

Quota-aware worker: it tracks usage per key and model, stops before the limit instead of waiting for errors, and pauses by itself when everything is used up. It resumes after the next reset and messages you with the resume time.
Prompt: the batch prompt covers Sinhala, Singlish and negation (like "epa" and "naha"), which flip meaning. Candidate answers are sent as JSON strings, so they cannot break out of the instructions.
Scoring in code: the marks are validated, rounded and checked by rules that flag doubtful answers for review. Valid items are saved even when part of a response is bad, and only the missing ones are re-queued.
Duplicate protection and a worker guard: a crash can't create duplicate scores. A second worker, for example on your laptop against the shared database, exits instead of taking real jobs.
Also in the file:
A guide for the examiner on writing model answers and grading notes.
A prompt test harness with 15 test cases.
A plan edit list.
21 new tests (8.66 to 8.86).

Things I chose that you should confirm (section 0 has the full list):

Chunk size is 10 questions per call, and you can raise it to 15–20 if your quota is tight.
There is no fallback model by default, because mixing models in one exam hurts consistency.
Confidence below 0.6, or 0.75 for Singlish, sends an answer to review.
When all keys are used up, grading waits for the reset instead of failing.

I added one route you didn't ask for: regrade one question for all candidates, so a corrected model answer doesn't mean 23 separate clicks.

The Sinhala and Singlish test answers were written by me and may sound unnatural. Please replace them with real examiner questions and staff answers.

If the quota is not enough, billing on one project costs only cents for a whole exam, but that is your call.

Please apply the edits from section 12 to the plan and contract, and run 002_grading.sql after 001_initial.sql. Then Section 6 (infra and ops) is next: env variables, EC2 and LiveKit setup, alerts and the runbook. The design and screens come last, as you decided.