import React from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { FiLock } from 'react-icons/fi';
import AppShell from './components/AppShell';
import { Alert, Badge, Card, ToastHost } from './components/ui';
import { useStore } from './lib/store';
import { usePermissions } from './lib/usePermissions';
import { permissionForRoles } from './lib/permissionCatalog';
import { permissionFeature } from './lib/subscription';
import { LoadingState } from './components/feedback';
import { ROLE_LABELS, type Role } from './types';
import { OfflineIndicator } from './components/PwaControls';

import Landing from './pages/Landing';
import SignIn from './pages/auth/SignIn';
import SignUp from './pages/auth/SignUp';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import ConfirmEmail from './pages/auth/ConfirmEmail';
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

// P10 : les écrans lourds sont chargés à la demande. Le harnais JSDOM
// résout ces imports avant les assertions ; aucun écran n'est supprimé.
const Consolidation = React.lazy(() => import('./pages/Consolidation'));
const Stock = React.lazy(() => import('./pages/Stock'));
const Consumptions = React.lazy(() => import('./pages/Consumptions'));
const Fidelisation = React.lazy(() => import('./pages/Fidelisation'));
const Flottes = React.lazy(() => import('./pages/Flottes'));
const Platform = React.lazy(() => import('./pages/Platform'));
const Quality = React.lazy(() => import('./pages/Quality'));

const STAFF: Role[] = ['proprietaire', 'gerant', 'caissier', 'laveur'];
const MANAGERS: Role[] = ['proprietaire', 'gerant'];
const OWNER: Role[] = ['proprietaire'];
const PLATFORM: Role[] = ['super_admin'];

/** L'état Auth est alimenté par `onAuthStateChange` dans StoreProvider : aucun
 *  fetchMeOnce(), aucun 401 en boucle, aucune session lue en localStorage. */
function SessionGate({ children }: { children: React.ReactNode }) {
  const { authReady, authError } = useStore();
  if (!authReady) return <LoadingState label="Vérification de la session…" />;
  return (
    <>
      {authError && (
        <div className="fixed left-1/2 top-3 z-[120] w-[min(92vw,34rem)] -translate-x-1/2">
          <Alert kind="warn">{authError}</Alert>
        </div>
      )}
      {children}
    </>
  );
}

/** Garde de CONFORT : une URL saisie directement n'affiche pas un écran dont
 *  la permission serveur est absente. La sécurité est assurée par la RLS et
 *  les fonctions SECURITY DEFINER, jamais par ce composant. */
function RoleRoute({
  roles, permission, children,
}: { roles: Role[]; permission?: string; children: React.ReactNode }) {
  const { state, subscriptionStatus, subscriptionAccess } = useStore();
  const { role, can } = usePermissions();
  const required = permission ?? permissionForRoles(roles);
  const feature = permissionFeature(required);
  if (feature && subscriptionStatus === 'loading') return <LoadingState label="Vérification de la formule…" />;
  if (feature && subscriptionAccess && !subscriptionAccess.features[feature] && state.session) return (
    <Card className="flex flex-row items-start gap-3 border-warning/30"><FiLock className="mt-0.5 text-xl text-warning" />
      <div><h2 className="text-sm font-bold">Module non inclus dans la formule active</h2>
        <p className="text-base-content/60 mt-1 text-xs">Les données existantes sont conservées. Une demande de formule ne change les droits qu’après validation administrateur.</p>
        {can('subscription.manage') && <Link className="link link-primary mt-3 inline-block text-xs" to="/app/abonnement">Comparer les formules →</Link>}
      </div>
    </Card>
  );
  if (!state.session || !can(required)) {
    return (
      <Card className="flex flex-row items-start gap-3 border-error/30">
        <FiLock className="mt-0.5 text-xl text-error" />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold">Accès refusé</h2>
            <Badge tone="danger">Permission insuffisante</Badge>
          </div>
          <p className="text-base-content/60 mt-1 text-xs leading-relaxed">
            Cet écran demande la permission « {required} » (rôles : {roles.map((r) => ROLE_LABELS[r]).join(', ')}).
            Votre compte est « {role ? ROLE_LABELS[role] : 'non connecté'} ».
          </p>
        </div>
      </Card>
    );
  }
  return <>{children}</>;
}

/** Les écrans qui éditent ou utilisent le catalogue attendent sa lecture serveur. */
function StationSetupGate({ children }: { children: React.ReactNode }) {
  const { setupStatus, setupError, refreshSetup } = useStore();
  if (setupStatus === 'loading') return <LoadingState label="Lecture des réglages de la station…" />;
  if (setupStatus === 'error') return (
    <Card>
      <Alert kind="warn">Réglages indisponibles : {setupError ?? 'lecture non confirmée'}. Aucune modification locale de remplacement n’est appliquée.</Alert>
      <button className="btn btn-sm btn-primary mt-4" onClick={() => { void refreshSetup().catch(() => undefined); }}>Relire et vérifier la station</button>
    </Card>
  );
  return <>{children}</>;
}

