import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { FiTrendingUp } from 'react-icons/fi';
import { formatFCFA } from '../lib/format';
import type { DayChartPoint } from '../lib/metrics';
import { Badge, Card } from './ui';
import { CHART_COLORS } from '../lib/chartTheme';

export default function Revenue7DaysLineChart({ data }: { data: DayChartPoint[] }) {

  const totalRevenue = data.reduce((s, d) => s + d.revenue, 0);
  const hasCollections = data.every((d) => d.collected !== null);
  const totalCollected = hasCollections ? data.reduce((s, d) => s + (d.collected ?? 0), 0) : null;
  const totalWashes = data.reduce((s, d) => s + d.washesCount, 0);
  const dailyAverage = Math.round(totalRevenue / 7);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const point = payload[0].payload as DayChartPoint;
      return (
        <div
          className="rounded-xl border p-3 shadow-e3 backdrop-blur-md"
          style={{
            background: 'var(--color-base-100)',
            color: 'var(--color-base-content)',
          }}
        >
          <div className="flex items-center justify-between gap-3 border-b pb-1.5 mb-2" style={{ borderColor: 'var(--color-base-300)' }}>
            <span className="font-bold text-xs text-base-content/80">{point.label} ({point.fullDate})</span>
            <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold text-primary">
              {point.washesCount} lavage{point.washesCount > 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-primary">
                <span className="h-2 w-2 rounded-full bg-primary" />
                Chiffre d’affaires :
              </span>
              <span className="font-bold">{formatFCFA(point.revenue)}</span>
            </div>
            {point.collected !== null && <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-success">
                <span className="h-2 w-2 rounded-full bg-success" />
                Encaissements nets :
              </span>
              <span className="font-bold">{formatFCFA(point.collected)}</span>
            </div>}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <Card className="overflow-hidden">
      {/* Header and stats */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-base-300 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
              <FiTrendingUp size={15} />
            </span>
            <h2 className="text-sm font-bold text-base-content">
              Évolution du chiffre d’affaires (7 derniers jours)
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-base-content/60">
            Visualisation en courbe du CA journalier et des encaissements effectifs.
          </p>
        </div>

        {/* Quick summary badges */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-1.5 rounded-lg border border-base-300 bg-base-200 px-2.5 py-1 text-xs"
          >
            <span className="text-[11px] text-base-content/60">Total 7j :</span>
            <span className="font-bold text-primary">{formatFCFA(totalRevenue)}</span>
          </div>

          <div
            className="flex items-center gap-1.5 rounded-lg border border-base-300 bg-base-200 px-2.5 py-1 text-xs"
          >
            <span className="text-[11px] text-base-content/60">Moyenne/j :</span>
            <span className="font-bold text-base-content/80">{formatFCFA(dailyAverage)}</span>
          </div>

          {totalCollected !== null && <Badge>Encaissements nets : {formatFCFA(totalCollected)}</Badge>}
        </div>
      </div>

      {/* Recharts LineChart */}
      <div className="h-[250px] w-full pt-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 12, right: 16, bottom: 4, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-base-300)" opacity={0.4} />
            <XAxis
              dataKey="label"
              stroke="var(--color-base-content)"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: 'var(--color-base-300)' }}
            />
            <YAxis
              stroke="var(--color-base-content)"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: 'var(--color-base-300)' }}
              tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
              domain={['auto', 'auto']}
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
              stroke={CHART_COLORS.revenue}
              strokeWidth={3}
              dot={{ r: 4, fill: CHART_COLORS.revenue, stroke: CHART_COLORS.revenue, strokeWidth: 2 }}
              activeDot={{ r: 7, stroke: CHART_COLORS.revenue, strokeWidth: 3, fill: CHART_COLORS.surface }}
              isAnimationActive={false}
            />
            {hasCollections && <Line
              type="monotone"
              dataKey="collected"
              name="Montant encaissé"
              stroke={CHART_COLORS.collected}
              strokeWidth={2}
              strokeDasharray="4 2"
              dot={{ r: 3.5, fill: CHART_COLORS.collected, stroke: CHART_COLORS.collected, strokeWidth: 1.5 }}
              activeDot={{ r: 6, stroke: CHART_COLORS.collected, strokeWidth: 2, fill: CHART_COLORS.surface }}
              isAnimationActive={false}
            />}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-base-300 pt-2.5 text-[11px] text-base-content/60">
        <span>Volume cumulé : <strong>{totalWashes} lavage(s)</strong> sur la période de 7 jours.</span>
        <span>Paiements et annulations comptabilisés à leur date respective.</span>
      </div>
    </Card>
  );
}
