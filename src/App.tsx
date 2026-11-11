import React, { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import { ToastHost } from './components/ui';
import { fetchMeOnce, useStore } from './lib/store';

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
    if (!state.station?.activated) return <Navigate to="/app/mise-en-route" replace />;
    return <Navigate to="/app/tableau-de-bord" replace />;
  }
  return <Landing />;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { state } = useStore();
  if (state.session) return <Navigate to="/app/tableau-de-bord" replace />;
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
          <Route path="tableau-de-bord" element={<Dashboard />} />
          <Route path="mise-en-route" element={<Onboarding />} />
          <Route path="lavages" element={<Washes />} />
          <Route path="prestations" element={<Services />} />
          <Route path="clients" element={<Clients />} />
          <Route path="employes" element={<Employees />} />
          <Route path="caisse" element={<Cash />} />
          <Route path="depenses" element={<Expenses />} />
          <Route path="rapports" element={<Reports />} />
          <Route path="commissions" element={<Commissions />} />
          <Route path="parametres" element={<Settings />} />
          <Route path="abonnement" element={<Subscription />} />
          <Route path="plateforme" element={<Platform />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionGate>
  );
}
