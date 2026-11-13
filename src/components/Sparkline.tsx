import React, { useId, useState } from 'react';
import { CHART_AREA_OPACITY, CHART_COLORS } from '../lib/chartTheme';

export interface SparklinePoint {
  label: string;
  value: number;
}

// Tons alignés sur le thème actif : la courbe suit `primary` / `success` /
// `warning`, et le dégradé est obtenu par `stopOpacity` plutôt que par des
// couleurs rgba figées.
const TONE_PALETTE = {
  sky: { color: CHART_COLORS.revenue, text: 'text-primary' },
  emerald: { color: CHART_COLORS.collected, text: 'text-success' },
  amber: { color: CHART_COLORS.expenses, text: 'text-warning' },
} as const;

function buildSmoothPath(coords: { x: number; y: number }[]): string {
  if (coords.length === 0) return '';
  if (coords.length === 1) return `M ${coords[0].x} ${coords[0].y}`;
  let d = `M ${coords[0].x.toFixed(2)} ${coords[0].y.toFixed(2)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i];
    const p1 = coords[i + 1];
    const cx = ((p0.x + p1.x) / 2).toFixed(2);
    d += ` C ${cx} ${p0.y.toFixed(2)}, ${cx} ${p1.y.toFixed(2)}, ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
  }
  return d;
}

export default function Sparkline({
  values,
  color = 'sky',
  formatValue = (v) => String(v),
  title = '7 derniers jours',
}: {
  values: SparklinePoint[];
  color?: keyof typeof TONE_PALETTE;
  formatValue?: (value: number) => string;
  title?: string;
}) {
  const gradientId = useId().replace(/:/g, '');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const palette = TONE_PALETTE[color];

  if (values.length === 0) return null;

  const width = 180;
  const height = 38;
  const padX = 5;
  const padY = 6;
  const usableW = width - padX * 2;
  const usableH = height - padY * 2;

  const rawValues = values.map((v) => v.value);
  const minVal = Math.min(...rawValues);
  const maxVal = Math.max(...rawValues);
  const span = maxVal - minVal;

  const coords = values.map((pt, idx) => {
    const x = values.length === 1 ? width / 2 : padX + (idx / (values.length - 1)) * usableW;
    const normalized = span === 0 ? (maxVal === 0 ? 0 : 0.5) : (pt.value - minVal) / span;
    const y = padY + usableH - normalized * usableH;
    return { x, y, ...pt };
  });

  const linePath = buildSmoothPath(coords);
  const last = coords[coords.length - 1];
  const first = coords[0];
  const areaPath = `${linePath} L ${last.x.toFixed(2)} ${(height - 2).toFixed(2)} L ${first.x.toFixed(2)} ${(height - 2).toFixed(2)} Z`;

  const activePoint = hoveredIndex !== null ? coords[hoveredIndex] : null;
  const total7d = rawValues.reduce((sum, v) => sum + v, 0);
  const prevValues = rawValues.slice(0, -1);
  const prevAvg = prevValues.length > 0 ? prevValues.reduce((s, v) => s + v, 0) / prevValues.length : 0;
  const todayVal = rawValues[rawValues.length - 1] ?? 0;
  const deltaPct = prevAvg > 0 ? Math.round(((todayVal - prevAvg) / prevAvg) * 100) : null;

  const ariaSummary = `${title} : ${values.map((v) => `${v.label} ${formatValue(v.value)}`).join(', ')}`;

  return (
    <div className="select-none" onMouseLeave={() => setHoveredIndex(null)}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="truncate text-base-content/60">
          {activePoint ? activePoint.label : title}
        </span>
        <span className={`font-semibold tabular-nums ${activePoint ? palette.text : deltaPct !== null && deltaPct !== 0 ? (deltaPct > 0 ? 'text-success' : 'text-warning') : 'text-base-content/60'}`}>
          {activePoint
            ? formatValue(activePoint.value)
            : deltaPct !== null && deltaPct !== 0
              ? `${deltaPct > 0 ? '+' : ''}${deltaPct} % vs moy. 6j`
              : `Total 7j : ${formatValue(total7d)}`}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-10 w-full overflow-visible"
        role="img"
        aria-label={ariaSummary}
      >
        <defs>
          <linearGradient id={`spark-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.color} stopOpacity={CHART_AREA_OPACITY.top} />
            <stop offset="100%" stopColor={palette.color} stopOpacity={CHART_AREA_OPACITY.bottom} />
          </linearGradient>
        </defs>

        <line
          x1={padX}
          y1={height - 2}
          x2={width - padX}
          y2={height - 2}
          stroke="currentColor"
          strokeOpacity="0.12"
          strokeDasharray="2 3"
          strokeWidth="1"
        />

        <path d={areaPath} fill={`url(#spark-${gradientId})`} />
        <path
          d={linePath}
          fill="none"
          stroke={palette.color}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {activePoint ? (
          <circle
            cx={activePoint.x}
            cy={activePoint.y}
            r="3.8"
            fill={palette.color}
            stroke="var(--color-base-100)"
            strokeWidth="1.5"
          />
        ) : (
          <circle
            cx={last.x}
            cy={last.y}
            r="3"
            fill={palette.color}
            stroke="var(--color-base-100)"
            strokeWidth="1.2"
          />
        )}

        {coords.map((pt, idx) => {
          const sliceW = usableW / Math.max(coords.length - 1, 1);
          const rectX = Math.max(0, pt.x - sliceW / 2);
          return (
            <rect
              key={pt.label}
              x={rectX}
              y={0}
              width={sliceW}
              height={height}
              fill="transparent"
              className="cursor-crosshair"
              onMouseEnter={() => setHoveredIndex(idx)}
            />
          );
        })}
      </svg>
    </div>
  );
}
