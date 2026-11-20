import { useState } from 'react';
import { ArrowDownToLine, ArrowRight, Bell, CalendarDays, Check, Cloud, CreditCard, IndianRupee, Search, Settings, ShieldCheck, Users } from 'lucide-react';
import { send, messageFrom } from './api';
import type { AdminWorkspaceData, Enrollment } from './types';
import type { AdminAcademyData, EnrollmentDetail } from './academy-types';
import { Button, dateLabel, dateTimeLabel, DialogForm, Empty, Field, FormError, Input, money, Panel, PasswordInput, Status, value } from './ui';

type EnrollmentAction = (kind: 'review' | 'payment' | 'reject-payment', enrollment: Enrollment) => void;
const balance = (item: Enrollment) => Math.max(0, item.total - item.paid);

export function AdminOverview({ data, academy, navigate, onEnroll }: {
  data: AdminWorkspaceData; academy?: AdminAcademyData; navigate: (page: 'students' | 'enrollments' | 'payments' | 'certificates' | 'integrations') => void; onEnroll: () => void;
}) {
  const active = data.enrollments.filter(item => item.status === 'approved');
  const pending = data.enrollments.filter(item => item.status === 'pending').length;
  const reported = data.enrollments.filter(item => item.requestedPayment).length;
  const total = active.reduce((sum, item) => sum + item.total, 0);
  const paid = data.receipts.reduce((sum, item) => sum + item.amount, 0);
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - 5 + index);
    const key = date.toISOString().slice(0, 7);
    return { label: date.toLocaleDateString('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' }),
      amount: data.receipts.filter(receipt => receipt.issuedAt.startsWith(key)).reduce((sum, item) => sum + item.amount, 0) };
  });
  const max = Math.max(...months.map(item => item.amount), 1);
  return <div className="pbs-live-stack">
    <section className="pbs-academy-welcome">
      <div><p className="pbs-eyebrow">PBS academy · Administration</p><h2>A clear view of your academy.</h2><p>Manage learning, follow up on fees, and keep every student moving forward.</p>
        <div className="pbs-actions"><Button onClick={onEnroll}><Users size={17} /> Enroll a student</Button><Button quiet onClick={() => navigate('enrollments')}>Review applications <ArrowRight size={17} /></Button></div>
      </div><div className="pbs-academy-emblem" aria-hidden="true"><img src="/pbs-logo.svg" width="100" height="100" /><span>PRAGMATIC BIM SOLUTION</span></div>
    </section>
    <dl className="pbs-learning-stats pbs-academy-stats">
      <div><dt><Users /> Active students</dt><dd>{new Set(active.map(item => item.studentId)).size}</dd><small>Across {data.courses.length} courses</small></div>
      <div><dt><IndianRupee /> Verified collections</dt><dd>{money(paid)}</dd><small>{data.receipts.length} payment receipts</small></div>
      <div><dt><CreditCard /> Outstanding fees</dt><dd>{money(active.reduce((sum, item) => sum + balance(item), 0))}</dd><small>{active.filter(item => balance(item) > 0).length} enrollments with a balance</small></div>
      <div><dt><ShieldCheck /> Certificates earned</dt><dd>{academy?.certificates.filter(item => !item.revokedAt).length || 0}</dd><small>Verified course completions</small></div>
    </dl>
    <div className="pbs-academy-grid">
      <Panel title="Fee collection" action={<span className="pbs-muted">Last 6 months</span>}>
        <div className="pbs-collection-total"><strong>{money(paid)}</strong><span className="pbs-muted">Verified payments received</span></div>
        <div className="pbs-bar-chart" aria-label="Monthly verified fee collection">
          {months.map((month, index) => <div key={index}><small>{money(month.amount)}</small><div className="pbs-bar-track"><span style={{ height: `${Math.max(1, month.amount / max * 100)}%`, animationDelay: `${index * 45}ms` }} /></div><span>{month.label}</span></div>)}
        </div>
        <div className="pbs-collection-progress"><div><span>Approved course fees collected</span><strong>{total ? Math.round(paid / total * 100) : 0}%</strong></div><progress max={Math.max(total, 1)} value={paid} /></div>
      </Panel>
      <Panel title="Needs your attention">
        <button className="pbs-action-row" onClick={() => navigate('enrollments')}><span className="pbs-row-icon"><Users /></span><span><strong>Enrollment applications</strong><small>{pending} awaiting your decision</small></span><ArrowRight /></button>
        <button className="pbs-action-row" onClick={() => navigate('payments')}><span className="pbs-row-icon"><CreditCard /></span><span><strong>Payment references</strong><small>{reported} awaiting verification</small></span><ArrowRight /></button>
        <button className="pbs-action-row" onClick={() => navigate('integrations')}><span className="pbs-row-icon"><Cloud /></span><span><strong>Course access</strong><small>{academy?.grants.filter(item => item.status === 'failed').length || 0} invitations need attention</small></span><ArrowRight /></button>
        <div className="pbs-inset pbs-gold-inset"><ShieldCheck size={19} /><p>Receipts count only verified payments. Submitted references stay in your review queue.</p></div>
      </Panel>
    </div>
    {academy && <ActivityLog events={academy.events.slice(0, 5)} compact />}
  </div>;
}

