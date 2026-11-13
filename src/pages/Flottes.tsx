import { readNumber } from '../lib/validation';
import React, { useState } from 'react';
import { FiBriefcase, FiRefreshCw, FiTruck, FiUsers } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { formatDate, formatFCFA, todayISO } from '../lib/format';
import {
  Alert, Badge, Card, EmptyState, Input, LockedPanel, PageHeader,
  Select, StatCard, useSafeAction,
} from '../components/ui';

const key = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

export default function Flottes() {
  const {
    state, dataSource, canWriteSubscription, notify, refreshCrm,
    saveFleet, saveFleetContract, attachFleetVehicle,
    recordFleetReceivable, enqueueNotification,
  } = useStore();
  const safe = useSafeAction();
  const stationId = state.station?.id ?? '';
  const activated = Boolean(state.station?.activated);
  const canOperate = activated && canWriteSubscription;
  const stats = state.crmStats;

  const [fleet, setFleet] = useState({
    name: '', contactName: '', phone: '', email: '', creditLimit: 0,
    channel: 'sms',
  });
  const [contract, setContract] = useState({
    fleetId: '', number: '', startDate: todayISO(), endDate: '',
    discountPercent: 0, creditLimit: 0,
  });
  const [attach, setAttach] = useState({ fleetId: '', vehicleId: '', contractId: '' });
  const [receivable, setReceivable] = useState({
    fleetId: '', contractId: '', amount: 0, washId: '', dueDate: todayISO(),
    idempotencyKey: key('recv'),
  });
  const [notification, setNotification] = useState({
    fleetId: '', templateKey: 'contract_renewal', idempotencyKey: key('fnotif'),
  });

  const fleetById = new Map(state.fleets.map((f) => [f.id, f.name]));
  const contractById = new Map(state.fleetContracts.map((c) => [c.id, c.number]));
  const vehicleById = new Map(state.vehicles.map((v) => [v.id, v.plate]));
  const openContracts = state.fleetContracts.filter((c) => c.status === 'active');

  return (
    <div>
      <PageHeader title="Flottes & contrats" subtitle="Contrats, véhicules rattachés, créances ouvertes et préférence de canal."
        actions={dataSource === 'supabase' ? (
          <button className="wg-btn wg-btn-ghost" onClick={() => { void refreshCrm().catch(() => {}); }}><FiRefreshCw /> Actualiser</button>
        ) : undefined} />

      {!activated && <div className="mb-5"><LockedPanel /></div>}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Flottes" value={String(stats.fleets)} hint={`${state.fleetContracts.length} contrat(s)`} icon={<FiBriefcase />} />
        <StatCard label="Véhicules rattachés" value={String(state.fleetVehicles.length)} hint={`${state.vehicles.length} véhicule(s)`} icon={<FiTruck />} />
        <StatCard label="Créances ouvertes" value={formatFCFA(stats.openReceivablesMinor)} hint={`${state.fleetReceivables.filter((r) => r.status === 'open').length} ligne(s)`} />
        <StatCard label="File CRM en attente" value={String(stats.pendingNotifications)} hint="Aucun envoi pour cette file" icon={<FiUsers />} />
      </div>

      <div className="mb-5"><Alert kind="info">
        <strong>File d’attente uniquement :</strong> {state.crmRules.provider} {state.crmRules.tenant}
      </Alert></div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-bold">Nouvelle flotte</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Nom *" value={fleet.name} onChange={(e) => setFleet({ ...fleet, name: e.target.value })} />
            <Input label="Contact" value={fleet.contactName} onChange={(e) => setFleet({ ...fleet, contactName: e.target.value })} />
            <Input label="Téléphone" value={fleet.phone} onChange={(e) => setFleet({ ...fleet, phone: e.target.value })} />
            <Input label="E-mail" value={fleet.email} onChange={(e) => setFleet({ ...fleet, email: e.target.value })} />
            <Input label="Limite de crédit" type="number" min={0} value={fleet.creditLimit} onChange={(e) => setFleet({ ...fleet, creditLimit: readNumber(e.target.value) })} />
            <Select label="Canal préféré" value={fleet.channel} onChange={(e) => setFleet({ ...fleet, channel: e.target.value })}>
              <option value="none">Aucun</option><option value="sms">SMS</option><option value="email">E-mail</option><option value="whatsapp">WhatsApp</option>
            </Select>
          </div>
          <button className="wg-btn wg-btn-primary mt-4" disabled={!canOperate} onClick={() => safe(async () => {
            await saveFleet({ stationId, ...fleet, channel: fleet.channel as 'none' | 'sms' | 'email' | 'whatsapp' });
            setFleet({ name: '', contactName: '', phone: '', email: '', creditLimit: 0, channel: 'sms' });
            notify('success', 'Flotte enregistrée.');
          })}>Créer la flotte</button>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-bold">Contrat de flotte</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Flotte *" value={contract.fleetId} onChange={(e) => setContract({ ...contract, fleetId: e.target.value })}>
              <option value="">Choisir…</option>{state.fleets.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
            <Input label="Numéro *" value={contract.number} onChange={(e) => setContract({ ...contract, number: e.target.value.toUpperCase() })} />
            <Input label="Début" type="date" value={contract.startDate} onChange={(e) => setContract({ ...contract, startDate: e.target.value })} />
            <Input label="Fin" type="date" value={contract.endDate} onChange={(e) => setContract({ ...contract, endDate: e.target.value })} />
            <Input label="Remise (%)" type="number" min={0} max={100} value={contract.discountPercent} onChange={(e) => setContract({ ...contract, discountPercent: readNumber(e.target.value) })} />
            <Input label="Limite de crédit" type="number" min={0} value={contract.creditLimit} onChange={(e) => setContract({ ...contract, creditLimit: readNumber(e.target.value) })} />
          </div>
          <button className="wg-btn wg-btn-primary mt-4" disabled={!canOperate} onClick={() => safe(async () => {
            await saveFleetContract({ stationId, ...contract, endDate: contract.endDate || undefined });
            setContract({ fleetId: '', number: '', startDate: todayISO(), endDate: '', discountPercent: 0, creditLimit: 0 });
            notify('success', 'Contrat enregistré.');
          })}>Enregistrer le contrat</button>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-bold">Rattacher un véhicule</h2>
          <div className="grid gap-3">
            <Select label="Flotte *" value={attach.fleetId} onChange={(e) => setAttach({ ...attach, fleetId: e.target.value })}>
              <option value="">Choisir…</option>{state.fleets.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
            <Select label="Véhicule *" value={attach.vehicleId} onChange={(e) => setAttach({ ...attach, vehicleId: e.target.value })}>
              <option value="">Choisir…</option>{state.vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}
            </Select>
            <Select label="Contrat" value={attach.contractId} onChange={(e) => setAttach({ ...attach, contractId: e.target.value })}>
              <option value="">Aucun</option>{openContracts.map((c) => <option key={c.id} value={c.id}>{c.number}</option>)}
            </Select>
          </div>
          <button className="wg-btn wg-btn-primary mt-4" disabled={!canOperate} onClick={() => safe(async () => {
            await attachFleetVehicle({ stationId, fleetId: attach.fleetId, vehicleId: attach.vehicleId, contractId: attach.contractId || null });
            setAttach({ fleetId: '', vehicleId: '', contractId: '' }); notify('success', 'Véhicule rattaché.');
          })}>Rattacher</button>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-bold">Créance ouverte</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Flotte *" value={receivable.fleetId} onChange={(e) => setReceivable({ ...receivable, fleetId: e.target.value, contractId: '' })}>
              <option value="">Choisir…</option>{state.fleets.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
            <Select label="Contrat actif *" value={receivable.contractId} onChange={(e) => setReceivable({ ...receivable, contractId: e.target.value })}>
              <option value="">Choisir…</option>{openContracts.filter((c) => c.fleetId === receivable.fleetId).map((c) => <option key={c.id} value={c.id}>{c.number}</option>)}
            </Select>
            <Input label="Montant" type="number" min={1} value={receivable.amount} onChange={(e) => setReceivable({ ...receivable, amount: readNumber(e.target.value) })} />
            <Input label="Échéance" type="date" value={receivable.dueDate} onChange={(e) => setReceivable({ ...receivable, dueDate: e.target.value })} />
            <Select label="Fiche de lavage" value={receivable.washId} onChange={(e) => setReceivable({ ...receivable, washId: e.target.value })}>
              <option value="">Aucune</option>{state.washes.map((w) => <option key={w.id} value={w.id}>{w.number}</option>)}
            </Select>
          </div>
          <button className="wg-btn wg-btn-primary mt-4" disabled={!canOperate} onClick={() => safe(async () => {
            await recordFleetReceivable({ stationId, fleetId: receivable.fleetId, contractId: receivable.contractId, amountMinor: receivable.amount, washId: receivable.washId || null, dueDate: receivable.dueDate, idempotencyKey: receivable.idempotencyKey });
            setReceivable({ fleetId: '', contractId: '', amount: 0, washId: '', dueDate: todayISO(), idempotencyKey: key('recv') });
            notify('success', 'Créance enregistrée.');
          })}>Enregistrer la créance</button>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-bold">Notification en attente</h2>
          <p className="wg-muted mb-3 text-xs">File CRM historique distincte des avis WhatsApp de lavage prêt. Le canal choisi sur la flotte est obligatoire ; cette ligne reste en attente et n’est pas envoyée.</p>
          <div className="grid gap-3">
            <Select label="Flotte *" value={notification.fleetId} onChange={(e) => setNotification({ ...notification, fleetId: e.target.value })}>
              <option value="">Choisir…</option>{state.fleets.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.preferredChannel})</option>)}
            </Select>
            <Input label="Modèle" value={notification.templateKey} onChange={(e) => setNotification({ ...notification, templateKey: e.target.value })} />
          </div>
          <button className="wg-btn wg-btn-primary mt-4" disabled={!canOperate} onClick={() => safe(async () => {
            await enqueueNotification({ stationId, templateKey: notification.templateKey, fleetId: notification.fleetId, payload: {}, idempotencyKey: notification.idempotencyKey });
            setNotification({ fleetId: '', templateKey: 'contract_renewal', idempotencyKey: key('fnotif') });
            notify('success', 'Notification en attente, aucun envoi.');
          })}>Mettre en attente</button>
        </Card>

        <Card className="!p-0 overflow-hidden">
          <div className="p-4 text-sm font-bold">Contrats & créances</div>
          {state.fleetContracts.length === 0 ? <EmptyState icon={<FiBriefcase />} title="Aucun contrat" description="Créez une flotte puis son contrat." /> : (
            <div className="wg-scroll-x"><table>
              <thead><tr><th className="wg-th">Numéro</th><th className="wg-th">Flotte</th><th className="wg-th">Crédit</th><th className="wg-th">Statut</th></tr></thead>
              <tbody>{state.fleetContracts.map((c) => (
                <tr key={c.id}><td className="wg-td font-bold">{c.number}</td><td className="wg-td">{fleetById.get(c.fleetId) ?? '—'}</td><td className="wg-td">{formatFCFA(c.creditLimitMinor)}</td><td className="wg-td"><Badge tone={c.status === 'active' ? 'success' : 'neutral'}>{c.status}</Badge></td></tr>
              ))}</tbody>
            </table></div>
          )}
          {state.fleetReceivables.length > 0 && <div className="wg-scroll-x border-t" style={{ borderColor: 'var(--wg-border)' }}><table>
            <thead><tr><th className="wg-th">Échéance</th><th className="wg-th">Contrat</th><th className="wg-th">Montant</th><th className="wg-th">Statut</th></tr></thead>
            <tbody>{state.fleetReceivables.map((r) => (
              <tr key={r.id}><td className="wg-td">{r.dueDate}</td><td className="wg-td">{contractById.get(r.contractId) ?? '—'}</td><td className="wg-td font-bold">{formatFCFA(r.amountMinor)}</td><td className="wg-td"><Badge tone={r.status === 'open' ? 'warn' : 'success'}>{r.status}</Badge></td></tr>
            ))}</tbody>
          </table></div>}
        </Card>

        <Card className="lg:col-span-2 !p-0 overflow-hidden">
          <div className="p-4 text-sm font-bold">Véhicules & file</div>
          {state.fleetVehicles.length === 0 && state.notificationOutbox.filter((n) => n.fleetId).length === 0
            ? <EmptyState icon={<FiTruck />} title="Aucun rattachement" description="Rattachez un véhicule à une flotte pour le suivre ici." />
            : <div className="wg-scroll-x"><table>
              <thead><tr><th className="wg-th">Type</th><th className="wg-th">Référence</th><th className="wg-th">Flotte</th><th className="wg-th">Date</th></tr></thead>
              <tbody>
                {state.fleetVehicles.map((v) => (
                  <tr key={v.id}><td className="wg-td">Véhicule</td><td className="wg-td font-bold">{vehicleById.get(v.vehicleId) ?? v.vehicleId}</td><td className="wg-td">{fleetById.get(v.fleetId) ?? '—'}</td><td className="wg-td">{formatDate(v.createdAt)}</td></tr>
                ))}
                {state.notificationOutbox.filter((n) => n.fleetId).map((n) => (
                  <tr key={n.id}><td className="wg-td">Notification</td><td className="wg-td font-bold">{n.templateKey} ({n.channel})</td><td className="wg-td">{fleetById.get(n.fleetId ?? '') ?? '—'}</td><td className="wg-td"><Badge tone={n.status === 'pending' ? 'warn' : 'neutral'}>{n.status}</Badge></td></tr>
                ))}
              </tbody>
            </table></div>}
        </Card>
      </div>
    </div>
  );
}
