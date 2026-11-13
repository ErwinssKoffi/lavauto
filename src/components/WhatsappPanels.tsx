import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiRefreshCw, FiSend } from 'react-icons/fi';
import { supabase } from '../lib/supabase';
import { useStore } from '../lib/store';
import { usePermissions } from '../lib/usePermissions';
import { formatDateTime } from '../lib/format';
import type { Wash } from '../types';
import {
  SupabaseWhatsappCommands, type WhatsappConsent, type WhatsappJournalEntry,
  type WhatsappRpcClient, type WhatsappStatus,
} from '../services/adapters/SupabaseWhatsappCommands';
import { Alert, Badge, Input } from './ui';

const commands = supabase ? new SupabaseWhatsappCommands(supabase as unknown as WhatsappRpcClient) : null;
const label: Record<WhatsappStatus, string> = {
  blocked: 'Bloqué avant mise en attente',
  pending: 'En attente d’expédition',
  sending: 'Transmission en cours',
  accepted: 'Accepté par Meta, livraison non confirmée',
  sent: 'Envoyé par Meta, livraison non confirmée',
  delivered: 'Livré, confirmé par Meta',
  read: 'Lu, livraison confirmée par Meta',
  failed: 'Échec signalé',
  cancelled: 'Annulé avant envoi',
  unknown: 'Résultat incertain — ne pas renvoyer',
};
const reasons: Record<string, string> = {
  no_customer: 'Aucune fiche client rattachée.', no_consent: 'Aucun accord WhatsApp explicite.',
  invalid_phone: 'Numéro international ou accord périmé.', phone_changed: 'Numéro du client modifié.',
  consent_revoked: 'Accord retiré par le client.', consent_replaced: 'Nouvel accord enregistré.',
  consent_changed: 'Accord ou numéro modifié avant expédition.',
  wash_no_longer_ready: 'Le lavage n’est plus au statut prêt.', station_unavailable: 'Station indisponible.',
  delivery_confirmed_elsewhere: 'Une autre tentative a été confirmée livrée avant l’expédition de cette relance.',
  claim_expired: 'Traitement interrompu : vérification nécessaire avant toute relance.',
  network_uncertain: 'Réponse réseau incertaine : vérifier auprès de Meta.',
  missing_message_id: 'Réponse Meta sans identifiant : vérifier avant toute relance.',
  held_for_quality_assessment: 'Meta examine le message ; la livraison n’est pas confirmée.',
  invalid_claim: 'Données de notification invalides.',
};
function reason(value: string | null): string {
  if (!value) return '';
  return reasons[value] ?? `Code fournisseur / technique : ${value}`;
}
function tone(status: WhatsappStatus): 'success' | 'warn' | 'danger' | 'neutral' | 'accent' {
  if (status === 'delivered' || status === 'read') return 'success';
  if (status === 'failed' || status === 'blocked' || status === 'unknown') return 'danger';
  if (status === 'pending' || status === 'sending') return 'warn';
  if (status === 'accepted' || status === 'sent') return 'accent';
  return 'neutral';
}
function useConnectedWhatsapp(): boolean {
  const { dataSource, authKind, authReady, identity } = useStore();
  return dataSource === 'supabase' && authKind === 'supabase' && authReady && Boolean(identity && commands);
}

