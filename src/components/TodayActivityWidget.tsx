import React from 'react';
import { Link } from 'react-router-dom';
import {
  FiArrowDown, FiArrowUp, FiArrowUpRight, FiCheckCircle, FiClock,
  FiDollarSign, FiDroplet, FiMinus, FiPlus, FiTrendingDown, FiTrendingUp, FiTruck,
} from 'react-icons/fi';
import { useStore } from '../lib/store';
import { buildReport, previous7DaysMetrics } from '../lib/metrics';
import { formatFCFA } from '../lib/format';
import { Badge } from './ui';

interface TodayActivityWidgetProps {
  onNewWashClick?: () => void;
  className?: string;
}

export default function TodayActivityWidget({
  onNewWashClick,
  className = '',
}: TodayActivityWidgetProps) {
  const { state } = useStore();
  const day = buildReport(state, 'jour');
  const prev7 = previous7DaysMetrics(state);
  const avg7Days = prev7.dailyAverage;

  const todayStr = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date());

  const totalWashes = day.washes.length;
  const finishedWashes = day.washes.filter((w) => w.status === 'termine').length;
  const inProgressWashes = day.washes.filter((w) => w.status === 'en_cours').length;
  const pendingWashes = day.washes.filter((w) => w.status === 'en_attente').length;
  const cancelledWashes = day.washes.filter((w) => w.status === 'annule').length;

  const totalRevenue = day.revenue;
  const collectedRevenue = day.collected;
  const pendingCollection = Math.max(0, totalRevenue - collectedRevenue);

  // Calcul de la tendance vs moyenne des 7 derniers jours
  let trendDirection: 'up' | 'down' | 'neutral' = 'neutral';
  let trendLabel = '';
  let trendShort = '';

  if (avg7Days > 0) {
    const diff = totalRevenue - avg7Days;
    const pct = Math.round((diff / avg7Days) * 100);
    if (pct > 0) {
      trendDirection = 'up';
      trendShort = `+${pct} %`;
      trendLabel = `+${pct} % vs moy. 7j (${formatFCFA(avg7Days)}/j)`;
    } else if (pct < 0) {
      trendDirection = 'down';
      trendShort = `${pct} %`;
      trendLabel = `${pct} % vs moy. 7j (${formatFCFA(avg7Days)}/j)`;
    } else {
      trendDirection = 'neutral';
      trendShort = `0 %`;
      trendLabel = `Égal à la moy. 7j (${formatFCFA(avg7Days)}/j)`;
    }
  } else if (totalRevenue > 0) {
    trendDirection = 'up';
    trendShort = `+100 %`;
    trendLabel = `1er jour avec CA enregistré`;
  } else {
    trendDirection = 'neutral';
    trendShort = `0 %`;
    trendLabel = `Moy. 7j : 0 FCFA`;
  }

  const completionRate = totalWashes > 0 ? Math.round((finishedWashes / totalWashes) * 100) : 0;

  return (
    <div
      className={`wg-card overflow-hidden border p-5 transition-all ${className}`}
      style={{
        background: 'linear-gradient(180deg, var(--wg-surface) 0%, var(--wg-surface-2) 100%)',
        borderColor: 'var(--wg-border)',
      }}
    >
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b" style={{ borderColor: 'var(--wg-border)' }}>
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-sky-500" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold tracking-tight">Activité du jour</h2>
              <Badge tone="accent">Aujourd'hui</Badge>
            </div>
            <p className="wg-muted text-[11px] capitalize">{todayStr}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onNewWashClick ? (
            <button
              onClick={onNewWashClick}
              className="wg-btn wg-btn-primary !py-1.5 !px-3 !text-xs shadow-sm"
            >
              <FiPlus size={14} /> Nouveau lavage
            </button>
          ) : (
            <Link
              to="/app/lavages"
              className="wg-btn wg-btn-ghost !py-1.5 !px-3 !text-xs"
            >
              <FiPlus size={14} /> Fiche de lavage
            </Link>
          )}
          <Link
            to="/app/lavages"
            className="wg-btn wg-btn-ghost !py-1.5 !px-2.5 !text-xs text-slate-400 hover:text-slate-200"
            title="Consulter toutes les fiches"
          >
            <FiArrowUpRight size={15} />
          </Link>
        </div>
      </div>

      {/* Main KPI dual summary */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* KPI 1: Washes Count */}
        <div
          className="rounded-xl border p-4 transition-all"
          style={{ background: 'var(--wg-surface)', borderColor: 'var(--wg-border)' }}
        >
          <div className="flex items-center justify-between">
            <span className="wg-muted text-[11px] font-semibold uppercase tracking-wider">
              Volume de Lavages
            </span>
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-500/10 text-sky-400">
              <FiDroplet size={16} />
            </span>
          </div>

          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight">
              {totalWashes}
            </span>
            <span className="wg-muted text-xs">
              véhicule{totalWashes > 1 ? 's' : ''} pris en charge
            </span>
          </div>

          {/* Sub-status pills */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5 pt-2 border-t text-[11px]" style={{ borderColor: 'var(--wg-border)' }}>
            <span className="inline-flex items-center gap-1 font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md">
              <FiCheckCircle size={12} /> {finishedWashes} terminé{finishedWashes > 1 ? 's' : ''}
            </span>
            {inProgressWashes > 0 && (
              <span className="inline-flex items-center gap-1 font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md">
                <FiClock size={12} /> {inProgressWashes} en cours
              </span>
            )}
            {pendingWashes > 0 && (
              <span className="inline-flex items-center gap-1 font-medium text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-md">
                {pendingWashes} en attente
              </span>
            )}
            {cancelledWashes > 0 && (
              <span className="inline-flex items-center gap-1 font-medium text-red-400 bg-red-500/10 px-2 py-0.5 rounded-md">
                {cancelledWashes} annulé{cancelledWashes > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* KPI 2: Revenue Generated */}
        <div
          className="rounded-xl border p-4 transition-all"
          style={{ background: 'var(--wg-surface)', borderColor: 'var(--wg-border)' }}
        >
          <div className="flex items-center justify-between">
            <span className="wg-muted text-[11px] font-semibold uppercase tracking-wider">
              Chiffre d’Affaires du Jour
            </span>
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-500/10 text-emerald-400">
              <FiTrendingUp size={16} />
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-baseline gap-2.5">
            <span className="text-3xl font-extrabold tracking-tight text-sky-400">
              {formatFCFA(totalRevenue)}
            </span>

            {/* Trend Indicator (up/down arrow vs previous 7-day average) */}
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold border transition ${
                trendDirection === 'up'
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shadow-sm shadow-emerald-500/10'
                  : trendDirection === 'down'
                  ? 'bg-rose-500/15 text-rose-400 border-rose-500/30 shadow-sm shadow-rose-500/10'
                  : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
              }`}
              title={trendLabel}
            >
              {trendDirection === 'up' && <FiArrowUp size={11} className="stroke-[3]" />}
              {trendDirection === 'down' && <FiArrowDown size={11} className="stroke-[3]" />}
              {trendDirection === 'neutral' && <FiMinus size={11} />}
              <span>{trendShort}</span>
            </span>
          </div>

          <p className="wg-muted mt-1 text-[11px] truncate flex items-center gap-1" title={trendLabel}>
            <span className="opacity-75">vs moy. 7j :</span>
            <span className="font-semibold text-slate-300">{formatFCFA(avg7Days)}/j</span>
          </p>

          {/* Collected vs Unpaid */}
          <div className="mt-3 flex items-center justify-between pt-2 border-t text-xs" style={{ borderColor: 'var(--wg-border)' }}>
            <div className="flex items-center gap-1.5">
              <span className="wg-muted text-[11px]">Encaissé :</span>
              <strong className="text-emerald-400 font-bold">{formatFCFA(collectedRevenue)}</strong>
            </div>
            {pendingCollection > 0 ? (
              <div className="flex items-center gap-1.5">
                <span className="wg-muted text-[11px]">Reste dû :</span>
                <strong className="text-amber-400 font-bold">{formatFCFA(pendingCollection)}</strong>
              </div>
            ) : (
              <span className="text-[11px] text-slate-400">100% encaissé</span>
            )}
          </div>
        </div>
      </div>

      {/* Completion progress bar */}
      {totalWashes > 0 && (
        <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--wg-border)' }}>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="wg-muted text-[11px]">Taux d’achèvement des lavages aujourd’hui</span>
            <span className="font-bold text-sky-400">{completionRate} %</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--wg-surface)' }}>
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-500"
              style={{ width: `${completionRate}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
