> From: https://claude.ai/chat/4630815e-24b8-420c-a874-bf93b83675ad

# you asked

message time: 2026-09-30 15:51:50

ok my compay cometics.lk is hosting a exam for our sales team. they told me can we make a website hosted so they can join in on time with unieq login (They have MER code each sales person), and do the exam. 

the login page, they can click there uniqe MER code and it will shows the name of the each selected MER person details  (ill add them in admin side) then they will acknowledge it and move in. untill the time comes the exam paper wont be loaded. when the time comes the browser refresh auto and load the peaper without loging out the user

so they told me if the sale person or persons, closed the browser, change browser tabs, move out from full screen it should be report to admin side. and the video camera should be on (ask permission with audio) real time admin side can watch each exam user with mutable buttons as well. (if they wanna mute the person. in defualt the person mic is muted)

exam questions are added from admin side, admin will click if its an mcq or Writen question and add the question (with options to bold or add list or word sizing to the questions) (if its a mcq, they can add a,b,c,d or many more)

so they go to login -> accept the persmisons and wait until exam loaded automaticaly or manualy by admin side -> when exam loaded camer and mic is on and can be seen by the realtime in admin side (add multiple admins so they can watch if needed) no login required for admins. 

when exam time finish save the work automaticaly and closes the window.

also if the user disconnects they can login back and re continue untill exam time runs out

in the ansear section in admin panel can see each users answaers, and can download as a pdf with questions as well.

also if the admin like to add the answear for each quesion they can add but it never will shown to the user, 

and now this is where the AI comes.

so as you know no one will answear exactly as the examiner so the AI will mesure the examiners answear and the users answear and give a score. we have to make a perfect prompt for this. and each users paper will be examind and gives a total score from 100% also shows if  the answear is wrong it shows why wrong. mcq answears will also can be added by the examiner in admin side. so AI can use only the score from each mcq and make the final eval.

ill add 3 gemini keys pool where automaticaly if a gemini key exausets or gives error the progress will stop, so we make a history track and if a key fails it automaticaly save a progress log and next api key will continue to make the evaluation.

currently this is my plan. what can be added and what we need more. mainly we are making this free tier all the way. remember hosting is done by vercell if cannot do with vercell we can use EC2. (i have ec2 free tier with tabby therminal)

lets discuss the plan first

---

# claude response

Your plan is solid and mostly doable on free tiers. Some parts need changes, though, and a few things are missing.

## Things to change

**1. Don't auto-refresh the browser at exam start.**
Fullscreen mode is lost on reload and can only be re-entered with a click. Instead, keep the page open and have it listen for a "start" signal (realtime), then swap the waiting screen for the paper. The camera, mic and fullscreen all stay on. It also works for both timed start and the admin's manual start.

**2. Admin with no login is risky.**
Anyone who finds the admin URL could watch every camera, read all answers and see the answer key. You can keep it simple without accounts: one shared admin passcode or a secret link. The answer key must also never be sent to the browser, only read on the server.

**3. A MER code alone is weak.**
Anyone who knows a colleague's code can log in as them. Add a second factor, such as a short PIN or date of birth that you add on the admin side. Also allow only one active session per person, so a second login kicks out the first and gets flagged.

**4. Live video for everyone is the hard part.**
Each candidate sends video to every watching admin, and the admin's browser has to decode every stream at once. It works for about 10 to 20 people but struggles beyond that. My suggestion:
- Low-res video (320x240, about 10 fps), shown as a grid, with a click to enlarge.
- Or a hybrid: a snapshot every 10 to 15 seconds for the grid, and live video and audio only when an admin clicks a person. This is far lighter and more reliable on free tiers.
- WebRTC needs a signaling channel (Supabase Realtime is fine) and a TURN server for people behind strict networks. Options are a free-tier TURN service or coturn on your EC2. For many viewers, a self-hosted LiveKit is better, but a free-tier EC2 is tight on RAM.

**5. "Mute" needs a definition.**
Do you mean the admin stops hearing a person, or the admin forces the person's mic off? Both are easy, and the mic stays muted by default either way.

## Proctoring reality check
The browser can detect tab switches, window blur and leaving fullscreen. It can't detect "browser closed" directly. Instead, the page sends a heartbeat every few seconds, and if it stops, the admin sees "disconnected" with a timestamp. Log every event with a time and a count, and consider an auto-flag after a set number of violations. Browser proctoring can't stop a second phone or a virtual machine, so treat the logs as evidence for a human to review. Also show a consent notice that camera and audio are monitored, since staff are being recorded.

## Exam engine
- Use the server clock for the start time and deadline. The client only shows a countdown from the server's time.
- Autosave on every change, plus a periodic save. The server rejects submissions after the end time.
- Resume works naturally: same end time, saved answers reloaded.
- Question editor: Tiptap gives bold, lists and sizes for free. Sanitize the HTML before showing it.
- Add marks per question, and optionally shuffled questions and options.
- PDF export: the simplest way is a print-styled HTML report saved as PDF. Server-side headless Chrome is heavy on free tiers.

