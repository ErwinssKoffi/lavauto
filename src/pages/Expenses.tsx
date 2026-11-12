import React, { useState } from 'react';
import { FiAlertCircle, FiPlus, FiX } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { formatDate, formatFCFA, todayISO } from '../lib/format';
import { PAY_METHOD_LABELS, type PayMethod } from '../types';
import { Alert, Badge, Card, EmptyState, Input, LockedPanel, Modal, PageHeader, Select, useSafeAction } from '../components/ui';

const CATEGORIES = ['Fournitures', 'Eau', 'Électricité', 'Carburant', 'Entretien', 'Salaires', 'Loyer', 'Autre'];

export default function Expenses() {
  const { state, addExpense, cancelExpense } = useStore();
  const safe = useSafeAction();
  const [open, setOpen] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [f, setF] = useState({ amount: 0, category: CATEGORIES[0], reason: '', supplier: '', date: todayISO(), method: 'especes' as PayMethod });
  const newExpenseKey = () => `expense-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const [idempotencyKey, setIdempotencyKey] = useState(newExpenseKey);
  const activated = Boolean(state.station?.activated);
  const methods: PayMethod[] = state.station?.paymentMethods.length ? state.station.paymentMethods : ['especes', 'mobile_money', 'carte', 'virement'];
  const active = state.expenses.filter((e) => e.status === 'enregistree');

  return (
    <div>
      <PageHeader title="Dépenses" subtitle="Montant, catégorie, motif, fournisseur, date et moyen de paiement. Rattachement automatique à la caisse ouverte."
        actions={<button className="wg-btn wg-btn-primary" disabled={!activated} onClick={() => { setIdempotencyKey(newExpenseKey()); setOpen(true); }}><FiPlus /> Nouvelle dépense</button>} />
      {!activated && <div className="mb-5"><LockedPanel /></div>}

      <div className="mb-5"><Alert kind="info">Une dépense n’est jamais supprimée : son annulation est motivée et conservée dans l’historique.</Alert></div>

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card><p className="wg-muted text-xs font-bold uppercase">Dépenses enregistrées</p><p className="mt-2 text-xl font-bold">{formatFCFA(active.reduce((s, e) => s + e.amount, 0))}</p><p className="wg-muted mt-1 text-xs">{active.length} opération(s)</p></Card>
        <Card><p className="wg-muted text-xs font-bold uppercase">Annulées (tracées)</p><p className="mt-2 text-xl font-bold">{state.expenses.filter((e) => e.status === 'annulee').length}</p><p className="wg-muted mt-1 text-xs">Jamais supprimées</p></Card>
        <Card><p className="wg-muted text-xs font-bold uppercase">Caisse ouverte</p><p className="mt-2 text-xl font-bold">{state.cashSessions.some((c) => c.status === 'ouverte') ? 'Oui' : 'Non'}</p><p className="wg-muted mt-1 text-xs">Rattachement automatique</p></Card>
      </div>

      {state.expenses.length === 0 ? (
        <EmptyState icon={<FiAlertCircle />} title="Aucune dépense enregistrée" description="Les dépenses apparaîtront ici avec leur motif et leur moyen de paiement." />
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="wg-scroll-x">
            <table>
              <thead><tr><th className="wg-th">Date</th><th className="wg-th">Catégorie</th><th className="wg-th">Motif</th><th className="wg-th">Fournisseur</th><th className="wg-th">Paiement</th><th className="wg-th">Montant</th><th className="wg-th">État</th><th className="wg-th" /></tr></thead>
              <tbody>
                {state.expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="wg-td">{formatDate(e.date)}</td>
                    <td className="wg-td"><Badge>{e.category}</Badge></td>
                    <td className="wg-td">{e.reason}{e.cancelReason && <p className="wg-muted text-xs">Annulation : {e.cancelReason}</p>}</td>
                    <td className="wg-td">{e.supplier || '—'}</td>
                    <td className="wg-td">{PAY_METHOD_LABELS[e.method]}</td>
                    <td className="wg-td font-semibold">{formatFCFA(e.amount)}</td>
                    <td className="wg-td"><Badge tone={e.status === 'enregistree' ? 'success' : 'danger'}>{e.status === 'enregistree' ? 'Enregistrée' : 'Annulée'}</Badge></td>
                    <td className="wg-td">{e.status === 'enregistree' && <button className="wg-link text-xs" onClick={() => { setCancelId(e.id); setReason(''); }}>Annuler</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Nouvelle dépense">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Montant (FCFA) *" type="number" min="1" value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} />
          <Select label="Catégorie *" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
          <Input label="Motif *" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Ex. Achat de shampoing" />
          <Input label="Fournisseur" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} />
          <Input label="Date *" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          <Select label="Moyen de paiement *" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PayMethod })}>{methods.map((m) => <option key={m} value={m}>{PAY_METHOD_LABELS[m]}</option>)}</Select>
        </div>
        <p className="wg-muted mt-3 text-xs">Un paiement en espèces peut exiger une caisse ouverte, selon la règle de la station. Une clé d’idempotence unique protège ce formulaire contre le double clic.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" onClick={() => setOpen(false)}><FiX /> Annuler</button>
          <button className="wg-btn wg-btn-primary" onClick={() => safe(async () => {
            if (f.amount <= 0 || !f.reason.trim()) return;
            await addExpense({ amount: f.amount, category: f.category, reason: f.reason.trim(), supplier: f.supplier.trim(), date: f.date, method: f.method, idempotencyKey });
            setOpen(false); setF({ amount: 0, category: CATEGORIES[0], reason: '', supplier: '', date: todayISO(), method: 'especes' });
            setIdempotencyKey(newExpenseKey());
          })}>Enregistrer</button>
        </div>
      </Modal>

      <Modal open={Boolean(cancelId)} onClose={() => setCancelId(null)} title="Annuler la dépense">
        <p className="wg-muted mb-4 text-sm">La dépense reste dans l’historique avec le motif de son annulation. Elle n’est jamais supprimée.</p>
        <Input label="Motif de l’annulation *" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" onClick={() => setCancelId(null)}>Revenir</button>
          <button className="wg-btn wg-btn-danger" onClick={() => safe(async () => { if (cancelId) await cancelExpense(cancelId, reason); setCancelId(null); })}>Confirmer l’annulation</button>
        </div>
      </Modal>
    </div>
  );
}
