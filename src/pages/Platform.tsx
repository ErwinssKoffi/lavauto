import React, { useEffect, useState } from 'react';
import {
  FiBriefcase, FiFileText, FiLock, FiRefreshCw, FiShield, FiToggleLeft,
  FiToggleRight,
} from 'react-icons/fi';
import { useStore } from '../lib/store';
import { usePermissions } from '../lib/usePermissions';
import { quotaMonthStartISO } from '../lib/analytics';
import { formatDate, formatDateTime, formatFCFA } from '../lib/format';
import type { PlanLimitPayload } from '../services/adapters/DataAdapter';
import type { SubscriptionRequest } from '../lib/subscription';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  Alert, Badge, Card, EmptyState, Input, PageHeader, Progress, Select,
  StatCard, useSafeAction,
} from '../components/ui';

const STATUS_LABELS: Record<string, string> = {
  trial: 'Essai', active: 'Active', past_due: 'Impayé',
  suspended: 'Suspendue', cancelled: 'Résiliée',
  trial_expired: 'Essai expiré · lecture seule', period_expired: 'Période expirée · lecture seule',
  read_only: 'Lecture seule', unavailable: 'Indisponible',
};

function subscriptionValue(company: {
  subscriptionStatus: string | null;
  subscriptionReason: string | null;
  suspended: boolean;
}): string {
  const value = company.subscriptionStatus;
  if (value === 'suspended' || value === 'suspendue' || company.suspended) return 'suspended';
  if (company.subscriptionReason === 'trial_expired' || company.subscriptionReason === 'period_expired') return company.subscriptionReason;
  if (value === 'past_due' || value === 'cancelled') return value;
  if (company.subscriptionReason) return 'read_only';
  if (value === 'trial' || value === 'essai') return 'trial';
  if (value === 'active') return 'active';
  return 'unavailable';
}

