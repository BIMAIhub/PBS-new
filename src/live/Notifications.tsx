import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Award, Bell, CalendarDays, Check, CreditCard, MessageSquare, X } from 'lucide-react';
import { PortalDialog } from '../components/student-dashboard/PortalUI';
import type { PortalNotification } from './experience-types';
import { messageFrom, send } from './api';
import { Button, dateTimeLabel, Empty, FormError, useApiResource } from './ui';
import { PushDeviceSettings } from './MobileApp';

export function NotificationCenter({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { data, error, refresh } = useApiResource<{ items: PortalNotification[]; unread: number }>('/notifications');
  const [open, setOpen] = useState(false), [toast, setToast] = useState<PortalNotification>(), [problem, setProblem] = useState('');
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const check = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(check, 30_000); window.addEventListener('focus', check);
    const pushed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.page) onNavigate(detail.page);
      if (typeof detail?.id === 'string') void send(`/notifications/${encodeURIComponent(detail.id)}`, { read: true }, 'PATCH').then(() => refresh()).catch(() => {});
      else void refresh();
    };
    window.addEventListener('pbs:notification-open', pushed);
    return () => { clearInterval(timer); window.removeEventListener('focus', check); window.removeEventListener('pbs:notification-open', pushed); };
  }, [refresh, onNavigate]);
  useEffect(() => {
    const unseen = data?.items.filter(item => !item.readAt && !item.shownAt && !seen.current.has(item.id)) || [];
    if (!unseen.length) return;
    unseen.forEach(item => seen.current.add(item.id));
    setToast(unseen[0]);
    void send('/notifications/seen', { ids: unseen.map(item => item.id) }).catch(() => {});
  }, [data]);
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (count: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (data?.unread) void nav.setAppBadge?.(data.unread).catch(() => {});
    else void nav.clearAppBadge?.().catch(() => {});
  }, [data?.unread]);
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
      <details className="pbs-notification-preferences"><summary>Phone & browser notifications</summary><PushDeviceSettings /><p className="pbs-muted pbs-small">The portal inbox refreshes every 30 seconds while open. Background phone alerts use your device permission and an active sign-in.</p></details>
    </div></PortalDialog>}
  </>;
}
