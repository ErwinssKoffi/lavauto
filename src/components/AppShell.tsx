import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  FiChevronDown, FiChevronLeft, FiChevronRight, FiHelpCircle, FiLogOut,
  FiMenu, FiMoon, FiSearch, FiShield, FiSliders, FiSun, FiX, FiActivity,
  FiBell,
} from 'react-icons/fi';
import { useStore } from '../lib/store';
import { Badge, Card, Logo } from './ui';
import { Breadcrumbs, type Crumb } from './Breadcrumbs';
import { CommandPalette } from './CommandPalette';
import { findEntry, groupsForRole } from './navigation';
import { ROLE_LABELS, type Role } from '../types';
import { usePermissions } from '../lib/usePermissions';
import StockAlertBanner from './StockAlertBanner';
import { AccountSecurity } from './AccountSecurity';
import { PWAInstallButton } from './PwaControls';

const SIDEBAR_KEY = 'washguard.sidebar.collapsed';

export default function AppShell() {
  const { state, identity, selectStation, theme, toggleTheme, signOut, missing, dataSource, authKind,
    subscriptionAccess, subscriptionStatus, subscriptionError, canWriteSubscription, refreshSubscriptionAccess } = useStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [closedGroups, setClosedGroups] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { return false; }
  });
  const location = useLocation();
  const navigate = useNavigate();
  const { role: identityRole, permissions, can } = usePermissions();
  const role: Role = identityRole ?? state.session?.role ?? 'caissier';
  const stationName = state.station?.name ?? 'Ma station';
  const groups = groupsForRole(role, permissions);
  const found = findEntry(location.pathname);
  const current = found?.entry.label ?? 'Espace station';
  const crumbs: Crumb[] = [{ label: 'Espace station' }];
  if (found) crumbs.push({ label: found.group.label }, { label: found.entry.label });

  const toggleCollapse = () => {
    setCollapsed((value) => {
      try { localStorage.setItem(SIDEBAR_KEY, value ? '0' : '1'); } catch { /* stockage indisponible */ }
      return !value;
    });
  };

  const toggleGroup = (id: string) => {
    setClosedGroups((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  };

  // Raccourci global Ctrl/Cmd + K : la recherche fonctionne même palette fermée.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const sidebar = (
    <div className="flex h-full flex-col bg-base-100">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-base-300 px-4">
        <NavLink to="/" aria-label="Accueil WashGuard" className={collapsed ? 'mx-auto' : ''}>
          <Logo compact={collapsed} />
        </NavLink>
        <button type="button" className="text-base-content/60 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Fermer le menu"><FiX size={20} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-4 [scrollbar-width:thin]">
        {groups.map((group) => {
          const isClosed = closedGroups.includes(group.id);
          return (
            <div key={group.id} className="mb-3">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.13em] text-base-content/60 transition hover:bg-primary/10 hover:text-base-content"
                aria-expanded={!isClosed}
                aria-controls={`nav-group-${group.id}`}
                title={collapsed ? group.label : undefined}
              >
                <span className="text-sm" aria-hidden="true">{group.icon}</span>
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">{group.label}</span>
                    <FiChevronDown size={12} className={`transition-transform ${isClosed ? '-rotate-90' : ''}`} aria-hidden="true" />
                  </>
                )}
              </button>
              {!isClosed && (
                <div id={`nav-group-${group.id}`} className="mt-1 space-y-0.5">
                  {group.entries.map((entry) => {
                    if (entry.upcoming || !entry.to) {
                      return (
                        <span
                          key={entry.label}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium leading-snug text-base-content/60 opacity-60 cursor-not-allowed"
                          aria-disabled="true"
                          title={entry.upcoming?.hint}
                        >
                          <span className="text-base" aria-hidden="true">{entry.icon}</span>
                          {!collapsed && (
                            <>
                              <span className="flex-1">{entry.label}</span>
                              <Badge>Étape {entry.upcoming?.step}</Badge>
                            </>
                          )}
                        </span>
                      );
                    }
                    return (
                      <NavLink
                        key={entry.to}
                        to={entry.to}
                        onClick={() => setMobileOpen(false)}
                        aria-label={collapsed ? entry.label : undefined}
                        title={collapsed ? entry.label : undefined}
                        className={({ isActive }) => `flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium leading-snug no-underline transition hover:bg-primary/10 hover:text-base-content ${isActive ? 'bg-primary font-semibold text-primary-content shadow-lg shadow-sky-500/20' : 'text-base-content/60'}`}
                      >
                        <span className="text-base" aria-hidden="true">{entry.icon}</span>
                        {!collapsed && (
                          <>
                            <span className="flex-1">{entry.label}</span>
                            {entry.to === '/app/mise-en-route' && !state.station?.activated && missing.length > 0 && (
                              <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">{missing.length}</span>
                            )}
                          </>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-base-300 p-2">
        <div className="rounded-xl bg-base-200 p-2">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-linear-to-br from-sky-600 via-sky-500 to-cyan-400 text-white" aria-hidden="true"><FiActivity size={15} /></span>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-xs font-bold">{stationName}</p>
                <p className="truncate text-[11px] text-base-content/60">{state.station?.activated ? 'Station active' : 'Mise en route en cours'}</p>
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={toggleCollapse}
          className="btn btn-sm mt-2 hidden w-full justify-center! lg:inline-flex"
          aria-label={collapsed ? 'Déplier la navigation' : 'Replier la navigation'}
          title={collapsed ? 'Déplier la navigation' : 'Replier la navigation'}
        >
          {collapsed ? <FiChevronRight size={16} /> : <FiChevronLeft size={16} />}
          {!collapsed && <span className="text-xs">Replier</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Sidebar desktop — largeur repliable, persistée */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden border-r border-base-300 transition-[width] duration-200 lg:block ${collapsed ? 'lg:w-[76px]' : 'lg:w-64'}`}
      >
        {sidebar}
      </aside>
      {/* Sidebar mobile — drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[270px] border-r border-base-300 shadow-2xl">{sidebar}</aside>
        </div>
      )}

      <div className={`transition-[padding] duration-200 ${collapsed ? 'lg:pl-[76px]' : 'lg:pl-64'}`}>
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-base-300 bg-base-100/90 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" className="text-base-content/60 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu"><FiMenu size={20} /></button>
            <div className="min-w-0">
              <Breadcrumbs items={crumbs} />
              <p className="truncate text-sm font-bold sm:hidden">{current}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {identity && identity.stations.length > 1 && state.session?.stationId && (
              <label className="flex min-w-0 items-center gap-2 text-xs">
                <span className="hidden text-base-content/60 xl:inline">Station</span>
                <select aria-label="Station active" className="select select-sm w-auto! max-w-[10rem] sm:max-w-[14rem]"
                  value={state.session.stationId} onChange={(event) => selectStation(event.target.value)}>
                  {identity.stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
                </select>
              </label>
            )}
            <button type="button" onClick={() => setPaletteOpen(true)} className="btn btn-sm" aria-label="Rechercher un écran" title="Recherche rapide (Ctrl + K)">
              <FiSearch size={16} />
              <kbd className="hidden xl:inline-flex">Ctrl K</kbd>
            </button>
            <PWAInstallButton compact />
            <button type="button" onClick={toggleTheme} className="btn btn-sm px-2.5!" aria-label="Changer de thème" title="Thème clair / sombre">
              {theme === 'dark' ? <FiSun size={16} /> : <FiMoon size={16} />}
            </button>
            <a href="/#faq" className="btn btn-sm px-2.5!" title="Questions fréquentes" aria-label="Questions fréquentes"><FiHelpCircle size={16} /></a>

            {/* Cloche d'alertes stock en temps réel */}
            {can('inventory.view') && <div className="relative">
              <button
                type="button"
                onClick={() => setAlertsOpen((v) => !v)}
                className={`btn btn-sm px-2.5! relative ${state.stockAlerts.length > 0 ? 'text-amber-400!' : ''}`}
                aria-label="Alertes stock"
                title={state.stockAlerts.length > 0 ? `${state.stockAlerts.length} produit(s) sous le seuil critique` : 'Stock normal'}
              >
                <FiBell size={16} />
                {state.stockAlerts.length > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-black text-white animate-pulse">
                    {state.stockAlerts.length}
                  </span>
                )}
              </button>
              {alertsOpen && (
                <div className="card absolute right-0 top-12 z-50 w-72 bg-base-100 p-3 shadow-xl sm:w-80">
                  <div className="flex items-center justify-between border-b border-base-300 pb-2">
                    <div className="flex items-center gap-1.5 font-bold text-xs text-white">
                      <FiBell className="text-amber-400" />
                      <span>Alertes Stock en direct</span>
                    </div>
                    <Badge tone={state.stockAlerts.length > 0 ? 'warn' : 'success'}>
                      {state.stockAlerts.length > 0 ? `${state.stockAlerts.length} critique(s)` : 'Normal'}
                    </Badge>
                  </div>
                  <div className="my-2 max-h-60 overflow-y-auto space-y-2 text-xs">
                    {state.stockAlerts.length === 0 ? (
                      <p className="py-3 text-center text-xs text-base-content/60">Tous les produits sont au-dessus de leur seuil d'alerte.</p>
                    ) : (
                      state.stockAlerts.map((a) => (
                        <div key={a.productId} className="rounded-lg bg-base-200 p-2">
                          <div className="flex items-center justify-between font-bold">
                            <span className="truncate">{a.name}</span>
                            <span className={a.severity === 'rupture' ? 'text-red-400' : 'text-amber-400'}>
                              {a.severity === 'rupture' ? 'RUPTURE' : `${a.qtyOnHand} restant(s)`}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-base-content/60">Seuil critique : {a.reorderLevel}</p>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex justify-between border-t border-base-300 pt-2 text-xs">
                    <button
                      type="button"
                      className="link link-primary text-[11px]"
                      onClick={() => { setAlertsOpen(false); navigate('/app/parametres#stock'); }}
                    >
                      Voir les seuils
                    </button>
                    <button
                      type="button"
                      className="link link-primary text-[11px] font-bold"
                      onClick={() => { setAlertsOpen(false); navigate('/app/stock'); }}
                    >
                      Gérer le stock →
                    </button>
                  </div>
                </div>
              )}
            </div>}

            <div className="relative">
              <button type="button" onClick={() => setMenuOpen((value) => !value)} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-sky-500/10" aria-expanded={menuOpen} aria-label="Menu du compte">
                <span className="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold text-white bg-linear-to-br from-sky-600 via-sky-500 to-cyan-400">
                  {(state.session?.name ?? '?').split(' ').map((word) => word[0]).slice(0, 2).join('').toUpperCase()}
                </span>
                <div className="hidden text-left sm:block">
                  <p className="text-xs font-bold leading-tight">{state.session?.name}</p>
                  <p className="text-[10px] leading-tight text-base-content/60">{ROLE_LABELS[role]}</p>
                </div>
              </button>
              {menuOpen && (
                <div className="card absolute right-0 top-12 z-50 w-56 bg-base-100 p-2 shadow-xl">
                  <div className="px-3 py-2">
                    <p className="text-xs font-bold">{state.session?.name}</p>
                    <p className="truncate text-[11px] text-base-content/60">{state.session?.email}</p>
                  </div>
                  <div className="my-1 border-t border-base-300" />
                  <button type="button" className="btn btn-sm w-full justify-start!" onClick={() => { setMenuOpen(false); setSecurityOpen(true); }}><FiShield size={15} /> Sécurité du compte</button>
                  {(role === 'proprietaire' || role === 'gerant') && (
                    <button type="button" className="btn btn-sm w-full justify-start!" onClick={() => { setMenuOpen(false); navigate('/app/parametres'); }}><FiSliders size={15} /> Paramètres</button>
                  )}
                  <button type="button" className="btn btn-sm btn-error btn-outline mt-1 w-full justify-start!" onClick={() => { void signOut().then(() => navigate('/')); }}><FiLogOut size={15} /> Se déconnecter</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
          {can('inventory.view') && <StockAlertBanner key={`${state.session?.userId}:${state.session?.stationId}`} />}
          {role !== 'super_admin' && subscriptionStatus === 'loading' && <div role="status" className="card mb-5 bg-base-100 px-4 py-3 text-xs shadow-xl">Vérification de l’abonnement ; les écritures ordinaires sont momentanément bloquées.</div>}
          {role !== 'super_admin' && subscriptionStatus !== 'loading' && !canWriteSubscription && <div role="status" className="card mb-5 flex flex-row flex-wrap items-center justify-between gap-3 bg-base-100 px-4 py-3 text-xs shadow-xl border-amber-500/40!">
            <span><strong>{subscriptionAccess ? 'Abonnement en lecture seule.' : 'Abonnement non confirmé.'}</strong>{' '}
              {subscriptionAccess ? 'Les données restent consultables ; les écritures ordinaires sont bloquées jusqu’à validation. Après expiration, un retrait WhatsApp peut être demandé sous réserve des droits.' : `Les écritures ordinaires sont bloquées. ${subscriptionError ?? ''}`}</span>
            <span className="flex gap-3">{can('subscription.manage') && <NavLink to="/app/abonnement" className="link link-primary">Voir l’abonnement →</NavLink>}
              {((dataSource === 'supabase' && authKind === 'supabase') || (dataSource === 'api' && authKind === 'api')) && <button className="link link-primary" onClick={() => { void refreshSubscriptionAccess().catch(() => undefined); }}>Relire</button>}</span>
          </div>}
          {!state.station?.activated && role !== 'super_admin' && location.pathname !== '/app/mise-en-route' && (
            <div className="card mb-5 flex flex-row flex-wrap items-center justify-between gap-3 bg-base-100 px-4 py-3 shadow-xl border-amber-500/30!">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-amber-400"><FiHelpCircle size={16} /></span>
                <span><strong>Mise en route en cours.</strong> {missing.length} étape(s) obligatoire(s) manquante(s) — l’exploitation reste fermée.</span>
              </div>
              <NavLink to="/app/mise-en-route" className="link link-primary text-xs">Continuer →</NavLink>
            </div>
          )}
          {role === 'super_admin' && location.pathname !== '/app/plateforme' ? (
            <Card className="flex flex-row items-start gap-3 border-red-500/30">
              <FiShield className="mt-0.5 text-xl text-red-400" />
              <div>
                <h2 className="text-sm font-bold">Espace réservé au support WashGuard</h2>
                <p className="mt-1 text-xs text-base-content/60">Ce compte n’est rattaché à aucune station. Seul l’espace plateforme est accessible.</p>
                <button className="btn btn-sm btn-primary mt-3" onClick={() => navigate('/app/plateforme')}>Ouvrir l’espace plateforme</button>
              </div>
            </Card>
          ) : (
            <div className="animate-fade-in" key={`${state.session?.userId}:${state.session?.companyId}:${state.session?.stationId}:${location.pathname}`}><Outlet /></div>
          )}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} role={role} permissions={permissions} />
      <AccountSecurity open={securityOpen} onClose={() => setSecurityOpen(false)} />
    </div>
  );
}
