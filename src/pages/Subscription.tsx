import React, { useEffect } from 'react';
import { FiCheck, FiCheckCircle, FiClock, FiFileText } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { monthStartISO } from '../lib/analytics';
import { formatDate, formatFCFA } from '../lib/format';
import { buildReport } from '../lib/metrics';
import { Alert, Badge, Card, PageHeader, Progress } from '../components/ui';

export default function Subscription() {
  const {
    state, plans, plansError, requestPlanChange, subscriptionUsage,
    dataSource, authReady, identity, refreshSubscriptionUsage,
  } = useStore();
  const periodStart = monthStartISO();
  useEffect(() => {
    if (dataSource === 'supabase' && (!authReady || !identity)) return;
    void refreshSubscriptionUsage(periodStart).catch(() => { /* erreur notifiée par le store */ });
  }, [dataSource, authReady, identity?.userId, periodStart, refreshSubscriptionUsage]);
  const connected = dataSource === 'supabase';
  // L'abonnement lui-même est encore conservé localement : ne pas réutiliser
  // celui d'une autre entreprise après un changement de session.
  const sub = state.subscription?.companyId === state.company?.id ? state.subscription : null;
  // Le cache global démarre avec des formules de démonstration. Utiliser
  // uniquement les plans exposés par le store, vides tant que la lecture
  // connectée n'a pas réussi, y compris pour la formule et la demande courantes.
  const current = plans.find((plan) => plan.id === sub?.planId);
  const pendingPlan = plans.find((plan) => plan.id === sub?.pendingPlanId);
  const plansUnavailable = plans.length === 0;
  const month = buildReport(state, 'mois');
  const usageReady = subscriptionUsage.periodStart === periodStart && (
    subscriptionUsage.limits.stations !== null
    || subscriptionUsage.limits.employees !== null
    || subscriptionUsage.limits.washesPerMonth !== null
    || subscriptionUsage.rows.length > 0
  );
  const usage = usageReady ? subscriptionUsage : null;
  // En connecté, seul le relevé d'usage serveur fait autorité : ni le cache
  // local, ni des valeurs par défaut ne remplacent une limite absente.
  const limit = usage?.limits ?? (!connected ? current?.limits : null);
  const stations = usage?.usage.stations ?? (state.station ? 1 : 0);
  const employees = usage?.usage.employees ?? state.users.filter((u) => u.active).length;
  const washesThisMonth = usage?.usage.washes ?? month.washes.length;

  return (
    <div>
      <PageHeader title="Abonnement" subtitle="Formule en cours, consommation par rapport aux limites, comparaison des formules et demande de changement."
        actions={<Badge tone={connected || !sub ? 'neutral' : sub.status === 'essai' ? 'warn' : 'success'}>{connected ? 'Statut non confirmé' : !sub ? 'Statut indisponible' : sub.status === 'essai' ? 'Essai en cours' : sub.status === 'suspendue' ? 'Suspendu' : 'Formule active'}</Badge>} />

      {connected && <div className="mb-5"><Alert kind="info">La formule en cours et les demandes affichées proviennent de ce navigateur et ne sont pas confirmées ni transmises au serveur. Les compteurs et limites ci-dessous proviennent du relevé serveur lorsqu’il est disponible.</Alert></div>}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <p className="wg-muted text-xs font-bold uppercase tracking-wide">Formule en cours</p>
          <h2 className="mt-2 text-2xl font-extrabold">{current?.name ?? '—'}</h2>
          <p className="mt-1 text-lg font-bold">{current ? formatFCFA(current.priceMonthly) : '—'}{current && <span className="wg-muted text-sm font-medium"> / mois</span>}</p>
          <div className="mt-4 space-y-2 text-xs">
            <div className="flex justify-between"><span className="wg-muted">Démarrée le</span><span className="font-medium">{formatDate(sub?.startedAt)}</span></div>
            {sub?.trialEndsAt && <div className="flex justify-between"><span className="wg-muted">Fin de l’essai</span><span className="font-medium">{formatDate(sub.trialEndsAt)}</span></div>}
            <div className="flex justify-between"><span className="wg-muted">Statut</span><Badge tone="accent">{sub?.status ?? '—'}</Badge></div>
          </div>
          {sub?.pendingPlanId && <div className="mt-4"><Alert kind="info">Demande locale de passage à « {pendingPlan?.name ?? 'formule indisponible'} », non transmise au serveur.</Alert></div>}
          <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--wg-border)' }}>
            <p className="wg-muted text-[11px] leading-relaxed">{connected ? 'Les tarifs affichés proviennent des formules lues dans la base.' : 'Les tarifs affichés sont ceux de la démonstration locale.'}</p>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center gap-2"><FiFileText className="text-sky-400" /><h2 className="text-sm font-bold">Consommation par rapport aux limites</h2></div>
          {limit ? (
            <div className="space-y-5">
              <LimitRow icon={<FiCheckCircle />} label="Stations" value={stations} max={limit.stations} />
              <LimitRow icon={<FiCheckCircle />} label="Comptes employés actifs" value={employees} max={limit.employees} />
              <LimitRow icon={<FiClock />} label="Lavages ce mois-ci" value={washesThisMonth} max={limit.washesPerMonth} />
            </div>
          ) : (
            <Alert kind="info">Compteurs et limites indisponibles pour le moment.</Alert>
          )}
          <p className="wg-muted mt-4 text-xs">{connected ? 'Le relevé de consommation et les limites sont relus côté serveur, jamais envoyés par le navigateur.' : 'Les compteurs et limites sont calculés à partir des données locales.'}</p>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-bold">Comparaison des formules</h2>
      {plansUnavailable && (plansError
        ? <div className="mb-4"><Alert kind="danger">Aucune formule disponible : {plansError}</Alert></div>
        : <p role="status" className="wg-muted mb-4 text-sm">Chargement des formules…</p>)}
      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = p.id === sub?.planId;
          const pending = sub?.pendingPlanId === p.id;
          return (
            <Card key={p.id} className={isCurrent ? 'border-sky-500' : ''}>
              <div className="flex items-center justify-between"><h3 className="text-lg font-extrabold">{p.name}</h3>{isCurrent && <Badge tone="accent">Formule actuelle</Badge>}</div>
              <p className="mt-2 text-2xl font-extrabold">{formatFCFA(p.priceMonthly)}<span className="wg-muted text-xs font-medium"> / mois</span></p>
              <ul className="mt-4 space-y-2 text-xs">
                {p.features.map((f) => <li key={f} className="flex items-start gap-2"><FiCheck className="mt-0.5 shrink-0 text-sky-400" /> {f}</li>)}
              </ul>
              <button className={`wg-btn mt-5 w-full ${isCurrent ? 'wg-btn-ghost' : 'wg-btn-primary'}`} disabled={!sub || isCurrent || pending}
                onClick={() => requestPlanChange(p.id)}>
                {isCurrent ? 'Formule en cours' : pending ? 'Demande locale en attente' : 'Noter ce changement localement'}
              </button>
            </Card>
          );
        })}
      </div>
      <p className="wg-muted mt-4 text-xs">Une demande de changement est une note conservée dans ce navigateur : elle n’est pas envoyée au serveur et ne modifie pas la facturation.</p>
    </div>
  );
}

function LimitRow({ icon, label, value, max }: { icon: React.ReactNode; label: string; value: number; max: number | null }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs"><span className="flex items-center gap-2 font-medium"><span className="text-sky-400">{icon}</span>{label}</span><span className="wg-muted">{value.toLocaleString('fr-FR')} / {max === null ? '∞ (aucune limite définie)' : max.toLocaleString('fr-FR')}</span></div>
      {max !== null && <Progress value={value} max={max} tone={value >= max ? 'warn' : 'accent'} />}
    </div>
  );
}
