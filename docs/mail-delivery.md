# PBS email delivery and record deletion

## Administrator controls

Email campaigns → **Delete history** previews the campaign’s recipient and delivery counts. Enter `DELETE CAMPAIGN` and the current administrator password to remove the campaign, recipient snapshots, pending messages and delivery history from the active PBS database. A campaign cannot be deleted while a message is sending. Existing contact preferences and unsubscribes remain effective. Messages already sent remain in the sender’s and recipients’ mailboxes; provider backups follow the provider’s retention settings.

Students → open a student → **Delete student permanently** previews linked enrollments, receipts, credentials and learning records. Enter the student’s email, `DELETE STUDENT` and the current administrator password. PBS removes that student’s login, payment history, course enrollments, learning activity, assignments, attendance, messages, feedback, referral details, bank details, devices and credentials. Other students’ payment records, earned wallet balances, shared courses and institution settings are preserved. Pending referral payouts and currently sending emails block deletion until resolved. **Archive student** remains available for recoverable account removal that retains payment history.

For a narrower correction, **Payments & receipts → select the exact enrollment rows → Remove selected enrollments** reviews up to 25 records. Enter `REMOVE ENROLLMENTS` and the current administrator password to remove only those enrollments and their receipts, fee balances, payment claims, offer snapshots, reminders, follow-up notes and batch/access mappings. Student accounts, password hashes, account statuses, saved learning progress, already-issued certificates, other enrollments and shared course files remain unchanged. Portal course access ends and known individual OneDrive grants are queued for revocation. This does not refund or reverse any bank transfer. Wallet-funded payments, credited referral rewards, active sending and in-flight access grants block the removal until reconciled. All selected database records are removed in one transaction; changed reviews must be refreshed.

Private CV files, known OneDrive assignment/original-certificate files and individual folder permission grants are removed through a durable cleanup queue. Storage failures do not restore the student account; retries run with academy jobs or **Data reset → Retry file cleanup**. Shared course folders and lesson files are retained. This is active-record deletion, not a request to erase independent mailboxes, bank transfers or historical provider backups.

Campaigns with no remaining pending messages show **Completed** or **Attention** rather than staying Queued. **Accepted** means the selected mail provider accepted the request, not that a recipient received it in their inbox. Uncertain sends require checking with the provider or recipient before another send. SMTP sends may not create a Sent Items copy.

## Company mailbox — GoDaddy Professional Email / Titan

The administrator confirmed that `info@pragmaticbim.com` uses GoDaddy Professional Email / Titan. An external Entra identity (`#EXT#`) does not establish an Exchange Online mailbox. The OneDrive storage account remains independent.

In **Email campaigns → Company mailing provider** or **OneDrive & email → Company mailing provider**, choose **Connect Titan SMTP**. Enter the company mailbox email and its Titan password privately in the admin form, then confirm with the current PBS administrator password. **Verify & use Titan for PBS mail** authenticates without sending a message and selects Titan as the company sender. Existing automation flags, templates, Microsoft connections, OneDrive connections, students, courses and PBS password hashes remain intact. The encrypted SMTP password is never returned by an API or recorded in delivery/audit logs. Blank password keeps the saved password only when the email is unchanged. Stale setup revisions are rejected.

The endpoint is fixed to **smtpout.secureserver.net:465**, SSL/TLS with certificate verification. PBS does not accept arbitrary SMTP hostnames. Passwords are encrypted with the existing integration key; do not replace that key or retrieve credentials through chat. Microsoft 365 stays available for actual Exchange Online mailboxes. Removing the selected Titan connection pauses sending rather than silently switching providers. Saving a connection does not process existing queued messages.

All campaign, automatic course, access-details, payment-reminder and certificate-PDF sends use the selected provider. Titan messages contain themed HTML and a plain-text alternative. Promotional messages retain one-click unsubscribe headers; certificate attachments use the same PDF bytes as downloads. Each email has one recipient. Authentication checks do not establish that a particular From address will be accepted or that an email will reach the inbox. Provider rejections are shown as failed; interrupted delivery is uncertain and never automatically resent. Raw SMTP responses are not exposed. Sending is time-bounded; remaining queued messages can be processed in another batch.

## Check the DNS setup supplied by GoDaddy

The supplied domain-specific setup is:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | email | email.secureserver.net |
| CNAME | secureserver1._domainkey | s1.dkim.pragmaticbim_com.5d5.onsecureserver.net. |
| CNAME | secureserver2._domainkey | s2.dkim.pragmaticbim_com.5d5.onsecureserver.net. |
| MX | @ | priority 0 smtp.secureserver.net |
| MX | @ | priority 10 mailstore1.secureserver.net |
| TXT | @ | T6462247 |
| TXT | @ | v=spf1 include:secureserver.net -all |
| SRV | _autodiscover._tcp | priority 100, weight 1, port 443, target autodiscover.secureserver.net |

The user’s earlier screenshots already matched the CNAME, MX and SPF records. They did not show `T6462247`, and SRV showed priority 0 / weight 0. Check current DNS before changing either. Keep the website A/CNAME records. Maintain exactly one SPF record; the separate verification TXT is allowed.

The existing screenshot DMARC policy was `p=quarantine`. GoDaddy’s proposed final policy is `v=DMARC1; p=reject; rua=mailto:dmarc_rua@onsecureserver.net; adkim=r; aspf=r;`. Preserve the existing policy while verifying legitimate outgoing mail, then move to reject after confirming that the legitimate senders pass alignment. No DNS changes are made by this source update.

## Verify a received message

1. Complete GoDaddy’s **Email & Office → Set mail destination** checks and click **Done**. DNS updates commonly appear within an hour but can take up to 48 hours.
2. In PBS, connect the Titan company mailbox and run **Check mailing connection**. This authenticates only, without sending an email.
3. Run **Check sending-domain authentication**. Titan uses `secureserver1` / `secureserver2`, while Microsoft 365 uses `selector1` / `selector2`. Published DKIM CNAMEs are reported for review, not as proof that signing is active. Resolver failures are unavailable rather than missing.
4. With an explicitly requested test message, use Gmail **More → Show original** to check SPF, DKIM and DMARC. At least one passing SPF or DKIM domain must align with the visible From domain for DMARC to pass. DNS publication and provider acceptance cannot confirm inbox placement.
5. Send expected mail to opted-in recipients, start with small batches, remove invalid addresses and honour unsubscribes. Follow Titan’s sending limits and provider terms. Recipients may mark legitimate PBS messages **Not spam**; this does not guarantee inbox placement for everyone.

For local/public DNS diagnostics, `npm run mail:check-domain -- pragmaticbim.com` prints only public records. Resolver failures are reported as unavailable, not incorrectly as missing records.

Official references:

- [Microsoft Graph sendMail response and MIME format](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)
- [Microsoft custom-domain DKIM](https://learn.microsoft.com/en-us/defender-office-365/email-authentication-dkim-configure)
- [GoDaddy / Titan SMTP settings](https://www.godaddy.com/help/set-up-third-party-plugins-or-websites-using-smtp-settings-42788)
- [GoDaddy / Titan DNS authentication](https://www.godaddy.com/help/add-spf-dkim-and-dmarc-to-my-domain-for-professional-email-powered-by-titan-42437)
- [GoDaddy SPF values](https://www.godaddy.com/help/add-an-spf-record-to-my-domain-for-my-email-40499)
- [Gmail sender guidelines](https://support.google.com/mail/answer/81126?hl=en)
