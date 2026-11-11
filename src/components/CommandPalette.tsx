import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiArrowRight, FiBox, FiCreditCard, FiDollarSign, FiFileText,
  FiGrid, FiList, FiSearch, FiSettings, FiTruck, FiUsers, FiX,
} from 'react-icons/fi';
import { useStore } from '../lib/store';
import { formatFCFA } from '../lib/format';
import { Badge } from './ui';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const { state } = useStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (open) onClose();
        else setQuery('');
      }
      if (e.key === 'Escape' && open) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const q = query.trim().toLowerCase();

  const navigationItems = [
    { label: 'Tableau de bord', to: '/app/tableau-de-bord', icon: <FiGrid /> },
    { label: 'Lavages & File d’attente', to: '/app/lavages', icon: <FiTruck /> },
    { label: 'Caisse & Sessions', to: '/app/caisse', icon: <FiDollarSign /> },
    { label: 'Dépenses d’exploitation', to: '/app/depenses', icon: <FiCreditCard /> },
    { label: 'Clients & Véhicules', to: '/app/clients', icon: <FiUsers /> },
    { label: 'Prestations & Grille tarifaire', to: '/app/prestations', icon: <FiBox /> },
    { label: 'Rapports & Exports', to: '/app/rapports', icon: <FiFileText /> },
    { label: 'Commissions laveurs', to: '/app/commissions', icon: <FiTruck /> },
    { label: 'Équipe & Employés', to: '/app/employes', icon: <FiUsers /> },
    { label: 'Paramètres station', to: '/app/parametres', icon: <FiSettings /> },
    { label: 'Mise en route (13 étapes)', to: '/app/mise-en-route', icon: <FiList /> },
  ].filter((it) => !q || it.label.toLowerCase().includes(q));

  const matchedWashes = q
    ? state.washes
        .filter(
          (w) =>
            w.number.toLowerCase().includes(q) ||
            w.plate.toLowerCase().includes(q) ||
            (w.clientName && w.clientName.toLowerCase().includes(q))
        )
        .slice(0, 5)
    : [];

  const matchedClients = q
    ? state.clients
        .filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.phone.toLowerCase().includes(q) ||
            c.plate.toLowerCase().includes(q)
        )
        .slice(0, 5)
    : [];

  const handleSelect = (to: string) => {
    navigate(to);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16 backdrop-blur-sm sm:pt-24"
      onClick={onClose}
    >
      <div
        className="wg-card wg-fade-in w-full max-w-xl overflow-hidden shadow-2xl border"
        style={{ background: 'var(--wg-surface)', borderColor: 'var(--wg-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--wg-border)' }}>
          <FiSearch className="wg-muted text-base" />
          <input
            type="text"
            autoFocus
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-500"
            placeholder="Rechercher une fiche, une plaque, un client ou une page... (Échap pour fermer)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="wg-muted hover:text-slate-300" onClick={() => setQuery('')}>
              <FiX size={16} />
            </button>
          )}
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
            ESC
          </span>
        </div>

        {/* Search Results */}
        <div className="max-h-[60vh] overflow-y-auto p-2 space-y-3">
          {/* Fiches de lavage correspondantes */}
          {matchedWashes.length > 0 && (
            <div>
              <p className="wg-muted px-3 py-1 text-[10px] font-bold uppercase tracking-wider">
                Fiches de lavage ({matchedWashes.length})
              </p>
              <div className="space-y-0.5">
                {matchedWashes.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => handleSelect('/app/lavages')}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs hover:bg-sky-500/10 transition"
                  >
                    <div className="flex items-center gap-2">
                      <FiTruck className="text-sky-400" />
                      <div>
                        <span className="font-bold text-slate-200">{w.number}</span>
                        <span className="wg-muted ml-2">
                          {w.plate ? `Plaque : ${w.plate}` : w.vehicleLabel}
                        </span>
                        {w.clientName && <span className="wg-muted ml-2">· {w.clientName}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-300">{formatFCFA(w.total)}</span>
                      <Badge tone={w.status === 'termine' ? 'success' : w.status === 'annule' ? 'danger' : 'warn'}>
                        {w.status}
                      </Badge>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Clients correspondants */}
          {matchedClients.length > 0 && (
            <div>
              <p className="wg-muted px-3 py-1 text-[10px] font-bold uppercase tracking-wider">
                Clients ({matchedClients.length})
              </p>
              <div className="space-y-0.5">
                {matchedClients.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => handleSelect('/app/clients')}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs hover:bg-sky-500/10 transition"
                  >
                    <div className="flex items-center gap-2">
                      <FiUsers className="text-sky-400" />
                      <div>
                        <span className="font-bold text-slate-200">{c.name}</span>
                        {c.phone && <span className="wg-muted ml-2">· {c.phone}</span>}
                        {c.plate && <span className="wg-muted ml-2">· {c.plate}</span>}
                      </div>
                    </div>
                    <FiArrowRight className="text-slate-500" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Navigation modules */}
          <div>
            <p className="wg-muted px-3 py-1 text-[10px] font-bold uppercase tracking-wider">
              Navigation rapide
            </p>
            <div className="space-y-0.5">
              {navigationItems.map((it) => (
                <button
                  key={it.to}
                  onClick={() => handleSelect(it.to)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs hover:bg-sky-500/10 transition text-slate-300 hover:text-white"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-sky-400">{it.icon}</span>
                    <span className="font-medium">{it.label}</span>
                  </div>
                  <FiArrowRight className="text-slate-500 text-xs" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer shortcuts hint */}
        <div className="flex items-center justify-between border-t px-4 py-2 text-[11px] text-slate-500" style={{ borderColor: 'var(--wg-border)', background: 'var(--wg-surface-2)' }}>
          <span>Utilisez les flèches ou la souris pour naviguer</span>
          <span>WashGuard ERP v1.0</span>
        </div>
      </div>
    </div>
  );
}
