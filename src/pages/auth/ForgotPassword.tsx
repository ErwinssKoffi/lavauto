import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { FiArrowRight, FiInfo, FiMail } from 'react-icons/fi';
import AuthLayout from './AuthLayout';
import { Alert, Badge } from '../../components/ui';
import { useStore } from '../../lib/store';

export default function ForgotPassword() {
  const { requestPasswordReset, authKind } = useStore();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await requestPasswordReset(email);
      setResetUrl(res?.resetUrl ?? null);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demande impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <Badge tone="accent"><FiMail /> {authKind === 'local' ? 'Stockage local' : 'Réinitialisation de mot de passe'}</Badge>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Mot de passe oublié ?</h1>
      <p className="mt-2 text-sm text-slate-500">{authKind === 'local' ? 'La récupération par e-mail n’est pas disponible sans serveur connecté.' : 'Saisissez l’adresse e-mail de votre compte WashGuard.'}</p>

      {authKind === 'local' ? (
        <div className="mt-7"><Alert kind="warn">Aucun e-mail de récupération n’est envoyé sans serveur connecté.</Alert></div>
      ) : sent ? (
        <div className="mt-7 space-y-4">
          <Alert kind="success">Si cette adresse correspond à un compte actif, un lien sécurisé à usage unique a été généré.</Alert>
          {resetUrl && (
            <a href={resetUrl} className="wg-btn wg-btn-primary w-full !py-3">
              Ouvrir le lien de réinitialisation <FiArrowRight />
            </a>
          )}
          <Link to="/connexion" className="wg-btn wg-btn-ghost w-full !py-3">Retour à la connexion <FiArrowRight /></Link>
        </div>
      ) : (
        <form onSubmit={(e) => { void submit(e); }} className="mt-7 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-600" htmlFor="reset-email">Adresse e-mail</label>
            <input id="reset-email" type="email" required autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm outline-none transition focus:border-sky-500 focus:bg-white focus:ring-4 focus:ring-sky-100"
              placeholder="vous@exemple.ci" />
          </div>
          {error && <div className="text-xs"><Alert kind="danger">{error}</Alert></div>}
          <button type="submit" disabled={busy} className="wg-btn wg-btn-primary w-full !py-3 disabled:opacity-60">
            {busy ? 'Envoi…' : 'Recevoir le lien'} <FiArrowRight />
          </button>
        </form>
      )}

      <div className="mt-5 rounded-xl border border-sky-100 bg-sky-50 p-3.5 text-xs leading-relaxed text-slate-600">
        <div className="flex items-start gap-2"><FiInfo className="mt-0.5 shrink-0 text-sky-600" />
          <p>{authKind === 'local' ? 'Connectez un serveur backend pour activer la réinitialisation par jeton.' : 'Le lien expire automatiquement après utilisation ou à son échéance.'}</p>
        </div>
      </div>
      <p className="mt-6 text-center text-sm text-slate-500">
        <Link to="/connexion" className="font-bold text-sky-600 hover:underline">Retour à la connexion</Link>
      </p>
    </AuthLayout>
  );
}
