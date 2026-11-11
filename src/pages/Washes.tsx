import React, { useMemo, useState } from 'react';
import {
  FiCheckCircle, FiCreditCard, FiDollarSign, FiPlus, FiSearch, FiTruck, FiX,
} from 'react-icons/fi';
import { useStore } from '../lib/store';
import { formatDate, formatDateTime, formatFCFA } from '../lib/format';
import { PAY_METHOD_LABELS, WASH_STATUS_LABELS, type PayMethod, type WashStatus } from '../types';
import {
  Alert, Badge, Card, EmptyState, Input, LockedPanel, Modal, PageHeader,
  Select, useSafeAction,
} from '../components/ui';

export default function Washes() {
  const { state, createWash, setWashStatus, addPayment } = useStore();
  const safe = useSafeAction();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'tous' | WashStatus>('tous');
  const activated = Boolean(state.station?.activated);
  const methods: PayMethod[] = state.station?.paymentMethods.length
    ? state.station.paymentMethods : ['especes', 'mobile_money', 'carte', 'virement'];

  const washes = useMemo(() => state.washes.filter((w) => {
    const q = search.trim().toLowerCase();
    const matchQ = !q || w.number.toLowerCase().includes(q) || w.plate.toLowerCase().includes(q) || (w.clientName ?? '').toLowerCase().includes(q);
    return matchQ && (statusFilter === 'tous' || w.status === statusFilter);
  }), [state.washes, search, statusFilter]);

  const detail = state.washes.find((w) => w.id === detailId) ?? null;

  return (
    <div>
      <PageHeader
        title="Lavages"
        subtitle="Saisie rapide d’une fiche : prestations, véhicule, plaque facultative, employé, remise autorisée et client facultatif."
        actions={<button className="wg-btn wg-btn-primary" disabled={!activated} onClick={() => setCreateOpen(true)}><FiPlus /> Nouvelle fiche</button>}
      />
      {!activated && <div className="mb-5"><LockedPanel /></div>}

      <Card className="mb-5">
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-[220px] flex-1">
            <FiSearch className="wg-muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
            <input className="wg-input !pl-9" placeholder="Rechercher une fiche, une plaque, un client…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="wg-input !w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="tous">Tous les statuts</option>
            {(Object.keys(WASH_STATUS_LABELS) as WashStatus[]).map((s) => <option key={s} value={s}>{WASH_STATUS_LABELS[s]}</option>)}
          </select>
        </div>
      </Card>

      {washes.length === 0 ? (
        <EmptyState icon={<FiTruck />} title="Aucune fiche de lavage" description="Les fiches enregistrées apparaîtront ici. Aucune donnée d’exemple n’est ajoutée." action={activated ? <button className="wg-btn wg-btn-primary" onClick={() => setCreateOpen(true)}><FiPlus /> Créer la première fiche</button> : undefined} />
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="wg-scroll-x">
            <table>
              <thead><tr>
                <th className="wg-th">Fiche</th><th className="wg-th">Date</th><th className="wg-th">Véhicule</th>
                <th className="wg-th">Client</th><th className="wg-th">Total</th><th className="wg-th">Payé</th>
                <th className="wg-th">Reste</th><th className="wg-th">Statut</th><th className="wg-th" />
              </tr></thead>
              <tbody>
                {washes.map((w) => (
                  <tr key={w.id} className="cursor-pointer hover:bg-sky-500/5" onClick={() => setDetailId(w.id)}>
                    <td className="wg-td font-bold">{w.number}</td>
                    <td className="wg-td">{formatDate(w.createdAt)}</td>
                    <td className="wg-td">{w.vehicleLabel}{w.plate && <span className="wg-muted ml-1 text-xs">· {w.plate}</span>}</td>
                    <td className="wg-td">{w.clientName ?? <span className="wg-muted">Sans client</span>}</td>
                    <td className="wg-td font-semibold">{formatFCFA(w.total)}</td>
                    <td className="wg-td">{formatFCFA(w.paid)}</td>
                    <td className="wg-td">{formatFCFA(Math.max(0, w.total - w.paid))}</td>
                    <td className="wg-td"><Badge tone={w.status === 'termine' ? 'success' : w.status === 'annule' ? 'danger' : w.status === 'en_cours' ? 'accent' : 'warn'}>{WASH_STATUS_LABELS[w.status]}</Badge></td>
                    <td className="wg-td"><button className="wg-link text-xs">Détails →</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {createOpen && <CreateWashModal methods={methods} onClose={() => setCreateOpen(false)} onSubmit={(p) => safe(() => { createWash(p); setCreateOpen(false); })} />}
      {detail && (
        <WashDetail
          washId={detail.id}
          methods={methods}
          onClose={() => setDetailId(null)}
          onStatus={(s, reason) => safe(() => setWashStatus(detail.id, s, reason))}
          onPay={(amount, method) => safe(() => addPayment(detail.id, amount, method))}
        />
      )}
    </div>
  );
}

function CreateWashModal({ methods, onClose, onSubmit }: {
  methods: PayMethod[];
  onClose: () => void;
  onSubmit: (p: Parameters<ReturnType<typeof useStore>['createWash']>[0]) => void;
}) {
  const { state } = useStore();
  const cats = state.vehicleCategories.filter((c) => c.active);
  const svcs = state.services.filter((s) => s.active);
  const employees = state.users.filter((u) => u.active);
  const [categoryId, setCategoryId] = useState(cats[0]?.id ?? '');
  const [plate, setPlate] = useState('');
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? '');
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [discount, setDiscount] = useState(0);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState<PayMethod>(methods[0] ?? 'especes');
  const [error, setError] = useState('');

  const items = svcs.filter((s) => (qty[s.id] ?? 0) > 0).map((s) => ({ serviceId: s.id, qty: qty[s.id] }));
  const gross = svcs.reduce((sum, s) => sum + (s.prices[categoryId] ?? 0) * (qty[s.id] ?? 0), 0);
  const total = Math.max(0, gross - Math.max(0, discount));
  const maxDiscount = state.session?.role === 'caissier' ? state.station?.maxCashierDiscount ?? 0 : Infinity;

  const submit = () => {
    setError('');
    if (!categoryId) return setError('Choisissez une catégorie de véhicule.');
    if (!employeeId) return setError('Choisissez un employé.');
    if (items.length === 0) return setError('Sélectionnez au moins une prestation.');
    if (discount > maxDiscount) return setError(`Remise maximale autorisée : ${maxDiscount === Infinity ? 'illimitée' : `${maxDiscount} FCFA`}.`);
    if (payAmount > total) return setError('L’encaissement dépasse le total de la fiche.');
    if (payAmount < 0) return setError('Montant invalide.');
    onSubmit({
      categoryId, plate, employeeId, clientId: clientId || null, clientName, items,
      discount, payment: payAmount > 0 ? { amount: payAmount, method: payMethod } : null,
    });
  };

  return (
    <Modal open onClose={onClose} title="Nouvelle fiche de lavage" wide>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <Select label="Catégorie de véhicule *" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Input label="Plaque (facultative)" value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Ex. 1234 AB 01" />
          <Select label="Employé *" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            {employees.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <Select label="Client (facultatif)" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Sans client</option>
            {state.clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.plate ? ` · ${c.plate}` : ''}</option>)}
          </Select>
          {!clientId && <Input label="Nom du client sans fiche (facultatif)" value={clientName} onChange={(e) => setClientName(e.target.value)} hint="Un lavage peut être encaissé sans créer de client." />}
        </div>

        <div>
          <p className="wg-label">Prestations *</p>
          <div className="max-h-[260px] space-y-2 overflow-y-auto rounded-xl border p-2" style={{ borderColor: 'var(--wg-border)' }}>
            {svcs.length === 0 && <p className="wg-muted p-3 text-xs">Aucune prestation active.</p>}
            {svcs.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs" style={{ background: 'var(--wg-surface-2)' }}>
                <input type="checkbox" className="accent-sky-500" checked={(qty[s.id] ?? 0) > 0}
                  onChange={(e) => setQty((q) => ({ ...q, [s.id]: e.target.checked ? 1 : 0 }))} />
                <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                <span className="wg-muted shrink-0">{s.prices[categoryId] ? formatFCFA(s.prices[categoryId]) : 'Prix manquant'}</span>
                {(qty[s.id] ?? 0) > 0 && (
                  <input type="number" min="1" className="wg-input !w-14 !px-2 !py-1" value={qty[s.id]}
                    onChange={(e) => setQty((q) => ({ ...q, [s.id]: Math.max(1, Number(e.target.value)) }))} />
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Input label="Remise (FCFA)" type="number" min="0" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} hint={maxDiscount !== Infinity ? `Max caissier : ${maxDiscount} FCFA` : undefined} />
            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--wg-border)' }}>
              <p className="wg-muted text-[11px]">Total de la fiche</p>
              <p className="mt-1 text-lg font-bold">{formatFCFA(total)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-xl border p-4" style={{ borderColor: 'var(--wg-border)' }}>
        <p className="mb-3 flex items-center gap-2 text-sm font-bold"><FiCreditCard /> Encaissement à la création (facultatif)</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Montant encaissé (FCFA)" type="number" min="0" max={total} value={payAmount} onChange={(e) => setPayAmount(Number(e.target.value))} hint="0 = encaissement plus tard, total ou partiel." />
          <Select label="Moyen de paiement" value={payMethod} onChange={(e) => setPayMethod(e.target.value as PayMethod)}>
            {methods.map((m) => <option key={m} value={m}>{PAY_METHOD_LABELS[m]}</option>)}
          </Select>
        </div>
        <p className="wg-muted mt-2 text-[11px]">Un encaissement en espèces exige une caisse ouverte (règle désactivable dans Paramètres). Le Mobile Money peut être enregistré à tout moment.</p>
      </div>

      <Alert kind="info">Les prix sont figés sur la fiche : modifier un tarif dans Prestations ne changera jamais ce lavage.</Alert>
      {error && <div className="mt-3"><Alert kind="danger">{error}</Alert></div>}
      <div className="mt-5 flex justify-end gap-2">
        <button className="wg-btn wg-btn-ghost" onClick={onClose}><FiX /> Annuler</button>
        <button className="wg-btn wg-btn-primary" onClick={submit}><FiCheckCircle /> Enregistrer la fiche</button>
      </div>
    </Modal>
  );
}

function WashDetail({ washId, methods, onClose, onStatus, onPay }: {
  washId: string;
  methods: PayMethod[];
  onClose: () => void;
  onStatus: (s: WashStatus, reason?: string) => void;
  onPay: (amount: number, method: PayMethod) => void;
}) {
  const { state } = useStore();
  const w = state.washes.find((x) => x.id === washId)!;
  const [amount, setAmount] = useState(Math.max(0, w.total - w.paid));
  const [method, setMethod] = useState<PayMethod>(methods[0] ?? 'especes');
  const [cancelMode, setCancelMode] = useState(false);
  const [reason, setReason] = useState('');
  const employee = state.users.find((u) => u.id === w.employeeId)?.name ?? '—';

  return (
    <Modal open onClose={onClose} title={`Fiche ${w.number}`} wide>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={w.status === 'termine' ? 'success' : w.status === 'annule' ? 'danger' : 'warn'}>{WASH_STATUS_LABELS[w.status]}</Badge>
        <Badge>{formatDateTime(w.createdAt)}</Badge>
        <Badge>{w.vehicleLabel}{w.plate ? ` · ${w.plate}` : ''}</Badge>
        <Badge>Employé : {employee}</Badge>
        {w.clientName && <Badge>Client : {w.clientName}</Badge>}
      </div>

      <div className="mt-5 wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}>
        <table>
          <thead><tr><th className="wg-th">Prestation</th><th className="wg-th">Prix unitaire (figé)</th><th className="wg-th">Qté</th><th className="wg-th">Montant</th></tr></thead>
          <tbody>
            {w.items.map((it) => (
              <tr key={it.serviceId}><td className="wg-td">{it.serviceName}</td><td className="wg-td">{formatFCFA(it.unitPrice)}</td><td className="wg-td">{it.qty}</td><td className="wg-td font-semibold">{formatFCFA(it.unitPrice * it.qty)}</td></tr>
            ))}
            {w.discount > 0 && <tr><td className="wg-td" colSpan={3}>Remise</td><td className="wg-td">− {formatFCFA(w.discount)}</td></tr>}
            <tr><td className="wg-td font-bold" colSpan={3}>Total</td><td className="wg-td font-bold">{formatFCFA(w.total)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Card className="!p-3"><p className="wg-muted text-[11px]">Total</p><p className="mt-1 font-bold">{formatFCFA(w.total)}</p></Card>
        <Card className="!p-3"><p className="wg-muted text-[11px]">Encaissé</p><p className="mt-1 font-bold">{formatFCFA(w.paid)}</p></Card>
        <Card className="!p-3"><p className="wg-muted text-[11px]">Reste à payer</p><p className="mt-1 font-bold">{formatFCFA(Math.max(0, w.total - w.paid))}</p></Card>
      </div>

      {w.payments.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-bold">Encaissements</p>
          <div className="space-y-1.5">
            {w.payments.map((p) => (
              <div key={p.id} className="wg-muted flex justify-between rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--wg-surface-2)' }}>
                <span>{PAY_METHOD_LABELS[p.method]} · {formatDateTime(p.at)}</span><span className="font-bold">{formatFCFA(p.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {w.total - w.paid > 0 && w.status !== 'annule' && (
        <div className="mt-4 rounded-xl border p-4" style={{ borderColor: 'var(--wg-border)' }}>
          <p className="mb-3 flex items-center gap-2 text-sm font-bold"><FiDollarSign /> Encaisser le reste</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input type="number" min="1" max={w.total - w.paid} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            <Select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>{methods.map((m) => <option key={m} value={m}>{PAY_METHOD_LABELS[m]}</option>)}</Select>
            <button className="wg-btn wg-btn-primary" onClick={() => onPay(amount, method)}>Encaisser</button>
          </div>
        </div>
      )}

      {cancelMode && (
        <div className="mt-4 rounded-xl border border-red-500/30 p-4">
          <p className="mb-2 text-sm font-bold">Annuler la fiche</p>
          <Input label="Motif de l’annulation" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="mt-3 flex gap-2">
            <button className="wg-btn wg-btn-ghost" onClick={() => setCancelMode(false)}>Revenir</button>
            <button className="wg-btn wg-btn-danger" onClick={() => { onStatus('annule', reason.trim() || 'Annulé depuis la fiche'); setCancelMode(false); onClose(); }}>Confirmer l’annulation</button>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: 'var(--wg-border)' }}>
        {w.status === 'en_attente' && <button className="wg-btn wg-btn-ghost" onClick={() => onStatus('en_cours')}>Passer en cours</button>}
        {w.status !== 'termine' && w.status !== 'annule' && <button className="wg-btn wg-btn-primary" onClick={() => onStatus('termine')}><FiCheckCircle /> Marquer terminé</button>}
        {w.status !== 'annule' && <button className="wg-btn wg-btn-danger" onClick={() => setCancelMode(true)}>Annuler</button>}
        <button className="wg-btn wg-btn-ghost ml-auto" onClick={onClose}>Fermer</button>
      </div>
      {w.cancelledReason && <p className="wg-muted mt-2 text-xs">Motif : {w.cancelledReason}</p>}
    </Modal>
  );
}
