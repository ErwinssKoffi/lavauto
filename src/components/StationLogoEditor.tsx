import React, { useEffect, useId, useRef, useState } from 'react';
import { FiRefreshCw, FiTrash2, FiUpload } from 'react-icons/fi';
import { LOGO_ACCEPT, validateStationLogo } from '../lib/image';
import { saveStationLogoPath, uploadStationLogo } from '../lib/qa';
import { useStore } from '../lib/store';
import { isSupabaseConfigured } from '../lib/supabase';
import { useStationLogoUrl } from '../lib/useStationLogoUrl';
import { Alert } from './ui';

/** Même parcours privé dans Paramètres et dans la mise en route. */
export function StationLogoEditor() {
  const { state, dataSource, authKind, setStationLogoPath, notify, canWriteSubscription } = useStore();
  const station = state.station;
  const session = state.session;
  const userId = session?.userId;
  const serverReady = (
    (dataSource === 'api' && authKind === 'api') ||
    (dataSource === 'supabase' && authKind === 'supabase' && isSupabaseConfigured)
  ) && Boolean(station?.id && userId)
    && station?.id === session?.stationId && station?.companyId === session?.companyId;
  const logoPath = station?.logoPath ?? null;
  const scope = `${userId ?? ''}:${station?.companyId ?? ''}:${station?.id ?? ''}`;
  const preview = useStationLogoUrl(logoPath, serverReady, scope);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    setFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }, [scope]);

  function selectFile(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.currentTarget.files?.[0] ?? null;
    const validationError = selected ? validateStationLogo(selected) : null;
    setError(validationError);
    setFile(validationError ? null : selected);
    if (validationError) event.currentTarget.value = '';
  }

  async function upload() {
    if (!serverReady || !canWriteSubscription || !station || !userId || !file || busy) return;
    const stationId = station.id;
    const operationScope = scope;
    setBusy('upload');
    setError(null);
    let uploaded = false;
    try {
      const result = await uploadStationLogo(file);
      uploaded = true;
      // Une session ou une station modifiée pendant l'envoi ne doit jamais
      // poursuivre l'association avec le contexte du nouvel utilisateur.
      if (!mounted.current || scopeRef.current !== operationScope) return;
      await saveStationLogoPath(stationId, result.path);
      // Ne conserver que le chemin, et seulement après confirmation du serveur.
      setStationLogoPath(stationId, userId, result.path);
      if (mounted.current && scopeRef.current === operationScope) {
        setFile(null);
        if (inputRef.current) inputRef.current.value = '';
        notify('success', 'Logo de la station enregistré.');
      }
    } catch (cause) {
      if (mounted.current && scopeRef.current === operationScope) {
        setError(uploaded
          ? 'Le fichier a été envoyé, mais son association à la station n’a pas pu être confirmée. Rechargez la page ou réessayez.'
          : cause instanceof Error ? cause.message : 'Envoi du logo impossible.');
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function remove() {
    if (!serverReady || !canWriteSubscription || !station || !userId || busy) return;
    const operationScope = scope;
    setBusy('remove');
    setError(null);
    try {
      await saveStationLogoPath(station.id, null);
      setStationLogoPath(station.id, userId, null);
      if (mounted.current && scopeRef.current === operationScope) {
        notify('success', 'Logo retiré de la station.');
      }
    } catch (cause) {
      if (mounted.current && scopeRef.current === operationScope) {
        setError(cause instanceof Error ? cause.message : 'Retrait du logo impossible.');
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  return (
    <section aria-label="Logo de la station" className="mt-5 border-t pt-4">
      <h3 className="text-sm font-bold">Logo de la station</h3>
      <p id={`${inputId}-hint`} className="text-base-content/60 mt-1 text-xs leading-relaxed">
        PNG, JPEG ou WebP, 5 Mo maximum. Le fichier est optimisé si possible et conservé dans un stockage privé.
      </p>
      {!serverReady && (
        <div className="mt-3"><Alert kind="info">Téléversement du logo indisponible en mode local : connectez une session serveur active.</Alert></div>
      )}
      {serverReady && logoPath && (
        <div className="mt-3" aria-live="polite">
          {preview.url && <img src={preview.url} alt="Logo actuel de la station" onError={preview.imageFailed} className="h-20 w-20 rounded-xl border bg-base-100 object-contain p-1" />}
          {preview.loading && <p className="text-base-content/60 text-xs">Chargement de l’aperçu sécurisé…</p>}
          {preview.error && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-warning">
              <span>Impossible d’afficher le logo. Vérifiez votre connexion et vos droits.</span>
              <button type="button" className="link link-primary inline-flex items-center gap-1" onClick={preview.retry}><FiRefreshCw /> Réessayer l’aperçu</button>
            </div>
          )}
        </div>
      )}
      <label htmlFor={inputId} className="label mt-4 block">Choisir un fichier logo</label>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={LOGO_ACCEPT}
        aria-describedby={`${inputId}-hint`}
        className="block w-full text-xs text-base-content/70 file:mr-3 file:rounded-lg file:border-0 file:bg-primary/15 file:px-3 file:py-2 file:font-semibold file:text-primary disabled:opacity-50"
        disabled={!serverReady || !canWriteSubscription || Boolean(busy)}
        onChange={selectFile}
      />
      {error && <p role="alert" className="mt-2 text-xs text-error">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm btn-primary" disabled={!serverReady || !canWriteSubscription || !file || Boolean(busy)} onClick={() => { void upload(); }}>
          <FiUpload /> {busy === 'upload' ? 'Enregistrement…' : 'Enregistrer le logo'}
        </button>
        {logoPath && serverReady && (
          <button type="button" className="btn btn-sm" disabled={!canWriteSubscription || Boolean(busy)} onClick={() => { void remove(); }}>
            <FiTrash2 /> {busy === 'remove' ? 'Retrait…' : 'Retirer le logo'}
          </button>
        )}
      </div>
      {logoPath && serverReady && <p className="text-base-content/60 mt-2 text-xs">Le remplacement ou le retrait dissocie l’ancien logo, mais ne supprime pas son fichier du stockage privé.</p>}
    </section>
  );
}
