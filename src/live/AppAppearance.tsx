import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type AppTextSize = 'large' | 'extra-large';
export type AppLayoutChoice = 'auto' | 'app';
type Preference = { textSize: AppTextSize; layout: AppLayoutChoice };
const storageKey = 'pbs:app-appearance:v1';
const defaults: Preference = { textSize: 'large', layout: 'auto' };

function readPreference(): Preference {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return { textSize: saved.textSize === 'extra-large' ? 'extra-large' : 'large', layout: saved.layout === 'app' ? 'app' : 'auto' };
  } catch { return defaults; }
}

interface AppAppearance {
  appLayout: boolean;
  textSize: AppTextSize;
  layoutChoice: AppLayoutChoice;
  setTextSize: (size: AppTextSize) => void;
  setLayoutChoice: (layout: AppLayoutChoice) => void;
}
export const AppAppearanceContext = createContext<AppAppearance>({ appLayout: false, textSize: 'large', layoutChoice: 'auto', setTextSize: () => {}, setLayoutChoice: () => {} });
export const useAppAppearance = () => useContext(AppAppearanceContext);
const compactQuery = '(max-width: 1024px)';
// Installed apps always use the app shell, including tablet/desktop-sized viewports.
// Coarse portrait screens also cover phones using a desktop browser viewport.
const touchQuery = '(pointer: coarse) and (hover: none) and (orientation: portrait)';
function compactScreen() { return typeof matchMedia !== 'undefined' && (matchMedia(compactQuery).matches || matchMedia(touchQuery).matches); }

export function AppAppearanceProvider({ installed, children }: { installed: boolean; children: ReactNode }) {
  const [preference, setPreference] = useState(readPreference);
  const [compact, setCompact] = useState(compactScreen);
  const appLayout = installed || compact || preference.layout === 'app';
  useEffect(() => {
    const queries = [matchMedia(compactQuery), matchMedia(touchQuery)];
    const update = () => setCompact(compactScreen());
    queries.forEach(query => query.addEventListener('change', update));
    const changed = (event: StorageEvent) => { if (event.key === storageKey) setPreference(readPreference()); };
    window.addEventListener('storage', changed);
    return () => { queries.forEach(query => query.removeEventListener('change', update)); window.removeEventListener('storage', changed); };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.pbsAppLayout = String(appLayout);
    document.documentElement.dataset.pbsAppText = preference.textSize;
  }, [appLayout, preference.textSize]);
  function save(next: Partial<Preference>) {
    setPreference(current => {
      const updated = { ...current, ...next };
      try { localStorage.setItem(storageKey, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }
  return <AppAppearanceContext.Provider value={{ appLayout, textSize: preference.textSize, layoutChoice: preference.layout,
    setTextSize: textSize => save({ textSize }), setLayoutChoice: layout => save({ layout }) }}>{children}</AppAppearanceContext.Provider>;
}
