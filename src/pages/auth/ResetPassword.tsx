import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FiArrowRight, FiCheckCircle, FiLock, FiShield } from 'react-icons/fi';
import AuthLayout from './AuthLayout';
import { Alert, Badge } from '../../components/ui';
import { PasswordField } from '../../components/PasswordField';
import { useStore } from '../../lib/store';
import { passwordIssue } from '../../lib/passwordPolicy';

type TokenState = 'checking' | 'valid' | 'invalid' | 'not-required';

export default function ResetPassword() {
  const { authRecovery, updatePassword, verifyResetToken, authKind, identity } = useStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = (params.get('token') ?? '').trim();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tokenState, setTokenState] = useState<TokenState>('checking');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const canReset = authRecovery || Boolean(token) || Boolean(identity);

  // Vérification du lien AVANT saisie : un jeton expiré n'affiche pas un
  // formulaire inutile (et ne consomme pas le jeton).
  useEffect(() => {
    let active = true;
    if (authKind === 'local' || (!token && !authRecovery && !identity)) {
      setTokenState('not-required');
      return () => { active = false; };
    }
    if (!token) {
      setTokenState(authRecovery || identity ? 'not-required' : 'invalid');
      return () => { active = false; };
    }
    verifyResetToken(token)
      .then((result) => {
        if (!active) return;
        setExpiresAt(result.expiresAt);
        setTokenState(result.valid ? 'valid' : 'invalid');
      })
      .catch(() => { if (active) setTokenState('not-required'); });
    return () => { active = false; };
  }, [token, authRecovery, identity, authKind, verifyResetToken]);

  const passwordError = touched ? passwordIssue(password, identity?.email ?? '') : null;
  const confirmError = touched && password !== confirm ? 'Les deux mots de passe ne correspondent pas.' : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError('');
    const problem = passwordIssue(password, identity?.email ?? '');
    if (problem) return setError(problem);
    if (password !== confirm) return setError('Les deux mots de passe ne correspondent pas.');
    setBusy(true);
    try {
      await updatePassword(password, token || undefined);
      navigate('/connexion?reset=1', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Réinitialisation impossible.');
    } finally {
      setBusy(false);
    }
  };

  const expiredLabel = expiresAt
    ? new Date(expiresAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : null;

  return (
    <AuthLayout>
      <Badge tone="accent"><FiLock /> Nouveau mot de passe</Badge>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Définir un mot de passe</h1>
      <p className="mt-2 text-sm text-slate-500">
        Choisissez un mot de passe long et unique. Il fermera toutes les sessions ouvertes sur ce compte.
      </p>

      {authKind === 'local' ? (
        <div className="mt-7 space-y-4">
          <Alert kind="warn">Le mode stockage local ne dispose pas de lien de réinitialisation.</Alert>
          <Link to="/connexion" className="wg-btn wg-btn-primary w-full !py-3">Retour à la connexion <FiArrowRight aria-hidden="true" /></Link>
        </div>
      ) : !canReset ? (
        <div className="mt-7 space-y-4">
          <Alert kind="warn">Ce lien de réinitialisation est absent, déjà utilisé ou expiré. Demandez-en un nouveau depuis la page « Mot de passe oublié ».</Alert>
          <Link to="/mot-de-passe-oublie" className="wg-btn wg-btn-primary w-full !py-3">Demander un nouveau lien <FiArrowRight aria-hidden="true" /></Link>
        </div>
      ) : tokenState === 'checking' ? (
        <p className="mt-7 text-xs text-slate-500" role="status">Vérification du lien…</p>
      ) : tokenState === 'invalid' ? (
        <div className="mt-7 space-y-4">
          <Alert kind="warn">Ce lien de réinitialisation est invalide, déjà utilisé ou expiré. Aucun mot de passe n’a été modifié.</Alert>
          <Link to="/mot-de-passe-oublie" className="wg-btn wg-btn-primary w-full !py-3">Demander un nouveau lien <FiArrowRight aria-hidden="true" /></Link>
        </div>
      ) : (
        <form onSubmit={(e) => { void submit(e); }} className="mt-7 space-y-4" noValidate>
          {expiredLabel && (
            <p className="text-[11px] text-slate-400">Lien valable jusqu’au {expiredLabel}.</p>
          )}
          <PasswordField
            id="new-password"
            label="Nouveau mot de passe"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            email={identity?.email ?? ''}
            showStrength
            showChecklist
            error={passwordError}
          />
          <PasswordField
            id="confirm-password"
            label="Confirmer le nouveau mot de passe"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            error={confirmError}
          />
          {error && <div className="text-xs"><Alert kind="danger">{error}</Alert></div>}
          <button type="submit" disabled={busy} className="wg-btn wg-btn-primary w-full !py-3 disabled:opacity-60">
            {busy ? 'Enregistrement…' : 'Enregistrer le mot de passe'} <FiArrowRight aria-hidden="true" />
          </button>
          <div className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
            <FiShield className="mt-0.5 shrink-0 text-sky-600" aria-hidden="true" />
            <p>Le lien est à usage unique. Une fois le mot de passe enregistré, vous serez invité à vous reconnecter.</p>
          </div>
        </form>
      )}

      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400">
        <FiCheckCircle aria-hidden="true" /> Aucun mot de passe n’est affiché ni journalisé.
      </p>
    </AuthLayout>
  );
}