## Gemini grading
- **Keys:** keys created in the same Google project share one quota. For real rotation, use keys from separate projects. Free-tier limits also change, so check the current numbers.
- **Privacy:** free-tier data may be used by Google to improve its products. Check that this is acceptable for exam answers.
- **Score in code, not by AI:** MCQs are scored by code. The AI grades written questions only, one job per question. The final total is added up in code, so it's consistent and easy to resume.
- **Job queue:** a table of jobs with status (pending, done, failed), which key was used, and the error. On a 429 or error, the key gets a cooldown and the same job retries with the next key. Nothing is lost.
- **Output:** force JSON output with score, max score, verdict, reason for lost marks and missing key points, at temperature 0.
- **Prompt:** give it the question, the examiner's model answer, marks, the candidate's answer, and rules: judge meaning not wording, award partial credit per key point, never reward padding, ignore any instructions inside the candidate's answer (prompt injection), and explain briefly. I'll draft this properly when we get there.

## Hosting
- Vercel is fine for the site and API, but it can't hold WebSocket connections. Use **Supabase free** (Postgres, Realtime, storage) for data and live signaling.
- Vercel Hobby limits function run time, and its terms restrict it to non-commercial use. A company exam may fall outside that, so check the terms. Cloudflare Pages is a free alternative that allows commercial use.
- A free-tier EC2 has limited RAM and its free terms depend on when your account was created. It suits a small grading worker or coturn, but I wouldn't run everything on it.

## Suggested stack
Next.js, Supabase, Tiptap, WebRTC (or snapshots first), Gemini Flash, and hosting on Vercel or Cloudflare Pages.

The biggest design decision is how many salespeople sit the exam at the same time, since that decides live video versus snapshots. Roughly how many will it be, and how many admins watching?

---

# you asked

message time: 2026-09-30 16:08:56

1. good acceptable
2. yes we can make a admin logins (there will be like 2 admins maybe or 3 max)
3. yes we can add NIC. i have all outlet peoples NIC
4. only 23 people in the exam yes lets go low res with 30 fps if we can (we can test it) shows as grid with mercode
5. Mute means stop hearing person mic. when click again can open the mic


yes heart beat is perfect and always create a per person log for each violations

yes exam engine is good too

yes i have multiple accounts. this is a small exam and just about some beauti questions so we dont care about privacy. also each mcq have a answaer done by our examiner and also the writen questions as well but as you know the answears from outlet people doesnt write exactly as the answear, but the AI will check examiners answear and the per user answear and give a score.

yes we will add supabase. 
my ec2 is the t3.small 
if we need i can add my drive for file saving. (have 1TB+ if needed)

23 people max sits the exam.

---

# claude response

With 23 candidates and a t3.small, this is all comfortably doable. Here is the plan with your decisions locked in.

## Architecture

| Part | Where | Why |
|---|---|---|
| Website (candidate and admin) | Vercel, or Cloudflare Pages | Vercel Hobby is officially non-commercial, so check that for a company exam |
| Database, admin login, live events, evidence images | Supabase free | Realtime handles the start signal, heartbeats and live status |
| Live video and audio | **LiveKit on your EC2** | Each candidate sends one stream, and it's shared to 2-3 admins |
| Grading worker | Small Node script on EC2 | No serverless time limits; it picks jobs from a table and rotates keys |

LiveKit is the important choice here. Without it, each candidate would upload a separate stream to every admin. With it, 23 candidates at low-res 30 fps is roughly 6 Mbps of download per admin, which a normal laptop handles. Muting is simple too: the admin's page just unsubscribes from that person's audio, and clicking again resubscribes. LiveKit needs HTTPS and open ports, so you'd need a subdomain such as `live.cometics.lk`. I'd test on LiveKit Cloud's free tier first, then move to EC2.

You don't need your Google Drive for now. Supabase storage is enough for small files. Drive only matters if you want to record full videos, which you didn't ask for.

## Security details
- **National ID:** store it hashed rather than in plain text, and add attempt limits, so a database leak doesn't expose it. The login flow is MER code, then ID, then a confirmation screen showing name and outlet, then acknowledge.
- **Admins:** Supabase Auth with email and password for the 2-3 admins. The answer key is readable only by admins and by the grading worker.
- **Single session:** a second login for the same MER kicks out the first and is logged.

## Extra features I'd add
1. **Pre-exam check screen:** camera, mic and fullscreen tests, plus a "waiting room" status for admins ("ready" or "camera blocked").
2. **Evidence snapshots:** on every violation, capture a small image and attach it to that person's log. It's cheap on storage and useful when you review flags.
3. **Admin controls:** start now, extend time for all or one person, force-submit one person, and send a broadcast message to everyone.
4. **Offline safety:** answers are also cached in the browser and synced when the connection returns.
5. **Admin score override:** AI scores can be edited, and the reason is shown next to each one.
6. **Exports:** a PDF per person (questions, answers, AI score and reasons) and one summary sheet with all 23 scores.
7. **Practice exam mode:** a dummy exam so you can test with 3-5 people before the real one.

## Grading pipeline
Written answers are graded one question at a time, and MCQs are scored by code. Each grading job stores the question, examiner answer, candidate answer, status, which key was used, and the result. If a key hits a limit, it gets a cooldown and the next key continues, so a failure never restarts the whole paper. The AI returns structured JSON (score, max score, reason, missed points), and the total out of 100 is added in code. With separate Google accounts, your 3 keys have independent quotas.

## Build order
1. Database, admin login, question builder, candidate management
2. Candidate login, exam engine, autosave, timer, resume
3. Proctoring events, heartbeat, per-person logs
4. Live video grid and mute controls
5. AI grading and the prompt
6. PDF and exports
7. A test run with a few people

One thing shapes the grading prompt: will the outlet staff write their answers in English, Sinhala, Tamil, or a mix, including Singlish typed in English letters?

---

# you asked

