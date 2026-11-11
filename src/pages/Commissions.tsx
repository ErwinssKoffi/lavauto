import React, { useState } from 'react';
import { FiDownload, FiLock, FiPieChart } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { buildCommissions, periodRange, type Period } from '../lib/metrics';
import { downloadCSV, formatDate, formatFCFA } from '../lib/format';
import { Alert, Badge, Breadcrumbs, Card, EmptyState, PageHeader, StatCard, Tabs } from '../components/ui';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'jour', label: 'Jour' }, { id: 'semaine', label: 'Semaine' }, { id: 'mois', label: 'Mois' },
];

export default function Commissions() {
  const { state } = useStore();
  const [period, setPeriod] = useState<Period>('mois');
  const role = state.session?.role;
  const allowed = role === 'proprietaire' || role === 'gerant';
  const lines = buildCommissions(state, period);
  const { label } = periodRange(period);
  const totalDue = lines.reduce((s, l) => s + l.amount, 0);
  const totalBase = lines.reduce((s, l) => s + l.base, 0);

  if (!allowed) {
    return (
      <div>
        <Breadcrumbs items={[{ label: 'Ressources humaines', to: '/app/commissions' }, { label: 'Commissions laveurs' }]} />
        <PageHeader title="Commissions" subtitle="Réservé au propriétaire et au gérant." />
        <Card className="flex items-start gap-3 border-red-500/30">
          <FiLock className="mt-0.5 text-xl text-red-400" />
          <div><h2 className="text-sm font-bold">Accès refusé</h2><p className="wg-muted mt-1 text-xs">Ce module affiche ce que la station doit à chaque laveur. Il est réservé au propriétaire et au gérant.</p></div>
        </Card>
      </div>
    );
  }

  const exportCSV = () => {
    downloadCSV(
      `washguard-commissions-${period}-${formatDate(new Date().toISOString()).replace(/\//g, '-')}.csv`,
      ['Laveur', 'Lavages terminés', 'Base (FCFA)', 'Barème (%)', 'Origine du barème', 'Montant dû (FCFA)'],
      lines.map((l) => [l.name, l.washes, l.base, l.rate, l.override ? 'Exception sur le compte' : 'Barème de la station', l.amount])
    );
  };

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Ressources humaines', to: '/app/commissions' }, { label: 'Commissions laveurs' }]} />
      <PageHeader title="Commissions" subtitle={`Ce que la station doit à chaque laveur sur les lavages terminés (${label}).`}
        actions={<button className="wg-btn wg-btn-primary" onClick={exportCSV}><FiDownload /> Export CSV pour la paie</button>} />
      <div className="mb-5"><Tabs value={period} onChange={setPeriod} options={PERIODS} /></div>

      <div className="mb-5"><Alert kind="info">Seuls les lavages <strong>terminés</strong> de la période sont retenus. Le barème appliqué est celui de la station, sauf exception posée sur un compte dans Employés.</Alert></div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Montant total dû" value={formatFCFA(totalDue)} hint="Somme des commissions" icon={<FiPieChart />} />
        <StatCard label="Base des lavages terminés" value={formatFCFA(totalBase)} hint={`${lines.reduce((s, l) => s + l.washes, 0)} lavage(s) terminé(s)`} />
        <StatCard label="Barème de la station" value={`${state.station?.commissionRate ?? 0} %`} hint="Modifiable dans Paramètres" accent="bg-emerald-500/10 text-emerald-400" />
      </div>

      <Card className="mt-5">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold">Détail par laveur</h2><Badge>{lines.length} laveur(s)</Badge></div>
        {lines.length === 0 ? (
          <EmptyState icon={<FiPieChart />} title="Aucune commission sur la période" description="Marquez des fiches comme « terminé » et fixez un barème pour voir apparaître les montants dus." />
        ) : (
          <div className="wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}>
            <table>
              <thead><tr><th className="wg-th">Laveur</th><th className="wg-th">Lavages terminés</th><th className="wg-th">Base</th><th className="wg-th">Barème</th><th className="wg-th">Origine</th><th className="wg-th">Montant dû</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.userId}>
                    <td className="wg-td font-bold">{l.name}</td>
                    <td className="wg-td">{l.washes}</td>
                    <td className="wg-td">{formatFCFA(l.base)}</td>
                    <td className="wg-td">{l.rate} %</td>
                    <td className="wg-td"><Badge tone={l.override ? 'accent' : 'neutral'}>{l.override ? 'Exception sur le compte' : 'Barème station'}</Badge></td>
                    <td className="wg-td font-bold">{formatFCFA(l.amount)}</td>
                  </tr>
                ))}
                <tr><td className="wg-td font-bold" colSpan={5}>Total à payer</td><td className="wg-td font-bold text-emerald-400">{formatFCFA(totalDue)}</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="wg-muted mt-4 text-xs">L’export CSV reprend ces colonnes pour la paie. Objectif de chiffre d’affaires du mois suivi sur le tableau de bord.</p>
    </div>
  );
}
