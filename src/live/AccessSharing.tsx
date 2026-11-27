import { useRef, useState } from 'react';
import { Check, Copy, Mail, MessageCircle, Send } from 'lucide-react';
import { PortalDialog } from '../components/student-dashboard/PortalUI';
import { api, messageFrom, send } from './api';
import type { AccessDelivery, AccessPackage } from './admissions-types';
import type { Receipt } from './types';
import { Button, dateTimeLabel, Field, FormError, Input, useApiResource } from './ui';

export function StudentAccessDialog({ access, delivery: initial, receipt, onReceipt, onClose }: {
  access: AccessPackage; delivery?: AccessDelivery; receipt?: Receipt; onReceipt?: (receipt: Receipt) => void; onClose: () => void;
}) {
  const [delivery, setDelivery] = useState(initial), [error, setError] = useState(''), [copied, setCopied] = useState(''), [busy, setBusy] = useState(false);
  const requestKey = useRef(crypto.randomUUID());
  const history = useApiResource<{ deliveries: { id: string; email: string; status: string; createdAt: string; error: string }[] }>(`/admin/students/${access.studentId}/access-deliveries`);
  async function email() {
    if (busy) return; setBusy(true); setError('');
    if (delivery?.status === 'failed') requestKey.current = crypto.randomUUID();
    try {
      const result = await send<AccessDelivery>(`/admin/students/${access.studentId}/access-email`, { temporaryPassword: access.password || '', requestKey: requestKey.current });
      setDelivery(result); await history.refresh();
    } catch (problem) { setError(messageFrom(problem)); } finally { setBusy(false); }
  }
  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); } catch { setError('Select and copy the access details below.'); }
  }
  const emailDraft = `mailto:${encodeURIComponent(access.email)}?subject=${encodeURIComponent(access.subject)}&body=${encodeURIComponent(access.body)}`;
  const whatsapp = access.whatsappNumber ? `https://wa.me/${access.whatsappNumber}?text=${encodeURIComponent(access.body)}` : '';
  const alreadySent = delivery?.status === 'accepted' || delivery?.status === 'unknown' || delivery?.status === 'pending';
  return <PortalDialog title="Student access ready" onClose={onClose} className="pbs-dialog-wide">
    <div className="pbs-live-form"><div className="pbs-access-heading"><span><Check size={24} /></span><div><h3>{access.name}</h3><p>Student record · {access.studentId}</p></div></div>
      <p className="pbs-muted">Share the sign-in link, course summary and fee details privately. {access.password ? 'The student must replace this temporary password at first sign-in.' : 'The student will use their existing password. Generate a new temporary password from Manage access when a reset is needed.'}</p>
      <div className="pbs-form-grid"><Input label="Student email" value={access.email} readOnly /><Input label="Saved WhatsApp number" value={access.whatsappNumber ? `+${access.whatsappNumber}` : 'No WhatsApp number saved'} readOnly /></div>
      {access.password && <Input label="Temporary password" value={access.password} readOnly />}
      <Input label="Sign-in link" value={access.signInUrl} readOnly />
      <div className="pbs-access-channels"><Button disabled={busy || alreadySent} onClick={() => void email()}><Send size={17} />{busy ? 'Sending…' : delivery?.status === 'accepted' ? 'Email accepted' : delivery?.status === 'failed' ? 'Retry email' : 'Send email'}</Button>
        <a className="pbs-button pbs-button-outline" href={emailDraft}><Mail size={17} />Open email draft</a>
        {whatsapp ? <a className="pbs-button pbs-button-outline" href={whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle size={17} />Open WhatsApp</a> : <span className="pbs-muted">Add the student's WhatsApp number in their admin record.</span>}
      </div><p className="pbs-muted pbs-small">WhatsApp opens a prepared message for you to send. Saved 10-digit numbers use India’s +91 country code. Direct email uses your connected Microsoft account.</p>
      {delivery?.status === 'accepted' && <p className="pbs-form-status" role="status">Microsoft accepted the email for {access.email}. Delivery status is available in Sent Items.</p>}
      {delivery && delivery.status !== 'accepted' && <p className="pbs-form-status" role="status">{delivery.error || 'The email request is pending. Check Sent Items before trying another channel.'}</p>}
      <FormError error={error} />{copied && <p className="pbs-form-status" role="status">{copied} copied.</p>}
      <details className="pbs-access-preview"><summary>Preview the full message</summary><Field label="Access message"><textarea rows={9} value={access.body} readOnly /></Field></details>
      {history.data && history.data.deliveries.length > 0 && <details className="pbs-access-preview"><summary>Email history</summary>{history.data.deliveries.slice(0, 5).map(item => <p className="pbs-muted" key={item.id}>{dateTimeLabel(item.createdAt)} · {item.email} · {item.status}{item.error ? ` · ${item.error}` : ''}</p>)}</details>}
      <div className="pbs-dialog-actions">{receipt && onReceipt && <Button quiet onClick={() => onReceipt(receipt)}>View receipt</Button>}{access.password && <Button quiet onClick={() => void copy(access.password!, 'Password')}><Copy size={16} />Copy password</Button>}<Button onClick={() => void copy(access.body, 'Access details')}><Copy size={17} />Copy all details</Button></div>
    </div>
  </PortalDialog>;
}

export function ShareAccessButton({ studentId }: { studentId: string }) {
  const [access, setAccess] = useState<AccessPackage>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <><Button quiet disabled={busy} onClick={async () => { setBusy(true); setError(''); try { setAccess(await api<AccessPackage>(`/admin/students/${studentId}/access-package`)); } catch (problem) { setError(messageFrom(problem)); } finally { setBusy(false); } }}><Mail size={16} />{busy ? 'Preparing…' : 'Share access'}</Button><FormError error={error} />{access && <StudentAccessDialog access={access} onClose={() => setAccess(undefined)} />}</>;
}
