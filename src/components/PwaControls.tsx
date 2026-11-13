import React, { useEffect, useRef, useState } from 'react';
import { FiDownload, FiWifiOff, FiX } from 'react-icons/fi';
import { useOnlineStatus, usePWAInstall } from '../lib/pwa';
import { useStore } from '../lib/store';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => { void install(); }}
        className="btn btn-sm text-xs"
        title="Installer l’application sur cet appareil"
        aria-label="Installer l’application"
      >
        <FiDownload size={14} />
        <span className={compact ? 'hidden xl:inline' : ''}>Installer</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="btn btn-sm text-xs"
          title="Installer sur iPhone ou iPad"
        >
          <FiDownload size={14} />
          <span className={compact ? 'hidden xl:inline' : ''}>Installer</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setShowIOSGuide(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Installer WashGuard sur iOS"
              className="card w-full max-w-sm bg-base-100 p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-base-300 pb-3">
                <h3 className="text-sm font-bold">Installer sur iPhone / iPad</h3>
                <button type="button" className="text-base-content/60 hover:text-sky-400" onClick={() => setShowIOSGuide(false)} aria-label="Fermer">
                  <FiX size={16} />
                </button>
              </div>
              <ol className="mt-3 space-y-2 text-xs leading-relaxed text-base-content/60">
                <li>1. Appuyez sur le bouton <strong className="text-slate-200">Partager</strong> dans la barre Safari.</li>
                <li>2. Faites défiler et choisissez <strong className="text-slate-200">Sur l’écran d’accueil</strong>.</li>
                <li>3. Validez pour utiliser la station en plein écran et accéder aux pages en cache hors ligne.</li>
              </ol>
              <button type="button" onClick={() => setShowIOSGuide(false)} className="btn btn-sm btn-primary mt-4 w-full">
                Compris
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const { notify } = useStore();
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    if (!isOnline) {
      wasOfflineRef.current = true;
    } else if (wasOfflineRef.current) {
      wasOfflineRef.current = false;
      notify('success', 'Connexion rétablie : les données serveur sont de nouveau synchronisées.');
    }
  }, [isOnline, notify]);

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-[110] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/95 px-3.5 py-2 text-xs font-semibold text-slate-950 shadow-xl backdrop-blur-md"
    >
      <FiWifiOff size={15} className="shrink-0" />
      <span>Hors ligne — Pages essentielles et dernières données disponibles en cache</span>
    </div>
  );
};
