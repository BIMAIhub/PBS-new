import { lazy, Suspense, useState, type FormEvent } from 'react';
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, BookOpen, CircleAlert,
  Eye, EyeOff, GraduationCap, LockKeyhole, Mail, ShieldCheck
} from 'lucide-react';
import { COMPANY_INFO } from '../../data/pbsData';
import { studentAuthUtil, type ActiveSessionUser } from '../../utils/studentAuth';
import { pbsAdminStore, type AdminCourse } from '../../utils/pbsAdminStore';
import { soundFx } from '../../utils/soundEffects';
import { ChangePasswordModal } from './ChangePasswordModal';
import { CheckEnrollmentModal } from './CheckEnrollmentModal';
import { PortalBrand, PortalDialog } from './PortalUI';

const CourseUpiEnrollModal = lazy(() =>
  import('./CourseUpiEnrollModal').then(module => ({ default: module.CourseUpiEnrollModal }))
);

interface StudentLoginPortalProps {
  onSuccessLogin: (user: ActiveSessionUser, rememberSession: boolean) => void;
}

export function StudentLoginPortal({ onSuccessLogin }: StudentLoginPortalProps) {
  const [role, setRole] = useState<ActiveSessionUser['role']>('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberSession, setRememberSession] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dialog, setDialog] = useState<'enrollment' | 'password' | 'courses' | null>(null);
  const [courseForEnrollment, setCourseForEnrollment] = useState<AdminCourse | null>(null);
  const isStudent = role === 'student';
  const courses = dialog === 'courses' ? pbsAdminStore.getCourses().filter(course => course.isPublished) : [];

  function selectRole(nextRole: ActiveSessionUser['role']) {
    if (role === nextRole) return;
    setRole(nextRole);
    setEmail('');
    setPassword('');
    setShowPassword(false);
    setError('');
    setStatus('');
  }

  function openEnrollmentLookup() {
    selectRole('student');
    setDialog('enrollment');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setStatus('');
    if (!email.trim() || !password.trim()) {
      setError('Enter your email or student ID and password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await studentAuthUtil.verifyCredentialsAsync(email, password);
      if (!result.success || !result.user || result.user.role !== role) {
        setError(`Check your ${isStudent ? 'student ID or email' : 'administrator email'} and password, then try again.`);
        return;
      }
      soundFx.playSuccess();
      onSuccessLogin(result.user, rememberSession);
    } catch {
      setError('Sign-in is temporarily unavailable. Try again in a moment.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="pbs-login">
      <aside className="pbs-login-art" aria-label="Pragmatic BIM Solution">
        <img className="pbs-login-image" src="/bim-study-model.webp" alt="" fetchPriority="high" />
        <div className="pbs-login-art-top">
          <PortalBrand />
          <div className="pbs-login-intro">
            <span className="pbs-drawing-mark" aria-hidden="true"><ArrowDownRight /></span>
            <h2>Build your<br />BIM practice</h2>
          </div>
        </div>
        <div className="pbs-login-art-caption">
          <span>Architectural study model</span>
          <span>Structure / Services / Coordination</span>
        </div>
      </aside>

      <main className="pbs-login-pane">
        <div className="pbs-login-pane-top">
          <button className="pbs-text-button" onClick={openEnrollmentLookup} disabled={isSubmitting}>
            Check enrollment <ArrowUpRight />
          </button>
        </div>

        <div className="pbs-login-content">
          <div className="pbs-login-heading">
            <h1>{isStudent ? 'Student sign-in' : 'Admin sign-in'}</h1>
            <p>{isStudent
              ? 'Access your courses, live sessions and BIM projects.'
              : 'Manage student records, courses and enrollments.'}</p>
          </div>

          <div className="pbs-role-control" role="group" aria-label="Account type">
            <button type="button" aria-pressed={isStudent} disabled={isSubmitting} onClick={() => selectRole('student')}>
              <GraduationCap /> Student
            </button>
            <button type="button" aria-pressed={!isStudent} disabled={isSubmitting} onClick={() => selectRole('admin')}>
              <ShieldCheck /> Administrator
            </button>
          </div>

          <form className="pbs-login-form" onSubmit={handleSubmit}>
            {error && <p id="pbs-signin-error" className="pbs-form-error" role="alert"><CircleAlert /> {error}</p>}
            {status && <p className="pbs-form-status" role="status">{status}</p>}

            <div className="pbs-field">
              <label htmlFor="pbs-signin-identity">{isStudent ? 'Email, roll number or student ID' : 'Administrator email'}</label>
              <div className="pbs-field-input">
                <Mail aria-hidden="true" />
                <input
                  id="pbs-signin-identity"
                  name="username"
                  type={isStudent ? 'text' : 'email'}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={isStudent ? 'Enter your email or student ID' : 'Enter your work email'}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-describedby={error ? 'pbs-signin-error' : undefined}
                  required
                />
              </div>
            </div>

            <div className="pbs-field">
              <div className="pbs-field-label">
                <label htmlFor="pbs-signin-password">Password</label>
                {isStudent && (
                  <button type="button" className="pbs-text-button" onClick={() => setDialog('password')}>
                    Change password
                  </button>
                )}
              </div>
              <div className="pbs-field-input">
                <LockKeyhole aria-hidden="true" />
                <input
                  id="pbs-signin-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-describedby={error ? 'pbs-signin-error' : undefined}
                  required
                />
                <button
                  type="button"
                  className="pbs-icon-button pbs-field-action"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </button>
              </div>
            </div>

            <label className="pbs-check">
              <input type="checkbox" checked={rememberSession} onChange={(event) => setRememberSession(event.target.checked)} />
              Keep me signed in
            </label>

            <button className="pbs-button pbs-button-primary pbs-login-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'} <ArrowRight />
            </button>
          </form>

          <div className="pbs-login-admissions">
            <span>New to Pragmatic BIM Solution?</span>
            <button type="button" className="pbs-text-button" onClick={() => setDialog('courses')}>
              Explore courses <ArrowRight />
            </button>
          </div>
        </div>

        <footer className="pbs-login-footer">
          <span>Pragmatic BIM Solution</span>
          <a href={COMPANY_INFO.socials.email}>Contact support <ArrowUpRight /></a>
        </footer>
      </main>

      {dialog === 'password' && (
        <ChangePasswordModal
          isOpen
          onClose={() => setDialog(null)}
          onPasswordChanged={(newPassword) => {
            setPassword(newPassword);
            setStatus('Password updated. You can sign in with your new password.');
          }}
        />
      )}
      {dialog === 'enrollment' && (
        <CheckEnrollmentModal
          onClose={() => setDialog(null)}
          onUseIdentifier={(identifier) => {
            setDialog(null);
            setEmail(identifier);
            setPassword('');
            setError('');
            setStatus('Enrollment found. Enter your password to sign in.');
          }}
          onOpenEnrollment={() => setDialog('courses')}
        />
      )}
      {dialog === 'courses' && (
        <PortalDialog title="Explore BIM courses" onClose={() => setDialog(null)}>
          <div className="pbs-admission-list">
            {courses.length === 0 && <p className="pbs-empty">There are no published courses right now.</p>}
            {courses.map((course) => (
              <button
                className="pbs-action-row"
                type="button"
                key={course.id}
                onClick={() => {
                  setDialog(null);
                  setCourseForEnrollment(course);
                }}
              >
                <span className="pbs-row-icon"><BookOpen /></span>
                <span><strong>{course.title}</strong><small>{course.batchMode}</small></span>
                <ArrowRight className="pbs-row-end" />
              </button>
            ))}
          </div>
        </PortalDialog>
      )}
      {courseForEnrollment && (
        <Suspense fallback={<PortalDialog title="Loading enrollment…" onClose={() => setCourseForEnrollment(null)} />}>
          <CourseUpiEnrollModal
            course={courseForEnrollment}
            isOpen
            onClose={() => setCourseForEnrollment(null)}
            currentUser={{ fullName: '', email: email.includes('@') ? email : '', phone: '' }}
            onEnrollmentSuccess={() => setStatus('Enrollment request submitted for review.')}
          />
        </Suspense>
      )}
    </div>
  );
}
