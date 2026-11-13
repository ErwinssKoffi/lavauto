import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FiArrowRight, FiInfo, FiLock, FiMail } from 'react-icons/fi';
import AuthLayout from './AuthLayout';
import { Alert, Badge } from '../../components/ui';
import { useStore } from '../../lib/store';

export default function SignIn() {
  const { signIn, authError, clearAuthError, state, authKind } = useStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const notice = authKind !== 'supabase' ? null : params.get('confirmed') === '1'
    ? 'Adresse e-mail confirmée. Vous pouvez maintenant vous connecter.'
    : params.get('reset') === '1'
      ? 'Mot de passe mis à jour. Connectez-vous avec votre nouveau mot de passe.'
      : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    clearAuthError();
    setBusy(true);
    try {
      const result = await signIn(email, password);
      const activated = result.identity?.stations[0]?.activated ?? state.station?.activated;
      navigate(result.identity?.isPlatformAdmin
        ? '/app/plateforme'
        : activated ? '/app/tableau-de-bord' : '/app/mise-en-route');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <Badge tone="accent"><FiLock /> {authKind === 'local' ? 'Connexion de démonstration' : 'Connexion par e-mail'}</Badge>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Bonjour 👋</h1>
      <p className="mt-2 text-sm text-slate-500">Connectez-vous pour retrouver votre station.</p>

      {notice && <div className="mt-4"><Alert kind="success">{notice}</Alert></div>}
      {authError && <div className="mt-4"><Alert kind="warn">{authError}</Alert></div>}

      <form onSubmit={(e) => { void submit(e); }} className="mt-7 space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-600" htmlFor="email">Adresse e-mail</label>
          <div className="relative">
            <FiMail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-sky-500 focus:bg-white focus:ring-4 focus:ring-sky-100"
              placeholder="proprietaire@mastation.ci" />
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-bold text-slate-600" htmlFor="password">Mot de passe</label>
            <Link to="/mot-de-passe-oublie" className="text-[11px] font-semibold text-sky-600 hover:underline">Mot de passe oublié ?</Link>
          </div>
          <div className="relative">
            <FiLock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-sky-500 focus:bg-white focus:ring-4 focus:ring-sky-100"
              placeholder="••••••••" />
          </div>
        </div>

        {error && <div className="text-xs"><Alert kind="danger">{error}</Alert></div>}

        <button type="submit" disabled={busy} className="wg-btn wg-btn-primary w-full !py-3 disabled:opacity-60">
          {busy ? 'Connexion…' : 'Se connecter'} <FiArrowRight />
        </button>
      </form>

      {/* Aucune connexion tierce : Google / Facebook n'existent pas. */}
      {/* Aucun « Se souvenir de moi » : JWT 1 h + rotation du refresh token. */}
      <div className="mt-5 rounded-xl border border-sky-100 bg-sky-50 p-3.5 text-xs leading-relaxed text-slate-600">
        <div className="flex items-start gap-2">
          <FiInfo className="mt-0.5 shrink-0 text-sky-600" />
          {authKind === 'local' ? (
            <p><strong>Mot de passe oublié ?</strong> Aucun e-mail ni lien de récupération n’est disponible dans cette démonstration. Ne réinitialisez pas le navigateur sans avoir sauvegardé ses données.</p>
          ) : (
            <p><strong>Mot de passe oublié ?</strong> Utilisez « Mot de passe oublié » pour demander un lien de réinitialisation Supabase Auth. L’envoi dépend de la configuration e-mail du service.</p>
          )}
        </div>
      </div>

      <p className="mt-6 text-center text-sm text-slate-500">
        Pas encore de compte ? <Link to="/inscription" className="font-bold text-sky-600 hover:underline">Créer mon espace</Link>
      </p>
    </AuthLayout>
  );
}
