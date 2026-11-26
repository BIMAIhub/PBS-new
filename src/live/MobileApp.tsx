import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, BellRing, BookOpen, CalendarDays, Check, Download, ExternalLink, RefreshCw, Share2, ShieldCheck, Smartphone, Trash2, WifiOff } from 'lucide-react';
import { PortalBrand } from '../components/student-dashboard/PortalUI';
import { messageFrom, send } from './api';
import { useBranding } from './Branding';
import { Button, dateTimeLabel, Field, FormError, Panel, useApiResource } from './ui';
import { AppAppearanceProvider, useAppAppearance } from './AppAppearance';
import './mobile-app.css';

interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
const MobileContext = createContext<{ registration?: ServiceWorkerRegistration; installed: boolean; prompt?: InstallPrompt; install: () => Promise<void>; issue: string }>({ installed: false, install: async () => {}, issue: '' });
const preferenceKey = 'pbs:phone-notifications:v1';
type Device = { id: string; label: string; previews: boolean; createdAt: string; lastDeliveryAt: string; error: string; expiresAt: number; currentSession: boolean };
type PushStatus = { accountId: string; ready: boolean; publicKey: string; devices: Device[] };
type DevicePreference = { accountId: string; deviceId: string; previews: boolean };
function preference(): DevicePreference | undefined { try { return JSON.parse(localStorage.getItem(preferenceKey) || 'null') || undefined; } catch { return undefined; } }
function rememberDevice(value?: DevicePreference) { try { if (value) localStorage.setItem(preferenceKey, JSON.stringify(value)); else localStorage.removeItem(preferenceKey); } catch {} }
export function initialWorkspacePage<T extends string>(pages: readonly T[], fallback: T): T {
  const requested = new URLSearchParams(location.search).get('page') as T;
  return pages.includes(requested) ? requested : fallback;
}

export function MobileAppProvider({ children }: { children: ReactNode }) {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>(), [prompt, setPrompt] = useState<InstallPrompt>();
  const [installed, setInstalled] = useState(standalone), [waiting, setWaiting] = useState<ServiceWorker>(), [issue, setIssue] = useState('');
  const [offline, setOffline] = useState(!navigator.onLine);
  const reloadForUpdate = useRef(false);
  useEffect(() => {
    const online = () => setOffline(!navigator.onLine);
    const beforeInstall = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const didInstall = () => { setInstalled(true); setPrompt(undefined); };
    const display = matchMedia('(display-mode: standalone)');
    const displayChanged = () => setInstalled(standalone());
    window.addEventListener('beforeinstallprompt', beforeInstall); window.addEventListener('appinstalled', didInstall);
    window.addEventListener('online', online); window.addEventListener('offline', online); display.addEventListener('change', displayChanged);
    return () => { window.removeEventListener('beforeinstallprompt', beforeInstall); window.removeEventListener('appinstalled', didInstall); window.removeEventListener('online', online); window.removeEventListener('offline', online); display.removeEventListener('change', displayChanged); };
  }, []);
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;
    let disposed = false;
    const controllerChanged = () => { if (reloadForUpdate.current) window.location.reload(); };
    const message = (event: MessageEvent) => {
      if (event.data?.type !== 'PBS_OPEN_NOTIFICATION' || typeof event.data.url !== 'string') return;
      const url = new URL(event.data.url, location.origin);
      if (url.origin !== location.origin || url.pathname !== '/') return;
      history.replaceState(null, '', url.pathname + url.search);
      window.dispatchEvent(new CustomEvent('pbs:notification-open', { detail: { page: url.searchParams.get('page'), id: event.data.id } }));
    };
    navigator.serviceWorker.addEventListener('controllerchange', controllerChanged);
    navigator.serviceWorker.addEventListener('message', message);
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(reg => {
      if (disposed) return;
      setRegistration(reg);
      if (reg.waiting) setWaiting(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => { if (!disposed && worker.state === 'installed' && navigator.serviceWorker.controller) setWaiting(worker); });
      });
      void reg.update().catch(() => {});
    }).catch(() => { if (!disposed) setIssue('App setup could not finish. Reconnect and refresh to try again.'); });
    return () => { disposed = true; navigator.serviceWorker.removeEventListener('controllerchange', controllerChanged); navigator.serviceWorker.removeEventListener('message', message); };
  }, []);
  async function install() {
    if (!prompt) return;
    await prompt.prompt(); const choice = await prompt.userChoice; setPrompt(undefined);
    if (choice.outcome === 'accepted') setInstalled(standalone());
  }
  return <AppAppearanceProvider installed={installed}><MobileContext.Provider value={{ registration, installed, prompt, install, issue }}>{children}
    {offline && <div className="pbs-app-status" role="status"><WifiOff size={17} /> You’re offline. Reconnect to use PBS.</div>}
    {waiting && <aside className="pbs-app-update" aria-label="App update"><RefreshCw size={20} /><div><strong>A PBS update is ready</strong><p>Finish uploads and save your work before refreshing.</p></div><Button quiet onClick={() => { reloadForUpdate.current = true; waiting.postMessage({ type: 'PBS_ACTIVATE_UPDATE' }); }}>Update app</Button><button className="pbs-text-button" onClick={() => setWaiting(undefined)}>Later</button></aside>}
  </MobileContext.Provider></AppAppearanceProvider>;
}

