import React, { useEffect, useState } from 'react';
import { FiCheckCircle, FiClock, FiFileText, FiRefreshCw } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { quotaMonthStartISO, subscriptionUsageFromState } from '../lib/analytics';
import { formatDate, formatFCFA } from '../lib/format';
import { PlanDetails } from '../components/PlanDetails';
import { Alert, Badge, Card, PageHeader, Progress } from '../components/ui';

export default function Subscription() {
  const {
    state, plans, plansError, requestPlanChange, subscriptionUsage, dataSource, authKind,
    authReady, identity, refreshSubscriptionUsage, subscriptionAccess: sub,
    subscriptionStatus, subscriptionError, canWriteSubscription, refreshSubscriptionAccess,
  } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const periodStart = quotaMonthStartISO();
  const connected = dataSource === 'supabase' && authKind === 'supabase';
  useEffect(() => {
    if (connected && (!authReady || !identity)) return;
    void refreshSubscriptionUsage(periodStart).catch(() => { /* l'absence de relevé reste visible */ });
  }, [connected, authReady, identity?.userId, periodStart, refreshSubscriptionUsage]);

  const current = plans.find((plan) => plan.id === sub?.planId);
  const pendingPlan = plans.find((plan) => plan.id === sub?.pendingPlanId);
  const localUsage = connected ? null : subscriptionUsageFromState(state, periodStart);
  const usageReady = subscriptionUsage.periodStart === periodStart && (
    subscriptionUsage.limits.stations !== null || subscriptionUsage.limits.employees !== null
    || subscriptionUsage.limits.washesPerMonth !== null || subscriptionUsage.rows.length > 0
  );
  const usage = usageReady ? subscriptionUsage : null;
  const limit = usage?.limits ?? (!connected ? current?.limits : null);
  const stations = usage?.usage.stations ?? (state.station ? 1 : 0);
  const employees = usage?.usage.employees ?? state.users.filter((u) => u.active).length;
  const washesThisMonth = usage?.usage.washes ?? localUsage?.usage.washes ?? 0;
  const statusLabel = subscriptionStatus === 'loading' ? 'Vérification…' : !sub ? 'Statut indisponible'
    : !canWriteSubscription ? (sub.reason === 'trial_expired' || sub.status === 'trial' ? 'Essai expiré · lecture seule'
      : sub.reason === 'period_expired' || (sub.status === 'active' && sub.canWrite) ? 'Période expirée · lecture seule' : 'Lecture seule')
      : sub.status === 'trial' ? 'Essai en cours' : 'Formule active';

  async function request(planId: string) {
    if (busy) return;
    setBusy(planId); setError(null);
    try { await requestPlanChange(planId); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Demande non confirmée.'); }
    finally { setBusy(null); }
  }

  return <div>
    <PageHeader title="Abonnement" subtitle="Formule effective, limites, consommation et demandes de changement."
      actions={<Badge tone={!sub ? 'neutral' : canWriteSubscription ? 'success' : 'warn'}>{statusLabel}</Badge>} />
    <div className="mb-5"><Alert kind={connected ? 'info' : 'warn'}>
      {connected
        ? 'L’abonnement et les demandes sont lus sur le serveur. Une formule payante n’est active qu’après validation administrateur ; aucun paiement automatique n’est effectué.'
        : 'Démonstration locale : formule et choix sont conservés dans ce navigateur. Aucun abonnement réel, demande serveur ou paiement n’est créé.'}
    </Alert></div>
    {subscriptionStatus === 'error' && <div className="mb-5"><Alert kind="danger">Abonnement non confirmé : {subscriptionError ?? 'lecture indisponible'}. Les écritures ordinaires restent bloquées.</Alert></div>}
    {sub && !canWriteSubscription && <div className="mb-5"><Alert kind="warn">Les données sont conservées et consultables. Les écritures ordinaires sont bloquées jusqu’à validation d’une formule. Après expiration, le retrait WhatsApp peut être demandé sous réserve des droits. Une demande en attente ne prolonge pas l’essai.</Alert></div>}
    {error && <div className="mb-5"><Alert kind="danger">{error}</Alert></div>}

    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <div className="flex items-center justify-between gap-2"><p className="wg-muted text-xs font-bold uppercase tracking-wide">Formule effective</p>
          {connected && <button className="wg-btn wg-btn-ghost !px-2 !py-1 text-xs" disabled={Boolean(busy)} onClick={() => {
            setError(null); void refreshSubscriptionAccess().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Lecture impossible.'));
          }}><FiRefreshCw /> Relire</button>}</div>
        <h2 className="mt-2 text-2xl font-extrabold">{sub?.planName ?? '—'}</h2>
        <p className="mt-1 text-lg font-bold">{current ? formatFCFA(current.priceMonthly) : '—'}{current && <span className="wg-muted text-sm font-medium"> / mois</span>}</p>
        <p className="wg-muted mt-1 text-[11px]">Tarif indicatif du catalogue, pas une facture ni une preuve de paiement.</p>
        <div className="mt-4 space-y-2 text-xs">
          <div className="flex justify-between"><span className="wg-muted">Démarrée le</span><span className="font-medium">{formatDate(sub?.startedAt)}</span></div>
          {sub?.trialEndsAt && sub.status === 'trial' && <div className="flex justify-between"><span className="wg-muted">Fin de l’essai</span><span className="font-medium">{formatDate(sub.trialEndsAt)}</span></div>}
          {sub?.currentPeriodEnd && sub.status === 'active' && <div className="flex justify-between"><span className="wg-muted">Fin de période · 00:00 UTC</span><span className="font-medium">{formatDate(sub.currentPeriodEnd)}</span></div>}
          <div className="flex justify-between"><span className="wg-muted">Statut</span><Badge tone="accent">{statusLabel}</Badge></div>
        </div>
        {sub?.pendingPlanId && <div className="mt-4"><Alert kind="info">
          {connected ? 'Demande en attente de validation' : 'Choix local non transmis'} : « {pendingPlan?.name ?? sub.pendingPlanId} ». La formule effective n’a pas changé.
        </Alert></div>}
      </Card>

      <Card className="lg:col-span-2">
        <div className="mb-4 flex items-center gap-2"><FiFileText className="text-sky-400" /><h2 className="text-sm font-bold">Consommation par rapport aux limites</h2></div>
        {limit ? <div className="space-y-5">
          <LimitRow icon={<FiCheckCircle />} label="Stations" value={stations} max={limit.stations} />
          <LimitRow icon={<FiCheckCircle />} label={connected ? 'Comptes actifs et invitations réservées (propriétaire inclus)' : 'Comptes actifs (propriétaire inclus)'} value={employees} max={limit.employees} />
          <LimitRow icon={<FiClock />} label="Lavages du mois UTC" value={washesThisMonth} max={limit.washesPerMonth} />
        </div> : <Alert kind="info">Compteurs et limites indisponibles pour le moment.</Alert>}
        <p className="wg-muted mt-4 text-xs">{connected ? 'Le relevé et les limites proviennent du serveur ; une limite absente ne signifie pas illimité.' : 'Les compteurs et limites sont calculés à partir des données de démonstration.'}</p>
      </Card>
    </div>

    <h2 className="mb-3 mt-8 text-sm font-bold">Comparer les formules</h2>
    {plans.length === 0 && (plansError ? <div className="mb-4"><Alert kind="danger">Aucune formule disponible : {plansError}</Alert></div>
      : <p role="status" className="wg-muted mb-4 text-sm">Chargement des formules…</p>)}
    <div className="grid gap-4 lg:grid-cols-3">
      {plans.filter((p) => ['essai', 'standard', 'premium'].includes(p.id)).map((p) => {
        const isCurrent = p.id === sub?.planId;
        const pending = sub?.pendingPlanId === p.id;
        const paid = p.id === 'standard' || p.id === 'premium';
        const alreadyActive = isCurrent && sub?.status === 'active' && canWriteSubscription;
        return <Card key={p.id} className={isCurrent ? 'border-sky-500' : ''}>
          <div className="flex items-center justify-between"><h3 className="text-lg font-extrabold">{p.name}</h3>{isCurrent && <Badge tone="accent">Formule effective</Badge>}</div>
          <p className="mt-2 text-2xl font-extrabold">{p.id === 'essai' ? 'Gratuit' : formatFCFA(p.priceMonthly)}<span className="wg-muted text-xs font-medium"> {p.id === 'essai' ? '· 14 jours' : '/ mois'}</span></p>
          <div className="wg-muted mt-4"><PlanDetails plan={p} /></div>
          <button className={`wg-btn mt-5 w-full ${!paid || alreadyActive ? 'wg-btn-ghost' : 'wg-btn-primary'}`}
            disabled={!sub || !paid || alreadyActive || pending || Boolean(busy)} onClick={() => { void request(p.id); }}>
            {!paid ? 'Essai initial' : alreadyActive ? 'Formule active' : pending ? (connected ? 'Demande en attente' : 'Choix local noté')
              : busy === p.id ? 'Envoi…' : connected ? `${isCurrent && sub?.status === 'active' ? 'Renouveler' : 'Demander'} ${p.name}` : `Noter ${p.name} localement`}
          </button>
        </Card>;
      })}
    </div>
    <p className="wg-muted mt-4 text-xs">Tarifs indicatifs à valider commercialement. La validation active immédiatement la formule et ouvre une période mensuelle jusqu’à la date de fin à 00:00 UTC, sans renouvellement automatique. Si elle intervient avant les 14 jours, l’essai prend fin immédiatement. Une demande peut remplacer une demande précédente ; elle ne constitue ni une activation ni un paiement.</p>
  </div>;
}

function LimitRow({ icon, label, value, max }: { icon: React.ReactNode; label: string; value: number; max: number | null }) {
  return <div>
    <div className="mb-2 flex items-center justify-between text-xs"><span className="flex items-center gap-2 font-medium"><span className="text-sky-400">{icon}</span>{label}</span><span className="wg-muted">{value.toLocaleString('fr-FR')} / {max === null ? 'limite indisponible' : max.toLocaleString('fr-FR')}</span></div>
    {max !== null && <Progress value={value} max={max} tone={value >= max ? 'warn' : 'accent'} />}
  </div>;
}