export function GrantAccessButton({ enrollment, onSaved }: { enrollment: Enrollment; onSaved: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  return <div className="pbs-access-action"><Button quiet disabled={busy} onClick={async () => {
    setBusy(true); setNotice('');
    try {
      const result = await send<{ status: string; error?: string }>(`/admin/enrollments/${enrollment.id}/access`);
      setNotice(result.status === 'granted' ? `Access granted to ${enrollment.email}` : result.error || 'Access needs attention.');
      await onSaved();
    } catch (error) { setNotice(messageFrom(error)); } finally { setBusy(false); }
  }}><Cloud size={16} /> {busy ? 'Granting access…' : 'Grant OneDrive access'}</Button>{notice && <small role="status">{notice}</small>}</div>;
}

export function PaymentLedger({ data, academy, open, onSaved }: {
  data: AdminWorkspaceData; academy: AdminAcademyData; open: EnrollmentAction; onSaved: () => Promise<unknown>;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [dialog, setDialog] = useState<{ kind: 'reminder' | 'followup'; enrollment: Enrollment } | { kind: 'settings' }>();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const records = data.enrollments.filter(item => {
    const detail = academy.details.find(row => row.enrollmentId === item.id);
    return `${item.studentName} ${item.email} ${item.courseTitle}`.toLowerCase().includes(query.toLowerCase()) &&
      (filter === 'all' || filter === 'review' && item.requestedPayment > 0 || filter === 'due' && item.status === 'approved' && balance(item) > 0 ||
       filter === 'paid' && item.status === 'approved' && balance(item) === 0 || filter === 'overdue' && item.status === 'approved' && balance(item) > 0 && detail?.dueDate && detail.dueDate < today);
  });
  return <div className="pbs-live-stack">
    <Panel title="Payment destination" action={<Button quiet onClick={() => setDialog({ kind: 'settings' })}><Settings size={16} /> Payment settings</Button>}>
      <div className="pbs-section-top"><div><strong>{academy.payment.paymentName}</strong><p className="pbs-muted">{academy.payment.paymentUpiId || 'Add your UPI ID to enable student payments.'}</p></div><Status value={academy.payment.paymentUpiId ? 'Payments enabled' : 'Setup needed'} /></div>
    </Panel>
    <Panel title="Enrollment & payment ledger" action={<a className="pbs-button pbs-button-outline" href="/api/admin/payment-ledger.csv"><ArrowDownToLine size={16} /> Export CSV</a>}>
      <div className="pbs-ledger-filters"><label className="pbs-live-search"><Search size={17} /><input type="search" aria-label="Search payment ledger" placeholder="Find a student, email or course" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <Field label="Payment status"><select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All records</option><option value="review">Reference to verify</option><option value="due">Balance due</option><option value="overdue">Past due date</option><option value="paid">Fully paid</option></select></Field></div>
      <p className="pbs-muted">{records.length} records · Amounts in INR · Verified payments only</p>
      {!records.length && <Empty title="No matching payment records">Applications and admin enrollments appear here with their complete fee history.</Empty>}
      {records.map(item => {
        const detail = academy.details.find(row => row.enrollmentId === item.id);
        const reminder = academy.reminders.find(row => row.enrollmentId === item.id);
        const access = academy.grants.find(row => row.enrollmentId === item.id);
        return <article className="pbs-ledger-record" key={item.id}>
          <div className="pbs-section-top"><div><h3>{item.studentName}</h3><p className="pbs-muted">{item.email}</p><p>{item.courseTitle}</p></div><Status value={item.status} /></div>
          <div className="pbs-ledger-amounts"><div><small>Agreed fee</small><strong>{money(item.total)}</strong></div><div><small>Verified paid</small><strong>{money(item.paid)}</strong></div><div><small>Outstanding</small><strong>{money(balance(item))}</strong></div><div><small>Awaiting verification</small><strong>{money(item.requestedPayment)}</strong></div></div>
          <p className="pbs-muted">{detail?.source === 'admin' ? 'Enrolled by admin' : detail?.source === 'student' ? 'Student application' : 'Enrollment recorded'} · {dateLabel(item.submittedAt)}{detail?.dueDate ? ` · Due ${dateLabel(detail.dueDate)}` : ''}</p>
          {item.reference && <p className="pbs-reference">Bank reference <code>{item.reference}</code></p>}
          {Boolean(item.discount) && <p className="pbs-muted">Offer: {item.promotionTitle} · {money(item.discount!)} saved{item.promotionCode ? ` · Code ${item.promotionCode}` : ''} · Listed fee {money(item.listPrice || item.total)}</p>}
          <div className="pbs-actions">
            {item.status === 'pending' && <Button onClick={() => open('review', item)}>Review application</Button>}
            {item.status === 'approved' && balance(item) > 0 && <><Button onClick={() => open('payment', item)}>{item.requestedPayment ? 'Verify payment' : 'Record payment'}</Button><Button quiet onClick={() => setDialog({ kind: 'reminder', enrollment: item })}><Bell size={16} /> Send reminder</Button></>}
            {item.requestedPayment > 0 && item.status === 'approved' && <Button quiet onClick={() => open('reject-payment', item)}>Decline reference</Button>}
            <Button quiet onClick={() => setDialog({ kind: 'followup', enrollment: item })}><CalendarDays size={16} /> Due date & notes</Button>
            {item.status === 'approved' && <GrantAccessButton enrollment={item} onSaved={onSaved} />}
          </div>
          {(reminder || access) && <div className="pbs-ledger-meta">{reminder && <small><Bell size={13} /> {dateLabel(reminder.sentAt)} · {reminder.channel} · {reminder.status}</small>}{access && <small><Cloud size={13} /> OneDrive {access.status}</small>}</div>}
        </article>;
      })}
    </Panel>
    <Panel title="Reminder history">
      {!academy.reminders.length && <Empty title="No reminders sent">Send a reminder from a student's payment record.</Empty>}
      {academy.reminders.slice(0, 20).map(reminder => <article className="pbs-record-row" key={reminder.id}><div><strong>{data.enrollments.find(item => item.id === reminder.enrollmentId)?.studentName || 'Student'}</strong><p className="pbs-muted">{dateTimeLabel(reminder.sentAt)} · {reminder.channel} · {reminder.status}</p><p className="pbs-pre-wrap">{reminder.body}</p>{reminder.error && <p className="pbs-form-error">{reminder.error}</p>}</div></article>)}
    </Panel>
    {dialog?.kind === 'settings' && <PaymentSettingsForm payment={academy.payment} onClose={() => setDialog(undefined)} onSaved={async () => { await onSaved(); setDialog(undefined); }} />}
    {dialog?.kind === 'followup' && <FollowupForm enrollment={dialog.enrollment} detail={academy.details.find(item => item.enrollmentId === dialog.enrollment.id)} onClose={() => setDialog(undefined)} onSaved={async () => { await onSaved(); setDialog(undefined); }} />}
    {dialog?.kind === 'reminder' && <ReminderForm enrollment={dialog.enrollment} onClose={() => setDialog(undefined)} onSaved={async () => { await onSaved(); }} />}
  </div>;
}

function PaymentSettingsForm({ payment, onClose, onSaved }: { payment: AdminAcademyData['payment']; onClose: () => void; onSaved: () => Promise<void> }) {
  return <DialogForm title="Student payment settings" submit="Save payment destination" onClose={onClose} onSubmit={async form => {
    await send('/admin/payment-settings', { paymentUpiId: value(form, 'upi'), paymentName: value(form, 'name'), current: String(form.get('current') || '') }, 'PUT'); await onSaved();
  }}><Input label="Payee name" name="name" defaultValue={payment.paymentName} maxLength={120} required /><Input label="UPI ID" name="upi" defaultValue={payment.paymentUpiId} placeholder="Your verified business UPI ID" maxLength={150} note="Students see this destination and its QR code. Leave blank to pause new UPI payments." />
    <PasswordInput label="Confirm with your admin password" name="current" autoComplete="current-password" required /><p className="pbs-muted">Confirm each payment with your bank before issuing a receipt.</p></DialogForm>;
}
function FollowupForm({ enrollment, detail, onClose, onSaved }: { enrollment: Enrollment; detail?: EnrollmentDetail; onClose: () => void; onSaved: () => Promise<void> }) {
  return <DialogForm title="Enrollment follow-up" detail={enrollment.studentName} submit="Save follow-up" onClose={onClose} onSubmit={async form => {
    await send(`/admin/enrollments/${enrollment.id}/details`, { dueDate: value(form, 'dueDate'), internalNote: value(form, 'note') }, 'PATCH'); await onSaved();
  }}><Input label="Balance due date" type="date" name="dueDate" defaultValue={detail?.dueDate} /><Field label="Admin notes" note="Visible only to administrators."><textarea name="note" rows={4} maxLength={3000} defaultValue={detail?.internalNote} /></Field></DialogForm>;
}
function ReminderForm({ enrollment, onClose, onSaved }: { enrollment: Enrollment; onClose: () => void; onSaved: () => Promise<void> }) {
  const [key] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState('');
  return <DialogForm title="Send fee reminder" detail={enrollment.email} submit={result ? 'Refresh reminder status' : 'Send reminder'} onClose={onClose} onSubmit={async form => {
    const response = await send<{ status: string; error?: string }>(`/admin/enrollments/${enrollment.id}/reminder`, { requestKey: key, channel: value(form, 'channel'), body: value(form, 'body') });
    setResult(response.status === 'accepted' ? 'Microsoft accepted the email. A copy is in the student portal.' : response.status === 'posted' ? 'Reminder posted to the student portal.' : response.error || `Reminder status: ${response.status}`); await onSaved();
  }}><Field label="Send through"><select name="channel"><option value="portal">Student portal message</option><option value="email">Microsoft email + portal message</option></select></Field>
    <Field label="Reminder message"><textarea name="body" rows={5} maxLength={3000} required readOnly={Boolean(result)} defaultValue={`Hi ${enrollment.studentName}, your remaining fee for ${enrollment.courseTitle} is ${money(balance(enrollment))}. Please open Fees & payments in your PBS workspace to pay and submit the bank reference. Thank you.`} /></Field>
    <p className="pbs-muted">Email requires your connected Microsoft account. Accepted emails may still be processing.</p>{result && <p className="pbs-form-status" role="status">{result}</p>}</DialogForm>;
}

export function ActivityLog({ events, compact = false }: { events: AdminAcademyData['events']; compact?: boolean }) {
  return <Panel title={compact ? 'Recent academy activity' : 'Activity & audit trail'}>{!events.length && <Empty title="Your activity starts here">Enrollment, payment, access and certificate actions are recorded as they happen.</Empty>}
    <div className="pbs-activity-list">{events.map(event => <article key={event.id}><span className="pbs-activity-mark"><Check size={14} /></span><div><strong>{event.action}</strong><p>{event.detail}</p><small>{event.actor} · {dateTimeLabel(event.createdAt)}</small></div></article>)}</div></Panel>;
}
