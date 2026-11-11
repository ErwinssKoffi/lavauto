import React from 'react';
import { FiBriefcase, FiLock, FiShield, FiToggleLeft, FiToggleRight } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { formatDate, formatDateTime, formatFCFA } from '../lib/format';
import { Badge, Card, EmptyState, PageHeader, StatCard } from '../components/ui';

export default function Platform() {
  const { state, plans, toggleCompanySuspension } = useStore();
  if (state.session?.role !== 'support') {
    return (
      <div>
        <PageHeader title="Espace plateforme" subtitle="Réservé au support WashGuard." />
        <Card className="flex items-start gap-3 border-red-500/30"><FiLock className="mt-0.5 text-xl text-red-400" />
          <div><h2 className="text-sm font-bold">Accès refusé</h2><p className="wg-muted mt-1 text-xs">Cet espace est réservé au support WashGuard : entreprises clientes, formules, abonnements, suspension et journal de la plateforme.</p></div>
        </Card>
      </div>
    );
  }

  const companies = state.platformCompanies;
  const suspended = companies.filter((c) => c.status === 'suspendue').length;

  return (
    <div>
      <PageHeader title="Espace plateforme" subtitle="Entreprises clientes, formules, abonnements, suspension d’une entreprise et journal de la plateforme."
        actions={<Badge tone="accent"><FiShield /> Support WashGuard</Badge>} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Entreprises clientes" value={String(companies.length)} hint="Réellement enregistrées" icon={<FiBriefcase />} />
        <StatCard label="En essai" value={String(companies.filter((c) => c.status === 'essai').length)} hint="Abonnement d’essai" />
        <StatCard label="Suspendues" value={String(suspended)} hint="Accès coupé" accent="bg-red-500/10 text-red-400" />
        <StatCard label="Formules" value={String(plans.length)} hint="Lues depuis la base" accent="bg-emerald-500/10 text-emerald-400" />
      </div>

      <Card className="mt-5">
        <h2 className="mb-3 text-sm font-bold">Entreprises clientes</h2>
        {companies.length === 0 ? (
          <EmptyState icon={<FiBriefcase />} title="Aucune entreprise enregistrée" description="Les entreprises apparaîtront ici après leur inscription. Aucune donnée d’exemple n’est ajoutée." />
        ) : (
          <div className="wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}>
            <table>
              <thead><tr><th className="wg-th">Entreprise</th><th className="wg-th">Ville</th><th className="wg-th">Téléphone</th><th className="wg-th">Formule</th><th className="wg-th">Stations</th><th className="wg-th">CA du mois</th><th className="wg-th">Inscrite le</th><th className="wg-th">Statut</th><th className="wg-th">Action</th></tr></thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id}>
                    <td className="wg-td font-bold">{c.name}</td>
                    <td className="wg-td">{c.city || '—'}</td>
                    <td className="wg-td">{c.phone || '—'}</td>
                    <td className="wg-td"><Badge tone="accent">{c.planName}</Badge></td>
                    <td className="wg-td">{c.stations}</td>
                    <td className="wg-td">{formatFCFA(c.monthlyRevenue)}</td>
                    <td className="wg-td">{formatDate(c.createdAt)}</td>
                    <td className="wg-td"><Badge tone={c.status === 'suspendue' ? 'danger' : c.status === 'essai' ? 'warn' : 'success'}>{c.status === 'suspendue' ? 'Suspendue' : c.status === 'essai' ? 'Essai' : 'Active'}</Badge></td>
                    <td className="wg-td">
                      <button className="wg-btn wg-btn-ghost !px-2 !py-1 text-xs" onClick={() => toggleCompanySuspension(c.id)}>
                        {c.status === 'suspendue' ? <FiToggleRight /> : <FiToggleLeft />} {c.status === 'suspendue' ? 'Réactiver' : 'Suspendre'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-bold">Formules et tarifs (base)</h2>
          <div className="space-y-2">
            {plans.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl border px-3 py-2.5 text-xs" style={{ borderColor: 'var(--wg-border)' }}>
                <div><p className="font-bold">{p.name}</p><p className="wg-muted">{p.limits.stations} station(s) · {p.limits.employees} comptes · {p.limits.washesPerMonth.toLocaleString('fr-FR')} lavages/mois</p></div>
                <span className="font-bold">{formatFCFA(p.priceMonthly)}</span>
              </div>
            ))}
          </div>
          <p className="wg-muted mt-3 text-xs">Source unique partagée avec la vitrine et la facturation.</p>
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-bold">Journal de la plateforme</h2>
          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {state.auditLogs.length === 0 ? <p className="wg-muted text-xs">Aucune opération enregistrée.</p> : state.auditLogs.map((l) => (
              <div key={l.id} className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--wg-surface-2)' }}>
                <div className="flex flex-wrap justify-between gap-2"><span className="font-bold">{l.action}</span><span className="wg-muted">{formatDateTime(l.at)}</span></div>
                <p className="wg-muted mt-0.5">{l.actor} · {l.detail}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
