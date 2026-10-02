I reviewed all project files and the conflicts/gaps we identified. Below are the final decisions and answers.

Use these as the current requirements. Do NOT ask me these same questions again. Update the implementation plan/specifications wherever the old documents conflict with these decisions.

The uploaded project ZIP/files are the source material. Please inspect all relevant files before changing the architecture.

# 1. SUPABASE FLAG THRESHOLD

We previously ran the version where the default was 5.

The new intended/default value is now:

```sql
flag_threshold DEFAULT 10
```

I have NOT yet run the latest SQL change in Supabase.

We can add/run the Supabase SQL migration after implementation.

Therefore:

* Code/specification should use 10.
* Do not keep 5 anywhere as the current default.
* Add the required Supabase SQL change as a deployment/migration step after implementation.
* Make sure all tests/specifications use 10.

Required SQL:

```sql
ALTER TABLE exams
ALTER COLUMN flag_threshold
SET DEFAULT 10;
```

# 2. GEMINI

Use Gemini 3.7 Flash.

Gemini 3.7 is the model we want because its knowledge/quality is suitable for this project.

All keys are on the free tier.

If one Gemini key reaches its limit or fails because of quota, the system should automatically move to the next available Gemini key.

There should be no manual intervention for normal key rotation.

The desired behavior is:

```text
Gemini request
    ↓
Key 1
    ↓
fails / quota exhausted?
    ↓ yes
Key 2
    ↓
fails / quota exhausted?
    ↓ yes
Key 3
    ↓
continue with next available key
```

Do not introduce a fallback model unless there is a concrete technical reason.

The system should use Gemini 3.7 Flash and rotate between configured API keys.

The exact daily quota should not be hardcoded based on an assumption. Make the quota/key configuration environment-driven.

# 3. EXAM QUESTION COUNT

There is NO fixed question count per exam.

The admin creates the paper dynamically.

For example:

```text
Admin creates exam

MCQ:
10 questions
or 20 questions
or 30 questions
or any number

Written:
5 questions
or 10 questions
or 20 questions
or any number
```

The exam can therefore have different numbers of MCQ and written questions.

The admin controls the paper composition.

There must be no hardcoded:

```text
20 questions
40 questions
10 MCQ
10 written
```

etc.

The system must dynamically handle however many questions the admin adds.

# 4. GEMINI GRADING

Important clarification.

MCQ does NOT need Gemini.

The admin enters the correct answer for each MCQ question while creating the question.

Example:

```text
Question:
What is 2 + 2?

Options:
A. 3
B. 4
C. 5
D. 6

Correct answer:
B
Marks:
1
```

The candidate selects an option.

The application can deterministically compare:

```text
candidate_answer == admin_correct_answer
```

and calculate the MCQ score in code.

Therefore:

* MCQ grading = deterministic code
* No Gemini job for MCQ grading
* MCQ score must be exact
* Admin can set the marks for each MCQ

For written questions, the admin provides the official/model answer.

Example:

```text
Question:
Explain ...

Expected answer:
[admin's full/model answer]

Maximum marks:
10
```

The candidate provides a written answer.

Gemini evaluates the candidate's written answer against the administrator's model answer and determines the score.

The important principle is:

```text
Admin's answer = reference / expected answer
Candidate's answer = answer being evaluated
Gemini = evaluator
```

Gemini should determine the written-answer score based on how well the candidate answer satisfies the expected/model answer.

The system should support any number of written questions.

Do not create a fixed "10 written questions only" architecture.

The architecture should support the entire candidate paper dynamically.

It is acceptable for the Gemini grading request to contain the candidate's full relevant paper/context, but MCQ correctness must remain deterministic and must not depend on Gemini.

# 5. DISCORD / TELEGRAM ALERTS

We do NOT use Discord or Telegram alerts.

Remove those from the project requirements.

This is a web application that runs in Chrome.

Do not design the normal notification system around Discord or Telegram.

If the admin needs an announcement inside the exam website, use the application's own UI notification system described below.

Do not keep "Discord or Telegram" as an unresolved project decision.

