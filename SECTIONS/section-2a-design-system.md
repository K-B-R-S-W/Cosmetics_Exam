# Section 2A — Design system

Covers the look of the whole platform: tokens, type, layout rules, the component list with states, and accessibility rules. Screen-by-screen specs come in Section 2B (candidate flow) and 2C (admin).

**Status.** Contrast ratios were computed. Nothing is rendered yet, and the Sinhala font settings need a test with real examiner questions and staff answers. Items marked *(verify)* depend on third-party behaviour.

**Decisions this section rests on**
- The exam is **clean and neutral, with no brand colours**. The Cosmetics.lk logo is used in one colour only.
- Candidate screens are almost entirely black, white and grey. Colour appears only where it carries a warning.
- **The interface is English only.** Questions and answers can be written in Sinhala, English, mixed Sinhala and English, or Singlish (Sinhala in English letters), and all of them must read well at the same screen size.

---

## 0. Conflicts found with the plan

1. **2D.4 Save indicator says "green/yellow/orange states".** That contradicts the neutral rule and makes save state depend on colour. New rule: save state is shown in words and an icon (§4.5). Colour is only a secondary cue, and only for the offline state.
2. **3C.2 badges are red and amber by threshold.** This is fine because it is the admin side, but the badge must also show the number and a word or icon, not colour alone (§4.10 and §4.11).
3. **4B.4 camera banner and 3A.10 fullscreen overlay need a style.** Both are warnings the candidate must act on. They use the Warning signal at low weight (§4.6 and §4.8), not red, so candidates don't panic over a server-side fault.
4. **The logo file is 201×187 px.** That is fine up to about 90 px high on a high-density screen, but it will blur if enlarged. An SVG would be better (§2).

5. **Review fixes (round 2).** The Offline save-indicator words now say that answers must be reconnected to be saved (§4.5). The fullscreen overlay leaves the exam strip uncovered so the timer stays visible (§4.8). The toast wording and test numbering now match 2C and the plan (§4.14, §7.4). The editor spec says no images and how font size is built (§4.15).

---

## 1. Tokens

Use tokens in code, never raw hex. Put them in one file, `styles/tokens.css`, and reference them from Tailwind (or CSS) so a change happens in one place.

### 1.1 Colour

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--paper` | `#F7F7F8` | Page background | — |
| `--surface` | `#FFFFFF` | Question, answer, panels | — |
| `--ink` | `#1F2430` | Text, primary buttons, focus ring | 14.5:1 on paper, 15.5:1 on surface |
| `--muted` | `#5A5F6E` | Secondary text, labels | 6.0:1 on paper |
| `--line` | `#7A7F8C` | Borders of inputs, options, buttons | 4.0:1 on surface (3:1 needed) |
| `--hairline` | `#D9DBE0` | Dividers only, never the only boundary of a control | decorative |
| `--selected` | `#EAEBEE` | Selected option background | ink on it 13.0:1 |
| `--ok` | `#2F6B4F` | OK text and icon | 6.3:1 on surface |
| `--ok-tint` | `#EEF4F0` | Optional background behind OK text | 5.6:1 |
| `--warn` | `#8A5200` | Warning text and icon | 6.4:1 on surface |
| `--warn-tint` | `#F7F0E3` | Optional background behind warnings | 5.6:1 |
| `--alert` | `#A8231B` | Alert text and icon | 7.2:1 on surface |
| `--alert-tint` | `#F8EAE8` | Optional background behind alerts | 6.1:1 |

Rules:
- Signal colours are for **text, icons and small dots**. Never fill a large area with them, and never fill a whole tile.
- **Colour is never the only carrier of meaning.** Every status has a word and an icon.
- Disabled controls use `--muted` text on `--hairline` background and `cursor: not-allowed`, with a text reason nearby when it is not obvious. Disabled text is exempt from the contrast rule, so never put required information in it.

### 1.2 Type

One font stack for everything:

```
--font: "Atkinson Hyperlegible", "Noto Sans Sinhala", system-ui, sans-serif;
```

