import { readNumber } from '../lib/validation';
import React, { useRef, useState } from 'react';
import { idempotencyKey as newKey } from '../lib/network';
import { FiAlertCircle, FiPlus, FiX } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { formatDate, formatFCFA, todayISO } from '../lib/format';
import { PAY_METHOD_LABELS, type PayMethod } from '../types';
import { Alert, Badge, Card, EmptyState, Input, LockedPanel, Modal, PageHeader, Select, useSafeAction } from '../components/ui';

const CATEGORIES = ['Fournitures', 'Eau', 'Électricité', 'Carburant', 'Entretien', 'Salaires', 'Loyer', 'Autre'];

export default function Expenses() {
  const { state, canWriteSubscription, addExpense, cancelExpense, pendingExpense, pendingExpenseError, retryPendingExpense } = useStore();
  const safe = useSafeAction();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const run = (action: () => void | Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    void safe(action).finally(() => { busyRef.current = false; setBusy(false); });
  };
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const methods: PayMethod[] = state.station?.paymentMethods ?? [];
  const [f, setF] = useState({ amount: 0, category: CATEGORIES[0], reason: '', supplier: '', date: todayISO(), method: methods[0] ?? 'especes' as PayMethod });
  const newExpenseKey = () => newKey('expense');
  const [idempotencyKey, setIdempotencyKey] = useState(newExpenseKey);
  const activated = Boolean(state.station?.activated);
  const active = state.expenses.filter((e) => e.status === 'enregistree');

  return (
    <div>
      <PageHeader title="Dépenses" subtitle="Montant, catégorie, motif, fournisseur, date et moyen de paiement. Rattachement automatique à la caisse ouverte."
        actions={<button className="btn btn-sm btn-primary" disabled={!activated || !canWriteSubscription || Boolean(pendingExpense || pendingExpenseError)} onClick={() => { setIdempotencyKey(newExpenseKey()); setOpen(true); }}><FiPlus /> Nouvelle dépense</button>} />
      {!activated && <div className="mb-5"><LockedPanel /></div>}
      {pendingExpenseError && <div className="mb-5"><Alert kind="danger">{pendingExpenseError}</Alert></div>}
      {pendingExpense && !open && <div className="mb-5"><Alert kind="warn">
        <p>Résultat incertain ou relecture non confirmée : ne créez pas une nouvelle dépense pour cette opération. {pendingExpenseError ? 'La conservation dans cet onglet n’est plus confirmée.' : 'La tentative est conservée dans cet onglet.'}</p>
        <p>{formatFCFA(pendingExpense.payload.amount)} · {pendingExpense.payload.category} · {pendingExpense.payload.reason} · {PAY_METHOD_LABELS[pendingExpense.payload.method]}</p>
        {!canWriteSubscription && <p>La reprise est suspendue en lecture seule : consultez l’historique et conservez cette tentative jusqu’à validation de l’abonnement.</p>}
        <button className="btn btn-sm btn-primary mt-2" disabled={!canWriteSubscription || busy || Boolean(pendingExpenseError)} onClick={() => run(retryPendingExpense)}>{busy ? 'Vérification…' : 'Vérifier la même dépense'}</button>
      </Alert></div>}

      <div className="mb-5"><Alert kind="info">Une dépense n’est jamais supprimée : son annulation est motivée et conservée dans l’historique.</Alert></div>

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card><p className="text-base-content/60 text-xs font-bold uppercase">Dépenses enregistrées</p><p className="mt-2 text-xl font-bold">{formatFCFA(active.reduce((s, e) => s + e.amount, 0))}</p><p className="text-base-content/60 mt-1 text-xs">{active.length} opération(s)</p></Card>
        <Card><p className="text-base-content/60 text-xs font-bold uppercase">Annulées (tracées)</p><p className="mt-2 text-xl font-bold">{state.expenses.filter((e) => e.status === 'annulee').length}</p><p className="text-base-content/60 mt-1 text-xs">Jamais supprimées</p></Card>
        <Card><p className="text-base-content/60 text-xs font-bold uppercase">Caisse ouverte</p><p className="mt-2 text-xl font-bold">{state.cashSessions.some((c) => c.status === 'ouverte') ? 'Oui' : 'Non'}</p><p className="text-base-content/60 mt-1 text-xs">Rattachement automatique</p></Card>
      </div>

      {state.expenses.length === 0 ? (
        <EmptyState icon={<FiAlertCircle />} title="Aucune dépense enregistrée" description="Les dépenses apparaîtront ici avec leur motif et leur moyen de paiement." />
      ) : (
        <Card className="p-0! overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table min-w-[620px]">
              <thead><tr><th>Date</th><th>Catégorie</th><th>Motif</th><th>Fournisseur</th><th>Paiement</th><th>Montant</th><th>État</th><th /></tr></thead>
              <tbody>
                {state.expenses.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(e.date)}</td>
                    <td><Badge>{e.category}</Badge></td>
                    <td>{e.reason}{e.cancelReason && <p className="text-base-content/60 text-xs">Annulation : {e.cancelReason}</p>}</td>
                    <td>{e.supplier || '—'}</td>
                    <td>{PAY_METHOD_LABELS[e.method]}</td>
                    <td className="font-semibold">{formatFCFA(e.amount)}</td>
                    <td><Badge tone={e.status === 'enregistree' ? 'success' : 'danger'}>{e.status === 'enregistree' ? 'Enregistrée' : 'Annulée'}</Badge></td>
                    <td>{e.status === 'enregistree' && <button className="link link-primary text-xs" disabled={!canWriteSubscription} onClick={() => { setCancelId(e.id); setReason(''); }}>Annuler</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={open} onClose={() => { if (!busyRef.current) setOpen(false); }} title="Nouvelle dépense">
        {pendingExpense ? <>
          <Alert kind="warn">Résultat incertain ou relecture non confirmée : la dépense a peut-être été enregistrée. Vérifiez la même tentative avant toute nouvelle dépense. {!canWriteSubscription && 'La reprise est suspendue en lecture seule ; consultez l’historique et conservez la tentative.'}</Alert>
          {pendingExpenseError && <div className="mt-3"><Alert kind="danger">{pendingExpenseError}</Alert></div>}
          <p className="mt-3 text-sm">{formatFCFA(pendingExpense.payload.amount)} · {pendingExpense.payload.category} · {pendingExpense.payload.reason} · {PAY_METHOD_LABELS[pendingExpense.payload.method]}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn btn-sm" disabled={busy} onClick={() => setOpen(false)}>Fermer</button>
            <button className="btn btn-sm btn-primary" disabled={!canWriteSubscription || busy || Boolean(pendingExpenseError)} onClick={() => run(async () => { await retryPendingExpense(); setOpen(false); })}>{busy ? 'Vérification…' : 'Vérifier la même dépense'}</button>
          </div>
        </> : <>
        {pendingExpenseError && <Alert kind="danger">{pendingExpenseError} Vérifiez les dépenses et le stockage de cet onglet avant de poursuivre.</Alert>}
        <fieldset disabled={!canWriteSubscription || busy || Boolean(pendingExpenseError)} className="grid gap-3 sm:grid-cols-2">
          <Input label="Montant (FCFA) *" type="number" min="1" value={f.amount} onChange={(e) => setF({ ...f, amount: readNumber(e.target.value) })} />
          <Select label="Catégorie *" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
          <Input label="Motif *" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Ex. Achat de shampoing" />
          <Input label="Fournisseur" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} />
          <Input label="Date *" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          <Select label="Moyen de paiement *" value={methods.includes(f.method) ? f.method : ''} onChange={(e) => setF({ ...f, method: e.target.value as PayMethod })}>{!methods.includes(f.method) && <option value="">{methods.length === 0 ? 'Aucun moyen configuré' : 'Choisir un moyen'}</option>}{methods.map((m) => <option key={m} value={m}>{PAY_METHOD_LABELS[m]}</option>)}</Select>
        </fieldset>
        <p className="text-base-content/60 mt-3 text-xs">Un paiement en espèces peut exiger une caisse ouverte. En mode connecté, la tentative est conservée dans cet onglet avant l’envoi ; elle ne coordonne pas les autres onglets ou appareils.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-sm" disabled={busy} onClick={() => setOpen(false)}><FiX /> Annuler</button>
          <button className="btn btn-sm btn-primary" disabled={!canWriteSubscription || busy || Boolean(pendingExpenseError)} onClick={() => run(async () => {
            if (!methods.includes(f.method)) throw new Error('Configurez un moyen de paiement accepté avant d’enregistrer une dépense.');
            await addExpense({ amount: f.amount, category: f.category, reason: f.reason.trim(), supplier: f.supplier.trim(), date: f.date, method: f.method, idempotencyKey });
            setOpen(false); setF({ amount: 0, category: CATEGORIES[0], reason: '', supplier: '', date: todayISO(), method: methods[0] ?? 'especes' });
            setIdempotencyKey(newExpenseKey());
          })}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
        </>}
      </Modal>

      <Modal open={Boolean(cancelId)} onClose={() => setCancelId(null)} title="Annuler la dépense">
        <p className="text-base-content/60 mb-4 text-sm">La dépense reste dans l’historique avec le motif de son annulation. Elle n’est jamais supprimée.</p>
        <Input label="Motif de l’annulation *" disabled={!canWriteSubscription} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-sm" onClick={() => setCancelId(null)}>Revenir</button>
          <button className="btn btn-sm btn-error btn-outline" disabled={!canWriteSubscription} onClick={() => safe(async () => { if (cancelId) await cancelExpense(cancelId, reason); setCancelId(null); })}>Confirmer l’annulation</button>
        </div>
      </Modal>
    </div>
  );
}
