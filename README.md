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

In **Courses & videos**, select **Add video** and choose a module. Upload an MP4 or WebM file, or use an HTTPS video link. Use **Edit lesson** under **Curriculum and materials** to replace an unavailable video. Uploaded files are served to authorized enrolled accounts. YouTube, Google Drive, Vimeo and provider-supplied OneDrive or SharePoint embed links can play in the classroom when the provider allows embedding. The native student player hides download and remote playback controls. Provider links retain the provider's permissions and controls. Browser playback cannot prevent all copying or screen recording.

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

- **Student application.** Open **Explore courses**, choose a published course and submit the application. The student uses the account they create to track the decision. Their application code is also available under **My courses**.
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
3. In **Environment Variables**, set `PBS_BOOTSTRAP_ADMIN_EMAIL` and a private `PBS_BOOTSTRAP_ADMIN_PASSWORD` for the first online administrator. A fresh cloud database has its own accounts and records. Sign in as **Administrator**, replace the temporary password, then remove the bootstrap variables. For a fixed production domain, set `PBS_PUBLIC_ORIGIN` to its HTTPS origin in the Production environment.
4. Redeploy the branch after configuring storage and environment variables. Verify that `/api/health` returns `{"status":"ok"}` on the deployment, then sign in and test a lesson upload before assigning the production domain.

The hosted app sends file uploads directly to private Blob storage. The PBS API verifies the file before attaching it to a lesson and checks enrollment before issuing a playback link.

## OneDrive course access and email

1. Generate a server encryption key once with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and save it as the private `PBS_INTEGRATION_KEY` environment variable. Keep the value stable and backed up privately. This key encrypts application secrets and Microsoft token caches in the database. It is already configured for the connected PBS production project.
2. Register a **Web** application in [Microsoft Entra](https://entra.microsoft.com/). Choose the account types that match the Microsoft account owning the course files. Copy the exact redirect URL shown in **OneDrive & email** into the app registration. For PBS production this is `https://pbs.bimaihub.com/api/integrations/microsoft/callback`.
3. Add delegated Microsoft Graph permissions **User.Read**, **Files.ReadWrite** and **Mail.Send**. Microsoft handles consent and refresh tokens through MSAL. Your organization's administrator may need to approve these permissions.
4. In **OneDrive & email → Configure app**, enter the application ID, tenant (or `common` for an app supporting multiple account types), and client secret **value**, then confirm with your PBS admin password. Secret values never return to the browser. Click **Connect Microsoft** and complete Microsoft's account selection and consent.
5. Choose **Link a course folder**, browse the connected OneDrive, select the folder or video, and assign it to a PBS course. Enable automatic invitations to grant read access after an admin approves enrollment or enrolls a student directly. Existing students can be invited with **Grant OneDrive access** in the payment ledger, student record or integrations page. Failed invitations are recorded for retry; they do not undo enrollment or verified payment.

Invitations require the student's registered email to sign in. Successfully shared course folders also appear in the student's **My courses** page. Folder permissions apply to the contents. Microsoft read access may permit downloads; apply the appropriate Microsoft 365 download restrictions in the provider. Private PBS uploads use enrollment-protected playback and hide download controls. These controls do not provide DRM or prevent screen recording. Disconnecting Microsoft stops future invitations and email actions while preserving existing Microsoft permissions. Manage and remove those permissions in OneDrive when needed.

## Certificates and portfolios

**Certificates** in the admin workspace provides architectural, classic and minimal designs, editable colors, titles, issuer and signatory details, and a live preview. Save one default design or a course-specific override. Recipient name, course title, issuance date and credential ID come from real course completion. Design updates apply to later downloads of issued records. Admins can revoke an issued credential with a recorded reason.

Students unlock **My certificates** after completing every lesson and passing the published course assessment. Claiming a certificate creates one permanent record per student/course. Students can download a landscape PDF and optionally enable public verification, which includes a verification QR in newly downloaded PDFs. Public verification is private by default. When enabled, it shows the recipient name, course, issuer and credential status without email or payment details. LinkedIn sharing opens a composer, and **Add credential** opens LinkedIn's certification form for the student to review.

**My portfolio** lets students edit a headline, project summary, project URL, LinkedIn, GitHub and website links. Publishing is optional. Students can copy the public portfolio link or share it to LinkedIn. Fee records, internal notes and contact information do not appear on the public page.

## Verify changes

```sh
npm run lint
npm test
npm run build
```

The tests create and delete an isolated temporary SQLite database, override remote connection settings, and never seed production students. They check enrollment, payment verification, receipt idempotency, reminder privacy, credential eligibility, public sharing, design validation and mocked Microsoft permission boundaries. Real Microsoft consent and delivery must be checked after connecting the owner's account.

### Bring over existing records

Use a reviewed legacy JSON backup on the server. Run the import against the same `PBS_DATA_DIR` as the portal.

```sh
npm run migrate:legacy -- --file /private/path/pbs_central_db.json
```

The importer carries over courses, valid lesson links, real student records and enrollment statuses. It skips recognized demo entries and creates receipts for approved applications with a verified payment reference. Review historical balances against your payment records. Set a new temporary password for imported students from their admin record.

The interface was refined with [Unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky. The Instrument font licenses are included in `src/assets`.