message time: 2026-09-30 16:11:31

i like the all extra features and all. loved it

yes now make the descusion md and implementation plan with all the details

---

# claude response

The discussion and implementation plan is in the file above. It covers the decisions we agreed on, the architecture, both user flows, the data tables, a draft grading prompt with key rotation, the server setup, an 8-phase build order, a test plan and an exam-day runbook. The whole build is roughly 16 to 22 working days, and a basic exam-only version (login, exam, autosave, violation logs) could be ready in about a week and a half.

Any free-tier limits or Gemini model names in it are marked *(verify)*, because they change and I haven't checked them.

There are a few open items at the top of the file I still need answers on:
- **Answer language:** English, Sinhala, Tamil, or a mix, including Sinhala typed in English letters. This changes the grading prompt.
- **Candidate devices:** an iPhone can't do fullscreen for a web page, so I've assumed desktop or laptop Chrome/Edge, or Android Chrome. Please confirm nobody will sit the exam on an iPhone.
- **Late joiners and marks:** I assumed everyone has the same end time, one correct answer per MCQ, and no negative marking.
- **Vercel Hobby plan:** it's meant for non-commercial use, so we may need Cloudflare Pages or the EC2 for the site.

Once you've answered, we can start Phase 0 and 1, or I can first draft the final grading prompt using a few real questions and examiner answers from your exam.

---

# you asked

message time: 2026-09-30 16:18:22

also the chorme browser have slit view. does this also flag?

Answer language is english, sinhala, mix, including Sinhala typed in English.
Candidate devices - laptop and android chorme browser. (only chorme)
Late joiners - there wont be late joiners but if there, this wont be effect because its a same timer for all people
Vercel Hobby plan - this is just a small exam not that big. if we can use vercel without a issue then we can use it

now if there isnt anymore questions make the implementation plan and the full descusion plan in details

---

# claude response

Yes, split view can be flagged, but only partly by the normal browser events, so I've added an extra check.

- **Tab-change event:** it won't fire in split view, because the exam page still counts as visible.
- **Focus loss:** it fires when the candidate clicks or types in the other pane, so that gets logged.
- **Just reading the other pane:** this wouldn't be caught by focus alone. So the plan also checks every second whether the window is narrower than the screen. That catches split view, Windows Snap, Chrome side panels (including built-in AI assistants), and Android split-screen. The check looks at width only, so the Android keyboard doesn't cause false alarms.
- **What I couldn't confirm:** how Chrome's split view interacts with fullscreen. I couldn't find documentation on that, so it's on the rehearsal test list.

I've rewritten the plan with all your answers included:
- **Language:** the grading prompt now handles English, Sinhala, mixed, and Sinhala typed in English letters. For each answer the AI also gives a short English "what the candidate meant" line, so the admin can check it understood correctly.
- **Devices:** Chrome only on laptop and Android. Other browsers are blocked with a message. Candidates should also open a Chrome Guest window so extensions are off, though I can't enforce that. I've also added a check for a second monitor.
- **Timer:** one shared end time for everyone, with an admin option to extend one person.
- **Vercel:** we start there. If it causes any trouble, the fallback is Cloudflare Pages or your EC2.
- **Simpler design:** candidates only use the website's own API, not Supabase directly, and the EC2 worker also finalizes expired exams, so no Vercel scheduled jobs are needed.
- **Added detail:** the file now also has the full database schema, the API route list, the grading worker steps, environment variables, folder layout, per-phase task checklists, and the exam-day runbook. The whole build is roughly 17 to 24 working days.

To finish the grading prompt, please send 3 to 5 real questions with the examiner's answers, plus a few sample staff answers, including some Singlish ones. I'll test the prompt on those before we build anything. After that we can start Phase 0 and 1: the database, admin login, candidate import and the question builder.

---

# you asked

message time: 2026-09-30 17:35:42

check and tell me are we good to implement or issues or gaps?

---

# claude response

Both files are read in full. The plan is now v3, with the question pool, super admin and Broadcast changes, so here is the review.

---

# you asked

message time: 2026-09-30 21:04:04

continue where you left off

---

# claude response

**Verdict: yes, you can start Phase 0 and 1 now. But fix the items below first, mainly the ones that change the database schema.** Schema changes are cheap today and painful after data exists. The plan is solid overall. I found real bugs in the design, not just polish.

## Fix before you write the migration (schema gaps)

1. **There is no way to store "force-end" or an exam-wide extension.**
   - The deadline is `started_at + duration_min`, and only attempts have `extra_minutes`.
   - Add `exams.ends_at`. Set it when the exam goes live, add to it on extend, and set it to now on force-end.
   - A person's deadline is then `exams.ends_at + attempts.extra_minutes`.
2. **Per-question marks and overrides have no home.**
   - `results.override_marks` is per attempt, but the review screen overrides per question, and MCQ marks per question are stored nowhere.
   - Add a `question_scores` table with attempt, question, source (mcq/ai/override), marks, max marks, reason and note. The PDF and review screen read from it, and `results` becomes just totals.
3. **Autosave needs a version number, not a timestamp.**
   - "Older `updated_at` never overwrites newer" uses the candidate's device clock, which can be wrong.
   - Add `answers.revision` (an integer the client increments per question) and accept only higher revisions.
4. **Option shuffle can't survive a reconnect.**
   - Only question order is saved.
   - Add `attempt_questions.option_order` (jsonb), or drop option shuffling.