function LandingRoute() {
  const { state } = useStore();
  if (state.session) {
    if (state.session.role === 'super_admin') return <Navigate to="/app/plateforme" replace />;
    if (!state.station?.activated) return <Navigate to="/app/mise-en-route" replace />;
    return <Navigate to="/app/tableau-de-bord" replace />;
  }
  return <Landing />;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { state } = useStore();
  if (state.session) {
    const destination = state.session.role === 'super_admin' ? '/app/plateforme'
      : state.station?.activated ? '/app/tableau-de-bord' : '/app/mise-en-route';
    return <Navigate to={destination} replace />;
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
      <OfflineIndicator />
      <React.Suspense fallback={<LoadingState label="Chargement de l’écran…" />}>
      <Routes>
        <Route path="/" element={<LandingRoute />} />
        <Route path="/connexion" element={<AuthRoute><SignIn /></AuthRoute>} />
        <Route path="/inscription" element={<AuthRoute><SignUp /></AuthRoute>} />
        <Route path="/mot-de-passe-oublie" element={<AuthRoute><ForgotPassword /></AuthRoute>} />
        <Route path="/reinitialiser-mot-de-passe" element={<ResetPassword />} />
        <Route path="/confirmer-email" element={<ConfirmEmail />} />
        <Route path="/auth/*" element={<Navigate to="/connexion" replace />} />
        <Route path="/app" element={<AppRoute><AppShell /></AppRoute>}>
          <Route index element={<Navigate to="tableau-de-bord" replace />} />
          <Route path="tableau-de-bord" element={<RoleRoute roles={STAFF} permission="washes.view"><Dashboard /></RoleRoute>} />
          <Route path="mise-en-route" element={<RoleRoute roles={MANAGERS} permission="settings.manage"><StationSetupGate><Onboarding /></StationSetupGate></RoleRoute>} />
          <Route path="lavages" element={<RoleRoute roles={STAFF} permission="washes.view"><StationSetupGate><Washes /></StationSetupGate></RoleRoute>} />
          <Route path="prestations" element={<RoleRoute roles={MANAGERS} permission="catalog.manage"><StationSetupGate><Services /></StationSetupGate></RoleRoute>} />
          <Route path="clients" element={<RoleRoute roles={STAFF} permission="customers.view"><Clients /></RoleRoute>} />
          <Route path="employes" element={<RoleRoute roles={MANAGERS} permission="employees.manage"><Employees /></RoleRoute>} />
          <Route path="caisse" element={<RoleRoute roles={STAFF} permission="cash.open"><Cash /></RoleRoute>} />
          <Route path="depenses" element={<RoleRoute roles={STAFF} permission="expenses.create"><StationSetupGate><Expenses /></StationSetupGate></RoleRoute>} />
          <Route path="rapports" element={<RoleRoute roles={MANAGERS} permission="reports.view"><Reports /></RoleRoute>} />
          <Route path="consolidation" element={<RoleRoute roles={MANAGERS} permission="analytics.view"><Consolidation /></RoleRoute>} />
          <Route path="commissions" element={<RoleRoute roles={MANAGERS} permission="commissions.view"><Commissions /></RoleRoute>} />
          <Route path="stock" element={<RoleRoute roles={MANAGERS} permission="inventory.view"><Stock /></RoleRoute>} />
          <Route path="consommations" element={<RoleRoute roles={MANAGERS} permission="inventory.consume"><Consumptions /></RoleRoute>} />
          <Route path="fidelisation" element={<RoleRoute roles={STAFF} permission="crm.view"><Fidelisation /></RoleRoute>} />
          <Route path="flottes" element={<RoleRoute roles={STAFF} permission="fleets.view"><Flottes /></RoleRoute>} />
          <Route path="parametres" element={<RoleRoute roles={MANAGERS} permission="settings.manage"><StationSetupGate><Settings /></StationSetupGate></RoleRoute>} />
          <Route path="abonnement" element={<RoleRoute roles={OWNER} permission="subscription.manage"><Subscription /></RoleRoute>} />
          <Route path="plateforme" element={<RoleRoute roles={PLATFORM} permission="platform.view"><Platform /></RoleRoute>} />
          <Route path="qualite" element={<RoleRoute roles={[...MANAGERS, ...PLATFORM]} permission="reports.view"><Quality /></RoleRoute>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </React.Suspense>
    </SessionGate>
  );
}
