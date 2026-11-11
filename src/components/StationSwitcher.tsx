import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiCheck, FiChevronDown, FiMapPin, FiPlus, FiSettings, FiSliders, FiX,
} from 'react-icons/fi';
import { useStore } from '../lib/store';
import { Badge, Input, Modal } from './ui';

export default function StationSwitcher() {
  const { state, assignedStations, switchStation, createStation, notify } = useStore();
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [newStation, setNewStation] = useState({
    name: '',
    city: 'Abidjan',
    address: '',
    phone: '',
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const currentStation = state.station;
  const company = state.company;
  const role = state.session?.role;
  const canCreate = role === 'proprietaire' || role === 'gerant';

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectStation = (stId: string) => {
    if (stId === currentStation?.id) {
      setOpen(false);
      return;
    }
    switchStation(stId);
    setOpen(false);
  };

  const handleCreateStation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStation.name.trim()) {
      notify('error', 'Le nom de la station est obligatoire.');
      return;
    }
    try {
      const created = createStation(newStation);
      setModalOpen(false);
      setOpen(false);
      setNewStation({ name: '', city: 'Abidjan', address: '', phone: '' });
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Erreur lors de la création');
    }
  };

  if (!currentStation) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-400">
        <span>Aucune station</span>
      </div>
    );
  }

  const stationsList = assignedStations.length > 0 ? assignedStations : [currentStation];

  return (
    <>
      <div className="relative" ref={containerRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 transition text-left hover:bg-sky-500/10 border"
          style={{ borderColor: 'var(--wg-border)', background: 'var(--wg-surface-2)' }}
          aria-label="Sélectionner ou changer de station"
        >
          <span
            className={`wg-status-dot ${currentStation.activated ? 'bg-emerald-400' : 'bg-amber-400'}`}
            title={currentStation.activated ? 'Station active' : 'Mise en route'}
          />
          <div className="min-w-0 pr-1 max-w-[150px] sm:max-w-[210px]">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-xs font-bold leading-tight text-slate-200">
                {currentStation.name || 'Station sans nom'}
              </p>
              {stationsList.length > 1 && (
                <span className="rounded-full bg-sky-500/20 px-1.5 py-0.2 text-[9px] font-bold text-sky-400">
                  {stationsList.length}
                </span>
              )}
            </div>
            <p className="wg-muted truncate text-[10px] leading-tight">
              {currentStation.city ? currentStation.city : company?.name ?? 'Entreprise'}
            </p>
          </div>
          <FiChevronDown
            size={14}
            className={`wg-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <div
            className="wg-card wg-fade-in absolute left-0 top-12 z-50 w-80 overflow-hidden p-2 shadow-2xl border"
            style={{ background: 'var(--wg-surface)', borderColor: 'var(--wg-border)' }}
          >
            {/* Header info */}
            <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--wg-border)' }}>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider wg-muted">
                  Entreprise : {company?.name ?? 'WashGuard'}
                </p>
                <span className="text-[10px] text-sky-400 font-semibold">
                  {stationsList.length} station{stationsList.length > 1 ? 's' : ''}
                </span>
              </div>
              <p className="text-xs font-medium text-slate-300 mt-0.5">
                Changer de station active
              </p>
            </div>

            {/* Stations list */}
            <div className="p-1 max-h-60 overflow-y-auto space-y-1">
              {stationsList.map((st) => {
                const isSelected = st.id === currentStation.id;
                return (
                  <button
                    key={st.id}
                    onClick={() => handleSelectStation(st.id)}
                    className={`flex w-full items-center justify-between rounded-lg p-2.5 transition text-left text-xs ${
                      isSelected
                        ? 'bg-sky-500/15 border border-sky-500/40 text-slate-100 shadow-sm'
                        : 'hover:bg-sky-500/10 text-slate-300 border border-transparent'
                    }`}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-bold truncate ${isSelected ? 'text-sky-400' : 'text-slate-200'}`}>
                          {st.name}
                        </span>
                        <Badge tone={st.activated ? 'success' : 'warn'}>
                          {st.activated ? 'Active' : 'Mise en route'}
                        </Badge>
                      </div>
                      <p className="wg-muted mt-0.5 text-[11px] truncate flex items-center gap-1">
                        <FiMapPin size={10} className="shrink-0" />
                        <span>{st.address ? `${st.address}, ` : ''}{st.city || 'Côte d’Ivoire'}</span>
                      </p>
                    </div>

                    {isSelected && (
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-sky-500/20 text-sky-400 shrink-0">
                        <FiCheck size={12} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Add station option for authorized roles */}
            {canCreate && (
              <div className="p-1 border-t" style={{ borderColor: 'var(--wg-border)' }}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setModalOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-sky-400 hover:bg-sky-500/10 font-semibold transition"
                >
                  <FiPlus size={14} />
                  <span>Ajouter une succursale / station</span>
                </button>
              </div>
            )}

            {/* Quick links */}
            <div className="border-t p-1 space-y-0.5" style={{ borderColor: 'var(--wg-border)' }}>
              <button
                onClick={() => {
                  setOpen(false);
                  navigate('/app/parametres');
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 hover:bg-sky-500/10 hover:text-white transition"
              >
                <FiSliders size={13} className="text-sky-400" />
                <span>Paramètres de cette station</span>
              </button>
              {!currentStation.activated && (
                <button
                  onClick={() => {
                    setOpen(false);
                    navigate('/app/mise-en-route');
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-amber-400 hover:bg-amber-500/10 transition"
                >
                  <FiSettings size={13} />
                  <span>Compléter la mise en route</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal création de nouvelle station */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Ajouter une nouvelle station de lavage"
      >
        <form onSubmit={handleCreateStation} className="space-y-3">
          <p className="text-xs text-slate-400 leading-relaxed">
            Créez une nouvelle succursale pour votre entreprise <strong>{company?.name}</strong>. Elle disposera de son propre registre de caisse, file de lavages et barèmes.
          </p>

          <Input
            label="Nom de la station *"
            placeholder="Ex : Station WashGuard Riviera Palmeraie"
            value={newStation.name}
            onChange={(e) => setNewStation({ ...newStation, name: e.target.value })}
            required
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Ville / Commune *"
              placeholder="Ex : Abidjan - Cocody"
              value={newStation.city}
              onChange={(e) => setNewStation({ ...newStation, city: e.target.value })}
              required
            />
            <Input
              label="Téléphone de contact"
              placeholder="+225 07 00 00 00"
              value={newStation.phone}
              onChange={(e) => setNewStation({ ...newStation, phone: e.target.value })}
            />
          </div>

          <Input
            label="Adresse physique ou repère"
            placeholder="Ex : Boulevard François Mitterrand, carrefour ferronnerie"
            value={newStation.address}
            onChange={(e) => setNewStation({ ...newStation, address: e.target.value })}
          />

          <div className="mt-5 flex justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--wg-border)' }}>
            <button
              type="button"
              className="wg-btn wg-btn-ghost"
              onClick={() => setModalOpen(false)}
            >
              <FiX /> Annuler
            </button>
            <button type="submit" className="wg-btn wg-btn-primary">
              <FiPlus /> Créer et activer la station
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
