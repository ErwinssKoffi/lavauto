import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  FiActivity, FiBarChart2, FiBox, FiChevronLeft, FiChevronRight,
  FiCreditCard, FiDollarSign, FiFileText, FiGrid, FiHelpCircle,
  FiList, FiLogOut, FiMenu, FiMoon, FiPieChart, FiSearch,
  FiSettings, FiShield, FiSliders, FiSun, FiTruck, FiUsers, FiX,
} from 'react-icons/fi';
import { useStore } from '../lib/store';
import { Badge, Card, Logo } from './ui';
import CommandPalette from './CommandPalette';
import StationSwitcher from './StationSwitcher';
import type { Role } from '../types';
import { ROLE_LABELS } from '../types';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  roles: Role[];
  badge?: (s: any) => React.ReactNode;
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Pilotage',
    items: [
      {
        to: '/app/tableau-de-bord',
        label: 'Tableau de bord',
        icon: <FiGrid size={17} />,
        roles: ['proprietaire', 'gerant', 'caissier'],
      },
      {
        to: '/app/mise-en-route',
        label: 'Mise en route',
        icon: <FiList size={17} />,
        roles: ['proprietaire', 'gerant'],
      },
    ],
  },
  {
    group: 'Exploitation',
    items: [
      {
        to: '/app/lavages',
        label: 'Lavages & File',
        icon: <FiTruck size={17} />,
        roles: ['proprietaire', 'gerant', 'caissier', 'laveur'],
      },
      {
        to: '/app/prestations',
        label: 'Prestations & Tarifs',
        icon: <FiBox size={17} />,
        roles: ['proprietaire', 'gerant'],
      },
    ],
  },
  {
    group: 'Commercial',
    items: [
      {
        to: '/app/clients',
        label: 'Clients & Véhicules',
        icon: <FiUsers size={17} />,
        roles: ['proprietaire', 'gerant', 'caissier'],
      },
    ],
  },
  {
    group: 'Ressources humaines',
    items: [
      {
        to: '/app/employes',
        label: 'Équipe & Employés',
        icon: <FiUsers size={17} />,
        roles: ['proprietaire', 'gerant'],
      },
      {
        to: '/app/commissions',
        label: 'Commissions laveurs',
        icon: <FiPieChart size={17} />,
        roles: ['proprietaire', 'gerant'],
      },
    ],
  },
  {
    group: 'Gestion financière',
    items: [
      {
        to: '/app/caisse',
        label: 'Caisse & Sessions',
        icon: <FiDollarSign size={17} />,
        roles: ['proprietaire', 'gerant', 'caissier'],
      },
      {
        to: '/app/depenses',
        label: 'Dépenses',
        icon: <FiCreditCard size={17} />,
        roles: ['proprietaire', 'gerant', 'caissier'],
      },
      {
        to: '/app/rapports',
        label: 'Rapports d’activité',
        icon: <FiBarChart2 size={17} />,
        roles: ['proprietaire', 'gerant'],
      },
    ],
  },
  {
    group: 'Administration',
    items: [
      {
        to: '/app/parametres',
        label: 'Paramètres station',
        icon: <FiSettings size={17} />,
        roles: ['proprietaire', 'gerant'],
      },
      {
        to: '/app/abonnement',
        label: 'Abonnement SaaS',
        icon: <FiFileText size={17} />,
        roles: ['proprietaire'],
      },
      {
        to: '/app/plateforme',
        label: 'Espace plateforme',
        icon: <FiShield size={17} />,
        roles: ['support'],
      },
    ],
  },
];

