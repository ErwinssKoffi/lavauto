import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { FiTrendingUp, FiActivity, FiDollarSign, FiCheckCircle } from 'react-icons/fi';
import { formatFCFA } from '../lib/format';
import { getLast7DaysChartData, type DayChartPoint } from '../lib/metrics';
import { useStore } from '../lib/store';
import { Badge, Card } from './ui';

export default function Revenue7DaysLineChart() {
  const { state } = useStore();
  const data = getLast7DaysChartData(state);

  const totalRevenue = data.reduce((s, d) => s + d.revenue, 0);
  const totalCollected = data.reduce((s, d) => s + d.collected, 0);
  const totalWashes = data.reduce((s, d) => s + d.washesCount, 0);
  const dailyAverage = Math.round(totalRevenue / 7);
  const collectionRate = totalRevenue > 0 ? Math.round((totalCollected / totalRevenue) * 100) : 100;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const point = payload[0].payload as DayChartPoint;
      return (
        <div
          className="rounded-xl border p-3 shadow-xl backdrop-blur-md"
          style={{
            background: 'rgba(15, 23, 42, 0.95)',
            borderColor: 'var(--wg-border)',
            color: '#e2e8f0',
          }}
        >
          <div className="flex items-center justify-between gap-3 border-b pb-1.5 mb-2" style={{ borderColor: 'rgba(148, 163, 184, 0.2)' }}>
            <span className="font-bold text-xs text-slate-200">{point.label} ({point.fullDate})</span>
            <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-bold text-sky-400">
              {point.washesCount} lavage{point.washesCount > 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-sky-400">
                <span className="h-2 w-2 rounded-full bg-sky-400" />
                Chiffre d’affaires :
              </span>
              <span className="font-bold">{formatFCFA(point.revenue)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Encaissé :
              </span>
              <span className="font-bold">{formatFCFA(point.collected)}</span>
            </div>
            {point.revenue - point.collected > 0 && (
              <div className="flex items-center justify-between gap-4 text-amber-400 text-[11px] pt-1 border-t" style={{ borderColor: 'rgba(148, 163, 184, 0.15)' }}>
                <span>Reste dû :</span>
                <span className="font-semibold">{formatFCFA(point.revenue - point.collected)}</span>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <Card className="overflow-hidden">
      {/* Header and stats */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4 mb-4" style={{ borderColor: 'var(--wg-border)' }}>
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-500/15 text-sky-400">
              <FiTrendingUp size={15} />
            </span>
            <h2 className="text-sm font-bold text-slate-100">
              Évolution du chiffre d’affaires (7 derniers jours)
            </h2>
          </div>
          <p className="wg-muted mt-0.5 text-xs">
            Visualisation en courbe du CA journalier et des encaissements effectifs.
          </p>
        </div>

        {/* Quick summary badges */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs border"
            style={{ background: 'var(--wg-surface-2)', borderColor: 'var(--wg-border)' }}
          >
            <span className="wg-muted text-[11px]">Total 7j :</span>
            <span className="font-bold text-sky-400">{formatFCFA(totalRevenue)}</span>
          </div>

          <div
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs border"
            style={{ background: 'var(--wg-surface-2)', borderColor: 'var(--wg-border)' }}
          >
            <span className="wg-muted text-[11px]">Moyenne/j :</span>
            <span className="font-bold text-slate-200">{formatFCFA(dailyAverage)}</span>
          </div>

          <Badge tone={collectionRate >= 90 ? 'success' : 'warn'}>
            Recouvrement : {collectionRate}%
          </Badge>
        </div>
      </div>

      {/* Recharts LineChart */}
      <div className="h-[250px] w-full pt-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 12, right: 16, bottom: 4, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.4} />
            <XAxis
              dataKey="label"
              stroke="#94a3b8"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: '#334155' }}
            />
            <YAxis
              stroke="#94a3b8"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: '#334155' }}
              tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
              domain={[0, 'auto']}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="top"
              align="right"
              iconType="circle"
              wrapperStyle={{ fontSize: '11px', paddingBottom: '8px' }}
            />
            <Line
              type="monotone"
              dataKey="revenue"
              name="Chiffre d’affaires"
              stroke="#38bdf8"
              strokeWidth={3}
              dot={{ r: 4, fill: '#0284c7', stroke: '#38bdf8', strokeWidth: 2 }}
              activeDot={{ r: 7, stroke: '#38bdf8', strokeWidth: 3, fill: '#ffffff' }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="collected"
              name="Montant encaissé"
              stroke="#34d399"
              strokeWidth={2}
              strokeDasharray="4 2"
              dot={{ r: 3.5, fill: '#059669', stroke: '#34d399', strokeWidth: 1.5 }}
              activeDot={{ r: 6, stroke: '#34d399', strokeWidth: 2, fill: '#ffffff' }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5 text-[11px] wg-muted" style={{ borderColor: 'var(--wg-border)' }}>
        <span>Volume cumulé : <strong>{totalWashes} lavage(s)</strong> sur la période de 7 jours.</span>
        <span>Mise à jour en temps réel à chaque encaissement.</span>
      </div>
    </Card>
  );
}