# 6. DUCKDNS

I have NOT created DuckDNS yet.

We will use:

```text
Cosmetics.duckdns.org
```

DuckDNS is free, so I can create this.

Use this hostname consistently in the infrastructure configuration/documentation instead of the placeholder:

```text
examlk.duckdns.org
```

Treat DuckDNS creation and DNS pointing as an infrastructure deployment step.

# 7. QUESTION IMAGES

Questions are NOT text-only anymore.

Images must be optional for every question type.

This applies to:

* MCQ
* Written questions

When the admin creates or edits a question, there should be an optional image control.

Example:

```text
[ ] Add image
```

When enabled:

```text
Image:
[Choose image / Upload image]
```

The admin can upload/select an image.

If no image is selected:

```text
Question
Text
Answer area
```

If an image is selected:

```text
Question text
        ↓
Question image
        ↓
Answer area
```

For MCQ:

```text
Question
Image (optional)
A. ...
B. ...
C. ...
D. ...
```

For written:

```text
Question
Image (optional)
[Written answer area]
```

The image must render correctly for the candidate during the exam.

The image must also appear correctly in the admin question editor.

The implementation should support secure image upload/storage/retrieval and avoid breaking the text-only case.

Do not make images mandatory.

# 8. LOGO

I do not have an SVG logo.

I only have the Cosmetics logo as PNG.

Use the available PNG assets.

Do not make SVG availability a blocker.

# 9. SECTION 2C — AI MARK ACCEPTANCE

Clarification:

MCQ is automatically graded by code using the answer entered by the admin.

The admin enters:

```text
question
options
correct answer
marks
```

The system determines MCQ correctness automatically.

For written questions, Gemini generates/evaluates the AI score against the admin's model answer.

The existing "accept AI mark" behavior can remain, but it must be understood correctly:

* Gemini proposes/evaluates the written score.
* Admin can accept the AI-generated mark.
* Accepting the AI mark should preserve the same mark and use the predefined note/override mechanism.
* MCQ should not require AI acceptance because it is deterministically graded.

Do not introduce unnecessary Gemini grading for MCQs.

# 10. BROADCAST / ANNOUNCEMENTS

Change the existing broadcast restriction.

New requirement:

```text
Maximum announcement length = 5000 characters
Number of announcements = Unlimited
```

Admins can send as many announcements as they need.

Announcements are website notifications, NOT Discord or Telegram messages.

Display them as toast notifications:

```text
Top-right corner
    ↓
Announcement appears
    ↓
Automatically disappears after 5 seconds
```

The implementation should handle long announcements properly without breaking the layout.

The admin should be able to send multiple announcements.

# 11. ADMIN GRID / MER ORDER

Candidate grid ordering must remain based on MER order/code.

It must NOT automatically reorder candidates based on suspicious incidents.

For each candidate in the grid, display the MER identifier/number and show an incident/violation indicator or count near the candidate.

Example concept:

```text
MER-001   🔴 2
MER-002   🟢 0
MER-003   🔴 10
```

The actual visual design can follow the design system.

Important:

Even when a candidate reaches the violation threshold of 10, DO NOT automatically remove, terminate, kick out, or disqualify the candidate.

The system only records/flags the suspicious incidents and provides the information/report to the admin.

The admin reviews the candidate AFTER the exam.

So:

```text
Violation >= threshold
        ↓
Flag/report candidate
        ↓
Candidate remains in exam
        ↓
Admin reviews after exam
```

There must be NO automatic candidate ejection based on the violation count.

# 12. AUDIO / SPEAKER MONITORING

Only ONE candidate microphone/audio stream may be actively opened/listened to by the admin at a time.

Reason:

Opening many candidate microphones simultaneously would overlap all voices and make monitoring unusable.

Therefore:

```text
Candidate A → listening
Candidate B → muted
Candidate C → muted

Click Candidate B
        ↓
A closes/mutes
B becomes active
```

Do not design the monitoring page to play all candidate microphones simultaneously.

# 13. END EXAM BEHAVIOR

There are two situations.