export default function AppShell() {
  const { state, theme, toggleTheme, signOut, missing, switchRoleDemo } = useStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('washguard.sidebar.collapsed') === 'true';
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('washguard.sidebar.collapsed', String(next));
      return next;
    });
  };

  const location = useLocation();
  const navigate = useNavigate();
  const role = state.session?.role ?? 'caissier';
  const stationName = state.station?.name ?? 'Ma station';

  const current =
    [...NAV.flatMap((g) => g.items)].find((i) => i.to === location.pathname)?.label ??
    'Espace station';

  const sidebarContent = (isMobile = false) => (
    <div
      className="flex h-full flex-col transition-all duration-300"
      style={{ background: 'var(--wg-surface)' }}
    >
      {/* Brand & Toggle header */}
      <div
        className={`flex h-16 shrink-0 items-center border-b px-4 transition-all ${
          collapsed && !isMobile ? 'justify-center' : 'justify-between'
        }`}
        style={{ borderColor: 'var(--wg-border)' }}
      >
        <NavLink to="/" className="flex items-center overflow-hidden">
          <Logo compact={collapsed && !isMobile} />
        </NavLink>

        {isMobile ? (
          <button
            className="wg-muted hover:text-white p-1 rounded-lg"
            onClick={() => setMobileOpen(false)}
            aria-label="Fermer le menu"
          >
            <FiX size={20} />
          </button>
        ) : (
          <button
            onClick={toggleCollapsed}
            className="wg-btn wg-btn-ghost !p-1.5 text-slate-400 hover:text-white"
            title={collapsed ? 'Déplier la barre latérale' : 'Replier la barre latérale'}
            aria-label="Toggle sidebar"
          >
            {collapsed ? <FiChevronRight size={14} /> : <FiChevronLeft size={14} />}
          </button>
        )}
      </div>

      {/* Navigation items list */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
        {NAV.map((group) => {
          const items = group.items.filter((i) => i.roles.includes(role));
          if (!items.length) return null;
          return (
            <div key={group.group}>
              {(!collapsed || isMobile) && (
                <p className="wg-muted mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[.14em]">
                  {group.group}
                </p>
              )}
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => isMobile && setMobileOpen(false)}
                    title={collapsed && !isMobile ? item.label : undefined}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition ${
                        isActive
                          ? 'wg-btn-primary shadow-md shadow-sky-500/20'
                          : 'wg-muted hover:bg-sky-500/10 hover:text-sky-400'
                      } ${collapsed && !isMobile ? 'justify-center !px-2' : ''}`
                    }
                  >
                    <span className="shrink-0">{item.icon}</span>
                    {(!collapsed || isMobile) && (
                      <>
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.to === '/app/mise-en-route' &&
                          !state.station?.activated &&
                          missing.length > 0 && (
                            <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                              {missing.length}
                            </span>
                          )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Station footprint card */}
      <div className="shrink-0 border-t p-3" style={{ borderColor: 'var(--wg-border)' }}>
        {collapsed && !isMobile ? (
          <div
            className="flex justify-center p-2 rounded-xl"
            style={{ background: 'var(--wg-surface-2)' }}
            title={`${stationName} (${state.station?.activated ? 'Active' : 'Mise en route'})`}
          >
            <span
              className={`wg-status-dot ${
                state.station?.activated ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
            />
          </div>
        ) : (
          <div className="rounded-xl p-3 border" style={{ background: 'var(--wg-surface-2)', borderColor: 'var(--wg-border)' }}>
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg wg-gradient text-white">
                <FiActivity size={15} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-bold">{stationName}</p>
                <p className="wg-muted truncate text-[11px]">
                  {state.station?.activated ? 'Station active' : 'Mise en route en cours'}
                </p>
              </div>
            </div>
            {state.demoMode && (
              <p className="wg-muted mt-2 text-[10px] leading-snug">
                Mode démo locale : données conservées dans le navigateur.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Command Palette Modal */}
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />

      {/* Sidebar desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden border-r transition-all duration-300 lg:block ${
          collapsed ? 'w-20' : 'w-64'
        }`}
        style={{ borderColor: 'var(--wg-border)' }}
      >
        {sidebarContent(false)}
      </aside>

      {/* Sidebar mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside
            className="absolute inset-y-0 left-0 w-[270px] border-r shadow-2xl"
            style={{ borderColor: 'var(--wg-border)' }}
          >
            {sidebarContent(true)}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className={`transition-all duration-300 ${collapsed ? 'lg:pl-20' : 'lg:pl-64'}`}>
        {/* Topbar */}
        <header
          className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b px-4 backdrop-blur-xl sm:px-6"
          style={{
            borderColor: 'var(--wg-border)',
            background: 'color-mix(in srgb, var(--wg-bg) 88%, transparent)',
          }}
        >
          {/* Left section: mobile hamburger, station switcher, and current page */}
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="wg-muted lg:hidden p-1.5 rounded-lg hover:text-white"
              onClick={() => setMobileOpen(true)}
              aria-label="Ouvrir le menu"
            >
              <FiMenu size={20} />
            </button>

            {/* Station Switcher */}
            {role !== 'support' && <StationSwitcher />}

            <div className="hidden min-w-0 md:block pl-2 border-l" style={{ borderColor: 'var(--wg-border)' }}>
              <p className="truncate text-xs font-semibold text-slate-300">{current}</p>
            </div>
          </div>

          {/* Right section: Quick search, Theme toggle, Support FAQ, User Profile */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Quick Search Button / Command palette trigger */}
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 border transition hover:border-sky-500/40"
              style={{ background: 'var(--wg-surface-2)', borderColor: 'var(--wg-border)' }}
              title="Recherche globale (Ctrl + K)"
            >
              <FiSearch size={14} className="text-sky-400" />
              <span className="hidden sm:inline">Recherche...</span>
              <kbd className="hidden md:inline rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
                Ctrl K
              </kbd>
            </button>

            {state.demoMode && (
              <span className="hidden xl:inline-flex">
                <Badge tone="accent">Démo locale</Badge>
              </span>
            )}

            {/* Theme Switcher */}
            <button
              onClick={toggleTheme}
              className="wg-btn wg-btn-ghost !p-2"
              aria-label="Changer de thème"
              title={theme === 'dark' ? 'Activer le mode clair' : 'Activer le mode sombre'}
            >
              {theme === 'dark' ? <FiSun size={15} /> : <FiMoon size={15} />}
            </button>

            {/* User Profile Menu */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 rounded-xl p-1.5 hover:bg-sky-500/10 transition"
                aria-label="Menu profil"
              >
                <span className="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold text-white wg-gradient shadow-sm">
                  {(state.session?.name ?? '?')
                    .split(' ')
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </span>
                <div className="hidden text-left sm:block">
                  <p className="text-xs font-bold leading-tight">{state.session?.name}</p>
                  <p className="wg-muted text-[10px] leading-tight">{ROLE_LABELS[role]}</p>
                </div>
              </button>

              {menuOpen && (
                <div
                  className="wg-card wg-fade-in absolute right-0 top-12 z-50 w-60 p-2 shadow-2xl border"
                  style={{ background: 'var(--wg-surface)', borderColor: 'var(--wg-border)' }}
                >
                  <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--wg-border)' }}>
                    <p className="text-xs font-bold text-slate-200">{state.session?.name}</p>
                    <p className="wg-muted truncate text-[11px]">{state.session?.email}</p>
                    <div className="mt-1">
                      <Badge tone="accent">{ROLE_LABELS[role]}</Badge>
                    </div>
                  </div>

                  {/* RBAC Quick Switcher for Demo / Testing */}
                  <div className="p-2 border-b space-y-1" style={{ borderColor: 'var(--wg-border)' }}>
                    <p className="text-[10px] uppercase font-bold tracking-wider wg-muted">
                      Rôle actif (Test RBAC) :
                    </p>
                    <div className="grid grid-cols-2 gap-1 text-[11px]">
                      {(['proprietaire', 'gerant', 'caissier', 'laveur', 'support'] as Role[]).map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => {
                            switchRoleDemo(r);
                            setMenuOpen(false);
                            if (r === 'support') navigate('/app/plateforme');
                            else if (r === 'laveur') navigate('/app/lavages');
                            else navigate('/app/tableau-de-bord');
                          }}
                          className={`rounded px-1.5 py-1 font-medium transition text-left truncate ${
                            role === r
                              ? 'bg-sky-500 text-white font-bold'
                              : 'hover:bg-sky-500/10 text-slate-300'
                          }`}
                        >
                          {ROLE_LABELS[r]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-1 space-y-0.5">
                    {role !== 'support' && (
                      <button
                        className="wg-btn wg-btn-ghost w-full !justify-start !text-xs !py-1.5"
                        onClick={() => {
                          setMenuOpen(false);
                          navigate('/app/parametres');
                        }}
                      >
                        <FiSliders size={14} className="text-sky-400" /> Paramètres station
                      </button>
                    )}
                    <button
                      className="wg-btn wg-btn-danger mt-1 w-full !justify-start !text-xs !py-1.5"
                      onClick={() => {
                        signOut();
                        navigate('/');
                      }}
                    >
                      <FiLogOut size={14} /> Se déconnecter
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Content body */}
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
          {/* Missing onboarding banner */}
          {!state.station?.activated &&
            role !== 'support' &&
            location.pathname !== '/app/mise-en-route' && (
              <div
                className="wg-card mb-5 flex flex-wrap items-center justify-between gap-3 border px-4 py-3"
                style={{ borderColor: 'rgba(245, 158, 11, 0.4)', background: 'var(--wg-surface)' }}
              >
                <div className="flex items-center gap-2.5 text-xs">
                  <span className="text-amber-400">
                    <FiHelpCircle size={17} />
                  </span>
                  <span>
                    <strong>Mise en route en cours.</strong> {missing.length} étape(s) obligatoire(s)
                    manquante(s) — l’exploitation reste fermée.
                  </span>
                </div>
                <NavLink to="/app/mise-en-route" className="wg-link text-xs">
                  Continuer la configuration →
                </NavLink>
              </div>
            )}

          {/* Support role guard */}
          {role === 'support' && location.pathname !== '/app/plateforme' ? (
            <Card className="flex items-start gap-3 border-red-500/30">
              <FiShield className="mt-0.5 text-xl text-red-400" />
              <div>
                <h2 className="text-sm font-bold">Espace réservé au support WashGuard</h2>
                <p className="wg-muted mt-1 text-xs">
                  Ce compte n’est rattaché à aucune station. Seul l’espace plateforme est accessible.
                </p>
                <button
                  className="wg-btn wg-btn-primary mt-3"
                  onClick={() => navigate('/app/plateforme')}
                >
                  Ouvrir l’espace plateforme
                </button>
              </div>
            </Card>
          ) : (
            <div className="wg-fade-in" key={location.pathname}>
              <Outlet />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
