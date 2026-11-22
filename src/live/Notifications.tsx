import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Award, Bell, CalendarDays, Check, CreditCard, MessageSquare, X } from 'lucide-react';
import { PortalDialog } from '../components/student-dashboard/PortalUI';
import type { PortalNotification } from './experience-types';
import { messageFrom, send } from './api';
import { Button, dateTimeLabel, Empty, FormError, useApiResource } from './ui';
import { useBranding } from './Branding';

export function NotificationCenter({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { brand } = useBranding();
  const { data, error, refresh } = useApiResource<{ items: PortalNotification[]; unread: number }>('/notifications');
  const [open, setOpen] = useState(false), [toast, setToast] = useState<PortalNotification>(), [problem, setProblem] = useState('');
  const [desktop, setDesktop] = useState(() => localStorage.getItem('pbs-desktop-notifications:v1') === '1');
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const check = () => { if (desktop || document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(check, 30_000); window.addEventListener('focus', check);
    return () => { clearInterval(timer); window.removeEventListener('focus', check); };
  }, [refresh, desktop]);
  useEffect(() => {
    const unseen = data?.items.filter(item => !item.readAt && !item.shownAt && !seen.current.has(item.id)) || [];
    if (!unseen.length) return;
    unseen.forEach(item => seen.current.add(item.id));
    setToast(unseen[0]);
    void send('/notifications/seen', { ids: unseen.map(item => item.id) }).catch(() => {});
    if (desktop && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      const notification = new Notification(unseen[0].title, { body: unseen[0].body, icon: brand.logoUrl, tag: unseen[0].id });
      notification.onclick = () => { window.focus(); onNavigate(unseen[0].page); notification.close(); };
    }
  }, [data, desktop, brand.logoUrl]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(undefined), 9000); return () => clearTimeout(timer); }, [toast]);
  async function select(item: PortalNotification) {
    setProblem('');
    try { await send(`/notifications/${encodeURIComponent(item.id)}`, { read: true }, 'PATCH'); setOpen(false); setToast(undefined); onNavigate(item.page); await refresh(); }
    catch (error) { setProblem(messageFrom(error)); }
  }
  const Icon = toast?.kind === 'certificate' ? Award : toast?.kind === 'payment' ? CreditCard : toast?.kind === 'session' ? CalendarDays : MessageSquare;
  return <><button type="button" className="pbs-notification-trigger" aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ''}`} onClick={() => setOpen(true)}><Bell size={19} />{Boolean(data?.unread) && <span>{data!.unread > 99 ? '99+' : data!.unread}</span>}</button>
    {toast && !open && createPortal(<aside className={`pbs-notification-toast ${toast.kind === 'certificate' ? 'pbs-toast-achievement' : ''}`} role="status" aria-live="polite"><span className="pbs-toast-icon"><Icon size={22} /></span><div><strong>{toast.title}</strong><p>{toast.body}</p><button type="button" className="pbs-text-button" onClick={() => void select(toast)}>View update</button></div><button type="button" className="pbs-icon-button" aria-label="Dismiss notification" onClick={() => setToast(undefined)}><X size={17} /></button></aside>, document.body)}
    {open && <PortalDialog title="Notifications" onClose={() => setOpen(false)}><div className="pbs-live-stack"><div className="pbs-section-top"><span className="pbs-muted">{data?.unread || 0} unread</span><Button quiet disabled={!data?.unread} onClick={async () => { try { await send('/notifications/read-all'); await refresh(); } catch (error) { setProblem(messageFrom(error)); } }}><Check size={16} /> Mark all read</Button></div><FormError error={problem || error} />
      {!data?.items.length && <Empty title="You are up to date">Course decisions, messages, payment receipts and certificate updates appear here.</Empty>}
      <div className="pbs-notification-list">{data?.items.map(item => <button className={`pbs-notification-item ${item.readAt ? '' : 'pbs-notification-unread'}`} key={item.id} onClick={() => void select(item)}><span className="pbs-notification-dot" /><span><strong>{item.title}</strong><p>{item.body}</p><small>{dateTimeLabel(item.createdAt)}</small></span></button>)}</div>
      <div className="pbs-notification-preferences"><Button quiet onClick={async () => {
        if (!('Notification' in window)) { setProblem('This browser does not support desktop notifications. In-portal notifications are available.'); return; }
        if (desktop) { setDesktop(false); localStorage.removeItem('pbs-desktop-notifications:v1'); return; }
        const permission = await Notification.requestPermission();
        if (permission === 'granted') { setDesktop(true); localStorage.setItem('pbs-desktop-notifications:v1', '1'); }
        else setProblem('Desktop alerts are blocked by the browser. In-portal notifications are still available.');
      }}>{desktop ? 'Disable desktop alerts' : 'Enable desktop alerts'}</Button><p className="pbs-muted pbs-small">Updates refresh every 30 seconds while the portal is open. In-portal popups work without browser notification permission.</p></div>
    </div></PortalDialog>}
  </>;
}
