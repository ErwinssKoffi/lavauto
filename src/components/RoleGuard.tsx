import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FiAlertTriangle, FiArrowRight, FiLock, FiShield } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { ROLE_LABELS, type Role } from '../types';
import { getDefaultRedirectForRole } from '../lib/rbac';
import { Badge, Card } from './ui';

interface RoleGuardProps {
  children: React.ReactNode;
  allowedRoles: Role[];
  fallbackMessage?: string;
}

export default function RoleGuard({
  children,
  allowedRoles,
  fallbackMessage,
}: RoleGuardProps) {
  const { state } = useStore();
  const navigate = useNavigate();

  const currentRole = state.session?.role;

  // Si pas de session, le SessionGate ou AppRoute gère la redirection vers /connexion
  if (!currentRole) {
    return <>{children}</>;
  }

  // Rôle autorisé
  if (allowedRoles.includes(currentRole)) {
    return <>{children}</>;
  }

  // Rôle non autorisé : écran d'accès restreint stylé
  const defaultRedirect = getDefaultRedirectForRole(currentRole);

  return (
    <div className="mx-auto my-12 max-w-xl">
      <Card className="border-red-500/20 shadow-2xl p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-red-500/10 text-red-400">
            <FiShield size={24} />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-lg text-slate-100">Accès restreint</span>
              <Badge tone="danger">Droits insuffisants</Badge>
            </div>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">
              {fallbackMessage ||
                "Votre compte ne dispose pas des privilèges requis pour accéder à ce module. La séparation stricte des rôles garantit l'intégrité financière et opérationnelle de votre station."}
            </p>

            <div className="mt-5 rounded-xl border p-4 space-y-2" style={{ background: 'var(--wg-surface-2)', borderColor: 'var(--wg-border)' }}>
              <div className="flex items-center justify-between text-xs">
                <span className="wg-muted">Votre rôle actuel :</span>
                <Badge tone="neutral">{ROLE_LABELS[currentRole] ?? currentRole}</Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="wg-muted">Rôles autorisés pour cet écran :</span>
                <div className="flex flex-wrap gap-1 justify-end">
                  {allowedRoles.map((r) => (
                    <Badge key={r} tone="accent">
                      {ROLE_LABELS[r]}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate(defaultRedirect)}
                className="wg-btn wg-btn-primary !py-2.5 text-xs font-semibold"
              >
                Retourner à mon espace autorisé <FiArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