export function InstallAppPanel() {
  const { installed, prompt, install, issue } = useContext(MobileContext);
  const isIOS = ios();
  return <section className={`pbs-app-install ${installed ? 'pbs-app-installed' : ''}`} aria-label="Install PBS app">
    <div className="pbs-app-install-heading"><span className="pbs-app-symbol"><Smartphone /></span><div><h2>{installed ? 'PBS app' : 'Take PBS with you'}</h2><p>{installed ? 'Installed on this device' : 'One app for your student or administrator account.'}</p></div>{installed && <Check className="pbs-app-check" />}</div>
    <FormError error={issue} />
    {!installed && <>{prompt && <Button onClick={() => void install()}><Download size={18} /> Install PBS app</Button>}
      <ol className="pbs-app-steps">{isIOS ? <><li>Open this website in <strong>Safari</strong> on your iPhone or iPad.</li><li>Tap <strong>Share <Share2 size={14} /></strong>, then <strong>Add to Home Screen</strong> and <strong>Add</strong>.</li><li>Open PBS from the new icon and sign in with your existing account.</li></> : <><li>Open this website in <strong>Chrome</strong> on Android.</li><li>{prompt ? 'Tap Install PBS app above, or ' : 'Open the browser menu and '}choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li><li>Open the PBS icon and sign in with your existing account.</li></>}</ol>
      <p className="pbs-muted pbs-small">{isIOS ? 'iOS / iPadOS 16.4 or later supports phone notifications for Home Screen apps.' : 'On iPhone: open in Safari → Share → Add to Home Screen. A desktop browser can install PBS from its address bar or menu.'}</p>
    </>}
    {!installed && <p className="pbs-muted pbs-small">Use “Keep me signed in” on your own device. An internet connection is required for courses, uploads and records.</p>}
  </section>;
}

function applicationKey(key: string) {
  const bytes = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bytes, character => character.charCodeAt(0));
}
function deviceLabel() { return ios() ? 'iPhone / iPad' : /Android/.test(navigator.userAgent) ? 'Android device' : /Mac/.test(navigator.platform) ? 'Mac browser' : 'Computer browser'; }

