import React, { useState } from 'react';
import { FiAlertTriangle, FiDownload } from 'react-icons/fi';
import { downloadDemoBackup, readDemoState } from '../lib/demoStorage';
import { useStore } from '../lib/store';

/** Avertissement visible sur la vitrine, l'authentification et l'application.
 * Il ne change ni n'efface le stockage local déjà présent. */
export function DemoNotice({ className = '' }: { className?: string }) {
  const [error, setError] = useState('');
  const { demoStorageIssue, demoStoragePending } = useStore();
  const status = readDemoState().status;
  const download = () => {
    try { downloadDemoBackup(); setError(''); }
    catch { setError('Copie impossible : vérifiez les autorisations de stockage et de téléchargement du navigateur.'); }
  };
  return (
    <aside aria-label="Avertissement de démonstration" className={`border border-amber-500/50 bg-amber-100 px-4 py-3 text-sm text-amber-950 ${className}`}>
      <div className="mx-auto flex max-w-7xl items-start gap-3">
        <FiAlertTriangle className="mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p><strong>Démonstration uniquement.</strong> Les données restent dans ce navigateur et ne sont pas synchronisées avec Supabase. N’utilisez pas de données réelles ni de mot de passe personnel ou réutilisé. Ce mode n’est pas une authentification de production.</p>
          {status === 'unreadable' && <p role="alert" className="mt-2 font-bold">Les données locales sont illisibles. Elles n’ont pas été écrasées : téléchargez une copie avant toute récupération.</p>}
          {status === 'unavailable' && <p role="alert" className="mt-2 font-bold">Le stockage de ce navigateur est inaccessible : les données ne peuvent pas être conservées.</p>}
          {demoStorageIssue && <p role="alert" className="mt-2 font-bold">{demoStorageIssue} La copie téléchargée contient uniquement ce qui est déjà dans le stockage, pas les changements restés en mémoire.</p>}
          {demoStoragePending && <p role="status" className="mt-2 font-bold">Enregistrement local en cours : attendez sa confirmation avant de recharger, fermer ou télécharger une copie.</p>}
          <button type="button" onClick={download} className="mt-2 inline-flex items-center gap-1.5 font-bold underline underline-offset-2">
            <FiDownload /> Télécharger une copie des données locales
          </button>
          <p className="mt-1 text-xs">Fichier sensible non chiffré, avec données et empreintes de connexion de démonstration : conservez-le en lieu sûr. Ce n’est pas une sauvegarde Supabase.</p>
          {error && <p role="alert" className="mt-1 font-bold">{error}</p>}
        </div>
      </div>
    </aside>
  );
}
