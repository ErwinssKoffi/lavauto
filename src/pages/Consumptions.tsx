import { readNumber } from '../lib/validation';
import React, { useState } from 'react';
import { FiAlertTriangle, FiLayers, FiPlus, FiRefreshCw, FiX } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { formatDate, formatFCFA } from '../lib/format';
import {
  Alert, Badge, Card, EmptyState, Input, LockedPanel, Modal, PageHeader,
  Select, StatCard, useSafeAction,
} from '../components/ui';

export default function Consumptions() {
  const { state, dataSource, canWriteSubscription, refreshStock, saveServiceConsumption, consumeWash } = useStore();
  const safe = useSafeAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ serviceId: '', productId: '', qtyPerWash: 1, active: true });
  const activated = Boolean(state.station?.activated);
  const canOperate = activated && canWriteSubscription;
  const productById = new Map(state.products.map((p) => [p.id, p]));
  const serviceById = new Map(state.stockServices.map((s) => [s.id, s]));
  const consumed = new Set(state.consumptionRuns.map((r) => r.washId));
  const eligible = state.washes.filter((w) => ['ready', 'delivered'].includes(w.status) && !consumed.has(w.id));
  const consumptionMovements = state.stockMovements.filter((m) => m.kind === 'consumption');
  const totalValued = state.consumptionRuns.reduce((sum, r) => sum + r.valuedMinor, 0);

  return (
    <div>
      <PageHeader title="Consommations" subtitle="Normes produit × prestation, consommation théorique valorisée une seule fois par lavage et coût de revient certifiable."
        actions={<div className="flex gap-2">
          {dataSource === 'supabase' && <button className="wg-btn wg-btn-ghost" onClick={() => { void refreshStock().catch(() => {}); }}><FiRefreshCw /> Actualiser</button>}
          <button className="wg-btn wg-btn-primary" disabled={!canOperate || state.stockServices.length === 0 || state.products.length === 0} onClick={() => setOpen(true)}><FiPlus /> Nouvelle norme</button>
        </div>} />

      {!activated && <div className="mb-5"><LockedPanel /></div>}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Normes actives" value={String(state.serviceConsumptions.filter((r) => r.active).length)} hint="Produit × prestation" icon={<FiLayers />} />
        <StatCard label="Lavages consommés" value={String(state.consumptionRuns.length)} hint="Une seule fois par fiche" />
        <StatCard label="Coût valorisé" value={formatFCFA(totalValued)} hint="Coût moyen figé à la sortie" />
        <StatCard label="Mouvements de sortie" value={String(consumptionMovements.length)} hint="Immuables et tracés" />
      </div>

      <div className="mb-5"><Alert kind="info">
        La consommation est calculée par addition des normes de chaque prestation, arrondie à l’unité supérieure, puis agrégée par produit. Le coût est figé au coût moyen du moment ; une fiche ne peut pas être consommée deux fois.
      </Alert></div>

      {eligible.length > 0 && <div className="mb-5"><Alert kind="warn"><FiAlertTriangle className="mr-1 inline" />
        {eligible.length} fiche(s) terminée(s) sans consommation valorisée. Le résultat net restera non calculable tant que les coûts ne sont pas complets.
      </Alert></div>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-bold">Normes de consommation théorique</h2>
          {state.serviceConsumptions.length === 0 ? <EmptyState icon={<FiLayers />} title="Aucune norme" description="Associez un produit à une prestation pour valoriser les lavages terminés." /> : (
            <div className="wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}><table>
              <thead><tr><th className="wg-th">Prestation</th><th className="wg-th">Produit</th><th className="wg-th">Qté / lavage</th><th className="wg-th">État</th></tr></thead>
              <tbody>{state.serviceConsumptions.map((r) => (
                <tr key={r.id}><td className="wg-td font-semibold">{serviceById.get(r.serviceId)?.name ?? r.serviceId}</td>
                  <td className="wg-td">{productById.get(r.productId)?.name ?? r.productId}</td>
                  <td className="wg-td font-bold">{r.qtyPerWash}</td>
                  <td className="wg-td"><Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'Active' : 'Inactive'}</Badge></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-bold">Fiches à consommer</h2>
          {eligible.length === 0 ? <EmptyState icon={<FiLayers />} title="Aucune fiche en attente" description="Toutes les fiches terminées ou livrées sont déjà valorisées, ou aucune n’est encore prête." /> : (
            <div className="wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}><table>
              <thead><tr><th className="wg-th">Fiche</th><th className="wg-th">Véhicule</th><th className="wg-th">Statut</th><th className="wg-th" /></tr></thead>
              <tbody>{eligible.map((w) => (
                <tr key={w.id}><td className="wg-td font-semibold">{w.number}</td><td className="wg-td">{w.plate}</td>
                  <td className="wg-td"><Badge>{w.status === 'delivered' ? 'Livrée' : 'Prête'}</Badge></td>
                  <td className="wg-td"><button className="wg-link text-xs" disabled={!canOperate} onClick={() => safe(async () => { await consumeWash(w.id); })}>Consommer</button></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-bold">Exécutions valorisées</h2>
          {state.consumptionRuns.length === 0 ? <EmptyState icon={<FiLayers />} title="Aucune consommation" description="Chaque exécution crée un relevé et des mouvements de sortie valorisés." /> : (
            <div className="wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}><table>
              <thead><tr><th className="wg-th">Date</th><th className="wg-th">Fiche</th><th className="wg-th">Mouvements</th><th className="wg-th">Valeur</th></tr></thead>
              <tbody>{state.consumptionRuns.map((r) => (
                <tr key={r.id}><td className="wg-td">{formatDate(r.createdAt)}</td><td className="wg-td font-semibold">{r.washId}</td>
                  <td className="wg-td">{r.movementCount}</td><td className="wg-td font-bold">{formatFCFA(r.valuedMinor)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-bold">Sorties de stock</h2>
          {consumptionMovements.length === 0 ? <EmptyState icon={<FiLayers />} title="Aucune sortie" description="Les sorties valorisées alimentent le coût de revient de la période." /> : (
            <div className="wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}><table>
              <thead><tr><th className="wg-th">Produit</th><th className="wg-th">Quantité</th><th className="wg-th">Coût unitaire</th><th className="wg-th">Valeur</th></tr></thead>
              <tbody>{consumptionMovements.map((m) => (
                <tr key={m.id}><td className="wg-td font-semibold">{productById.get(m.productId)?.name ?? m.productId}</td>
                  <td className="wg-td">{Math.abs(m.qtyDelta)}</td><td className="wg-td">{formatFCFA(m.unitCostMinor)}</td>
                  <td className="wg-td font-bold">{formatFCFA(Math.abs(m.qtyDelta) * m.unitCostMinor)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      </div>

      <p className="wg-muted mt-4 text-xs">La consommation ne remplace pas la certification : les achats rattachés, mouvements valorisés et commissions validées restent contrôlés avant publication du résultat net.</p>

      <Modal open={open} onClose={() => setOpen(false)} title="Nouvelle norme de consommation">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Prestation *" value={f.serviceId} onChange={(e) => setF({ ...f, serviceId: e.target.value })}>
            <option value="">Choisir une prestation</option>{state.stockServices.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select label="Produit *" value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}>
            <option value="">Choisir un produit</option>{state.products.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Input label="Quantité par lavage *" type="number" min="0.01" step="0.01" value={f.qtyPerWash} onChange={(e) => setF({ ...f, qtyPerWash: readNumber(e.target.value) })} />
          <Select label="État" value={f.active ? 'active' : 'inactive'} onChange={(e) => setF({ ...f, active: e.target.value === 'active' })}>
            <option value="active">Active</option><option value="inactive">Inactive</option>
          </Select>
        </div>
        <div className="mt-5 flex justify-end gap-2"><button className="wg-btn wg-btn-ghost" onClick={() => setOpen(false)}><FiX /> Annuler</button>
          <button className="wg-btn wg-btn-primary" disabled={!canOperate} onClick={() => safe(async () => {
            await saveServiceConsumption({ serviceId: f.serviceId, productId: f.productId, qtyPerWash: f.qtyPerWash, active: f.active });
            setF({ serviceId: '', productId: '', qtyPerWash: 1, active: true }); setOpen(false);
          })}>Enregistrer</button></div>
      </Modal>
    </div>
  );
}
