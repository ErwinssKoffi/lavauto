import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { readNumber } from '../lib/validation';

/** Un brouillon par cellule : une seule écriture à la sortie, jamais par touche. */
export function PriceInput({ serviceId, categoryId, label, value }: {
  serviceId: string; categoryId: string; label: string; value: number | undefined;
}) {
  const { setPrice, notify, canWriteSubscription } = useStore();
  const [draft, setDraft] = useState(value ? String(value) : '');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => { setDraft(value ? String(value) : ''); }, [value]);
  const save = async () => {
    if (inFlight.current || !canWriteSubscription) return;
    const price = draft.trim() === '' ? 0 : readNumber(draft);
    if (price === (value ?? 0)) return;
    inFlight.current = true;
    setBusy(true);
    try { await setPrice(serviceId, categoryId, price); }
    catch (error) { notify('error', error instanceof Error ? error.message : 'Prix non enregistré.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <input type="number" min="0" step="500" placeholder="—" aria-label={label}
    className="input input-sm w-32!" disabled={busy || !canWriteSubscription} value={draft}
    onChange={(event) => setDraft(event.target.value)} onBlur={() => { void save(); }}
    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />;
}
