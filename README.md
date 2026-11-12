# Pragmatic BIM Solution

PBS is a BIM learning portal for students and administrators. Both workspaces use the same visual system, including the classroom, enrollment forms and downloadable student documents.

## Start PBS

Use Node.js 22.13 or later. Install dependencies and create your administrator from a trusted terminal.

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

In **Courses & videos**, select **Add video** and choose a module. Upload an MP4 or WebM file, or use an HTTPS video link. Use **Edit lesson** under **Curriculum and materials** to replace an unavailable video. Uploaded files are served from the PBS data volume to authorized accounts. YouTube, Google Drive, Vimeo and provider-supplied OneDrive or SharePoint embed links can play in the classroom when the provider allows embedding. Students can open the source link when the provider requires sign-in.

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
- **Payment review.** Set `PBS_PAYMENT_UPI_ID` and `PBS_PAYMENT_NAME` to the verified PBS payment destination. Students can submit the bank UTR after paying. In **Enrollments**, review an application and record a verified initial payment. In **Payments & receipts**, review later references or record payments received through other methods.
- **Receipt download.** Recording a payment creates a numbered receipt and updates the balance. Admins and the enrolled student can print or download the receipt as a PDF. The student ID and bonafide letter use the student's enrollment records.

## Run on a live host

```sh
npm run lint
npm run build
npm start
```

Run the Express server on a Node host with HTTPS and a persistent writable volume. Set `PBS_DATA_DIR` to that volume, outside the web root, and set `PBS_PUBLIC_ORIGIN` to the public HTTPS URL. Use `PBS_TRUST_PROXY=1` when there is exactly one trusted reverse proxy in front of the server. The default host is loopback. Set `PBS_HOST=0.0.0.0` when your hosting platform requires a network bind.

The volume holds the SQLite database and uploaded videos. Back up the volume using the host's snapshot mechanism or stop the server before copying it. **Export records** in the admin menu produces a readable JSON report.

### Bring over existing records

Use a reviewed legacy JSON backup on the server. Run the import against the same `PBS_DATA_DIR` as the portal.

```sh
npm run migrate:legacy -- --file /private/path/pbs_central_db.json
```

The importer carries over courses, valid lesson links, real student records and enrollment statuses. It skips recognized demo entries and creates receipts for approved applications with a verified payment reference. Review historical balances against your payment records. Set a new temporary password for imported students from their admin record.

The interface was refined with [Unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky. The Instrument font licenses are included in `src/assets`.
