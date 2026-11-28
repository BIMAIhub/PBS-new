import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CheckCircle2, Copy, CreditCard } from 'lucide-react';
import { PortalDialog } from '../components/student-dashboard/PortalUI';
import { send, messageFrom } from './api';
import { BatchEnrollmentSelect } from './Batches';
import { CatalogBrowser } from './Catalog';
import { CourseInformation } from './CourseInformation';
import type { PriceQuote } from './experience-types';
import type { AdmissionResult } from './admissions-types';
import type { Account, Catalog, CourseSummary, Enrollment } from './types';
import { Button, DialogForm, Empty, Field, Input, money, paise, supportEmail, value } from './ui';

export function CatalogDialog({ catalog, onChoose, onClose }: {
  catalog: Catalog; onChoose: (course: CourseSummary) => void; onClose: () => void;
}) {
  const [selected, setSelected] = useState<CourseSummary>();
  return <PortalDialog title={selected ? 'Course information' : 'Explore BIM courses'} onClose={onClose} className="pbs-dialog-catalog">
    {selected ? <><button className="pbs-text-button" type="button" onClick={() => setSelected(undefined)}>All courses</button><CourseInformation courseId={selected.id} onApply={onChoose} /></> : <CatalogBrowser catalog={catalog} onChoose={setSelected} compact />}
  </PortalDialog>;
}

