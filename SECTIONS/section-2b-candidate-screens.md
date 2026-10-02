# Section 2B — Candidate screens

Every screen a candidate sees, in order: login, confirm, rules, pre-exam check, waiting room, exam, done, plus the overlays, banners and error screens that can appear on top.

Uses the tokens and components from Section 2A (`--ink`, `--surface`, the Button, Field, Banner, Dialog and so on). It follows the routes and error codes in Section 3 and the incident behaviour in Section 4. Admin screens are Section 2C.

**Status.** Written from the plan and contracts by reading. Nothing is built or rendered. The interface is English only (decided). Questions and answers can be Sinhala, English, mixed or Singlish (§11). Items marked *(verify)* depend on browser behaviour that must be tested on a real tablet and laptop.

---

## 0. What I found while writing this (read first)

1. **Rule breaks have no penalty (decided).** The plan never defined one. The system warns the candidate and records the event, and the admins see each candidate's log and decide what to do in the office. The rules screen says exactly that (§4 row 6). Nothing happens automatically, not even at the flag threshold: it only colours the admin tile.
2. **A tab switch or focus loss shows a warning toast (decided)** and the event goes to the admin log. The toast appears when the candidate comes back to the page, because nothing can be shown while the tab is hidden (§8.7, Section 4 §3.7).
3. **The check-page order matters.** Plan 5B.9 says every browser prompt (camera, mic, fullscreen, wake lock) happens on the check page only. Fullscreen needs a fresh click on every page load, and the camera prompt can interrupt it. So the check is built as steps in a fixed order: browser, camera and mic, then fullscreen, then the automatic checks (§6).
4. **Confirm only navigates, but the acknowledge call needs `identity_confirmed: true`.** The confirm screen stores a flag (`sessionStorage`) that the rules screen reads and sends. If the flag is missing (a reload or a direct link), the rules screen sends the candidate back to the confirm screen (§5).
5. **A page reload during the exam drops fullscreen.** The cookie is still valid, so the app loads straight into the exam with the blocking overlay "Return to fullscreen". The camera should reconnect automatically if the browser remembers the permission *(verify on Android Chrome and laptop Chrome)*. If it does not, the camera banner shows (§8.4). This is separate from signing in again, which always repeats the check (contract 3.3).
6. **Option letters.** Options have no stored label. The screen letters them A, B, C… by their position in the candidate's own order (contract 3.0). A candidate and a staff member comparing papers will see different letters for the same option. That is intended.
7. **Question language.** The contract carries no language flag. The client sets `lang="si"` on any text block that contains a Sinhala character (U+0D80–U+0DFF), which applies the Sinhala size and line height from Section 2A. Mixed English and Sinhala blocks get the Sinhala sizing. That is accepted.
8. **All times are shown in Colombo time** (`Asia/Colombo`), whatever the device clock says. The countdown uses the server clock offset (task 2B.4), never the device clock.
9. **A reload is logged twice, and both count (decided).** A reload drops fullscreen, so the page logs `RELOAD` and a `FULLSCREEN_EXIT` incident, and both count (Section 4). That is 2 points, so the default flag threshold is now **10** instead of 5. Section 4, the migration default and the contract example were changed to match.
10. **A candidate can be `acknowledged` when the exam closes** (joined, but never loaded the paper). The route guard had no row for that, and the submit route would reject an auto-submit with `409 not_started`. §1.1 now has a row for it and §8.6 only submits when the attempt is in progress.
11. **The waiting room can reach 0:00 before the state says `live`.** The worker scheduler runs every 30 s (plan 2F.5), so the phase can lag. §6 now covers that gap.
12. **A LiveKit-only fault is not the candidate's fault** (Section 4). The camera banner (§8.4) now has separate wording for it, so the candidate is not told to "reconnect" a camera that works.

13. **Review fixes (current).** (a) The worker submits ordinary timeouts with reason `auto`; `forced` is reserved for an admin end/submit. (b) The time-up and Offline copy does not promise delivery after the 15-second collection window. (c) The camera preview scrolls clear of the answer text (§7.1). (d) Optional MCQ and written-question images render between the question and its answer controls (§7.2).

---

## 1. The candidate journey

```
login ─▶ confirm ─▶ rules ─▶ check ─▶ waiting ─▶ exam ─▶ done
  │                                      ▲
  └── returning candidate: login ─▶ check ┘  (rules and confirm are skipped when already accepted)
```

### 1.1 Which screen to show (route guard)

One rule table, used by the layout of the `(candidate)` route group. It reads the state body (`GET /api/exam/state`, or the heartbeat reply) and decides. Every move is a client-side navigation (`router.push`), never a full page load.

| Attempt status | Phase | Passed the check on this page load? | Show |
|---|---|---|---|
| No session | — | — | `/login` |
| `not_started` | `waiting` or `live` | — | `/confirm`, then `/rules` |
| `not_started` or `acknowledged` | `closed` | any | Error screen "This exam has ended." with Sign out (§8.6 does not run: no paper was loaded, so nothing is submitted from the browser) |
| `acknowledged` | `waiting` | no | `/check` |
| `acknowledged` | `waiting` | yes | `/waiting` |
| `acknowledged` or `in_progress` | `live` | no | `/check` (then straight to `/exam`) |
| `acknowledged` or `in_progress` | `live` | yes | `/exam` |
| `in_progress` | `closed` | any | `/exam`, locked, flushing (§8.6) |
| `submitted` or `finalized` | any | — | `/done` |
| any | any, reply is `401 session_revoked` | — | Signed-out screen (§10.2) |

"Passed the check on this page load" is held in memory only. A reload clears it on purpose, because fullscreen and camera permission need a new click.

**Exception (point 5 above):** a reload on `/waiting` or `/exam` with a valid cookie does not go to `/check`. It stays where it is and shows the fullscreen overlay, because the candidate was already past the check and sending them back would waste time in the exam.

### 1.2 Shared page rules

- **Title and headings:** one `<h1>` per screen, and the document `<title>` is "{Screen} · {Exam title}". After every navigation, focus moves to the `<h1>` and screen readers announce the new title.
- **Page frame (all screens except the exam):** logo top-left (40 px, `logo-ink.png`), a single column (28rem for forms, 68ch for reading), and at most one primary button.
- **Candidate identity line:** after login, a small line under the logo: "A. Perera · MER-0412" in `--muted`. Never the national ID.
- **Back button:** the browser Back button never leaves the candidate area. On the exam screen it is blocked (plan 2D.1). On other screens it is allowed within the flow only.
- **No hover-only controls, 44 px targets, tokens only.**