5. **Rate limiting needs a `success` column on `login_attempts`.** More on this below.
6. **Add a `system_health` table** for the worker heartbeat instead of using `alerts` for it. Give alerts a dedupe rule, or the worker writes one every 2 seconds while keys are exhausted.

## Design bugs to fix in Phase 2

- **Broadcast can be spoofed.**
  - Anyone with the public anon key can publish to a public channel. A candidate could send `exam_ended` and get every client to submit.
  - Treat Broadcast as a nudge only. On any message, the client calls `/api/exam/state` and acts on the server's answer.
  - Also add a slow poll (every 5–10 s) as backup. Currently the plan has the fallback API but no client polling.
- **The rate limit can lock people out.**
  - If it counts all attempts per IP, 23 people logging in from one office network will hit the limit. Count failed attempts only.
  - An attacker can also lock a colleague out by spamming their MER. Make it per MER + IP, and let an admin reset it.
- **Question-pool race condition.** A double refresh at start can create two different subsets, because the primary key allows both. Generate the paper inside one database function that locks the attempt row.
- **Sessions aren't actually revocable.** The cookie is stateless, so "revoke older sessions" only works if every candidate API call checks the session ID against `sessions.revoked_at`. Add that.
- **National ID handling.**
  - Normalize before hashing (trim, uppercase, old and new NIC formats), or valid logins will fail.
  - Use `bcryptjs` or `@node-rs/argon2`. The native `argon2` package often breaks on Vercel.
  - Never log request bodies.
- **Late saves.** A 5-second grace at the deadline is tight on a slow network. Use 15–20 seconds and lock the UI at the deadline.
- **Server-side HTML cleaning.** DOMPurify needs a browser DOM. On the server use `sanitize-html` (or `isomorphic-dompurify`).
- **Auth checks.** Check the admin role inside every admin route handler, not only in middleware, and keep Next.js up to date.

## Video and proctoring

- **Keep the camera connection alive across pages.**
  - The plan integrates LiveKit separately in the waiting room and the exam page. That would reconnect the camera at start.
  - Put the LiveKit connection in a layout-level provider inside the `(candidate)` group. Route groups with separate root layouts trigger a full page reload, which kills fullscreen.
- **Enforce fullscreen in the waiting room too.** Fullscreen needs a click, so if they leave it while waiting, the exam start can't re-enter it automatically. Block with an overlay there as well.
- **Count incidents, not events.** Leaving fullscreen fires FULLSCREEN_EXIT, FOCUS_LOST and VIEWPORT_CHANGED together. That's one act counted as three violations. Merge events within about 3 seconds into one incident, and rate-limit snapshots. The frame captured while a tab is hidden may also be frozen or black.
- **Only run the width check while in fullscreen**, and test browser zoom and OS display scaling in the rehearsal so they don't cause false alarms.
- **Permission prompts and Android system dialogs** cause blur events, so keep all prompts inside the pre-exam check.
- **The LiveKit-failure banner** says "marks may be reduced", but the plan admits there is no such rule. If EC2 goes down, candidates would be scared for something that isn't their fault. Use "Camera disconnected. Please reconnect. Your exam continues and this is logged", and state any penalty policy openly on the rules screen.
- **EC2 firewall:** add TCP 80 for certificate issuance. Follow LiveKit's generated port list, and run its load-test tool with 23 simulated publishers *(verify)*.

## AI grading

- **Check your quota now.** A single free-tier Flash model may allow only a few hundred requests per day per key *(verify)*. Your plan needs about 460 calls. Grading a few questions per call, or a whole candidate's written answers in one call, would cut that to 23–100 calls. Make batch size a setting.
- **Don't call Gemini for empty answers.** Score them 0 in code. Create jobs only for the questions in each candidate's `attempt_questions`.
- **Tell rate limits from daily quota.** A 429 needs its error details parsed to know which one it is, or the cooldown will be wrong.
- **Health check:** use the key-listing endpoint instead of a test generation call, so it doesn't burn your quota.
- **Start grading only after the exam is finalized.** Regrading also needs a rule for which job counts as current.

## Operations and free-tier reality

- **Alerts need to reach you.** Right now they only show on a page you may not be looking at during the exam. Add a Telegram or Discord webhook from the worker. Also add a free uptime monitor (UptimeRobot) pinging a small public health endpoint. It also stops Supabase pausing from inactivity.
- **Backups:** free Supabase projects don't have reliable backups *(verify)*. Export results and PDFs right after the exam and copy them to your Google Drive. That is a good use of it.
- **AWS billing:** a t3.small and an Elastic IP may not be free depending on your account age, since public IPv4 addresses are charged *(verify)*. Set a billing alert.
- **Consent:** the rules screen should say camera and audio are watched live, snapshots are stored, and when they'll be deleted. It's worth a quick check with whoever handles compliance at cosmetics.lk, since you're storing staff photos and ID hashes.
- **Small gaps:** login should say which exam a candidate joins if several exist and check they're assigned to it; admin time entry should convert from Colombo time to UTC; the same file appears twice in the implementation plan (`results/[attempt]/page.tsx` in 6D.4 and 7.2).

## Your question

Do you want me to fold all of this into a v4 plan, with corrected SQL for the new columns, tables and the paper-generation function, and updated phase checklists?

---

# you asked

message time: 2026-10-01 08:58:55

this is a small exam and no one know this "Broadcast can be spoofed." so scratch that.
again small exam so dont worry about this "An attacker can also lock a colleague out by spamming their MER. Make it per MER + IP, and let an admin reset it."

