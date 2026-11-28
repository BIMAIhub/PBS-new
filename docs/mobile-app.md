# PBS mobile app

PBS can be installed from **https://student.pragmaticbim.com/app** on Android, iPhone, iPad and supported desktop browsers. It is a Progressive Web App (PWA), using the complete existing portal and live database. This release does not publish an App Store or Google Play listing, APK or IPA.

## Install and enable alerts

- **Android:** open the link in Chrome and choose **Install PBS app**, or the browser menu → **Install app / Add to Home screen**.
- **iPhone / iPad:** open the link in Safari → **Share → Add to Home Screen → Add**. Open the new PBS icon. iOS/iPadOS 16.4 or later is required for push notifications.
- Sign in with the existing student or administrator account. Students still need enrollment approval and only access their own courses.
- Open **PBS app & alerts** in the workspace. Tap **Enable phone notifications** and allow notifications on the device. Permission is requested only after this button is tapped.
- Use **Send test to this device** to check your own phone. Provider acceptance is recorded; this does not prove the phone displayed an alert or the recipient read it. Focus modes, OS settings and connectivity can delay display.

Alerts include existing portal messages, live-session changes and openings, enrollment/payment updates, assignments, reviews, notices, referrals and certificate readiness. Newly available course videos also create alerts, following the existing module release rules. The admin notification inbox receives enrollment, payment and student-submission updates.

Message previews are off by default. People can enable previews, disable alerts on their own devices, or remove old devices. **Signing out, a password reset, account deactivation or session expiry stops further delivery.** “Keep me signed in” retains the existing seven-day sign-in policy; otherwise the existing session is twelve hours. After expiry, sign in and enable alerts again. No password policy or existing account setting is changed by installing the app.

## Background delivery and scheduled events

Successful portal changes trigger notification synchronization and Web Push processing after the response using Vercel `waitUntil`. The recipient does not need to keep the website open. The regular notification inbox also triggers checks. A durable database queue uses atomic delivery leases, encrypted subscriptions, bounded attempts, retry backoff, and removal of expired push-provider subscriptions. Provider failures never expose private subscription URLs or encryption keys in admin diagnostics.

The existing daily `/api/jobs/academy` job also processes push notifications. **A daily check alone cannot send reminders at the exact time a live session opens or a scheduled module unlocks while everybody is offline.** For checks every 1–5 minutes, configure a trusted server scheduler to call:

```http
GET https://student.pragmaticbim.com/api/jobs/push
Authorization: Bearer <the existing CRON_SECRET server value>
```

Do not put a secret in a URL, client bundle, source control or student message. This endpoint rejects missing/incorrect authorization. Use an existing service supporting the frequency; the deployment retains its existing daily Vercel cron and does not upgrade the hosting plan or add a paid scheduler. The local Node server checks once per minute while it is running.

**Admin → PBS app & alerts → Notification delivery** shows connected devices, accepted/pending/failed delivery counts, sanitized failures and the last check. Dispatch rotates through up to 50 subscribed accounts and 30 queued deliveries per invocation, within a time budget. Frequent scheduled checks are needed for a large queue and for automatic retries when no one uses the portal. Sent/failed/skipped delivery logs expire after 30 days; the existing notification inbox is retained. An interrupted send can be retried; notification tags coalesce the same alert on a device, rather than claiming exactly-once provider delivery.

VAPID application keys are generated once and stored encrypted in the **current database** using the already configured `PBS_INTEGRATION_KEY`. The private key and device endpoints never go to the browser API or logs. If server encryption is not configured, the portal continues to work and displays that phone notifications need setup. Do not reset the integration key or database to configure push.

## App behavior

- Student and admin tools, the video player, progress, enrollment, uploads, payments and documents remain the existing website functions.
- Navigation from a phone notification reuses the open portal, avoiding an unnecessary page reload during an upload. Page names are validated; push links cannot redirect to an external provider or website.
- A public reconnect screen is available offline. APIs, videos, documents and private account data are **never** put in the service worker cache. Protected videos still require connectivity and the existing account permissions.
- Updates are offered with an **Update app / Later** notice. Finish uploads and save forms before accepting. The service worker does not force a reload mid-task.
- The mobile layout accounts for phone safe areas. Notification permission and Home Screen installation must be completed by the device owner.

## Validation

`npm test`, `npm run lint`, and `npm run build` include isolated mobile tests for encryption, recipient isolation, VAPID/encrypted request generation, duplicate workers, provider backoff, permission/role checks, session/account revocation, video release rules, offline caching and notification navigation. No real students or phone subscriptions are created by tests. A real Android/iPhone installation and delivery check still needs the device owner's opt-in and the built-in test button.
