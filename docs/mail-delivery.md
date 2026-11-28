# PBS email delivery and record deletion

## Administrator controls

Email campaigns → **Delete history** previews the campaign’s recipient and delivery counts. Enter `DELETE CAMPAIGN` and the current administrator password to remove the campaign, recipient snapshots, pending messages and delivery history from the active PBS database. A campaign cannot be deleted while a message is sending. Existing contact preferences and unsubscribes remain effective. Messages already sent remain in the sender’s and recipients’ mailboxes; provider backups follow the provider’s retention settings.

Students → open a student → **Delete student permanently** previews linked enrollments, receipts, credentials and learning records. Enter the student’s email, `DELETE STUDENT` and the current administrator password. PBS removes that student’s login, payment history, course enrollments, learning activity, assignments, attendance, messages, feedback, referral details, bank details, devices and credentials. Other students’ payment records, earned wallet balances, shared courses and institution settings are preserved. Pending referral payouts and currently sending emails block deletion until resolved. **Archive student** remains available for recoverable account removal that retains payment history.

For a narrower correction, **Payments & receipts → select the exact enrollment rows → Remove selected enrollments** reviews up to 25 records. Enter `REMOVE ENROLLMENTS` and the current administrator password to remove only those enrollments and their receipts, fee balances, payment claims, offer snapshots, reminders, follow-up notes and batch/access mappings. Student accounts, password hashes, account statuses, saved learning progress, already-issued certificates, other enrollments and shared course files remain unchanged. Portal course access ends and known individual OneDrive grants are queued for revocation. This does not refund or reverse any bank transfer. Wallet-funded payments, credited referral rewards, active sending and in-flight access grants block the removal until reconciled. All selected database records are removed in one transaction; changed reviews must be refreshed.

Private CV files, known OneDrive assignment/original-certificate files and individual folder permission grants are removed through a durable cleanup queue. Storage failures do not restore the student account; retries run with academy jobs or **Data reset → Retry file cleanup**. Shared course folders and lesson files are retained. This is active-record deletion, not a request to erase independent mailboxes, bank transfers or historical provider backups.

Campaigns with no remaining pending messages show **Completed** or **Attention** rather than staying Queued. **Accepted** means Microsoft accepted the request, not that a recipient received it in their inbox. Uncertain sends require checking Microsoft Sent Items and message trace before another send.

## Public DNS findings — 28 November 2026

A read-only DNS check of `pragmaticbim.com` found:

| Check | Published result |
| --- | --- |
| DNS host | `ns09.domaincontrol.com`, `ns10.domaincontrol.com` — GoDaddy |
| SPF | `v=spf1 include:secureserver.net -all` |
| DMARC | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` |
| Microsoft DKIM CNAMEs | `selector1._domainkey` and `selector2._domainkey` were not found |
| MX | Priority 0 `smtp.secureserver.net`; priority 10 `mailstore1.secureserver.net` |

The SPF record is a documented GoDaddy value, including for Microsoft 365 bought through GoDaddy. Its existence does not prove that an individual message passed SPF. The MX records point to GoDaddy mail servers; compare them with the actual mailbox product’s setup before changing routing. Missing Microsoft selectors do not rule out other providers signing with other selectors. No received-message headers or private Microsoft tenant configuration were available for this check, so the cause of any particular spam placement is not confirmed.

## Complete the mailbox-side setup

1. In PBS **OneDrive & email**, select the intended company Microsoft 365 mailing account. Storage and mailing connections can be separate. Campaign MIME uses the authenticated mailbox’s actual From address.
2. In the Microsoft Defender portal, select `pragmaticbim.com` under DKIM, create the keys if necessary and copy both exact CNAME hostnames and target values. They are tenant-specific; do not invent them.
3. Add those two CNAME records at GoDaddy, allow DNS propagation, then enable DKIM signing for the custom domain in Microsoft. If GoDaddy Advanced Email Security is enabled, also follow that product’s additional DKIM instructions.
4. Keep exactly one SPF record. Follow the actual mailbox provider’s value: GoDaddy commonly uses `include:secureserver.net`; direct Microsoft 365 commonly uses `include:spf.protection.outlook.com`. Merge any other legitimate senders into the existing record instead of adding a second SPF record. Keep the existing DMARC quarantine policy and reporting addresses while fixing authentication alignment.
5. In **Email campaigns → Email delivery & spam checks**, run **Check sending-domain authentication**. The check only reads public DNS and never sends an email.
6. With a deliberately requested test message, use Gmail **Show original** to confirm `spf=pass`, `dkim=pass` and `dmarc=pass`, including alignment with the visible From domain. Review Microsoft message trace for rejections, delays and filtering. DNS publication alone cannot prove that signing is enabled or that a message reached the inbox.
7. Send expected, relevant mail to opted-in recipients. Start with small batches, remove invalid addresses, honour unsubscribes, avoid misleading subjects and monitor complaints. Offer campaigns now include plain-text and HTML alternatives plus standard one-click unsubscribe headers. A student can mark a legitimate PBS message **Not spam** and add the sender to contacts; this helps their own mailbox and is not an inbox guarantee for everyone.

For local/public DNS diagnostics, `npm run mail:check-domain -- pragmaticbim.com` prints only public records. Resolver failures are reported as unavailable, not incorrectly as missing records.

Official references:

- [Microsoft Graph sendMail response and MIME format](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)
- [Microsoft custom-domain DKIM](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure)
- [GoDaddy Microsoft 365 DKIM setup](https://www.godaddy.com/help/enable-and-add-dkim-to-my-domain-for-microsoft-365-41748)
- [GoDaddy SPF values](https://www.godaddy.com/help/add-an-spf-record-to-my-domain-for-my-email-40499)
- [Gmail sender guidelines](https://support.google.com/mail/answer/81126?hl=en)