---

## 2. Login

**Route:** `/login` · **API:** `POST /api/auth/login` (3.3) · **Plan:** 2A.1

```
┌────────────────────────────────────────────┐
│ [logo]                                     │
│                                            │
│   Sign in to your exam                     │
│                                            │
│   MER code                                 │
│   ┌────────────────────────────────┐       │
│   │                                │       │
│   └────────────────────────────────┘       │
│   ID number                                │
│   ┌──────────────────────────┐ [Show]      │
│   │ ••••••••••••             │             │
│   └──────────────────────────┘             │
│                                            │
│   [ Sign in ]                              │
│                                            │
│   Having trouble? Ask the exam team.       │
└────────────────────────────────────────────┘
```

**Fields**
- **MER code:** text, `autocapitalize="characters"`, `autocomplete="off"`, `spellcheck="false"`. Shown uppercase. The server also uppercases and trims.
- **ID number:** masked by default, with a **Show** button (`aria-pressed`, 44 px) so a candidate on a tablet can check what they typed. `autocomplete="off"`, `inputmode="text"` (old-style numbers end with a letter). The value is sent as typed. The server normalizes it. Never stored in the browser, never logged.
- **Sign in:** primary. Pressing Enter in either field submits.

**States**

| State | What the screen does |
|---|---|
| Idle | Button enabled |
| Submitting | Button loading, both fields read-only, `aria-busy` |
| Wrong details (`401 invalid_credentials`) | Banner (Warning) above the form, fields keep their values except the ID, which is cleared. Focus moves to the banner |
| Too many tries (`429 rate_limited`) | Banner with the wait from `details.retry_after_s` rounded up to whole minutes. The button is disabled until then, with a visible countdown in words ("Try again in 4 minutes") that updates once a minute, not every second |
| Several exams (`409 multiple_exams`) | The form is replaced by the exam picker (§2.1) |
| No network / `503` | Banner: connection problem, button re-enabled |

**Copy**

| Where | Text |
|---|---|
| Title | Sign in to your exam |
| Labels | MER code · ID number |
| Show button | Show / Hide |
| Primary button | Sign in |
| Help line | Having trouble? Ask the exam team. |
| `401 invalid_credentials` | Your MER code or ID number doesn't match our records. Check both and try again. If it still doesn't work, ask the exam team. |
| `429 rate_limited` | Too many tries. Wait {n} minutes, then try again, or ask the exam team. |
| `403 exam_closed` | This exam has ended. |
| `403 no_exam_available` | No exam is open for you right now. Ask the exam team. |
| `403 not_assigned` | You aren't assigned to that exam. Ask the exam team. |
| `409 already_submitted` | You have already submitted this exam, so you can't sign in again. |
| `503` or network | We can't reach the server. Check your internet connection and try again. |

The wrong-details message must stay the same for an unknown MER code, a wrong ID, and an inactive candidate (the contract returns one code for all three). Do not make the copy say which one it was.

**Success:** the reply's `next` field says `confirm` (attempt `not_started`) or `check` (anything else). A returning candidate goes to the check.

### 2.1 Exam picker (`multiple_exams`)

Shown in place of the form. Credentials were already accepted, so this leaks nothing.

- Title: **Choose your exam**
- A radio list from `details.exams`: the exam title, and under it the start time in Colombo time ("Mon 5 Oct, 10:00 am") or "Starts when the exam team begins it" when there is no scheduled start.
- Primary button **Continue**. It sends the login again with `exam_id`. No exam is pre-selected. The ID number typed on the form is held **in memory only** (a component variable) so it can be sent again, and is cleared as soon as the second request returns. It is never put in `sessionStorage`, `localStorage` or the URL.
- A **Back** quiet button returns to the form.

---

## 3. Confirm identity

**Route:** `/confirm` · **API:** `GET /api/auth/me` (3.4) · **Plan:** 2A.5 · only for `not_started`

```
┌────────────────────────────────────────────┐
│ [logo]                                     │
│   Is this you?                             │
│                                            │
│   A. Perera                                │
│   Galle outlet                             │
│   MER-0412                                 │
│                                            │
│   Exam: Beauty Product Knowledge           │
│                                            │
│   [ Yes, this is me ]   [ No, it isn't ]   │
└────────────────────────────────────────────┘
```

- Shows full name (large), outlet, MER code, and the exam title. No photo (plan 2A.5).
- **Yes, this is me** (primary): sets `sessionStorage.identityConfirmed = "1"` and navigates to `/rules`. No API call.
- **No, it isn't** (secondary): calls `POST /api/auth/logout`, goes to `/login`, and shows a Notice: "You were signed out. Check your MER code and ID number, or ask the exam team."
- **Loading:** a one-line skeleton for the name block. **Error loading `/me`:** the Error pattern from Section 2A §4.16, with Retry.

**Copy:** title **Is this you?** · outlet line "{outlet} outlet" · exam line "Exam: {title}" · buttons as above.

---

## 4. Rules

**Route:** `/rules` · **APIs:** `GET /api/auth/me` (3.4), `POST /api/auth/acknowledge` (3.5) · **Plan:** 2B.6

This is the longest page. It is a reading page, so it follows the question text scale (`--text-md`), `max-width: 68ch`, and sections with `<h2>` headings.

```
┌────────────────────────────────────────────┐
│ [logo]                                     │
│   Before you start                         │
│   Beauty Product Knowledge · {question_count} questions │
│   · 45 minutes                             │
│                                            │
│   How this exam works                      │
│   …                                        │
│   What is monitored                        │
│   …                                        │
│   Rules                                    │
│   …                                        │
│   Set up your device                       │
│   Laptop: …   Tablet: …                    │
│                                            │
│   ☐ I have read and accept these rules.    │
│   [ Accept and continue ]                  │
└────────────────────────────────────────────┘
```

**Content blocks, in this order**