here is the new plan check and briefly tell me what are our issues and gaps?

---

# claude response

This plan is close to ready, and it covers nearly everything from my last list. I dropped the Broadcast-spoofing and lockout points, as you said. These are the remaining problems, in order of importance.

**Fix before you write the migration**
1. **Alert dedup (1A.14):** a `UNIQUE (unique_key, resolved_at IS NULL)` constraint is invalid SQL and will fail the migration. Use a partial unique index: `unique (unique_key) where resolved_at is null`.
2. **Regrade can erase an override (6D.6):** "latest row wins" means a regrade after an admin override silently replaces it. Rule: override always wins, otherwise latest. `question_scores` also needs a `created_at` column, and totals should read from a "current scores" view.
3. **Batch grading doesn't match the schema (6B.1):** `grading_jobs` is unique per question, and the prompt and response schema are for one question. Decide now: one job per candidate, with an array of per-question results. That means about 23 calls instead of 460, and the prompt schema must change to match.
4. **Quota check can't be built (6A.8):** Gemini has no API to read remaining quota. Replace it with a dry-run call plus a manual look at AI Studio. The failover code is the real protection.

**Logic bugs**
5. **Exam end states:** nothing in the tasks moves exams from live to ended to finalized, but the grading guard depends on it. Add this to the worker scheduler, and make it finalize only after the deadline plus the 15-second grace, or the last autosave is lost.
6. **Force-end with extra time:** deadline = `ends_at + extra_minutes`, so a candidate who got extra minutes still has a future deadline after force-end. The answers API must also check the attempt and exam status, not only the deadline.
7. **Missed start signal:** if a candidate's Wi-Fi blips at the exact start moment, they sit in the waiting room while the exam runs. This is about reliability, not spoofing. Add a 5–10 second state poll plus a refetch on reconnect.

**Missing pieces**
8. **Dev uses the production database:** your test candidates, exams and answers will sit next to the real exam. Use a second free Supabase project for dev, or at least a cleanup script.
9. **Snapshot deletion:** the rules screen promises a deletion time, but there is no task that deletes them. Add one (a worker job or an admin button).
10. **Fullscreen across pages:** every candidate page change must be client-side routing, never a full page load. Also, the plan has no manual Submit button with a confirm dialog.
11. **LiveKit hostnames:** the LiveKit generator asks for a second hostname for TURN, with Caddy on 443. Check that DuckDNS supports a sub-subdomain *(verify)*.
12. **Docs out of sync:** the main plan's SQL and worker section are still v3, while the new columns live only in the implementation plan. Don't copy the SQL from the main plan. Also add `ALERT_WEBHOOK_URL` to the env variable list.

After items 1 to 7, you can start Phase 0 and 1.

Do you want me to write the final migration SQL (including `generate_paper()`, the current-scores view and the fixed alert index) and bring the main plan up to date?

---

# you asked

message time: 2026-10-01 09:06:52

thats ok we can clean the users after 100% testing "Dev uses the production database:"

check now are there's any more issues? or gaps?

also in LMS i saw it gives each question per user after the write or mcq they have to click next. so they cant go back after go to next question. also in admin panel we can make it togalable like if the admin like to do the cant go back feature or they can go back and forth feature. in the end they can submit.

---

# claude response

The plan is in good shape, and the round-2 fixes are all in. Cleaning test data after testing is fine. There are 5 small issues left, plus the navigation feature, which touches the schema and the exam engine.

## Remaining issues

1. **Status values don't match the schema.**
   - The plan now uses `force_ended` for exams and `force_submitted` for attempts, but the CHECK lists in the schema only allow `draft/scheduled/live/ended/finalized` and `not_started/acknowledged/in_progress/submitted/finalized`. The migration would reject them.
   - Simplest fix: keep the existing values and add `exams.force_ended_at` and `attempts.submit_reason` (`manual`, `auto`, `forced`).
   - Also, "finalized when all answers are flushed" can't be detected. Make it: the scheduler force-submits leftover attempts, then marks the exam `ended`, then `finalized`.
2. **`question_scores` has nowhere for AI details.**
   - The review screen shows matched points, missing points and confidence, but the table only has marks, reason and note.
   - Add `details jsonb` and `needs_review boolean`.
   - The new array schema also dropped `language`, `candidate_meaning_english` and `incorrect_claims`. Keep the English-meaning field, since it's how admins check Singlish answers.
3. **Grading job shape is half-changed.**
   - You moved to one job per candidate, but a single-question regrade would collide with the `(run_id, attempt_id)` key. Add a `question_ids` scope column, or give each regrade its own run.
   - Cap questions per Gemini call at around 10. One call with all 20 answers lets a single bad or injected answer affect the rest.
4. **Decisions still open:** the snapshot retention period (for example 30 days) for the rules screen, and whether candidate photos exist. The candidate form has no photo upload task, so either add one or drop photos.
5. **Two documents disagree.**
   - The main plan's SQL is stale, and the new columns are scattered across task rows.
   - With the new navigation fields as well, writing the migration by hand is error-prone. I'd write the single final migration SQL once.

## Navigation mode (sequential vs free)

Add one exam setting, `navigation_mode`: `sequential` (Next only, no going back) or `free`. Admins set it in the exam form, and it locks once the exam is live. Both modes end with a final Submit.

