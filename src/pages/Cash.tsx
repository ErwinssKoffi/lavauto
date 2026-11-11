import React, { useState } from 'react';
import { FiCheckCircle, FiDollarSign, FiLock, FiPlus, FiRotateCcw, FiX } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { formatDate, formatDateTime, formatFCFA } from '../lib/format';
import { theoreticalCash } from '../lib/metrics';
import { PAY_METHOD_LABELS } from '../types';
import { Alert, Badge, Breadcrumbs, Card, EmptyState, Input, LockedPanel, Modal, PageHeader, StatCard, useSafeAction } from '../components/ui';

export default function Cash() {
  const { state, openCash, closeCash, reopenCash } = useStore();
  const safe = useSafeAction();
  const [openMode, setOpenMode] = useState(false);
  const [float, setFloat] = useState(0);
  const [closeMode, setCloseMode] = useState(false);
  const [counted, setCounted] = useState(0);
  const [reopenId, setReopenId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const currentStationId = state.station?.id;
  const activated = Boolean(state.station?.activated);
  const stationSessions = state.cashSessions.filter(
    (c) => !currentStationId || c.stationId === currentStationId
  );
  const open = stationSessions.find((c) => c.status === 'ouverte');
  const theoretical = open ? theoreticalCash(state, open.id) : 0;

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Gestion financière', to: '/app/caisse' }, { label: 'Caisse & Sessions' }]} />
      <PageHeader title="Caisse" subtitle="Ouverture avec fond de caisse, encaissements, dépenses, clôture avec comptage et écart théorique / compté."
        actions={open
          ? <button className="wg-btn wg-btn-danger" disabled={!activated} onClick={() => { setCounted(theoretical); setCloseMode(true); }}><FiLock /> Clôturer avec comptage</button>
          : <button className="wg-btn wg-btn-primary" disabled={!activated} onClick={() => setOpenMode(true)}><FiPlus /> Ouvrir la caisse</button>}
      />
      {!activated && <div className="mb-5"><LockedPanel /></div>}

      <div className="mb-5"><Alert kind={state.station?.cashRequiresOpen ? 'warn' : 'info'}>
        {state.station?.cashRequiresOpen
          ? 'Règle active : un encaissement en espèces exige une caisse ouverte. Elle est désactivable station par station dans Paramètres. Le Mobile Money peut être enregistré à tout moment.'
          : 'Règle désactivée pour cette station : les encaissements en espèces ne nécessitent pas de caisse ouverte.'}
      </Alert></div>

      {open ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="État" value="Caisse ouverte" hint={`Depuis le ${formatDateTime(open.openedAt)}`} icon={<FiCheckCircle />} accent="bg-emerald-500/10 text-emerald-400" />
          <StatCard label="Fond de caisse" value={formatFCFA(open.openingFloat)} hint={`Ouverte par ${open.openedBy}`} icon={<FiDollarSign />} />
          <StatCard label="Théorique en caisse" value={formatFCFA(theoretical)} hint="Fond + espèces − dépenses espèces" icon={<FiDollarSign />} accent="bg-sky-500/10 text-sky-400" />
          <StatCard label="Dépenses liées" value={formatFCFA(state.expenses.filter((e) => e.cashSessionId === open.id && e.status === 'enregistree').reduce((s, e) => s + e.amount, 0))} hint="Rattachement automatique" icon={<FiDollarSign />} accent="bg-amber-500/10 text-amber-400" />
        </div>
      ) : (
        <Card className="mb-5"><EmptyState icon={<FiDollarSign />} title="Aucune caisse ouverte" description="Ouvrez une caisse avec un fond pour autoriser les encaissements en espèces. Les autres moyens de paiement restent enregistrables." action={activated ? <button className="wg-btn wg-btn-primary" onClick={() => setOpenMode(true)}><FiPlus /> Ouvrir la caisse</button> : undefined} /></Card>
      )}

      <Card className="mt-5">
        <h2 className="mb-4 text-sm font-bold">Historique des caisses</h2>
        {stationSessions.length === 0 ? <p className="wg-muted text-xs">Aucune caisse enregistrée.</p> : (
          <div className="wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}>
            <table>
              <thead><tr><th className="wg-th">Ouverture</th><th className="wg-th">Fond</th><th className="wg-th">Clôture</th><th className="wg-th">Théorique</th><th className="wg-th">Compté</th><th className="wg-th">Écart</th><th className="wg-th">État</th><th className="wg-th" /></tr></thead>
              <tbody>
                {stationSessions.map((c) => {
                  const theo = theoreticalCash(state, c.id);
                  const ecart = c.countedAmount === null ? null : c.countedAmount - theo;
                  return (
                    <tr key={c.id}>
                      <td className="wg-td">{formatDateTime(c.openedAt)}<p className="wg-muted text-xs">{c.openedBy}</p></td>
                      <td className="wg-td">{formatFCFA(c.openingFloat)}</td>
                      <td className="wg-td">{c.closedAt ? formatDateTime(c.closedAt) : '—'}</td>
                      <td className="wg-td">{formatFCFA(theo)}</td>
                      <td className="wg-td">{c.countedAmount === null ? '—' : formatFCFA(c.countedAmount)}</td>
                      <td className="wg-td">{ecart === null ? '—' : <span className={ecart === 0 ? 'text-emerald-400' : 'text-amber-400'}>{ecart > 0 ? '+' : ''}{formatFCFA(ecart)}</span>}</td>
                      <td className="wg-td"><Badge tone={c.status === 'ouverte' ? 'success' : 'neutral'}>{c.status === 'ouverte' ? 'Ouverte' : 'Clôturée'}</Badge></td>
                      <td className="wg-td">
                        {c.status === 'cloturee' && <button className="wg-link text-xs" onClick={() => { setReopenId(c.id); setReason(''); }}><FiRotateCcw className="inline" /> Réouvrir</button>}
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
        <h2 className="mb-3 text-sm font-bold">Encaissements en espèces enregistrés</h2>
        {state.washes.filter(w => !currentStationId || w.stationId === currentStationId).flatMap((w) => w.payments).filter((p) => p.method === 'especes').length === 0 ? (
          <p className="wg-muted text-xs">Aucun encaissement en espèces.</p>
        ) : (
          <div className="space-y-1.5">
            {state.washes.filter(w => !currentStationId || w.stationId === currentStationId).flatMap((w) => w.payments.filter((p) => p.method === 'especes').map((p) => ({ w, p }))).map(({ w, p }) => (
              <div key={p.id} className="wg-muted flex flex-wrap justify-between gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--wg-surface-2)' }}>
                <span>{w.number} · {formatDateTime(p.at)} · {PAY_METHOD_LABELS[p.method]}</span><span className="font-bold">{formatFCFA(p.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={openMode} onClose={() => setOpenMode(false)} title="Ouvrir la caisse">
        <Input label="Fond de caisse (FCFA) *" type="number" min="0" value={float} onChange={(e) => setFloat(Number(e.target.value))} hint="Montant en espèces présent au départ." />
        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" onClick={() => setOpenMode(false)}><FiX /> Annuler</button>
          <button className="wg-btn wg-btn-primary" onClick={() => safe(() => { openCash(float); setOpenMode(false); })}>Ouvrir la caisse</button>
        </div>
      </Modal>

      <Modal open={closeMode} onClose={() => setCloseMode(false)} title="Clôturer la caisse avec comptage">
        <p className="wg-muted mb-4 text-sm">Comptez les espèces présentes, puis saisissez le montant. L’écart avec le théorique est calculé et conservé.</p>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Card className="!p-3"><p className="wg-muted text-[11px]">Théorique</p><p className="mt-1 font-bold">{formatFCFA(theoretical)}</p></Card>
          <Card className="!p-3"><p className="wg-muted text-[11px]">Écart au comptage</p><p className={`mt-1 font-bold ${counted - theoretical === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>{counted - theoretical > 0 ? '+' : ''}{formatFCFA(counted - theoretical)}</p></Card>
        </div>
        <Input label="Montant compté (FCFA) *" type="number" min="0" value={counted} onChange={(e) => setCounted(Number(e.target.value))} />
        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" onClick={() => setCloseMode(false)}>Annuler</button>
          <button className="wg-btn wg-btn-primary" onClick={() => safe(() => { closeCash(counted); setCloseMode(false); })}><FiLock /> Clôturer</button>
        </div>
      </Modal>

      <Modal open={Boolean(reopenId)} onClose={() => setReopenId(null)} title="Réouverture motivée">
        <p className="wg-muted mb-4 text-sm">Toute réouverture doit être motivée et reste dans l’historique.</p>
        <Input label="Motif *" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. erreur de comptage à la clôture" />
        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" onClick={() => setReopenId(null)}>Annuler</button>
          <button className="wg-btn wg-btn-primary" onClick={() => safe(() => { if (reopenId) reopenCash(reopenId, reason); setReopenId(null); })}><FiRotateCcw /> Réouvrir</button>
        </div>
      </Modal>
    </div>
  );
}