Atkinson covers English and digits. Noto Sans Sinhala covers Sinhala. Load both with `next/font` (self-hosted at build time, no runtime call to Google), with the Sinhala subset *(verify both families and the subset on Google Fonts)*. Print pages keep Noto Sans Sinhala as the plan says (7.3).

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| `--text-xs` | 12 / 16 | 400 | Table meta, timestamps (admin only) |
| `--text-sm` | 14 / 20 | 400 | Admin tables, helper text |
| `--text-md` | 16 / 24 | 400 | Body, form labels, buttons |
| `--text-answer` | 18 / 28 | 400 | Candidate's typed answer, MCQ option text |
| `--text-question` | 20 / 30 | 500 | Question text |
| `--text-title` | 28 / 36 | 600 | Screen titles |
| `--text-timer` | 32 / 36 | 600 | Timer only |

**Sinhala runs.** Sinhala looks smaller at the same size, and its marks need more vertical room. Wrap Sinhala text in `lang="si"` (the editor and the answer box should set this when the content is Sinhala) and apply:

```
:lang(si) { font-size: 1.08em; line-height: 1.7; }
```

The values 1.08 and 1.7 are starting points. Judge them on real examiner questions and staff answers in the rehearsal, and adjust the two numbers in one place.

Other type rules:
- Left-aligned everywhere. No justified text.
- Line length: at most 68 characters for questions and answers (`max-width: 68ch`).
- Numbers that change (timer, counts, marks) use `font-variant-numeric: tabular-nums` so they don't jiggle *(verify Atkinson supports it; if not, the timer uses a fixed-width box)*.
- Sentence case for every label, button and heading. No all-caps labels.
- Never disable zoom. Text is in `rem`, and layouts must survive 200% zoom.

### 1.3 Spacing, shape, elevation, motion

| Token | Value |
|---|---|
| `--space-1 … 8` | 4, 8, 12, 16, 24, 32, 48, 64 px |
| `--radius-control` | 8px (buttons, inputs, options) |
| `--radius-panel` | 0 (panels are flat and separated by space) |
| `--border` | 1px `--line` for controls, 2px `--ink` for selected |
| Shadow | none, except one for dialogs and the fullscreen overlay: `0 8px 24px rgb(31 36 48 / 0.16)` |
| `--touch` | 44px minimum height and width for anything tappable |
| Motion | 150 ms ease-out, only for: save-state change (fade), dialog open, option select. No page or scroll animation. `prefers-reduced-motion` turns all of it off |

### 1.4 Breakpoints

| Name | Width | Notes |
|---|---|---|
| Tablet portrait | 768 px | Smallest supported candidate width (2D.9) |
| Candidate drawer switch | 900 px | Below this width the exam screen hides the title in the strip and the question list becomes a drawer (Section 2B §7.1 and §7.4) |
| Tablet landscape / small laptop | 1024 px | |
| Laptop | 1280 px and above | Admin live grid is designed for this |

Candidate screens are built for 768–1920 px in both orientations. Phones are not supported for candidates (plan 2D.9). Admin screens are built for 1280 px and up. Below that they scroll and nothing breaks, but there is no layout work.

---

## 2. The logo

- **Files:** `assets/logo-ink.png` (`#1F2430`) and `assets/logo-muted.png` (`#5A5F6E`), made from your PNG with the transparency kept. Neither uses the bronze colours. If you can supply an SVG, replace the PNGs. Then the logo stays sharp at any size, and the tokens can colour it.
- **Where:** top-left of login, confirm, rules, check, waiting room, done, and the admin header. **Not on the exam screen** (nothing competes with the question).
- **Size:** 40 px high on candidate pages, 28 px in the admin header. Minimum 24 px. Clear space on all sides at least a quarter of the logo height.
- **Alt text:** "Cosmetics.lk". On the exam strip, if you later decide to show it, use `alt=""` (decorative).
- Never recolour to the bronze, never place on a photo or the video tiles.

---

## 3. Layout rules