| # | Heading | Source | Text |
|---|---|---|---|
| 1 | (summary line) | `/me` `exam` | "{title} · {question_count} questions · {duration_min} minutes" and, if `scheduled_start_at` exists, "Starts {Colombo time}" |
| 2 | Instructions from the exam team | `exam.instructions` | Plain text, `white-space: pre-wrap`. Never rendered as HTML (contract 3.4). Omit the block when empty |
| 3 | How this exam works | `navigation_mode` | **Sequential:** "You answer one question at a time. When you press Next, you can't go back to earlier questions." **Free:** "You can move between questions in any order, flag questions to review, and change answers until you submit." Then: "Your answers are saved as you type. The timer keeps running even if your connection drops." |
| 4 | What is monitored | `rules.snapshot_retention_days` | "Your camera and microphone are watched live by the exam team for the whole exam. If you break a rule, a photo from your camera is saved with a record of what happened. Those photos are deleted after {n} days." The number must come from the API, never be typed into the page |
| 5 | Rules | fixed | A list: Stay in fullscreen and on the exam page for the whole exam. · Don't switch to another tab or window. · Use one screen only. · Keep your camera and microphone on. · Don't copy, paste, or open the right-click menu. · Work alone. |
| 6 | If a rule is broken | fixed | "If a rule is broken, you will see a warning and the exam team will see a record of it. Nothing happens automatically. The exam team reviews the records and decides what to do." |
| 7 | Time | fixed | "The timer starts for everyone together. Your answers are saved as you type, but they have to reach the server before the time ends, so reconnect as soon as you can if your connection drops. If you have a problem, tell the exam team. They can add time for you." |
| 8 | Set up your device | fixed | **Laptop:** "Use a Chrome Guest window. Close other windows. Use one screen. Turn your camera and microphone on." **Tablet:** "Use Chrome only. Turn Desktop site off. Run the check the day before so Android can ask for camera permission then, not during the exam." |

**Acceptance**
- One checkbox: **I have read and accept these rules.** It is a native checkbox with a visible label (44 px row).
- Primary **Accept and continue** is disabled until the box is ticked. A disabled button explains itself: the line under it says "Tick the box to continue." (visible, not a tooltip).
- On press: `POST /api/auth/acknowledge` with `{ identity_confirmed: true, rules_accepted: true }`. `identity_confirmed` comes from the confirm flag (§0 point 4). If the flag is missing, redirect to `/confirm` before anything is sent.

| State | What happens |
|---|---|
| Sending | Button loading |
| `200` | Navigate to `/check` |
| `409 exam_closed` | Error screen: "This exam is closed." with a Sign out button |
| `409 already_submitted` | Navigate to `/done` |
| Network error | Banner and the button re-enabled. Idempotent, so a retry is safe |

If the attempt is already `acknowledged` (a returning candidate who lands here), skip straight to `/check`.

---

## 5. Pre-exam check

**Route:** `/check` · **Plan:** 5B.1–5B.10 · **All permission prompts happen on this page only** (5B.9)

The check is a short list of steps. Each step shows a status in words and an icon: **Waiting**, **Checking**, **Passed**, **Needs attention**. Later steps stay locked until earlier ones pass.

```
┌────────────────────────────────────────────┐
│ [logo]                                     │
│   Check your device                        │
│   This takes about a minute.               │
│                                            │
│   ✓ 1  Browser            Passed           │
│   ● 2  Camera and mic     [ Allow ]        │
│        ┌─────────┐  Mic on ✓               │
│        │ preview │                         │
│        └─────────┘                         │
│   ○ 3  Fullscreen         Waiting          │
│   ○ 4  Connection         Waiting          │
│   ○ 5  Screens and display  Waiting        │
│                                            │
│   [ Continue ]  (disabled until all pass)  │
└────────────────────────────────────────────┘
```

| Step | Plan | What it does | Needs a click? | Blocks Continue? |
|---|---|---|---|---|
| 1 Browser | 5B.2 | Reads `navigator.userAgentData.brands`, falls back to the UA string. Chrome only | no | **Yes** |
| 2 Camera and mic | 5B.3, 5B.4 | One `getUserMedia` call for both. Shows a live, mirrored camera preview. **There is no microphone test**: everyone sits in the same room, so a level meter would add nothing. The mic only has to be enabled. Passed when video is flowing and the microphone track is `live` and not muted | **Yes: "Allow camera and mic"** (secondary button) | **Yes** |
| 3 Fullscreen | 5B.5, 5B.8 | **"Enter fullscreen"** (secondary button) requests fullscreen, then, in the same click, requests the screen wake lock. Passed when the page is fullscreen. On Android, then locks orientation to the current one (3A.4) | **Yes** | **Yes** |
| 4 Connection | 5B.6 | Calls the time and state APIs, measures round trip, sets the server clock offset (2B.4). Passed on success | no (runs after step 3) | **Yes** |
| 5 Screens and display | 5B.7, 5B.10 | Laptop: `screen.isExtended` (skipped where undefined). Android: desktop-site check, run **after** fullscreen is entered (`innerWidth` against `screen.width`, and the UA rule in 5B.10) | no (runs after step 3) | Desktop site: **Yes**. Second screen: **No**, a warning only (logged as `MULTI_SCREEN` later) |

**Why this order:** the camera prompt can pull the page out of fullscreen on some devices, so the camera comes first and fullscreen second. Fullscreen must come before the screen and desktop-site checks because they only read correctly while fullscreen. Wake lock is requested in the fullscreen click because it needs a user gesture.

**Per-step "Needs attention" copy**

| Step | Message |
|---|---|
| Browser | This exam only works in Google Chrome. Open this page in Chrome to continue. |
| Camera, permission denied | Camera or microphone access is blocked. Tap the lock icon next to the address, allow camera and microphone, then press Allow again. |
| Camera, not found | No camera was found. Connect a camera and press Allow again. |
| Fullscreen | Fullscreen didn't start. Press Enter fullscreen again. If it still fails, ask the exam team. |
| Connection | We can't reach the exam server. Check your internet, then press Check again. |
| Desktop site | Turn off "Desktop site" in Chrome's menu, then press Check again. |
| Second screen | A second screen was found. Disconnect it before the exam starts. (Warning only: you can still continue.) |

**Wake lock** is requested silently. If the browser refuses it, nothing is shown, and the app re-requests it whenever the page becomes visible again (5B.8). It never blocks Continue.

**Buttons on this page:** the step buttons (**Allow camera and mic**, **Enter fullscreen**, **Check again**) are Secondary. **Continue** is the only Primary button, which keeps the one-primary rule from Section 2A §4.1.

**The exam clock does not wait.** A candidate who signs in again during a live exam repeats this check while their timer runs. The page shows a quiet line under the title when the phase is `live`: "The exam is running. Finish this check to continue." with the time left (Timer component, Section 2A §4.4).

