import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiArrowRight, FiLock } from 'react-icons/fi';
import AuthLayout from './AuthLayout';
import { Alert, Badge } from '../../components/ui';
import { useStore } from '../../lib/store';

/** Arrivée depuis le lien Supabase Auth (événement PASSWORD_RECOVERY). */
export default function ResetPassword() {
  const { authRecovery, updatePassword, authKind } = useStore();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Le mot de passe doit contenir au moins 8 caractères.');
    if (password !== confirm) return setError('Les deux mots de passe ne correspondent pas.');
    setBusy(true);
    try {
      await updatePassword(password);
      navigate('/connexion?reset=1', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Réinitialisation impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <Badge tone="accent"><FiLock /> Nouveau mot de passe</Badge>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Définir un mot de passe</h1>
      {authKind === 'local' ? (
        <div className="mt-7 space-y-4">
          <Alert kind="warn">La démonstration locale ne dispose pas de lien de réinitialisation et n’envoie aucun e-mail. Sauvegardez les données avant toute récupération.</Alert>
          <Link to="/connexion" className="wg-btn wg-btn-primary w-full !py-3">Retour à la connexion <FiArrowRight /></Link>
        </div>
      ) : !authRecovery ? (
        <div className="mt-7 space-y-4">
          <Alert kind="warn">Ce lien de réinitialisation est absent, déjà utilisé ou expiré. Demandez-en un nouveau depuis la page « Mot de passe oublié ».</Alert>
          <Link to="/mot-de-passe-oublie" className="wg-btn wg-btn-primary w-full !py-3">Demander un nouveau lien <FiArrowRight /></Link>
        </div>
      ) : (
        <form onSubmit={(e) => { void submit(e); }} className="mt-7 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-600" htmlFor="new-password">Nouveau mot de passe</label>
            <input id="new-password" type="password" required minLength={8} autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm outline-none focus:border-sky-500 focus:bg-white focus:ring-4 focus:ring-sky-100" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-600" htmlFor="confirm-password">Confirmer</label>
            <input id="confirm-password" type="password" required minLength={8} autoComplete="new-password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm outline-none focus:border-sky-500 focus:bg-white focus:ring-4 focus:ring-sky-100" />
          </div>
          {error && <div className="text-xs"><Alert kind="danger">{error}</Alert></div>}
          <button type="submit" disabled={busy} className="wg-btn wg-btn-primary w-full !py-3 disabled:opacity-60">
            {busy ? 'Enregistrement…' : 'Enregistrer le mot de passe'} <FiArrowRight />
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