**Rules for sequential mode**
- It must be enforced on the server, not only in the UI. If it's only a hidden Previous button, a refresh or reconnect would show question 1 again, and answers could be edited through the network calls.
- Add `attempts.current_position`. **Next** is one atomic API call (`POST /api/exam/next`) that saves the current answer and moves the position forward.
- The answers API rejects any save for a question before `current_position`.
- The paper API returns **only the current question**, plus the total count for "Question 7 of 20". Sending the whole paper would let candidates read ahead in the browser tools.
- Reconnect resumes at `current_position`.
- Next waits for the server to confirm. If the connection is down, show "Reconnecting…" instead of advancing. The local IndexedDB copy still protects the text.
- The Next button warns when the answer is blank ("You can't come back to this question"). The last question's button becomes **Submit**.
- Block the browser Back button, so it doesn't leave the exam page.

**Rules for free mode**
- The whole paper loads, with a question list showing answered and unanswered ones, Previous/Next, and a summary screen before Submit.

**Both modes**
- The timer stays global.
- The question pool and shuffle still decide the order; `current_position` indexes into that saved order.
- The rules screen states which mode applies.
- The admin live grid shows progress per candidate ("Q 7/20" or "14 answered").

**Plan changes**
- **1A:** add `exams.navigation_mode` and `attempts.current_position`.
- **1D.2:** add the toggle, with a locked state once live.
- **2C.1:** the paper API returns all questions or only the current one by mode.
- **2D:** the question page needs a free-mode layout with a question list and a sequential layout.
- **2E.4:** the answers API gets the position guard.
- **New 2F task:** the `/api/exam/next` route.
- **2F.4:** reconnect resumes the position.
- **4C:** the progress label on the admin grid.
- **Phase 8 tests:** reconnect in sequential mode lands on the right question, a save for an earlier question is rejected, the browser Back button is blocked, and switching modes is impossible once live.

This adds about one day to Phase 2.

Want me to write the final migration SQL with these changes folded in, including `generate_paper()`, the `current_scores` view and the navigation fields?

---

# you asked

message time: 2026-10-01 09:13:33

no this is a small exam why add photos of the people? they all are in the office.

also this all fetures should work on android tabs as well. (not admins, all admins are on laptops, some candidates use tabs because they wont bring laptops)

here check the issues and gaps and tell me.

---

# claude response

The plan is solid apart from a few gaps and bugs, and the biggest gap is that nothing in it is designed for tablets yet. Most of what's below is about making the tablet candidates work.

**Photos:** drop them. Remove `photo_url` from the candidate table and the "photo" mention on the confirmation page (2A.5). That screen just shows name and outlet.

## Tablet gaps (Android Chrome)

1. **Pull-to-refresh will reload the exam.** One downward swipe at the top of the page reloads it, which exits fullscreen and drops the camera. Set `overscroll-behavior: none` on the exam page and test it.
2. **The on-screen keyboard is the biggest unknown.**
   - Written answers on a tablet mean typing with the keyboard open, possibly in fullscreen and in Sinhala.
   - Test whether fullscreen survives the keyboard, and that the Next/Submit button and timer stay visible above it. Use `100dvh` layouts.
   - Never rely on keydown events, since Android keyboards report a generic key code. Use input events instead. Turn off autocorrect, autocomplete and spellcheck on the answer box.
3. **"Desktop site" mode will break the width check.** The page gets a wider layout and the viewport check misfires. The pre-exam check should require it to be off. Page zoom needs the same test as on laptops.
4. **Samsung tablets default to Samsung Internet.** The Chrome check will block them, so the message should say "open this link in Chrome". Android also has no Guest window. The instructions need two versions: Guest window on laptops, and nothing extra on tablets since Chrome on Android has no extensions.
5. **Orientation:** lock it after entering fullscreen, because rotating mid-exam would trip the width check. Locking only works in fullscreen on Android.
6. **System Back gesture:** the Back block needs an Android test. Back probably exits fullscreen first, then navigates. `beforeunload` prompts are unreliable on Android, so don't depend on them.
7. **Wake lock** is released whenever the page is hidden, so re-request it when the page becomes visible again.
8. **Camera load:** weaker tablets may struggle at 30 fps while running the exam page. Cap Android at 15–24 fps.
9. **Feature detection:** `screen.isExtended` doesn't exist on Android, so check for it instead of assuming it. `navigator.userAgentData` can be missing on older Chrome, so fall back to the user-agent string.
10. **Touch layout:** the plan has no task for it. Add one for 768–1024 px widths in both orientations, 44 px touch targets, and no hover-only controls.
11. **Rehearsal items:** system overlays (notification shade, Samsung edge panel, Google Assistant or Circle to Search) may cause false focus-loss events. Add a full tablet run to the rehearsal, plus a "tablet users run the pre-exam check the day before" step in the runbook (first-time OS camera permission prompts).

## Bugs in the current plan

- **Extra time vs the scheduler (2F.5):** it force-submits leftovers at `ends_at + 15s`, which cuts off candidates who were given extra minutes. Use each attempt's own deadline (`ends_at + extra_minutes + 15s`), and mark the exam `ended` only after the last one passes.
- **Next button needs protection against double-taps and retries.** If the server advanced but the reply was lost, a retry would skip a question. Send `expected_position` with every Next call, and advance only if it matches the current position.
- **Position guard:** reject saves for any question other than the current one, not just earlier ones.
- **"Flagged" indicator (2D.8):** nothing defines it. Either add `answers.flagged` and a toggle, or remove the word.
- **Two "is it submitted" fields:** use `status in ('submitted','finalized')` as the only check, and keep `submit_reason` for the reason.

