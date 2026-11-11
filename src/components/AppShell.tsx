import React, { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  FiActivity, FiBarChart2, FiBox, FiDollarSign, FiFileText, FiGrid, FiHelpCircle,
  FiList, FiLogOut, FiMenu, FiMoon, FiPieChart, FiSettings, FiSun, FiTruck,
  FiUsers, FiX, FiCreditCard, FiShield, FiSliders,
} from 'react-icons/fi';
import { useStore } from '../lib/store';
import { Badge, Card, Logo } from './ui';
import type { Role } from '../types';
import { ROLE_LABELS } from '../types';

interface NavItem { to: string; label: string; icon: React.ReactNode; roles: Role[] }

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Vue d’ensemble',
    items: [
      { to: '/app/tableau-de-bord', label: 'Tableau de bord', icon: <FiGrid />, roles: ['proprietaire', 'gerant', 'caissier'] },
      { to: '/app/mise-en-route', label: 'Mise en route', icon: <FiList />, roles: ['proprietaire', 'gerant'] },
    ],
  },
  {
    group: 'Exploitation',
    items: [
      { to: '/app/lavages', label: 'Lavages', icon: <FiTruck />, roles: ['proprietaire', 'gerant', 'caissier'] },
      { to: '/app/prestations', label: 'Prestations', icon: <FiBox />, roles: ['proprietaire', 'gerant'] },
      { to: '/app/clients', label: 'Clients', icon: <FiUsers />, roles: ['proprietaire', 'gerant', 'caissier'] },
      { to: '/app/caisse', label: 'Caisse', icon: <FiDollarSign />, roles: ['proprietaire', 'gerant', 'caissier'] },
      { to: '/app/depenses', label: 'Dépenses', icon: <FiCreditCard />, roles: ['proprietaire', 'gerant', 'caissier'] },
    ],
  },
  {
    group: 'Pilotage',
    items: [
      { to: '/app/rapports', label: 'Rapports', icon: <FiBarChart2 />, roles: ['proprietaire', 'gerant'] },
      { to: '/app/commissions', label: 'Commissions', icon: <FiPieChart />, roles: ['proprietaire', 'gerant'] },
      { to: '/app/employes', label: 'Employés', icon: <FiUsers />, roles: ['proprietaire', 'gerant'] },
      { to: '/app/parametres', label: 'Paramètres', icon: <FiSettings />, roles: ['proprietaire', 'gerant'] },
      { to: '/app/abonnement', label: 'Abonnement', icon: <FiFileText />, roles: ['proprietaire'] },
    ],
  },
  {
    group: 'WashGuard',
    items: [
      { to: '/app/plateforme', label: 'Espace plateforme', icon: <FiShield />, roles: ['support'] },
    ],
  },
];

