import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FiArrowRight, FiInfo, FiLock, FiMail, FiShield } from 'react-icons/fi';
import AuthLayout from './AuthLayout';
import { Alert, Badge } from '../../components/ui';
import { PasswordField } from '../../components/PasswordField';
import { useStore } from '../../lib/store';
import { emailIssue } from '../../lib/passwordPolicy';

type Notice = { tone: 'success' | 'warn'; text: string } | null;

/** Message issu du serveur, sans exposer de détail technique. */
function describeSignInError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Connexion impossible. Réessayez.';
  if (/Trop de tentatives/i.test(message)) return message;
  if (/désactivé/i.test(message)) return `${message} Contactez le propriétaire de la station.`;
  if (/suspendue/i.test(message)) return `${message} Le support WashGuard peut réactiver l’entreprise.`;
  if (/Confirmez votre adresse/i.test(message)) return message;
  return message;
}

export default function SignIn() {
  const { signIn, authError, clearAuthError, state, authKind } = useStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement | null>(null);

  const notice: Notice = (() => {
    if (authKind === 'local') return null;
    if (params.get('confirmed') === '1') return { tone: 'success', text: 'Adresse e-mail confirmée. Vous pouvez maintenant vous connecter.' };
    if (params.get('reset') === '1') return { tone: 'success', text: 'Mot de passe mis à jour. Connectez-vous avec votre nouveau mot de passe.' };
    if (params.get('expired') === '1') return { tone: 'warn', text: 'Votre session a expiré. Reconnectez-vous pour continuer.' };
    if (params.get('signedout') === '1') return { tone: 'warn', text: 'Vous êtes déconnecté. À bientôt.' };
    return null;
  })();

  useEffect(() => { emailRef.current?.focus(); }, []);

  const emailError = emailTouched ? emailIssue(email) : null;
  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    clearAuthError();
    const emailProblem = emailIssue(email);
    if (emailProblem) {
      setEmailTouched(true);
      setError(emailProblem);
      return;
    }
    if (!password) {
      setError('Saisissez votre mot de passe.');
      return;
    }
    setBusy(true);
    try {
      const result = await signIn(email.trim().toLowerCase(), password);
      const activated = result.identity?.stations[0]?.activated ?? state.station?.activated;
      navigate(result.identity?.isPlatformAdmin
        ? '/app/plateforme'
        : activated ? '/app/tableau-de-bord' : '/app/mise-en-route', { replace: true });
    } catch (err) {
      setError(describeSignInError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <Badge tone="accent"><FiLock /> {authKind === 'local' ? 'Connexion locale' : 'Connexion par e-mail'}</Badge>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Bonjour</h1>
      <p className="mt-2 text-sm text-slate-500">Connectez-vous pour retrouver votre station.</p>

      {notice && <div className="mt-4"><Alert kind={notice.tone}>{notice.text}</Alert></div>}
      {authError && <div className="mt-4"><Alert kind="warn">{authError}</Alert></div>}

      <form onSubmit={(e) => { void submit(e); }} className="mt-7 space-y-4" noValidate>
        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-600" htmlFor="email">Adresse e-mail</label>
          <div className="relative">
            <FiMail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              id="email"
              ref={emailRef}
              type="email"
              required
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? 'email-error' : undefined}
              className={`w-full rounded-xl border bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:bg-white focus:ring-4 ${
 emailError
 ? 'border-red-300 focus:border-red-500 focus:ring-red-100'
 : 'border-slate-200 focus:border-sky-500 focus:ring-sky-100'
 }`}
              placeholder="proprietaire@mastation.ci"
            />
          </div>
          {emailError && <p className="mt-1.5 text-[11px] font-semibold text-red-600" id="email-error" role="alert">{emailError}</p>}
        </div>

        <PasswordField
          id="password"
          label="Mot de passe"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          labelAction={(
            <Link to="/mot-de-passe-oublie" className="text-[11px] font-semibold text-sky-600 hover:underline">
              Mot de passe oublié ?
            </Link>
          )}
        />

        {error && <div className="text-xs"><Alert kind="danger">{error}</Alert></div>}

        <button type="submit" disabled={!canSubmit} className="btn btn-sm btn-primary w-full py-3! disabled:opacity-60">
          {busy ? 'Connexion…' : 'Se connecter'} <FiArrowRight aria-hidden="true" />
        </button>
      </form>

      {/* Aucune connexion tierce : Google / Facebook n'existent pas. */}
      <div className="mt-5 rounded-xl border border-sky-100 bg-sky-50 p-3.5 text-xs leading-relaxed text-slate-600">
        <div className="flex items-start gap-2">
          <FiInfo className="mt-0.5 shrink-0 text-sky-600" aria-hidden="true" />
          {authKind === 'local' ? (
            <p><strong>Mot de passe oublié ?</strong> Aucun e-mail ni lien de récupération n’est disponible en mode stockage navigateur.</p>
          ) : (
            <p><strong>Mot de passe oublié ?</strong> Utilisez « Mot de passe oublié » pour demander un lien de réinitialisation sécurisé, utilisable une seule fois pendant 1 heure.</p>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-slate-400">
        <FiShield aria-hidden="true" /> {authKind === 'local' ? 'Session en mémoire, non sécurisée' : 'Sessions révocables · Mot de passe vérifié côté serveur'}
      </div>
      {authKind !== 'local' && (
        <p className="mt-2 text-center text-[11px] leading-relaxed text-slate-400">
          Poste partagé ? Fermez votre session depuis le menu du compte, ou fermez toutes les autres sessions dans « Sécurité du compte ».
        </p>
      )}

      <p className="mt-6 text-center text-sm text-slate-500">
        Pas encore de compte ? <Link to="/inscription" className="font-bold text-sky-600 hover:underline">Créer mon espace</Link>
      </p>
    </AuthLayout>
  );
}