export default function Platform() {
  const {
    platformBoard, subscriptionUsage, platformError, refreshPlatform,
    refreshUsageCounters, savePlan, setPlanLimit, setCompanySuspended,
    subscriptionRequests, subscriptionRequestsError, refreshSubscriptionRequests, decideSubscriptionRequest,
    dataSource, authKind,
  } = useStore();
  const { can } = usePermissions();
  const safe = useSafeAction();
  const [decision, setDecision] = useState<{ request: SubscriptionRequest; approve: boolean } | null>(null);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const connected = (dataSource === 'supabase' && authKind === 'supabase') || (dataSource === 'api' && authKind === 'api');
  const [selectedPlanId, setSelectedPlanId] = useState(platformBoard.plans[0]?.id ?? 'essai');
  const [planDraft, setPlanDraft] = useState({
    planId: platformBoard.plans[0]?.id ?? 'essai',
    name: platformBoard.plans[0]?.name ?? 'Essai',
    priceMinor: platformBoard.plans[0]?.priceMonthly ?? 0,
    trialDays: 14,
    active: true,
    sortOrder: 1,
  });
  const [limitDraft, setLimitDraft] = useState<PlanLimitPayload>({
    planId: platformBoard.plans[0]?.id ?? 'essai',
    key: 'washes_per_month', valueInt: 100,
  });

  useEffect(() => {
    void refreshPlatform().catch(() => { /* platformError exposé par le store */ });
    void refreshSubscriptionRequests().catch(() => { /* erreur visible ci-dessous */ });
  }, [refreshPlatform, refreshSubscriptionRequests]);

  useEffect(() => {
    const plan = platformBoard.plans.find((p) => p.id === selectedPlanId) ?? platformBoard.plans[0];
    if (!plan) return;
    setPlanDraft({
      planId: plan.id, name: plan.name, priceMinor: plan.priceMonthly,
      trialDays: plan.trial ? 14 : 0,
      active: true, sortOrder: platformBoard.plans.indexOf(plan) + 1,
    });
    setLimitDraft((current) => ({ ...current, planId: plan.id }));
  }, [platformBoard.plans, selectedPlanId]);

  if (!can('platform.view')) {
    return (
      <div>
        <PageHeader title="Espace plateforme" subtitle="Réservé au support WashGuard." />
        <Card className="flex items-start gap-3 border-red-500/30"><FiLock className="mt-0.5 text-xl text-red-400" />
          <div><h2 className="text-sm font-bold">Accès refusé</h2><p className="wg-muted mt-1 text-xs">Cet espace est réservé au support WashGuard : entreprises clientes, formules, abonnements, suspension, quotas et journaux.</p></div>
        </Card>
      </div>
    );
  }

  const companies = platformBoard.companies;
  const stats = platformBoard.stats;

  return (
    <div>
      <PageHeader
        title="Espace plateforme"
        subtitle="Entreprises, abonnements, suspension, formules administrables, quotas vérifiés côté serveur et journal hors tenant."
        actions={<Badge tone="accent"><FiShield /> Support WashGuard</Badge>}
      />

      <div className="mb-5"><Alert kind="info">
        Les tarifs 0 / 15 000 / 35 000 FCFA sont des hypothèses commerciales administrables depuis le back-office et doivent être validées sur le terrain avant facturation. {platformBoard.rules.pricing}.
      </Alert></div>
      {platformError && <div className="mb-5"><Alert kind="danger">Back-office indisponible : {platformError}</Alert></div>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Entreprises clientes" value={String(stats.companies)} hint="Réellement enregistrées" icon={<FiBriefcase />} />
        <StatCard label="Suspendues" value={String(stats.suspendedCompanies)} hint="Accès coupé, données conservées" accent="bg-red-500/10 text-red-400" />
        <StatCard label="Formules / limites" value={`${stats.plans} / ${stats.planLimits}`} hint="Lues depuis la base" accent="bg-emerald-500/10 text-emerald-400" />
        <StatCard label="Quotas dépassés" value={String(stats.quotasExceeded)} hint="Aucune insertion au-delà de la limite" accent="bg-amber-500/10 text-amber-400" />
      </div>

      <Card className="mt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Demandes de formule en attente</h2>
          {connected && <button className="wg-btn wg-btn-ghost !px-2 !py-1 text-xs" disabled={decisionBusy} onClick={() => { void safe(refreshSubscriptionRequests); }}><FiRefreshCw /> Relire les demandes</button>}
        </div>
        {!connected ? <Alert kind="info">Démonstration locale : aucune demande réelle n’est transmise et aucune validation administrateur n’est simulée.</Alert>
          : subscriptionRequestsError ? <Alert kind="danger">Demandes indisponibles : {subscriptionRequestsError}</Alert>
          : subscriptionRequests.length === 0 ? <p className="wg-muted text-xs">Aucune demande en attente.</p>
          : <div className="space-y-3">{subscriptionRequests.map((request) => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3" style={{ borderColor: 'var(--wg-border)' }}>
            <div><p className="text-sm font-bold">{request.companyName} · {request.toPlanName}</p>
              <p className="wg-muted mt-1 text-xs">Demandée le {formatDateTime(request.requestedAt)} · depuis {request.fromPlanId ?? '—'} · référence {request.id.slice(0, 8)}</p></div>
            <div className="flex gap-2"><button className="wg-btn wg-btn-ghost" disabled={decisionBusy} onClick={() => setDecision({ request, approve: false })}>Refuser</button>
              <button className="wg-btn wg-btn-primary" disabled={decisionBusy} onClick={() => setDecision({ request, approve: true })}>Valider la formule</button></div>
          </div>)}</div>}
        <p className="wg-muted mt-3 text-xs">La validation active la formule demandée ; elle n’enregistre ni paiement ni facture. Vérifiez les conditions commerciales séparément.</p>
      </Card>

      <Card className="mt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Entreprises clientes</h2>
          <button className="wg-btn wg-btn-ghost !px-2 !py-1 text-xs" onClick={() => void safe(async () => { await refreshPlatform(); })}>
            <FiRefreshCw /> Actualiser
          </button>
        </div>
        {companies.length === 0 ? (
          <EmptyState icon={<FiBriefcase />} title="Aucune entreprise enregistrée" description="Les entreprises apparaîtront après leur inscription. Aucune donnée d’exemple n’est ajoutée." />
        ) : (
          <div className="wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}>
            <table>
              <thead><tr>
                <th className="wg-th">Entreprise</th><th className="wg-th">Ville</th><th className="wg-th">Formule</th>
                <th className="wg-th">Statut</th><th className="wg-th">Stations</th><th className="wg-th">Comptes utilisés</th>
                <th className="wg-th">Lavages / mois UTC</th><th className="wg-th">CA du mois UTC</th><th className="wg-th">Quota</th><th className="wg-th">Action</th>
              </tr></thead>
              <tbody>
                {companies.map((c) => {
                  const status = subscriptionValue(c);
                  const quotaUnavailable = Object.values(c.limits).some((limit) => limit === null);
                  const statusTone = status === 'active' ? 'success' : status === 'trial' || status.endsWith('_expired') ? 'warn' : 'danger';
                  return (
                    <tr key={c.companyId}>
                      <td className="wg-td font-bold">{c.name}<div className="wg-muted text-[11px]">{formatDate(c.companyCreatedAt)}</div></td>
                      <td className="wg-td">{c.city || '—'}</td>
                      <td className="wg-td">{c.planName ?? c.planId ?? '—'}</td>
                      <td className="wg-td"><Badge tone={statusTone}>{STATUS_LABELS[status] ?? status}</Badge></td>
                      <td className="wg-td">{c.stationCount} / {c.limits.stations ?? 'indisponible'}</td>
                      <td className="wg-td">{c.employeeCount} / {c.limits.employees ?? 'indisponible'}</td>
                      <td className="wg-td">{c.washesMonth} / {c.limits.washesPerMonth ?? 'indisponible'}</td>
                      <td className="wg-td">{formatFCFA(c.monthlyRevenue)}</td>
                      <td className="wg-td">{c.quota.quotaExceeded ? <Badge tone="danger">Dépassé</Badge>
                        : quotaUnavailable ? <Badge tone="warn">Limite indisponible</Badge> : <Badge tone="success">OK</Badge>}</td>
                      <td className="wg-td">
                        <button className="wg-btn wg-btn-ghost !px-2 !py-1 text-xs"
                          onClick={() => void safe(async () => {
                            await setCompanySuspended({ companyId: c.companyId, suspended: !c.suspended });
                          })}>
                          {c.suspended ? <FiToggleRight /> : <FiToggleLeft />} {c.suspended ? 'Réactiver' : 'Suspendre'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="wg-muted mt-3 text-xs">Les comptes utilisés comprennent le propriétaire, les profils actifs et les invitations réservées non résolues. Une limite indisponible ne signifie pas « illimité ».</p>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold"><FiFileText /> Formules et limites administrables</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Formule à éditer" value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)}>
              {platformBoard.plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatFCFA(p.priceMonthly)}</option>)}
            </Select>
            <Input label="Identifiant" value={planDraft.planId} disabled hint="Formules prises en charge : essai, standard et premium." />
            <Input label="Nom" value={planDraft.name} onChange={(e) => setPlanDraft({ ...planDraft, name: e.target.value })} />
            <Input label="Tarif mensuel (FCFA)" type="number" min={0} value={planDraft.priceMinor} onChange={(e) => setPlanDraft({ ...planDraft, priceMinor: Number(e.target.value) })} />
            <Input label="Jours d’essai" type="number" value={planDraft.trialDays} disabled hint="L’essai est fixé à 14 jours à l’inscription." />
            <Input label="Ordre d’affichage" type="number" min={0} value={planDraft.sortOrder} onChange={(e) => setPlanDraft({ ...planDraft, sortOrder: Number(e.target.value) })} />
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={planDraft.active} onChange={(e) => setPlanDraft({ ...planDraft, active: e.target.checked })} /> Formule active</label>
          <button className="wg-btn wg-btn-primary mt-4" onClick={() => void safe(async () => {
            const plan = platformBoard.plans.find((p) => p.id === planDraft.planId);
            await savePlan({
              planId: planDraft.planId, name: planDraft.name,
              priceMinor: Math.max(0, Math.round(planDraft.priceMinor)),
              trialDays: Math.max(0, Math.round(planDraft.trialDays)),
              active: planDraft.active, sortOrder: Math.round(planDraft.sortOrder),
              features: plan?.features ?? [],
            });
          })}>Enregistrer la formule</button>

          <div className="mt-5 grid gap-3 border-t pt-4 sm:grid-cols-3" style={{ borderColor: 'var(--wg-border)' }}>
            <Select label="Formule du quota" value={limitDraft.planId} onChange={(e) => setLimitDraft({ ...limitDraft, planId: e.target.value })}>
              {platformBoard.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select label="Clé" value={limitDraft.key} onChange={(e) => setLimitDraft({ ...limitDraft, key: e.target.value as PlanLimitPayload['key'] })}>
              <option value="stations">stations</option><option value="employees">employees</option><option value="washes_per_month">washes_per_month</option>
            </Select>
            <Input label="Limite" type="number" min={0} value={limitDraft.valueInt} onChange={(e) => setLimitDraft({ ...limitDraft, valueInt: Number(e.target.value) })} />
          </div>
          <button className="wg-btn wg-btn-ghost mt-3" onClick={() => void safe(async () => {
            await setPlanLimit({ ...limitDraft, valueInt: Math.max(0, Math.round(limitDraft.valueInt)) });
          })}>Enregistrer le quota</button>
          <p className="wg-muted mt-3 text-xs">{platformBoard.rules.quotas}. {platformBoard.rules.suspension}. Les droits techniques des modules sont définis par la configuration serveur, distincte de ces libellés.</p>
        </Card>

        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold">Usage et quotas du mois</h2>
            <button className="wg-btn wg-btn-ghost !px-2 !py-1 text-xs" onClick={() => void safe(async () => {
              await refreshUsageCounters(quotaMonthStartISO());
            })}><FiRefreshCw /> Recalculer les compteurs</button>
          </div>
          <div className="space-y-4">
            <LimitRow label="Stations" value={subscriptionUsage.usage.stations} max={subscriptionUsage.limits.stations} />
            <LimitRow label="Comptes et invitations réservées" value={subscriptionUsage.usage.employees} max={subscriptionUsage.limits.employees} />
            <LimitRow label="Lavages du mois UTC" value={subscriptionUsage.usage.washes} max={subscriptionUsage.limits.washesPerMonth} />
          </div>
          <p className="wg-muted mt-3 text-xs">{subscriptionUsage.rules.quota}. {stats.usageRows} ligne(s) d’usage dérivées des données réelles. Stations et comptes reflètent le moment du recalcul, pas un historique.</p>
          <div className="mt-4 max-h-44 overflow-y-auto rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}>
            {platformBoard.subscriptionUsage.length === 0 ? <p className="wg-muted p-3 text-xs">Aucun compteur enregistré.</p> : (
              <table><thead><tr><th className="wg-th">Station</th><th className="wg-th">Clé</th><th className="wg-th">Valeur</th><th className="wg-th">Période</th></tr></thead>
                <tbody>{platformBoard.subscriptionUsage.slice(0, 30).map((row, i) => (
                  <tr key={`${row.stationId}-${row.metricKey}-${i}`}><td className="wg-td">{row.stationId.slice(0, 8)}</td><td className="wg-td">{row.metricKey}</td><td className="wg-td">{row.valueInt}</td><td className="wg-td">{formatDate(row.periodStart)}</td></tr>
                ))}</tbody></table>
            )}
          </div>
        </Card>
      </div>

      <ConfirmDialog open={Boolean(decision)} title={decision?.approve ? 'Valider cette formule ?' : 'Refuser cette demande ?'}
        description={decision ? `${decision.request.companyName} demande ${decision.request.toPlanName}. ${decision.approve ? 'La formule sera activée immédiatement et mettra fin à un éventuel essai en cours. Aucun paiement n’est enregistré.' : 'La formule précédente sera conservée.'}` : ''}
        confirmLabel={decision?.approve ? 'Confirmer la validation' : 'Confirmer le refus'} tone={decision?.approve ? 'primary' : 'danger'}
        onClose={() => setDecision(null)} onConfirm={() => {
          if (!decision || decisionBusy) return;
          const { request, approve } = decision; setDecision(null); setDecisionBusy(true);
          void safe(() => decideSubscriptionRequest(request.id, approve)).finally(() => setDecisionBusy(false));
        }} />
      <Card className="mt-5">
        <h2 className="mb-3 text-sm font-bold">Journal de la plateforme</h2>
        {platformBoard.auditLogs.length === 0 ? <p className="wg-muted text-xs">Aucune opération enregistrée.</p> : (
          <div className="max-h-80 space-y-1.5 overflow-y-auto">
            {platformBoard.auditLogs.map((log) => (
              <div key={log.id} className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--wg-surface-2)' }}>
                <div className="flex flex-wrap justify-between gap-2"><span className="font-bold">{log.action}</span><span className="wg-muted">{formatDateTime(log.createdAt)}</span></div>
                <p className="wg-muted mt-0.5">{log.actorUserId ?? 'Système'} · {log.entityType} {log.entityId} · {JSON.stringify(log.detail)}</p>
              </div>
            ))}
          </div>
        )}
        <p className="wg-muted mt-3 text-xs">{platformBoard.rules.audit}. Aucune opération n’est supprimée du journal.</p>
      </Card>
    </div>
  );
}

function LimitRow({ label, value, max }: { label: string; value: number; max: number | null }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs"><span className="font-medium">{label}</span><span className="wg-muted">{value.toLocaleString('fr-FR')} / {max === null ? 'limite indisponible' : max.toLocaleString('fr-FR')}</span></div>
      {max !== null && <Progress value={value} max={max} tone={value >= max ? 'warn' : 'accent'} />}
    </div>
  );
}
