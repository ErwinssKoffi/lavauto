import React, { useState } from 'react';
import {
  FiGift, FiPackage, FiPercent, FiRefreshCw, FiSend, FiUserCheck,
} from 'react-icons/fi';
import { useStore } from '../lib/store';
import { formatDate, formatFCFA, todayISO } from '../lib/format';
import { CRM_CHANNELS } from '../lib/crm';
import {
  Alert, Badge, Card, EmptyState, Input, LockedPanel, PageHeader,
  Select, StatCard, Tabs, useSafeAction,
} from '../components/ui';

type Tab = 'fidelite' | 'forfaits' | 'promotions' | 'notifications';

const TABS: { id: Tab; label: string }[] = [
  { id: 'fidelite', label: 'Fidélité' },
  { id: 'forfaits', label: 'Forfaits' },
  { id: 'promotions', label: 'Promotions' },
  { id: 'notifications', label: 'File d’attente' },
];

const key = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

export default function Fidelisation() {
  const {
    state, dataSource, notify, refreshCrm,
    createLoyaltyProgram, enrollLoyaltyCustomer, recordLoyaltyTransaction,
    accrueLoyaltyForWash, savePackagePlan, sellPackageToCustomer,
    consumePackageForWash, savePromotion, applyPromotionToWash,
    enqueueNotification, cancelPendingNotification,
  } = useStore();
  const safe = useSafeAction();
  const [tab, setTab] = useState<Tab>('fidelite');
  const stationId = state.station?.id ?? '';
  const activated = Boolean(state.station?.activated);
  const stats = state.crmStats;

  const [program, setProgram] = useState({ name: '', rate: 1, threshold: 100 });
  const [enroll, setEnroll] = useState({ customerId: '', programId: '', cardNumber: '' });
  const [tx, setTx] = useState({ cardId: '', kind: 'earn', points: 1, reason: '', idempotencyKey: key('ltx') });
  const [accrueWashId, setAccrueWashId] = useState('');
  const [plan, setPlan] = useState({
    name: '', price: 0, washCount: 1, validityDays: 30,
    startsAt: todayISO(), endsAt: '',
  });
  const [sale, setSale] = useState({ customerId: '', packageId: '', purchasedAt: todayISO(), idempotencyKey: key('sale') });
  const [consumeWashId, setConsumeWashId] = useState('');
  const [promo, setPromo] = useState({
    name: '', code: '', kind: 'percent', value: 10,
    startsAt: todayISO(), endsAt: '', maxUsages: '', minAmount: 0,
  });
  const [apply, setApply] = useState({ washId: '', code: '', idempotencyKey: key('promo') });
  const [notif, setNotif] = useState({ targetId: '', templateKey: 'package_expiry', idempotencyKey: key('notif') });

  const cardById = new Map(state.loyaltyCards.map((c) => [c.id, c]));
  const clientById = new Map(state.clients.map((c) => [c.id, c.name]));
  const planById = new Map(state.packagePlans.map((p) => [p.id, p.name]));

  return (
    <div>
      <PageHeader title="Fidélisation & forfaits" subtitle="Cartes de fidélité, forfaits prépayés, promotions et préférences de communication."
        actions={dataSource === 'supabase' ? (
          <button className="wg-btn wg-btn-ghost" onClick={() => { void refreshCrm().catch(() => {}); }}><FiRefreshCw /> Actualiser</button>
        ) : undefined} />

      {!activated && <div className="mb-5"><LockedPanel /></div>}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Cartes actives" value={String(stats.activeCards)} hint={`${state.loyaltyCards.length} carte(s)`} icon={<FiUserCheck />} />
        <StatCard label="Forfaits actifs" value={String(stats.activePackages)} hint={`${state.customerPackages.length} forfait(s) vendu(s)`} icon={<FiPackage />} />
        <StatCard label="Promotions actives" value={String(stats.activePromotions)} hint={`${state.promotionUsages.length} application(s)`} icon={<FiPercent />} />
        <StatCard label="Notifications en attente" value={String(stats.pendingNotifications)} hint="Aucun fournisseur connecté" icon={<FiGift />} />
      </div>

      <div className="mb-5"><Alert kind="info">
        <strong>File d’attente uniquement :</strong> {state.crmRules.provider} {state.crmRules.promotion} {state.crmRules.package}
      </Alert></div>

      <div className="mb-5"><Tabs value={tab} onChange={setTab} options={TABS} /></div>

      {tab === 'fidelite' && <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-bold">Programme de fidélité</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Nom *" value={program.name} onChange={(e) => setProgram({ ...program, name: e.target.value })} />
            <Input label="Points / 1 000 FCFA" type="number" min={1} value={program.rate} onChange={(e) => setProgram({ ...program, rate: Number(e.target.value) })} />
            <Input label="Seuil de rachat" type="number" min={1} value={program.threshold} onChange={(e) => setProgram({ ...program, threshold: Number(e.target.value) })} />
          </div>
          <button className="wg-btn wg-btn-primary mt-4" disabled={!activated} onClick={() => safe(async () => {
            await createLoyaltyProgram({ stationId, name: program.name, pointsPer1000Minor: program.rate, redemptionThreshold: program.threshold });
            setProgram({ name: '', rate: 1, threshold: 100 }); notify('success', 'Programme enregistré.');
          })}>Créer le programme</button>
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-bold">Inscrire un client</h2>
          <div className="grid gap-3">
            <Select label="Client *" value={enroll.customerId} onChange={(e) => setEnroll({ ...enroll, customerId: e.target.value })}>
              <option value="">Choisir…</option>{state.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select label="Programme *" value={enroll.programId} onChange={(e) => setEnroll({ ...enroll, programId: e.target.value })}>
              <option value="">Choisir…</option>{state.loyaltyPrograms.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Input label="Numéro de carte" value={enroll.cardNumber} onChange={(e) => setEnroll({ ...enroll, cardNumber: e.target.value })} />
          </div>
          <button className="wg-btn wg-btn-primary mt-4" disabled={!activated} onClick={() => safe(async () => {
            await enrollLoyaltyCustomer({ stationId, ...enroll });
            setEnroll({ customerId: '', programId: '', cardNumber: '' }); notify('success', 'Carte créée.');
          })}>Créer la carte</button>
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-bold">Mouvement de points</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Carte *" value={tx.cardId} onChange={(e) => setTx({ ...tx, cardId: e.target.value })}>
              <option value="">Choisir…</option>{state.loyaltyCards.map((c) => <option key={c.id} value={c.id}>{c.cardNumber}</option>)}
            </Select>
            <Select label="Type" value={tx.kind} onChange={(e) => setTx({ ...tx, kind: e.target.value })}>
              <option value="earn">Gain</option><option value="redeem">Rachat</option>
            </Select>
            <Input label="Points" type="number" min={1} value={tx.points} onChange={(e) => setTx({ ...tx, points: Number(e.target.value) })} />
            <Input label="Motif" value={tx.reason} onChange={(e) => setTx({ ...tx, reason: e.target.value })} />
          </div>
          <button className="wg-btn wg-btn-primary mt-4" disabled={!activated} onClick={() => safe(async () => {
            await recordLoyaltyTransaction({ cardId: tx.cardId, kind: tx.kind as 'earn' | 'redeem', pointsDelta: tx.kind === 'redeem' ? -tx.points : tx.points, reason: tx.reason, idempotencyKey: tx.idempotencyKey });
            setTx({ cardId: '', kind: 'earn', points: 1, reason: '', idempotencyKey: key('ltx') }); notify('success', 'Points enregistrés.');
          })}>Enregistrer</button>
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-bold">Points calculés sur un lavage</h2>
          <p className="wg-muted mb-3 text-xs">Le montant avant remise sert de base ; une clé identique ne compte jamais deux fois.</p>
          <Select label="Fiche de lavage" value={accrueWashId} onChange={(e) => setAccrueWashId(e.target.value)}>
            <option value="">Choisir…</option>{state.washes.filter((w) => w.status !== 'cancelled').map((w) => <option key={w.id} value={w.id}>{w.number}</option>)}
          </Select>
          <button className="wg-btn wg-btn-primary mt-4" disabled={!activated || !accrueWashId} onClick={() => safe(async () => {
            const result = await accrueLoyaltyForWash(accrueWashId);
            notify(result.duplicate ? 'info' : 'success', result.duplicate ? 'Déjà comptabilisé : aucun double.' : `${result.points} point(s) ajouté(s).`);
          })}>Attribuer les points</button>
        </Card>
        {state.loyaltyCards.length === 0 ? <Card><EmptyState icon={<FiUserCheck />} title="Aucune carte" description="Créez un programme puis inscrivez un client." /></Card> : (
          <Card className="lg:col-span-2 !p-0 overflow-hidden">
            <div className="p-4 text-sm font-bold">Cartes & mouvements</div>
            <div className="wg-scroll-x"><table>
              <thead><tr><th className="wg-th">Carte</th><th className="wg-th">Client</th><th className="wg-th">Solde</th><th className="wg-th">Statut</th></tr></thead>
              <tbody>{state.loyaltyCards.map((c) => (
                <tr key={c.id}><td className="wg-td font-bold">{c.cardNumber}</td><td className="wg-td">{clientById.get(c.customerId) ?? '—'}</td><td className="wg-td">{c.pointsBalance}</td><td className="wg-td"><Badge tone={c.status === 'active' ? 'success' : 'neutral'}>{c.status}</Badge></td></tr>
              ))}</tbody>
            </table></div>
            <div className="wg-scroll-x border-t" style={{ borderColor: 'var(--wg-border)' }}><table>
              <thead><tr><th className="wg-th">Date</th><th className="wg-th">Carte</th><th className="wg-th">Type</th><th className="wg-th">Points</th></tr></thead>
              <tbody>{state.loyaltyTransactions.map((t) => (
                <tr key={t.id}><td className="wg-td">{formatDate(t.createdAt)}</td><td className="wg-td">{cardById.get(t.cardId)?.cardNumber ?? '—'}</td><td className="wg-td">{t.kind}</td><td className="wg-td font-bold">{t.pointsDelta}</td></tr>
              ))}</tbody>
            </table></div>
          </Card>
        )}
      </div>}

      {tab === 'forfaits' && <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-bold">Définir un forfait</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Nom *" value={plan.name} onChange={(e) => setPlan({ ...plan, name: e.target.value })} />
            <Input label="Prix (FCFA)" type="number" min={0} value={plan.price} onChange={(e) => setPlan({ ...plan, price: Number(e.target.value) })} />
            <Input label="Lavages inclus" type="number" min={1} value={plan.washCount} onChange={(e) => setPlan({ ...plan, washCount: Number(e.target.value) })} />
            <Input label="Validité (jours)" type="number" min={1} value={plan.validityDays} onChange={(e) => setPlan({ ...plan, validityDays: Number(e.target.value) })} />
            <Input label="Début" type="date" value={plan.startsAt} onChange={(e) => setPlan({ ...plan, startsAt: e.target.value })} />
            <Input label="Fin (facultative)" type="date" value={plan.endsAt} onChange={(e) => setPlan({ ...plan, endsAt: e.target.value })} />
          </div>
          <button className="wg-btn wg-btn-primary mt-4" disabled={!activated} onClick={() => safe(async () => {
            await savePackagePlan({ stationId, name: plan.name, priceMinor: plan.price, washCount: plan.washCount, validityDays: plan.validityDays, startsAt: plan.startsAt, endsAt: plan.endsAt || null });
            setPlan({ name: '', price: 0, washCount: 1, validityDays: 30, startsAt: todayISO(), endsAt: '' }); notify('success', 'Forfait enregistré.');
          })}>Créer le forfait</button>
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-bold">Vendre à un client</h2>
          <div className="grid gap-3">
            <Select label="Client *" value={sale.customerId} onChange={(e) => setSale({ ...sale, customerId: e.target.value })}>
              <option value="">Choisir…</option>{state.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select label="Forfait *" value={sale.packageId} onChange={(e) => setSale({ ...sale, packageId: e.target.value })}>
              <option value="">Choisir…</option>{state.packagePlans.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Input label="Acheté le" type="date" value={sale.purchasedAt} onChange={(e) => setSale({ ...sale, purchasedAt: e.target.value })} />
          </div>
          <button className="wg-btn wg-btn-primary mt-4" disabled={!activated} onClick={() => safe(async () => {
            await sellPackageToCustomer({ stationId, ...sale, idempotencyKey: sale.idempotencyKey });
            setSale({ customerId: '', packageId: '', purchasedAt: todayISO(), idempotencyKey: key('sale') }); notify('success', 'Forfait vendu.');
          })}>Vendre le forfait</button>
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-bold">Consommer un lavage</h2>
          <p className="wg-muted mb-3 text-xs">Un forfait actif non expiré est consommé au plus une fois par fiche.</p>
          <Select label="Fiche de lavage" value={consumeWashId} onChange={(e) => setConsumeWashId(e.target.value)}>
            <option value="">Choisir…</option>{state.washes.filter((w) => w.status !== 'cancelled').map((w) => <option key={w.id} value={w.id}>{w.number}</option>)}
          </Select>
          <button className="wg-btn wg-btn-primary mt-4" disabled={!activated || !consumeWashId} onClick={() => safe(async () => {
            const result = await consumePackageForWash(consumeWashId);
            notify(result.duplicate ? 'info' : result.consumed ? 'success' : 'info',
              result.duplicate ? 'Déjà consommé : aucun double.' : result.consumed ? `Il reste ${result.remaining} lavage(s).` : (result.reason ?? 'Aucun forfait actif.'));
          })}>Consommer</button>
        </Card>
        <Card className="!p-0 overflow-hidden">
          <div className="p-4 text-sm font-bold">Forfaits clients</div>
          {state.customerPackages.length === 0 ? <EmptyState icon={<FiPackage />} title="Aucun forfait vendu" description="Vendez un forfait dans sa fenêtre de validité." /> : (
            <div className="wg-scroll-x"><table>
              <thead><tr><th className="wg-th">Client</th><th className="wg-th">Forfait</th><th className="wg-th">Restant</th><th className="wg-th">Expire</th><th className="wg-th">Statut</th></tr></thead>
              <tbody>{state.customerPackages.map((p) => (
                <tr key={p.id}><td className="wg-td">{clientById.get(p.customerId) ?? '—'}</td><td className="wg-td">{planById.get(p.packageId) ?? '—'}</td><td className="wg-td font-bold">{p.washesRemaining}</td><td className="wg-td">{p.expiresAt}</td><td className="wg-td"><Badge tone={p.status === 'active' ? 'success' : 'neutral'}>{p.status}</Badge></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      </div>}

      {tab === 'promotions' && <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-bold">Créer une promotion</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Nom *" value={promo.name} onChange={(e) => setPromo({ ...promo, name: e.target.value })} />
            <Input label="Code *" value={promo.code} onChange={(e) => setPromo({ ...promo, code: e.target.value.toUpperCase() })} />
            <Select label="Type" value={promo.kind} onChange={(e) => setPromo({ ...promo, kind: e.target.value })}>
              <option value="percent">Pourcentage</option><option value="amount">Montant fixe</option>
            </Select>
            <Input label="Valeur" type="number" min={1} value={promo.value} onChange={(e) => setPromo({ ...promo, value: Number(e.target.value) })} />
            <Input label="Début" type="date" value={promo.startsAt} onChange={(e) => setPromo({ ...promo, startsAt: e.target.value })} />
            <Input label="Fin" type="date" value={promo.endsAt} onChange={(e) => setPromo({ ...promo, endsAt: e.target.value })} />
            <Input label="Quota (facultatif)" type="number" min={1} value={promo.maxUsages} onChange={(e) => setPromo({ ...promo, maxUsages: e.target.value })} />
            <Input label="Montant minimum" type="number" min={0} value={promo.minAmount} onChange={(e) => setPromo({ ...promo, minAmount: Number(e.target.value) })} />
          </div>
          <button className="wg-btn wg-btn-primary mt-4" disabled={!activated} onClick={() => safe(async () => {
            await savePromotion({ stationId, name: promo.name, code: promo.code, kind: promo.kind as 'percent' | 'amount', value: promo.value, startsAt: promo.startsAt, endsAt: promo.endsAt || undefined, maxUsages: promo.maxUsages ? Number(promo.maxUsages) : null, minAmountMinor: promo.minAmount });
            setPromo({ name: '', code: '', kind: 'percent', value: 10, startsAt: todayISO(), endsAt: '', maxUsages: '', minAmount: 0 }); notify('success', 'Promotion enregistrée.');
          })}>Créer la promotion</button>
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-bold">Appliquer à une fiche</h2>
          <p className="wg-muted mb-3 text-xs">Une seule promotion par fiche, jamais après encaissement. Une clé rejouée répond « déjà appliquée ».</p>
          <div className="grid gap-3">
            <Select label="Fiche *" value={apply.washId} onChange={(e) => setApply({ ...apply, washId: e.target.value })}>
              <option value="">Choisir…</option>{state.washes.filter((w) => (w.payments?.length ?? 0) === 0 && w.status !== 'cancelled').map((w) => <option key={w.id} value={w.id}>{w.number}</option>)}
            </Select>
            <Input label="Code *" value={apply.code} onChange={(e) => setApply({ ...apply, code: e.target.value.toUpperCase() })} />
          </div>
          <button className="wg-btn wg-btn-primary mt-4" disabled={!activated} onClick={() => safe(async () => {
            const result = await applyPromotionToWash(apply);
            notify(result.duplicate ? 'info' : result.applied ? 'success' : 'info',
              result.duplicate ? 'Promotion déjà appliquée : aucun double.' : `Remise ${formatFCFA(result.discountMinor)}.`);
            setApply({ washId: '', code: '', idempotencyKey: key('promo') });
          })}>Appliquer</button>
        </Card>
        <Card className="lg:col-span-2 !p-0 overflow-hidden">
          <div className="p-4 text-sm font-bold">Promotions & usages</div>
          {state.promotions.length === 0 ? <EmptyState icon={<FiPercent />} title="Aucune promotion" description="Les codes restent inactifs hors de leur fenêtre de validité." /> : (
            <div className="wg-scroll-x"><table>
              <thead><tr><th className="wg-th">Code</th><th className="wg-th">Nom</th><th className="wg-th">Valeur</th><th className="wg-th">Usages</th><th className="wg-th">Validité</th></tr></thead>
              <tbody>{state.promotions.map((p) => (
                <tr key={p.id}><td className="wg-td font-bold">{p.code}</td><td className="wg-td">{p.name}</td><td className="wg-td">{p.kind === 'percent' ? `${p.value} %` : formatFCFA(p.value)}</td><td className="wg-td">{p.usageCount}{p.maxUsages ? ` / ${p.maxUsages}` : ''}</td><td className="wg-td">{p.startsAt} → {p.endsAt}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          {state.promotionUsages.length > 0 && <div className="wg-scroll-x border-t" style={{ borderColor: 'var(--wg-border)' }}><table>
            <thead><tr><th className="wg-th">Date</th><th className="wg-th">Fiche</th><th className="wg-th">Remise</th></tr></thead>
            <tbody>{state.promotionUsages.map((u) => (
              <tr key={u.id}><td className="wg-td">{formatDate(u.createdAt)}</td><td className="wg-td">{u.washId.slice(0, 8)}</td><td className="wg-td">{formatFCFA(u.discountMinor)}</td></tr>
            ))}</tbody>
          </table></div>}
        </Card>
      </div>}

      {tab === 'notifications' && <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-bold">Mettre en attente</h2>
          <p className="wg-muted mb-3 text-xs">Le canal est lu sur la fiche client. « Aucun » refuse la mise en attente ; aucun message n'est envoyé.</p>
          <div className="grid gap-3">
            <Select label="Client *" value={notif.targetId} onChange={(e) => setNotif({ ...notif, targetId: e.target.value })}>
              <option value="">Choisir…</option>{state.clients.map((c) => <option key={c.id} value={c.id}>{c.name} ({CRM_CHANNELS.includes(c.preferredChannel ?? 'none') ? c.preferredChannel : 'none'})</option>)}
            </Select>
            <Input label="Modèle" value={notif.templateKey} onChange={(e) => setNotif({ ...notif, templateKey: e.target.value })} />
          </div>
          <button className="wg-btn wg-btn-primary mt-4" disabled={!activated} onClick={() => safe(async () => {
            await enqueueNotification({ stationId, templateKey: notif.templateKey, customerId: notif.targetId, payload: {}, idempotencyKey: notif.idempotencyKey });
            setNotif({ targetId: '', templateKey: 'package_expiry', idempotencyKey: key('notif') }); notify('success', 'Notification en attente, aucun envoi.');
          })}><FiSend /> Mettre en attente</button>
        </Card>
        <Card className="!p-0 overflow-hidden">
          <div className="p-4 text-sm font-bold">File d’attente</div>
          {state.notificationOutbox.length === 0 ? <EmptyState icon={<FiGift />} title="File vide" description="Aucune notification, aucun fournisseur, aucun envoi simulé." /> : (
            <div className="wg-scroll-x"><table>
              <thead><tr><th className="wg-th">Modèle</th><th className="wg-th">Canal</th><th className="wg-th">Statut</th><th className="wg-th">Action</th></tr></thead>
              <tbody>{state.notificationOutbox.map((n) => (
                <tr key={n.id}>
                  <td className="wg-td font-bold">{n.templateKey}</td>
                  <td className="wg-td">{n.channel}</td>
                  <td className="wg-td"><Badge tone={n.status === 'pending' ? 'warn' : 'neutral'}>{n.status}</Badge></td>
                  <td className="wg-td">{n.status === 'pending' && <button className="wg-btn wg-btn-ghost !py-1 !px-2 text-xs" onClick={() => safe(async () => {
                    await cancelPendingNotification(n.id); notify('info', 'Notification annulée.');
                  })}>Annuler</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      </div>}
    </div>
  );
}
