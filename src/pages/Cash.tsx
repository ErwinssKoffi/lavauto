import { readNumber } from '../lib/validation';
import React, { useState } from 'react';
import {
  FiCheckCircle, FiDollarSign, FiLock, FiPlus, FiRefreshCw, FiRotateCcw, FiX,
} from 'react-icons/fi';
import { useStore } from '../lib/store';
import {
  formatDate, formatDateTime, formatFCFA, todayISO,
} from '../lib/format';
import { theoreticalCash } from '../lib/metrics';
import { channelExpected, financeSnapshotFromState } from '../lib/finance';
import { PAY_METHOD_LABELS, type CashClosure } from '../types';
import {
  Alert, Badge, Card, EmptyState, Input, LockedPanel, Modal, PageHeader,
  StatCard, useSafeAction,
} from '../components/ui';

export default function Cash() {
  const {
    state, dataSource, authReady, identity, openCash, closeCash, reopenCash,
    reconcileChannel, refreshFinance,
  } = useStore();
  const safe = useSafeAction();
  const [openMode, setOpenMode] = useState(false);
  const [float, setFloat] = useState(0);
  const [closeMode, setCloseMode] = useState(false);
  const [counted, setCounted] = useState(0);
  const [reopenId, setReopenId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  const [countedByMethod, setCountedByMethod] = useState<Record<string, number | ''>>({});
  const activated = Boolean(state.station?.activated);
  const open = state.cashSessions.find((c) => c.status === 'ouverte');
  const theoretical = open ? theoreticalCash(state, open.id) : 0;
  const methods = financeSnapshotFromState(state).paymentMethods.filter((m) => m.active);
  const closures = state.cashClosures ?? [];
  const reconciliations = state.reconciliations ?? [];
  const movements = state.cashMovements ?? [];
  const latestClosure = (sessionId: string): CashClosure | undefined =>
    [...closures].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .find((c) => c.cashSessionId === sessionId);

  return (
    <div>
      <PageHeader title="Caisse" subtitle="Fond théorique, mouvements signés, clôtures immuables et rapprochement par canal : espèces ≠ Mobile Money."
        actions={<div className="flex gap-2">
          {dataSource === 'supabase' && authReady && identity &&
            <button className="wg-btn wg-btn-ghost" onClick={() => safe(() => refreshFinance())}><FiRefreshCw /> Actualiser</button>}
          {open
            ? <button className="wg-btn wg-btn-danger" disabled={!activated} onClick={() => { setCounted(theoretical); setCloseMode(true); }}><FiLock /> Clôturer avec comptage</button>
            : <button className="wg-btn wg-btn-primary" disabled={!activated} onClick={() => setOpenMode(true)}><FiPlus /> Ouvrir la caisse</button>}
        </div>}
      />
      {!activated && <div className="mb-5"><LockedPanel /></div>}

      <div className="mb-5"><Alert kind={dataSource === 'supabase' || state.station?.cashRequiresOpen ? 'warn' : 'info'}>
        {dataSource === 'supabase'
          ? 'En mode connecté, un encaissement en espèces exige une caisse ouverte. Les autres canaux ne créent pas de mouvement de caisse espèces.'
          : state.station?.cashRequiresOpen
            ? 'Règle active : un encaissement en espèces exige une caisse ouverte. Le Mobile Money, la carte et le virement ne créent aucun mouvement de caisse espèces.'
            : 'Règle désactivée pour cette station : les encaissements en espèces ne nécessitent pas de caisse ouverte.'}
      </Alert></div>

      {open ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="État" value="Caisse ouverte" hint={`Depuis le ${formatDateTime(open.openedAt)}`} icon={<FiCheckCircle />} accent="bg-emerald-500/10 text-emerald-400" />
          <StatCard label="Fond de caisse" value={formatFCFA(open.openingFloat)} hint={`Ouverte par ${open.openedBy}`} icon={<FiDollarSign />} />
          <StatCard label="Théorique en caisse" value={formatFCFA(theoretical)} hint="Fond + encaissements − décaissements" icon={<FiDollarSign />} accent="bg-sky-500/10 text-sky-400" />
          <StatCard label="Mouvements" value={String(movements.filter((m) => m.cashSessionId === open.id).length)} hint="Journal P06 signé" icon={<FiDollarSign />} accent="bg-amber-500/10 text-amber-400" />
        </div>
      ) : (
        <Card className="mb-5"><EmptyState icon={<FiDollarSign />} title="Aucune caisse ouverte" description="Ouvrez une caisse avec un fond pour autoriser les encaissements en espèces. Les autres moyens de paiement restent enregistrables." action={activated ? <button className="wg-btn wg-btn-primary" onClick={() => setOpenMode(true)}><FiPlus /> Ouvrir la caisse</button> : undefined} /></Card>
      )}

      <Card className="mt-5">
        <h2 className="mb-4 text-sm font-bold">Historique des caisses</h2>
        {state.cashSessions.length === 0 ? <p className="wg-muted text-xs">Aucune caisse enregistrée.</p> : (
          <div className="wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}>
            <table>
              <thead><tr><th className="wg-th">Ouverture</th><th className="wg-th">Fond</th><th className="wg-th">Clôture</th><th className="wg-th">Théorique</th><th className="wg-th">Compté</th><th className="wg-th">Écart</th><th className="wg-th">État</th><th className="wg-th" /></tr></thead>
              <tbody>
                {state.cashSessions.map((c) => {
                  const closure = latestClosure(c.id);
                  const theo = c.status === 'ouverte'
                    ? theoreticalCash(state, c.id)
                    : closure?.theoretical ?? theoreticalCash(state, c.id);
                  const countedValue = closure?.counted ?? c.countedAmount;
                  const ecart = closure?.difference ?? (countedValue === null ? null : countedValue - theo);
                  return (
                    <tr key={c.id}>
                      <td className="wg-td">{formatDateTime(c.openedAt)}<p className="wg-muted text-xs">{c.openedBy}</p></td>
                      <td className="wg-td">{formatFCFA(c.openingFloat)}</td>
                      <td className="wg-td">{c.closedAt ? formatDateTime(c.closedAt) : '—'}</td>
                      <td className="wg-td">{formatFCFA(theo)}</td>
                      <td className="wg-td">{countedValue === null ? '—' : formatFCFA(countedValue)}</td>
                      <td className="wg-td">{ecart === null || ecart === undefined ? '—' : <span className={ecart === 0 ? 'text-emerald-400' : 'text-amber-400'}>{ecart > 0 ? '+' : ''}{formatFCFA(ecart)}</span>}</td>
                      <td className="wg-td"><Badge tone={c.status === 'ouverte' ? 'success' : 'neutral'}>{c.status === 'ouverte' ? 'Ouverte' : 'Clôturée'}</Badge></td>
                      <td className="wg-td">
                        {c.status === 'cloturee' && !open && <button className="wg-link text-xs" onClick={() => { setReopenId(c.id); setReason(''); }}><FiRotateCcw className="inline" /> Réouvrir</button>}
                        {c.reopenReason && <p className="wg-muted mt-1 text-[10px]">Motif : {c.reopenReason}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-5">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold">Relevés de clôture immuables</h2><Badge>{closures.length} relevé(s)</Badge></div>
        {closures.length === 0 ? <p className="wg-muted text-xs">Aucun relevé : une clôture crée un relevé figé, jamais une réécriture du comptage.</p> : (
          <div className="wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}>
            <table><thead><tr><th className="wg-th">Date</th><th className="wg-th">Session</th><th className="wg-th">Théorique</th><th className="wg-th">Compté</th><th className="wg-th">Écart conservé</th></tr></thead>
              <tbody>{[...closures].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => (
                <tr key={c.id}><td className="wg-td">{formatDateTime(c.createdAt)}</td><td className="wg-td">{c.cashSessionId.slice(0, 8)}</td>
                  <td className="wg-td">{formatFCFA(c.theoretical)}</td><td className="wg-td">{formatFCFA(c.counted)}</td>
                  <td className="wg-td font-bold">{c.difference > 0 ? '+' : ''}{formatFCFA(c.difference)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold">Rapprochement par canal</h2>
          <div className="flex flex-wrap gap-2">
            <Input label="Début de la période" type="date" value={start} onChange={(e) => { setStart(e.target.value); setCountedByMethod({}); }} />
            <Input label="Fin de la période" type="date" value={end} onChange={(e) => { setEnd(e.target.value); setCountedByMethod({}); }} />
          </div>
        </div>
        <p className="wg-muted mb-4 text-xs">Chaque canal est rapproché séparément. Un relevé validé est figé : aucun recalcul, aucune modification.
          {dataSource === 'supabase' && ' Avant validation, l’aperçu est une estimation sur les fiches chargées (200 au maximum). Le serveur recalcule le montant attendu ; saisissez votre comptage réel.'}
        </p>
        {methods.length === 0 ? <p className="wg-muted text-xs">Aucun moyen de paiement configuré.</p> : (
          <div className="grid gap-3 lg:grid-cols-2">
            {methods.map((m) => {
              const frozenRecord = reconciliations.find(
                (r) => r.methodId === m.id && r.start === start && r.end === end && r.frozen
              );
              const frozen = Boolean(frozenRecord);
              const expected = frozenRecord?.expected ?? channelExpected(state, m.id, start, end);
              // Un comptage est une saisie de l'opérateur, pas une copie d'une
              // estimation potentiellement limitée à 200 fiches côté serveur.
              const value = countedByMethod[m.id] ?? frozenRecord?.counted
                ?? (dataSource === 'supabase' ? '' : Math.max(0, expected));
              const invalid = value === '' || !Number.isSafeInteger(value) || value < 0;
              const name = m.label || PAY_METHOD_LABELS[m.uiMethod];
              return (
                <div key={m.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--wg-border)' }}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-bold">{name}</span>
                    <Badge tone={frozen ? 'success' : 'warn'}>{frozen ? 'Figé' : 'À rapprocher'}</Badge>
                  </div>
                  <p className="wg-muted text-xs">{!frozen && dataSource === 'supabase' ? 'Estimation sur les fiches chargées' : 'Attendu sur la période'} : {formatFCFA(expected)} · {m.affectsCash ? 'impacte la caisse espèces' : 'hors caisse espèces'}</p>
                  <div className="mt-3 flex gap-2">
                    <Input label={`Compté ${name} (FCFA)`} type="number" min="0" step="1" value={value} disabled={frozen}
                      hint={!frozen ? 'Saisissez un montant entier positif ou nul.' : undefined}
                      onChange={(e) => setCountedByMethod({ ...countedByMethod, [m.id]: e.target.value === '' ? '' : readNumber(e.target.value) })} />
                    <button className="wg-btn wg-btn-primary whitespace-nowrap" disabled={frozen || !activated || invalid}
                      onClick={() => { if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) void safe(async () => { await reconcileChannel(m.id, start, end, value); }); }}>
                      <FiLock /> Figer
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {reconciliations.length > 0 && (
          <div className="mt-4 wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}>
            <table><thead><tr><th className="wg-th">Canal</th><th className="wg-th">Période</th><th className="wg-th">Attendu</th><th className="wg-th">Compté</th><th className="wg-th">Écart</th></tr></thead>
              <tbody>{reconciliations.map((r) => (
                <tr key={r.id}><td className="wg-td">{PAY_METHOD_LABELS[r.uiMethod]}</td><td className="wg-td">{formatDate(r.start)} – {formatDate(r.end)}</td>
                  <td className="wg-td">{formatFCFA(r.expected)}</td><td className="wg-td">{formatFCFA(r.counted)}</td>
                  <td className="wg-td">{formatFCFA(r.difference)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-5">
        <h2 className="mb-3 text-sm font-bold">Journal des mouvements de caisse</h2>
        {movements.length === 0 ? <p className="wg-muted text-xs">Aucun mouvement : les encaissements et dépenses en espèces alimentent ce journal.</p> : (
          <div className="space-y-1.5">
            {[...movements].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20).map((m) => (
              <div key={m.id} className="wg-muted flex flex-wrap justify-between gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--wg-surface-2)' }}>
                <span>{formatDateTime(m.createdAt)} · {m.kind} · {m.reference || (m.uiMethod ? PAY_METHOD_LABELS[m.uiMethod] : 'Ajustement')}</span>
                <span className="font-bold">{m.amount > 0 ? '+' : ''}{formatFCFA(m.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={openMode} onClose={() => setOpenMode(false)} title="Ouvrir la caisse">
        <Input label="Fond de caisse (FCFA) *" type="number" min="0" value={float} onChange={(e) => setFloat(readNumber(e.target.value))} hint="Montant en espèces présent au départ." />
        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" onClick={() => setOpenMode(false)}><FiX /> Annuler</button>
          <button className="wg-btn wg-btn-primary" onClick={() => safe(async () => { await openCash(float); setOpenMode(false); })}>Ouvrir la caisse</button>
        </div>
      </Modal>

      <Modal open={closeMode} onClose={() => setCloseMode(false)} title="Clôturer la caisse avec comptage">
        <p className="wg-muted mb-4 text-sm leading-relaxed">
          Comptez physiquement les espèces en caisse et saisissez le montant. L’écart avec le théorique est calculé en temps réel et scellé de manière immuable.
        </p>

        {open && (
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Card className="!p-3">
              <p className="wg-muted text-[11px]">Fond de départ</p>
              <p className="mt-1 font-semibold">{formatFCFA(open.openingFloat)}</p>
            </Card>
            <Card className="!p-3">
              <p className="wg-muted text-[11px]">Théorique attendu</p>
              <p className="mt-1 font-bold text-sky-400">{formatFCFA(theoretical)}</p>
            </Card>
            <Card className="!p-3">
              <p className="wg-muted text-[11px]">Écart au comptage</p>
              <p className={`mt-1 font-bold ${counted - theoretical === 0 ? 'text-emerald-400' : counted - theoretical > 0 ? 'text-sky-400' : 'text-red-400'}`}>
                {counted - theoretical > 0 ? '+' : ''}{formatFCFA(counted - theoretical)}
              </p>
            </Card>
          </div>
        )}

        {counted - theoretical !== 0 && (
          <div
            className="mb-4 rounded-xl border p-3 text-xs leading-relaxed"
            style={{
              background: counted - theoretical > 0 ? 'rgba(56, 189, 248, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              borderColor: counted - theoretical > 0 ? 'rgba(56, 189, 248, 0.3)' : 'rgba(239, 68, 68, 0.3)',
            }}
          >
            <p className="font-bold mb-1" style={{ color: counted - theoretical > 0 ? '#38bdf8' : '#f87171' }}>
              {counted - theoretical > 0 ? 'Excédent de caisse détecté' : 'Déficit de caisse constaté'}
            </p>
            <p className="wg-muted">
              {counted - theoretical > 0
                ? `Le comptage physique dépasse le solde théorique de ${formatFCFA(counted - theoretical)}. L'écart sera conservé dans le relevé immuable.`
                : `Il manque ${formatFCFA(Math.abs(counted - theoretical))} par rapport aux flux enregistrés. Cet écart sera scellé dans le journal d'audit.`}
            </p>
          </div>
        )}

        <Input
          label="Montant physique compté (FCFA) *"
          type="number"
          min="0"
          value={counted}
          onChange={(e) => setCounted(readNumber(e.target.value))}
          hint="Saisissez la valeur exacte des billets et pièces comptés."
        />

        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" onClick={() => setCloseMode(false)}>Annuler</button>
          <button
            className="wg-btn wg-btn-primary"
            onClick={() => safe(async () => {
              await closeCash(counted);
              setCloseMode(false);
            })}
          >
            <FiLock /> Sceller et clôturer
          </button>
        </div>
      </Modal>

      <Modal open={Boolean(reopenId)} onClose={() => setReopenId(null)} title="Réouverture motivée">
        <p className="wg-muted mb-4 text-sm">Toute réouverture doit être motivée. Le dernier comptage devient le nouveau fond ; les mouvements précédents ne sont pas recomptés.</p>
        <Input label="Motif *" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. erreur de comptage à la clôture" />
        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" onClick={() => setReopenId(null)}>Annuler</button>
          <button className="wg-btn wg-btn-primary" onClick={() => safe(async () => { if (reopenId) await reopenCash(reopenId, reason); setReopenId(null); })}><FiRotateCcw /> Réouvrir</button>
        </div>
      </Modal>
    </div>
  );
}
