import { readNumber } from '../lib/validation';
import { readPendingPayment, type PendingPayment } from '../lib/paymentAttempt';
import { idempotencyKey } from '../lib/network';
import React, { useMemo, useRef, useState } from 'react';
import {
  FiCheckCircle, FiClipboard, FiCreditCard, FiDollarSign, FiFileText, FiPlus, FiSearch,
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
import { buildWashReceipt, type WashReceipt } from '../lib/receipt';
import { WashReceiptModal } from '../components/WashReceipt';
import { WhatsappWashPanel } from '../components/WhatsappPanels';
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
    state, dataSource, canWriteSubscription, createWash, pendingWash, pendingWashError, retryPendingWash,
    setWashStatus, addPayment, cancelPayment,
    assignWash, recordQualityCheck, createWashPost, vehicleHistory, refreshWashes,
  } = useStore();
  const { can } = usePermissions();
  const safe = useSafeAction();
  const allow = (permission: string) => canWriteSubscription && (dataSource === 'local' || can(permission));
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'tous' | WashStatus>('tous');
  const [postName, setPostName] = useState('');
  const [postCapacity, setPostCapacity] = useState(1);
  const activated = Boolean(state.station?.activated);
  const stationId = state.station?.id ?? '';
  const posts = state.washPosts.filter((p) => p.active && (!stationId || !p.stationId || p.stationId === stationId));
  const methods: PayMethod[] = state.station?.paymentMethods ?? [];

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
            <button className="btn btn-sm" onClick={() => safe(() => refreshWashes())}>Actualiser</button>
            <button className="btn btn-sm btn-primary" disabled={!pendingWash && (!activated || !allow('washes.create'))} onClick={() => setCreateOpen(true)}><FiPlus /> {pendingWash ? 'Vérifier la création' : 'Nouvelle fiche'}</button>
          </div>
        }
      />
      {!activated && <div className="mb-5"><LockedPanel /></div>}
      {pendingWash && (
        <div className="mb-5"><Alert kind="warn">Une création n’a pas reçu de confirmation. Vérifiez-la avec la même clé avant de créer une autre fiche dans cet onglet. {!canWriteSubscription && 'La reprise est suspendue en lecture seule : consultez l’historique et conservez la tentative jusqu’à validation.'}</Alert></div>
      )}
      {pendingWashError && <div className="mb-5"><Alert kind="danger">{pendingWashError}</Alert></div>}

      <Card className="mb-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold"><FiClipboard /> File d’attente par statut</div>
        <div className="flex flex-wrap gap-2">
          {queue.map((q) => (
            <button key={q.status} className="btn btn-sm py-2!" onClick={() => setStatusFilter(statusFilter === q.status ? 'tous' : q.status)}>
              <Badge tone={washStatusTone(q.status)}>{WASH_STATUS_LABELS[q.status]}</Badge>
              <span className="ml-1 font-bold">{q.count}</span>
            </button>
          ))}
        </div>
        <p className="text-base-content/60 mt-3 text-[11px]">« Prêt / terminé » n’est pas « Livré » : la restitution au client est une étape distincte et tracée.</p>
      </Card>

      <Card className="mb-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold"><FiUsers /> Postes de lavage</div>
        {posts.length === 0 ? (
          <p className="text-base-content/60 text-xs">Aucun poste configuré pour cette station. Les affectations restent possibles sans poste.</p>
        ) : (
          <div className="mb-3 flex flex-wrap gap-2">
            {posts.map((p) => (
              <Badge key={p.id}>{p.name} · capacité {p.capacity}</Badge>
            ))}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
          <Input disabled={!activated || !allow('washes.assign')} value={postName} onChange={(e) => setPostName(e.target.value)} placeholder="Nom du poste (ex. Piste 1)" />
          <Input type="number" min="1" disabled={!activated || !allow('washes.assign')} value={postCapacity} onChange={(e) => setPostCapacity(readNumber(e.target.value))} />
          <button className="btn btn-sm" disabled={!activated || !allow('washes.assign')}
            onClick={() => safe(async () => { await createWashPost(postName, postCapacity, stationId); setPostName(''); setPostCapacity(1); })}>
            <FiPlus /> Ajouter un poste
          </button>
        </div>
      </Card>

      <Card className="mb-5">
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-[220px] flex-1">
            <FiSearch className="text-base-content/60 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
            <input className="input input-sm pl-9! w-full" placeholder="Rechercher une fiche, une plaque, un client…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input input-sm w-auto!" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="tous">Tous les statuts</option>
            {(Object.keys(WASH_STATUS_LABELS) as WashStatus[]).map((s) => <option key={s} value={s}>{WASH_STATUS_LABELS[s]}</option>)}
          </select>
        </div>
      </Card>

      {washes.length === 0 ? (
        <EmptyState icon={<FiTruck />} title="Aucune fiche de lavage" description="Les fiches enregistrées apparaîtront ici. Aucune donnée d’exemple n’est ajoutée." action={activated && allow('washes.create') ? <button className="btn btn-sm btn-primary" onClick={() => setCreateOpen(true)}><FiPlus /> Créer la première fiche</button> : undefined} />
      ) : (
        <Card className="p-0! overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table min-w-[620px]">
              <thead><tr>
                <th>Fiche</th><th>Date</th><th>Véhicule</th>
                <th>Client</th><th>Affectés</th><th>Total</th>
                <th>Payé</th><th>Reste</th><th>Statut</th><th />
              </tr></thead>
              <tbody>
                {washes.map((w) => (
                  <tr key={w.id} className="cursor-pointer hover:bg-sky-500/5" onClick={() => setDetailId(w.id)}>
                    <td className="font-bold">{w.number}</td>
                    <td>{formatDate(w.createdAt)}</td>
                    <td>{w.vehicleLabel}{w.plate && <span className="text-base-content/60 ml-1 text-xs">· {w.plate}</span>}</td>
                    <td>{w.clientName ?? <span className="text-base-content/60">Sans client</span>}</td>
                    <td>{w.assignedUserIds.length}</td>
                    <td className="font-semibold">{formatFCFA(w.total)}</td>
                    <td>{formatFCFA(w.paid)}</td>
                    <td>{formatFCFA(Math.max(0, w.total - w.paid))}</td>
                    <td><Badge tone={washStatusTone(w.status)}>{WASH_STATUS_LABELS[w.status]}</Badge></td>
                    <td><button className="link link-primary text-xs">Détails →</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {createOpen && (
        <CreateWashModal methods={methods} onClose={() => setCreateOpen(false)}
          onSubmit={(p) => safe(async () => { await createWash(p); setCreateOpen(false); })}
          onRetry={() => safe(async () => { await retryPendingWash(); setCreateOpen(false); })} />
      )}
      {detail && (
        <WashDetail
          key={`${state.station?.id ?? ''}:${detail.id}`}
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

function CreateWashModal({ methods, onClose, onSubmit, onRetry }: {
  methods: PayMethod[];
  onClose: () => void;
  onSubmit: (p: Parameters<ReturnType<typeof useStore>['createWash']>[0]) => void | Promise<void>;
  onRetry: () => Promise<void>;
}) {
  const { state, pendingWash, assignableUsers, canWriteSubscription } = useStore();
  const stationId = state.station?.id ?? '';
  const cats = state.vehicleCategories.filter((c) => c.active);
  const svcs = state.services.filter((s) => s.active);
  const employees = assignableUsers;
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
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const run = async (action: () => void | Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { await action(); } finally { busyRef.current = false; setBusy(false); }
  };
  const close = () => { if (!busyRef.current) onClose(); };

  // Aucun champ modifiable ni nouvelle clé tant que la première réponse est
  // incertaine. La commande d'origine est rejouée telle quelle, même après un
  // rechargement ou une modification ultérieure du catalogue.
  if (pendingWash) {
    const { payload } = pendingWash;
    return (
      <Modal open onClose={close} title="Nouvelle fiche de lavage">
        <Alert kind="warn">Résultat incertain : la fiche et son éventuel paiement ont peut-être été enregistrés. Ne créez pas une nouvelle fiche pour cette opération. {!canWriteSubscription && 'La reprise est suspendue en lecture seule ; consultez l’historique et conservez la tentative.'}</Alert>
        <div className="mt-4 space-y-1 text-sm">
          <p>Plaque : <strong>{payload.plate || 'Non renseignée'}</strong></p>
          <p>Encaissement initial : <strong>{payload.payment ? `${formatFCFA(payload.payment.amount)} · ${PAY_METHOD_LABELS[payload.payment.method]}` : 'Aucun'}</strong></p>
          <p className="text-base-content/60 text-xs">Tentative du {formatDateTime(pendingWash.startedAt)}. La reprise est conservée dans cet onglet ; ne l’effacez pas et ne changez pas d’appareil avant vérification.</p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-sm" disabled={busy} onClick={close}>Fermer</button>
          <button className="btn btn-sm btn-primary" disabled={busy || !canWriteSubscription} onClick={() => { void run(onRetry); }}>
            {busy ? 'Vérification…' : 'Vérifier / réessayer la même opération'}
          </button>
        </div>
      </Modal>
    );
  }

  const items = svcs.filter((s) => Object.prototype.hasOwnProperty.call(qty, s.id)).map((s) => ({ serviceId: s.id, qty: qty[s.id] }));
  const gross = svcs.reduce((sum, s) => sum + (s.prices[categoryId] ?? 0) * (qty[s.id] ?? 0), 0);
  const total = gross - discount;
  const maxDiscount = state.session?.role === 'caissier' ? state.station?.maxCashierDiscount ?? 0 : Infinity;

  const submit = () => {
    setError('');
    if (!categoryId) return setError('Choisissez une catégorie de véhicule.');
    if (employeeIds.length === 0) return setError('Choisissez au moins un employé.');
    if (items.length === 0) return setError('Sélectionnez au moins une prestation.');
    if (items.some((item) => !Number.isSafeInteger(item.qty) || item.qty < 1)) return setError('Les quantités doivent être des nombres entiers positifs.');
    if (!Number.isSafeInteger(discount) || discount < 0) return setError('La remise doit être un montant entier positif ou nul.');
    if (discount > gross) return setError('La remise ne peut pas dépasser le total des prestations.');
    if (discount > maxDiscount) return setError(`Remise maximale autorisée : ${maxDiscount === Infinity ? 'illimitée' : `${maxDiscount} FCFA`}.`);
    if (!Number.isSafeInteger(payAmount) || payAmount < 0) return setError('Le montant encaissé doit être un entier positif ou nul.');
    if (payAmount > total) return setError('L’encaissement dépasse le total de la fiche.');
    if (payAmount > 0 && !methods.includes(payMethod)) return setError('Configurez un moyen de paiement accepté avant d’encaisser.');
    void run(() => onSubmit({
      categoryId, plate, employeeId: employeeIds[0], employeeIds, postId: postId || null,
      clientId: clientId || null, clientName, items, discount,
      payment: payAmount > 0 ? { amount: payAmount, method: payMethod } : null,
    }));
  };

  return (
    <Modal open onClose={close} title="Nouvelle fiche de lavage" wide>
      <fieldset disabled={busy || !canWriteSubscription} className="min-w-0">
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
            <p className="label">Employés affectés * (plusieurs possibles)</p>
            <div className="max-h-[150px] space-y-1 overflow-y-auto rounded-xl border p-2">
              {employees.length === 0 && <p className="text-base-content/60 p-2 text-xs">Aucun employé actif.</p>}
              {employees.map((u) => (
                <label key={u.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs bg-base-200">
                  <input type="checkbox" className="accent-sky-500" checked={employeeIds.includes(u.id)}
                    onChange={(e) => setEmployeeIds((ids) => e.target.checked ? [...ids, u.id] : ids.filter((id) => id !== u.id))} />
                  <span className="flex-1 truncate font-medium">{u.name}</span>
                  <span className="text-base-content/60">{u.role}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div>
          <p className="label">Prestations *</p>
          <div className="max-h-[260px] space-y-2 overflow-y-auto rounded-xl border p-2">
            {svcs.length === 0 && <p className="text-base-content/60 p-3 text-xs">Aucune prestation active.</p>}
            {svcs.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs bg-base-200">
                <input type="checkbox" className="accent-sky-500" aria-label={`Sélectionner ${s.name}`} checked={Object.prototype.hasOwnProperty.call(qty, s.id)}
                  onChange={(e) => setQty((q) => { const next = { ...q }; if (e.target.checked) next[s.id] = 1; else delete next[s.id]; return next; })} />
                <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                <span className="text-base-content/60 shrink-0">{s.prices[categoryId] ? formatFCFA(s.prices[categoryId]) : 'Prix manquant'}</span>
                {Object.prototype.hasOwnProperty.call(qty, s.id) && (
                  <input type="number" min="1" className="input input-sm w-14! px-2! py-1!" value={Number.isNaN(qty[s.id]) ? '' : qty[s.id]}
                    onChange={(e) => setQty((q) => ({ ...q, [s.id]: readNumber(e.target.value) }))} />
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Input label="Remise (FCFA)" type="number" min="0" value={discount} onChange={(e) => setDiscount(readNumber(e.target.value))} hint={maxDiscount !== Infinity ? `Max caissier : ${maxDiscount} FCFA` : undefined} />
            <div className="rounded-xl border p-3">
              <p className="text-base-content/60 text-[11px]">Total estimé de la fiche</p>
              <p className="mt-1 text-lg font-bold">{Number.isFinite(total) && total >= 0 ? formatFCFA(total) : '—'}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-xl border p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-bold"><FiCreditCard /> Encaissement à la création (facultatif)</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Montant encaissé (FCFA)" type="number" min="0" max={Number.isFinite(total) && total >= 0 ? total : undefined} value={payAmount} onChange={(e) => setPayAmount(readNumber(e.target.value))} hint="0 = encaissement plus tard, total ou partiel." />
          <Select label="Moyen de paiement" value={methods.includes(payMethod) ? payMethod : ''} onChange={(e) => setPayMethod(e.target.value as PayMethod)}>
            {!methods.includes(payMethod) && <option value="">{methods.length === 0 ? 'Aucun moyen configuré' : 'Choisir un moyen'}</option>}
            {methods.map((m) => <option key={m} value={m}>{PAY_METHOD_LABELS[m]}</option>)}
          </Select>
        </div>
        <p className="text-base-content/60 mt-2 text-[11px]">Un encaissement en espèces exige une caisse ouverte en mode connecté. Le Mobile Money peut être enregistré à tout moment.</p>
      </div>
      </fieldset>

      <Alert kind="info">Les prix sont figés sur la fiche : modifier un tarif dans Prestations ne changera jamais ce lavage.</Alert>
      {error && <div className="mt-3"><Alert kind="danger">{error}</Alert></div>}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn btn-sm" disabled={busy} onClick={close}><FiX /> Annuler</button>
        <button className="btn btn-sm btn-primary" disabled={busy || !canWriteSubscription} onClick={submit}><FiCheckCircle /> {busy ? 'Enregistrement…' : 'Enregistrer la fiche'}</button>
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
  const { state, dataSource, identity, assignableUsers, canWriteSubscription } = useStore();
  const { can } = usePermissions();
  const safe = useSafeAction();
  const allow = (permission: string) => canWriteSubscription && (dataSource === 'local' || can(permission));
  const w = state.washes.find((x) => x.id === washId)!;
  const [receipt, setReceipt] = useState<WashReceipt | null>(null);
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
  const stationId = state.station?.id ?? '';
  const userId = identity?.userId ?? '';
  const readPayment = (): { pending: PendingPayment | null; error: string | null } => {
    if (dataSource === 'local' || !userId || !stationId) return { pending: null, error: null };
    try { return { pending: readPendingPayment(userId, stationId, washId), error: null }; }
    catch (error) { return { pending: null, error: error instanceof Error ? error.message : 'Tentative illisible.' }; }
  };
  const [paymentAttempt, setPaymentAttempt] = useState(readPayment);
  const [payBusy, setPayBusy] = useState(false);
  const payBusyRef = useRef(false);
  const employees = assignableUsers;
  const posts = state.washPosts.filter((p) => p.active && (!stationId || !p.stationId || p.stationId === stationId));
  const postName = posts.find((p) => p.id === w.postId)?.name ?? 'Aucun poste';
  const assignedNames = w.assignedUserIds
    .map((id) => assignableUsers.find((u) => u.id === id)?.name ?? state.users.find((u) => u.id === id)?.name ?? id).join(', ') || '—';
  const next = nextWashStatuses(w.status);

  const pay = () => {
    if (!allow('payments.create') || payBusyRef.current || paymentAttempt.error) return;
    const previous = paymentAttempt.pending;
    if (!previous && !methods.includes(method)) return safe(() => { throw new Error('Configurez un moyen de paiement accepté avant d’encaisser.'); });
    const key = previous?.key ?? idempotencyKey('pay');
    payBusyRef.current = true;
    setPayBusy(true);
    return safe(async () => {
      try {
        await onPay(previous?.amount ?? amount, previous?.method ?? method, key);
      } finally {
        setPaymentAttempt(readPayment());
        payBusyRef.current = false;
        setPayBusy(false);
      }
    });
  };

  return (<>
    <Modal open onClose={onClose} title={`Fiche ${w.number}`} wide>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={washStatusTone(w.status)}>{WASH_STATUS_LABELS[w.status]}</Badge>
        <Badge>{formatDateTime(w.createdAt)}</Badge>
        <Badge>{w.vehicleLabel}{w.plate ? ` · ${w.plate}` : ''}</Badge>
        <Badge>{w.assignedUserIds.length} affecté(s) : {assignedNames}</Badge>
        <Badge>Poste : {postName}</Badge>
        {w.clientName && <Badge>Client : {w.clientName}</Badge>}
      </div>

      <div className="mt-4">
        <button className="btn btn-sm" onClick={() => setReceipt(buildWashReceipt(
          w, state.company, state.station, identity?.stations ?? [], state.paymentCancellations ?? [],
        ))}><FiFileText /> Reçu client</button>
      </div>

      <div className="mt-5 overflow-x-auto rounded-xl border">
        <table className="table min-w-[620px]">
          <thead><tr><th>Prestation</th><th>Prix unitaire (figé)</th><th>Qté</th><th>Montant</th></tr></thead>
          <tbody>
            {w.items.map((it) => (
              <tr key={it.serviceId}><td>{it.serviceName}</td><td>{formatFCFA(it.unitPrice)}</td><td>{it.qty}</td><td className="font-semibold">{formatFCFA(it.unitPrice * it.qty)}</td></tr>
            ))}
            {w.discount > 0 && <tr><td colSpan={3}>Remise</td><td>− {formatFCFA(w.discount)}</td></tr>}
            <tr><td className="font-bold" colSpan={3}>Total</td><td className="font-bold">{formatFCFA(w.total)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-3!"><p className="text-base-content/60 text-[11px]">Total</p><p className="mt-1 font-bold">{formatFCFA(w.total)}</p></Card>
        <Card className="p-3!"><p className="text-base-content/60 text-[11px]">Encaissé</p><p className="mt-1 font-bold">{formatFCFA(w.paid)}</p></Card>
        <Card className="p-3!"><p className="text-base-content/60 text-[11px]">Reste à payer</p><p className="mt-1 font-bold">{formatFCFA(Math.max(0, w.total - w.paid))}</p></Card>
      </div>

      <WhatsappWashPanel key={`${w.id}:${w.status}`} wash={w} />

      <div className="mt-5">
        <p className="mb-2 text-xs font-bold">Historique des statuts</p>
        <div className="space-y-1.5">
          {w.history.length === 0 && <p className="text-base-content/60 text-xs">Aucun événement.</p>}
          {w.history.map((h) => (
            <div key={h.id} className="text-base-content/60 flex flex-wrap justify-between gap-2 rounded-lg px-3 py-2 text-xs bg-base-200">
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
                <div key={p.id} className="text-base-content/60 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs bg-base-200">
                  <span>{PAY_METHOD_LABELS[p.method]} · {formatDateTime(p.at)}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-bold">{formatFCFA(p.amount)}</span>
                    {cancelled
                      ? <Badge tone="danger">Annulé{p.cancelReason ? ` · ${p.cancelReason}` : ''}</Badge>
                      : allow('payments.cancel') &&
                        <button className="link link-primary text-xs" onClick={() => { setRefundId(p.id); setRefundReason(''); }}>Annuler</button>}
                  </span>
                </div>
              );
            })}
          </div>
          {refundId && (
            <div className="mt-3 rounded-xl border border-red-500/30 p-3">
              <p className="mb-2 text-xs font-bold">Remboursement : le paiement reste tracé, la créance est recalculée</p>
              <Input label="Motif *" disabled={!allow('payments.cancel')} value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Ex. client remboursé" />
              <div className="mt-3 flex gap-2">
                <button className="btn btn-sm" onClick={() => setRefundId(null)}>Revenir</button>
                <button className="btn btn-sm btn-error btn-outline" disabled={!allow('payments.cancel')} onClick={() => safe(async () => {
                  await onRefund(refundId, refundReason); setRefundId(null);
                })}>Confirmer l’annulation</button>
              </div>
            </div>
          )}
        </div>
      )}

      {((w.total - w.paid > 0 && w.status !== 'cancelled') || paymentAttempt.pending || paymentAttempt.error) && (
        <div className="mt-4 rounded-xl border p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold"><FiDollarSign /> Encaisser le reste</p>
          {paymentAttempt.error && <div className="mb-3"><Alert kind="danger">{paymentAttempt.error}</Alert></div>}
          {paymentAttempt.pending && <div className="mb-3"><Alert kind="warn">Résultat incertain ou lecture non confirmée : vérifiez cet encaissement avec sa clé d’origine avant d’en créer un autre. La tentative est conservée dans cet onglet. {!canWriteSubscription && 'La reprise est suspendue en lecture seule ; consultez l’historique et conservez la tentative.'}</Alert></div>}
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input label="Montant à encaisser (FCFA)" type="number" min="1" max={w.total - w.paid} disabled={!allow('payments.create') || payBusy || Boolean(paymentAttempt.pending)} value={paymentAttempt.pending?.amount ?? amount} onChange={(e) => setAmount(readNumber(e.target.value))} />
            <Select label="Moyen de paiement" disabled={!allow('payments.create') || payBusy || Boolean(paymentAttempt.pending)} value={paymentAttempt.pending?.method ?? (methods.includes(method) ? method : '')} onChange={(e) => setMethod(e.target.value as PayMethod)}>{!paymentAttempt.pending && !methods.includes(method) && <option value="">{methods.length === 0 ? 'Aucun moyen configuré' : 'Choisir un moyen'}</option>}{paymentAttempt.pending && !methods.includes(paymentAttempt.pending.method) && <option value={paymentAttempt.pending.method}>{PAY_METHOD_LABELS[paymentAttempt.pending.method]} (tentative initiale)</option>}{methods.map((m) => <option key={m} value={m}>{PAY_METHOD_LABELS[m]}</option>)}</Select>
            <button className="btn btn-sm btn-primary" disabled={!allow('payments.create') || payBusy || Boolean(paymentAttempt.error)} onClick={pay}>{payBusy ? 'Vérification…' : paymentAttempt.pending ? 'Vérifier le paiement' : 'Encaisser'}</button>
          </div>
        </div>
      )}

      {w.plate && (
        <div className="mt-4">
          <button className="btn btn-sm" onClick={() => safe(async () => { setHistoryRows(await onVehicleHistory(w.plate)); })}>
            <FiTruck /> Historique du véhicule {w.plate}
          </button>
          {historyRows && (
            <div className="mt-2 rounded-xl border p-3">
              {historyRows.length === 0 ? <p className="text-base-content/60 text-xs">Aucun autre lavage pour cette plaque.</p> : (
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
        <div className="mt-4 rounded-xl border p-4">
          <p className="mb-2 text-sm font-bold">Affecter / réaffecter</p>
          <div className="max-h-[140px] space-y-1 overflow-y-auto">
            {employees.map((u) => (
              <label key={u.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs bg-base-200">
                <input type="checkbox" className="accent-sky-500" disabled={!allow('washes.assign')} checked={selected.includes(u.id)}
                  onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, u.id] : ids.filter((id) => id !== u.id))} />
                <span className="flex-1 truncate">{u.name}</span>
              </label>
            ))}
          </div>
          <div className="mt-2"><Select label="Poste" disabled={!allow('washes.assign')} value={postId} onChange={(e) => setPostId(e.target.value)}><option value="">Aucun poste</option>{posts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-sm" onClick={() => setAssignMode(false)}>Revenir</button>
            <button className="btn btn-sm btn-primary" disabled={!allow('washes.assign') || selected.length === 0}
              onClick={() => safe(async () => { await onAssign(selected, postId || null); setAssignMode(false); })}>Valider l’affectation</button>
          </div>
        </div>
      )}

      {w.status === 'quality_check' && (
        <div className="mt-4 rounded-xl border border-sky-500/30 p-4">
          <p className="mb-2 text-sm font-bold">Contrôle qualité obligatoire</p>
          <Input label="Notes (facultatives, obligatoires en cas de refus)" disabled={!allow('washes.quality')} value={qualityNotes} onChange={(e) => setQualityNotes(e.target.value)} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-sm btn-primary" disabled={!allow('washes.quality')}
              onClick={() => safe(async () => { await onQuality('approved', qualityNotes); })}><FiCheckCircle /> Valider → Prêt</button>
            <button className="btn btn-sm btn-error btn-outline" disabled={!allow('washes.quality')}
              onClick={() => safe(async () => { await onQuality('rejected', qualityNotes || 'Reprise demandée'); })}>Refuser → Reprise</button>
          </div>
          {w.qualityResult && <p className="text-base-content/60 mt-2 text-xs">Dernier contrôle : {w.qualityResult === 'approved' ? 'validé' : 'refusé'}{w.qualityNotes ? ` · ${w.qualityNotes}` : ''}</p>}
        </div>
      )}

      {cancelMode && (
        <div className="mt-4 rounded-xl border border-red-500/30 p-4">
          <p className="mb-2 text-sm font-bold">Annuler la fiche</p>
          <Input label="Motif de l’annulation *" disabled={!allow('washes.update_status')} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="mt-3 flex gap-2">
            <button className="btn btn-sm" onClick={() => setCancelMode(false)}>Revenir</button>
            <button className="btn btn-sm btn-error btn-outline" disabled={!allow('washes.update_status') || !reason.trim()}
              onClick={() => { onStatus('cancelled', reason.trim()); setCancelMode(false); onClose(); }}>Confirmer l’annulation</button>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
        {next.map((s) => (
          <button key={s} className={`btn btn-sm ${s === 'delivered' ? 'btn-primary' : 'btn-ghost'}`}
            disabled={!allow(s === 'delivered' ? 'washes.quality' : 'washes.update_status')}
            onClick={() => onStatus(s)}>
            {s === 'delivered' && <FiCheckCircle />}{NEXT_LABELS[s] ?? WASH_STATUS_LABELS[s]}
          </button>
        ))}
        {w.status !== 'delivered' && w.status !== 'cancelled' && allow('washes.assign') && (
          <button className="btn btn-sm" onClick={() => { setSelected(w.assignedUserIds); setPostId(w.postId ?? ''); setAssignMode(true); }}><FiUsers /> Affecter</button>
        )}
        {w.status !== 'cancelled' && w.status !== 'delivered' && (
          <button className="btn btn-sm btn-error btn-outline" disabled={!allow('washes.update_status')} onClick={() => setCancelMode(true)}>Annuler</button>
        )}
        <button className="btn btn-sm ml-auto" onClick={onClose}>Fermer</button>
      </div>
      {w.cancelledReason && <p className="text-base-content/60 mt-2 text-xs">Motif : {w.cancelledReason}</p>}
      {w.deliveredAt && <p className="text-base-content/60 mt-1 text-xs">Livré le {formatDateTime(w.deliveredAt)} — distinct de « prêt ».</p>}
    </Modal>
    {receipt && <WashReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
  </>);
}
