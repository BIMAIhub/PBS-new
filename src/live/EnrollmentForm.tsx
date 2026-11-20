import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CreditCard } from 'lucide-react';
import { PortalDialog } from '../components/student-dashboard/PortalUI';
import { send, messageFrom } from './api';
import { CatalogBrowser } from './Catalog';
import { CourseInformation } from './CourseInformation';
import type { PriceQuote } from './experience-types';
import type { Account, Catalog, CourseSummary, Enrollment } from './types';
import { Button, DialogForm, Empty, Field, Input, money, paise, PasswordInput, value } from './ui';

export function CatalogDialog({ catalog, onChoose, onClose }: {
  catalog: Catalog; onChoose: (course: CourseSummary) => void; onClose: () => void;
}) {
  const [selected, setSelected] = useState<CourseSummary>();
  return <PortalDialog title={selected ? 'Course information' : 'Explore BIM courses'} onClose={onClose} className="pbs-dialog-catalog">
    {selected ? <><button className="pbs-text-button" type="button" onClick={() => setSelected(undefined)}>All courses</button><CourseInformation courseId={selected.id} onApply={onChoose} /></> : <CatalogBrowser catalog={catalog} onChoose={setSelected} compact />}
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

export function EnrollmentForm({ course, catalog, account, onClose, onSuccess, initialCode = '' }: {
  course: CourseSummary; catalog: Catalog; account?: Account; onClose: () => void;
  onSuccess: (account: Account) => void | Promise<void>;
  initialCode?: string;
}) {
  const fallback: PriceQuote = course.price || { listPrice: course.fee, total: course.fee, discount: 0, promotionId: '', promotionTitle: '', code: '', percent: 0 };
  const [quote, setQuote] = useState<PriceQuote>(fallback), [code, setCode] = useState(initialCode), [appliedCode, setAppliedCode] = useState(''), [offerMessage, setOfferMessage] = useState(''), [checking, setChecking] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  async function checkOffer() {
    setChecking(true); setOfferMessage('');
    try {
      const form = formRef.current?.closest('form');
      const email = account?.email || (form ? value(new FormData(form), 'email') : '');
      const result = await send<PriceQuote>('/enrollments/quote', { courseId: course.id, code, email });
      setQuote(result); setAppliedCode(code.trim().toUpperCase()); setOfferMessage(result.promotionTitle ? `${result.promotionTitle} applied. Your course fee is ${money(result.total)}.` : 'The standard course fee applies.');
    } catch (error) { setOfferMessage(messageFrom(error)); } finally { setChecking(false); }
  }
  return <DialogForm title="Request enrollment" detail={course.title} submit="Submit application" onClose={onClose}
    onSubmit={async form => {
      const response = await send<{ account: Account; enrollment: Enrollment }>('/enrollments', {
        courseId: course.id,
        name: value(form, 'name'), email: value(form, 'email'), phone: value(form, 'phone'),
        password: String(form.get('password') || ''), amount: paise(form, 'amount'), reference: value(form, 'reference'), code: appliedCode, quotedTotal: quote.total,
      });
      await onSuccess(response.account);
    }}>
    <div className="pbs-inset"><span className="pbs-muted">Course fee</span><strong className="pbs-fee-value">{money(quote.total)}</strong>{quote.discount > 0 && <p className="pbs-muted"><del>{money(quote.listPrice)}</del> · {quote.promotionTitle} · Save {money(quote.discount)}</p>}</div>
    {course.description && <p className="pbs-muted">{course.description}</p>}
    {!account && <>
      <div className="pbs-form-grid">
        <Input label="Full name" name="name" autoComplete="name" maxLength={120} required />
        <Input label="Email" name="email" type="email" autoComplete="email" required />
      </div>
      <Input label="Phone" name="phone" type="tel" autoComplete="tel" />
      <PasswordInput label="Create password" name="password" autoComplete="new-password" minLength={12} maxLength={128} required />
    </>}
    <div className="pbs-offer-code-field" ref={formRef}><Input label="Offer or referral code" value={code} onChange={event => setCode(event.target.value)} maxLength={40} /><Button quiet disabled={checking} onClick={() => void checkOffer()}>{checking ? 'Checking…' : 'Apply code'}</Button></div>{offerMessage && <p className="pbs-muted" role="status">{offerMessage}</p>}
    <p className="pbs-muted pbs-small">The best eligible offer applies. Offers do not stack. A code is applied only after you select Apply code.</p>
    <PaymentFields key={quote.total} catalog={catalog} balance={quote.total} optional />
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