**Continue** (primary): enabled when steps 1–5 have passed (a second-screen warning does not block). Pressing it records "passed the check on this page load" in memory and navigates (client-side) to `/waiting`, or to `/exam` when the phase is already `live`. It keeps the camera stream, fullscreen and wake lock, which now live in the layout-level LiveKit provider (4B.2).

**Retesting:** every step has a **Check again** quiet button once it has run. The preview stops when the candidate leaves the page. A returning candidate always sees this page after signing in (contract 3.3).

**Accessibility:** the step list is an ordered list. Status changes are announced politely ("Camera and mic passed"). The preview has `aria-label="Your camera preview"`.

---

## 6. Waiting room

**Route:** `/waiting` · **APIs:** `GET /api/exam/state` (3.7), `POST /api/heartbeat` every 10 s (3.12), Broadcast `exam:{examId}` (Section 3 §6) · **Plan:** 2B.3

```
┌────────────────────────────────────────────┐
│ [logo]                       A. Perera     │
│                                            │
│   Beauty Product Knowledge                 │
│                                            │
│   The exam starts in                       │
│   12:30                                    │
│   Mon 5 Oct, 10:00 am                      │
│                                            │
│   ┌─────────┐   Camera on ✓                │
│   │ preview │   Microphone on ✓            │
│   └─────────┘                              │
│                                            │
│   Stay on this page. Don't leave           │
│   fullscreen.                              │
└────────────────────────────────────────────┘
```