- **Candidate pages:** a single centred column, `max-width: 68ch` for reading content and 28rem for forms. Page padding 24 px on tablet, 32 px on laptop.
- **Exam page:** `100dvh` layout (plan 2D.1): a fixed top strip, a scrolling middle, a fixed bottom bar so the on-screen keyboard never hides Next or Submit. `overscroll-behavior: none`.
- **Admin pages:** a 56 px top bar with the logo, page name and the signed-in admin. A left nav of 200 px. Content fills the rest. Tables are flat with hairline row dividers. No cards.
- **Dialogs:** at most one dialog at a time, centred, `max-width: 28rem`, dimmed page behind.

---

## 4. Components

For every component: **variants, states, accessibility**. All components are keyboard-operable and use the focus ring in §5.

### 4.1 Button

| Variant | Look | Use |
|---|---|---|
| Primary | Solid `--ink`, white text | The one main action per screen: "Start exam", "Submit exam", "Save" |
| Secondary | White, 1px `--line`, ink text | "Previous", "Cancel", "Back" |
| Quiet | No border, underlined on focus and hover | "Clear" and low-risk links |
| Destructive | White, 1px `--alert`, `--alert` text. On confirm dialogs the confirm button is solid ink with the verb ("Force end exam"), not red | "Remove", "Force end" (with confirmation) |

States: default, hover (primary gets `#2C3342`; others get `--selected`), pressed, focus (ring), disabled, **loading** (label stays, spinner replaces the icon, button disabled, `aria-busy="true"`). Height 44 px, horizontal padding 20 px, 16 px text. Only one primary button per screen.

Accessibility: native `<button>`. A loading button keeps its accessible name. The double-tap rule from 2D.7 applies: disable on click until the server answers.

### 4.2 Text field and textarea

Label above (always visible, never placeholder-only), optional helper text below in `--muted`, error text below in `--alert` with an icon and the words "Error:" for screen readers.

States: default, hover (border `--ink`), focus (ring), filled, error (border `--alert`, 2px, plus the message), disabled, read-only.

Answer textarea (2D.6): `lang` set per content, `spellcheck="false"`, `autocomplete="off"`, `autocorrect="off"`, `autocapitalize="off"`, `font-size: var(--text-answer)`, min-height 12 lines, `resize: vertical`, no character counter unless the exam sets a limit. Use `input` events (plan 2D.6).

### 4.3 MCQ option

A full-width row, 56 px minimum height, a circle (radio) at the left, the option letter by position ("A", "B", "C": the paper has no stored labels), then the text.

| State | Look |
|---|---|
| Default | White, 1px `--line` border |
| Hover | Border `--ink` |
| Selected | 2px `--ink` border, `--selected` background, filled radio **and** a check icon |
| Focus | Ring |
| Disabled (after submit or closed) | `--hairline` border, `--muted` text, selected state still visible |

Accessibility: a real `<fieldset>` with the question as its `<legend>`, native radio inputs, the whole row is the label (44 px target), arrow keys move the selection (native radio behaviour).

### 4.4 Timer

Shows `H:MM:SS` over an hour, `MM:SS` under it, with the unit words visually hidden for screen readers ("48 minutes 12 seconds left").

| State | When | Look |
|---|---|---|
| Normal | More than 10 min | `--ink` |
| Low | 10 min or less | `--warn` text + a small clock icon, label "10 minutes left" appears once beside it |
| Critical | 1 min or less | `--alert` text + icon, label "Last minute" |
| Ended | 0 | Text "Time is up". The Notice under the strip says what is happening (Section 2B §8.6) |

No flashing, no animation, no sound. The element has `role="timer"` and `aria-live="off"`. A separate visually hidden polite live region announces the time left at 30, 10, 5 and 1 minute only. A time extension (broadcast from the admin) updates the number and shows the Notice banner "Your time was extended by N minutes".

### 4.5 Save indicator (replaces 2D.4's colour states)

A single line in the exam strip: icon + words. Always shown.

| State | Words | Icon | Colour |
|---|---|---|---|
| Saved | "Saved 14:02" (clock time of the last saved answer) | Check | `--muted` |
| Saving | "Saving…" | Small spinner (static dot if reduced motion) | `--muted` |
| Waiting | "Waiting to save" (typing, debounce pending) | Dot | `--muted` |
| Offline | "Offline. Answers are kept on this device. Reconnect to save them." | Warning triangle | `--warn` |
| Retrying | "Reconnecting…" | Spinner | `--warn` |

