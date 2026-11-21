import { cloneElement, isValidElement, useCallback, useEffect, useId, useState, type FormEvent, type InputHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { ArrowUpRight, CircleAlert, Eye, EyeOff, FileText, LoaderCircle } from 'lucide-react';
import { PortalDialog } from '../components/student-dashboard/PortalUI';
import { api, messageFrom } from './api';

export const supportEmail = 'info@pragmaticbim.com';
const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });
const time = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

export const money = (paise: number) => currency.format(paise / 100);
export const dateLabel = (value: string) => value ? date.format(new Date(value)) : '—';
export const dateTimeLabel = (value: string) => time.format(new Date(value));
export const value = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
export const paise = (form: FormData, name: string) => Math.round(Number(value(form, name)) * 100);

export function Field({ label, children, note }: { label: string; children: ReactNode; note?: string }) {
  const labelId = useId();
  const control = isValidElement(children) && ['input', 'textarea', 'select'].includes(String(children.type))
    ? cloneElement(children as ReactElement<{ 'aria-labelledby'?: string }>, { 'aria-labelledby': labelId }) : children;
  return <label className="pbs-live-field"><span id={labelId}>{label}</span>{control}{note && <small>{note}</small>}</label>;
}

export function Input({ label, note, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; note?: string }) {
  return <Field label={label} note={note}><input {...props} /></Field>;
}

export function PasswordInput({ label, id: inputId, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const id = inputId || generatedId;
  return (
    <div className="pbs-live-field">
      <label htmlFor={id}>{label}</label>
      <span className="pbs-password-wrap">
        <input {...props} id={id} type={visible ? 'text' : 'password'} />
        <button type="button" className="pbs-icon-button" aria-label={visible ? 'Hide password text' : 'Show password text'}
          aria-controls={id} aria-pressed={visible} onClick={() => setVisible(current => !current)}>
          {visible ? <EyeOff /> : <Eye />}
        </button>
      </span>
    </div>
  );
}

export function FormError({ error }: { error: string }) {
  return error ? <p role="alert" className="pbs-form-error"><CircleAlert /> {error}</p> : null;
}

export function Button({ children, onClick, quiet = false, disabled = false }: {
  children: ReactNode; onClick?: () => void; quiet?: boolean; disabled?: boolean;
}) {
  return <button type="button" className={`pbs-button ${quiet ? 'pbs-button-outline' : 'pbs-button-primary'}`} disabled={disabled} onClick={onClick}>{children}</button>;
}

export function DialogForm({ title, detail, submit, onClose, onSubmit, children, wide = false, submitDisabled = false }: {
  title: string; detail?: string; submit: string; onClose: () => void;
  onSubmit: (form: FormData) => Promise<void>; children: ReactNode; wide?: boolean; submitDisabled?: boolean;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || submitDisabled) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit(new FormData(event.currentTarget));
    } catch (problem) {
      setError(messageFrom(problem));
    } finally {
      setBusy(false);
    }
  }
  return (
    <PortalDialog title={title} className={wide ? 'pbs-dialog-wide' : ''} onClose={() => { if (!busy) onClose(); }}>
      <form className="pbs-live-form" onSubmit={save}>
        {detail && <p className="pbs-muted">{detail}</p>}
        <FormError error={error} />
        {children}
        <footer className="pbs-dialog-actions">
          <Button quiet onClick={onClose} disabled={busy}>Cancel</Button>
          <button type="submit" className="pbs-button pbs-button-primary" disabled={busy || submitDisabled}>
            {busy ? <><LoaderCircle className="pbs-spinner" /> Saving…</> : submit}
          </button>
        </footer>
      </form>
    </PortalDialog>
  );
}

export function Panel({ title, action, children, className = '' }: {
  title: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return <section className={`pbs-panel pbs-live-panel ${className}`}>
    <div className="pbs-panel-heading"><h2>{title}</h2>{action}</div>
    {children}
  </section>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="pbs-live-empty">
    <div className="pbs-empty-mark"><FileText size={23} strokeWidth={1.6} /></div>
    <h3>{title}</h3>
    {children && <p>{children}</p>}
    {action}
  </div>;
}

export function Status({ value }: { value: string }) {
  const label = value === 'approved' ? 'Enrolled' : value === 'pending' ? 'Awaiting review' :
    value === 'rejected' ? 'Declined' : value;
  return <span className={`pbs-live-status ${value === 'approved' || value === 'Published' || value === 'Paid' ? 'pbs-status-success' : ''}`}>{label}</span>;
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className="pbs-text-button" href={href} target="_blank" rel="noopener noreferrer">{children} <ArrowUpRight /></a>;
}

export function useApiResource<T>(path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await api<T>(path, { signal });
      setData(result);
      setError('');
      return result;
    } catch (problem) {
      if (!signal?.aborted) setError(messageFrom(problem));
      return undefined;
    }
  }, [path]);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  return { data, error, refresh };
}