## Candidate submits normally

If the candidate finishes before the deadline:

```text
Candidate clicks Submit
        ↓
Confirm
        ↓
Save final answers
        ↓
Submit exam
        ↓
Grade
```

## Admin ends the exam

If the admin triggers an exam end:

```text
Admin ends exam
        ↓
Current candidate work is saved
        ↓
Exam is submitted/closed
        ↓
Available answers are graded
```

For written answers that are incomplete or nearly complete, Gemini should still evaluate them against the administrator's model answer and assign the appropriate score based on the content actually provided.

Do NOT discard the partial written answer simply because the admin ended the exam.

Autosave must ensure the latest candidate data available at the time of the forced exam end is retained.

# 14. ADMIN ACCOUNTS

Admins are created manually in Supabase.

Do not create a self-service admin registration system.

# 15. INTERFACE LANGUAGE

ALL application UI should be in English.

This includes:

* buttons
* navigation
* dialogs
* labels
* errors
* admin panel
* candidate panel
* notifications
* system messages

However, exam content is multilingual.

Questions can be:

```text
English
Sinhala
English + Sinhala
Singlish
Mixed Sinhala/English
```

The admin may paste Sinhala questions copied from external sources/websites.

The system must preserve the question text accurately, including Sinhala Unicode.

Candidates should see the question content as entered by the admin.

# 16. PRINTING / FINAL CANDIDATE RESULT

Final candidate reports should be printable.

The intended print layout is primarily black and white:

```text
White page
Black text/questions/answers
```

However, correct/incorrect status may use:

```text
Green = correct
Red = incorrect
```

Make sure correctness is not communicated ONLY through color, because the printout must remain understandable if printed in grayscale.

The print layout should remain clean and readable.

# 17. QUESTION IMAGES — ADMIN UI

The image control should be optional.

Suggested flow:

```text
Question editor

Question text
[ ] Add image

If checked:
    Image upload/select control appears

    [Choose Image]

Preview:
    image

Save question
```

This should work for both:

```text
MCQ
Written
```

The candidate exam should render:

```text
Question text
Image if configured
Answer area
```

# 18. MANUAL SUBMIT + AUTO SUBMIT

Yes, keep both.

The implementation must support:

### Manual submit

Candidate finishes before time expires and clicks Submit Exam.

### Auto submit

When time expires, the system automatically submits according to the existing deadline/grace-period architecture.

The worker should use:

```text
reason = "auto"
```

for automatic timeout submission.

Admin-forced actions should remain distinguishable, e.g.:

```text
reason = "forced"
```

Do NOT use `forced` for normal timeout submission.

# 19. IMPLEMENTATION PLAN / TEST NUMBERING

Yes, continue the new Section 2 tests starting from:

```text
8.97
```

The current implementation plan ends at 8.96.

Organize the new tests by specification/section where practical.

Do not create duplicate test IDs.

Also reconcile the old conflicting tests, especially the flag-threshold tests.

# 20. OLD exam-platform-plan.md

The old:

```text
exam-platform-plan.md
```

must clearly be marked as superseded.

Add a very obvious banner near the top:

```text
SUPERSEDED

This document is retained for historical/reference purposes only.

Use implementation-plan.md and the SECTIONS/ documents as the current
source of truth.

Do not implement from this document.
```

The old document must NOT remain ambiguous.

Its outdated architecture/settings should not be treated as current.

# 21. WORKER ARCHITECTURE

The worker starts from:

```text
dist/index.js
```

Shared application logic may live outside the worker directory.

We need a reliable production build architecture so the worker does not fail because shared code is missing at runtime.

Use a proper bundling/build solution such as:

```text
esbuild
```

or

```text
tsup
```

or an equally reliable architecture.

The final result must ensure:

```text
Shared TypeScript code
        ↓
Worker build
        ↓
dist/index.js
        ↓
systemd
        ↓
worker starts successfully
```

Do not leave this as an unresolved architectural question.

Test the actual built worker.

# 22. ARCHITECTURE QUALITY

I want a production-quality architecture.

Do not only make the individual screens work.