Only Offline and Retrying use colour, and they also change the words and the icon. The indicator uses `role="status"` with `aria-live="polite"`. It announces only changes into Offline, Retrying, and back to Saved, never every save.

### 4.6 Banner

An inline strip under the exam strip, full width, `--surface` with a 4px left rule in the signal colour, an icon, one or two sentences, and an optional action button.

| Variant | Use | Colour |
|---|---|---|
| Notice | Time extended, admin broadcast | `--ink` rule, info icon |
| Warning | Camera disconnected (4B.4), connection lost | `--warn` |
| Blocking | Fullscreen overlay (see 4.8) | `--ink` |

A banner never covers the question. A new broadcast banner stays until dismissed (there is a Dismiss button, 44 px). Warning banners cannot be dismissed while the condition lasts. Accessibility: `role="status"` for Notice and `role="alert"` for Warning, announced once.

### 4.7 Dialog

A centred panel with a title, one or two sentences, and two buttons. Buttons are named for the action ("Submit exam" / "Keep working"), never "OK". Candidate dialogs never use "Cancel". Admin dialogs may use "Cancel" as the secondary button when it only closes the form and changes nothing. Escape and the secondary button close it, except for blocking dialogs. Focus moves to the dialog on open and returns to the trigger on close, with focus trapped inside while it is open.

### 4.8 Fullscreen overlay (3A.10)

Covers the page. On the exam screen it covers everything **below the top strip**, so the timer stays visible; elsewhere it covers the whole page. White, centred, a title ("Fullscreen is required"), one sentence ("Press the button to go back to the exam. Your time keeps running."), and one primary button "Return to fullscreen". It cannot be dismissed any other way. The timer is not covered (see above). Focus is placed on the button. This is the one place a focus trap is intended (WCAG-compatible, because the way out is the single button).

### 4.9 Question list (2D.8, free mode)

A left sidebar, 240 px on laptop and a drawer opened from a button in the exam strip on tablet portrait (under 900 px, Section 2B §7.4). Each row is a button, 44 px high: question number, and a status in **words and icon**: "Answered" (check), "Not answered" (empty circle), "Flagged" (flag icon, plus the word). The current question has a 2px ink left rule and `aria-current="step"`. Flag toggle is a button on the question: "Flag for review" / "Remove flag" with `aria-pressed`.

### 4.10 Status badge (admin)

A dot (10 px) or icon, then the word, in 14 px. The status word is always there.

| Status | Icon | Colour |
|---|---|---|
| Not joined | Empty circle | `--muted` |
| Ready | Check circle | `--ok` |
| In exam | Dot | `--ink` |
| Offline | Slash circle | `--alert` |
| Camera off | Camera-off icon | `--warn` |
| Submitted | Check | `--muted` |

### 4.11 Violation badge (3C.2)

Shows the number and a word, for example "3 violations". At or above `ceil(flag_threshold / 2)` (5 of 10 by default), an amber warning icon is added. One counted event reads "1 violation". At the flag threshold, an alert icon and the text turns `--alert`. The thresholds are the plan's (3C.2). The badge has a tooltip-free accessible name: "3 violations, flagged".

### 4.12 Video tile (4C.2)

A 4:3 video, with below it: the MER code (bold), name, status badge, violation badge, progress ("Q 7/20" or "14 answered"), and a speaker toggle (`aria-pressed`, 44 px). No coloured border on the tile. A flagged candidate is marked by the violation badge and a "Flagged" word only. Missing video shows a neutral placeholder with the words "No camera". Tiles are focusable, and Enter opens the candidate details.

### 4.13 Data table (admin)

14 px text, 40 px rows, hairline row dividers, sticky header, sortable column headers as buttons with `aria-sort`. Numeric columns right-aligned with tabular digits. An empty table says what is missing and how to add it (see the empty-state copy in Section 2C §11).

### 4.14 Toast (admin)

