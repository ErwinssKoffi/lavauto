import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiArrowRight, FiClock, FiInfo, FiMail } from 'react-icons/fi';
import AuthLayout from './AuthLayout';
import { Alert, Badge } from '../../components/ui';
import { useStore } from '../../lib/store';
import { emailIssue } from '../../lib/passwordPolicy';

const RESEND_COOLDOWN_SECONDS = 60;

export default function ForgotPassword() {
  const { requestPasswordReset, authKind } = useStore();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [linkExposed, setLinkExposed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const problem = emailIssue(email);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const res = await requestPasswordReset(email.trim().toLowerCase());
      const url = res && 'resetUrl' in res ? res.resetUrl ?? null : null;
      setResetUrl(url);
      setLinkExposed(Boolean(url));
      setSent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demande impossible. Réessayez dans un instant.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <Badge tone="accent"><FiMail /> {authKind === 'local' ? 'Stockage local' : 'Réinitialisation de mot de passe'}</Badge>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Mot de passe oublié ?</h1>
      <p className="mt-2 text-sm text-slate-500">
        {authKind === 'local'
          ? 'La récupération par e-mail n’est pas disponible sans serveur connecté.'
          : 'Saisissez l’adresse e-mail de votre compte WashGuard : nous générons un lien à usage unique.'}
      </p>

      {authKind === 'local' ? (
        <div className="mt-7 space-y-4">
          <Alert kind="warn">Aucun e-mail de récupération n’est envoyé sans serveur connecté.</Alert>
          <Link to="/connexion" className="btn btn-sm w-full !py-3">Retour à la connexion <FiArrowRight aria-hidden="true" /></Link>
        </div>
      ) : sent ? (
        <div className="mt-7 space-y-4">
          <Alert kind="success">
            Si cette adresse correspond à un compte actif, un lien sécurisé à usage unique a été généré. Il expire dans 1 heure et ferme toutes les sessions ouvertes après usage.
          </Alert>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Aucun message ne précise si un compte existe : la réponse est identique dans tous les cas.
          </p>
          {resetUrl && linkExposed && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-relaxed text-amber-900">
              <p className="font-bold">Lien affiché en développement</p>
              <p className="mt-1">Aucun e-mail n’est expédié par ce serveur local : ouvrez le lien ci-dessous. En production, le lien n’est jamais renvoyé au navigateur.</p>
              <a href={resetUrl} className="btn btn-sm btn-primary mt-3 w-full !py-2.5">
                Ouvrir le lien de réinitialisation <FiArrowRight aria-hidden="true" />
              </a>
            </div>
          )}
          <button
            type="button"
            className="btn btn-sm w-full !py-3 disabled:opacity-60"
            disabled={busy || cooldown > 0}
            onClick={(e) => { void submit(e); }}
          >
            {cooldown > 0
              ? <><FiClock aria-hidden="true" /> Nouvelle demande dans {cooldown} s</>
              : busy ? 'Envoi…' : 'Demander un nouveau lien'}
          </button>
          <Link to="/connexion" className="btn btn-sm w-full !py-3">Retour à la connexion <FiArrowRight aria-hidden="true" /></Link>
        </div>
      ) : (
        <form onSubmit={(e) => { void submit(e); }} className="mt-7 space-y-4" noValidate>
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-600" htmlFor="reset-email">Adresse e-mail</label>
            <input id="reset-email" type="email" required autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
              className={`w-full rounded-xl border bg-slate-50 px-3.5 py-3 text-sm outline-none transition focus:bg-white focus:ring-4 ${
                error ? 'border-red-300 focus:border-red-500 focus:ring-red-100' : 'border-slate-200 focus:border-sky-500 focus:ring-sky-100'
              }`}
              placeholder="vous@exemple.ci" />
          </div>
          {error && <div className="text-xs"><Alert kind="danger">{error}</Alert></div>}
          <button type="submit" disabled={busy} className="btn btn-sm btn-primary w-full !py-3 disabled:opacity-60">
            {busy ? 'Envoi…' : 'Recevoir le lien'} <FiArrowRight aria-hidden="true" />
          </button>
        </form>
      )}

      <div className="mt-5 rounded-xl border border-sky-100 bg-sky-50 p-3.5 text-xs leading-relaxed text-slate-600">
        <div className="flex items-start gap-2"><FiInfo className="mt-0.5 shrink-0 text-sky-600" aria-hidden="true" />
          <p>{authKind === 'local'
            ? 'Un serveur connecté est nécessaire pour un vrai jeton de réinitialisation.'
            : 'Le lien expire automatiquement après utilisation ou à son échéance ; les demandes répétées sont limitées.'}</p>
        </div>
      </div>
      <p className="mt-6 text-center text-sm text-slate-500">
        <Link to="/connexion" className="font-bold text-sky-600 hover:underline">Retour à la connexion</Link>
      </p>
    </AuthLayout>
  );
}
