import { useEffect, useState } from 'react';
import { getStationLogoSignedUrl, LOGO_URL_TTL_SECONDS } from './qa';

// Renouveler avant expiration, y compris après la mise en veille d'un onglet.
export const LOGO_REFRESH_MS = (LOGO_URL_TTL_SECONDS - 5 * 60) * 1000;

type Preview =
  | { key: string; status: 'loading' }
  | { key: string; status: 'ready'; url: string }
  | { key: string; status: 'error' };

/** L'URL reste uniquement en mémoire et suit le chemin actuellement affiché. */
export function useStationLogoUrl(path: string | null, enabled: boolean, scope = '') {
  const key = path ? JSON.stringify([scope, path]) : null;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !path || !key) {
      setPreview(null);
      return;
    }
    const logoPath = path;
    const logoKey = key;
    let active = true;
    let pending = false;
    let refreshAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      if (pending) return;
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending = true;
      setPreview((current) => current?.key === logoKey && current.status === 'ready'
        ? current : { key: logoKey, status: 'loading' });
      try {
        const url = await getStationLogoSignedUrl(logoPath);
        if (!active) return;
        setPreview({ key: logoKey, status: 'ready', url });
        refreshAt = Date.now() + LOGO_REFRESH_MS;
        timer = setTimeout(() => { void refresh(); }, LOGO_REFRESH_MS);
      } catch {
        if (active) {
          refreshAt = Infinity;
          setPreview({ key: logoKey, status: 'error' });
        }
      } finally {
        pending = false;
      }
    }

    function onVisible() {
      if (document.visibilityState === 'visible' && Date.now() >= refreshAt) void refresh();
    }
    void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [path, key, enabled, attempt]);

  const current = enabled && preview?.key === key ? preview : null;
  return {
    url: current?.status === 'ready' ? current.url : null,
    loading: enabled && Boolean(path) && (!current || current.status === 'loading'),
    error: current?.status === 'error',
    retry: () => setAttempt((value) => value + 1),
    imageFailed: () => {
      if (key) setPreview((current) => current?.key === key ? { key, status: 'error' } : current);
    },
  };
}