export function WhatsappConsentPanel({ customerId, phone }: { customerId: string; phone: string }) {
  const connected = useConnectedWhatsapp();
  const { canWriteSubscription } = useStore();
  const { can } = usePermissions();
  const [data, setData] = useState<WhatsappConsent | null>(null);
  const [source, setSource] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const refresh = useCallback(async () => {
    if (!connected || !commands) return;
    const result = await commands.consent(customerId);
    setData(result); setError('');
    return result;
  }, [connected, customerId]);
  useEffect(() => {
    let active = true;
    setData(null); setError(''); setNotice(''); setSource(''); setConfirmed(false);
    if (connected && commands) void commands.consent(customerId).then((result) => {
      if (active) setData(result);
    }).catch((e: unknown) => {
      if (active) setError(e instanceof Error ? e.message : 'Consentement inaccessible.');
    });
    return () => { active = false; };
  }, [connected, customerId, phone]);
  const reload = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice('');
    try {
      if (!await refresh()) throw new Error('Relecture du consentement indisponible.');
      setSource(''); setConfirmed(false);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : 'Consentement inaccessible.');
    } finally { busyRef.current = false; setBusy(false); }
  };
  const save = async (granted: boolean) => {
    // Un retrait peut être demandé même si l'abonnement n'est pas inscriptible
    // ou si sa relecture a échoué. Le serveur vérifie les permissions, la
    // station et le motif de lecture seule ; seul l'accord exige une écriture.
    if (!connected || !commands || !can('customers.manage') || (granted && !canWriteSubscription) || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await commands.saveConsent(customerId, granted, source.trim(), phone);
      const current = await refresh();
      if (!current) throw new Error('Relecture du consentement indisponible.');
      setSource(''); setConfirmed(false);
      setNotice(current.granted !== granted
        ? 'L’état du consentement a changé depuis la demande ; vérifiez la fiche avant de poursuivre.'
        : granted ? 'Accord WhatsApp enregistré. Une fiche déjà prête doit être demandée manuellement.'
          : 'Accord retiré ; les demandes en attente non réclamées sont annulées. Une transmission déjà réclamée peut encore atteindre Meta.');
    } catch (e) {
      // La commande peut avoir abouti malgré une réponse perdue ou invalide,
      // ou être encore en vol pendant une relecture de l'ancien état.
      setData(null);
      setError(`Enregistrement non confirmé : ${e instanceof Error ? e.message : 'erreur réseau'}. La demande peut encore être en cours ; actualisez le consentement et contactez le support avant toute reprise des envois si le retrait reste incertain.`);
    } finally { busyRef.current = false; setBusy(false); }
  };
  return (
    <section className="mt-6 rounded-xl border border-emerald-500/30 p-4" aria-label="Consentement WhatsApp">
      <h3 className="text-sm font-bold">Consentement WhatsApp · lavage prêt</h3>
      <p className="text-base-content/60 mt-2 text-xs">Accord distinct du canal préféré et de la fidélité. Il couvre uniquement les messages de disponibilité du lavage, automatiques ou manuels, au numéro enregistré. Le client peut demander son retrait à tout moment.</p>
      {connected && !canWriteSubscription && <div className="mt-3"><Alert kind="warn">Après expiration, vous pouvez demander le retrait avec sa preuve ; le serveur vérifiera les droits et la station. Un nouvel accord reste bloqué en lecture seule. Si le retrait est refusé ou non confirmé, contactez le support avant toute reprise des envois.</Alert></div>}
      {!connected ? <p className="text-base-content/60 mt-3 text-xs">Enregistrement du consentement WhatsApp actif lorsque le connecteur Meta Cloud API est configuré.</p> : <>
        {error && <div className="mt-3 space-y-2"><Alert kind="danger">{error}</Alert>
          <button className="btn btn-sm" disabled={busy} onClick={() => { void reload(); }}><FiRefreshCw /> Actualiser le consentement</button>
        </div>}
        {notice && <div className="mt-3"><Alert kind="info">{notice}</Alert></div>}
        {!data && !error && <p className="text-base-content/60 mt-3 text-xs">Chargement du consentement…</p>}
        {data && <>
          <p className="mt-3 text-xs"><Badge tone={data.granted ? 'success' : 'warn'}>{data.granted ? 'Accord enregistré' : 'Aucun accord actif'}</Badge>{data.granted && <> · {data.phone} · {formatDateTime(data.at)}</>}</p>
          <p className="text-base-content/60 mt-2 text-xs">Téléphone actuellement enregistré : {phone || 'non renseigné'}. Pour accorder le consentement, utilisez un numéro international avec + et indicatif, par exemple +2250700000000. Enregistrez la fiche client avant cet accord.</p>
          {can('customers.manage') && <div className="mt-3 space-y-3">
            <Input label="Origine / preuve de l’accord ou du retrait *" disabled={busy || (!data.granted && !canWriteSubscription)} value={source} maxLength={500} onChange={(e) => setSource(e.target.value)} placeholder="Ex. accord oral au comptoir le 12/11/2026" hint="Indiquez la façon dont le client a donné ou retiré son accord, sans données sensibles." />
            {!data.granted && <label className="flex items-start gap-2 text-xs"><input type="checkbox" disabled={!canWriteSubscription || busy} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /><span>Je confirme que le client a explicitement accepté de recevoir sur WhatsApp les avis de lavage prêt à ce numéro.</span></label>}
            <div className="flex flex-wrap gap-2">
              {!data.granted && <button className="btn btn-sm btn-primary" disabled={!canWriteSubscription || busy || !confirmed || source.trim().length < 5} onClick={() => { void save(true); }}>Enregistrer l’accord WhatsApp</button>}
              {data.granted && <button className="btn btn-sm btn-error btn-outline" disabled={busy || source.trim().length < 5} onClick={() => { void save(false); }}>Retirer l’accord WhatsApp</button>}
            </div>
            <p className="text-base-content/60 text-[11px]">Un retrait ou un changement de numéro annule les demandes non encore réclamées. Une transmission déjà réclamée ne peut pas être rappelée et peut encore atteindre Meta.</p>
          </div>}
          {data.history.length > 0 && <details className="mt-3 text-xs"><summary className="cursor-pointer font-semibold">Historique des accords et retraits</summary>
            <ul className="mt-2 space-y-1">{data.history.map((event, index) => <li key={`${event.at}-${index}`}>
              {event.kind === 'granted' ? 'Accord' : 'Retrait'} · {formatDateTime(event.at)} · {event.actor} · {event.source}{event.phone ? ` · ${event.phone}` : ''}
            </li>)}</ul>
          </details>}
        </>}
      </>}
    </section>
  );
}

