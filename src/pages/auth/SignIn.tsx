import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FiArrowRight, FiEye, FiEyeOff, FiInfo, FiKey, FiLock, FiMail, FiShield, FiUserCheck,
} from 'react-icons/fi';
import AuthLayout from './AuthLayout';
import { Alert, Badge, Modal } from '../../components/ui';
import { useStore } from '../../lib/store';
import { ROLE_LABELS, type Role } from '../../types';

export default function SignIn() {
  const { signIn, switchRoleDemo, state, notify } = useStore();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [forgotModal, setForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      signIn(email, password);
      const targetUser = state.users.find((u) => u.email === email.trim().toLowerCase());
      if (targetUser?.role === 'laveur') {
        navigate('/app/lavages');
      } else if (state.station?.activated) {
        navigate('/app/tableau-de-bord');
      } else {
        navigate('/app/mise-en-route');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion impossible.');
    }
  };

  const handleQuickDemoRole = (role: Role) => {
    switchRoleDemo(role);
    if (role === 'support') {
      navigate('/app/plateforme');
    } else if (role === 'laveur') {
      navigate('/app/lavages');
    } else if (state.station?.activated) {
      navigate('/app/tableau-de-bord');
    } else {
      navigate('/app/mise-en-route');
    }
  };

  const handleForgotSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim()) return;
    setForgotSent(true);
    notify('info', 'Demande de réinitialisation transmise.');
  };

  return (
    <AuthLayout>
      <Badge tone="accent">
        <FiLock /> Connexion sécurisée
      </Badge>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Bonjour 👋</h1>
      <p className="mt-2 text-sm text-slate-500">
        Connectez-vous pour retrouver votre station et vos données de gestion.
      </p>

      <form onSubmit={submit} className="mt-7 space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-600" htmlFor="email">
            Adresse e-mail professionnelle
          </label>
          <div className="relative">
            <FiMail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-sky-500 focus:bg-white focus:ring-4 focus:ring-sky-100"
              placeholder="proprietaire@mastation.ci"
            />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-bold text-slate-600" htmlFor="password">
              Mot de passe
            </label>
            <button
              type="button"
              onClick={() => {
                setForgotEmail(email);
                setForgotModal(true);
              }}
              className="text-xs font-semibold text-sky-600 hover:underline"
            >
              Mot de passe oublié ?
            </button>
          </div>
          <div className="relative">
            <FiLock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-11 text-sm outline-none transition focus:border-sky-500 focus:bg-white focus:ring-4 focus:ring-sky-100"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
              title={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            >
              {showPassword ? <FiEyeOff size={16} /> : <FiEye size={16} />}
            </button>
          </div>
        </div>

        {error && (
          <div className="text-xs">
            <Alert kind="danger">{error}</Alert>
          </div>
        )}

        <button type="submit" className="wg-btn wg-btn-primary w-full !py-3 font-semibold shadow-md shadow-sky-500/20">
          Se connecter <FiArrowRight />
        </button>
      </form>

      {/* Accès rapide démonstration par rôle (RBAC) */}
      <div className="mt-6 rounded-2xl border border-sky-100 bg-sky-50/70 p-4">
        <div className="flex items-center gap-2 mb-2 text-xs font-bold text-sky-800">
          <FiUserCheck size={14} />
          <span>Accès rapide de démonstration (Test des rôles RBAC) :</span>
        </div>
        <p className="text-[11px] text-slate-600 leading-snug mb-3">
          Cliquez sur un profil pour tester instantanément ses permissions et ses écrans autorisés :
        </p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {(['proprietaire', 'gerant', 'caissier', 'laveur', 'support'] as Role[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => handleQuickDemoRole(r)}
              className="flex items-center justify-center gap-1 rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-sky-400 hover:bg-sky-500/10 hover:text-sky-700"
            >
              <span>{ROLE_LABELS[r]}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="mt-6 text-center text-sm text-slate-500">
        Pas encore de compte ?{' '}
        <Link to="/inscription" className="font-bold text-sky-600 hover:underline">
          Créer mon espace station
        </Link>
      </p>

      {/* Modal Mot de passe oublié */}
      <Modal
        open={forgotModal}
        onClose={() => {
          setForgotModal(false);
          setForgotSent(false);
        }}
        title="Réinitialisation du mot de passe"
      >
        <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
          {forgotSent ? (
            <div className="space-y-3">
              <Alert kind="success">
                Instruction de réinitialisation enregistrée pour <strong>{forgotEmail}</strong>.
              </Alert>
              <p>
                Pour les collaborateurs (gérants, caissiers, laveurs), le propriétaire de la station réinitialise directement les mots de passe depuis son interface <strong>Équipe & Employés</strong>.
              </p>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  className="wg-btn wg-btn-primary"
                  onClick={() => {
                    setForgotModal(false);
                    setForgotSent(false);
                  }}
                >
                  Fermer
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleForgotSubmit} className="space-y-4">
              <p>
                Saisissez votre adresse e-mail professionnelle pour demander une réinitialisation de vos identifiants :
              </p>
              <div>
                <label className="block font-bold mb-1">Adresse e-mail</label>
                <input
                  type="email"
                  required
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className="wg-input"
                  placeholder="collaborateur@mastation.ci"
                />
              </div>
              <div className="rounded-xl border p-3 bg-amber-500/10 border-amber-500/30 text-slate-300">
                <p className="font-semibold text-amber-400 mb-0.5">Règle de sécurité WashGuard :</p>
                <p className="text-[11px]">
                  Les comptes employés sont placés sous la responsabilité du propriétaire de la station qui peut réinitialiser leurs mots de passe à tout moment sans dépendre d'un serveur d'envoi d'e-mails.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="wg-btn wg-btn-ghost"
                  onClick={() => setForgotModal(false)}
                >
                  Annuler
                </button>
                <button type="submit" className="wg-btn wg-btn-primary">
                  <FiKey /> Valider la demande
                </button>
              </div>
            </form>
          )}
        </div>
      </Modal>
    </AuthLayout>
  );
}
