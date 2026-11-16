# Hot & Cold Assessment Mastery — v3.2.0

## How to deploy (order matters)

1. **Backend first.** Open the Google Sheet → Extensions → Apps Script. Replace all code with
   `apps-script/Code.gs`. Run `testSetup()` once.
   Then **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.
   Editing the existing deployment keeps the same `/exec` URL, so `BACKEND_URL` in the HTML files stays the same.
   (If you make a *New deployment* instead, paste the new URL into `index.html`, `instructor-dashboard.html` and `gradebook.html`.)
2. **Then the app.** Upload/push all files (`index.html`, `instructor-dashboard.html`, `gradebook.html`,
   `about.html`, `service-worker.js`, `manifest.json`, `icon.svg`).

## New

- **Print Exams (instructor).** Every exam submission now stores each item, the key and the
  student's answer. Print one student (🖨 icon in the roster or *Print Exam* in the student window)
  or everyone shown in the roster (**Print Exams** button; it follows the search/filter).
  The printout shows the score (e.g. 24/30), rating, remarks, the list of wrong items, and every
  item with the student's answer (✓ green / ✗ red) and the correct key (yellow). Long bond size.
- **Actual exam score shown everywhere** (student dashboard and result, certificate,
  instructor roster/window, gradebook column *Exam Score*, CSV exports) — not just the percentage.
- **Retake codes now work.** The student enters the code on the Exam page after a failed attempt.
  Codes are tied to the student number and can be used once. Previous attempts are kept and printable.
- **Sync status** on the student Profile page (submission code, last synced, pending/up to date).

## Fixed

- **Syncing silently failed for large records** — progress was sent as one long GET URL.
  Now sent by POST; failed syncs are retried automatically (back online, app reopened, every 60 s).
- **"50%" saved as 0.5 in Google Sheets** (dashboard/gradebook showed 0.5% or wrong grades).
  New rows are saved as plain text; old rows are read using their displayed values.
- **Submission code changed on every sync**, so QR/code look-up failed. The code is now permanent.
- **Exam could be restarted by reloading the page or switching phones.** In-progress exams are
  saved after every answer and resume on reload; the server copy is restored on a new device.
- **Integrity flags were never recorded.** Leaving the app or reloading during the exam now adds a flag.
- **Gradebook "Class Average" row was shifted one column** to the right.
- **Retake codes had no effect** (the student app had no way to use them).
- Service worker cached every backend reply (storage kept growing, stale data possible) — backend
  calls are no longer cached; pages load network-first so students get updates on the next open.
- Duplicate rows when two syncs arrived together (LockService added). Missing sheet tabs/headers
  are created automatically. Version numbers unified to 3.2.0.

## Note on older exam records

Exams taken on v3.1.x did not save the answers, so those can't be printed item by item
(the score still shows). Exams taken from v3.2.0 onwards can be printed.

## v3.2.0 — follow-up fixes

- **View / Print / Retake buttons did nothing** for some students. They looked students up by
  student number as text, but Google Sheets returns all-digit student numbers (e.g. 2023001) as
  numbers, so no match was found. Buttons now use a stable row id and work for every record,
  including old rows and students without a student number.
- **Paper size picker** in the exam print window: Long bond (8.5" × 13"), Short bond / Letter
  (8.5" × 11"), A4, Legal (8.5" × 14"). The last choice is remembered.
- Roster filter buttons (All / At Risk / Passed) now show which one is active.
- **Clinical Instructor name is no longer fixed.**
  - Instructor Dashboard → **Instructor** button: set your name/credentials and position. It is saved
    on that device only, so each clinical instructor sets their own. It prints as the signatory on exam printouts.
  - The exam print window also has *Clinical Instructor* and *Position* fields to change it right before printing.
    Leave the name blank to use each student's own CI (from the student's profile).
  - Students can enter their Clinical Instructor at registration or in Edit Profile; it appears on their
    Certificate of Completion. The certificate keeps a small "App developed by JEMUEL C. MARI, MAN, RN, LPT" credit.

## v3.2.1

- **Organized Instructor Dashboard.** Filters for Section, Group, School Year, Semester and Exam
  Status (Passed / Failed / Not yet taken / At risk / With integrity flags / Used a retake), plus search.
  Each filter list only shows values that exist for the other filters chosen.
  - **Arrange by** Section, Section → Group, Group, or no grouping. Each group has a summary line
    (students, exam taken, passed, average exam score, at risk).
  - New **Group** column. Click any column header to sort (click again to reverse).
  - Stats, chart and at-risk alerts follow the Section / Group / School Year / Semester filters.
  - Filters are remembered on that device. **Print Exams** and **Export CSV** use the students currently shown.
- **Older exams (taken on v3.1) can now be printed without a retake.** v3.1 saved only the score, so
  the student's individual choices cannot be recovered. The exam was the same fixed 30 items in the same
  order for everyone, so the printout shows the exact exam taken, the answer key and the student's
  score, with a note that the choices were not recorded.
- The exam items now live in `exam-bank.js`, shared by the student app and the dashboard.
  Edit questions there only, and keep the order of items that students already answered.
- Fixed the Class Analytics chart: the 50% and 75% guide lines were swapped.
