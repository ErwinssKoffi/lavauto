import { readNumber } from '../lib/validation';
import React, { useState } from 'react';
import { FiAlertTriangle, FiBox, FiPackage, FiPlus, FiRefreshCw, FiTruck, FiX } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { formatDate, formatFCFA, todayISO } from '../lib/format';
import { STOCK_EXPENSE_CATEGORIES, STOCK_RULES } from '../lib/stock';
import {
  Alert, Badge, Card, EmptyState, Input, LockedPanel, Modal, PageHeader,
  Select, StatCard, Tabs, Textarea, useSafeAction,
} from '../components/ui';

type Tab = 'produits' | 'fournisseurs' | 'commandes' | 'inventaire' | 'mouvements' | 'couts';
type ModalId = 'product' | 'supplier' | 'order' | 'receipt' | 'count' | 'link' | 'cert' | null;

const TABS: { id: Tab; label: string }[] = [
  { id: 'produits', label: 'Produits & niveaux' },
  { id: 'fournisseurs', label: 'Fournisseurs' },
  { id: 'commandes', label: 'Commandes & réceptions' },
  { id: 'inventaire', label: 'Inventaires' },
  { id: 'mouvements', label: 'Mouvements' },
  { id: 'couts', label: 'Coûts certifiés' },
];

const key = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyée', partially_received: 'Partiellement reçue',
  received: 'Reçue', cancelled: 'Annulée',
};

const MOVEMENT_LABELS: Record<string, string> = {
  purchase_receipt: 'Réception', consumption: 'Consommation',
  inventory_adjustment: 'Ajustement inventaire', return: 'Retour', loss: 'Perte',
};