After these changes, you can start Phase 0 and 1. Want me to write the consolidated migration SQL now, including the navigation fields, `generate_paper()` and the `current_scores` view?

---

# you asked

message time: 2026-10-01 09:20:10

they all have chorme and all are 4gb ram tabs. so problem there but lets cap the android camera fps. thats good.

all the things need to be made in to implementation plan, and we go from phase to phase coding so... everything the complete system including the design should be in the implementation plan 

but for now we fix these bugs and after all fixed in the implementation plan we go to the next section untill we complete the full system in to implementation phases.

---

# claude response

All the round-4 bugs are properly in the plan, and the cross-reference table matches. I checked each one against the file: the scheduler's per-attempt deadline, `expected_position` on Next, the current-question-only save guard, the single submitted check, `answers.flagged`, and the tablet items.

## 5 small edits still needed

1. **Line 121 (2A.5):** change "show name/outlet/photo" to "show name and outlet (no photo)".
2. **3A.4 orientation lock:** it hard-codes `'portrait'`. Tablets are often held in landscape, so this would force a rotation. Lock to the orientation the candidate is in when they enter fullscreen, and unlock when fullscreen ends.
3. **4B.1 frame rate:** "15–24 fps with `max: 24`" is too loose for a 4 GB tablet. Use `frameRate: { ideal: 15, max: 15 }` on Android, tuned in the tablet rehearsal. Laptops stay at the 30 fps target.
4. **5B.10 desktop-site detection:** the method is vague. Specify it: after entering fullscreen, if `window.innerWidth` is greater than `screen.width`, or the user agent has no "Android" on a touch device, block the check and ask them to turn "Desktop site" off.
5. **2B.6 rules screen:** add the candidate instructions. For laptops: use a Chrome Guest window, no second screen, camera and mic on. For tablets: Chrome only, "Desktop site" off, and run the pre-exam check the day before. The Guest window instruction currently lives only in the old main plan.

## What's still outside the plan
The implementation plan still leans on the old main document for several things:
- The proctoring event list (§8.1).
- The SQL schema (§9).
- The grading prompt (§12.2).
- The env variables (§14.1).
- The repo layout (§14.6).
- The runbook (§18).

You also want the design in it, so these sections still need to be written in:

1. **Complete migration SQL:** all tables, constraints, indexes, RLS, `generate_paper()` and the `current_scores` view. It goes into Phase 1A, so a coding session can paste it in and run it.
2. **Design system and screen specs:** colours, type, layout rules for laptop and tablet, every candidate and admin screen, the states it can show, and the exact text on the rules, check and error screens.
3. **API contracts:** request, response and error shapes for every route.
4. **Proctoring spec:** the event list, thresholds, incident merging and snapshot rules.
5. **Grading spec:** the final prompt, response schema and worker rules.
6. **Infra and ops:** env variables, EC2 and LiveKit setup, repo layout and the runbook.

Next is section 1, the migration SQL, since everything else builds on the schema. Say go and I'll write it as one block ready to paste into Phase 1A.

---

# you asked

message time: 2026-10-01 09:25:07

ok check the bugs and gaps? if the current is ok then we can go to section 1

---

# claude response

Writing the Section 1 document now: the SQL, notes, and the exact edits for the plan. Then I'll hand over the files.

The current plan is OK to build on, and Section 1 (the migration SQL) is written.

**Check of the current plan:** all five round-5 edits are in. I found four more things while writing the schema. Three are fixed in the SQL, and one needs an edit in the plan:
1. **Task 5B.10 would block touchscreen laptops.** The check "touch-capable and no `Android` in the user agent" also matches Windows, Mac and ChromeOS laptops with touchscreens. Exclude those too (`Windows|Macintosh|CrOS`).
2. **Grading jobs collided.** Jobs were keyed by `(run_id, attempt_id)`, but a full run needs 2–3 chunk jobs per candidate. I added `chunk_index`, and a single-question regrade is its own run.
3. **Merged violation incidents had nowhere to be stored.** Each row is now one incident, with `merged_types` and a `counts` flag, and a trigger updates `violation_count`.
4. **Nothing created attempts.** The live grid needs "Not joined" for all 23 people, so assigning a candidate now creates their attempt automatically.

**Files for Section 1:**
- **`section-1-migration.md`** holds the SQL and the exact edits for each Phase 1 and 2 task, plus a cleanup script for test data.
- **`001_initial.sql`** is the migration to run. It makes the database enforce the rules itself: the revision check, the deadline with the 15-second grace, force-end, the sequential position guard, and Next being safe to retry.
- **`001_smoke_test.sql`** covers the main rules and rolls itself back.

I couldn't run the SQL, because my sandbox has no Postgres. I reviewed it line by line, but run the smoke test on your Supabase project before building on it. You should see "SMOKE TEST PASSED".

Do that first. Next is Section 2, the design system and screen specs for the candidate and admin sides on laptop and tablet, unless you'd rather do the API contracts first.

---

# you asked

message time: 2026-10-01 09:40:46

here check and tell is the section 1 completly in implementaion plan?

---

# you asked

message time: 2026-10-01 13:57:10

[text/markdown] Continuing-exam-platform-project.md

ok i completed many thing while you were gone.

---

# claude response

Checking the zip against the last gap list, to see which fixes were applied and what's left.

I've read the zip and the three chat transcripts, and the plan is in good shape: Sections 1, 3 and 4 are done and folded in through Round 20.

