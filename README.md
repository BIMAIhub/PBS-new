# Pragmatic BIM Solution

PBS is a BIM learning portal for students and administrators. Both workspaces use the same visual system, including the classroom, enrollment forms and downloadable student documents.

## Start PBS

Use Node.js 24 LTS. Install dependencies and create your administrator from a trusted terminal.

```sh
npm ci
cp .env.example .env
npm run admin:setup -- --email YOUR_ADMIN_EMAIL --name "PBS Administrator"
npm run dev
```

The setup command prompts for a password. Open [http://localhost:3000](http://localhost:3000), choose **Administrator**, and sign in. To reset an existing administrator password, rerun the setup command with `--reset`.

The database starts with an empty roster and catalog. From **Courses & videos**, create a course, add a module, and publish it in the enrollment catalog when ready.

### Create the first administrator on startup

Set `PBS_BOOTSTRAP_ADMIN_EMAIL` and `PBS_BOOTSTRAP_ADMIN_PASSWORD` in the host's private environment before starting PBS. For local use, set them in the ignored `.env` file. `PBS_BOOTSTRAP_ADMIN_NAME` is optional. The server creates the account if the database has no administrator. Sign in using the configured email and temporary password, then set a new password to open the workspace. Remove the bootstrap settings after the first sign-in.

From the administrator account menu, choose **Edit admin profile** to update your name and sign-in email or **Change password** to update your password. Both actions ask for your current password.

## Add video lessons

In **Courses & videos**, select **Add video** and choose a module. Upload an MP4 or WebM file, or paste an individual HTTPS video file link. Use **Edit lesson** under **Curriculum and materials** to replace an unavailable video. Ordinary OneDrive and SharePoint video links now play in the native PBS player through the existing Microsoft connection. The course's mapped owner is used first; legacy unmapped lessons can use the sole connected Microsoft account. With multiple owners, map the course folder in **OneDrive & email**. Folder and document links are not recordings. Microsoft file URLs are resolved only after checking the student's active enrollment; the classroom never shows an external “Open video” link.

Uploaded videos, direct video files and connected OneDrive recordings save each student's current position every 15 seconds, on pause, on lesson change and when leaving the classroom. Reopening the course selects the last watched recording and restores its timestamp. A device cache covers interrupted synchronization; the server record supports returning on another device. Replacing a recording invalidates the old timestamp. Native videos automatically complete after 80% of their unique timeline has been watched. Seeking does not count; replaying a section does not add it twice. The server checks progress against elapsed time and the current recording version. Attendance points remain based on verified live attendance. Native playback includes play/pause, 10-second skips, speed, start over, focus mode and fullscreen.

When Microsoft omits a playback URL from file metadata, PBS resolves the file through Graph's `/content` endpoint and reads its short-lived redirect on the server. A missing metadata URL is not reported as a permissions failure. Real Microsoft access denials remain blocked and are shown separately. This fallback uses the existing owner connection and changes no sharing permissions, credentials or saved settings.

The playback validator accepts Microsoft's personal OneDrive content and file-storage hosts as well as SharePoint. Unsupported-location errors include only the hostname for troubleshooting; signed paths and temporary access tokens stay out of error messages.

YouTube, Google Drive and Vimeo remain embedded when their providers allow it; their embedded controls do not expose PBS timestamp tracking. The native student player hides download and remote playback controls. Browser playback cannot prevent all copying or screen recording. This release adds playback data tables and does not reset account passwords, branding, payment destinations, Microsoft configuration or existing enrollment records.

To add a lesson from a terminal, use the same administrator account. The command prompts for the password, or reads it from `PBS_ADMIN_PASSWORD` if supplied by the host.

```sh
npm run video:add -- --email YOUR_ADMIN_EMAIL --list
npm run video:add -- --email YOUR_ADMIN_EMAIL --course COURSE_ID --module MODULE_ID \
  --title "Lesson title" --duration "24 min" --file /path/to/lesson.mp4
npm run video:add -- --email YOUR_ADMIN_EMAIL --course COURSE_ID --module MODULE_ID \
  --title "Lesson title" --url "https://your-video-provider/your-video"
```

Set `PBS_PORTAL_URL` or pass `--server` to target a running PBS host. The upload limit defaults to 1,024 MB and can be changed with `PBS_MAX_UPLOAD_MB`.

## Enroll students and issue receipts

The course selector includes every course and labels existing enrollments and pending applications. Use **Review application** for a pending request, or **Manage assigned course** for an approved enrollment. The same student/course pair cannot be charged or enrolled twice. Each course card also has an **Enroll student** shortcut.

Configure your verified business UPI ID and payee name under **Payments & receipts → Payment settings**, or use the setup banner on the admin overview, student or course page. Until then, students see an explicit payment setup notice and can apply without reporting payment. Once configured, enrollment shows the full-fee QR and **Pay with UPI app** immediately; students can choose an installment, then tick **I have paid** and enter their bank UTR. An app launch never marks a payment verified.

From **Students → Open record**, administrators can deactivate/reactivate an account, pause/resume an individual course, or delete a student. Deactivation invalidates sessions and blocks sign-in. Deletion moves the account to **Deleted students**, hides public portfolio/feedback and preserves receipts, balances and progress. Deletion requires the admin password and the student's email. Restore returns an inactive record; reactivation is a separate action. These controls never grant access to a pending application.

**Courses & videos → Pause course** stops new enrollment and locks course content, tasks, assessments and live joins for all enrolled students while preserving records. Its public page remains visible with the pause reason. Resume reopens course access, except for any individual student pauses. Access changes are audited and course pause/resume notifications appear in student workspaces. Previously granted direct OneDrive permissions must also be revoked in Microsoft OneDrive when necessary.

- **Student application.** Open **Explore courses**, choose a published course and submit the application. New applicants receive an application code for **Check enrollment** and wait for admin approval before sign-in details are issued. Existing approved students can track additional applications under **My courses**.
- **Direct enrollment.** Open **Students → Enroll student** and enter the student's email, course and agreed fee. For a new account, PBS displays a temporary password once. Share it privately so the student can set their own password at sign-in.
- **Payment review.** Open **Payments & receipts → Payment settings** and save your verified business UPI ID and payee name, confirming with your admin password. Students can scan the payment QR or open their UPI app from **Fees & payments**, then submit the bank UTR. PBS creates a receipt only after an admin verifies the bank transaction. Environment variables `PBS_PAYMENT_UPI_ID` and `PBS_PAYMENT_NAME` are fallback settings when no saved destination exists.
- **Payment ledger.** Filter records by balance, pending reference or overdue date. Each enrollment shows its source, agreed fee, verified payments, reported payment and outstanding amount. Set a due date and private admin note, then export the ledger as CSV.
- **Fee reminders.** Use **Send reminder** on an outstanding enrollment. Portal messages are available immediately. Email requires a connected Microsoft account and also posts a portal copy. A repeated request does not send a duplicate. Email status **accepted** means Microsoft accepted the request; it does not confirm final delivery. Check Microsoft Sent Items before retrying an **unknown** result.
- **Receipt download.** Recording a payment creates a numbered receipt and updates the balance. Admins and the enrolled student can print or download the receipt as a PDF. The student ID and bonafide letter use the student's enrollment records.

## Run on a live host

```sh
npm run lint
npm run build
npm start
```

Run the Express server on a Node host with HTTPS and a persistent writable volume. Set `PBS_DATA_DIR` to that volume, outside the web root, and set `PBS_PUBLIC_ORIGIN` to the public HTTPS URL. Use `PBS_TRUST_PROXY=1` when there is exactly one trusted reverse proxy in front of the server. The default host is loopback. Set `PBS_HOST=0.0.0.0` when your hosting platform requires a network bind.

The volume holds the SQLite database and uploaded videos. Back up the volume using the host's snapshot mechanism or stop the server before copying it. **Export records** in the admin menu produces a readable JSON report.

## Deploy on Vercel

Deploy the `main` branch in the connected Vercel project. The Vercel configuration builds the website and routes `/api/*` to the PBS server function. The local PBS installation continues to use SQLite and the `data` folder. Node.js is pinned to the tested 24.x major version.

1. In **Storage**, connect a [Turso Cloud database](https://vercel.com/marketplace/tursocloud) to the project. PBS accepts the connection's `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` with or without the `PBS_` prefix. Select the Vercel environments you intend to deploy.
2. Connect a [private Vercel Blob store](https://vercel.com/docs/vercel-blob/private-storage) for uploaded lesson files. The server accepts the connected `BLOB_STORE_ID` with Vercel OIDC, or `BLOB_READ_WRITE_TOKEN` for token-based connections. Existing HTTPS lesson links can play without a Blob store.
3. In **Environment Variables**, set `PBS_BOOTSTRAP_ADMIN_EMAIL` and a private `PBS_BOOTSTRAP_ADMIN_PASSWORD` for the first online administrator. A fresh cloud database has its own accounts and records. Production must stay bound to the existing live database when retaining administrator credentials; preview database branching should not be used as a replacement for the live database. Sign in as **Administrator**, replace the temporary password, then remove the bootstrap variables. For a fixed production domain, set `PBS_PUBLIC_ORIGIN` to its HTTPS origin in the Production environment.
4. Redeploy the branch after configuring storage and environment variables. Verify that `/api/health` returns `{"status":"ok"}` on the deployment, then sign in and test a lesson upload before assigning the production domain.

The hosted app sends file uploads directly to private Blob storage. The PBS API verifies the file before attaching it to a lesson and checks enrollment before issuing a playback link.

Production builds verify the saved database connection and apply additive schema migrations before becoming live. A rejected connection fails the build so the working deployment stays available. Preview and local builds do not run this Production check. Vercel environment-variable values can be pasted as raw values or single-line `KEY="value"` snippets; PBS removes the wrapper in server memory without changing saved secrets. Startup diagnostics never print raw provider messages or tokens.

## Separate OneDrive storage and Microsoft 365 mail

Production uses **https://student.pragmaticbim.com**. Set `PBS_PUBLIC_ORIGIN` to that origin in the Production environment. Register this exact **Web** callback URL in each Microsoft app registration: `https://student.pragmaticbim.com/api/integrations/microsoft/callback`.

1. Keep the existing private `PBS_INTEGRATION_KEY` stable. It encrypts application secrets, Microsoft tokens and referral bank details. Changing it makes previously encrypted records unreadable.
2. In **OneDrive & email → OneDrive storage account**, save the application ID, tenant and client secret **value**. Use an app supporting the Microsoft identity that owns the files; a Microsoft account can use a Gmail address as its sign-in. Delegated Graph scopes are **User.Read** and **Files.ReadWrite**. Connect that storage identity in Microsoft's account selector.
3. Configure **Microsoft 365 mail account** separately, then connect **info@pragmaticbim.com**. Its delegated scopes are **User.Read** and **Mail.Send**. Your Microsoft 365 administrator may need to approve consent. You can use separate app registrations; the storage identity and mailing identity have separate token caches and reset controls even when the same registration is used.
4. Choose **Link a course folder**, select the OneDrive folder, and map it to the course. The video upload form's **Upload to OneDrive** option creates a module folder under that course folder and uploads directly to Microsoft in chunks. PBS attaches the lesson after verifying its final file, parent and size. Student playback stays inside PBS with resume, focus mode and fullscreen.
5. Set **Assignment destination** to your OneDrive Assignments folder link. Student uploads are organized as **Course → Batch → Student → Assignment**. Assignments accept up to five files, 512 MB each; videos accept MP4/WebM up to 8 GB. The upload must finish before files appear in **Assignments → Review submissions**. Admins see the student's batch and uploaded files there.

**Clear saved setup** clears only the selected account role's saved app ID, tenant, secret and Microsoft connections. It asks for the current PBS admin password and closes on success. Disconnecting or clearing setup does not delete external files or revoke existing Microsoft permissions. Browser-saved passwords are controlled by the browser's password manager.

PBS requests course read access with **sendInvitation: false**, so Microsoft invitation emails are not sent to students. Microsoft may require an existing guest or member identity for silent sharing. For courses with scheduled module locks, PBS uses portal playback instead of sharing the entire course folder, which could expose future modules. Previously granted folder access must be reviewed separately in OneDrive. Native playback hides download controls; this is not DRM and cannot prevent screen recording.

Existing combined Microsoft configurations are copied to the mailing role once during the upgrade, preserving existing behavior until the admin connects a different sender. Replacing the storage account afterwards does not replace the mail account.

## Batches, scheduled modules and learning roadmap

Use **Admin → Batches & releases** to create a batch with its course, dates, enrollment deadline and capacity. Published batches appear on the public course page with actual remaining seats and enrolled counts. Pending applications reserve seats; capacity is checked within the enrollment transaction. Direct enrollment can assign a batch, and the batch roster includes enrollment status and verified fees.

Map a live session to a batch, then choose a module release rule for all students or a batch override: open, scheduled date/time, administrator-confirmed live-session completion, automatic session end, or manual release. Batch-specific rules override the course-wide rule. Locked modules are enforced on playback, progress and assignment submission. Cancelled or unpublished sessions do not release content. Students see the release explanation and their current stage in **My roadmap**. Existing courses stay open until rules are configured.

Native MP4/WebM and OneDrive recordings complete automatically at **80% unique watched coverage**, recorded separately from the resume timestamp. Skipping is not watched time, and replays cannot inflate coverage. Third-party iframe players do not expose the native PBS watch tracker; attach a native recording for tracked completion. Existing completion records are retained.

Use **News & notices** to publish academy-wide, course or batch announcements, with a publication time and optional expiry. Published notices appear in student workspaces and notifications. The roadmap and workspace refresh while visible so newly released modules appear without signing in again.

## Referral bank payouts and a clean student reset

Students can save encrypted bank details in **Refer & earn**, then request a bank payout from qualified earned credit. Requests atomically reserve the selected amount, so it cannot also be spent on course fees. Admins can pause new payout requests under referral conditions. Existing requests capture the bank destination at request time. The admin verifies that destination with their current password, makes the bank transfer outside PBS, then records its reference and confirms that it was completed. Recording a paid request is idempotent; declining returns the reserved credit once. A connected automatic mail sender can queue the branded payout confirmation. PBS does not initiate bank transfers.

**Reset student data** provides current counts and a reviewed confirmation. It permanently removes student accounts and password hashes, enrollments, receipts, progress, certificates, submissions, referral/bank records and student mail history. It preserves the current administrator email, name, password and session, course content, batches, live sessions, module rules, branding and Microsoft configuration. Pending referral payouts must be finalized or declined first. The reset requires the current admin password and the exact phrase shown in the dialog, and closes on success.

External OneDrive files and sharing permissions remain in Microsoft. Private CV files are queued for deletion; storage failures remain visible for retry and are also retried by the protected academy job. Production backups and deployment-specific database branches are outside the portal reset and must be handled in the hosting/database dashboard when a full purge is required.

## Certificates and portfolios

**Certificates** in the admin workspace provides architectural, classic and minimal designs, editable colors, titles, issuer and signatory details, and a live preview. Save one default design or a course-specific override. Recipient name, course title, issuance date and credential ID come from real course completion. Design updates apply to later downloads of issued records. Admins can revoke an issued credential with a recorded reason.

Students unlock **My certificates** after completing every lesson and passing the published course assessment. Claiming a certificate creates one permanent record per student/course. Students can download a landscape PDF and optionally enable public verification, which includes a verification QR in newly downloaded PDFs. Public verification is private by default. When enabled, it shows the recipient name, course, issuer and credential status without email or payment details. LinkedIn sharing opens a composer, and **Add credential** opens LinkedIn's certification form for the student to review.

**My portfolio** lets students edit a headline, project summary, project URL, LinkedIn, GitHub and website links. Publishing is optional. Students can copy the public portfolio link or share it to LinkedIn. Fee records, internal notes and contact information do not appear on the public page.

## Live classes, attendance and student points

In **Admin → Live sessions**, choose **Schedule session** (also available inside a course's curriculum). Select the enrolled course, enter the Google Meet meeting-code link, agenda, start/end time in **IST**, join opening (0–30 minutes early), attendance points, and report minimum duration. The defaults are 10 minutes early, 20 points and a 15-minute attendance minimum. Publish only after configuring the Google host controls. You can edit, reschedule, save a draft, or cancel a session. A course cannot be changed after creating its session; times cannot change after attendance has been verified.

**Google access is a separate control.** Create the event in Google Calendar; use **Restricted** meeting access, invite only the approved course students' Google account emails, and disable joining requests from uninvited people. The PBS attendance roster has **Copy approved emails** for this task. Google does not offer Restricted access on consumer accounts; where those controls are unavailable, the host must check admission requests. PBS does not create Google invitations or change Google-account permissions. See [Google's host-access instructions](https://support.google.com/a/users/answer/11989526?hl=en).

Students see upcoming sessions, a server-time-based join countdown, calendar downloads with a 10-minute reminder, completed sessions, their attendance status and their earned points. The dashboard shows the next live class and points total. Published schedule updates, reschedules, cancellations, joining-open updates and attendance decisions appear in the notification bell/popups. Notifications refresh while the portal is open; this does not add offline push, SMS or automatic email delivery.

Meeting URLs are excluded from student workspace/list/calendar responses. The join request checks the currently approved enrollment, publication, host-setup confirmation, cancellation and the actual server-time window before releasing a Google Meet URL. Revoked or pending enrollment cannot request it. A received URL can still be copied, so the Google host controls above are required to restrict admission in Meet itself. Existing legacy session links migrate into the schedule once and require the host-access review; old course responses no longer expose their raw meeting links.

**A portal join is not proof of Meet attendance.** The server records first/last portal join and repeat click count, with zero attendance points initially. The admin confirms actual attendance using the host view or imports the Google Meet attendance sheet as CSV. The report's **Email** and **Duration** columns are matched only to approved students in that course. CSV supports quoted cells, HH:MM:SS, plain minutes, `Duration (seconds)` and human durations such as `45m 30s`. Preview before applying; confirm the report belongs to the selected class. Duration at or above the configured threshold marks Present and awards points; shorter durations mark Partial/Absent with no points. Unmatched emails are skipped; students absent from the report are left unchanged. Reports are limited to 180 KB/1,000 rows. [Google attendance-report availability and fields](https://support.google.com/meet/answer/10090454).

Points are stored once per student/session, not incremented on repeated join clicks or imports. Existing Present awards retain their saved points when a session's point setting changes. Changing attendance to a non-Present status removes those points; a subsequent explicit Present confirmation uses the current setting. The roster, CSV export, student dashboard/history and admin student records show the resulting totals. All attendance verification and report imports are audited. The tests use isolated temporary databases; they do not create production classes or students or join real meetings.

An attendance import is applied only when the reviewed CSV, session settings and matching attendance records are still current. If another admin changes them after preview, the portal asks for a fresh preview before writing any attendance. Administrators may correct an existing record to Partial, Absent or Excused after enrollment has been revoked, removing an incorrect award. A new Present decision and new points still require approved enrollment.

The shared content surfaces use translucent gold derived from `#D4A94D`, with off-white input surfaces. This includes the standalone curriculum/offer introduction cards. Header account names use light text on the dark glass toolbar. Official printable documents retain a white paper surface.

## Global branding and glass appearance

Open **Academy settings → Branding & appearance** in the admin workspace. Upload a square PNG, JPEG or WebP logo (up to 512 KB) and select **Publish logo**. The identity updates in public pages, workspace navigation, student IDs, receipts, bonafide letters, certificate previews and newly downloaded certificate PDFs, desktop notification icons, and the browser tab. Existing downloaded PDFs remain unchanged. Upload a wide background (up to 2 MB) for sign-in and public course discovery, or restore the included PBS assets.

Edit the academy name, short name, tagline, support email, hero headline and introduction, then choose **Save branding**. The default palette is blue `#176BB7`, gold `#D4A94D`, and light reading surfaces `#F4F7FA`, set against a navy photographic stage. Colours, glass surfaces, and interface animation can be changed here. Primary button colour is checked for readable white text; reading surfaces stay light. System reduced-motion preferences always override animation. The admin motion setting also stops certificate confetti. Other open tabs refresh branding on focus and at most once a minute while visible.

Brand settings persist in the database. Hosted uploads use the configured private Vercel Blob store, with only the current public brand images served through the PBS API. Local uploads use the persistent PBS data directory. Image files are bounded and checked for their raster format; SVG uploads are not accepted. Branding changes require an administrator account and appear in the academy activity log. Payment payee details and saved certificate issuer wording are managed separately and are not rewritten by a brand change.

The included `public/bim-studio-hero.webp` is an original generated concept image of a BIM learning studio, created with the built-in image generation tool. It illustrates the learning setting; it does not document a specific PBS facility or imply third-party accreditation. Generation brief: editorial architectural photograph of adult engineers collaborating around BIM and MEP models in a contemporary studio, navy shadows, warm gold lighting, wide composition with calm room for a headline, no text or logos. The architectural logo remains a resolution-independent SVG in `public/pbs-logo.svg`.

## Course discovery, offers and notifications

The public catalog is available at `/explore`, with a separate page at `/courses/COURSE_ID`. Only published courses are public. In **Courses & videos**, edit a course and enable **Show in the enrollment catalog**. **Curriculum & assignments → Edit public course information** adds the level, intended audience, learning outcomes and requirements. Public course responses contain curriculum information and lesson titles, without private playback URLs.

`PBS_BOOTSTRAP_CATALOG=1` performs a one-time restore when the course database is empty: the Revit MEP Masterclass from the supplied PBS reference, listed at ₹14,999, two curriculum outlines, and a 20% public course offer. It creates no student, video or assessment records. The connected production project has this setting enabled. Later admin edits are preserved; the restore does not run repeatedly or replace an existing catalog. Review the course price, content and application availability in the admin workspace.

In **Offers & referrals**, create public discounts, private offer codes or referral codes assigned to students. Restrict offers by course, email, date or application count. The server selects the best eligible offer; discounts do not stack. It checks the price again when an application is submitted and saves the fee and offer with that enrollment. Editing an offer does not alter existing agreed fees. Referral owners cannot redeem their own codes. Rejected applications release their reserved usage.

The notification bell includes messages, fee reminders, enrollment decisions, receipts, assignments and certificate-ready updates. In-portal popups require no permission. Read and popup acknowledgement persist per account. While the portal is visible, notifications refresh every 30 seconds and on window focus. Optional desktop alerts require browser permission and keep checking while the tab is open. This is not an offline push or SMS service. Email reminders still use the separate Microsoft connection.

## Student profiles, CVs and portfolio building

**My profile & CV** lets students update their name, phone, professional headline, location, summary and skills. PDF CV uploads are limited to 3 MB and validated before storage. Hosted CVs use private Blob storage; local CVs use the private PBS data directory. A CV is downloadable publicly only when both the portfolio is published and the student enables CV sharing. Turning off sharing, unpublishing the portfolio or removing the CV disables the public download endpoint. Private storage locations do not appear in public profile responses.

**My portfolio** provides Studio, Resume and Gallery layouts, an accent color, editable projects with ordering, experience and education sections, and a live preview. The builder saves the page and its sections together. Public pages include only professional profile fields, selected links, projects, and credentials whose public verification the student has enabled. LinkedIn sharing opens its composer for the student to review; PBS does not post automatically.

The classroom includes **Focus mode**, a fullscreen player, and keyboard shortcuts **I**, **F**, and **K** for focus, fullscreen, and native-video play/pause. Embedded providers retain their own playback behavior. Certificate milestones show actual lesson and assessment requirements. Claiming an eligible credential records it permanently and displays a brief celebration that respects reduced-motion preferences.

## AI curriculum drafts and module assignments

From **Curriculum & assignments**, choose a course and describe the topics, audience and expected project. The AI drafting tool prepares a course summary, learning outcomes, module objectives, practical assignments and a capstone. An administrator must review the editable draft and choose **Apply reviewed curriculum**. Applying adds modules and assignment briefs once, preserves existing recordings, and publishes assignments only if the admin selects that option. It does not manufacture recordings, instructors, schedules, prices or accreditation claims.

On Vercel, the server uses request-scoped OIDC for AI Gateway. The project account needs Gateway access, verification and sufficient credits. The default curriculum model is `google/gemini-2.5-flash-lite`, selected from the Gateway catalog during implementation; `PBS_CURRICULUM_MODEL` can override it with another supported model. Outside Vercel, set a private `AI_GATEWAY_API_KEY`, or use the existing optional `GEMINI_API_KEY` integration. No provider key is returned to the client. Requests are limited to four per minute per address and 20 per day per admin; failed attempts also count toward the daily limit.

Students see published module assignments and course capstones only after enrollment approval, submit project links, and receive instructor feedback in their workspace and notification history. AI output is validated before review and again before applying it. Provider failures leave the course unchanged. Manual assignment editing works without AI configuration.

## Verify changes

```sh
npm run lint
npm test
npm run build
```

The tests create and delete an isolated temporary SQLite database, override remote connection settings, and never seed production students. They check enrollment, payment verification, receipt idempotency, reminder privacy, credential eligibility, public sharing, design validation, discount and referral rules, CV privacy, notification ownership, module assignments, AI draft review and mocked Microsoft permission boundaries. AI tests mock provider responses; a live generation must be verified after the account has Gateway access and credits. Real Microsoft consent and delivery must be checked after connecting the owner's account.

### Bring over existing records

Use a reviewed legacy JSON backup on the server. Run the import against the same `PBS_DATA_DIR` as the portal.

```sh
npm run migrate:legacy -- --file /private/path/pbs_central_db.json
```

The importer carries over courses, valid lesson links, real student records and enrollment statuses. It skips recognized demo entries and creates receipts for approved applications with a verified payment reference. Review historical balances against your payment records. Set a new temporary password for imported students from their admin record.

The interface was refined with [Unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky. The Instrument font licenses are included in `src/assets`.

### Documents and the institution stamp

Receipts, fee statements and bonafide letters export as vector A4 PDFs; student IDs use A5 landscape, and certificates use A4 landscape. Download and Print build the same physical page layout independently of browser width, device pixel density and zoom. Long fee histories paginate automatically. Existing receipt snapshots and certificate records are preserved.

In **Certificates → Institution stamp**, edit the institution, center text, caption, office, seal colors and round/square style, or upload a PNG/JPEG stamp below 100 KB. The stamp appears on every newly downloaded document and each statement page. Admin changes are revision checked and audited. Disable the stamp or return to the generated seal without changing any account credentials.

### Referral rewards and the student wallet

**Refer & earn** creates a stable personal referral code and a complete invitation for copying, native sharing or WhatsApp. A new learner enters the code during the first application; referral attribution is preserved even when a better public discount applies. Self-referrals and matching contact numbers are rejected. Existing enrollments are not backfilled with invented referral records.

The default reward is **INR 1,000 of PBS course credit**, with a **seven-day waiting period** after enrollment approval and verified full payment of all approved course fees by both learners. The default minimum referred course fee is INR 1,000. Admins edit the reward, minimum fee, new-learner discount, payment requirements, waiting period and automatic-credit switch in **Offers & referrals**. New referrals capture those terms; later edits do not rewrite existing applications. Account inactivity or incomplete fee payments hold eligibility. Eligibility is checked again before a reward is credited.

The dashboard displays each application’s steps, waiting-period end, credited total and reward ledger. Admins see the referral leaderboard and can credit an eligible reward when automatic credit is off. Credits are unique per referral. Students can use wallet credit for an approved course balance; the debit and payment receipt are committed together, with an idempotent request key and checks against overspending. Wallet credit is not a cash payout or bank transfer.

### Email templates, campaigns and automatic messages

**Email campaigns** includes editable templates for welcome, login instructions, the portal guide, payment reminders, certificate congratulations, referral-credit confirmations, offers, updates and custom messages. All email sent through the Microsoft integration uses the academy’s current name and blue/gold branding. Text and personalization are escaped before HTML generation. Existing temporary access emails remain private and are not saved in the campaign queue.

Create a campaign for active enrolled students, selected students, or opted-in external contacts. The draft snapshots recipients and supports a sandboxed HTML preview. Sending requires an administrator’s connected Microsoft account with Mail.Send permission. Each click processes up to ten queued messages; the daily job processes up to twenty. Larger campaigns can be continued manually. Marketing requires consent confirmation, includes an unsubscribe link and respects saved opt-outs. Cancel stops pending messages, while already accepted or in-flight messages remain in the delivery record.

The log distinguishes pending, sending, Microsoft-accepted, confirmed failure, uncertain and skipped states. Provider acceptance does not guarantee inbox delivery. Only confirmed failures may be retried; uncertain messages require checking Sent Items to avoid duplicate email. Automatic welcome, earned-certificate and credited-referral messages are queued once for future events when an enabled connected sender is available. No historical events are bulk mailed on upgrade.

Configure a new private **CRON_SECRET** on the host for the protected `/api/jobs/academy` job. Vercel runs it daily at **03:30 UTC / 9:00 AM India time** and supplies the Bearer secret. It reconciles mature referral rewards and sends a limited email batch. Requests without the secret are rejected. On other hosts, schedule the same authenticated endpoint. Dashboard refreshes also check referral maturity; email can be processed manually from the admin mail center. Never put the secret in browser code or a public URL.


### Approval, access sharing and learner feedback

- New public applicants enter their details and payment reference without creating a password or receiving a signed-in session. The confirmation shows a private application code for **Check enrollment**. Admin approval activates first-time access, creates a temporary password and requires a password change at first sign-in. Existing approved students may apply for more courses from their workspace. Existing pending public applicants are gated once during migration; approved learners retain access.
- **Enrollments → Approve** and **Enroll a student** offer email delivery through the administrator’s connected Microsoft account. Configure and connect that account in **OneDrive & email**; Mail.Send consent is required. A failed or unconfigured delivery does not undo approval. The access dialog reports the actual delivery state and allows an email draft, WhatsApp draft and copying all details. Provider acceptance is not a guarantee of inbox delivery.
- **Students → Open record → Share access** prepares the registered email, saved WhatsApp number, sign-in URL, course summaries, verified payment totals, pending fees, receipt references and document links. Temporary passwords appear only when generated; permanent passwords cannot be retrieved or emailed. Delivery records store status and a digest, never the password or message body. Duplicate request IDs do not send duplicate emails. Uncertain delivery must be checked in Microsoft Sent Items.
- WhatsApp uses [official click-to-chat links](https://faq.whatsapp.com/5913398998672934). It opens the student’s saved number and a prepared message; the administrator presses Send in WhatsApp. It does not claim automatic WhatsApp Business API delivery. Ten-digit local numbers default to India’s +91; save international numbers with a country code.
- The certificate PDF has three blue-and-gold designs, a verification QR when public sharing is enabled, and vector text suitable for printing. The certificate studio continues to control issuer, signatory, colors and per-course design. Receipts snapshot the fee, paid total, balance and due date at issue. Current fee statements include later payments and paginate long payment histories. Bonafide letters confirm actual approved enrollment and include the reference and support contact.
- Students submit course and website feedback from **Course feedback** after completing lessons and passing the assessment or earning a valid certificate. Their name and completion date come from records. A photo, qualification, ratings and reported placement information are required; placement company is required when a placement is reported. The browser resizes photos and removes image metadata.
- **Student feedback** gives admins a private review queue, replies and publication controls. Publishing requires student permission and the administrator’s verification. Edits return to review; withdrawing permission removes the public review immediately. Website comments, emails and phone numbers are excluded from public reviews. Replies on a published course review are public.
- Public course counts include approved enrollments only and refresh every minute while the page is visible. The starting **25 historical learners reported by PBS** is displayed separately from live approved learners and can be corrected in **Student feedback → Community & placement information**. This baseline does not create student accounts or payment records. Placement-assistance copy is editable in the same panel and does not imply a job guarantee.
- `npm test` includes isolated admission, delivery deduplication, review consent/moderation, financial snapshot and legacy-gate checks. Tests use temporary databases and mocked email delivery; they never seed production students, reviews or sessions.
