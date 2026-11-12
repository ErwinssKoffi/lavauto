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

const CHART_WIDTH = 720;
const CHART_HEIGHT = 260;
const AXIS = '#94a3b8';
const GRID = '#334155';
const TOOLTIP_STYLE = {
  background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0',
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
    if (dataSource === 'supabase' && (!authReady || !identity)) return;
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
        actions={<Badge tone="accent"><FiBarChart2 /> Analytics P09</Badge>}
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
          <button className="wg-btn wg-btn-primary" onClick={() => { void refreshAnalytics(start, end, cs, ce).catch(() => {}); }}>
            <FiRefreshCw /> Actualiser les indicateurs
          </button>
          <button className="wg-btn wg-btn-ghost" onClick={() => {
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
        <StatCard label="Solde partiel" value={formatFCFA(board.stats.partialBalance)} hint={definitions.partialBalance} accent="bg-amber-500/10 text-amber-400" />
        <StatCard label="Écart vs période comparée" value={delta === null ? '—' : formatFCFA(delta)} hint="Même définition du chiffre d’affaires" accent="bg-sky-500/10 text-sky-400" />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <h2 className="mb-3 text-sm font-bold">Tendance quotidienne</h2>
          {trend.length === 0 ? (
            <EmptyState icon={<FiBarChart2 />} title="Aucune donnée sur la période" description="Les points apparaîtront dès que des lavages réels seront enregistrés. Aucune donnée d’exemple n’est fabriquée." />
          ) : (
            <div className="wg-scroll-x">
              <LineChart width={CHART_WIDTH} height={CHART_HEIGHT} data={trend} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="date" stroke={AXIS} tickFormatter={shortDate} fontSize={11} />
                <YAxis stroke={AXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} fontSize={11} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(v) => formatDate(String(v))} />
                <Legend />
                <Line type="monotone" dataKey="revenue" name="Chiffre d’affaires" stroke="#38bdf8" dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="collected" name="Encaissé" stroke="#34d399" dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="expenses" name="Dépenses" stroke="#fbbf24" dot={false} isAnimationActive={false} />
              </LineChart>
            </div>
          )}
          <p className="wg-muted mt-2 text-xs">{board.rules.comparison} · {board.rules.netResult}.</p>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-bold">Classement des stations</h2>
          {rankings.length === 0 ? (
            <EmptyState icon={<FiTrendingUp />} title="Aucune station à classer" description="Le classement utilise uniquement les stations réellement accessibles." />
          ) : (
            <div className="wg-scroll-x">
              <BarChart width={380} height={CHART_HEIGHT} data={rankings} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="name" stroke={AXIS} fontSize={10} interval={0} />
                <YAxis stroke={AXIS} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} fontSize={11} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="revenue" name="Chiffre d’affaires" fill="#38bdf8" radius={[6, 6, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </div>
          )}
          <p className="wg-muted mt-2 text-xs">{board.rules.stations}.</p>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-bold">Comparaison des périodes</h2>
          {compare ? (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="wg-muted">CA période courante</span><span className="font-bold">{formatFCFA(board.period.revenue)}</span></div>
              <div className="flex justify-between"><span className="wg-muted">CA période comparée</span><span className="font-bold">{formatFCFA(compare.revenue)}</span></div>
              <div className="flex justify-between"><span className="wg-muted">Écart</span><Badge tone={(delta ?? 0) >= 0 ? 'success' : 'danger'}>{formatFCFA(delta ?? 0)}</Badge></div>
              <div className="flex justify-between"><span className="wg-muted">Encaissé comparé</span><span>{formatFCFA(compare.collected)}</span></div>
              <div className="flex justify-between"><span className="wg-muted">Définition CA</span><span>{compare.definitions.revenue ?? definitions.revenue}</span></div>
            </div>
          ) : (
            <p className="wg-muted text-xs">Renseignez deux dates de comparaison pour afficher l’écart.</p>
          )}
          <p className="wg-muted mt-3 text-xs">{board.period.certified ? 'Coûts certifiés : résultat net calculable.' : `Coûts manquants : ${board.period.label}.`}</p>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-bold">Définitions métier partagées</h2>
          <div className="space-y-2 text-xs">
            {Object.entries(definitions).map(([key, value]) => (
              <div key={key} className="rounded-lg px-3 py-2" style={{ background: 'var(--wg-surface-2)' }}>
                <span className="font-bold">{key}</span> · <span className="wg-muted">{value}</span>
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
          <div className="wg-scroll-x rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}>
            <table>
              <thead><tr>
                <th className="wg-th">Rang</th><th className="wg-th">Station</th><th className="wg-th">Chiffre d’affaires</th>
                <th className="wg-th">Lavages</th><th className="wg-th">Encaissé</th><th className="wg-th">Solde partiel</th><th className="wg-th">Résultat net</th>
              </tr></thead>
              <tbody>
                {board.stations.map((s) => (
                  <tr key={s.stationId}>
                    <td className="wg-td font-bold">#{s.rank}</td>
                    <td className="wg-td font-bold">{s.name}{s.city && <span className="wg-muted ml-1 text-xs">· {s.city}</span>}</td>
                    <td className="wg-td font-semibold">{formatFCFA(s.revenue)}</td>
                    <td className="wg-td">{s.washCount}</td>
                    <td className="wg-td">{formatFCFA(s.collected)}</td>
                    <td className="wg-td">{formatFCFA(s.partialBalance)}</td>
                    <td className="wg-td"><Badge tone="warn">Non calculable</Badge></td>
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