**What I checked**
- **Round 20 fixes:** all of the last gap list is applied (the 3B.6 skip rule, the 3A.4 orientation lock, tests 8.64 and 8.65, the contract's overlap wording, the client type allowlist, the `coalesce` notes, the reversal retry and the new dismiss route).
- **Routes:** every route in the contract has a matching task in the plan. The 44 route entries line up with the plan's `route.ts` tasks once query strings are ignored, including kick, unlock and snapshot purge.
- **Tests:** Phase 8 runs 8.1 to 8.65 with no duplicates. 8.49 was dropped on purpose.
- **New SQL:** I read `resolve_disconnects()`, `reverse_disconnects_for_incident()` and the changed violation trigger. I found no syntax or logic errors. I also traced smoke-test blocks 10 and 11 by hand, and the counts come out as expected (11b nets to 1, 11c reverses nothing).
- **Not run:** none of the SQL has been executed. The Phase 1A smoke test saying "SMOKE TEST PASSED" is still the real gate.

**Gaps and issues**
1. **There is no prompt for batch grading yet.** Task 6B.1 says "prompt from §12.2", but §12.2 in the old main plan is the single-question prompt. The plan now sends up to 10 questions per Gemini call and expects an array of results. Phase 6 can't be coded until that prompt and schema exist. This is the biggest gap.
2. **Other tasks still point to the old main document.** 0.4 and 0.8 cite §14.1 and §14.6 (env vars and repo layout), 8.12 cites §18 (the runbook), and the Phase 3 "Done when" cites §8.1. The last one is out of date: the event list is now in Section 4 §2, so that cell should point there.
3. **Timestamp format risk:** `resolve_disconnects()` compares `attempts.last_seen_at` with `meta.last_seen_at` for exact equality. If the worker turns the timestamp into a JavaScript date, the rule silently never fires. 3B.6 already says to store the exact string from the database, and test 8.65 would catch a mistake, so just don't skip that test.
4. **History tables only:** lines 647 and 656 still mention 1A.8–1A.20 and 1A.17, which no longer exist. It's harmless, and I'd leave it.

The roadmap from here is Section 5 (grading spec), then Section 6 (infra and ops), then Section 2 (design and screens) at the end, as you decided.

I'd do the grading spec next, since it's the biggest gap and Phase 6 depends on it. It would cover the batch prompt and response schema, the worker's key rotation rules, the `recomputeResults()` rules, calibration, and how `needs_review` is decided. If you have 3 to 5 real exam questions with the examiner's answers, plus a few staff answers including some Singlish, send them and I'll test the prompt against those. Shall I start Section 5?

---

# you asked

message time: 2026-10-01 14:00:57

ok if there is no issues and gaps from section 1, 3,4, we can now go to section 5

---

# claude response

I'm writing Section 5 (the grading spec) now. The test cases and the small SQL file are done, and the document itself comes next.

Section 5 (the grading spec) is written and ready for you to merge. I could not run any of it: there is no Gemini key and no Postgres in my sandbox, so the prompt has never been tested against Gemini.

**The biggest finding is the free quota.** A September 2026 article says the free Flash models allow about 20 requests a day, and Flash-Lite about 500. That article also says limits apply per project and model, and daily quotas reset at midnight Pacific time, which is about 12:30 pm in Sri Lanka until US clocks change on 1 November, then 1:30 pm. Older articles quote far higher numbers, so none of this is confirmed. Check the real limits for each of your three keys in AI Studio before exam day.

With 23 candidates and about 20 written questions each, one grading run needs roughly 46 calls. That barely fits within three keys at 20 a day, with no room for rehearsal or regrades.

**What the section sets up:**
- **Quota-aware worker:** it tracks usage per key and model, stops before the limit instead of waiting for errors, and pauses by itself when everything is used up. It resumes after the next reset and messages you with the resume time.
- **Prompt:** the batch prompt covers Sinhala, Singlish and negation (like "epa" and "naha"), which flip meaning. Candidate answers are sent as JSON strings, so they cannot break out of the instructions.
- **Scoring in code:** the marks are validated, rounded and checked by rules that flag doubtful answers for review. Valid items are saved even when part of a response is bad, and only the missing ones are re-queued.
- **Duplicate protection and a worker guard:** a crash can't create duplicate scores. A second worker, for example on your laptop against the shared database, exits instead of taking real jobs.
- **Also in the file:**
  - A guide for the examiner on writing model answers and grading notes.
  - A prompt test harness with 15 test cases.
  - A plan edit list.
  - 21 new tests (8.66 to 8.86).

**Things I chose that you should confirm** (section 0 has the full list):
- Chunk size is 10 questions per call, and you can raise it to 15–20 if your quota is tight.
- There is no fallback model by default, because mixing models in one exam hurts consistency.
- Confidence below 0.6, or 0.75 for Singlish, sends an answer to review.
- When all keys are used up, grading waits for the reset instead of failing.

I added one route you didn't ask for: regrade one question for all candidates, so a corrected model answer doesn't mean 23 separate clicks.

The Sinhala and Singlish test answers were written by me and may sound unnatural. Please replace them with real examiner questions and staff answers.

If the quota is not enough, billing on one project costs only cents for a whole exam, but that is your call.

Please apply the edits from section 12 to the plan and contract, and run `002_grading.sql` after `001_initial.sql`. Then Section 6 (infra and ops) is next: env variables, EC2 and LiveKit setup, alerts and the runbook. The design and screens come last, as you decided.