export function PushDeviceSettings() {
  const { registration, installed } = useContext(MobileContext);
  const { data, error, refresh } = useApiResource<PushStatus>('/push/status');
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState(''), [notice, setNotice] = useState('');
  const [saved, setSaved] = useState(preference), [previews, setPreviews] = useState(() => preference()?.previews || false);
  const supported = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const needsHomeScreen = ios() && !installed;
  const device = data?.devices.find(device => device.id === saved?.deviceId && device.currentSession && saved?.accountId === data.accountId);
  async function enable() {
    if (!data?.ready || !registration || needsHomeScreen || !supported) return;
    setProblem(''); setNotice(''); setBusy(true);
    let newSubscription: PushSubscription | undefined;
    try {
      // This call stays in the direct button gesture, which Safari requires.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notifications are blocked. Allow them for PBS in your device or browser notification settings, then try again.');
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      const key = applicationKey(data.publicKey);
      if (subscription?.options.applicationServerKey && new Uint8Array(subscription.options.applicationServerKey).some((b, i) => b !== key[i])) {
        await subscription.unsubscribe(); subscription = null;
      }
      if (!subscription) { subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); newSubscription = subscription; }
      const result = await send<{ id: string }>('/push/subscribe', { subscription: subscription.toJSON(), label: deviceLabel(), previews });
      const preference = { accountId: data.accountId, deviceId: result.id, previews };
      rememberDevice(preference); setSaved(preference); await refresh();
      setNotice('Phone notifications are enabled. You can close PBS and still receive new updates while your sign-in remains active.');
    } catch (error) { if (newSubscription) await newSubscription.unsubscribe().catch(() => {}); setProblem(messageFrom(error)); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true); setProblem(''); setNotice('');
    try {
      await send(`/push/devices/${encodeURIComponent(id)}`, undefined, 'DELETE');
      if (saved?.deviceId === id) { rememberDevice(); setSaved(undefined); await (await registration?.pushManager.getSubscription())?.unsubscribe(); }
      await refresh(); setNotice('Notifications turned off for that device.');
    } catch (error) { setProblem(messageFrom(error)); } finally { setBusy(false); }
  }
  return <section className="pbs-push-settings" aria-label="Phone notifications"><div className="pbs-section-top"><div><h3><BellRing size={19} /> Phone notifications</h3><p className="pbs-muted">Course lessons, live sessions, messages, payments, assignments and certificate updates.</p></div><span className={`pbs-app-pill ${device ? 'is-enabled' : ''}`}>{device ? 'Enabled here' : 'Not enabled here'}</span></div>
    <FormError error={problem || error} />{notice && <p className="pbs-form-status" role="status">{notice}</p>}
    {needsHomeScreen ? <p className="pbs-app-callout">On iPhone or iPad, add PBS to the Home Screen first. Open it from its icon, sign in, then enable notifications here.</p> : !supported ? <p className="pbs-app-callout">This browser cannot receive background notifications. Use a supported phone browser or the Home Screen app. In-portal alerts still work.</p> : <>
      {data && !data.ready && <p className="pbs-app-callout">Phone notifications need server setup by PBS administration. In-portal notifications remain available.</p>}
      <label className="pbs-check"><input type="checkbox" checked={previews} onChange={e => setPreviews(e.target.checked)} disabled={busy} /> Show message previews on my lock screen</label>
      <p className="pbs-muted pbs-small">With previews off, your phone shows “You have a new update” until you open PBS.</p>
      <div className="pbs-actions"><Button disabled={busy || !registration || !data?.ready} onClick={() => void enable()}><BellRing size={17} />{busy ? 'Updating…' : device ? 'Save notification preference' : 'Enable phone notifications'}</Button>
        {device && <Button quiet disabled={busy} onClick={async () => { setBusy(true); setProblem(''); setNotice(''); try { const result = await send<{ status: string; error: string }>('/push/test', { deviceId: device.id }); setNotice(result.status === 'sent' ? 'Test accepted by your phone’s notification service. Check your notifications.' : `Test ${result.status}. ${result.error || 'PBS will retry on the next background check.'}`); await refresh(); } catch (e) { setProblem(messageFrom(e)); } finally { setBusy(false); } }}>Send test to this device</Button>}
      </div></>}
    {Boolean(data?.devices.length) && <div className="pbs-app-devices"><h4>Your connected devices</h4>{data!.devices.map(item => <div className="pbs-app-device" key={item.id}><Smartphone size={20} /><div><strong>{item.label}{item.id === device?.id ? ' · this device' : ''}</strong><small>Sign-in expires {dateTimeLabel(new Date(item.expiresAt).toISOString())}. Sign in and enable alerts again after expiry.</small>{item.lastDeliveryAt && <small>Last accepted update: {dateTimeLabel(item.lastDeliveryAt)}</small>}{item.error && <small className="pbs-app-delivery-error">{item.error}</small>}</div><Button quiet disabled={busy} onClick={() => void remove(item.id)} aria-label={`Turn off notifications on ${item.label}`}><Trash2 size={16} /> Turn off</Button></div>)}</div>}
  </section>;
}

