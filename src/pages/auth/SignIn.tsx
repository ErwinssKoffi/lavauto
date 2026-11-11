import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiArrowRight, FiInfo, FiLock, FiMail, FiShield } from 'react-icons/fi';
import AuthLayout from './AuthLayout';
import { Alert, Badge } from '../../components/ui';
import { useStore } from '../../lib/store';

export default function SignIn() {
  const { signIn, signInSupportDemo, state } = useStore();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      signIn(email, password);
      navigate(state.station?.activated ? '/app/tableau-de-bord' : '/app/mise-en-route');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion impossible.');
    }
  };

  return (
    <AuthLayout>
      <Badge tone="accent"><FiLock /> Connexion sécurisée</Badge>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Bonjour 👋</h1>
      <p className="mt-2 text-sm text-slate-500">Connectez-vous pour retrouver votre station.</p>

      <form onSubmit={submit} className="mt-7 space-y-4">
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
          </div>
          <div className="relative">
            <FiLock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-sky-500 focus:bg-white focus:ring-4 focus:ring-sky-100"
              placeholder="••••••••" />
          </div>
        </div>

        {error && <div className="text-xs"><Alert kind="danger">{error}</Alert></div>}

        <button type="submit" className="wg-btn wg-btn-primary w-full !py-3">Se connecter <FiArrowRight /></button>
      </form>

      {/* Aucune connexion tierce : Google / Facebook n'existent pas. */}
      {/* Aucun « Se souvenir de moi » : la session dure 30 jours, l'option n'aurait aucun effet. */}
      <div className="mt-5 rounded-xl border border-sky-100 bg-sky-50 p-3.5 text-xs leading-relaxed text-slate-600">
        <div className="flex items-start gap-2">
          <FiInfo className="mt-0.5 shrink-0 text-sky-600" />
          <p><strong>Mot de passe oublié ?</strong> WashGuard n’envoie aucun e-mail. Le propriétaire le réinitialise depuis le module <strong>Employés</strong> — c’est la seule voie réelle.</p>
        </div>
      </div>

      <p className="mt-6 text-center text-sm text-slate-500">
        Pas encore de compte ? <Link to="/inscription" className="font-bold text-sky-600 hover:underline">Créer mon espace</Link>
      </p>

      <div className="mt-7 border-t border-slate-100 pt-5">
        <button onClick={() => { signInSupportDemo(); navigate('/app/plateforme'); }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-xs font-semibold text-slate-600 hover:border-sky-400 hover:text-sky-600">
          <FiShield /> Voir l’espace plateforme (accès support de démonstration)
        </button>
        <p className="mt-2 text-center text-[11px] text-slate-400">Démonstration frontend : cette session n’existe pas côté serveur.</p>
      </div>
    </AuthLayout>
  );
}
