import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { defaultBranding, type Branding } from './branding-types';

const BrandingContext = createContext({ brand: defaultBranding, apply: (_brand: Branding) => {}, refresh: async () => {} });
export const useBranding = () => useContext(BrandingContext);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<Branding>(defaultBranding);
  const refresh = useCallback(async () => {
    const updated = await api<Branding>('/branding');
    setBrand(current => current.revision === updated.revision ? current : updated);
  }, []);
  const apply = useCallback((updated: Branding) => {
    setBrand(updated);
    try { localStorage.setItem('pbs:branding-revision', updated.revision); } catch {}
  }, []);
  useEffect(() => {
    const update = () => { if (document.visibilityState === 'visible') void refresh().catch(() => {}); };
    const changed = (event: StorageEvent) => { if (event.key === 'pbs:branding-revision') update(); };
    update(); const timer = window.setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update); window.addEventListener('focus', update); window.addEventListener('storage', changed);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update); window.removeEventListener('focus', update); window.removeEventListener('storage', changed); };
  }, [refresh]);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--studio-accent', brand.primaryColor);
    root.style.setProperty('--studio-gold', brand.accentColor);
    root.style.setProperty('--studio-paper', brand.backgroundColor);
    root.style.setProperty('--pbs-hero-image', `url("${brand.heroUrl}")`);
    root.dataset.pbsGlass = String(brand.glassEnabled); root.dataset.pbsMotion = String(brand.motionEnabled);
    document.title = `${brand.shortName} Learning Portal | ${brand.academyName}`;
    document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]').forEach(link => { link.href = brand.logoUrl; link.removeAttribute('type'); });
  }, [brand]);
  return <BrandingContext.Provider value={{ brand, apply, refresh }}>{children}</BrandingContext.Provider>;
}

export async function brandLogoData(brand: Branding): Promise<string> {
  const image = new Image(); image.src = brand.logoUrl; await image.decode();
  const scale=Math.min(1,720/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1,Math.round(image.naturalWidth*scale)); canvas.height = Math.max(1,Math.round(image.naturalHeight*scale));
  const context = canvas.getContext('2d'); if (!context) throw new Error('Image export is unavailable.');
  context.drawImage(image, 0,0,canvas.width,canvas.height); return canvas.toDataURL('image/png');
}