**Behaviour**
- **Countdown:** time to `exam.scheduled_start_at`, counted with the server-clock offset, format `M:SS` (`H:MM:SS` over an hour). Uses `--text-timer`. Not read aloud every second (announced at 10, 5, 2 and 1 minute).
- **At 0:00** (the countdown reaches zero before the state says `live`, because the worker's scheduler loop is up to 30 s): the countdown is replaced by the Notice "The exam is starting…" and the page asks `GET /api/exam/state` every 3 s until the phase changes, then follows the **Start** rule below. It never shows a negative time. If the phase is still `waiting` after 60 s, add "This is taking longer than expected. Stay on this page. Tell the exam team if this continues." (nothing tells the exam team automatically).
- **No scheduled time** (`scheduled_start_at` null): show "The exam team will start the exam. Stay on this page." and no countdown.
- **Start:** when the state says `phase: live` (a Broadcast `exam_started` is only a nudge, so the page calls `/api/exam/state` and acts on the answer), the page calls `GET /api/exam/paper` and navigates to `/exam`. Show "The exam is starting…" (Notice, no countdown) while the paper loads. If the paper call returns an error (see §7.8), the page shows the matching message and keeps retrying every 5 s.
- **Time changes:** if the admin changes the start time, the next state reply carries the new time and the countdown simply updates. A Notice says "The start time changed to {time}."
- **Proctoring:** the proctoring hook and the 10-second heartbeat run here. The fullscreen overlay applies here too (3A.4 and 2B.3). Leaving fullscreen shows the overlay (§8.3).
- **Announcements** from the exam team appear as queued top-right 5-second toasts (§8.5).
- The camera preview is 160×120, mirrored, with "Camera on" and "Microphone on" in words next to it. If a track is lost, the words change to "Camera off" with a Warning icon, and the Camera banner appears (§8.4).

**States**

| State | Screen |
|---|---|
| Waiting with time | Countdown |
| Waiting, manual start | "The exam team will start the exam." |
| Starting | "The exam is starting…" |
| Fullscreen lost | Blocking overlay over the page |
| Connection lost (heartbeat fails) | Warning banner: "Connection lost. Reconnecting…" The countdown keeps running on the local clock |
| Exam closed before the candidate started | `phase: closed` → Error screen "This exam has ended." with Sign out |

---

## 7. Exam screen

**Route:** `/exam` · **APIs:** `GET /api/exam/paper` (3.8), `POST /api/answers` (3.9), `POST /api/exam/next` (3.10), `POST /api/exam/submit` (3.11), heartbeat (3.12), events (3.13) · **Plan:** 2D.1–2D.9, 2E, 2F

### 7.1 Frame (both modes)

```
 ┌───────────────────────────────────────────────────────────────┐
 │ Title    Question {n} of {total}   ✓ Saved 10:42    48:12     │  56 px strip, fixed
 ├───────────────────────────────────────────────────────────────┤
 │ [banner area: only when needed]                               │
 │                                                               │
 │  content (scrolls)                                            │
 │                                                               │
 ├───────────────────────────────────────────────────────────────┤
 │ bottom bar (fixed, always above the keyboard)                 │  64 px
 └───────────────────────────────────────────────────────────────┘
                                  camera preview 96×72, bottom-right, above the bar
```

- Built with `100dvh`, `overscroll-behavior: none`, a fixed strip, a scrolling middle and a fixed bottom bar, so Next and Submit stay visible above the on-screen keyboard (2D.1).
- **Strip contents:** left, the exam title (truncated, hidden below 900 px wide); centre, position; right, the save indicator and the timer (Section 2A §4.4 and §4.5). The logo is **not** shown here.
- **Position text:** sequential "Question {n} of {total}"; free "{total} questions · {answered} answered". Both values come from the generated paper; no question count is hardcoded. Position text is `aria-live="off"`.
- **Camera preview:** 96×72, mirrored, fixed bottom-right above the bottom bar, not draggable, `aria-label="Your camera preview"`. It is **hidden while the on-screen keyboard is open** on a 768 px portrait tablet, so it can never cover the answer box (the camera keeps streaming, only the self-view is hidden). It comes back when the keyboard closes. The scrolling content area has bottom padding equal to the preview's height plus 16 px, so the last lines of a long answer can always be scrolled clear of it.
- **Content width:** question and answer share one column, at most 68ch. Free mode adds the sidebar to the left (§7.4).
- **Browser Back** is blocked, pull-to-refresh is off, and right-click and long-press menus are blocked and logged (3A.8). When paste is blocked, a small inline message appears under the answer box for 4 seconds: "Pasting is turned off during this exam." (`role="status"`).

### 7.2 Question card

- **Question text:** `body_html` (already sanitized by the server) at `--text-question`, with the question number first: "7." followed by the text.
- **Optional question image:** when `image` is present in the paper response, render it after the question text and before the MCQ options or written-answer box. Load it from the authenticated question-image API, preserve aspect ratio (`max-width: 100%; height: auto`), use the stored alt text, reserve its layout space, and show a non-blocking **Image could not be loaded** placeholder with Retry on failure. With no image, render the text-only layout unchanged.
- **Marks:** shown quietly to the right of the number, "2 marks" ("1 mark" for one), in `--muted`. The admin sets marks per question and may leave the field empty, in which case the question carries 1 mark (contract 4.3). Candidates always see the number the question carries.
- **Language:** `lang="si"` is set on any block with a Sinhala character (§0 point 7).
- **MCQ:** the Section 2A option row component. Letters A, B, C… by position. Selecting an option saves at once (no debounce). The selected option has the 2 px ink border, the grey background and a check icon.
- **Written:** the answer textarea (Section 2A §4.2), minimum 12 lines, grows with content up to the available height, then scrolls inside. Label (visually hidden but present): "Your answer". No character counter. Hard limit 20,000 characters from the contract: at 19,000 a quiet counter appears ("1,000 characters left"); at the limit input is stopped with the same message in `--warn`.
- Saving follows 2D.5 and 2D.6: `input` events, 1 s debounce, 10 s periodic, IndexedDB first, then the server.

### 7.3 Sequential mode

```
 strip:  Title      Question 7 of 20      ✓ Saved       48:12
 ───────────────────────────────────────────────────────────
  7.  Explain how you would handle …                2 marks

  ┌─────────────────────────────────────────────────┐
  │                                                 │
  └─────────────────────────────────────────────────┘
 ───────────────────────────────────────────────────────────
                                            [ Next question ]
```

- Bottom bar: **one** button, right-aligned, **Next question** (primary). There is no Previous button and no question list.
- On the last question the button reads **Submit exam**.
- **Next question flow** (2D.7 and contract 3.10):
  1. If the answer is blank: open the **Blank answer dialog** (§7.6). **Blank** means a written answer that is empty after trimming whitespace, or an MCQ with no option selected. This is the same rule Section 5 uses for "blank answers are scored in code".
  2. Otherwise send `POST /api/exam/next` with `expected_position`, the question id, the answer and the revision. The button shows loading and is disabled (double-tap guard).
  3. `advanced` / `already_advanced` / `out_of_sync`: show the new question from the same reply and move focus to its heading. On `out_of_sync` also show the Notice "We moved you to question {n}."
  4. `last_question`: show Submit exam.
  5. `exam_closed`: lock the screen (§8.6).
  6. `invalid_state` or `wrong_position`: silently reload `GET /api/exam/paper` and show the current question.
  7. Network down: the button does not advance. It shows **Reconnecting…** in the button's place and the text is kept safe by IndexedDB. It retries by itself and enables again when the connection is back.
- The first time a candidate reaches question 2, nothing special is shown. The rules screen already said they can't go back.

### 7.4 Free mode

```
 strip:  Title   {total} questions · {answered} answered   ✓ Saved   48:12
 ┌────────────────┬──────────────────────────────────────────────┐
 │ Questions      │ 7.  Explain how you would …    [⚑ Flag]      │
 │  1 ✓ Answered  │                                              │
 │  2 ✓ Answered  │  ┌────────────────────────────────────┐      │
 │  3 ○ Not ans.  │  │                                    │      │
 │  4 ⚑ Flagged   │  └────────────────────────────────────┘      │
 │  …             │                                              │
 │ [Review and    ├──────────────────────────────────────────────┤
 │  submit]       │ [ Previous ]                    [ Next ]     │
 └────────────────┴──────────────────────────────────────────────┘
```

- **Sidebar** (laptop and tablet landscape): 240 px, the Section 2A question list. Every row says "Answered", "Not answered" or "Flagged" in words with an icon. A question that is both answered and flagged shows "Answered, flagged". The current row has the 2 px ink left rule and `aria-current="step"`. Rows are 44 px buttons.
- **Tablet portrait (under 900 px):** the sidebar becomes a drawer opened by a button in the strip, **Questions ({answered}/{total})**. The drawer closes on selection and on Escape. Focus returns to the button.
- **Flag toggle:** a button in the question header, "Flag for review" / "Remove flag", `aria-pressed`. It saves the same way as an answer (`flagged` in `POST /api/answers`).
- **Previous / Next** in the bottom bar. Previous is disabled on question 1, Next on the last question. On the last question the primary button becomes **Review and submit**.
- **Review and submit** (sidebar button and last-question button) opens the **Summary screen** (§7.5). The sidebar button is Secondary, so the bottom bar keeps the single Primary button (Section 2A §4.1).
- A free-mode move from question to question does not need a server call. The answer is already saved by autosave. Moving flushes the pending save first (waits at most 1 s).

### 7.5 Summary screen (free mode, before submit)

Replaces the content area. Heading **Review your answers**.

- Counts line: "14 answered · 6 not answered · 2 flagged".
- A list of the questions that are **not answered** or **flagged**, each a button that jumps to that question. If all are answered and none flagged: "All {total} questions are answered."
- Buttons: **Back to questions** (secondary) and **Submit exam** (primary). Submit opens the Submit dialog (§7.6).

### 7.6 Dialogs on the exam screen

| Dialog | When | Title | Body | Buttons (confirm / dismiss) |
|---|---|---|---|---|
| Blank answer | Sequential Next on a blank answer | Move on without an answer? | You can't come back to this question. | **Continue without an answer** / **Keep working** |
| Submit | Any Submit exam | Submit your exam? | You can't change your answers after you submit. {n questions are not answered.} | **Submit exam** / **Keep working** |

- The unanswered sentence appears only when something is blank, and counts only questions the paper contains.
- **Submit flow** (2F.1, 2F.2, contract 3.11): the confirm button shows loading. The client waits for the autosave queue to drain (at most 3 s) and puts anything left into `pending_answers`, then sends `POST /api/exam/submit` with `reason: "manual"`. Success (including `already_submitted: true`) goes to `/done`. On a network error the dialog stays open with a message and the button re-enabled: "We couldn't submit yet. Your answers are saved. Try again." Failures never close the dialog by themselves.
- Escape and **Keep working** close a dialog and return focus to the button that opened it.

### 7.7 Save and connection behaviour on this screen

Follows Section 2A §4.5. In words:
- Typing shows "Waiting to save" then "Saving…" then "Saved {time}".
- No connection: "Offline. Answers are kept on this device. Reconnect to save them." plus the Warning icon. The timer and the text keep working. When the connection returns, queued answers send in order and the state goes back to Saved.
- `stale_revision` and revision recovery (contract 3.9) are invisible to the candidate.
- A `409 exam_closed` from a save locks the screen (§8.6).
- A failed heartbeat shows no extra banner on the exam screen: the save indicator already says "Offline. Answers are kept on this device. Reconnect to save them." (on `/waiting` the banner in §6 applies).
- In sequential mode, an autosave can arrive after the candidate has moved on and get `409 wrong_position` for the question they just left. The client drops that queued save silently, with no message and no retry, because the Next request already carried that answer. Any other `wrong_position` (the screen shows a question the server did not expect) reloads `GET /api/exam/paper` as in §7.3 step 6.

### 7.8 Paper loading errors (from `GET /api/exam/paper`)

| Code | Screen text |
|---|---|
| `not_acknowledged` | Redirect to `/rules` |
| `exam_not_live` | Stay on the waiting room, Notice: "The exam hasn't started yet." |
| `attempt_closed` | Go to `/done` |
| `exam_has_no_questions` | Error screen: "This exam has no questions yet. Tell the exam team." with Sign out |
| `503` or network | "Loading your exam…" with a visible Retry button after 8 seconds. The page retries by itself every 5 s |

### 7.9 Touch and tablet rules

44 px targets everywhere (option rows are 56 px). Answer text 18 px minimum. In portrait the strip drops the title, the sidebar becomes the drawer, and the preview shrinks to 72×54. In landscape, at 768 px height with the keyboard open, the answer box is the only scrolling element and the strip, banners and bottom bar stay visible. Test at 768×1024 and 1024×768 in both rotations (rehearsal 8.27).

---

## 8. Overlays, banners and time

### 8.1 Where they sit

Overlays cover the page. Banners sit between the strip and the content and never cover the question. At most **one overlay** and **two banners** show at once. Order of priority for banners: Warning above Notice.

### 8.2 Priorities

If several things happen together: signed-out screen > fullscreen overlay > locked/time-up state > banners.

### 8.3 Fullscreen overlay

Component from Section 2A §4.8. Applies on `/waiting` and `/exam`, and after a reload.

| Part | Text |
|---|---|
| Title | Fullscreen is required |
| Body | Press the button to go back to the exam. Your time keeps running. |
| Button | Return to fullscreen |

- On the exam screen the overlay covers everything below the top strip, so the timer stays visible (Section 2A §4.8).
- Pressing the button requests fullscreen (a user gesture, as the browser needs) and re-locks orientation on Android. The overlay closes when `fullscreenchange` reports fullscreen.
- If the request fails, the body adds: "Fullscreen didn't start. Try again. If it keeps failing, tell the exam team."
- The overlay **cannot** be dismissed any other way. It never shows the word "violation", a count, or a penalty.
- It is always logged as a `FULLSCREEN_EXIT` incident (Section 4), whether or not the candidate sees it for long.

### 8.4 Camera banner (4B.4)

A Warning banner (Section 2A §4.6). It stays while the condition lasts and disappears by itself when the track is back. It never mentions a penalty, and it says "recorded" (the same word as the tab-switch toast in §8.7).

| Case | Text |
|---|---|
| Camera stopped on the device | **Camera disconnected. Please reconnect. Your exam continues and this is recorded.** |
| Microphone stopped on the device | **Microphone disconnected. Please reconnect. Your exam continues and this is recorded.** |
| Both stopped | **Camera and microphone disconnected. Please reconnect. Your exam continues and this is recorded.** |
| Only the connection to the exam team's video server is lost (the camera and mic still work in the browser) | **Your exam continues. We're reconnecting your video to the exam team. You don't need to do anything.** |

The last row is the platform's fault, not the candidate's: Section 4 logs it with `meta.source = 'livekit'` and does not count it. So it follows the Section 2A rule "say *Your exam continues* first", does not tell the candidate to reconnect anything, and does not say "recorded". The preview stays on and "Camera on" stays in the waiting room. If a device track is also lost, the device wording wins.

---

### 8.5 Notices

| Event | Banner text | Dismiss |
|---|---|---|
| Time extended (`time_updated`, or the deadline in state moved later) | Your time was extended by {n} minutes. The timer now shows your new time. | Dismiss button, also auto-hides after 30 s |
| Message from the exam team (`state.announcements`, each `id` shown once) | The exam team says: "{message}" | Top-right toast, automatically disappears after 5 seconds. Escaped plain text, at most 5,000 characters; long text wraps/scrolls without covering answer controls |
| Moved to the current question (`out_of_sync`) | We moved you to question {n}. | Auto-hides after 10 s |
| Start time changed | The start time changed to {time}. | Auto-hides after 30 s |

Announcements are queued in `sent_at` order and each is announced once (`role="status"`). There is no per-exam announcement-count limit. Extension amount is the difference between the old and new deadlines, rounded to whole minutes.

### 8.6 Time up and the locked screen

When the deadline passes (`phase: closed`, or the local clock passes the deadline), or a save returns `exam_closed`:

1. All inputs, options and buttons become read-only. The timer shows "Time is up".
2. A Notice appears: **Time is up. Sending your answers…**
3. The client flushes the autosave queue, then calls `POST /api/exam/submit` with `reason: "auto"` and any `pending_answers` (3.11). This only happens when the attempt is `in_progress`. For `not_started` or `acknowledged` the route guard in §1.1 shows the "This exam has ended." screen instead, because the submit route would answer `409 not_started`.
4. On success (including `already_submitted`), go to `/done`.
5. If the connection is down, the Notice becomes **Time is up. Reconnect to send your answers. Keep this page open. Answers can only be saved for a few seconds after time is up.** The client keeps retrying. (The server accepts saves for 15 seconds after the deadline, then refuses them. Anything still waiting on the device after that is not saved, so the text must not promise otherwise.) If the server submits first (the worker does after the grace period), the next heartbeat returns `submitted` and the client goes to `/done`.

When the exam team ends the exam (`exam_ended` Broadcast, then state `closed`), the same locked screen says **The exam has ended. Sending your answers…** The client immediately sends its current queued answers through `POST /api/exam/submit`; the server derives `reason = "forced"` from the force-ended exam rather than trusting the candidate payload. It retries during the 15-second force-end collection window. The worker then force-submits any remaining attempts from the latest answers already received, so partial written answers are retained and graded.

### 8.7 Tab switch or focus loss: warning toast

Component: Section 2A §4.14a. Rules for when it appears are in Section 4 §3.7.

| Part | Text |
|---|---|
| Message | **You left the exam page. This was recorded and the exam team can see it. Please stay on this page.** |
| Button | Dismiss |

- Shown when the candidate returns to the page and the incident that just closed contained a tab switch or focus loss, during the exam only (not in the waiting room).
- Sits in the banner area, auto-hides after 10 seconds (`WARNING_TOAST_MS`), one at a time, newest replaces the old one. It counts as one of the two banners allowed in §8.1.
- It never shows a count, a flag status or the word "violation", and it never mentions a penalty.
- Logging does not wait for the toast, and the toast does not wait for the log.

---

## 9. Done

**Route:** `/done` · **API:** `POST /api/auth/logout` (3.6) · **Plan:** 2F.3

```
┌────────────────────────────────────────────┐
│ [logo]                                     │
│                                            │
│   Your exam is submitted                   │
│   Beauty Product Knowledge                 │
│                                            │
│   {reason line}                            │
│   You can close this window.               │
└────────────────────────────────────────────┘
```

- The reason line is read from the state body (`attempt.submit_reason`) **before** logout runs, and held in memory, because logout ends the session and the state call would then fail.
- On arrival the app exits fullscreen, stops the camera and microphone, disconnects LiveKit, stops autosave, and calls logout. These happen once, after the submit succeeded. A reload of this page lands on login (3.6), which is fine.
- The page shows **no marks, no result and no count of anything**.

| `submit_reason` | Reason line |
|---|---|
| `manual` | Thank you. Your answers were received. |
| `auto` | Time ran out, so your exam was submitted automatically. Answers that reached the server before then were kept. |
| `forced` | The exam team ended the exam. Answers saved before then were submitted. |

- Title **Your exam is submitted**. Closing line **You can close this window.** No Back link and no button to restart.
- If logout fails, nothing is shown. The session expires on its own.

---

## 10. Error and ending screens

### 10.1 General error screen (frame as the login page)

Title, one or two lines of what happened and what to do, **Sign out** (secondary), and **Try again** (primary) where retrying makes sense. Used for: exam closed, no questions, `/me` or paper failures that do not recover.

### 10.2 Signed out (`401 session_revoked`, from any call)

The client stops the exam at once: stops autosave retries that need the session, leaves the camera, and shows:

- Title: **You were signed out**
- Body: **This account was opened on another device, or the exam team ended your session. Your saved answers are safe. Sign in again to continue, or ask the exam team for help.**
- Button: **Sign in** (primary, goes to `/login`)

Local answers in IndexedDB are kept. When the same candidate signs in again, the revision recovery rule in 2E.2 sends them.

### 10.3 `401 unauthenticated` (cookie expired or missing)

Same screen as 10.2 with the title **Please sign in again** and the body **Your session has ended. Your saved answers are safe.**

### 10.4 Unexpected error (`500`)

Banner (Warning): **Something went wrong on our side. Your answers are saved on this device. Trying again…** The client retries. After 30 s of failure it adds: "Tell the exam team if this stays."

---

## 11. Language

- **Interface: English only (decided).** Every label, button, message and heading on these screens is the English text in this file. There is no language switch and no Sinhala interface strings.
- **Content: Sinhala, English, mixed Sinhala and English, or Singlish.** This covers question text, option text, the exam title, the instructions and admin announcements (what the examiner wrote), and the candidate's own answers.
  - The client sets `lang="si"` on any text block that contains a Sinhala character (U+0D80–U+0DFF), which applies the Sinhala size and line height (Section 2A §1.2). Mixed Sinhala and English blocks get the Sinhala sizing.
  - **Singlish is just Latin letters**, so it is treated as English. It needs no detection and no special font.
  - The answer box does not fix a language. It checks its own text on every `input` event and sets `lang="si"` when a Sinhala character is present, `lang="en"` otherwise. It keeps `spellcheck="false"` and autocorrect off, so a Singlish word is never changed or underlined.
  - Sinhala is typed with the tablet's own Sinhala keyboard, and the text is stored and graded as Unicode. Test it on a real tablet (rehearsal 8.27).
- Keep the same word for the same thing: "Submit exam" (button) leads to "Your exam is submitted" (title). "Next question" is always "Next question".
- Names, MER codes, outlet names and the exam title are shown exactly as stored.

---

## 12. Decisions (all settled)

| # | Decision | Result |
|---|---|---|
| 1 | Rule-break wording | No penalties. The candidate is warned, and the admins see each candidate's log and act in the office. Text in §4 row 6 |
| 2 | Tab or focus loss | Warning toast for the candidate, and the event goes to the admin log (§8.7) |
| 3 | Browsers | Chrome only. All the Android tablets have Chrome, so non-Chrome browsers are blocked |
| 4 | Marks | The admin sets marks per question. The field is optional and defaults to 1. Candidates see the marks beside the number |
| 5 | Interface language | English only. Question and answer text can be Sinhala, English, mixed, or Singlish |
| 6 | Reload | `RELOAD` and `FULLSCREEN_EXIT` both count, and the default flag threshold is 10 |
| 7 | Mic test | No level test. The mic only has to be allowed and live |

---

## 13. Edits to make in `implementation-plan.md`

| # | Where | Edit |
|---|---|---|
| 1 | 2A.1 | Login spec §2: show/hide ID, error texts, picker §2.1 |
| 2 | 2A.5 | Confirm spec §3: `sessionStorage` flag, "No, it isn't" logs out |
| 3 | 2B.6 | Rules content blocks §4, one checkbox, send both flags, redirect if flag missing |
| 4 | 5B.1–5B.10 | Replace the flat list with the ordered steps in §5 (browser, camera and mic, fullscreen, then automatic checks). Chrome and desktop-site block, second screen warns |
| 5 | 2B.3 | Countdown rules, no-scheduled-time text, "starting" state, time-change notice (§6) |
| 6 | 2D.1 | Frame §7.1: strip contents, preview, banner area, bottom bar |
| 7 | 2D.7 | Next flow §7.3 including every result mapping and the reconnecting state |
| 8 | 2D.8 | Free mode §7.4–7.5: sidebar words, drawer under 900 px, summary screen |
| 9 | 2F.2 | Dialog copy §7.6 and the locked/time-up flow §8.6 |
| 10 | 2F.3 | Done page §9: reason lines, stop camera, exit fullscreen, logout |
| 11 | 4B.4 | Banner texts for camera, mic and both (§8.4) |
| 12 | New task | `app/(candidate)/layout.tsx` route guard from §1.1, including the reload exception |
| 13 | New task | Signed-out and error screens §10 |
| 14 | New task | The Sinhala `lang` detector for content (§11). No Sinhala string file: the interface is English only |
| 15 | 2F.6 | The plan still says `last_question` returns `submit_now: true`. The contract returns `{ result: "last_question", position }`, and the client shows Submit exam. Change the plan row |
| 16 | 2A.3 | Already says about 200 per IP. The contract line was changed to match |
| 17 | 2B.3 | Add the 0:00 gap rule from §6 (poll every 3 s, "The exam is starting…") |
| 18 | 2A and 2F | Route guard row for `acknowledged` with `closed` (§1.1): show the ended screen, no submit |
| 19 | 5B.4 | Remove the mic level indicator. The mic only has to be allowed and live (decision 7) |
| 20 | 3C.2, 3C.5, 1D.2, 8.60 and the Section 4 table | Default flag threshold is 10, amber at 5 (decision 6). Also run `alter table exams alter column flag_threshold set default 10;` on the database you already migrated |
| 21 | 3A (new task) | Candidate warning toast (§8.7, Section 4 §3.7): fires when a `TAB_HIDDEN` or `FOCUS_LOST` incident closes during the exam |
| 22 | 1E.2 and 1E.6 | Question form: marks is optional and defaults to 1 (contract 4.3) |
| 23 | 2F.5, 8.44 | The worker submits attempts after their own grace deadline with `p_reason: 'auto'`, not `'forced'`. `forced` stays for End exam and Submit for this candidate. Test 8.44 (force-end) keeps `forced` |
| 24 | 2F.2, 2B.6 | Time-up copy (§8.6 step 5), the Time paragraph on the rules screen (§4 row 7) and the Offline save-indicator words (§7.7) |
| 25 | 2D.1 | Camera preview: bottom padding on the scrolling area (§7.1) |
| 26 | 1E.2 | Add optional question-image upload/select, alt text, preview/replace/remove, and the candidate rendering/loading behavior in §7.2 |

---

## 14. Tests for the candidate screens (IDs continue after Section 2A)

| ID | Test | What to check |
|---|---|---|
| 8.104 | Login errors | Unknown MER, wrong ID and inactive candidate show the identical message |
| 8.105 | Rate limit | Sixth wrong try shows the wait message and disables the button |
| 8.106 | Picker | A candidate with two open exams sees the picker and none is preselected |
| 8.107 | Rules flag | Opening `/rules` directly with no confirm flag redirects to `/confirm` |
| 8.108 | Retention number | The rules page shows the number from the API (change the setting, number changes) |
| 8.109 | Check order | Camera prompt appears before fullscreen; denied camera shows its message; Continue stays disabled |
| 8.110 | Desktop site | An Android tablet in Desktop site mode is blocked at step 5 |
| 8.111 | Second screen | Laptop with two screens shows the warning and can still continue |
| 8.112 | Reload on exam | Refresh in the exam shows the fullscreen overlay, then the exam resumes with the same question and answers |
| 8.113 | Sequential Next | Blank answer shows the dialog; offline Next shows Reconnecting and does not advance; lost reply (`already_advanced`) shows the right question |
| 8.114 | Last question | Next becomes Submit exam; typed answer is saved before submit |
| 8.115 | Free mode | Drawer opens on a 768 px portrait tablet; flagged and unanswered show in words; summary lists both |
| 8.116 | Time up | Deadline locks everything, shows "Sending…", reaches Done; offline at deadline keeps retrying and ends on Done when the worker submits |
| 8.117 | Kick | Admin kicks a candidate: signed-out screen within 10 s, saved answers still there after signing in again |
| 8.118 | Done | No marks shown, camera light turns off, fullscreen exits, reload goes to login |
| 8.119 | Sinhala, mixed and Singlish | A Sinhala, a mixed Sinhala and English, and a Singlish question and answer render correctly on the exam screen, strip and dialogs. Typing Sinhala on the tablet works and is saved as typed. The Singlish answer has no spellcheck underline |
| 8.120 | Keyboard only | The whole flow login to done works with the keyboard, focus lands on the heading after every move |
| 8.121 | 200% zoom | Rules, check and exam screens at 200% keep every button reachable |
| 8.122 | Waiting room at 0:00 | Start the exam so the worker lags 20 s: the page shows "The exam is starting…", never a negative time, and enters the exam when the phase flips |
| 8.123 | Closed before start | A candidate who acknowledged but never loaded the paper, with the exam ended, sees "This exam has ended." and no submit call is made |
| 8.124 | LiveKit-only fault | Stop LiveKit during the exam: the banner says "Your exam continues…", has no "recorded" wording, the preview stays on, and nothing counts (matches 8.58) |
| 8.125 | Late autosave | In sequential mode a save for the previous question returns `wrong_position`: no message, no retry, no stuck "Saving…" state |
| 8.126 | Tab-switch toast | Switching tabs for 3 s during the exam: the toast shows on return, the admin timeline has the event. A 0.5 s blur shows nothing. In the waiting room, no toast |
| 8.127 | Marks | A question with the marks field left empty shows "1 mark"; one with 2.5 shows "2.5 marks" |
| 8.128 | Reload counting | Reload in the exam: `RELOAD` and `FULLSCREEN_EXIT` are both logged and counted (2 points), and the tile stays below the red line at the default threshold of 10 |
| 8.129 | Check while live | Sign in again during a live exam: the check page shows the running timer |
| 8.130 | Picker memory | After a second login via the picker, the ID is in no storage and no URL |
| 8.131 | Worker submit reason | Let the deadline pass with the candidate offline: the worker submits with reason `auto`, and the Done page says "Time ran out…" (not "The exam team ended the exam") |
| 8.132 | Late answers | Go offline, type, let time run out, come back after 30 s: the lines typed after the grace period are not saved, and no screen claimed they would be |
| 8.133 | Preview and long answers | A 20-line answer on a 768 px portrait tablet with the keyboard closed can be scrolled so the last line is clear of the camera preview |
| 8.134 | Optional question images | MCQ and written images render between text and answers; no-image questions remain unchanged; failed loads show Retry without blocking the exam |
| 8.135 | Admin force-end flush | Type an incomplete written answer, then force-end: the screen locks, the pending answer is accepted inside 15 seconds, submitted as `forced`, and later appears for Gemini grading |
