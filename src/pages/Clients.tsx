import React, { useMemo, useState } from 'react';
import { FiPlus, FiSearch, FiUsers, FiX } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { formatDate, formatFCFA } from '../lib/format';
import { Badge, Breadcrumbs, Card, Drawer, EmptyState, Input, Modal, PageHeader } from '../components/ui';

export default function Clients() {
  const { state, addClient, updateClient } = useStore();
  const [open, setOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [f, setF] = useState({ name: '', phone: '', plate: '', notes: '' });
  const q = search.trim().toLowerCase();
  const clients = useMemo(() => state.clients.filter((c) =>
    !q || c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q) || c.plate.toLowerCase().includes(q)
  ), [state.clients, q]);
  const detail = state.clients.find((c) => c.id === detailId);
  const history = detail ? state.washes.filter((w) => w.clientId === detail.id) : [];

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Commercial', to: '/app/clients' }, { label: 'Clients & Véhicules' }]} />
      <PageHeader title="Clients" subtitle="Fiche facultative : nom, téléphone, plaque et notes. Un lavage peut être encaissé sans créer de client."
        actions={<button className="wg-btn wg-btn-primary" onClick={() => setOpen(true)}><FiPlus /> Nouveau client</button>} />

      <Card className="mb-5">
        <div className="relative">
          <FiSearch className="wg-muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
          <input className="wg-input !pl-9" placeholder="Rechercher par nom, téléphone ou plaque…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </Card>

      {clients.length === 0 ? (
        <EmptyState icon={<FiUsers />} title="Aucune fiche client" description="Les fiches sont facultatives : les lavages sans client restent enregistrés normalement." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => {
            const washes = state.washes.filter((w) => w.clientId === c.id && w.status !== 'annule');
            return (
              <Card key={c.id} className="cursor-pointer transition hover:border-sky-500/50" onClick={() => setDetailId(c.id)}>
                <div className="flex items-center gap-3">
                  <span className="wg-gradient grid h-10 w-10 place-items-center rounded-xl text-sm font-bold text-white">{c.name.slice(0, 2).toUpperCase()}</span>
                  <div className="min-w-0"><p className="truncate text-sm font-bold">{c.name}</p><p className="wg-muted truncate text-xs">{c.phone || 'Téléphone non renseigné'}</p></div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {c.plate && <Badge tone="accent">{c.plate}</Badge>}
                  <Badge>{washes.length} lavage(s)</Badge>
                  <Badge tone="success">{formatFCFA(washes.reduce((s, w) => s + w.total, 0))}</Badge>
                </div>
                {c.notes && <p className="wg-muted mt-3 truncate text-xs">Notes : {c.notes}</p>}
                <p className="wg-muted mt-2 text-[11px]">Fiche créée le {formatDate(c.createdAt)}</p>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Nouveau client">
        <div className="space-y-3">
          <Input label="Nom *" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Téléphone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            <Input label="Plaque" value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} />
          </div>
          <Input label="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" onClick={() => setOpen(false)}><FiX /> Annuler</button>
          <button className="wg-btn wg-btn-primary" onClick={() => { if (!f.name.trim()) return; addClient(f); setF({ name: '', phone: '', plate: '', notes: '' }); setOpen(false); }}>Créer la fiche</button>
        </div>
      </Modal>

      <Drawer
        open={Boolean(detail)}
        onClose={() => setDetailId(null)}
        title={detail?.name ?? 'Client'}
        subtitle={detail?.phone ? `Contact : ${detail.phone}` : 'Fiche client'}
        width="max-w-xl"
      >
        {detail && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Nom" value={detail.name} onChange={(e) => updateClient(detail.id, { name: e.target.value })} />
              <Input label="Téléphone" value={detail.phone} onChange={(e) => updateClient(detail.id, { phone: e.target.value })} />
              <Input label="Plaque" value={detail.plate} onChange={(e) => updateClient(detail.id, { plate: e.target.value })} />
              <Input label="Notes" value={detail.notes} onChange={(e) => updateClient(detail.id, { notes: e.target.value })} />
            </div>
            <p className="wg-muted mt-2 text-[11px]">Les modifications sont enregistrées immédiatement.</p>
            <h3 className="mt-6 text-sm font-bold text-slate-200">Historique des lavages</h3>
            {history.length === 0 ? <p className="wg-muted mt-2 text-xs">Aucun lavage rattaché à cette fiche.</p> : (
              <div className="wg-scroll-x mt-3 rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}>
                <table>
                  <thead><tr><th className="wg-th">Fiche</th><th className="wg-th">Date</th><th className="wg-th">Véhicule</th><th className="wg-th">Total</th><th className="wg-th">Payé</th></tr></thead>
                  <tbody>{history.map((w) => (
                    <tr key={w.id}><td className="wg-td font-bold">{w.number}</td><td className="wg-td">{formatDate(w.createdAt)}</td><td className="wg-td">{w.vehicleLabel}</td><td className="wg-td">{formatFCFA(w.total)}</td><td className="wg-td">{formatFCFA(w.paid)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}
