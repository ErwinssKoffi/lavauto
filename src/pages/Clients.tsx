import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FiPlus, FiSearch, FiUsers, FiX } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { formatDate, formatFCFA } from '../lib/format';
import { CRM_CHANNELS } from '../lib/crm';
import { validateCustomer, validatePlate } from '../lib/validation';
import type { CrmChannel } from '../types';
import { WhatsappConsentPanel } from '../components/WhatsappPanels';
import { usePermissions } from '../lib/usePermissions';
import {
  Alert, Badge, Card, EmptyState, Input, Modal, PageHeader, Select, useSafeAction,
} from '../components/ui';

type Form = {
  name: string;
  phone: string;
  email: string;
  plate: string;
  notes: string;
  channel: CrmChannel;
  loyaltyOptIn: boolean;
  fleetId: string;
};

const emptyForm = (): Form => ({
  name: '', phone: '', email: '', plate: '', notes: '',
  channel: 'none', loyaltyOptIn: false, fleetId: '',
});

export default function Clients() {
  const {
    state, dataSource, canWriteSubscription, notify, saveCustomerProfile, saveCustomerVehicle,
  } = useStore();
  const safe = useSafeAction();
  const { can } = usePermissions();
  const showLoyalty = can('loyalty.view');
  const showFleets = can('fleets.view');
  const canEdit = canWriteSubscription && (dataSource === 'local' || can('customers.manage'));
  const [open, setOpen] = useState(false);
  const [createdCustomerId, setCreatedCustomerId] = useState<string | null>(null);
  const createdRef = useRef<string | null>(null);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [f, setF] = useState<Form>(emptyForm);
  const [draft, setDraft] = useState<Form>(emptyForm);
  const stationId = state.station?.id ?? '';
  const q = search.trim().toLowerCase();

  const clients = useMemo(() => state.clients.filter((c) =>
    !q || c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q)
      || c.plate.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q)
  ), [state.clients, q]);
  const detail = state.clients.find((c) => c.id === detailId);
  const history = detail ? state.washes.filter((w) => w.clientId === detail.id) : [];
  const vehicle = detail ? state.vehicles.find((v) => v.customerId === detail.id) : undefined;
  const cards = detail ? state.loyaltyCards.filter((c) => c.customerId === detail.id) : [];
  const packages = detail ? state.customerPackages.filter((p) => p.customerId === detail.id) : [];
  const notifications = detail ? state.notificationOutbox.filter((n) => n.customerId === detail.id) : [];

  useEffect(() => {
    if (!detail) return;
    setDraft({
      name: detail.name, phone: detail.phone, email: detail.email ?? '',
      plate: detail.plate || vehicle?.plate || '', notes: detail.notes,
      channel: detail.preferredChannel ?? 'none',
      loyaltyOptIn: detail.loyaltyOptIn ?? false,
      fleetId: detail.fleetId ?? '',
    });
  }, [detailId, detail?.id, vehicle?.plate]);

  const channelOptions = (
    <>{CRM_CHANNELS.map((c) => <option key={c} value={c}>{c === 'none' ? 'Aucun' : c}</option>)}</>
  );

  return (
    <div>
      <PageHeader title="Clients" subtitle="Fiche enrichie : contact, canal préféré, fidélité, forfaits, flotte et historique des lavages."
        actions={<button className="btn btn-sm btn-primary" disabled={!canEdit} onClick={() => setOpen(true)}><FiPlus /> Nouveau client</button>} />

      <Card className="mb-5">
        <div className="relative">
          <FiSearch className="text-base-content/60 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
          <input className="input input-bordered input-sm !pl-9" placeholder="Rechercher par nom, téléphone, e-mail ou plaque…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </Card>

      {clients.length === 0 ? (
        <EmptyState icon={<FiUsers />} title="Aucune fiche client" description="Les lavages sans client restent enregistrés normalement." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => {
            const washes = state.washes.filter((w) => w.clientId === c.id && w.status !== 'cancelled');
            return (
              <Card key={c.id} className="cursor-pointer transition hover:border-sky-500/50" onClick={() => setDetailId(c.id)}>
                <div className="flex items-center gap-3">
                  <span className="bg-gradient-to-br from-sky-600 via-sky-500 to-cyan-400 grid h-10 w-10 place-items-center rounded-xl text-sm font-bold text-white">{c.name.slice(0, 2).toUpperCase()}</span>
                  <div className="min-w-0"><p className="truncate text-sm font-bold">{c.name}</p><p className="text-base-content/60 truncate text-xs">{c.phone || 'Téléphone non renseigné'}</p></div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {c.plate && <Badge tone="accent">{c.plate}</Badge>}
                  <Badge>{washes.length} lavage(s)</Badge>
                  <Badge tone="success">{formatFCFA(washes.reduce((s, w) => s + w.total, 0))}</Badge>
                  {c.preferredChannel && c.preferredChannel !== 'none' && <Badge>{c.preferredChannel}</Badge>}
                </div>
                {c.notes && <p className="text-base-content/60 mt-3 truncate text-xs">Notes : {c.notes}</p>}
                <p className="text-base-content/60 mt-2 text-[11px]">Fiche créée le {formatDate(c.createdAt)}</p>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Nouveau client">
        {createdCustomerId && <div className="mb-3"><Alert kind="warn">Le client est déjà enregistré. Si le véhicule n’a pas été confirmé, réessayez seulement son rattachement ou fermez et consultez la fiche ; ne recréez pas le client.</Alert></div>}
        <fieldset disabled={!canEdit} className="min-w-0 space-y-3">
          <Input label="Nom *" disabled={Boolean(createdCustomerId) || creating} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Téléphone" disabled={Boolean(createdCustomerId) || creating} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            <Input label="E-mail" type="email" disabled={Boolean(createdCustomerId) || creating} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <Input label="Plaque" disabled={creating} value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} />
            <Select label="Canal préféré" disabled={Boolean(createdCustomerId) || creating} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as CrmChannel })}>{channelOptions}</Select>
          </div>
          <Input label="Notes" disabled={Boolean(createdCustomerId) || creating} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            {showFleets && <Select label="Flotte" disabled={Boolean(createdCustomerId) || creating} value={f.fleetId} onChange={(e) => setF({ ...f, fleetId: e.target.value })}>
              <option value="">Client individuel</option>{state.fleets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>}
            {showLoyalty && <label className="flex items-center gap-2 self-end pb-2 text-xs"><input type="checkbox" disabled={Boolean(createdCustomerId) || creating} checked={f.loyaltyOptIn} onChange={(e) => setF({ ...f, loyaltyOptIn: e.target.checked })} /> Inscrit au programme de fidélité</label>}
          </div>
        </fieldset>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-sm" onClick={() => setOpen(false)}><FiX /> Annuler</button>
          <button className="btn btn-sm btn-primary" disabled={creating || !canEdit} onClick={() => {
            if (creatingRef.current) return;
            creatingRef.current = true; setCreating(true);
            void safe(async () => {
              try {
                const profile = { stationId, name: f.name, phone: f.phone, email: f.email,
                  notes: f.notes, channel: f.channel, loyaltyOptIn: f.loyaltyOptIn, fleetId: f.fleetId || null };
                // Valider les deux saisies avant la première écriture.
                validateCustomer(profile); validatePlate(f.plate);
                let id = createdRef.current;
                if (!id) {
                  id = await saveCustomerProfile(profile);
                  createdRef.current = id; setCreatedCustomerId(id);
                }
                if (f.plate.trim()) await saveCustomerVehicle({ stationId, customerId: id, plate: f.plate });
                createdRef.current = null; setCreatedCustomerId(null);
                setF(emptyForm()); setOpen(false); notify('success', 'Fiche créée. Ouvrez-la pour enregistrer séparément l’accord WhatsApp explicite.');
              } finally { creatingRef.current = false; setCreating(false); }
            });
          }}>{creating ? 'Enregistrement…' : createdCustomerId ? 'Terminer le rattachement' : 'Créer la fiche'}</button>
        </div>
      </Modal>

      <Modal open={Boolean(detail)} onClose={() => setDetailId(null)} title={detail?.name ?? 'Client'} wide>
        {detail && <>
          <fieldset disabled={!canEdit} className="grid min-w-0 gap-3 sm:grid-cols-2">
            <Input label="Nom" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <Input label="Téléphone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            <Input label="E-mail" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            <Input label="Plaque" value={draft.plate} onChange={(e) => setDraft({ ...draft, plate: e.target.value })} />
            <Select label="Canal préféré" value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.target.value as CrmChannel })}>{channelOptions}</Select>
            {showFleets && <Select label="Flotte" value={draft.fleetId} onChange={(e) => setDraft({ ...draft, fleetId: e.target.value })}>
              <option value="">Client individuel</option>{state.fleets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>}
            <Input label="Notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            {showLoyalty && <label className="flex items-center gap-2 self-end pb-2 text-xs"><input type="checkbox" checked={draft.loyaltyOptIn} onChange={(e) => setDraft({ ...draft, loyaltyOptIn: e.target.checked })} /> Fidélité activée</label>}
          </fieldset>
          <div className="mt-4 flex justify-end"><button className="btn btn-sm btn-primary" disabled={!canEdit} onClick={() => safe(async () => {
            validateCustomer({ stationId, name: draft.name, phone: draft.phone, email: draft.email }); validatePlate(draft.plate);
            await saveCustomerProfile({
              stationId, customerId: detail.id, name: draft.name, phone: draft.phone,
              email: draft.email, notes: draft.notes, channel: draft.channel,
              loyaltyOptIn: draft.loyaltyOptIn, fleetId: draft.fleetId || null,
            });
            if (draft.plate.trim() && draft.plate.trim().toUpperCase() !== (vehicle?.plate ?? '')) {
              await saveCustomerVehicle({
                stationId, customerId: detail.id, plate: draft.plate,
                vehicleId: vehicle?.id ?? null, categoryId: vehicle?.categoryId ?? null,
              });
            }
            notify('success', 'Fiche client enregistrée.');
          })}>Enregistrer la fiche</button></div>

          <WhatsappConsentPanel key={`${detail.id}:${detail.phone}`} customerId={detail.id} phone={detail.phone} />

          {showLoyalty && <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Card><p className="text-base-content/60 text-[11px] uppercase">Cartes de fidélité</p><p className="mt-1 text-lg font-bold">{cards.length}</p><p className="text-base-content/60 text-xs">{cards.reduce((s, c) => s + c.pointsBalance, 0)} point(s)</p></Card>
            <Card><p className="text-base-content/60 text-[11px] uppercase">Forfaits</p><p className="mt-1 text-lg font-bold">{packages.filter((p) => p.status === 'active').length}</p><p className="text-base-content/60 text-xs">{packages.reduce((s, p) => s + p.washesRemaining, 0)} lavage(s) restant(s)</p></Card>
            <Card><p className="text-base-content/60 text-[11px] uppercase">File CRM historique</p><p className="mt-1 text-lg font-bold">{notifications.filter((n) => n.status === 'pending').length}</p><p className="text-base-content/60 text-xs">en attente, aucun envoi ; hors avis lavage prêt</p></Card>
          </div>}

          <h3 className="mt-6 text-sm font-bold">Historique des lavages</h3>
          {history.length === 0 ? <p className="text-base-content/60 mt-2 text-xs">Aucun lavage rattaché à cette fiche.</p> : (
            <div className="overflow-x-auto mt-3 rounded-xl border">
              <table className="table min-w-[620px]">
                <thead><tr><th>Fiche</th><th>Date</th><th>Véhicule</th><th>Total</th><th>Payé</th></tr></thead>
                <tbody>{history.map((w) => (
                  <tr key={w.id}><td className="font-bold">{w.number}</td><td>{formatDate(w.createdAt)}</td><td>{w.vehicleLabel}</td><td>{formatFCFA(w.total)}</td><td>{formatFCFA(w.paid)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>}
      </Modal>
    </div>
  );
}
