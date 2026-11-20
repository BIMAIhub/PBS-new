import { lazy, Suspense, useEffect, useState } from 'react';
import { PortalBrand } from './components/student-dashboard/PortalUI';
import { PasswordForm } from './live/AccountForms';
import { api, messageFrom, send } from './live/api';
import { SignIn } from './live/SignIn';
import type { Account, Portfolio } from './live/types';
import { Button, ExternalLink, FormError, useApiResource } from './live/ui';
import { PublicCertificate } from './live/Certificates';

const PublicExplore = lazy(() => import('./live/Explore').then(module => ({ default: module.PublicExplore })));
const PublicPortfolio = lazy(() => import('./live/PublicPortfolio').then(module => ({ default: module.PublicPortfolioPage })));
const AdminWorkspace = lazy(() => import('./live/AdminWorkspace').then(module => ({ default: module.AdminWorkspace })));
const StudentWorkspace = lazy(() => import('./live/StudentWorkspace').then(module => ({ default: module.StudentWorkspace })));

function portfolioId() {
  const { pathname, search, hash } = window.location;
  const id = pathname.startsWith('/portfolio/') ? pathname.slice('/portfolio/'.length) :
    new URLSearchParams(search).get('portfolio') || (hash.startsWith('#/portfolio/') ? hash.slice('#/portfolio/'.length) : '');
  try { return id ? decodeURIComponent(id) : ''; } catch { return ''; }
}

function Portal() {
  const [account, setAccount] = useState<Account | null>();
  const [error, setError] = useState('');
  const [passwordOpen, setPasswordOpen] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    api<{ account: Account | null }>('/session', { signal: controller.signal })
      .then(result => setAccount(result.account))
      .catch(problem => { if (!controller.signal.aborted) { setError(messageFrom(problem)); setAccount(null); } });
    return () => controller.abort();
  }, []);

  async function signOut() {
    try {
      await send('/auth/logout');
      setError('');
      setAccount(null);
      setPasswordOpen(true);
    } catch (problem) {
      setError(messageFrom(problem));
    }
  }
  if (account === undefined) return <p className="pbs-route-loading" role="status">Opening PBS…</p>;
  if (!account) return <>{error && <div className="pbs-site-error"><FormError error={error} /></div>}<SignIn onSignedIn={updated => { setError(''); setAccount(updated); }} /></>;
  if (account.mustChangePassword) return <main className="pbs-public-paper">
    <PortalBrand />
    <h1>Set your password</h1>
    <p className="pbs-muted">Your account is ready. Choose a new password to open your workspace.</p>
    <div className="pbs-actions"><Button onClick={() => setPasswordOpen(true)}>Set password</Button><Button quiet onClick={() => void signOut()}>Sign out</Button></div>
    <FormError error={error} />
    {passwordOpen && <PasswordForm account={account} onClose={() => setPasswordOpen(false)} onSaved={setAccount} />}
  </main>;
  return <>
    {error && <div className="pbs-site-error"><FormError error={error} /></div>}
    <Suspense fallback={<p className="pbs-route-loading" role="status">Loading workspace…</p>}>
      {account.role === 'admin' ? <AdminWorkspace account={account} onAccount={setAccount} onSignOut={() => void signOut()} /> :
        <StudentWorkspace account={account} onAccount={setAccount} onSignOut={() => void signOut()} />}
    </Suspense>
  </>;
}

export default function App() {
  const courseId = window.location.pathname.match(/^\/courses\/([\w-]+)\/?$/)?.[1];
  if (courseId || window.location.pathname === '/explore' || window.location.pathname === '/explore/') return <Suspense fallback={<p className="pbs-route-loading" role="status">Opening courses…</p>}><PublicExplore courseId={courseId} /></Suspense>;
  const certificateToken = window.location.pathname.match(/^\/verify\/certificate\/([\w-]+)$/)?.[1];
  if (certificateToken) return <PublicCertificate token={certificateToken} />;
  const id = portfolioId();
  return id ? <Suspense fallback={<p className="pbs-route-loading" role="status">Opening portfolio…</p>}><PublicPortfolio id={id} /></Suspense> : <Portal />;
}
