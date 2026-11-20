import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, CreditCard } from 'lucide-react';
import { PortalDialog } from '../components/student-dashboard/PortalUI';
import { send } from './api';
import type { Account, Catalog, CourseSummary, Enrollment } from './types';
import { DialogForm, Empty, Field, Input, money, paise, PasswordInput, value } from './ui';

export function CatalogDialog({ catalog, onChoose, onClose }: {
  catalog: Catalog; onChoose: (course: CourseSummary) => void; onClose: () => void;
}) {
  return <PortalDialog title="Explore BIM courses" onClose={onClose}>
    {catalog.courses.length === 0 && <Empty title="No published courses">Check back when PBS opens enrollment.</Empty>}
    {catalog.courses.map(course => <button className="pbs-action-row" type="button" key={course.id} onClick={() => onChoose(course)}>
      <span className="pbs-row-icon"><BookOpen /></span>
      <span><strong>{course.title}</strong><small>{course.category} · {money(course.fee)}</small></span>
      <ArrowRight className="pbs-row-end" />
    </button>)}
  </PortalDialog>;
}

function PaymentFields({ catalog, balance, optional }: { catalog: Catalog; balance: number; optional?: boolean }) {
  const [amount, setAmount] = useState(optional ? '' : String(balance / 100));
  const [qrCode, setQrCode] = useState('');
  const amountNumber = Number(amount);
  const paymentUrl = `upi://pay?${new URLSearchParams({
    pa: catalog.paymentUpiId,
    pn: catalog.paymentName,
    cu: 'INR',
    ...(amountNumber > 0 ? { am: amountNumber.toFixed(2) } : {}),
  })}`;
  const validAmount = amountNumber > 0 && amountNumber * 100 <= balance;
  useEffect(() => {
    let active = true;
    setQrCode('');
    if (catalog.paymentUpiId && validAmount) void import('qrcode').then(qr => qr.toDataURL(paymentUrl, { width: 220, margin: 1, color: { dark: '#152C42', light: '#FFFFFF' } })).then(url => { if (active) setQrCode(url); }).catch(() => {});
    return () => { active = false; };
  }, [paymentUrl, catalog.paymentUpiId, validAmount]);
  if (!catalog.paymentUpiId || balance === 0) return null;
  return <div className="pbs-inset pbs-payment-fields">
    <div className="pbs-inline-label"><CreditCard size={18} /><strong>UPI payment{optional ? ' (optional)' : ''}</strong></div>
    <p className="pbs-muted">Pay {catalog.paymentName} at <strong>{catalog.paymentUpiId}</strong> and enter the bank UTR. PBS issues a receipt after verifying payment.</p>
    <div className="pbs-form-grid">
      <Input label="Amount paid (₹)" type="number" name="amount" min={optional ? 0 : 0.01} max={balance / 100} step=".01"
        value={amount} onChange={event => setAmount(event.target.value)} required={!optional} />
      <Input label="Bank UTR" name="reference" maxLength={80} required={amountNumber > 0} />
    </div>
    {validAmount && <div className="pbs-payment-qr">{qrCode && <img src={qrCode} width="180" height="180" alt={`UPI payment QR for ${catalog.paymentName}`} />}<div><strong>Scan to pay {money(Math.round(amountNumber * 100))}</strong><p className="pbs-muted">Use any UPI app. Check the payee name before completing payment.</p><a className="pbs-button pbs-button-primary" href={paymentUrl}>Pay with UPI <ArrowRight size={17} /></a></div></div>}
  </div>;
}

export function EnrollmentForm({ course, catalog, account, onClose, onSuccess }: {
  course: CourseSummary; catalog: Catalog; account?: Account; onClose: () => void;
  onSuccess: (account: Account) => void | Promise<void>;
}) {
  return <DialogForm title="Request enrollment" detail={course.title} submit="Submit application" onClose={onClose}
    onSubmit={async form => {
      const response = await send<{ account: Account; enrollment: Enrollment }>('/enrollments', {
        courseId: course.id,
        name: value(form, 'name'), email: value(form, 'email'), phone: value(form, 'phone'),
        password: String(form.get('password') || ''), amount: paise(form, 'amount'), reference: value(form, 'reference'),
      });
      await onSuccess(response.account);
    }}>
    <div className="pbs-inset"><span className="pbs-muted">Course fee</span><strong className="pbs-fee-value">{money(course.fee)}</strong></div>
    {course.description && <p className="pbs-muted">{course.description}</p>}
    {!account && <>
      <div className="pbs-form-grid">
        <Input label="Full name" name="name" autoComplete="name" maxLength={120} required />
        <Input label="Email" name="email" type="email" autoComplete="email" required />
      </div>
      <Input label="Phone" name="phone" type="tel" autoComplete="tel" />
      <PasswordInput label="Create password" name="password" autoComplete="new-password" minLength={12} maxLength={128} required />
    </>}
    <PaymentFields catalog={catalog} balance={course.fee} optional />
  </DialogForm>;
}

export function StudentPaymentForm({ enrollment, catalog, onClose, onSuccess }: {
  enrollment: Enrollment; catalog: Catalog; onClose: () => void; onSuccess: () => void | Promise<void>;
}) {
  const balance = enrollment.total - enrollment.paid;
  return <DialogForm title="Submit a payment reference" detail={enrollment.courseTitle} submit="Send for review" onClose={onClose}
    onSubmit={async form => {
      await send(`/student/enrollments/${enrollment.id}/payment`, { amount: paise(form, 'amount'), reference: value(form, 'reference') });
      await onSuccess();
    }}>
    <PaymentFields catalog={catalog} balance={balance} />
  </DialogForm>;
}
