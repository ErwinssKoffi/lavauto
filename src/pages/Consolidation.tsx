import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis,
} from 'recharts';
import { FiBarChart2, FiRefreshCw, FiTrendingUp } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { emptyAnalyticsBoard, monthStartISO, previousPeriod } from '../lib/analytics';
import { formatDate, formatFCFA, todayISO } from '../lib/format';
import {
  Alert, Badge, Card, EmptyState, Input, PageHeader, StatCard,
} from '../components/ui';
import { CHART_COLORS } from '../lib/chartTheme';

const CHART_WIDTH = 720;
const CHART_HEIGHT = 260;
const AXIS = CHART_COLORS.axis;
const GRID = CHART_COLORS.grid;
const TOOLTIP_STYLE = {
  background: 'var(--color-base-100)', border: '1px solid var(--color-base-300)', color: 'var(--color-base-content)',
  borderRadius: '10px', fontSize: '12px',
};

function shortDate(value: string): string {
  const parts = value.split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : value;
}

export default function Consolidation() {
  const {
    dataSource, authReady, identity, analyticsBoard, analyticsError, refreshAnalytics,
  } = useStore();
  const initialCompare = previousPeriod(monthStartISO(), todayISO());
  const [start, setStart] = useState(monthStartISO());
  const [end, setEnd] = useState(todayISO());
  const [compareStart, setCompareStart] = useState(initialCompare.start);
  const [compareEnd, setCompareEnd] = useState(initialCompare.end);

  const compareEnabled = Boolean(compareStart && compareEnd);
  const cs = compareEnabled ? compareStart : null;
  const ce = compareEnabled ? compareEnd : null;

  useEffect(() => {
    if (dataSource !== 'local' && (!authReady || !identity)) return;
    void refreshAnalytics(start, end, cs, ce).catch(() => {
      /* l'erreur est exposée par analyticsError dans le store */
    });
  }, [dataSource, authReady, identity?.userId, start, end, cs, ce, refreshAnalytics]);

  const matches = analyticsBoard.periodStart === start
    && analyticsBoard.periodEnd === end
    && analyticsBoard.compareStart === cs
    && analyticsBoard.compareEnd === ce;
  const board = useMemo(() => matches ? analyticsBoard : emptyAnalyticsBoard(start, end, cs, ce),
    [analyticsBoard, matches, start, end, cs, ce]);

  const trend = board.trend;
  const rankings = board.rankings;
  const compare = board.compare;
  const delta = board.compareDelta;
  const definitions = board.definitions;

  return (
    <div>
      <PageHeader
        title="Consolidation multi-stations"
        subtitle="Graphiques Recharts, comparaison de périodes avec les mêmes définitions métier et classement par chiffre d’affaires."
        actions={<Badge tone="accent"><FiBarChart2 /> Consolidation</Badge>}
      />

      <div className="mb-5"><Alert kind="info">
        Les tarifs 0 / 15 000 / 35 000 FCFA restent des hypothèses commerciales administrables. {board.rules.pricing}. Les indicateurs des deux périodes proviennent de la même définition
        serveur ; <strong>le solde partiel n’est pas un bénéfice net</strong> et aucun résultat net
        n’est publié par station sans attestation de coûts certifiée.
      </Alert></div>

      {analyticsError && <div className="mb-5"><Alert kind="danger">Analytics indisponibles : {analyticsError}</Alert></div>}

      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="Début de période" type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
          <Input label="Fin de période" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          <Input label="Comparer depuis" type="date" value={compareStart} max={compareEnd || undefined} onChange={(e) => setCompareStart(e.target.value)} />
          <Input label="Comparer jusqu’au" type="date" value={compareEnd} min={compareStart || undefined} onChange={(e) => setCompareEnd(e.target.value)} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-sm btn-primary" onClick={() => { void refreshAnalytics(start, end, cs, ce).catch(() => {}); }}>
            <FiRefreshCw /> Actualiser les indicateurs
          </button>
          <button className="btn btn-sm" onClick={() => {
            const previous = previousPeriod(start, end);
            setCompareStart(previous.start);
            setCompareEnd(previous.end);
          }}>Période précédente de même durée</button>
          {compareEnabled && <Badge tone="accent">Comparaison : {formatDate(compareStart)} → {formatDate(compareEnd)}</Badge>}
        </div>
      </Card>

      {!matches ? <Alert kind={analyticsError ? 'danger' : 'info'}>
        {analyticsError ? 'La période demandée est indisponible.' : 'Chargement des indicateurs pour la période demandée…'}
      </Alert> : <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Chiffre d’affaires" value={formatFCFA(board.stats.revenue)} hint={definitions.revenue} icon={<FiTrendingUp />} />
        <StatCard label="Encaissements nets" value={formatFCFA(board.stats.collected)} hint={definitions.collected} />
        <StatCard label="Solde partiel" value={formatFCFA(board.stats.partialBalance)} hint={definitions.partialBalance} accent="bg-warning/10 text-warning" />
        <StatCard label="Écart vs période comparée" value={delta === null ? '—' : formatFCFA(delta)} hint="Même définition du chiffre d’affaires" accent="bg-primary/10 text-primary" />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <h2 className="mb-3 text-sm font-bold">Tendance quotidienne</h2>
          {trend.length === 0 ? (
            <EmptyState icon={<FiBarChart2 />} title="Aucune donnée sur la période" description="Les points apparaîtront dès que des lavages réels seront enregistrés. Aucune donnée d’exemple n’est fabriquée." />
          ) : (
            <div className="overflow-x-auto">
              <LineChart width={CHART_WIDTH} height={CHART_HEIGHT} data={trend} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="date" stroke={AXIS} tickFormatter={shortDate} fontSize={11} />
                <YAxis stroke={AXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} fontSize={11} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(v) => formatDate(String(v))} />
                <Legend />
                <Line type="monotone" dataKey="revenue" name="Chiffre d’affaires" stroke={CHART_COLORS.revenue} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="collected" name="Encaissé" stroke={CHART_COLORS.collected} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="expenses" name="Dépenses" stroke={CHART_COLORS.expenses} dot={false} isAnimationActive={false} />
              </LineChart>
            </div>
          )}
          <p className="text-base-content/60 mt-2 text-xs">{board.rules.comparison} · {board.rules.netResult}.</p>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-bold">Classement des stations</h2>
          {rankings.length === 0 ? (
            <EmptyState icon={<FiTrendingUp />} title="Aucune station à classer" description="Le classement utilise uniquement les stations réellement accessibles." />
          ) : (
            <div className="overflow-x-auto">
              <BarChart width={380} height={CHART_HEIGHT} data={rankings} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="name" stroke={AXIS} fontSize={10} interval={0} />
                <YAxis stroke={AXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} fontSize={11} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="revenue" name="Chiffre d’affaires" fill={CHART_COLORS.revenue} radius={[6, 6, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </div>
          )}
          <p className="text-base-content/60 mt-2 text-xs">{board.rules.stations}.</p>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-bold">Comparaison des périodes</h2>
          {compare ? (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-base-content/60">CA période courante</span><span className="font-bold">{formatFCFA(board.period.revenue)}</span></div>
              <div className="flex justify-between"><span className="text-base-content/60">CA période comparée</span><span className="font-bold">{formatFCFA(compare.revenue)}</span></div>
              <div className="flex justify-between"><span className="text-base-content/60">Écart</span><Badge tone={(delta ?? 0) >= 0 ? 'success' : 'danger'}>{formatFCFA(delta ?? 0)}</Badge></div>
              <div className="flex justify-between"><span className="text-base-content/60">Encaissé comparé</span><span>{formatFCFA(compare.collected)}</span></div>
              <div className="flex justify-between"><span className="text-base-content/60">Définition CA</span><span>{compare.definitions.revenue ?? definitions.revenue}</span></div>
            </div>
          ) : (
            <p className="text-base-content/60 text-xs">Renseignez deux dates de comparaison pour afficher l’écart.</p>
          )}
          <p className="text-base-content/60 mt-3 text-xs">{board.period.certified ? 'Coûts certifiés : résultat net calculable.' : `Coûts manquants : ${board.period.label}.`}</p>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-bold">Définitions métier partagées</h2>
          <div className="space-y-2 text-xs">
            {Object.entries(definitions).map(([key, value]) => (
              <div key={key} className="rounded-lg px-3 py-2 bg-base-200">
                <span className="font-bold">{key}</span> · <span className="text-base-content/60">{value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <h2 className="mb-3 text-sm font-bold">Détail par station</h2>
        {board.stations.length === 0 ? (
          <EmptyState icon={<FiBarChart2 />} title="Aucune station enregistrée" description="Le détail par station apparaîtra avec les données réelles." />
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="table min-w-[620px]">
              <thead><tr>
                <th>Rang</th><th>Station</th><th>Chiffre d’affaires</th>
                <th>Lavages</th><th>Encaissé</th><th>Solde partiel</th><th>Résultat net</th>
              </tr></thead>
              <tbody>
                {board.stations.map((s) => (
                  <tr key={s.stationId}>
                    <td className="font-bold">#{s.rank}</td>
                    <td className="font-bold">{s.name}{s.city && <span className="text-base-content/60 ml-1 text-xs">· {s.city}</span>}</td>
                    <td className="font-semibold">{formatFCFA(s.revenue)}</td>
                    <td>{s.washCount}</td>
                    <td>{formatFCFA(s.collected)}</td>
                    <td>{formatFCFA(s.partialBalance)}</td>
                    <td><Badge tone="warn">Non calculable</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </>}
    </div>
  );
}
