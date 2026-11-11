import React, { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import RoleGuard from './components/RoleGuard';
import { ToastHost } from './components/ui';
import { fetchMeOnce, useStore } from './lib/store';
import { getDefaultRedirectForRole } from './lib/rbac';

import Landing from './pages/Landing';
import SignIn from './pages/auth/SignIn';
import SignUp from './pages/auth/SignUp';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import Washes from './pages/Washes';
import Services from './pages/Services';
import Clients from './pages/Clients';
import Employees from './pages/Employees';
import Cash from './pages/Cash';
import Expenses from './pages/Expenses';
import Reports from './pages/Reports';
import Commissions from './pages/Commissions';
import Settings from './pages/Settings';
import Subscription from './pages/Subscription';
import Platform from './pages/Platform';

/** Un seul appel à /auth/me par visiteur, même sans cookie (voir store.tsx). */
function SessionGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchMeOnce().then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);
  if (!ready) return (
    <div className="grid min-h-screen place-items-center">
      <div className="flex flex-col items-center gap-3">
        <span className="wg-gradient h-10 w-10 animate-pulse rounded-xl" />
        <p className="wg-muted text-xs">Vérification de la session…</p>
      </div>
    </div>
  );
  return <>{children}</>;
}

function LandingRoute() {
  const { state } = useStore();
  if (state.session) {
    if (state.session.role === 'support') return <Navigate to="/app/plateforme" replace />;
    if (state.session.role === 'laveur') return <Navigate to="/app/lavages" replace />;
    if (!state.station?.activated) return <Navigate to="/app/mise-en-route" replace />;
    return <Navigate to="/app/tableau-de-bord" replace />;
  }
  return <Landing />;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { state } = useStore();
  if (state.session) {
    const dest = getDefaultRedirectForRole(state.session.role);
    return <Navigate to={dest} replace />;
  }
  return <>{children}</>;
}

function AppRoute({ children }: { children: React.ReactNode }) {
  const { state } = useStore();
  if (!state.session) return <Navigate to="/connexion" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <SessionGate>
      <ToastHost />
      <Routes>
        <Route path="/" element={<LandingRoute />} />
        <Route path="/connexion" element={<AuthRoute><SignIn /></AuthRoute>} />
        <Route path="/inscription" element={<AuthRoute><SignUp /></AuthRoute>} />
        <Route path="/auth/*" element={<Navigate to="/connexion" replace />} />
        <Route path="/app" element={<AppRoute><AppShell /></AppRoute>}>
          <Route index element={<Navigate to="tableau-de-bord" replace />} />
          
          <Route
            path="tableau-de-bord"
            element={
              <RoleGuard allowedRoles={['proprietaire', 'gerant', 'caissier']}>
                <Dashboard />
              </RoleGuard>
            }
          />
          <Route
            path="mise-en-route"
            element={
              <RoleGuard allowedRoles={['proprietaire', 'gerant']}>
                <Onboarding />
              </RoleGuard>
            }
          />
          <Route
            path="lavages"
            element={
              <RoleGuard allowedRoles={['proprietaire', 'gerant', 'caissier', 'laveur']}>
                <Washes />
              </RoleGuard>
            }
          />
          <Route
            path="prestations"
            element={
              <RoleGuard allowedRoles={['proprietaire', 'gerant']}>
                <Services />
              </RoleGuard>
            }
          />
          <Route
            path="clients"
            element={
              <RoleGuard allowedRoles={['proprietaire', 'gerant', 'caissier']}>
                <Clients />
              </RoleGuard>
            }
          />
          <Route
            path="employes"
            element={
              <RoleGuard allowedRoles={['proprietaire', 'gerant']}>
                <Employees />
              </RoleGuard>
            }
          />
          <Route
            path="caisse"
            element={
              <RoleGuard allowedRoles={['proprietaire', 'gerant', 'caissier']}>
                <Cash />
              </RoleGuard>
            }
          />
          <Route
            path="depenses"
            element={
              <RoleGuard allowedRoles={['proprietaire', 'gerant', 'caissier']}>
                <Expenses />
              </RoleGuard>
            }
          />
          <Route
            path="rapports"
            element={
              <RoleGuard allowedRoles={['proprietaire', 'gerant']}>
                <Reports />
              </RoleGuard>
            }
          />
          <Route
            path="commissions"
            element={
              <RoleGuard allowedRoles={['proprietaire', 'gerant']}>
                <Commissions />
              </RoleGuard>
            }
          />
          <Route
            path="parametres"
            element={
              <RoleGuard allowedRoles={['proprietaire', 'gerant']}>
                <Settings />
              </RoleGuard>
            }
          />
          <Route
            path="abonnement"
            element={
              <RoleGuard allowedRoles={['proprietaire']}>
                <Subscription />
              </RoleGuard>
            }
          />
          <Route
            path="plateforme"
            element={
              <RoleGuard allowedRoles={['support']}>
                <Platform />
              </RoleGuard>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionGate>
  );
}
