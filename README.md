# Proof of Progress (Cernen&trade;)

A tool for a municipal engineering office (MEO). Each month a contractor claims percent complete per line item (the progress claim; in the demo, a fictional statement of work accomplished). The office checks each line against milestone photos, enters the project's percent complete once, and gets drafts of the four reports it owes (COA, DILG SubayBAYAN, IAS, MPDO) from that single entry. It logs when each report was actually submitted, flags late ones, and gives the office head a Monday view and the mayor a screen of escalated items only.

The product name and brand come from one file, `src/brand.js` (`PRODUCT_NAME`, `BRAND`). Rename there and every page, report draft and API response follows.

One Node.js service (Express) serves the API and a plain HTML/CSS/JS front end. It runs locally with no Google account, and deploys to Cloud Run with Firestore, Cloud Storage, Secret Manager and Gemini on Vertex AI (called with the service's own identity, so there is no API key).

## Try it in five minutes

**Live app:** https://proof-of-progress-508715223415.asia-southeast1.run.app. Pick a role on the sign-in page; no password. Everything in it is public footage or labelled fictional. The demo date is fixed to 1 June 2026 so the fictional progress claims line up with their photos. Each visitor works on a private copy of the demo, so you can change anything. Access to a copy ends 24 hours after it is created; it is then deleted (see "Deploy to Cloud Run").

**Saved and live Gemini runs.** The supplied demo inputs open on **saved Gemini runs** (model and date shown): project P-001 from June 2025 to April 2026, and project P-003 for May 2026. Anything new needs a **live** run, for example May 2026 for P-001 after you upload a photo. Saved drafts from **Draft with Gemini** exist only for the seeded April 2026 decisions; if you change a decision, the note needs a live draft. Judges and organisers can turn on live Gemini runs and drafts with the access code given in the submission form (sign-in page, "Judges and organisers"). Live use has a daily limit.

1. **Engineer in charge (Ana).** Open "Multi-purpose building (demo)", pick **April 2026** and press **Run the check**. Each claimed line comes back supported, contradicted, can't tell, or "readers disagree", with a box on the photo. One click on a line confirms or overrules the AI; the log keeps both. Under the photo, **Compare like with like** shows another month in the same spot. The demo's monthly frames were prepared from one fixed camera and aligned to one view; uploaded photos are not aligned (the comparability check is an edge correlation, not image registration).
2. **The flipped photo.** Switch to **May 2026**, press **Try it: send last month's photo, flipped**, then **Run the check**: the reuse check flags the mirrored copy before any AI runs, and the stamp-versus-file-date check flags a mismatch (a mismatch, not proof).
3. **Percent complete once.** In step 4, enter the percent complete and press **Save and make drafts**: the COA, DILG SubayBAYAN, IAS and MPDO drafts all carry the same figure. **Draft with Gemini** writes a plain-language note from the decision log only; nothing is sent. Log when each report went out in step 5.
4. **Office head (Benita).** **Monday view**: what is slipping, the plan laid over this month's photo, and the finish date checked three standard ways. **Review lines**: overrule a verdict with a reason; it shows in **Override history**.
5. **Mayor, auditor, public.** The mayor sees only what has escalated. The auditor reads the decision and submission logs and cannot change anything. The public page is a plain progress note with no verdict labels and no staff names.

Expected results for the April 2026 claim are in the "Evaluation" section below. Keep checks to one project and one month at a time.

## Google Cloud in this app

| Service | What it does here |
|---|---|
| Gemini 3.8 Flash on Vertex AI | Two readers turn each claimed line into one question a photo can answer and return a verdict with an evidence box (structured output; the line ID is limited to the IDs sent). Also drafts the plain-language notes from the decision log. |
| Cloud Vision API (web detection) | One more check before any AI reads the photo: has this site photo already appeared online? An exact match is a flag for review, not proof. |
| Cloud Translation | The public progress note in Filipino, labelled machine translation; the English note stays the official text. |
| BigQuery | Each check line and each decision streams in as a row (counts only: no names, no reasons, no free text). The auditor screen shows a 7-day summary across all demo visitors. |
| Cloud Run | Hosts the service (Singapore). |
| Firestore | All app data; a private copy of the demo per visitor; transactions for the spending ledger, the daily copy counter, the photo limit and stale checks; TTL policies delete visitor copies. |
| Cloud Storage | Site photos in a private bucket; visitors' uploads are deleted after 2 days. |
| Secret Manager | The session secret and the judge access code. |
| Cloud Logging | Latency, tokens and estimated cost for every model call and every check. |
| IAM | One service account with only what it needs; Gemini, Vision and Translation are called with its identity, so there is no API key. |

Vision, Translation and BigQuery are switched on with `VISION=1`, `TRANSLATE=1` and `BQ_DATASET` (see `deploy/deploy.sh`; one-time setup in `deploy/setup-extra.sh`). Vision and Gemini calls need the judge access code and stay under the daily cap; Translation is open to everyone but also under the cap. Saved Vision results for the 12 demo photos are in `src/seed/saved-runs.json` (all 12: similar images online, no exact match).

## What it never does

- It never approves, holds, withholds or releases a payment, and never sends anything to a contractor or agency. Report drafts are downloads; the office submits them and logs that it did.
- A person decides every line. The AI gives a default; the engineer in charge decides each line and the office head can overrule, with a reason, every time. Unreviewed AI output never reaches the mayor or the public.
- Wording: a metadata mismatch is "a mismatch, not proof of where or when a photo was taken". "No visible change" does not mean "no work done". A reused photo is "a flag for review". Hidden work (waterproofing, interior, buried work) is always "can't tell". A repo test fails the build if accusatory words appear anywhere user-facing, and model output is passed through a filter before anyone sees it.

## Evaluation

The saved Gemini run for project P-001 was scored once against a fixed reference. Files: [`eval/R2_2026-10-17T2215.md`](eval/R2_2026-10-17T2215.md) (summary) and [`eval/R2_2026-10-17T2215.json`](eval/R2_2026-10-17T2215.json) (every line). The script is `scripts/record-runs.js`.

- Model: `gemini-3.8-flash` on Vertex AI. One run. One photo per month. The readers saw no earlier reviewer corrections.
- Reference: the 28 of 37 statement lines where two AI labellers (Claude and GPT) agree. They labelled blind, and the labels were frozen before any Gemini run. This is a provisional AI reference, not ground truth.

| | Agrees with the reference (of 28) | Overclaims caught (of 7) |
|---|---|---|
| Accept every line | 17/28 | 0/7 |
| AI default (two Gemini readers, v3) | 20/28 | 4/7 |
| Reader A alone | 22/28 | |
| Reader B alone | 18/28 | |

- The AI default never said "supported" where the reference did not (0 times).
- On reference lines, the readers disagreed 2 times (no default; the person decides) and gave no answer 3 times.
- In this run, calls for two months timed out or failed. September 2025 had no answer from either reader, so its lines count as no answer. In May 2026 only reader B failed; those lines took their default from reader A alone.
- Median model call: 41 s. Estimated spend for the run: US$0.83.
- After this run, the prompt and response schema were changed so that readers copy each line's claim_id exactly (the schema now allows only the IDs sent in that request). Live testing had shown readers inventing IDs for office-typed lines, which the format check rejected. The verdict instructions did not change, and the score above was not re-run.
- One run, so this is not a noise estimate. The team wrote the prompt, the claims and the reference labels, so this is development data.

[`eval/R2b_retry_timedout_months_2026-10-17T2216.md`](eval/R2b_retry_timedout_months_2026-10-17T2216.md) is a retry of the months that had no full answer, run only so the demo has saved answers for them. Its report includes aggregate figures because the same script wrote it, but it does not replace the headline score above, which comes from the single scored run.

**Rule checks (no AI), on the deployed code, 18 Oct 2026** ([`eval/reuse_stress_2026-10-18.json`](eval/reuse_stress_2026-10-18.json), `node scripts/reuse-stress.js`): 66 of 66 edited copies of the 11 public frames caught as reuse (recompressed, brightened, darkened, softened, shrunk, mirrored); 11 of 11 different months correctly not matched (nearest distances 8 to 22, threshold 6); 0 of 22 crops of 10% or 20% caught, a stated limit of the hash check.

**April 2026, expected results on the saved run:**

| Line | AI default |
|---|---|
| Rooftop level enclosure | contradicted |
| Main entrance canopy | can't tell |
| Street hoarding replacement | can't tell |
| Roof waterproofing | can't tell (hidden work) |

For the canopy and the hoarding, Gemini notes that street level is blurred in the public frames.

## Jobs to be done, and where each is tested

Every row is an automated test that signs in as that role and does the job in a real browser (Playwright, Chromium). Results are from the run on 18 Oct 2026 on the in-memory store (`npx playwright test`). The Firestore emulator steps were not run on this machine (no Java), so there is no Firestore result for this run.

| Role | Job | Screen and action | Test | Result |
|---|---|---|---|---|
| Engineer | Upload this month's milestone photos, keeping EXIF date and GPS, never requiring them | Engineer, step 1: choose photos, optional printed stamp, Upload. Thumbnail shows file date and GPS | E1-E3 | PASS |
| Engineer | Use the contractor's claimed percent per line | Engineer, step 2: prefilled from the contractor's submission | E1-E3 | PASS |
| Engineer | Type the claim when the contractor sent nothing, and get credit for it | Engineer, step 2: type percents, Save progress claim. A monitoring entry "Progress claim entered for the contractor" is logged | E2b | PASS |
| Engineer | Run the check and see per-line verdicts | Engineer, step 3: Run the check. Rule checks (no AI), then Reader A and Reader B per line, AI default, evidence box on the photo | E1-E3 | PASS |
| Engineer | Decide each line: confirm or overrule the AI default with one click | Engineer, step 3: the line shows the decision; the log keeps the AI default and the person's call | E8 | PASS |
| Engineer | See a reused, mirrored photo flagged before any AI runs | Engineer, May 2026: Try it: send last month's photo, flipped, then Run the check | E9 | PASS |
| Engineer | Compare like with like: another month in the same spot | Engineer, April 2026: comparison lens with a month picker under the photo | E10 | PASS |
| Engineer | Enter percent complete once; get COA, SubayBAYAN, IAS and MPDO drafts showing it | Engineer, step 4: type 70, Save and make drafts. Four cards show 70%; Text, CSV, Printable links | E4 | PASS |
| Engineer | Get a plain-language draft note from the decision log only | Engineer, step 4: Draft with Gemini shows an editable draft; nothing is sent | E11 | PASS |
| Engineer | Log when each report was actually submitted, to whom, with an optional transmittal photo | Engineer, step 5: Log submission. Table shows On time, or "Late: flagged, not counted" | E5 | PASS |
| Engineer | Log monitoring visits and work done for the contractor | Engineer, step 6: Log work | E6 | PASS |
| Engineer | Cannot reach other roles' screens; read-only on projects not in charge of, including line decisions | Visiting /mayor redirects; API returns 403; Save buttons disabled on others' projects | E7 | PASS |
| Office head | Monday: projects lagging, reports due or late this week, who is in charge | Reviewer, Monday view tab | R1 | PASS |
| Office head | See the plan laid over the latest checked photo, with the finish range and its caveat | Reviewer, Monday view | R5 | PASS |
| Office head | Confirm or overrule each verdict with a reason; see the history of overrides | Reviewer, Review lines: pick Supported, Contradicted or Can't tell, type reason, Save decision. Override history tab | R2 | PASS |
| Office head | Explain a flagged photo check (logged; the flag stays on record) | Reviewer, Review lines: Note next to the flag | R3 | PASS |
| Office head | Cannot enter percent complete or open the mayor's screen | API returns 403 | R4 | PASS |
| Mayor | One screen, only escalated items, in plain words | Mayor screen: gauge plus escalated items; office-only (yellow) items absent; no inputs | M1 | PASS |
| Mayor | An item leaves the screen when the office acts | Office logs the overdue DILG report; mayor sees one item fewer | M2 | PASS |
| Contractor | Submit the progress claim and photos through the project link; see status, never verdicts | /c/&lt;link&gt;: percents, photos, Send. "Received" status; page and API carry no verdicts; staff API returns 401 | C1 | PASS |
| Contractor | The report the MEO waits for arrives in the system | Engineer opens the period and sees the contractor's numbers | C2 | PASS |
| Auditor | Decision log and submission log with timestamps and who decided; cannot write | Auditor screen; CSV download; every write route returns 403 | A1 | PASS |
| Public | Plain progress note per project; no verdict labels, no staff names, no accusation | /public/P-001 | P1 | PASS |
| All | Brand shows as Cernen&trade;, product name from one constant | Sign-in page | P2 | PASS |

The API tests (`test/api/`) repeat the role guards at the HTTP level for every role (signed out, mayor, engineer on another engineer's project, auditor on write routes, contractor link, public), plus: reason required for every decision, override logged with reason, name and time, unreviewed AI output never escalates, percent flows to all four drafts in all three formats, late submissions flagged and not counted, future submission dates refused, and per-visitor copies kept apart.

Screenshots are in `docs/screens/`: `login.png`, `engineer.png`, `reviewer-monday.png`, `reviewer-monday-owner.png`, `reviewer-review.png`, `mayor.png`, `contractor.png`, `auditor.png`, `public.png`. They contain the modified public frames (see "Credits").

## Test results

Run on 18 Oct 2026 on the development machine, Node 24.18.0. The Firestore emulator steps were not run on this machine (no Java runtime), so `npm test` reports them as SKIPPED.

| Step | What | Result (18 Oct 2026) |
|---|---|---|
| 1 | Secret scan (8 patterns: Google API keys, service-account keys, private keys, OAuth tokens, AWS, GitHub, Slack, hard-coded session secret) | clean |
| 2 | Unit tests (`npm run test:unit`) and API tests (`npm run test:api`), in-memory store | 57 of 57 and 24 of 24 passed |
| 3 | Storage contract and API tests on the Firestore emulator | not run (no Java) |
| 4 | Browser tests, in-memory store (`npx playwright test`) | 22 of 22 passed |
| 5 | Browser tests, Firestore emulator | not run (no Java) |

Unit tests cover: deadlines (DILG before the 25th, COA 5 working days after month close, IAS and MPDO 5 working days after quarter close, year-end 15 December, weekends and Philippine holidays skipped, late flagged and not counted, earliest submission decides lateness), the rule checks on the real frames (reuse, flip, recompression, the crop limit, stamp vs file date vs period, EXIF date and GPS read from a file, location vs site, view comparability), question generation, hidden-work rule, reader agreement and disagreement, schema validation of model output, prompts, the gauge thresholds, report drafts, the schedule trajectory, the saved-answer cache and the daily spend cap, the Gemini adapter with a stubbed client, the secret scan catching a planted key, and repo-wide text rules (no em dashes, no accusatory words, brand constant, "progress claim" wording).

## Architecture

```
Browser (plain HTML/JS per role)                  Contractor (per-project link)     Public
        |  signed session cookie                        |  token in URL               |  no auth
        v                                               v                             v
  Express app (src/app.js): role guard on every /api route, request-header check on writes
        |
        +-- services/check.js      rule checks (no AI) -> readers A and B -> AI default per line
        +-- services/actions.js    uploads, claims, percent, decisions, submissions log, credit
        +-- services/snapshot.js   slippage, deadlines, gauge items per project
        +-- services/notes.js      "Draft with Gemini" from the decision log only
        +-- services/workspaces.js per-visitor copies of the demo, judge access cookie
        +-- routes/owner.js        Monday view: plan over the photo, schedule trajectory
        +-- domain/*               pure functions: deadlines, rules, lines, progress, escalation,
        |                          reports, public note, trajectory, wording
        +-- store/   memory | firestore   (same interface)
        +-- photos/  local disk | Cloud Storage
        +-- ai/      Gemini (@google/genai, structured output) behind saved answers, the access
                     code and the daily spend estimate | demo readers (deterministic)
```

The check, per period: each claimed line becomes one question a photo can answer (`domain/lines.js`; percentages are never asked as such). Rule checks run first with no AI (`domain/rules.js`): perceptual hash and mirrored hash against every earlier photo in the office (reuse and flips), printed camera stamp vs embedded file date vs reporting period, GPS vs the site boundary if both exist, and whether this period's view compares with the last one (edge correlation plus source resolution). Then two readers answer each question from a fixed list (supported, contradicted, can't tell) with an evidence box. Reader B is prompted as an independent second reader that looks for contradicting evidence first. If they disagree, there is no default and the screen says so. Hidden lines are forced to can't tell. Earlier overrides on the project are passed to the readers as guidance.

The gauge (`domain/escalation.js`): level 1 (yellow) stays with the office; level 2 (red) also shows to the mayor. Red means a report not submitted 7 or more days after its deadline, a milestone 30 or more days overdue, or 2 or more lines in the latest reviewed period that a person confirmed as contradicted. All thresholds are environment settings.

## Data model

With per-visitor copies on (`WORKSPACES=1`), the collections below live under `ws/<id>/` in Firestore: `ws/template` holds the seeded demo, and each visitor's copy is `ws/<id>`.

| Collection | Key fields |
|---|---|
| `users` | id, role (engineer, reviewer, mayor, auditor), name, title, agency |
| `projects` | id, name, location, contractor, contractId, contractAmount (fictional), inChargeId, startDate, firstPeriod, milestones [{pct, due}], site {lat, lon, radiusM}, lines [{key, label, hidden, q, status}], contractorTokenHash, fictional |
| `periods` (id `P-001__2026-05`) | claims [{lineKey, claimedPct, statement, question}], claimsSource, percentComplete {value, enteredBy, enteredAt}, percentHistory, narrativeOverride, check {runId, runAt, runBy, aiMode, models, photoChecks, lines [{lineKey, question, readers {A, B}, aiDefault}]}, flagNotes |
| `photos` | projectId, period, storageKey, exif {taken, gps}, stampText, phash, phashMirror, edges, sourceResolution, source (office, contractor, transmittal), uploadedBy |
| `submissions` | contractor submissions: projectId, period, receivedAt, claims, photoIds, note |
| `decisions` | append-only: kind (line or flag), period, lineKey, readerA, readerB, aiDefault, decision, overrode, readersDisagreed, reason, by {uid, name, role}, at |
| `transmittals` | reportKind, periodKey (2026-05, 2026-Q2 or 2026), due, submittedOn, to, via, refNo, photoId, late, daysLate, countsAsOnTime, loggedBy, loggedAt |
| `monitoring` | date, kind, hours, note, by, onBehalfOfContractor |
| `meta` | seed marker |
| `aicache`, `notecache` | saved Gemini answers and drafts. The shared saved runs sit at the root; answers and drafts made during a visit stay in that visitor's copy |

Shared collections at the root: `aicache` and `notecache` (saved runs), `spend` (daily estimated spend), `limits` (new copies per day), `workspaces` (one record per visitor copy).

Only equality filters are used, so Firestore needs no composite indexes.

## API

All `/api` writes need the header `x-pop-request: 1`. "Engineer in charge" means an engineer acting on a project they are in charge of; other engineers are read-only there.

| Method and path | Who |
|---|---|
| GET `/healthz`, GET `/api/meta` | anyone |
| GET `/api/auth/demo-users`, POST `/api/auth/login`, POST `/api/auth/logout`, GET `/api/auth/me` | anyone (demo sign-in) |
| POST `/api/access` (judge access code) | anyone |
| GET `/api/projects`, GET `/api/projects/:id`, GET `/api/projects/:id/periods/:period` | engineer, reviewer, auditor |
| POST `/api/projects/:id/periods/:period/photos` (multipart `photos`, `stampText`) | engineer in charge, reviewer |
| PATCH `/api/photos/:photoId` (printed stamp) | engineer in charge, reviewer |
| PUT `/api/projects/:id/periods/:period/claims` | engineer in charge, reviewer |
| POST `/api/projects/:id/periods/:period/check` | engineer in charge, reviewer |
| POST `/api/projects/:id/periods/:period/decisions` {lineKey, decision, reason} | engineer in charge, reviewer |
| POST `/api/projects/:id/periods/:period/draft-note` {audience} | engineer in charge, reviewer |
| PUT `/api/projects/:id/periods/:period/percent` | engineer in charge |
| GET `/api/projects/:id/periods/:period/reports`, GET `.../reports/{COA,SUBAYBAYAN,IAS,MPDO}.{txt,csv,html}` | engineer, reviewer |
| POST `/api/projects/:id/transmittals` (optional `photo`), GET `/api/projects/:id/transmittals` | write: engineer in charge, reviewer; read: staff |
| POST `/api/projects/:id/monitoring` | engineer in charge, reviewer |
| POST `/api/projects/:id/contractor-link` (new link, shown once) | engineer in charge |
| POST `/api/projects/:id/periods/:period/flag-notes` | reviewer |
| GET `/api/review/monday`, GET `/api/review/queue` | reviewer |
| GET `/api/review/overrides` | reviewer, auditor |
| GET `/api/owner/projects/:id/trajectory` | reviewer, engineer, auditor |
| GET `/api/mayor/escalations` | mayor |
| GET `/api/audit/projects`, GET `/api/audit/projects/:id/log`, GET `.../log.csv` | auditor, reviewer |
| GET `/api/photos/:photoId` | engineer, reviewer, auditor |
| GET `/api/contractor/:token`, POST `/api/contractor/:token/submissions` | holder of the project link |
| GET `/api/public/projects`, GET `/api/public/projects/:id`, GET `/api/public/projects/:id/photo` | public |
| POST `/api/test/reset` | only when `ALLOW_TEST_RESET=1` |

## Run locally

Needs Node 22 or later (`package.json` engines: `>=22`).

```
npm install
npm run dev
```

Open http://localhost:8080 and pick a person. With no live AI settings the demo readers are used and every screen says "Demo, not a model result". Data is in memory and photos go to `data/photos`; restarting resets the demo.

Seeded contractor links (fictional demo only): `/c/demo-P-001-alpha-link`, `/c/demo-P-002-uno-link`, `/c/demo-P-003-dos-link`. The sign-in page lists them. They are guessable on purpose; an engineer can replace a project's link with "Make a new contractor link".

With Gemini: either Vertex AI with your own Application Default Credentials (`LIVE_AI=1 GOOGLE_CLOUD_PROJECT=<id>`), or a Gemini API key for local use only (never commit it). Saved runs then replay; a new live call also needs `JUDGE_CODE` set and the code entered on the sign-in page.

```
read -s GEMINI_API_KEY && export GEMINI_API_KEY && read -s JUDGE_CODE && export JUDGE_CODE && npm run dev
```

Against the Firestore emulator:

```
gcloud components install cloud-firestore-emulator   # needs Java
gcloud emulators firestore start --host-port=127.0.0.1:8085 &
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 STORE=firestore npm run dev
```

### Tests

```
npm test            # all five steps in "Test results"
npm run test:unit
npm run test:api
npm run test:e2e    # Playwright; uses the installed Chromium
npm run secret-scan
```

`npm test` starts the Firestore emulator itself if `gcloud` and Java are present, and stops only the emulator it started. If it cannot start one, it prints SKIPPED for the Firestore steps; it never reports them as passed.

`node scripts/acceptance.js <service URL>` checks a deployed service without any live model call: separate visitor copies, a decision in one copy not visible in another, an override that shows in the history, a saved run on April 2026, and that without the access code a draft is either a saved one or refused.

### Settings

| Variable | Default | Meaning |
|---|---|---|
| `STORE` | `memory` (or `firestore` when `FIRESTORE_EMULATOR_HOST` is set) | `memory` or `firestore` |
| `FIRESTORE_PROJECT_ID`, `FIRESTORE_DATABASE_ID` | `GOOGLE_CLOUD_PROJECT` or detected, `(default)` | Firestore target |
| `PHOTO_BUCKET` | none | Cloud Storage bucket; when set, photos go there |
| `PHOTO_DIR` | `data/photos` | local photo folder |
| `LIVE_AI` | off | `1` turns on Gemini on Vertex AI with the service's own identity (needs `GOOGLE_CLOUD_PROJECT`) |
| `GOOGLE_CLOUD_PROJECT` | none | Google Cloud project for Vertex AI (and Firestore when `FIRESTORE_PROJECT_ID` is unset) |
| `GOOGLE_CLOUD_LOCATION` | `global` | Vertex AI location |
| `GEMINI_MODEL` | `gemini-3.8-flash` (pinned) | model for reader A, and for reader B unless `GEMINI_MODEL_B` is set; the model named on screen is the one called |
| `GEMINI_MODEL_B` | same as `GEMINI_MODEL` | a different model for reader B |
| `GEMINI_API_KEY` | none | local use only, instead of Vertex AI; never commit it. Not used on Cloud Run |
| `JUDGE_CODE` | none | the access code for live Gemini runs and drafts (Secret Manager on Cloud Run). Unset: no live calls; saved runs still replay |
| `DAILY_CAP_USD` | `3` | daily cap on the estimated live model spend (see "Deploy to Cloud Run") |
| `WORKSPACES` | off | `1` gives each visitor a private copy of the demo (on for the public demo) |
| `WORKSPACE_HOURS` | `24` | hours until access to a visitor's copy ends and it is marked for deletion |
| `WORKSPACES_PER_DAY` | `400` | new visitor copies allowed per day |
| `SESSION_SECRET` | random per process | from Secret Manager on Cloud Run |
| `SESSION_HOURS` | `12` | sign-in length |
| `DEMO_LOGIN` | on | role picker sign-in; turn off when real sign-in is wired |
| `SEED` | `demo` | `demo` seeds the demo when it is missing or out of date; `reset` wipes and reseeds on start; `none` for real use |
| `POP_TODAY` | demo date 2026-06-01 when seeded, else today | fixes the date the deadlines are computed against |
| `MAX_UPLOAD_MB` | `15` | largest accepted photo |
| `MOCK_AI` | off | `1` forces the deterministic demo readers (tests) |
| `ESCALATE_REPORT_OVERDUE_DAYS`, `ESCALATE_MILESTONE_OVERDUE_DAYS`, `ESCALATE_CONTRADICTED_LINES`, `LAGGING_POINTS` | 7, 30, 2, 5 | gauge thresholds |

## Deploy to Cloud Run

The deployer runs these with their own gcloud account. Region `asia-southeast1` (Singapore) is the closest to the Philippines. Both scripts print every command and change nothing unless `APPLY=1` is set. Put `PROJECT=` and `DEPLOY_ACCOUNT=` in `deploy/.env.deploy` (not committed).

```
bash deploy/setup.sh            # dry run: read the commands
APPLY=1 bash deploy/setup.sh    # one time: APIs, Firestore, TTL policies, private bucket, secrets, service account
APPLY=1 bash deploy/deploy.sh   # build from source with Cloud Build and deploy
```

`setup.sh` is safe to re-run: each create step first checks whether the resource exists (with the matching `describe` command) and skips it if so. Any other failure stops the script.

What they set up:
- **Firestore** (Native, Singapore). The seeded demo lives under `ws/template`. Each visitor's copy under `ws/<id>` carries `expireAt`, 24 hours after the copy is created, and access to the copy ends then. Firestore TTL policies on each collection group (the demo collections, `aicache`, `notecache` and `workspaces`) then delete it. Google documents this as "typically within 24 hours after its expiration date", so a copy can remain stored for up to about a day after access ends. TTL deletes count as Firestore deletes.
- **Cloud Storage**: a private bucket. Seeded photos under `seed/`, visitors' uploads under `ws/`, deleted after 2 days by a lifecycle rule.
- **Secret Manager**: `pop-session-secret` (random) and `pop-judge-code` (typed in; it goes only in the submission form).
- **Service account** `pop-run`: Firestore user, Vertex AI user, log writer, object admin on its bucket, accessor on its two secrets. Vertex AI is called with this identity: no API key exists.
- **Cloud Run**: unauthenticated (the judge link needs no sign-in), one instance, `WORKSPACES=1`, `LIVE_AI=1`, `GEMINI_MODEL=gemini-3.8-flash`, `DAILY_CAP_USD=3`.

Notes:
- Every Gemini call and every check run writes one structured log line (`gemini_call`, `check_run`) with latency, tokens and estimated cost, so Cloud Logging gives the time per claimed line.
- The daily cap (`DAILY_CAP_USD`, US$3) is an estimate, not a limit on the cloud account: also set a budget alert in the Google Cloud console. The Flash 3.8 price is not yet confirmed on Google's price page, so `src/ai/spend.js` prices it conservatively (US$1.50 per million input tokens, US$7.50 per million output tokens, thinking included). Each live call is bounded (`src/ai/gemini.js`): at most 4 photos, 20 claimed lines, and an output-token limit of 15,000 per reader call and 2,000 per draft, thinking included. Requests over the size limits (each claimed line and question under 300 characters, prompt under 24,000 bytes) are refused before anything is reserved. Before it starts, each call reserves its largest possible cost at the model's rates: input counted as one token per UTF-8 byte of prompt and response schema (a tokenizer never needs more), plus 2,000 tokens per photo (Google documents 1,120 for Gemini 3 at the default media resolution), plus the whole output limit. The largest a reader call can reserve is under US$0.17. The reservation is a transaction on the shared daily ledger in Firestore, so separate instances (for example two revisions during a rollout) cannot both pass the cap. If the cap has no room, or the ledger cannot be written, the call does not run. A call that fails or times out keeps its reservation as spent, and a reservation left open by a crash stays counted.
- Never run `SEED=reset` against a real database: it deletes and reseeds.

## Mock vs real

| Part | In this repo | Real |
|---|---|---|
| Express API, role guards, all rules, deadlines, gauge, reports, logs | real | same code |
| Firestore adapter | real; tested on the Firestore emulator when Java is present | same code on Cloud Run |
| Cloud Storage adapter | real code | used when `PHOTO_BUCKET` is set |
| Gemini readers | real, on Vertex AI; tested with a stubbed client; saved runs recorded with `scripts/record-runs.js` | `LIVE_AI=1` on Cloud Run |
| Saved runs | real Gemini answers replayed when the same photos and claimed lines come back (labelled with model and date) | same |
| Demo readers | deterministic: replay the two reference labels for P-001, invented labels for P-003, a fixed rule otherwise. Always labelled "Demo, not a model result" | used only where no saved run exists, and in tests |
| Sign-in | demo role picker with a signed, httpOnly cookie; per-visitor workspace cookie; judge access cookie | see below |
| Data | all projects, progress claims, percentages, amounts, staff and decisions fictional. Photos: the 11 modified public frames only (see "Credits") | |

## Replacing demo sign-in with real sign-in

Only two pieces change. `POST /api/auth/login` becomes a sign-in with Google or Identity Platform (verify the ID token on the server with the Firebase Admin SDK or Google's token verifier), and `authMiddleware` in `src/auth.js` reads the verified user instead of the demo cookie. Map each verified email to a `users` record holding the role; keep the role guards (`allow(...)`) exactly as they are. Then set `DEMO_LOGIN=0`. Contractor links stay as tokens; the public page stays open.

## Decisions to check

- **DILG deadline month.** "Before the 25th" is read as the 24th of the reporting month itself (the May update is due 24 May). If the office means the 25th of the following month, change `dueDate('SUBAYBAYAN')` in `src/domain/deadlines.js`; the unit test states the rule.
- **"5 working days after period close"** is the 5th working day after the last day of the month (COA) or quarter (IAS, MPDO). Philippine holidays for 2025 and 2026 are listed in the same file; Islamic holidays are declared each year and must be added.
- **Milestones** are 20, 40, 70 and 100 percent with planned dates per project, joined by straight lines to give the planned percent on any date. Some offices use bands (before 20, 20 to 40, 70 and up); check what the office calls a milestone.
- **Lagging** is 5 or more points behind plan (a setting). Common public-works warning levels are different; set `LAGGING_POINTS` to the office's rule.
- **Mayor thresholds:** report 7 days overdue, milestone 30 days overdue, 2 or more confirmed contradicted lines. Only lines a person has decided count.
- **Late reports** are flagged and not counted as on time; the earliest logged submission decides, so logging again later cannot change a late report into an on-time one.
- **Who may do what:** engineers change only projects they are in charge of; the reviewer (office head) can act on any project but cannot enter percent complete. The engineer in charge decides each line and the office head can overrule; every decision is kept in the log.
- **The demo runs on a fixed date**, Monday 1 June 2026, so the fictional claims line up with their photos. Log timestamps are always real time, so decisions made today show today's date next to a June 2026 demo date.
- **Public photo:** the public note shows the latest photo the office has looked at. For real projects, decide whether photos go public.
- **Node 22** runs the service (Node 20 reached end of life on 30 April 2026). Firestore and Storage client libraries are pinned to 7.x.

## Known limits

- A tight crop gets past the perceptual hash (a unit test documents it). Feature matching would catch crops; not built.
- The comparability check is an edge correlation, not full image registration; the prototype's SIFT and RANSAC alignment was not ported. Only the prepared seed frames are aligned; uploaded photos are not registered.
- Printed camera stamps are typed by the uploader; there is no OCR.
- The year-end report (15 December) is tracked as a deadline but has no draft generator.
- Saved Gemini runs replay only when the photos and claimed lines are exactly the same; anything new needs a live run (judge access code).
- The readers' prompt passes earlier overrides on the project as guidance; saved answers are matched on photos and lines only, so a replayed answer may predate a visitor's own overrides.
- `gcloud run deploy --source .` builds the Dockerfile in Cloud Build.
- Firestore tests print a harmless "MetadataLookupWarning" because the client looks for a Google metadata server that does not exist locally.
- In-memory store and local photos are for one process only; use Firestore and a bucket on Cloud Run.

## Credits

The backend, role screens and tests were built by Crystelle Soriano. v3 adds the per-visitor workspaces, the access code and spend cap, Vertex AI, saved runs, the Monday plan overlay and trajectory, the comparison lens and the drafted notes.

**Site footage.** Arman Keresh, "IITU Multi-Temporal Building Floor-Count Dataset: 12-Month Fixed-Viewpoint Construction Sequence", Mendeley Data, Version 1, 2026, doi:10.17632/ww7rt2rnk6.1. Licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modifications: 11 monthly frames were extracted, aligned to one camera view, resized to 1120x630, and blurred at street level. The screenshots in `docs/screens` contain these modified frames. Street level is blurred. Small, unidentifiable figures can remain visible on the rooftop, and parts of the frame edges are not blurred. No faces or plates are readable. The frames are used only for the fictional demo project P-001; everything else in the seed data is fictional.

Third-party code (three.js, MIT) and the full notices are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). The project's own code has no licence file on purpose.