export default function Stock() {
  const {
    state, dataSource, refreshStock, saveSupplier, saveProduct,
    createPurchaseOrder, receivePurchaseLines, startInventory,
    recordInventoryCount, closeInventory, linkExpenseToOrder, certifyCosts,
  } = useStore();
  const safe = useSafeAction();
  const [tab, setTab] = useState<Tab>('produits');
  const [modal, setModal] = useState<ModalId>(null);
  const stationId = state.station?.id ?? '';
  const activated = Boolean(state.station?.activated);
  const productById = new Map(state.products.map((p) => [p.id, p]));
  const orderById = new Map(state.purchaseOrders.map((o) => [o.id, o]));
  const openSession = state.inventorySessions.find((s) => s.status === 'open');
  const stockExpenses = state.expenses.filter((e) => e.status === 'enregistree'
    && STOCK_EXPENSE_CATEGORIES.includes(e.category.trim().toLowerCase()));

  const [supplier, setSupplier] = useState({ name: '', phone: '', email: '', address: '' });
  const [product, setProduct] = useState({ name: '', sku: '', category: '', unit: 'unité', reorderLevel: 0 });
  const [order, setOrder] = useState({
    number: `CMD-${todayISO().replace(/-/g, '')}-01`, supplierId: '',
    productId: '', qty: 1, unitCost: 0, expectedAt: '', idempotencyKey: key('cmd'),
  });
  const [receipt, setReceipt] = useState({
    orderId: '', productId: '', qty: 1, unitCost: 0, receiptKey: key('rec'),
  });
  const [count, setCount] = useState({ sessionId: '', productId: '', countedQty: 0, reason: '' });
  const [link, setLink] = useState({ expenseId: '', orderId: '' });
  const [cert, setCert] = useState({ start: todayISO().slice(0, 7) + '-01', end: todayISO(), attestation: '' });

  const openModal = (id: Exclude<ModalId, null>) => {
    if (id === 'order') setOrder((f) => ({ ...f, idempotencyKey: key('cmd') }));
    if (id === 'receipt') setReceipt((f) => ({ ...f, receiptKey: key('rec') }));
    if (id === 'count') setCount((f) => ({ ...f, sessionId: openSession?.id ?? '' }));
    setModal(id);
  };
  const close = () => setModal(null);

  return (
    <div>
      <PageHeader title="Stocks & achats" subtitle="Produits, fournisseurs, commandes, réceptions partielles, inventaires et mouvements valorisés."
        actions={<div className="flex gap-2">
          {dataSource === 'supabase' && <button className="wg-btn wg-btn-ghost" onClick={() => { void refreshStock().catch(() => {}); }}><FiRefreshCw /> Actualiser</button>}
          <button className="wg-btn wg-btn-primary" disabled={!activated} onClick={() => openModal('product')}><FiPlus /> Nouveau produit</button>
        </div>} />

      {!activated && <div className="mb-5"><LockedPanel /></div>}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Valeur du stock" value={formatFCFA(state.stockValuation.stockValueMinor)} hint="Quantité × coût moyen" icon={<FiPackage />} />
        <StatCard label="Produits valorisés" value={String(state.stockValuation.productsValued)} hint={`${state.products.length} produit(s)`} />
        <StatCard label="Commandes ouvertes" value={String(state.stockValuation.openOrders)} hint="Créées sans stock" icon={<FiTruck />} />
        <StatCard label="Alertes de seuil" value={String(state.stockAlerts.length)} hint={`${state.stockAlerts.filter((a) => a.severity === 'rupture').length} rupture(s)`} accent="bg-amber-500/10 text-amber-400" />
        <StatCard label="Consommations valorisées" value={formatFCFA(state.stockValuation.consumptionCostMinor)} hint="Mouvements de sortie" icon={<FiBox />} />
      </div>

      <div className="mb-5"><Alert kind="info">
        <strong>Règles comptables :</strong> {Object.values(STOCK_RULES).join(' · ')}. Les achats ne sont jamais une charge de période : seule la consommation valorisée alimente le coût de revient.
      </Alert></div>

      {state.stockAlerts.length > 0 && <div className="mb-5"><Alert kind="warn"><FiAlertTriangle className="mr-1 inline" />
        {state.stockAlerts.length} produit(s) sous le seuil : {state.stockAlerts.slice(0, 4).map((a) => `${a.name} (${a.qtyOnHand}/${a.reorderLevel})`).join(', ')}.
      </Alert></div>}

      <div className="mb-5"><Tabs value={tab} onChange={setTab} options={TABS} /></div>

      {tab === 'produits' && <Card className="!p-0 overflow-hidden">
        <div className="flex items-center justify-between p-4"><h2 className="text-sm font-bold">Niveaux et coût moyen pondéré</h2><Badge>{state.stockLevels.length} ligne(s)</Badge></div>
        {state.stockLevels.length === 0 ? <EmptyState icon={<FiPackage />} title="Aucun produit en stock" description="Créez un produit, puis une commande : la création n’incrémente jamais le stock." /> : (
          <div className="wg-scroll-x"><table>
            <thead><tr><th className="wg-th">Produit</th><th className="wg-th">Unité</th><th className="wg-th">Seuil</th><th className="wg-th">Disponible</th><th className="wg-th">Coût moyen</th><th className="wg-th">Valeur</th></tr></thead>
            <tbody>{state.stockLevels.map((l) => (
              <tr key={`${l.stationId}:${l.productId}`}>
                <td className="wg-td font-semibold">{l.name}{l.qtyOnHand <= l.reorderLevel && <Badge tone={l.qtyOnHand === 0 ? 'danger' : 'warn'}>{l.qtyOnHand === 0 ? 'Rupture' : 'Seuil'}</Badge>}</td>
                <td className="wg-td">{l.unit}</td><td className="wg-td">{l.reorderLevel}</td>
                <td className="wg-td font-bold">{l.qtyOnHand}</td>
                <td className="wg-td">{formatFCFA(l.averageCostMinor)}</td>
                <td className="wg-td">{formatFCFA(l.valueMinor)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>}

      {tab === 'fournisseurs' && <Card>
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold">Fournisseurs</h2><button className="wg-btn wg-btn-primary" disabled={!activated} onClick={() => openModal('supplier')}><FiPlus /> Nouveau fournisseur</button></div>
        {state.suppliers.length === 0 ? <EmptyState icon={<FiTruck />} title="Aucun fournisseur" description="Ajoutez un fournisseur pour l’associer à une commande." /> : (
          <div className="wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}><table>
            <thead><tr><th className="wg-th">Nom</th><th className="wg-th">Téléphone</th><th className="wg-th">E-mail</th><th className="wg-th">Adresse</th><th className="wg-th">État</th></tr></thead>
            <tbody>{state.suppliers.map((s) => (
              <tr key={s.id}><td className="wg-td font-semibold">{s.name}</td><td className="wg-td">{s.phone || '—'}</td>
                <td className="wg-td">{s.email || '—'}</td><td className="wg-td">{s.address || '—'}</td>
                <td className="wg-td"><Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Actif' : 'Inactif'}</Badge></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>}

      {tab === 'commandes' && <div className="grid gap-5">
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold">Commandes fournisseurs</h2>
            <div className="flex gap-2"><button className="wg-btn wg-btn-ghost" disabled={!activated || state.products.length === 0} onClick={() => openModal('order')}><FiPlus /> Commander</button>
              <button className="wg-btn wg-btn-primary" disabled={!activated || state.purchaseOrders.length === 0} onClick={() => openModal('receipt')}>Réceptionner</button></div>
          </div>
          {state.purchaseOrders.length === 0 ? <EmptyState icon={<FiTruck />} title="Aucune commande" description="Une commande est un engagement : aucun mouvement de stock n’est créé à ce stade." /> : (
            <div className="wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}><table>
              <thead><tr><th className="wg-th">Numéro</th><th className="wg-th">Fournisseur</th><th className="wg-th">Date</th><th className="wg-th">Statut</th><th className="wg-th">Lignes reçues</th></tr></thead>
              <tbody>{state.purchaseOrders.map((o) => {
                const items = state.purchaseOrderItems.filter((i) => i.orderId === o.id);
                return <tr key={o.id}><td className="wg-td font-semibold">{o.number}</td>
                  <td className="wg-td">{state.suppliers.find((s) => s.id === o.supplierId)?.name ?? '—'}</td>
                  <td className="wg-td">{formatDate(o.orderedAt)}</td>
                  <td className="wg-td"><Badge tone={o.status === 'received' ? 'success' : o.status === 'cancelled' ? 'danger' : 'warn'}>{STATUS_LABELS[o.status] ?? o.status}</Badge></td>
                  <td className="wg-td">{items.filter((i) => i.qtyReceived >= i.qtyOrdered).length}/{items.length}</td></tr>;
              })}</tbody>
            </table></div>
          )}
          <p className="wg-muted mt-3 text-xs">{state.receiptEvents.length} réception(s) idempotente(s). Une même clé avec le même contenu ne compte jamais deux fois.</p>
        </Card>
        {state.purchaseOrderItems.length > 0 && <Card>
          <h2 className="mb-3 text-sm font-bold">Lignes commandées</h2>
          <div className="wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}><table>
            <thead><tr><th className="wg-th">Commande</th><th className="wg-th">Produit</th><th className="wg-th">Commandé</th><th className="wg-th">Reçu</th><th className="wg-th">Coût unitaire prévu</th></tr></thead>
            <tbody>{state.purchaseOrderItems.map((i) => (
              <tr key={i.id}><td className="wg-td">{orderById.get(i.orderId)?.number ?? '—'}</td>
                <td className="wg-td">{productById.get(i.productId)?.name ?? '—'}</td>
                <td className="wg-td">{i.qtyOrdered}</td><td className="wg-td font-bold">{i.qtyReceived}</td>
                <td className="wg-td">{formatFCFA(i.unitCostMinor)}</td></tr>
            ))}</tbody>
          </table></div>
        </Card>}
      </div>}

      {tab === 'inventaire' && <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold">Sessions d’inventaire</h2>
          <div className="flex gap-2"><button className="wg-btn wg-btn-ghost" disabled={!activated || Boolean(openSession)} onClick={() => safe(async () => { await startInventory(stationId); })}>Ouvrir un inventaire</button>
            <button className="wg-btn wg-btn-primary" disabled={!activated || !openSession} onClick={() => openModal('count')}>Saisir un comptage</button>
            {openSession && <button className="wg-btn wg-btn-danger" onClick={() => safe(async () => { await closeInventory(openSession.id); })}>Clôturer</button>}</div>
        </div>
        {state.inventorySessions.length === 0 ? <EmptyState icon={<FiBox />} title="Aucun inventaire" description="Un seul inventaire ouvert par station ; les écarts créent des mouvements tracés." /> : (
          <div className="wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}><table>
            <thead><tr><th className="wg-th">Ouvert le</th><th className="wg-th">Statut</th><th className="wg-th">Clôturé le</th><th className="wg-th">Lignes</th><th className="wg-th">Écarts</th></tr></thead>
            <tbody>{state.inventorySessions.map((s) => {
              const items = state.inventoryItems.filter((i) => i.sessionId === s.id);
              return <tr key={s.id}><td className="wg-td">{formatDate(s.startedAt)}</td>
                <td className="wg-td"><Badge tone={s.status === 'open' ? 'warn' : 'success'}>{s.status === 'open' ? 'Ouvert' : 'Clôturé'}</Badge></td>
                <td className="wg-td">{s.closedAt ? formatDate(s.closedAt) : '—'}</td>
                <td className="wg-td">{items.length}</td>
                <td className="wg-td">{items.filter((i) => i.difference !== 0).length}</td></tr>;
            })}</tbody>
          </table></div>
        )}
        {openSession && state.inventoryItems.some((i) => i.sessionId === openSession.id) && <div className="mt-4 wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}><table>
          <thead><tr><th className="wg-th">Produit</th><th className="wg-th">Théorique</th><th className="wg-th">Compté</th><th className="wg-th">Écart</th><th className="wg-th">Motif</th></tr></thead>
          <tbody>{state.inventoryItems.filter((i) => i.sessionId === openSession.id).map((i) => (
            <tr key={i.id}><td className="wg-td">{productById.get(i.productId)?.name ?? '—'}</td>
              <td className="wg-td">{i.expectedQty}</td><td className="wg-td font-bold">{i.countedQty}</td>
              <td className="wg-td">{i.difference > 0 ? '+' : ''}{i.difference}</td><td className="wg-td">{i.reason || '—'}</td></tr>
          ))}</tbody>
        </table></div>}
      </Card>}

      {tab === 'mouvements' && <Card className="!p-0 overflow-hidden">
        <div className="flex items-center justify-between p-4"><h2 className="text-sm font-bold">Journal des mouvements</h2><Badge>{state.stockMovements.length} écriture(s)</Badge></div>
        {state.stockMovements.length === 0 ? <EmptyState icon={<FiPackage />} title="Aucun mouvement" description="Les écritures apparaissent à la réception, à la consommation et à la clôture d’inventaire." /> : (
          <div className="wg-scroll-x"><table>
            <thead><tr><th className="wg-th">Date</th><th className="wg-th">Produit</th><th className="wg-th">Type</th><th className="wg-th">Quantité</th><th className="wg-th">Coût figé</th><th className="wg-th">Valeur</th><th className="wg-th">Référence</th></tr></thead>
            <tbody>{state.stockMovements.map((m) => (
              <tr key={m.id}><td className="wg-td">{formatDate(m.createdAt)}</td>
                <td className="wg-td font-semibold">{productById.get(m.productId)?.name ?? '—'}</td>
                <td className="wg-td"><Badge tone={m.qtyDelta > 0 ? 'success' : 'warn'}>{MOVEMENT_LABELS[m.kind] ?? m.kind}</Badge></td>
                <td className="wg-td font-bold">{m.qtyDelta > 0 ? '+' : ''}{m.qtyDelta}</td>
                <td className="wg-td">{formatFCFA(m.unitCostMinor)}</td>
                <td className="wg-td">{formatFCFA(Math.abs(m.qtyDelta) * m.unitCostMinor)}</td>
                <td className="wg-muted wg-td text-xs">{m.note || m.idempotencyKey || '—'}</td></tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="wg-muted p-4 text-xs">Aucun mouvement n’est modifié ni supprimé : un écart produit toujours une nouvelle écriture.</p>
      </Card>}

      {tab === 'couts' && <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold">Dépenses d’achat rattachées</h2>
            <button className="wg-btn wg-btn-primary" disabled={!activated || stockExpenses.length === 0 || state.purchaseOrders.length === 0} onClick={() => openModal('link')}>Rattacher</button></div>
          <Alert kind="info">Un achat de stock déjà valorisé à la réception est rattaché à sa commande pour éviter un double comptage dans le résultat net.</Alert>
          {stockExpenses.length === 0 ? <EmptyState icon={<FiBox />} title="Aucune dépense d’achat" description="Les catégories achats, stock et fournitures apparaîtront ici." /> : (
            <div className="mt-4 wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}><table>
              <thead><tr><th className="wg-th">Dépense</th><th className="wg-th">Montant</th><th className="wg-th">Commande</th></tr></thead>
              <tbody>{stockExpenses.map((e) => (
                <tr key={e.id}><td className="wg-td">{e.reason || e.category}</td><td className="wg-td">{formatFCFA(e.amount)}</td>
                  <td className="wg-td">{e.purchaseOrderId ? orderById.get(e.purchaseOrderId)?.number ?? 'Rattachée' : <Badge tone="warn">À rattacher</Badge>}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
        <Card>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold">Attestations de coûts</h2>
            <button className="wg-btn wg-btn-ghost" disabled={!activated} onClick={() => openModal('cert')}><FiPlus /> Certifier une période</button></div>
          <Alert kind={state.costCertifications.length ? 'success' : 'warn'}>
            {state.costCertifications.length
              ? 'Une période certifiée publie une marge brute et un résultat net calculables.'
              : 'Sans attestation, la marge brute et le résultat net restent NULL : aucun faux bénéfice.'}
          </Alert>
          {state.costCertifications.length === 0 ? <EmptyState icon={<FiAlertTriangle />} title="Aucune période certifiée" description="Certifiez les coûts après rattachement des achats, valorisation des mouvements et validation des commissions." /> : (
            <div className="mt-4 wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}><table>
              <thead><tr><th className="wg-th">Période</th><th className="wg-th">Marge brute</th><th className="wg-th">Résultat net</th><th className="wg-th">Attestation</th></tr></thead>
              <tbody>{state.costCertifications.map((c) => (
                <tr key={c.id}><td className="wg-td">{formatDate(c.start)} – {formatDate(c.end)}</td>
                  <td className="wg-td">{formatFCFA(c.grossMarginMinor)}</td>
                  <td className="wg-td font-bold">{formatFCFA(c.resultMinor)}</td>
                  <td className="wg-muted wg-td text-xs">{c.attestation}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      </div>}

      <Modal open={modal === 'product'} onClose={close} title="Nouveau produit">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Nom *" value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })} />
          <Input label="Référence" value={product.sku} onChange={(e) => setProduct({ ...product, sku: e.target.value })} />
          <Input label="Catégorie" value={product.category} onChange={(e) => setProduct({ ...product, category: e.target.value })} />
          <Input label="Unité" value={product.unit} onChange={(e) => setProduct({ ...product, unit: e.target.value })} />
          <Input label="Seuil d’alerte" type="number" min="0" value={product.reorderLevel} onChange={(e) => setProduct({ ...product, reorderLevel: readNumber(e.target.value) })} />
        </div>
        <p className="wg-muted mt-3 text-xs">Le coût moyen démarre à zéro et sera calculé à la première réception valorisée.</p>
        <div className="mt-5 flex justify-end gap-2"><button className="wg-btn wg-btn-ghost" onClick={close}><FiX /> Annuler</button>
          <button className="wg-btn wg-btn-primary" onClick={() => safe(async () => {
            await saveProduct({ stationId, ...product });
            setProduct({ name: '', sku: '', category: '', unit: 'unité', reorderLevel: 0 }); close();
          })}>Enregistrer</button></div>
      </Modal>

      <Modal open={modal === 'supplier'} onClose={close} title="Nouveau fournisseur">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Nom *" value={supplier.name} onChange={(e) => setSupplier({ ...supplier, name: e.target.value })} />
          <Input label="Téléphone" value={supplier.phone} onChange={(e) => setSupplier({ ...supplier, phone: e.target.value })} />
          <Input label="E-mail" value={supplier.email} onChange={(e) => setSupplier({ ...supplier, email: e.target.value })} />
          <Input label="Adresse" value={supplier.address} onChange={(e) => setSupplier({ ...supplier, address: e.target.value })} />
        </div>
        <div className="mt-5 flex justify-end gap-2"><button className="wg-btn wg-btn-ghost" onClick={close}><FiX /> Annuler</button>
          <button className="wg-btn wg-btn-primary" onClick={() => safe(async () => {
            await saveSupplier({ stationId, ...supplier });
            setSupplier({ name: '', phone: '', email: '', address: '' }); close();
          })}>Enregistrer</button></div>
      </Modal>

      <Modal open={modal === 'order'} onClose={close} title="Nouvelle commande" wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Numéro *" value={order.number} onChange={(e) => setOrder({ ...order, number: e.target.value })} />
          <Select label="Fournisseur" value={order.supplierId} onChange={(e) => setOrder({ ...order, supplierId: e.target.value })}>
            <option value="">Aucun</option>{state.suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select label="Produit *" value={order.productId} onChange={(e) => setOrder({ ...order, productId: e.target.value })}>
            <option value="">Choisir un produit</option>{state.products.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Input label="Quantité commandée *" type="number" min="1" value={order.qty} onChange={(e) => setOrder({ ...order, qty: readNumber(e.target.value) })} />
          <Input label="Coût unitaire prévu (FCFA)" type="number" min="0" value={order.unitCost} onChange={(e) => setOrder({ ...order, unitCost: readNumber(e.target.value) })} />
          <Input label="Livraison prévue" type="date" value={order.expectedAt} onChange={(e) => setOrder({ ...order, expectedAt: e.target.value })} />
        </div>
        <p className="wg-muted mt-3 text-xs">Clé d’idempotence : {order.idempotencyKey}. La commande n’incrémente pas le stock.</p>
        <div className="mt-5 flex justify-end gap-2"><button className="wg-btn wg-btn-ghost" onClick={close}><FiX /> Annuler</button>
          <button className="wg-btn wg-btn-primary" onClick={() => safe(async () => {
            await createPurchaseOrder({
              stationId, number: order.number, supplierId: order.supplierId || null,
              orderedAt: todayISO(), expectedAt: order.expectedAt || null,
              lines: [{ productId: order.productId, qtyOrdered: order.qty, unitCostMinor: order.unitCost }],
              idempotencyKey: order.idempotencyKey,
            });
            close();
          })}>Créer la commande</button></div>
      </Modal>

      <Modal open={modal === 'receipt'} onClose={close} title="Réceptionner une commande" wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Commande *" value={receipt.orderId} onChange={(e) => setReceipt({ ...receipt, orderId: e.target.value })}>
            <option value="">Choisir une commande</option>{state.purchaseOrders.filter((o) => o.status !== 'cancelled').map((o) => <option key={o.id} value={o.id}>{o.number}</option>)}
          </Select>
          <Select label="Produit *" value={receipt.productId} onChange={(e) => setReceipt({ ...receipt, productId: e.target.value })}>
            <option value="">Choisir un produit</option>{state.purchaseOrderItems.filter((i) => !receipt.orderId || i.orderId === receipt.orderId).map((i) => <option key={i.id} value={i.productId}>{productById.get(i.productId)?.name ?? i.productId}</option>)}
          </Select>
          <Input label="Quantité reçue *" type="number" min="1" value={receipt.qty} onChange={(e) => setReceipt({ ...receipt, qty: readNumber(e.target.value) })} />
          <Input label="Coût unitaire réel (FCFA)" type="number" min="0" value={receipt.unitCost} onChange={(e) => setReceipt({ ...receipt, unitCost: readNumber(e.target.value) })} />
          <Input label="Clé de réception" value={receipt.receiptKey} onChange={(e) => setReceipt({ ...receipt, receiptKey: e.target.value })} />
        </div>
        <p className="wg-muted mt-3 text-xs">La réception partielle met à jour le coût moyen pondéré et crée un mouvement immuable.</p>
        <div className="mt-5 flex justify-end gap-2"><button className="wg-btn wg-btn-ghost" onClick={close}><FiX /> Annuler</button>
          <button className="wg-btn wg-btn-primary" onClick={() => safe(async () => {
            await receivePurchaseLines({
              orderId: receipt.orderId, receiptKey: receipt.receiptKey,
              lines: [{ productId: receipt.productId, qty: receipt.qty, unitCostMinor: receipt.unitCost }],
            });
            close();
          })}>Valider la réception</button></div>
      </Modal>

      <Modal open={modal === 'count'} onClose={close} title="Saisir un comptage">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Produit *" value={count.productId} onChange={(e) => setCount({ ...count, productId: e.target.value })}>
            <option value="">Choisir un produit</option>{state.inventoryItems.filter((i) => i.sessionId === (openSession?.id ?? '')).map((i) => <option key={i.id} value={i.productId}>{productById.get(i.productId)?.name ?? i.productId}</option>)}
          </Select>
          <Input label="Quantité comptée *" type="number" min="0" value={count.countedQty} onChange={(e) => setCount({ ...count, countedQty: readNumber(e.target.value) })} />
        </div>
        <Textarea label="Motif de l’écart" value={count.reason} onChange={(e) => setCount({ ...count, reason: e.target.value })} />
        <div className="mt-5 flex justify-end gap-2"><button className="wg-btn wg-btn-ghost" onClick={close}><FiX /> Annuler</button>
          <button className="wg-btn wg-btn-primary" onClick={() => safe(async () => {
            await recordInventoryCount({ sessionId: openSession?.id ?? count.sessionId, productId: count.productId, countedQty: count.countedQty, reason: count.reason });
            setCount({ sessionId: openSession?.id ?? '', productId: '', countedQty: 0, reason: '' }); close();
          })}>Enregistrer</button></div>
      </Modal>

      <Modal open={modal === 'link'} onClose={close} title="Rattacher un achat à sa commande">
        <div className="grid gap-3">
          <Select label="Dépense d’achat *" value={link.expenseId} onChange={(e) => setLink({ ...link, expenseId: e.target.value })}>
            <option value="">Choisir une dépense</option>{stockExpenses.map((e) => <option key={e.id} value={e.id}>{e.reason || e.category} · {formatFCFA(e.amount)}</option>)}
          </Select>
          <Select label="Commande *" value={link.orderId} onChange={(e) => setLink({ ...link, orderId: e.target.value })}>
            <option value="">Choisir une commande</option>{state.purchaseOrders.map((o) => <option key={o.id} value={o.id}>{o.number}</option>)}
          </Select>
        </div>
        <p className="wg-muted mt-3 text-xs">Le rattachement est immuable : une dépense déjà liée à une autre commande est refusée.</p>
        <div className="mt-5 flex justify-end gap-2"><button className="wg-btn wg-btn-ghost" onClick={close}><FiX /> Annuler</button>
          <button className="wg-btn wg-btn-primary" onClick={() => safe(async () => { await linkExpenseToOrder(link.expenseId, link.orderId); close(); })}>Rattacher</button></div>
      </Modal>

      <Modal open={modal === 'cert'} onClose={close} title="Certifier les coûts d’une période">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Début *" type="date" value={cert.start} onChange={(e) => setCert({ ...cert, start: e.target.value })} />
          <Input label="Fin *" type="date" value={cert.end} onChange={(e) => setCert({ ...cert, end: e.target.value })} />
        </div>
        <Textarea label="Attestation *" value={cert.attestation} onChange={(e) => setCert({ ...cert, attestation: e.target.value })}
          placeholder="Je certifie les achats rattachés, les mouvements valorisés et les commissions validées de la période." />
        <p className="wg-muted mt-3 text-xs">La certification refuse les achats ambigus, les mouvements non valorisés et les commissions brouillon. Le relevé est immuable.</p>
        <div className="mt-5 flex justify-end gap-2"><button className="wg-btn wg-btn-ghost" onClick={close}><FiX /> Annuler</button>
          <button className="wg-btn wg-btn-primary" onClick={() => safe(async () => { await certifyCosts(cert); setCert({ ...cert, attestation: '' }); close(); })}>Certifier</button></div>
      </Modal>
    </div>
  );
}
