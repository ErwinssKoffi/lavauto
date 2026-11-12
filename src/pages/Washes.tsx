import React, { useMemo, useRef, useState } from 'react';
import {
  FiCheckCircle, FiClipboard, FiCreditCard, FiDollarSign, FiPlus, FiSearch,
  FiTruck, FiUsers, FiX,
} from 'react-icons/fi';
import { useStore } from '../lib/store';
import { usePermissions } from '../lib/usePermissions';
import { formatDate, formatDateTime, formatFCFA } from '../lib/format';
import {
  PAY_METHOD_LABELS, WASH_STATUS_LABELS, type PayMethod, type Wash,
  type WashQualityResult, type WashStatus,
} from '../types';
import { nextWashStatuses, washStatusTone } from '../lib/washLifecycle';
import {
  Alert, Badge, Card, EmptyState, Input, LockedPanel, Modal, PageHeader,
  Select, useSafeAction,
} from '../components/ui';

const NEXT_LABELS: Partial<Record<WashStatus, string>> = {
  assigned: 'Affecter',
  in_progress: 'Démarrer le lavage',
  quality_check: 'Envoyer au contrôle qualité',
  delivered: 'Livrer au client',
};

export default function Washes() {
  const {
    state, dataSource, createWash, setWashStatus, addPayment, cancelPayment,
    assignWash, recordQualityCheck, createWashPost, vehicleHistory, refreshWashes,
  } = useStore();
  const { can } = usePermissions();
  const safe = useSafeAction();
  const allow = (permission: string) => dataSource === 'local' || can(permission);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'tous' | WashStatus>('tous');
  const [postName, setPostName] = useState('');
  const [postCapacity, setPostCapacity] = useState(1);
  const activated = Boolean(state.station?.activated);
  const stationId = state.station?.id ?? '';
  const posts = state.washPosts.filter((p) => p.active && (!stationId || !p.stationId || p.stationId === stationId));
  const methods: PayMethod[] = state.station?.paymentMethods.length
    ? state.station.paymentMethods : ['especes', 'wave', 'orange_money', 'mtn_momo', 'carte', 'virement'];

  const washes = useMemo(() => state.washes.filter((w) => {
    const q = search.trim().toLowerCase();
    const matchQ = !q || w.number.toLowerCase().includes(q)
      || w.plate.toLowerCase().includes(q)
      || (w.clientName ?? '').toLowerCase().includes(q);
    return matchQ && (statusFilter === 'tous' || w.status === statusFilter);
  }), [state.washes, search, statusFilter]);

  const detail = state.washes.find((w) => w.id === detailId) ?? null;
  const queue = (Object.keys(WASH_STATUS_LABELS) as WashStatus[])
    .filter((s) => s !== 'cancelled')
    .map((s) => ({ status: s, count: state.washes.filter((w) => w.status === s).length }));

  return (
    <div>
      <PageHeader
        title="Lavages"
        subtitle="File d’attente, postes, affectations multiples, contrôle qualité, 7 statuts et historique véhicule. Le prix de chaque fiche reste figé."
        actions={
          <div className="flex gap-2">
            <button className="wg-btn wg-btn-ghost" onClick={() => safe(() => refreshWashes())}>Actualiser</button>
            <button className="wg-btn wg-btn-primary" disabled={!activated || !allow('washes.create')} onClick={() => setCreateOpen(true)}><FiPlus /> Nouvelle fiche</button>
          </div>
        }
      />
      {!activated && <div className="mb-5"><LockedPanel /></div>}

      <Card className="mb-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold"><FiClipboard /> File d’attente par statut</div>
        <div className="flex flex-wrap gap-2">
          {queue.map((q) => (
            <button key={q.status} className="wg-btn wg-btn-ghost !py-2" onClick={() => setStatusFilter(statusFilter === q.status ? 'tous' : q.status)}>
              <Badge tone={washStatusTone(q.status)}>{WASH_STATUS_LABELS[q.status]}</Badge>
              <span className="ml-1 font-bold">{q.count}</span>
            </button>
          ))}
        </div>
        <p className="wg-muted mt-3 text-[11px]">« Prêt / terminé » n’est pas « Livré » : la restitution au client est une étape distincte et tracée.</p>
      </Card>

      <Card className="mb-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold"><FiUsers /> Postes de lavage</div>
        {posts.length === 0 ? (
          <p className="wg-muted text-xs">Aucun poste configuré pour cette station. Les affectations restent possibles sans poste.</p>
        ) : (
          <div className="mb-3 flex flex-wrap gap-2">
            {posts.map((p) => (
              <Badge key={p.id}>{p.name} · capacité {p.capacity}</Badge>
            ))}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
          <Input value={postName} onChange={(e) => setPostName(e.target.value)} placeholder="Nom du poste (ex. Piste 1)" />
          <Input type="number" min="1" value={postCapacity} onChange={(e) => setPostCapacity(Math.max(1, Number(e.target.value)))} />
          <button className="wg-btn wg-btn-ghost" disabled={!activated || !allow('washes.assign')}
            onClick={() => safe(async () => { await createWashPost(postName, postCapacity, stationId); setPostName(''); setPostCapacity(1); })}>
            <FiPlus /> Ajouter un poste
          </button>
        </div>
      </Card>

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
        <EmptyState icon={<FiTruck />} title="Aucune fiche de lavage" description="Les fiches enregistrées apparaîtront ici. Aucune donnée d’exemple n’est ajoutée." action={activated && allow('washes.create') ? <button className="wg-btn wg-btn-primary" onClick={() => setCreateOpen(true)}><FiPlus /> Créer la première fiche</button> : undefined} />
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="wg-scroll-x">
            <table>
              <thead><tr>
                <th className="wg-th">Fiche</th><th className="wg-th">Date</th><th className="wg-th">Véhicule</th>
                <th className="wg-th">Client</th><th className="wg-th">Affectés</th><th className="wg-th">Total</th>
                <th className="wg-th">Payé</th><th className="wg-th">Reste</th><th className="wg-th">Statut</th><th className="wg-th" />
              </tr></thead>
              <tbody>
                {washes.map((w) => (
                  <tr key={w.id} className="cursor-pointer hover:bg-sky-500/5" onClick={() => setDetailId(w.id)}>
                    <td className="wg-td font-bold">{w.number}</td>
                    <td className="wg-td">{formatDate(w.createdAt)}</td>
                    <td className="wg-td">{w.vehicleLabel}{w.plate && <span className="wg-muted ml-1 text-xs">· {w.plate}</span>}</td>
                    <td className="wg-td">{w.clientName ?? <span className="wg-muted">Sans client</span>}</td>
                    <td className="wg-td">{w.assignedUserIds.length}</td>
                    <td className="wg-td font-semibold">{formatFCFA(w.total)}</td>
                    <td className="wg-td">{formatFCFA(w.paid)}</td>
                    <td className="wg-td">{formatFCFA(Math.max(0, w.total - w.paid))}</td>
                    <td className="wg-td"><Badge tone={washStatusTone(w.status)}>{WASH_STATUS_LABELS[w.status]}</Badge></td>
                    <td className="wg-td"><button className="wg-link text-xs">Détails →</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {createOpen && (
        <CreateWashModal methods={methods} onClose={() => setCreateOpen(false)}
          onSubmit={(p) => safe(async () => { await createWash(p); setCreateOpen(false); })} />
      )}
      {detail && (
        <WashDetail
          washId={detail.id} methods={methods}
          onClose={() => setDetailId(null)}
          onStatus={(s, reason) => safe(async () => { await setWashStatus(detail.id, s, reason); })}
          onAssign={(ids, postId) => safe(async () => { await assignWash(detail.id, ids, postId); })}
          onQuality={(result, notes) => safe(async () => { await recordQualityCheck(detail.id, result, notes); })}
          onPay={(amount, method, key) => Promise.resolve(addPayment(detail.id, amount, method, key))}
          onRefund={(paymentId, reason) => Promise.resolve(cancelPayment(paymentId, reason))}
          onVehicleHistory={vehicleHistory}
        />
      )}
    </div>
  );
}

function CreateWashModal({ methods, onClose, onSubmit }: {
  methods: PayMethod[];
  onClose: () => void;
  onSubmit: (p: Parameters<ReturnType<typeof useStore>['createWash']>[0]) => void | Promise<void>;
}) {
  const { state } = useStore();
  const stationId = state.station?.id ?? '';
  const cats = state.vehicleCategories.filter((c) => c.active);
  const svcs = state.services.filter((s) => s.active);
  const employees = state.users.filter((u) => u.active);
  const posts = state.washPosts.filter((p) => p.active && (!stationId || !p.stationId || p.stationId === stationId));
  const [categoryId, setCategoryId] = useState(cats[0]?.id ?? '');
  const [plate, setPlate] = useState('');
  const [employeeIds, setEmployeeIds] = useState<string[]>(employees[0]?.id ? [employees[0].id] : []);
  const [postId, setPostId] = useState('');
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
    if (employeeIds.length === 0) return setError('Choisissez au moins un employé.');
    if (items.length === 0) return setError('Sélectionnez au moins une prestation.');
    if (discount > maxDiscount) return setError(`Remise maximale autorisée : ${maxDiscount === Infinity ? 'illimitée' : `${maxDiscount} FCFA`}.`);
    if (payAmount > total) return setError('L’encaissement dépasse le total de la fiche.');
    if (payAmount < 0) return setError('Montant invalide.');
    onSubmit({
      categoryId, plate, employeeId: employeeIds[0], employeeIds, postId: postId || null,
      clientId: clientId || null, clientName, items, discount,
      payment: payAmount > 0 ? { amount: payAmount, method: payMethod } : null,
    });
  };

  return (
    <Modal open onClose={onClose} title="Nouvelle fiche de lavage" wide>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <Select label="Catégorie de véhicule *" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Input label="Plaque (facultative)" value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Ex. 1234 AB 01" hint="Renseigner la plaque alimente l’historique du véhicule." />
          <Select label="Poste (facultatif)" value={postId} onChange={(e) => setPostId(e.target.value)}>
            <option value="">Aucun poste</option>
            {posts.map((p) => <option key={p.id} value={p.id}>{p.name} (capacité {p.capacity})</option>)}
          </Select>
          <Select label="Client (facultatif)" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Sans client</option>
            {state.clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.plate ? ` · ${c.plate}` : ''}</option>)}
          </Select>
          {!clientId && <Input label="Nom du client sans fiche (facultatif)" value={clientName} onChange={(e) => setClientName(e.target.value)} hint="Un lavage peut être encaissé sans créer de client." />}
          <div>
            <p className="wg-label">Employés affectés * (plusieurs possibles)</p>
            <div className="max-h-[150px] space-y-1 overflow-y-auto rounded-xl border p-2" style={{ borderColor: 'var(--wg-border)' }}>
              {employees.length === 0 && <p className="wg-muted p-2 text-xs">Aucun employé actif.</p>}
              {employees.map((u) => (
                <label key={u.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs" style={{ background: 'var(--wg-surface-2)' }}>
                  <input type="checkbox" className="accent-sky-500" checked={employeeIds.includes(u.id)}
                    onChange={(e) => setEmployeeIds((ids) => e.target.checked ? [...ids, u.id] : ids.filter((id) => id !== u.id))} />
                  <span className="flex-1 truncate font-medium">{u.name}</span>
                  <span className="wg-muted">{u.role}</span>
                </label>
              ))}
            </div>
          </div>
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
              <p className="wg-muted text-[11px]">Total estimé de la fiche</p>
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

      <Alert kind="info">Les prix sont figés sur la fiche par le serveur : modifier un tarif dans Prestations ne changera jamais ce lavage.</Alert>
      {error && <div className="mt-3"><Alert kind="danger">{error}</Alert></div>}
      <div className="mt-5 flex justify-end gap-2">
        <button className="wg-btn wg-btn-ghost" onClick={onClose}><FiX /> Annuler</button>
        <button className="wg-btn wg-btn-primary" onClick={submit}><FiCheckCircle /> Enregistrer la fiche</button>
      </div>
    </Modal>
  );
}

function WashDetail({ washId, methods, onClose, onStatus, onAssign, onQuality, onPay, onRefund, onVehicleHistory }: {
  washId: string;
  methods: PayMethod[];
  onClose: () => void;
  onStatus: (s: WashStatus, reason?: string) => void;
  onAssign: (ids: string[], postId: string | null) => void;
  onQuality: (result: WashQualityResult, notes: string) => void;
  onPay: (amount: number, method: PayMethod, idempotencyKey: string) => Promise<void>;
  onRefund: (paymentId: string, reason: string) => void | Promise<void>;
  onVehicleHistory: (plate: string) => Promise<Wash[]>;
}) {
  const { state, dataSource } = useStore();
  const { can } = usePermissions();
  const safe = useSafeAction();
  const allow = (permission: string) => dataSource === 'local' || can(permission);
  const w = state.washes.find((x) => x.id === washId)!;
  const [amount, setAmount] = useState(Math.max(0, w.total - w.paid));
  const [method, setMethod] = useState<PayMethod>(methods[0] ?? 'especes');
  const [cancelMode, setCancelMode] = useState(false);
  const [reason, setReason] = useState('');
  const [assignMode, setAssignMode] = useState(false);
  const [selected, setSelected] = useState<string[]>(w.assignedUserIds);
  const [postId, setPostId] = useState(w.postId ?? '');
  const [qualityNotes, setQualityNotes] = useState('');
  const [refundId, setRefundId] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [historyRows, setHistoryRows] = useState<Wash[] | null>(null);
  const payKey = useRef<string | null>(null);
  const stationId = state.station?.id ?? '';
  const employees = state.users.filter((u) => u.active);
  const posts = state.washPosts.filter((p) => p.active && (!stationId || !p.stationId || p.stationId === stationId));
  const postName = posts.find((p) => p.id === w.postId)?.name ?? 'Aucun poste';
  const assignedNames = w.assignedUserIds
    .map((id) => state.users.find((u) => u.id === id)?.name ?? id).join(', ') || '—';
  const next = nextWashStatuses(w.status);

  const pay = () => {
    const key = payKey.current ?? `pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    payKey.current = key;
    return safe(async () => {
      try { await onPay(amount, method, key); payKey.current = null; }
      catch (e) { payKey.current = null; throw e; }
    });
  };

  return (
    <Modal open onClose={onClose} title={`Fiche ${w.number}`} wide>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={washStatusTone(w.status)}>{WASH_STATUS_LABELS[w.status]}</Badge>
        <Badge>{formatDateTime(w.createdAt)}</Badge>
        <Badge>{w.vehicleLabel}{w.plate ? ` · ${w.plate}` : ''}</Badge>
        <Badge>{w.assignedUserIds.length} affecté(s) : {assignedNames}</Badge>
        <Badge>Poste : {postName}</Badge>
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

      <div className="mt-5">
        <p className="mb-2 text-xs font-bold">Historique des statuts</p>
        <div className="space-y-1.5">
          {w.history.length === 0 && <p className="wg-muted text-xs">Aucun événement.</p>}
          {w.history.map((h) => (
            <div key={h.id} className="wg-muted flex flex-wrap justify-between gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--wg-surface-2)' }}>
              <span>{WASH_STATUS_LABELS[h.toStatus]} · {formatDateTime(h.at)}{h.fromStatus ? ` (depuis ${WASH_STATUS_LABELS[h.fromStatus]})` : ''}</span>
              <span>{h.reason ?? '—'}</span>
            </div>
          ))}
        </div>
      </div>

      {w.payments.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-bold">Encaissements</p>
          <div className="space-y-1.5">
            {w.payments.map((p) => {
              const cancelled = Boolean(p.cancelledAt) || (state.paymentCancellations ?? [])
                .some((c) => c.paymentId === p.id);
              return (
                <div key={p.id} className="wg-muted flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--wg-surface-2)' }}>
                  <span>{PAY_METHOD_LABELS[p.method]} · {formatDateTime(p.at)}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-bold">{formatFCFA(p.amount)}</span>
                    {cancelled
                      ? <Badge tone="danger">Annulé{p.cancelReason ? ` · ${p.cancelReason}` : ''}</Badge>
                      : allow('payments.cancel') &&
                        <button className="wg-link text-xs" onClick={() => { setRefundId(p.id); setRefundReason(''); }}>Annuler</button>}
                  </span>
                </div>
              );
            })}
          </div>
          {refundId && (
            <div className="mt-3 rounded-xl border border-red-500/30 p-3">
              <p className="mb-2 text-xs font-bold">Remboursement : le paiement reste tracé, la créance est recalculée</p>
              <Input label="Motif *" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Ex. client remboursé" />
              <div className="mt-3 flex gap-2">
                <button className="wg-btn wg-btn-ghost" onClick={() => setRefundId(null)}>Revenir</button>
                <button className="wg-btn wg-btn-danger" onClick={() => safe(async () => {
                  await onRefund(refundId, refundReason); setRefundId(null);
                })}>Confirmer l’annulation</button>
              </div>
            </div>
          )}
        </div>
      )}

      {w.total - w.paid > 0 && w.status !== 'cancelled' && (
        <div className="mt-4 rounded-xl border p-4" style={{ borderColor: 'var(--wg-border)' }}>
          <p className="mb-3 flex items-center gap-2 text-sm font-bold"><FiDollarSign /> Encaisser le reste</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input type="number" min="1" max={w.total - w.paid} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            <Select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>{methods.map((m) => <option key={m} value={m}>{PAY_METHOD_LABELS[m]}</option>)}</Select>
            <button className="wg-btn wg-btn-primary" onClick={pay}>Encaisser</button>
          </div>
        </div>
      )}

      {w.plate && (
        <div className="mt-4">
          <button className="wg-btn wg-btn-ghost" onClick={() => safe(async () => { setHistoryRows(await onVehicleHistory(w.plate)); })}>
            <FiTruck /> Historique du véhicule {w.plate}
          </button>
          {historyRows && (
            <div className="mt-2 rounded-xl border p-3" style={{ borderColor: 'var(--wg-border)' }}>
              {historyRows.length === 0 ? <p className="wg-muted text-xs">Aucun autre lavage pour cette plaque.</p> : (
                <div className="space-y-1">
                  {historyRows.map((h) => (
                    <div key={h.id} className="flex justify-between text-xs"><span>{h.number} · {formatDate(h.createdAt)}</span><span>{WASH_STATUS_LABELS[h.status]} · {formatFCFA(h.total)}</span></div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {assignMode && (
        <div className="mt-4 rounded-xl border p-4" style={{ borderColor: 'var(--wg-border)' }}>
          <p className="mb-2 text-sm font-bold">Affecter / réaffecter</p>
          <div className="max-h-[140px] space-y-1 overflow-y-auto">
            {employees.map((u) => (
              <label key={u.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs" style={{ background: 'var(--wg-surface-2)' }}>
                <input type="checkbox" className="accent-sky-500" checked={selected.includes(u.id)}
                  onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, u.id] : ids.filter((id) => id !== u.id))} />
                <span className="flex-1 truncate">{u.name}</span>
              </label>
            ))}
          </div>
          <div className="mt-2"><Select label="Poste" value={postId} onChange={(e) => setPostId(e.target.value)}><option value="">Aucun poste</option>{posts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
          <div className="mt-3 flex gap-2">
            <button className="wg-btn wg-btn-ghost" onClick={() => setAssignMode(false)}>Revenir</button>
            <button className="wg-btn wg-btn-primary" disabled={selected.length === 0}
              onClick={() => safe(async () => { await onAssign(selected, postId || null); setAssignMode(false); })}>Valider l’affectation</button>
          </div>
        </div>
      )}

      {w.status === 'quality_check' && (
        <div className="mt-4 rounded-xl border border-sky-500/30 p-4">
          <p className="mb-2 text-sm font-bold">Contrôle qualité obligatoire</p>
          <Input label="Notes (facultatives, obligatoires en cas de refus)" value={qualityNotes} onChange={(e) => setQualityNotes(e.target.value)} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="wg-btn wg-btn-primary" disabled={!allow('washes.quality')}
              onClick={() => safe(async () => { await onQuality('approved', qualityNotes); })}><FiCheckCircle /> Valider → Prêt</button>
            <button className="wg-btn wg-btn-danger" disabled={!allow('washes.quality')}
              onClick={() => safe(async () => { await onQuality('rejected', qualityNotes || 'Reprise demandée'); })}>Refuser → Reprise</button>
          </div>
          {w.qualityResult && <p className="wg-muted mt-2 text-xs">Dernier contrôle : {w.qualityResult === 'approved' ? 'validé' : 'refusé'}{w.qualityNotes ? ` · ${w.qualityNotes}` : ''}</p>}
        </div>
      )}

      {cancelMode && (
        <div className="mt-4 rounded-xl border border-red-500/30 p-4">
          <p className="mb-2 text-sm font-bold">Annuler la fiche</p>
          <Input label="Motif de l’annulation *" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="mt-3 flex gap-2">
            <button className="wg-btn wg-btn-ghost" onClick={() => setCancelMode(false)}>Revenir</button>
            <button className="wg-btn wg-btn-danger" disabled={!reason.trim()}
              onClick={() => { onStatus('cancelled', reason.trim()); setCancelMode(false); onClose(); }}>Confirmer l’annulation</button>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: 'var(--wg-border)' }}>
        {next.map((s) => (
          <button key={s} className={`wg-btn ${s === 'delivered' ? 'wg-btn-primary' : 'wg-btn-ghost'}`}
            disabled={!allow(s === 'delivered' ? 'washes.quality' : 'washes.update_status')}
            onClick={() => onStatus(s)}>
            {s === 'delivered' && <FiCheckCircle />}{NEXT_LABELS[s] ?? WASH_STATUS_LABELS[s]}
          </button>
        ))}
        {w.status !== 'delivered' && w.status !== 'cancelled' && allow('washes.assign') && (
          <button className="wg-btn wg-btn-ghost" onClick={() => { setSelected(w.assignedUserIds); setPostId(w.postId ?? ''); setAssignMode(true); }}><FiUsers /> Affecter</button>
        )}
        {w.status !== 'cancelled' && w.status !== 'delivered' && (
          <button className="wg-btn wg-btn-danger" onClick={() => setCancelMode(true)}>Annuler</button>
        )}
        <button className="wg-btn wg-btn-ghost ml-auto" onClick={onClose}>Fermer</button>
      </div>
      {w.cancelledReason && <p className="wg-muted mt-2 text-xs">Motif : {w.cancelledReason}</p>}
      {w.deliveredAt && <p className="wg-muted mt-1 text-xs">Livré le {formatDateTime(w.deliveredAt)} — distinct de « prêt ».</p>}
    </Modal>
  );
}