Bottom-right, one line, a 6-second timeout except alerts, which stay until dismissed. `role="status"`. Used for the "reached the flag threshold" message (3C.2) and for save confirmations. Never used for anything a candidate must read, **except the one candidate warning in §4.14a**.

### 4.14a Candidate warning toast

Shown to a candidate when a tab switch or focus loss was recorded (Section 2B §8.7, Section 4 §3.7). It is a short-lived notice, so it uses the Warning banner look (§4.6: 4px `--warn` rule, icon, 44 px Dismiss button) and sits in the banner area under the exam strip. It never covers the question or the answer box. It hides by itself after 10 seconds, can be dismissed earlier, and uses `role="alert"` so it is announced once. It never uses the word "violation" and never mentions a penalty.

### 4.15 Rich-text editor (Tiptap, 1E.2)

Admin only. The toolbar buttons are 44 px with labels in `aria-label` and `title`. The content area uses the question type scale. The allowed tags are the contract's allowlist (Section 3), and the toolbar must not offer tags outside it. **No images** (the allowlist has no `<img>`; decided). Tiptap has no built-in font size: use the `TextStyle` extension with a small custom `fontSize` extension that writes `<span style="font-size: …px">`, which is the only style the sanitizer keeps.

### 4.16 Empty, loading and error states

| State | Rule |
|---|---|
| Loading (under 400 ms) | Show nothing, then the content |
| Loading (longer) | A one-line skeleton in `--hairline`, no shimmer, with `aria-busy` |
| Empty | What this is, why it's empty, the one next step |
| Error | What happened, what to do, and a Retry button. Never a raw error code on a candidate screen |

### 4.17 Tabs (admin)

A row of text buttons under the page title, `role="tablist"`. The selected tab has a 2 px `--ink` underline, `aria-selected="true"` and a check-free, word-only label; a count goes in the label as words ("Needs review (3)"). 44 px high. Left and right arrow keys move between tabs and Enter or Space selects. The panel below is `role="tabpanel"` and labelled by its tab. No animation.

### 4.18 Side panel (admin)

A 440 px panel on the right edge over the page content, `--surface`, a 1 px `--line` left border, no shadow. A header with the title and a **Close** button (44 px). On open, focus moves to the title. **Escape** and **Close** close it and return focus to the control that opened it. It is `role="complementary"` with an `aria-label` and does **not** trap focus, because the page behind it stays usable (the live grid keeps updating). It never pushes the page layout around.

### 4.19 Filter chips (admin)

A row of toggle buttons, single choice, each with a word label and a count in words ("Flagged 2"). 44 px high. The selected chip has the 2 px `--ink` border, the `--selected` background and a check icon (the same recipe as §4.3, so it works without colour). Wrapped as a group with an `aria-label` and `aria-pressed` on each button. An empty result shows the page's empty message (Section 2C §11.1).

### 4.20 Step indicator (admin)

An ordered list: "1 Choose file", "2 Check", "3 Import". The current step has `aria-current="step"` and is bold with the 2 px ink rule. Finished steps show a check icon and the word "Done". Steps are not buttons, since the page moves forward with its own buttons.

---

## 5. Accessibility rules (WCAG 2.1 AA)

- **Contrast:** text 4.5:1, large text and controls 3:1. Every token pair above passes (see §1.1).
- **Focus:** a visible ring on every focusable element: `outline: 3px solid var(--ink); outline-offset: 2px`, with a white inner gap. The ring is never removed. On dark fills (primary button), the same ring is used with a white gap.
- **Touch targets:** at least 44×44 px, including the question-list rows, option rows, and the speaker toggle.
- **Keyboard:** everything works with Tab, Enter, Space, Escape and arrow keys. No hover-only controls (plan 2D.9). Tab order follows the visual order.
- **Landmarks and headings:** one `<h1>` per screen, `<main>`, `<nav>` for the question list and admin nav, `<header>` for the strip.
- **Forms:** every input has a visible label. Errors name the field and say how to fix it, and focus moves to the first error on submit.
- **Time:** the exam time limit is part of the exam. The timer's announcements follow §4.4, and the admin extension tool is the accessibility accommodation for individual candidates. The rules screen should say this.
- **Motion and flashing:** nothing flashes. Reduced-motion removes all transitions.
- **Zoom and text size:** the layouts survive 200% zoom, and text resizing to 200% without loss.
- **Language:** `<html lang="en">` by default, `lang="si"` on Sinhala content so screen readers choose the right voice.

