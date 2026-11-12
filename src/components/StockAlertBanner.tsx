import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FiAlertTriangle, FiChevronDown, FiChevronUp, FiPlus, FiSettings, FiX,
} from 'react-icons/fi';
import { useStore } from '../lib/store';

export default function StockAlertBanner() {
  const { state, adjustProductStock, isLocalStockDemo } = useStore();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const alerts = state.stockAlerts ?? [];
  if (alerts.length === 0 || dismissed) return null;

  const ruptures = alerts.filter((a) => a.severity === 'rupture');
  const seuils = alerts.filter((a) => a.severity === 'seuil');
  const levelByProductId = new Map((state.stockLevels ?? []).map((l) => [l.productId, l]));

  return (
    <div
      role="alert"
      className="mb-5 overflow-hidden rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-lg bg-amber-400 opacity-30" />
            <FiAlertTriangle size={18} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-amber-300">
                Alerte stock critique
              </span>
              {ruptures.length > 0 && (
                <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-300">
                  {ruptures.length} en rupture
                </span>
              )}
              {seuils.length > 0 && (
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                  {seuils.length} sous le seuil
                </span>
              )}
            </div>
            <p className="wg-muted mt-0.5 text-[11px]">
              {alerts.map((a) => `${a.name} (${a.qtyOnHand}/${a.reorderLevel})`).slice(0, 3).join(' · ')}
              {alerts.length > 3 ? ` et ${alerts.length - 3} autre(s)` : ''}.
              Risque d'interruption du service lavage.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="wg-btn wg-btn-ghost !py-1 !text-xs text-amber-300 hover:text-white"
          >
            {expanded ? (
              <>
                <FiChevronUp size={14} /> Masquer détails
              </>
            ) : (
              <>
                <FiChevronDown size={14} /> Voir les niveaux ({alerts.length})
              </>
            )}
          </button>
          <Link
            to="/app/stock"
            className="wg-btn wg-btn-primary !py-1 !text-xs !bg-amber-500 hover:!bg-amber-400 !text-slate-950 font-bold"
          >
            Gérer le stock
          </Link>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Fermer l'alerte"
            className="wg-muted hover:text-white p-1"
          >
            <FiX size={16} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-amber-500/20 bg-slate-950/40 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {alerts.map((item) => {
              const level = levelByProductId.get(item.productId);
              const unit = level?.unit ?? 'unité';
              const isRupture = item.severity === 'rupture';
              const percent = Math.min(100, Math.round((item.qtyOnHand / Math.max(1, item.reorderLevel)) * 100));

              return (
                <div
                  key={item.productId}
                  className="rounded-lg border border-slate-800 bg-slate-900/80 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-white">{item.name}</p>
                      <p className="wg-muted text-[11px]">
                        Seuil critique défini : {item.reorderLevel} {unit}
                      </p>
                    </div>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        isRupture
                          ? 'bg-red-500/20 text-red-300'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {isRupture ? 'RUPTURE' : `${item.qtyOnHand} ${unit} restant(s)`}
                    </span>
                  </div>

                  {/* Progress gauge */}
                  <div className="mt-2.5">
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Disponible : {item.qtyOnHand} {unit}</span>
                      <span>Seuil : {item.reorderLevel} {unit}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-slate-800">
                      <div
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          isRupture ? 'bg-red-500 w-0' : 'bg-amber-400'
                        }`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2 text-[11px]">
                    <Link
                      to="/app/parametres#stock"
                      className="wg-link flex items-center gap-1 text-[11px]"
                    >
                      <FiSettings size={12} /> {isLocalStockDemo ? 'Modifier seuil' : 'Voir le seuil'}
                    </Link>
                    {isLocalStockDemo && (
                      <button
                        type="button"
                        onClick={() => adjustProductStock(item.productId, item.qtyOnHand + 5)}
                        className="flex items-center gap-1 rounded bg-sky-500/20 px-2 py-0.5 font-semibold text-sky-300 hover:bg-sky-500/30"
                        title="Simuler un réapprovisionnement dans ce navigateur"
                        aria-label={`Simuler un réapprovisionnement de 5 ${unit} pour ${item.name}`}
                      >
                        <FiPlus size={11} aria-hidden="true" /> 5 {unit} (simulation locale)
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