Verify the complete wiring between:

```text
Frontend
    ↕
API
    ↕
Supabase/Postgres
    ↕
Realtime
    ↕
Worker
    ↕
Gemini
    ↕
LiveKit
    ↕
Candidate/Admin UI
```

Make sure the architecture handles:

* authentication
* authorization
* autosave
* final submission
* timeout submission
* admin force-end
* MCQ deterministic grading
* written Gemini grading
* partial written answers
* Gemini API key rotation
* retries
* quota failures
* realtime events
* proctoring events
* violation counting
* candidate monitoring
* image uploads
* multilingual text
* result generation
* printing
* infrastructure failures
* network interruptions
* duplicate requests
* race conditions
* stale client state
* worker crashes
* Gemini failures
* database failures

Identify and fix wiring issues before implementation is considered complete.

# 23. EC2

We have NOT run the complete stack on EC2 yet.

The intended workflow is:

```text
Local development
        ↓
Local testing
        ↓
Fix architecture/errors
        ↓
Production/rehearsal deployment to EC2
        ↓
EC2 testing
```

Do not assume that because something works locally it will automatically work on EC2.

We need an explicit EC2 deployment/rehearsal phase.

# 24. LIVEKIT

I have Docker available.

LiveKit version/configuration can be tested and corrected during the EC2 deployment/rehearsal.

The current intended version is:

```text
v1.13.7
```

Verify that the image/version actually works before treating it as final.

# 25. SUPABASE POSTGRES VERSION

My current Supabase database reports:

```text
PostgreSQL 17.11 on x86_64-pc-linux-gnu,
compiled by gcc (GCC) 15.2.0, 64-bit
```

So do NOT assume PostgreSQL 16.

The backup strategy must be compatible with PostgreSQL 17.11.

Verify the `pg_dump` version used by the backup environment and ensure it is compatible with PostgreSQL 17.11.

Add this to the infrastructure verification/testing checklist.

# 26. TURN / TLS / NETWORK TESTING

We need to test both:

```text
Wi-Fi
```

and

```text
Mobile data
```

The purpose is to verify that candidate audio/video and LiveKit connectivity work under different network conditions.

Test:

* normal Wi-Fi
* mobile data
* restrictive network behavior
* ICE connectivity
* TURN fallback
* TLS
* reconnect behavior
* camera/microphone recovery
* candidate/admin realtime behavior

Do not consider LiveKit production-ready until this has been tested.

# 27. REMOVE OUTDATED DECISIONS

Please remove or update old conflicting statements such as:

```text
flag threshold = 5
broadcast = 300
broadcast max 10
mic level meter
submit_now: true
worker timeout reason = forced
text-only questions
Discord alerts
Telegram alerts
examlk.duckdns.org
fixed paper question counts
automatic candidate ejection at violation threshold
```

The current intended values/behaviors are the ones specified in this message.

# 28. IMPORTANT FINAL REQUIREMENT

Do not simply append these answers somewhere while leaving contradictory requirements elsewhere.

I want you to reconcile the entire project documentation.

After applying these decisions:

1. Search all project files for contradictions.
2. Identify every outdated requirement.
3. Update the correct source-of-truth documents.
4. Make implementation-plan.md consistent with Sections 1–6.
5. Make the API contract consistent with frontend behavior.
6. Make the database schema/migrations consistent with the new rules.
7. Make worker behavior consistent with the API contract.
8. Make Gemini grading consistent with MCQ vs written grading.
9. Add/renumber tests beginning at 8.97.
10. Add missing integration/error tests.
11. Verify all frontend → API → DB → worker → Gemini → realtime wiring.
12. Verify all error/edge cases and race conditions.
13. Ensure no obsolete document can accidentally be mistaken for the current architecture.
14. Prepare the system so local testing can happen first and EC2 testing follows afterward.

Do not ask me again about the decisions above.

If something remains genuinely undefined after applying these decisions, identify only those genuinely new/remaining questions.

The final goal is a clean, internally consistent, production-ready architecture and implementation plan with no contradictory requirements.