function PushDiagnostics() {
  const { data, error, refresh } = useApiResource<{ devices: number; counts: { status: string; count: number }[]; lastRun: string; cronConfigured: boolean; schedule: string; errors: { label: string; error: string }[] }>('/admin/push/diagnostics');
  return <Panel title="Notification delivery"><FormError error={error} /><p className="pbs-muted">Only devices whose owners enable notifications receive phone alerts. The website inbox works for everyone.</p>{data && <><div className="pbs-app-metrics"><div><strong>{data.devices}</strong><span>Connected devices</span></div>{['sent','pending','failed'].map(status => <div key={status}><strong>{data.counts.find(item => item.status === status)?.count || 0}</strong><span>{status === 'sent' ? 'Accepted in 30 days' : status === 'pending' ? 'Waiting / retrying' : 'Failed'}</span></div>)}</div><p className="pbs-muted pbs-small">Provider acceptance does not confirm that a person has read an alert.</p><details className="pbs-app-schedule"><summary>Background checks & scheduled reminders</summary><p>New portal events trigger a background check after a successful change, even when the recipient has closed the app. The existing daily academy job also checks notifications.</p><p>For live-session reminders and timed module releases within a few minutes of their scheduled time, a server scheduler must call <code>/api/jobs/push</code> every 1–5 minutes with an <code>Authorization: Bearer CRON_SECRET</code> header. This is separate from installing the app.</p><p>{data.cronConfigured ? 'A server scheduler secret is configured.' : 'The server scheduler secret is not configured.'} {data.lastRun ? `Last check: ${dateTimeLabel(data.lastRun)}.` : 'No device background check has run yet.'}</p><p>Do not include the secret in a URL or student message. A daily job alone cannot deliver minute-by-minute reminders.</p></details>{data.errors.map((item, index) => <p className="pbs-app-callout" key={index}>{item.label}: {item.error}</p>)}</>}<Button quiet onClick={() => void refresh()}><RefreshCw size={16} /> Refresh delivery status</Button></Panel>;
}

export function MobileAppPage({ admin = false }: { admin?: boolean }) {
  return <div className="pbs-live-stack"><InstallAppPanel /><AppReadingSettings /><Panel title="Stay up to date"><PushDeviceSettings /></Panel>{admin && <PushDiagnostics />}</div>;
}

export function AppReadingSettings() {
  const { textSize, setTextSize, layoutChoice, setLayoutChoice } = useAppAppearance();
  return <Panel title="Text & layout"><p className="pbs-muted">Choose a comfortable reading size for this device</p>
    <div className="pbs-app-display-grid"><Field label="Text size"><select value={textSize} onChange={event => setTextSize(event.target.value === 'extra-large' ? 'extra-large' : 'large')}><option value="large">Large</option><option value="extra-large">Extra large</option></select></Field>
      <Field label="Layout"><select value={layoutChoice} onChange={event => setLayoutChoice(event.target.value === 'app' ? 'app' : 'auto')}><option value="auto">Automatic</option><option value="app">App layout in this browser</option></select></Field></div>
    <p className="pbs-muted pbs-small">The installed app uses bottom navigation. Automatic also uses this layout on phones and smaller screens.</p>
  </Panel>;
}

export function PublicMobileApp() {
  const { brand } = useBranding();
  return <main className="pbs-mobile-landing"><header><PortalBrand /><a href="/" className="pbs-text-button">Sign in <ArrowRight size={17} /></a></header><div className="pbs-mobile-hero"><div><p className="pbs-section-label">PBS on your phone</p><h1>Your learning.<br />Within reach.</h1><p className="pbs-mobile-lead">Open the full {brand.shortName} portal from your Home Screen. Continue your courses, join live sessions and keep up with every update.</p><div className="pbs-mobile-feature-list"><span><BookOpen /> Courses & saved progress</span><span><CalendarDays /> Live sessions & assignments</span><span><BellRing /> Phone notifications</span><span><ShieldCheck /> Student & admin access</span></div><a className="pbs-button pbs-button-primary" href="/">Open PBS portal <ArrowRight size={18} /></a><p className="pbs-muted pbs-small">Uses your existing PBS account and the same live website data.</p></div><InstallAppPanel /></div><section className="pbs-mobile-bottom"><h2>Install once. Keep learning.</h2><div><p><strong>1. Add PBS to your Home Screen</strong><span>Use the instructions above. No app store download is needed.</span></p><p><strong>2. Sign in to your account</strong><span>Choose Student or Administrator. Course enrollment and approvals still apply.</span></p><p><strong>3. Turn on phone alerts</strong><span>Open “PBS app & alerts” in your workspace, then tap Enable phone notifications.</span></p></div></section><footer><span>{brand.academyName}</span><a href="/explore">Explore courses <ExternalLink size={14} /></a></footer></main>;
}

export async function clearPhoneNotifications() {
  navigator.serviceWorker?.controller?.postMessage({ type: 'PBS_SIGNED_OUT' });
  const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
  await nav.clearAppBadge?.().catch(() => {});
}
