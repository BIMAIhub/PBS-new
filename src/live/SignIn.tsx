import { useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, GraduationCap, Layers, ShieldCheck } from 'lucide-react';
import { PortalBrand } from '../components/student-dashboard/PortalUI';
import { DialogForm, FormError, Input, PasswordInput, value } from './ui';
import { messageFrom, send } from './api';
import type { Account, EnrollmentStatus, Role } from './types';
import { useBranding } from './Branding';

export function SignIn({ onSignedIn }: { onSignedIn: (account: Account) => void }) {
  const { brand } = useBranding();
  const [role, setRole] = useState<Role>('student');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'lookup' | null>(null);
  const [status, setStatus] = useState<EnrollmentStatus>();
  const student = role === 'student';

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await send<{ account: Account }>('/auth/login', {
        identifier: value(form, 'identifier'), password: String(form.get('password') || ''), role, remember: form.has('remember'),
      });
      onSignedIn(result.account);
    } catch (problem) {
      setError(messageFrom(problem));
    } finally {
      setBusy(false);
    }
  }

  return <div className="pbs-login">
    <aside className="pbs-login-art" aria-label={brand.academyName}>
      <div className="pbs-login-art-top">
        <PortalBrand />
        <div className="pbs-login-intro"><p className="pbs-hero-eyebrow"><span />{brand.heroEyebrow}</p>
          <h2 className="pbs-pre-wrap">{brand.heroTitle}</h2><p className="pbs-login-description">{brand.heroDescription}</p>
          <a className="pbs-hero-link" href="/explore"><BookOpen size={18} />Explore BIM courses</a>
          <div className="pbs-login-features"><div><Layers /><span>Learn by doing<small>Lessons & project practice</small></span></div><div><GraduationCap /><span>Show your progress<small>Portfolio & course credentials</small></span></div></div>
        </div>
      </div>
      <div className="pbs-login-art-caption"><span>Structure / Services / Coordination</span><span>{brand.shortName} learning portal</span></div>
    </aside>
    <main className="pbs-login-pane">
      <div className="pbs-login-pane-top">
        <button className="pbs-text-button" type="button" onClick={() => { setStatus(undefined); setDialog('lookup'); }}>
          Check enrollment <ArrowUpRight />
        </button>
      </div>
      <div className="pbs-login-content">
        <div className="pbs-login-heading">
          <h1>{student ? 'Student sign-in' : 'Admin sign-in'}</h1>
          <p>{student ? 'Access your courses, live sessions and BIM projects.' : 'Manage courses, students, payments and learning records.'}</p>
        </div>
        <div className="pbs-role-control" role="group" aria-label="Account type">
          <button type="button" disabled={busy} aria-pressed={student} onClick={() => { setRole('student'); setError(''); }}><GraduationCap /> Student</button>
          <button type="button" disabled={busy} aria-pressed={!student} onClick={() => { setRole('admin'); setError(''); }}><ShieldCheck /> Administrator</button>
        </div>
        <form key={role} className="pbs-login-form" onSubmit={signIn}>
          <FormError error={error} />
          <Input label={student ? 'Email, roll number or student ID' : 'Administrator email'} name="identifier"
            type={student ? 'text' : 'email'} autoComplete="username" autoCapitalize="none" required />
          <PasswordInput label="Password" name="password" autoComplete="current-password" required />
          <label className="pbs-check"><input type="checkbox" name="remember" /> Keep me signed in</label>
          <button className="pbs-button pbs-button-primary pbs-login-submit" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'} <ArrowRight />
          </button>
        </form>
        <div className="pbs-login-admissions"><span>New to {brand.shortName}?</span>
          <a className="pbs-text-button" href="/explore">Explore courses</a>
        </div>
      </div>
      <footer className="pbs-login-footer"><span>{brand.academyName}</span>
        <a href="/app">Get the PBS app</a>
        <a href={`mailto:${brand.supportEmail}`}>Contact support <ArrowUpRight /></a>
      </footer>
    </main>
    {dialog === 'lookup' && <DialogForm title="Check enrollment" submit="Check status" onClose={() => setDialog(null)}
      detail="Use the application code from your student workspace."
      onSubmit={async form => {
        setStatus(undefined);
        const result = await send<{ status: EnrollmentStatus }>('/enrollments/lookup', { email: value(form, 'email'), code: value(form, 'code') });
        setStatus(result.status);
      }}>
      <Input label="Application email" type="email" name="email" required />
      <Input label="Application code" name="code" maxLength={64} required />
      {status && <p className="pbs-form-status" role="status">{status === 'approved' ? 'Enrollment approved. Sign in to open your course.' :
        status === 'pending' ? 'Your application is awaiting review.' : 'This application was declined. Contact PBS for details.'}</p>}
    </DialogForm>}
  </div>;
}
