import React, { useState } from 'react';
import { FiDownload, FiFileText } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { buildReport, periodRange, type Period } from '../lib/metrics';
import { downloadCSV, formatDate, formatFCFA } from '../lib/format';
import { PAY_METHOD_LABELS } from '../types';
import { Badge, Card, EmptyState, PageHeader, StatCard, Tabs } from '../components/ui';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'jour', label: 'Jour' }, { id: 'semaine', label: 'Semaine' }, { id: 'mois', label: 'Mois' },
];

export default function Reports() {
  const { state } = useStore();
  const [period, setPeriod] = useState<Period>('jour');
  const r = buildReport(state, period);
  const { label } = periodRange(period);

  const exportCSV = () => {
    const headers = ['Indicateur', 'Détail', 'Valeur'];
    const rows: (string | number)[][] = [
      ['Période', label, `${formatDate(periodRange(period).start.toISOString())} – ${formatDate(periodRange(period).end.toISOString())}`],
      ['Lavages', 'Fiches non annulées', r.washes.length],
      ['Chiffre d’affaires', 'Total des fiches', r.revenue],
      ['Encaissements', 'Paiements de la période', r.collected],
      ['Dépenses', 'Dépenses enregistrées', r.expenses],
      ['Résultat simplifié', 'Encaissements − dépenses', r.result],
      [],
      ['Prestation', 'Quantité', 'Chiffre d’affaires'],
      ...r.topServices.map((s) => [s.name, s.count, s.revenue]),
      [],
      ['Employé', 'Lavages', 'Chiffre d’affaires'],
      ...r.byEmployee.map((e) => [e.name, e.count, e.revenue]),
      [],
      ['Moyen de paiement', 'Nombre', 'Montant'],
      ...r.byMethod.map((m) => [PAY_METHOD_LABELS[m.method], m.count, m.amount]),
      [],
      ['Client', 'Lavages', 'Chiffre d’affaires'],
      ...r.bestClients.map((c) => [c.name, c.count, c.revenue]),
    ];
    downloadCSV(`washguard-rapport-${period}-${formatDate(new Date().toISOString()).replace(/\//g, '-')}.csv`, headers, rows);
  };

  return (
    <div>
      <PageHeader title="Rapports" subtitle={`Jour / semaine / mois : chiffres calculés à partir des données enregistrées (${label}).`}
        actions={<button className="wg-btn wg-btn-primary" onClick={exportCSV}><FiDownload /> Exporter en CSV</button>} />
      <div className="mb-5"><Tabs value={period} onChange={setPeriod} options={PERIODS} /></div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Lavages" value={String(r.washes.length)} hint="Fiches non annulées" icon={<FiFileText />} />
        <StatCard label="Chiffre d’affaires" value={formatFCFA(r.revenue)} hint="Total des fiches" />
        <StatCard label="Encaissements" value={formatFCFA(r.collected)} hint={`${r.byMethod.reduce((n, m) => n + m.count, 0)} paiement(s)`} />
        <StatCard label="Dépenses" value={formatFCFA(r.expenses)} hint="Dépenses enregistrées" />
        <StatCard label="Résultat simplifié" value={formatFCFA(r.result)} hint="Encaissements − dépenses" accent="bg-emerald-500/10 text-emerald-400" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-bold">Prestations les plus vendues</h2>
          {r.topServices.length === 0 ? <EmptyLine /> : <SimpleTable head={['Prestation', 'Qté', 'CA']} rows={r.topServices.map((s) => [s.name, String(s.count), formatFCFA(s.revenue)])} />}
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-bold">Activité par employé</h2>
          {r.byEmployee.length === 0 ? <EmptyLine /> : <SimpleTable head={['Employé', 'Lavages', 'CA']} rows={r.byEmployee.map((e) => [e.name, String(e.count), formatFCFA(e.revenue)])} />}
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-bold">Répartition par moyen de paiement</h2>
          {r.byMethod.length === 0 ? <EmptyLine /> : <SimpleTable head={['Moyen', 'Paiements', 'Montant']} rows={r.byMethod.map((m) => [PAY_METHOD_LABELS[m.method], String(m.count), formatFCFA(m.amount)])} />}
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-bold">Meilleurs clients</h2>
          {r.bestClients.length === 0 ? <EmptyLine /> : <SimpleTable head={['Client', 'Lavages', 'CA']} rows={r.bestClients.map((c) => [c.name, String(c.count), formatFCFA(c.revenue)])} />}
        </Card>
      </div>

      <Card className="mt-5">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold">Historique de caisse</h2><Badge>{r.cashSessions.length} session(s)</Badge></div>
        {r.cashSessions.length === 0 ? <EmptyLine /> : (
          <SimpleTable head={['Ouverture', 'Fond', 'Compté', 'État']} rows={r.cashSessions.map((c) => [
            formatDate(c.openedAt), formatFCFA(c.openingFloat), c.countedAmount === null ? '—' : formatFCFA(c.countedAmount), c.status,
          ])} />
        )}
      </Card>

      <p className="wg-muted mt-4 text-xs">L’export CSV reprend exactement ces indicateurs. Aucune donnée d’exemple n’est incluse.</p>
    </div>
  );
}

function EmptyLine() {
  return <p className="wg-muted py-6 text-center text-xs">Aucune donnée sur la période.</p>;
}

function SimpleTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}>
      <table>
        <thead><tr>{head.map((h) => <th key={h} className="wg-th">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`wg-td ${j > 0 ? 'whitespace-nowrap' : ''}`}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