export default function AppShell() {
  const { state, theme, toggleTheme, signOut, missing } = useStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const role = state.session?.role ?? 'caissier';
  const stationName = state.station?.name ?? 'Ma station';
  const current = [...NAV.flatMap((g) => g.items)].find((i) => i.to === location.pathname)?.label ?? 'Espace station';

  const sidebar = (
    <div className="flex h-full flex-col" style={{ background: 'var(--wg-surface)' }}>
      <div className="flex h-16 shrink-0 items-center justify-between border-b px-5" style={{ borderColor: 'var(--wg-border)' }}>
        <NavLink to="/"><Logo /></NavLink>
        <button className="wg-muted lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Fermer le menu"><FiX size={20} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {NAV.map((group) => {
          const items = group.items.filter((i) => i.roles.includes(role));
          if (!items.length) return null;
          return (
            <div key={group.group} className="mb-5">
              <p className="wg-muted mb-2 px-3 text-[10px] font-bold uppercase tracking-[.14em]">{group.group}</p>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition ${
                        isActive ? 'wg-btn-primary shadow-md shadow-sky-500/20' : 'wg-muted hover:bg-sky-500/10 hover:text-sky-400'
                      }`
                    }
                  >
                    <span className="text-base">{item.icon}</span>
                    <span className="flex-1">{item.label}</span>
                    {item.to === '/app/mise-en-route' && !state.station?.activated && missing.length > 0 && (
                      <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">{missing.length}</span>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t p-3" style={{ borderColor: 'var(--wg-border)' }}>
        <div className="rounded-xl p-3" style={{ background: 'var(--wg-surface-2)' }}>
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg wg-gradient text-white"><FiActivity size={15} /></span>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold">{stationName}</p>
              <p className="wg-muted truncate text-[11px]">{state.station?.activated ? 'Station active' : 'Mise en route en cours'}</p>
            </div>
          </div>
          {state.demoMode && <p className="wg-muted mt-2 text-[10px] leading-snug">Mode démonstration frontend : données conservées dans ce navigateur.</p>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r lg:block" style={{ borderColor: 'var(--wg-border)' }}>
        {sidebar}
      </aside>
      {/* Sidebar mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[270px] border-r shadow-2xl" style={{ borderColor: 'var(--wg-border)' }}>{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-64">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b px-4 backdrop-blur-xl sm:px-6" style={{ borderColor: 'var(--wg-border)', background: 'color-mix(in srgb, var(--wg-bg) 88%, transparent)' }}>
          <div className="flex min-w-0 items-center gap-3">
            <button className="wg-muted lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu"><FiMenu size={20} /></button>
            <div className="min-w-0">
              <p className="wg-muted text-[10px] font-semibold uppercase tracking-widest">Espace station</p>
              <p className="truncate text-sm font-bold">{current}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {state.demoMode && <span className="hidden sm:inline-flex"><Badge tone="accent">Démo frontend</Badge></span>}
            <button onClick={toggleTheme} className="wg-btn wg-btn-ghost !px-2.5" aria-label="Changer de thème" title="Thème clair / sombre">
              {theme === 'dark' ? <FiSun size={16} /> : <FiMoon size={16} />}
            </button>
            <a href="/#faq" className="wg-btn wg-btn-ghost !px-2.5" title="Questions fréquentes"><FiHelpCircle size={16} /></a>
            <div className="relative">
              <button onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-sky-500/10">
                <span className="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold text-white wg-gradient">
                  {(state.session?.name ?? '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                </span>
                <div className="hidden text-left sm:block">
                  <p className="text-xs font-bold leading-tight">{state.session?.name}</p>
                  <p className="wg-muted text-[10px] leading-tight">{ROLE_LABELS[role]}</p>
                </div>
              </button>
              {menuOpen && (
                <div className="wg-card absolute right-0 top-12 z-50 w-56 p-2">
                  <div className="px-3 py-2">
                    <p className="text-xs font-bold">{state.session?.name}</p>
                    <p className="wg-muted truncate text-[11px]">{state.session?.email}</p>
                  </div>
                  <div className="my-1 border-t" style={{ borderColor: 'var(--wg-border)' }} />
                  {role !== 'support' && <button className="wg-btn wg-btn-ghost w-full !justify-start" onClick={() => { setMenuOpen(false); navigate('/app/parametres'); }}><FiSliders size={15} /> Paramètres</button>}
                  <button className="wg-btn wg-btn-danger mt-1 w-full !justify-start" onClick={() => { signOut(); navigate('/'); }}><FiLogOut size={15} /> Se déconnecter</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
          {!state.station?.activated && role !== 'support' && location.pathname !== '/app/mise-en-route' && (
            <div className="wg-card mb-5 flex flex-wrap items-center justify-between gap-3 !border-amber-500/30 px-4 py-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-amber-400"><FiHelpCircle size={16} /></span>
                <span><strong>Mise en route en cours.</strong> {missing.length} étape(s) obligatoire(s) manquante(s) — l’exploitation reste fermée.</span>
              </div>
              <NavLink to="/app/mise-en-route" className="wg-link text-xs">Continuer →</NavLink>
            </div>
          )}
          {role === 'support' && location.pathname !== '/app/plateforme' ? (
            <Card className="flex items-start gap-3 border-red-500/30">
              <FiShield className="mt-0.5 text-xl text-red-400" />
              <div>
                <h2 className="text-sm font-bold">Espace réservé au support WashGuard</h2>
                <p className="wg-muted mt-1 text-xs">Ce compte n’est rattaché à aucune station. Seul l’espace plateforme est accessible.</p>
                <button className="wg-btn wg-btn-primary mt-3" onClick={() => navigate('/app/plateforme')}>Ouvrir l’espace plateforme</button>
              </div>
            </Card>
          ) : (
            <div className="wg-fade-in" key={location.pathname}><Outlet /></div>
          )}
        </main>
      </div>
    </div>
  );
}
