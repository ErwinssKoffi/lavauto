import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FiAlertTriangle, FiChevronDown, FiChevronUp, FiSettings, FiX,
} from 'react-icons/fi';
import { useStore } from '../lib/store';

export default function StockAlertBanner() {
  const { state, dataSource, isLocalStockDemo } = useStore();
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
      className="mb-5 overflow-hidden rounded-xl border border-warning/30 bg-linear-to-r from-warning/10 via-warning/5 to-transparent text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/20 text-warning">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-lg bg-warning opacity-30" />
            <FiAlertTriangle size={18} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-warning">
                Alerte stock critique
              </span>
              {ruptures.length > 0 && (
                <span className="rounded-full bg-error/20 px-2 py-0.5 text-[10px] font-bold text-error">
                  {ruptures.length} en rupture
                </span>
              )}
              {seuils.length > 0 && (
                <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-bold text-warning">
                  {seuils.length} sous le seuil
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-base-content/60">
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
            className="btn btn-sm text-xs! text-warning hover:text-base-content"
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
            className="btn btn-sm text-xs! bg-warning! hover:bg-warning! text-base-content! font-bold"
          >
            Gérer le stock
          </Link>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Fermer l'alerte"
            className="p-1 text-base-content/60 hover:text-base-content"
          >
            <FiX size={16} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-warning/20 bg-base-100/40 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {alerts.map((item) => {
              const level = levelByProductId.get(item.productId);
              const unit = level?.unit ?? 'unité';
              const isRupture = item.severity === 'rupture';
              const percent = Math.min(100, Math.round((item.qtyOnHand / Math.max(1, item.reorderLevel)) * 100));

              return (
                <div
                  key={item.productId}
                  className="rounded-lg border border-base-300 bg-base-100/80 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-base-content">{item.name}</p>
                      <p className="text-[11px] text-base-content/60">
                        Seuil critique défini : {item.reorderLevel} {unit}
                      </p>
                    </div>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
 isRupture
 ? 'bg-error/20 text-error'
 : 'bg-warning/20 text-warning'
 }`}
                    >
                      {isRupture ? 'RUPTURE' : `${item.qtyOnHand} ${unit} restant(s)`}
                    </span>
                  </div>

                  {/* Progress gauge */}
                  <div className="mt-2.5">
                    <div className="flex justify-between text-[10px] text-base-content/60">
                      <span>Disponible : {item.qtyOnHand} {unit}</span>
                      <span>Seuil : {item.reorderLevel} {unit}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-base-300">
                      <div
                        className={`h-1.5 rounded-full transition-all duration-300 ${
 isRupture ? 'bg-error w-0' : 'bg-warning'
 }`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-base-300/80 pt-2 text-[11px]">
                    <Link
                      to="/app/parametres#stock"
                      className="link link-primary flex items-center gap-1 text-[11px]"
                    >
                      <FiSettings size={12} /> {dataSource === 'api' || isLocalStockDemo ? 'Modifier le seuil' : 'Voir le seuil'}
                    </Link>
                    <Link
                      to="/app/stock"
                      className="link link-primary text-[11px] font-semibold"
                    >
                      Enregistrer un achat / mouvement →
                    </Link>
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
