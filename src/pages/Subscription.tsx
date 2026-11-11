import React from 'react';
import { FiCheck, FiCheckCircle, FiClock, FiFileText } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { planById } from '../lib/plans';
import { formatDate, formatFCFA } from '../lib/format';
import { buildReport } from '../lib/metrics';
import { Alert, Badge, Card, PageHeader, Progress } from '../components/ui';

export default function Subscription() {
  const { state, plans, requestPlanChange } = useStore();
  const sub = state.subscription;
  const current = planById(sub?.planId);
  const month = buildReport(state, 'mois');
  const stations = state.station ? 1 : 0;
  const employees = state.users.filter((u) => u.active).length;
  const washesThisMonth = month.washes.length;
  const limit = current?.limits ?? { stations: 1, employees: 3, washesPerMonth: 100 };

  return (
    <div>
      <PageHeader title="Abonnement" subtitle="Formule en cours, consommation par rapport aux limites, comparaison des formules et demande de changement."
        actions={<Badge tone={sub?.status === 'essai' ? 'warn' : 'success'}>{sub?.status === 'essai' ? 'Essai en cours' : sub?.status === 'suspendue' ? 'Suspendu' : 'Formule active'}</Badge>} />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <p className="wg-muted text-xs font-bold uppercase tracking-wide">Formule en cours</p>
          <h2 className="mt-2 text-2xl font-extrabold">{current?.name ?? '—'}</h2>
          <p className="mt-1 text-lg font-bold">{formatFCFA(current?.priceMonthly ?? 0)}<span className="wg-muted text-sm font-medium"> / mois</span></p>
          <div className="mt-4 space-y-2 text-xs">
            <div className="flex justify-between"><span className="wg-muted">Démarrée le</span><span className="font-medium">{formatDate(sub?.startedAt)}</span></div>
            {sub?.trialEndsAt && <div className="flex justify-between"><span className="wg-muted">Fin de l’essai</span><span className="font-medium">{formatDate(sub.trialEndsAt)}</span></div>}
            <div className="flex justify-between"><span className="wg-muted">Statut</span><Badge tone="accent">{sub?.status ?? '—'}</Badge></div>
          </div>
          {sub?.pendingPlanId && <div className="mt-4"><Alert kind="info">Demande de passage à « {planById(sub.pendingPlanId)?.name} » enregistrée, en attente de traitement.</Alert></div>}
          <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--wg-border)' }}>
            <p className="wg-muted text-[11px] leading-relaxed">Ces tarifs sont lus depuis la table des formules : la vitrine et la facturation partagent la même source.</p>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center gap-2"><FiFileText className="text-sky-400" /><h2 className="text-sm font-bold">Consommation par rapport aux limites</h2></div>
          <div className="space-y-5">
            <LimitRow icon={<FiCheckCircle />} label="Stations" value={stations} max={limit.stations} />
            <LimitRow icon={<FiCheckCircle />} label="Comptes employés actifs" value={employees} max={limit.employees} />
            <LimitRow icon={<FiClock />} label="Lavages ce mois-ci" value={washesThisMonth} max={limit.washesPerMonth} />
          </div>
          <p className="wg-muted mt-4 text-xs">Les compteurs sont calculés à partir des données réellement enregistrées.</p>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-bold">Comparaison des formules</h2>
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
              <button className={`wg-btn mt-5 w-full ${isCurrent ? 'wg-btn-ghost' : 'wg-btn-primary'}`} disabled={isCurrent || pending}
                onClick={() => requestPlanChange(p.id)}>
                {isCurrent ? 'Formule en cours' : pending ? 'Demande en attente' : 'Demander ce changement'}
              </button>
            </Card>
          );
        })}
      </div>
      <p className="wg-muted mt-4 text-xs">Une demande de changement est journalisée ; elle ne modifie pas immédiatement la facturation.</p>
    </div>
  );
}

function LimitRow({ icon, label, value, max }: { icon: React.ReactNode; label: string; value: number; max: number }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs"><span className="flex items-center gap-2 font-medium"><span className="text-sky-400">{icon}</span>{label}</span><span className="wg-muted">{value.toLocaleString('fr-FR')} / {max.toLocaleString('fr-FR')}</span></div>
      <Progress value={value} max={max} tone={value >= max ? 'warn' : 'accent'} />
    </div>
  );
}
