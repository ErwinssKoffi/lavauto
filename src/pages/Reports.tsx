import React, { useEffect, useState } from 'react';
import { FiAlertTriangle, FiDownload, FiFileText, FiRefreshCw } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { usePermissions } from '../lib/usePermissions';
import { redactStockProfitability } from '../lib/finance';
import { buildReport, periodRange, type Period } from '../lib/metrics';
import { downloadCSV, formatDate, formatFCFA, todayISO } from '../lib/format';
import { PAY_METHOD_LABELS, type ProfitabilityReport } from '../types';
import {
  Alert, Badge, Card, EmptyState, Input, Modal, PageHeader, StatCard, Tabs,
  Textarea, useSafeAction,
} from '../components/ui';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'jour', label: 'Jour' }, { id: 'semaine', label: 'Semaine' }, { id: 'mois', label: 'Mois' },
];

const dateISO = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const amount = (n: number | null): string => n === null ? 'Non calculable' : formatFCFA(n);

const monthStartISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

export default function Reports() {
  const { state, dataSource, authReady, identity, subscriptionAccess, canWriteSubscription,
    refreshFinance, certifyCosts, stationMetrics, stationMetricsError, refreshStationMetrics } = useStore();
  const { can } = usePermissions();
  const hasStock = Boolean(identity?.isPlatformAdmin || subscriptionAccess?.features.stock);
  const canCertify = hasStock && canWriteSubscription && can('settings.manage');
  const safe = useSafeAction();
  const [period, setPeriod] = useState<Period>('jour');
  const [certOpen, setCertOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cert, setCert] = useState({ start: monthStartISO(), end: todayISO(), attestation: '' });
  const r = buildReport(state, period);
  const { label, start, end } = periodRange(period);
  const from = dateISO(start);
  const to = dateISO(end);
  const server = state.profitability;
  const connected = dataSource !== 'local';
  // Aucune substitution par une file limitée ou par une ancienne période.
  const rawProfitability: ProfitabilityReport | null = connected
    ? (server && server.periodStart === from && server.periodEnd === to ? server : null)
    : r.profitability;
  // En local aussi, un passage en Standard ne doit pas afficher les coûts
  // Premium conservés sur l'appareil. L'autorisation réelle reste côté serveur.
  const p = rawProfitability && (hasStock ? rawProfitability : redactStockProfitability(rawProfitability));
  const current = connected && stationMetrics && state.station && stationMetrics.stationId === state.station.id
    && stationMetrics.periodStart === from && stationMetrics.periodEnd === to ? stationMetrics : null;
  const detail = connected ? current : r;
  const washCount = connected ? current?.trend.reduce((sum, day) => sum + day.washCount, 0) : r.washes.length;
  const fromRpc = connected && p !== null;

  useEffect(() => {
    if (!connected || !authReady || !identity || !state.station?.id) return;
    let active = true;
    setLoadError(null);
    void Promise.all([refreshFinance(from, to), refreshStationMetrics(from, to)]).catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : 'Lecture du rapport impossible.');
    });
    return () => { active = false; };
  }, [connected, authReady, identity?.userId, state.station?.id, from, to, refreshFinance, refreshStationMetrics]);

  const reload = () => {
    setLoadError(null);
    void Promise.all([refreshFinance(from, to), refreshStationMetrics(from, to)]).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : 'Lecture du rapport impossible.');
    });
  };

  if (!p || !detail || washCount === undefined) {
    const unavailable = !state.station?.id ? 'Aucune station accessible.'
      : identity && !identity.permissions.includes('washes.view') ? 'La permission de consulter les lavages est requise pour les détails.'
      : loadError || stationMetricsError;
    return <div>
      <PageHeader title="Rapports" subtitle={`Station : ${state.station?.name ?? '—'} · ${label}.`}
        actions={<button className="btn btn-sm" onClick={reload}><FiRefreshCw /> Actualiser</button>} />
      <div className="mb-5"><Tabs value={period} onChange={setPeriod} options={PERIODS} /></div>
      <Alert kind={unavailable ? 'danger' : 'info'}>{unavailable ? `Rapport indisponible : ${unavailable}` : 'Chargement du rapport exhaustif…'}</Alert>
    </div>;
  }
  const labelPartial = p.definitions.partialBalance ?? 'Solde partiel : encaissé − dépenses ; PAS un bénéfice net';
  const stockCostsUnavailable = p.purchases === null || p.consumptions === null || p.operatingExpenses == null;

  const indicatorRows: [string, string, string | number][] = [
    ['Chiffre d’affaires', 'Total des fiches non annulées', p.revenue],
    ['Encaissements nets', 'Paiements moins remboursements', p.collected],
    ['Créances', 'Total moins encaissé', p.receivables],
    ['Dépenses constatées', 'Dépenses enregistrées', p.expenses],
    ['Achats valorisés', 'Jamais une charge de période', p.purchases ?? 'Non disponible'],
    ['Consommations valorisées', 'Sorties de stock au coût moyen', p.consumptions ?? 'Non disponible'],
    ['Charges d’exploitation', 'Hors achats de stock rattachés', p.operatingExpenses ?? 'Non disponible'],
    ['Commissions validées', 'Relevés figés uniquement', p.commissions],
    ['Charges fixes', 'Catégories identifiées', p.fixedCosts ?? 'Non disponible'],
    ['Solde partiel', labelPartial, p.partialBalance],
    ['Marge brute', p.certified ? p.definitions.grossMargin ?? 'Marge brute certifiée' : 'Coûts manquants', p.grossMargin ?? '—'],
    ['Résultat net', p.certified ? p.definitions.result ?? 'Résultat net certifié' : 'Coûts manquants', p.result ?? '—'],
  ];

  const exportCSV = () => {
    const headers = ['Indicateur', 'Détail', 'Valeur'];
    const rows: (string | number)[][] = [
      ['Période', label, `${formatDate(from)} – ${formatDate(to)}`],
      ['Source', fromRpc ? 'my_station_profitability() et my_station_metrics()' : 'état local affiché', washCount],
      ['Etat des coûts', p.costsMissing ? 'COUTS MANQUANTS' : 'complets', p.label],
      ...indicatorRows.map(([name, detail, value]) => [name, detail, value]),
      [],
      ['Prestation', 'Quantité', 'Chiffre d’affaires'],
      ...detail.topServices.map((s) => [s.name, s.count, s.revenue]),
      [],
      ['Employé', 'Lavages', 'Chiffre d’affaires'],
      ...detail.byEmployee.map((e) => [e.name, e.count, e.revenue]),
      [],
      ['Moyen de paiement', 'Nombre', 'Montant'],
      ...detail.byMethod.map((m) => [PAY_METHOD_LABELS[m.method], m.count, m.amount]),
      [],
      ['Client', 'Lavages', 'Chiffre d’affaires'],
      ...detail.bestClients.map((c) => [c.name, c.count, c.revenue]),
    ];
    downloadCSV(`washguard-rapport-${period}-${formatDate(to).replace(/\//g, '-')}.csv`, headers, rows);
  };

  return (
    <div>
      <PageHeader title="Rapports" subtitle={`Station ${state.station?.name ?? '—'} · jour / semaine / mois : CA, encaissé, créances, coûts et solde partiel (${label}).`}
        actions={<div className="flex gap-2">
          {dataSource !== 'local' && <button className="btn btn-sm" onClick={reload}><FiRefreshCw /> Actualiser</button>}
          <button className="btn btn-sm" disabled={!canCertify} title={!hasStock ? 'Module stock non inclus' : !canWriteSubscription ? 'Abonnement en lecture seule' : undefined} onClick={() => setCertOpen(true)}><FiFileText /> {connected ? 'Certification entreprise' : 'Certifier les coûts'}</button>
          <button className="btn btn-sm btn-primary" onClick={exportCSV}><FiDownload /> Exporter en CSV</button>
        </div>} />
      <div className="mb-5"><Tabs value={period} onChange={setPeriod} options={PERIODS} /></div>

      <div className="mb-5">{stockCostsUnavailable ? <Alert kind="info"><FiAlertTriangle className="mr-1 inline" />
        <strong>{p.label}.</strong> Les coûts de stock et le résultat certifié sont indisponibles, pas égaux à zéro. Les dépenses et le solde partiel restent consultables ; ce solde n’est <strong>PAS un bénéfice net</strong>.
      </Alert> : p.costsMissing ? <Alert kind="warn"><FiAlertTriangle className="mr-1 inline" />
        <strong>Coûts manquants : {p.label}.</strong> Le solde partiel n’est <strong>PAS un bénéfice net</strong>. La marge brute et le résultat restent NULL tant que les consommations valorisées, les achats rattachés et l’attestation de période ne sont pas complets.
      </Alert> : <Alert kind="success"><FiFileText className="mr-1 inline" />
        <strong>{p.label}.</strong> Coûts attestés le {p.certifiedAt ? formatDate(p.certifiedAt) : '—'} : marge brute {amount(p.grossMargin)} et résultat net {amount(p.result)}. Le solde partiel n’est <strong>PAS un bénéfice net</strong>.
      </Alert>}</div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Lavages" value={String(washCount)} hint="Fiches non annulées" icon={<FiFileText />} />
        <StatCard label="Chiffre d’affaires" value={formatFCFA(p.revenue)} hint="Total des fiches" />
        <StatCard label="Encaissements" value={formatFCFA(p.collected)} hint={`${detail.byMethod.reduce((n, m) => n + m.count, 0)} paiement(s)`} />
        <StatCard label="Créances" value={formatFCFA(p.receivables)} hint="Reste dû par fiche" />
        <StatCard label="Solde partiel" value={formatFCFA(p.partialBalance)} hint="Encaissé − dépenses, PAS un bénéfice" accent="bg-warning/10 text-warning" />
      </div>

      <Card className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold">Décomposition financière</h2>
          <Badge tone={p.costsMissing ? 'warn' : 'success'}>{fromRpc ? 'RPC station' : 'Calcul local'} · {stockCostsUnavailable ? 'coûts indisponibles' : p.certified ? 'coûts certifiés' : 'coûts manquants'}</Badge>
        </div>
        <div className="overflow-x-auto rounded-xl border">
          <table className="table min-w-[620px]">
            <thead><tr><th>Indicateur</th><th>Définition</th><th>Valeur</th></tr></thead>
            <tbody>
              {indicatorRows.map(([name, detail, value]) => (
                <tr key={name}>
                  <td className="font-semibold">{name}</td>
                  <td className="text-xs text-base-content/60">{detail}</td>
                  <td className="whitespace-nowrap font-bold">{typeof value === 'number' ? formatFCFA(value) : value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-base-content/60 mt-3 text-xs">Marge brute : {amount(p.grossMargin)} · Résultat net : {amount(p.result)} · {p.missing.length} poste(s) manquant(s) : {p.missing.join(', ') || 'aucun'}. {p.attestation ? `Attestation : ${p.attestation}.` : ''}</p>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-bold">Prestations les plus vendues</h2>
          {detail.topServices.length === 0 ? <EmptyLine /> : <SimpleTable head={['Prestation', 'Qté', 'CA']} rows={detail.topServices.map((s) => [s.name, String(s.count), formatFCFA(s.revenue)])} />}
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-bold">Activité par employé</h2>
          {detail.byEmployee.length === 0 ? <EmptyLine /> : <SimpleTable head={['Employé', 'Lavages', 'CA']} rows={detail.byEmployee.map((e) => [e.name, String(e.count), formatFCFA(e.revenue)])} />}
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-bold">Répartition par moyen de paiement</h2>
          {detail.byMethod.length === 0 ? <EmptyLine /> : <SimpleTable head={['Moyen', 'Paiements', 'Montant']} rows={detail.byMethod.map((m) => [PAY_METHOD_LABELS[m.method], String(m.count), formatFCFA(m.amount)])} />}
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-bold">Meilleurs clients</h2>
          {detail.bestClients.length === 0 ? <EmptyLine /> : <SimpleTable head={['Client', 'Lavages', 'CA']} rows={detail.bestClients.map((c) => [c.name, String(c.count), formatFCFA(c.revenue)])} />}
        </Card>
      </div>

      <Card className="mt-5">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold">Relevés de clôture immuables</h2><Badge>{state.cashClosures.length} relevé(s)</Badge></div>
        {state.cashClosures.length === 0 ? <EmptyLine /> : (
          <SimpleTable head={['Date', 'Théorique', 'Compté', 'Écart']} rows={state.cashClosures.map((c) => [
            formatDate(c.createdAt), formatFCFA(c.theoretical), formatFCFA(c.counted),
            `${c.difference > 0 ? '+' : ''}${formatFCFA(c.difference)}`,
          ])} />
        )}
      </Card>

      <Modal open={certOpen} onClose={() => setCertOpen(false)} title={connected ? "Certifier les coûts de l’entreprise" : "Certifier les coûts de la période"}>
        {connected && <div className="mb-3"><Alert kind="warn">La certification exige l’accès à toutes les stations de l’entreprise et fige leur liste. Elle certifie la consolidation ; le résultat d’une station n’est certifié que si elle est l’unique station couverte. Les attestations anciennes sans périmètre restent non attribuables.</Alert></div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Début *" type="date" value={cert.start} onChange={(e) => setCert({ ...cert, start: e.target.value })} />
          <Input label="Fin *" type="date" value={cert.end} onChange={(e) => setCert({ ...cert, end: e.target.value })} />
        </div>
        <Textarea label="Attestation *" value={cert.attestation} onChange={(e) => setCert({ ...cert, attestation: e.target.value })}
          placeholder="Je certifie les achats rattachés, les mouvements valorisés et les commissions validées de la période." />
        <p className="text-base-content/60 mt-3 text-xs">La publication du résultat net est refusée si des coûts sont ambigus, non valorisés ou non validés. Le relevé certifié est immuable.</p>
        <div className="mt-5 flex justify-end gap-2"><button className="btn btn-sm" onClick={() => setCertOpen(false)}>Annuler</button>
          <button className="btn btn-sm btn-primary" disabled={!canCertify} onClick={() => safe(async () => {
            await certifyCosts(cert);
            await refreshFinance(from, to);
            setCert({ ...cert, attestation: '' });
            setCertOpen(false);
          })}>Certifier</button></div>
      </Modal>

      <p className="text-base-content/60 mt-4 text-xs">L’export CSV reprend exactement ces indicateurs. Aucune donnée d’exemple n’est incluse ; les valeurs NULL ne sont jamais remplacées par un faux zéro.</p>
    </div>
  );
}

function EmptyLine() {
  return <p className="text-base-content/60 py-6 text-center text-xs">Aucune donnée sur la période.</p>;
}

function SimpleTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="table min-w-[620px]">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j > 0 ? 'whitespace-nowrap' : undefined}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