const IN_FLIGHT_OR_FINISHED: WhatsappStatus[] = ['pending', 'sending', 'unknown', 'accepted', 'sent', 'delivered', 'read'];
export function WhatsappWashPanel({ wash }: { wash: Wash }) {
  const connected = useConnectedWhatsapp();
  const { canWriteSubscription } = useStore();
  const { can } = usePermissions();
  const [entries, setEntries] = useState<WhatsappJournalEntry[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const requestKey = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    if (!commands || !connected) return null;
    const result = await commands.journal(wash.id);
    setEntries(result); setError('');
    return result;
  }, [connected, wash.id]);
  useEffect(() => {
    let active = true;
    setEntries(null); setError(''); setNotice(''); requestKey.current = null;
    if (connected && commands) void commands.journal(wash.id).then((result) => {
      if (active) setEntries(result);
    }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : 'Journal inaccessible.'); });
    return () => { active = false; };
  }, [connected, wash.id, wash.status]);
  const enqueue = async () => {
    if (!commands || !canWriteSubscription || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    const key = requestKey.current ?? crypto.randomUUID();
    requestKey.current = key;
    try {
      const notificationId = await commands.enqueue(wash.id, key);
      // La RPC ne fait que mettre en attente ou retrouver une demande existante.
      // Garder la clé si sa relecture échoue, pour une reprise sans doublon.
      const journal = await refresh();
      const entry = journal?.find((row) => row.id.toLowerCase() === notificationId.toLowerCase());
      if (!entry) throw new Error('Demande absente des 50 dernières entrées du journal.');
      requestKey.current = null;
      setNotice(entry.status === 'delivered' || entry.status === 'read'
        ? 'Demande enregistrée ou retrouvée : livraison confirmée par Meta.'
        : IN_FLIGHT_OR_FINISHED.includes(entry.status)
          ? 'Demande enregistrée ou déjà existante. La livraison de cette demande n’est pas encore confirmée.'
          : 'Demande enregistrée ou déjà existante. Consultez son état dans le journal.');
    } catch (e) {
      setError(`Demande non confirmée : ${e instanceof Error ? e.message : 'erreur réseau'}. Actualisez le journal avant une nouvelle demande.`);
    } finally { busyRef.current = false; setBusy(false); }
  };
  const existing = entries?.some((entry) => IN_FLIGHT_OR_FINISHED.includes(entry.status));
  return (
    <section className="mt-5 rounded-xl border border-emerald-500/30 p-4" aria-label="Notifications WhatsApp">
      <h3 className="text-sm font-bold">Notification WhatsApp · lavage prêt</h3>
      {!connected ? <p className="text-base-content/60 mt-2 text-xs">L’envoi automatique WhatsApp requiert la configuration du fournisseur Meta Cloud API.</p> : <>
        <p className="text-base-content/60 mt-2 text-xs">Une demande automatique est créée au passage à « prêt ». L’envoi nécessite un accord explicite, un fournisseur configuré et un ordonnanceur actif. La demande manuelle ne duplique pas un envoi déjà en cours ou confirmé.</p>
        {error && <div className="mt-3"><Alert kind="danger">{error}</Alert></div>}
        {notice && <div className="mt-3"><Alert kind="info">{notice}</Alert></div>}
        {!entries && !error && <p className="text-base-content/60 mt-3 text-xs">Chargement du journal…</p>}
        {entries && <div className="mt-3 space-y-2">
          {entries.length === 0 && <p className="text-base-content/60 text-xs">Aucune demande enregistrée pour cette fiche.</p>}
          {entries.map((entry) => <div key={entry.id} className="rounded-lg border p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2"><Badge tone={tone(entry.status)}>{label[entry.status]}</Badge>
              <span>{entry.origin === 'automatic' ? 'Automatique' : 'Manuelle'} · {formatDateTime(entry.createdAt)}</span></div>
            {entry.reason && <p className="text-base-content/60 mt-2">{reason(entry.reason)}</p>}
            {entry.providerMessageId && <p className="text-base-content/60 mt-1 break-all">Référence Meta : {entry.providerMessageId}</p>}
            {entry.events.length > 0 && <details className="mt-2"><summary className="cursor-pointer font-semibold">Détail du journal</summary>
              <ul className="mt-2 space-y-1">{entry.events.map((event, index) => <li key={`${event.at}-${index}`}>
                {label[event.kind]} · {formatDateTime(event.at)}{event.providerAt ? ` (heure Meta : ${formatDateTime(event.providerAt)})` : ''}{event.reason ? ` · ${reason(event.reason)}` : ''}
              </li>)}</ul>
            </details>}
          </div>)}
        </div>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn btn-sm" disabled={busy} onClick={() => { void refresh().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Journal inaccessible.')); }}><FiRefreshCw /> Actualiser le journal</button>
          {(can('notifications.enqueue') || can('customers.manage')) && <button className="btn btn-sm btn-primary" disabled={!canWriteSubscription || busy || !entries || wash.status !== 'ready' || !wash.clientId || existing} onClick={() => { void enqueue(); }}><FiSend /> Demander l’envoi WhatsApp</button>}
        </div>
        {existing && <p className="text-base-content/60 mt-2 text-[11px]">Une demande est déjà en attente, en cours ou confirmée. Un résultat incertain ne doit pas être réexpédié sans vérification.</p>}
        {wash.status !== 'ready' && <p className="text-base-content/60 mt-2 text-[11px]">La demande manuelle est disponible uniquement lorsque le lavage est prêt et non encore livré.</p>}
      </>}
    </section>
  );
}
