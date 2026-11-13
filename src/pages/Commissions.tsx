import React, { useEffect, useState } from 'react';
import { FiDownload, FiLock, FiPieChart, FiRefreshCw } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { usePermissions } from '../lib/usePermissions';
import { buildCommissions, periodRange, type CommissionLine, type Period } from '../lib/metrics';
import { downloadCSV, formatDate, formatFCFA } from '../lib/format';
import type { CommissionStatementLine } from '../types';
import {
  Alert, Badge, Card, Input, PageHeader, StatCard, Tabs, useSafeAction,
} from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'jour', label: 'Jour' }, { id: 'semaine', label: 'Semaine' }, { id: 'mois', label: 'Mois' },
];

const dateISO = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function Commissions() {
  const {
    state, dataSource, authReady, identity, canWriteSubscription, createCommissionPeriod,
    validateCommissionPeriod, recordCommissionPayout, refreshFinance,
  } = useStore();
  const { can } = usePermissions();
  const safe = useSafeAction();
  const [period, setPeriod] = useState<Period>('mois');
  const [pStart, setPStart] = useState(() => dateISO(periodRange('mois').start));
  const [pEnd, setPEnd] = useState(() => dateISO(periodRange('mois').end));
  const allowed = can('commissions.view');
  const canValidate = dataSource === 'local' || can('commissions.validate');
  const lines = buildCommissions(state, period);
  const { label } = periodRange(period);
  const periodLines = state.commissionLines ?? [];
  const periods = state.commissionPeriods ?? [];
  const payouts = state.commissionPayouts ?? [];
  const frozenTotal = periodLines.reduce((sum, l) => sum + l.amount, 0);
  const totalDue = lines.reduce((s, l) => s + l.amount, 0);
  const totalBase = lines.reduce((s, l) => s + l.base, 0);

  useEffect(() => {
    const range = periodRange(period);
    setPStart(dateISO(range.start));
    setPEnd(dateISO(range.end));
  }, [period]);

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Commissions" subtitle="Réservé au propriétaire et au gérant." />
        <Card className="flex flex-row items-start gap-3 border-red-500/30">
          <FiLock className="mt-0.5 text-xl text-red-400" />
          <div><h2 className="text-sm font-bold">Accès refusé</h2><p className="text-base-content/60 mt-1 text-xs">Ce module affiche ce que la station doit à chaque laveur. Il est réservé au propriétaire et au gérant.</p></div>
        </Card>
      </div>
    );
  }

  const commissionColumns: Column<CommissionLine>[] = [
    { key: 'name', header: 'Laveur', sortValue: (line) => line.name, render: (line) => <span className="font-bold">{line.name}</span> },
    { key: 'washes', header: 'Lavages terminés', sortValue: (line) => line.washes, render: (line) => line.washes },
    { key: 'base', header: 'Base', sortValue: (line) => line.base, render: (line) => formatFCFA(line.base) },
    { key: 'rate', header: 'Barème', sortValue: (line) => line.rate, render: (line) => `${line.rate} %` },
    { key: 'origin', header: 'Origine', render: (line) => <Badge tone={line.override ? 'accent' : 'neutral'}>{line.override ? 'Exception sur le compte' : 'Barème station'}</Badge> },
    { key: 'amount', header: 'Aperçu', sortValue: (line) => line.amount, render: (line) => <span className="font-bold">{formatFCFA(line.amount)}</span> },
  ];

  const frozenColumns: Column<CommissionStatementLine>[] = [
    { key: 'name', header: 'Laveur', sortValue: (l) => l.userName, render: (l) => <span className="font-bold">{l.userName}</span> },
    { key: 'washes', header: 'Lavages', sortValue: (l) => l.washes, render: (l) => l.washes },
    { key: 'base', header: 'Base figée', sortValue: (l) => l.base, render: (l) => formatFCFA(l.base) },
    { key: 'rate', header: 'Taux', sortValue: (l) => l.rate, render: (l) => `${l.rate} %` },
    { key: 'origin', header: 'Origine', render: (l) => <Badge>{l.rateOrigin === 'contract' ? 'Contrat' : 'Station'}</Badge> },
    { key: 'amount', header: 'Montant dû', sortValue: (l) => l.amount, render: (l) => <span className="font-bold">{formatFCFA(l.amount)}</span> },
    { key: 'payout', header: 'Paie', render: (l) => {
      const paid = payouts.some((p) => p.periodId === l.periodId && p.userId === l.userId);
      const periodRow = periods.find((p) => p.id === l.periodId);
      if (paid) return <Badge tone="success">Payée</Badge>;
      if (periodRow && periodRow.status === 'draft') return <Badge>Brouillon</Badge>;
      if (!canValidate || !canWriteSubscription) return <Badge>À payer · lecture seule</Badge>;
      return (
        <button className="link link-primary text-xs" onClick={() => safe(async () => {
          await recordCommissionPayout(l.periodId, l.userId, l.amount,
            `PAIE-${l.periodId.slice(0, 8)}-${l.userId.slice(0, 4)}`);
        })}>Enregistrer la paie</button>
      );
    } },
  ];

  const exportCSV = () => {
    // La paie exporte les relevés FIGÉS. Sans relevé validé, l'export est
    // explicitement marqué BROUILLON : jamais un montant recalculé présenté
    // comme une dette validée.
    if (periodLines.length > 0) {
      downloadCSV(
        `washguard-commissions-figees-${period}.csv`,
        ['Laveur', 'Lavages', 'Base figée (FCFA)', 'Taux (%)', 'Origine', 'Montant dû (FCFA)', 'Statut paie'],
        periodLines.map((l) => [
          l.userName, l.washes, l.base, l.rate, l.rateOrigin, l.amount,
          payouts.some((p) => p.periodId === l.periodId && p.userId === l.userId) ? 'Payée' : 'À payer',
        ])
      );
      return;
    }
    downloadCSV(
      `washguard-commissions-BROUILLON-${period}.csv`,
      ['AVERTISSEMENT', 'Laveur', 'Lavages', 'Base (FCFA)', 'Barème (%)', 'Origine', 'Aperçu (FCFA)'],
      [['BROUILLON NON VALIDE', '', '', '', '', '', ''], ...lines.map((l) => [
        'BROUILLON', l.name, l.washes, l.base, l.rate,
        l.override ? 'Exception sur le compte' : 'Barème de la station', l.amount,
      ])]
    );
  };

  return (
    <div>
      <PageHeader title="Commissions" subtitle={`Aperçu brouillon, relevés validés figés et paie tracée (${label}).`}
        actions={<div className="flex gap-2">
          {dataSource !== 'local' && authReady && identity &&
            <button className="btn btn-sm" onClick={() => safe(() => refreshFinance())}><FiRefreshCw /> Actualiser</button>}
          <button className="btn btn-sm btn-primary" onClick={exportCSV}><FiDownload /> Export CSV pour la paie</button>
        </div>} />
      <div className="mb-5"><Tabs value={period} onChange={setPeriod} options={PERIODS} /></div>

      <div className="mb-5"><Alert kind="info">L’aperçu recalcule les lavages <strong>terminés</strong> à titre indicatif. La paie utilise uniquement les <strong>relevés validés et figés</strong> : une période validée n’est jamais recalculée ni remise en brouillon.</Alert></div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={periodLines.length ? 'Montant total figé' : 'Aperçu brouillon (non dû)'} value={formatFCFA(periodLines.length ? frozenTotal : totalDue)} hint={`${periodLines.length || lines.length} ligne(s) · ${periodLines.length ? 'relevés validés' : 'aucun relevé validé'}`} icon={<FiPieChart />} />
        <StatCard label="Base des lavages terminés" value={formatFCFA(totalBase)} hint={`${lines.reduce((s, l) => s + l.washes, 0)} lavage(s) terminé(s)`} />
        <StatCard label="Barème de la station" value={`${state.station?.commissionRate ?? 0} %`} hint="Modifiable dans Paramètres" accent="bg-emerald-500/10 text-emerald-400" />
      </div>

      <Card className="mt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold">Périodes de commission</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={pStart} onChange={(e) => setPStart(e.target.value)} />
            <Input type="date" value={pEnd} onChange={(e) => setPEnd(e.target.value)} />
            <button className="btn btn-sm btn-primary" disabled={!canWriteSubscription || !canValidate || !state.station?.activated}
              onClick={() => safe(async () => {
                await createCommissionPeriod(state.station!.id, pStart, pEnd);
              })}>Créer un brouillon</button>
          </div>
        </div>
        {periods.length === 0 ? <p className="text-base-content/60 text-xs">Aucune période. Créez un brouillon, puis validez-le pour figer les lignes.</p> : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="table min-w-[620px]"><thead><tr><th>Période</th><th>Statut</th><th>Lignes</th><th /></tr></thead>
              <tbody>{periods.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.start)} – {formatDate(p.end)}</td>
                  <td><Badge tone={p.status === 'draft' ? 'warn' : p.status === 'paid' ? 'success' : 'accent'}>{p.status === 'draft' ? 'Brouillon' : p.status === 'paid' ? 'Payée' : 'Validée · figée'}</Badge></td>
                  <td>{periodLines.filter((l) => l.periodId === p.id).length}</td>
                  <td>{p.status === 'draft' && canValidate &&
                    <button className="link link-primary text-xs" disabled={!canWriteSubscription} onClick={() => safe(async () => {
                      await validateCommissionPeriod(p.id);
                    })}><FiLock className="inline" /> Valider et figer</button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-5">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold">Relevés figés — source de la paie</h2><Badge>{periodLines.length} ligne(s)</Badge></div>
        <DataTable<CommissionStatementLine>
          rows={periodLines}
          rowKey={(line) => line.id}
          columns={frozenColumns}
          searchText={(line) => `${line.userName} ${line.rateOrigin}`}
          searchPlaceholder="Rechercher un laveur…"
          emptyTitle="Aucun relevé validé"
          emptyDescription="Créez une période puis validez-la : les montants seront figés et ne pourront plus être recalculés."
          footer={periodLines.length > 0 ? (
            <tr><td className="font-bold" colSpan={5}>Total figé de tous les relevés</td><td className="font-bold text-emerald-400">{formatFCFA(frozenTotal)}</td><td /></tr>
          ) : undefined}
        />
      </Card>

      <Card className="mt-5">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold">Aperçu brouillon par laveur</h2><Badge tone="warn">Non validé · recalculable</Badge></div>
        <DataTable<CommissionLine>
          rows={lines}
          rowKey={(line) => line.userId}
          columns={commissionColumns}
          searchText={(line) => `${line.name} ${line.override ? 'exception sur le compte' : 'barème station'}`}
          searchPlaceholder="Rechercher un laveur…"
          emptyTitle="Aucune commission sur la période"
          emptyDescription="Marquez des fiches comme « terminé » et fixez un barème pour voir apparaître les montants dus."
          footer={lines.length > 0 ? (
            <tr><td className="font-bold" colSpan={5}>Total indicatif (tous laveurs)</td><td className="font-bold">{formatFCFA(totalDue)}</td></tr>
          ) : undefined}
        />
      </Card>
      <p className="text-base-content/60 mt-4 text-xs">L’export CSV privilégie les relevés figés ; sans relevé, il est nommé BROUILLON. Le total porte sur tous les laveurs de la période, même lorsqu’un filtre de recherche est appliqué.</p>
    </div>
  );
}