export function PaymentFields({ catalog, balance, optional }: { catalog: Catalog; balance: number; optional?: boolean }) {
  const [amount, setAmount] = useState(String(balance / 100));
  const [reportPayment, setReportPayment] = useState(!optional);
  const [qrError, setQrError] = useState(false), [copyNotice, setCopyNotice] = useState('');
  const [qrCode, setQrCode] = useState('');
  const amountNumber = Number(amount);
  const paymentUrl = `upi://pay?${new URLSearchParams({
    pa: catalog.paymentUpiId,
    pn: catalog.paymentName,
    cu: 'INR',
    ...(amountNumber > 0 ? { am: amountNumber.toFixed(2) } : {}),
  })}`;
  const validAmount = Number.isFinite(amountNumber) && amountNumber > 0 && Math.round(amountNumber * 100) <= balance;
  useEffect(() => {
    let active = true;
    setQrCode('');
    setQrError(false);
    if (catalog.paymentUpiId && validAmount) void import('qrcode').then(qr => qr.toDataURL(paymentUrl, { width: 220, margin: 1, color: { dark: '#152C42', light: '#FFFFFF' } })).then(url => { if (active) setQrCode(url); }).catch(() => { if (active) setQrError(true); });
    return () => { active = false; };
  }, [paymentUrl, catalog.paymentUpiId, validAmount]);
  if (balance === 0) return <div className="pbs-inset"><strong>No payment needed</strong><p className="pbs-muted">{optional ? 'This course has no enrollment fee.' : 'Your course fee is fully paid.'}</p></div>;
  if (!catalog.paymentUpiId) return <div className="pbs-inset pbs-payment-setup" role="status"><div className="pbs-inline-label"><CreditCard size={20} /><strong>UPI payment setup pending</strong></div><p className="pbs-muted">PBS has not added a verified UPI destination yet. Scan-to-pay and app payment will appear here once it is configured.{optional ? ' You can submit your application now; PBS will confirm the payment instructions during review.' : ' Contact PBS to arrange your payment.'}</p><a className="pbs-text-button" href={`mailto:${supportEmail}?subject=Course%20payment%20instructions`}>Request payment instructions</a><input type="hidden" name="amount" value="0" /></div>;
  return <div className="pbs-inset pbs-payment-fields">
    <div className="pbs-inline-label"><CreditCard size={18} /><strong>Scan & pay or open your UPI app</strong></div>
    <p className="pbs-muted">Pay <strong>{catalog.paymentName}</strong> · {catalog.paymentUpiId}</p>
    <Input label="Amount to pay (₹)" type="number" name={reportPayment ? 'amount' : undefined} min="0.01" max={balance / 100} step=".01"
      value={amount} onChange={event => setAmount(event.target.value)} required={reportPayment} note="You can pay the full fee or enter an installment within the balance." />
    {!reportPayment && <input type="hidden" name="amount" value="0" />}
    {validAmount && <div className="pbs-payment-qr"><div className="pbs-qr-frame">{qrCode ? <img src={qrCode} width="180" height="180" alt={`Scan UPI QR to pay ${catalog.paymentName} ${money(Math.round(amountNumber * 100))}`} /> : <p role="status">{qrError ? 'QR unavailable. Use the app button or copy the UPI ID.' : 'Preparing payment QR…'}</p>}</div><div><strong>Scan to pay {money(Math.round(amountNumber * 100))}</strong><p className="pbs-muted">Scan with Google Pay, PhonePe, Paytm or any UPI app. On your phone, use the button to choose an installed app.</p><div className="pbs-actions"><a className="pbs-button pbs-button-primary" href={paymentUrl}>Pay with UPI app <ArrowRight size={17} /></a><Button quiet onClick={async () => { try { await navigator.clipboard.writeText(catalog.paymentUpiId); setCopyNotice('UPI ID copied.'); } catch { setCopyNotice(`UPI ID: ${catalog.paymentUpiId}`); } }}><Copy size={16} />Copy UPI ID</Button></div>{copyNotice && <p role="status" className="pbs-small">{copyNotice}</p>}</div></div>}
    {optional && <label className="pbs-check"><input type="checkbox" checked={reportPayment} onChange={event => setReportPayment(event.target.checked)} /> I have paid. Add my bank reference for verification.</label>}
    {reportPayment && <Input label="Bank UTR / transaction reference" name="reference" minLength={4} maxLength={80} required note="Copy this from the successful transaction in your payment app." />}
    <p className="pbs-muted pbs-small">Check the payee name before paying. Opening an app does not confirm payment. PBS verifies your bank reference before issuing a receipt.{optional ? ' You may also apply first without reporting a payment.' : ''}</p>
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
  const [submitted, setSubmitted] = useState<AdmissionResult>(), [applicationStatus, setApplicationStatus] = useState('pending'), [confirmationNote, setConfirmationNote] = useState('');
  async function checkOffer() {
    setChecking(true); setOfferMessage('');
    try {
      const form = formRef.current?.closest('form');
      const email = account?.email || (form ? value(new FormData(form), 'email') : '');
      const result = await send<PriceQuote>('/enrollments/quote', { courseId: course.id, code, email });
      setQuote(result); setAppliedCode(code.trim().toUpperCase()); setOfferMessage(result.promotionTitle ? `${result.promotionTitle} applied. Your course fee is ${money(result.total)}.` : 'The standard course fee applies.');
    } catch (error) { setOfferMessage(messageFrom(error)); } finally { setChecking(false); }
  }
  if (submitted) return <PortalDialog title="Your application is with PBS" onClose={onClose}><div className="pbs-live-form pbs-application-confirmation"><CheckCircle2 size={42} /><h3>{course.title}</h3><p className="pbs-muted">Your application is {applicationStatus === 'approved' ? 'approved' : applicationStatus === 'rejected' ? 'declined' : 'awaiting admin review'}. {applicationStatus === 'approved' ? 'PBS will share your sign-in details privately.' : 'You do not need to sign in while PBS reviews your enrollment and payment reference.'}</p><Input label="Application email" value={submitted.application.email} readOnly /><Input label="Application code" value={submitted.application.code} readOnly /><p className="pbs-muted">Save this code. Use Check enrollment on the sign-in page to view your application status. Access details are issued after approval.</p><div className="pbs-actions"><Button quiet onClick={async () => { try { await navigator.clipboard.writeText(submitted.application.code); setConfirmationNote('Application code copied.'); } catch { setConfirmationNote('Select and copy the application code above.'); } }}><Copy size={16} />Copy code</Button><Button onClick={async () => { try { const result = await send<{status: string}>('/enrollments/lookup', { email: submitted.application.email, code: submitted.application.code }); setApplicationStatus(result.status); setConfirmationNote(result.status === 'pending' ? 'Your application is still awaiting review.' : `Application ${result.status}.`); } catch (error) { setConfirmationNote(messageFrom(error)); } }}>Check status</Button>{applicationStatus === 'approved' && <a className="pbs-button pbs-button-outline" href="/">Student sign-in</a>}</div>{confirmationNote && <p className="pbs-form-status" role="status">{confirmationNote}</p>}</div></PortalDialog>;
  if (course.paused) return <PortalDialog title="Enrollment is paused" onClose={onClose}><div className="pbs-live-form"><h3>{course.title}</h3><p className="pbs-muted">{course.pauseReason || 'PBS has temporarily paused this course. Check back for enrollment updates.'}</p></div></PortalDialog>;
  return <DialogForm title="Request enrollment" detail={course.title} submit="Submit application" onClose={onClose}
    onSubmit={async form => {
      const response = await send<AdmissionResult>('/enrollments', {
        courseId: course.id,batchId:value(form,'batchId'),
        name: value(form, 'name'), email: value(form, 'email'), phone: value(form, 'phone'),
        amount: paise(form, 'amount'), reference: value(form, 'reference'), code: appliedCode, quotedTotal: quote.total,
      });
      if (account) await onSuccess(response.account);
      else { setSubmitted(response); setApplicationStatus(response.application.status); }
    }}>
    <div className="pbs-inset"><span className="pbs-muted">Course fee</span><strong className="pbs-fee-value">{money(quote.total)}</strong>{quote.discount > 0 && <p className="pbs-muted"><del>{money(quote.listPrice)}</del> · {quote.promotionTitle} · Save {money(quote.discount)}</p>}</div>
    {course.description && <p className="pbs-muted">{course.description}</p>}
    {!account && <>
      <div className="pbs-form-grid">
        <Input label="Full name" name="name" autoComplete="name" maxLength={120} required />
        <Input label="Email" name="email" type="email" autoComplete="email" required />
      </div>
      <Input label="WhatsApp number" name="phone" type="tel" autoComplete="tel" required note="Include your country code, for example +91. PBS uses this number to share approved access details." />
    </>}
    <BatchEnrollmentSelect courseId={course.id}/><div className="pbs-offer-code-field" ref={formRef}><Input label="Offer or referral code" value={code} onChange={event => setCode(event.target.value)} maxLength={40} /><Button quiet disabled={checking} onClick={() => void checkOffer()}>{checking ? 'Checking…' : 'Apply code'}</Button></div>{offerMessage && <p className="pbs-muted" role="status">{offerMessage}</p>}
    <p className="pbs-muted pbs-small">The best eligible offer applies. Offers do not stack. A code is applied only after you select Apply code.</p>
    <PaymentFields key={quote.total} catalog={catalog} balance={quote.total} optional />
    {!account && <p className="pbs-muted pbs-small">Your workspace stays locked until admin approval. PBS will issue your sign-in details after reviewing this application.</p>}
  </DialogForm>;
}

export function StudentPaymentForm({ enrollment, catalog, onClose, onSuccess }: {
  enrollment: Enrollment; catalog: Catalog; onClose: () => void; onSuccess: () => void | Promise<void>;
}) {
  const balance = enrollment.total - enrollment.paid;
  if (!catalog.paymentUpiId || balance <= 0) return <PortalDialog title="Course payment" onClose={onClose}><div className="pbs-live-form"><PaymentFields catalog={catalog} balance={Math.max(0, balance)} /></div></PortalDialog>;
  return <DialogForm title="Submit a payment reference" detail={enrollment.courseTitle} submit="Send for review" onClose={onClose}
    onSubmit={async form => {
      await send(`/student/enrollments/${enrollment.id}/payment`, { amount: paise(form, 'amount'), reference: value(form, 'reference') });
      await onSuccess();
    }}>
    <PaymentFields catalog={catalog} balance={balance} />
  </DialogForm>;
}