**Limits.** Contrast and structure are specified here, but I haven't run an automated scan or tested with a screen reader. Do that on the built screens, not on this document. The proctoring features (camera, fullscreen lock) are an exception to normal freedom of movement and are explained to candidates on the rules screen.

---

## 6. Voice and copy rules (full copy comes with each screen)

- Sentence case. Plain verbs. No exclamation marks, no jokes: it is an exam.
- A button says what happens: "Start exam", "Submit exam", "Next question". The same action keeps the same name everywhere (the button "Submit exam" leads to the title "Your exam is submitted").
- Errors say what happened and what to do. They never blame the candidate and never apologise.
- Never use the word "violation" on candidate screens. Say "rule" or describe the event ("You left fullscreen"). Admin screens may say "violation".
- Warnings that are a server fault (camera platform down) say "Your exam continues" first.
- The interface text is English only, so there are no Sinhala strings to write or translate. Sinhala appears only inside questions, answers, option text, the exam instructions, the exam title and admin broadcasts. Those use the Sinhala sizing in §1.2.

---

## 7. Implementation notes

### 7.1 File layout
```
apps/web/
  styles/tokens.css          all tokens in §1 as CSS variables
  styles/globals.css         base styles, :lang(si), focus ring, reduced motion
  styles/tablet.css          2D.9 rules
  components/ui/             Button, Field, Textarea, Banner, Dialog, Toast, Table, StatusBadge, Tabs, SidePanel, FilterChips, Steps
  components/exam/           QuestionCard, Timer, SaveIndicator, NextButton, QuestionList, FullscreenOverlay, CameraBanner
  components/admin/          VideoTile, CandidateBadge, ViolationTimeline
  public/brand/              logo-ink.png, logo-muted.png (or the SVG)
```

### 7.2 Tooling
Tailwind (as the plan assumes) with the tokens mapped in `tailwind.config`, so classes like `text-ink` and `bg-surface` exist and raw hex cannot slip in. A lint step (a simple grep in CI) fails the build if a hex colour appears outside `tokens.css`.

### 7.3 Edits to make in `implementation-plan.md`

| # | Where | Edit |
|---|---|---|
| 1 | 2D.4 | Replace "green/yellow/orange states" with the five states and words in Section 2A §4.5 |
| 2 | 2D.3 | Timer states and live-region rules from §4.4 |
| 3 | 2D.2 | MCQ option spec from §4.3 (letters by position, row is the label, 56 px) |
| 4 | 3A.10 | Overlay spec from §4.8 |
| 5 | 4B.4 | Banner spec from §4.6, Warning variant |
| 6 | 3C.2 and 4C.2 | Badge and tile rules from §4.10–4.12: word + icon, no tile fills |
| 7 | 0.x | New task: `styles/tokens.css`, `globals.css`, font loading, Tailwind mapping, hex lint |
| 8 | 0.x | New task: add the logo files to `public/brand/` |
| 9 | 1E.2 | Toolbar and allowlist rule from §4.15 |
| 10 | 2D.9 | Reference §1.4 breakpoints and the 44 px rule |

### 7.4 New tests (continue after the last number in Phase 8, which is 8.96 at the time of writing; numbers to be confirmed when merged)

| Test | What to check |
|---|---|
| Contrast scan | Automated contrast check on every built screen: no failures at AA |
| Keyboard only | Every candidate screen completed with the keyboard alone, including the fullscreen overlay |
| Zoom 200% | The exam screen at 200% zoom keeps the timer, save state and Next button reachable |
| Sinhala rendering | Real Sinhala question and answer render with correct line height, no clipped marks, in the editor, exam screen, review page and PDF |
| Colour-blind check | Every status is understandable in greyscale |
| Reduced motion | No transitions with the OS setting on |
| Tablet touch | All targets 44 px or more on a 768 px tablet in both orientations |
