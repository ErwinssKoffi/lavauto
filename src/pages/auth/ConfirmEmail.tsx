import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FiArrowRight, FiCheckCircle, FiMail, FiXCircle } from 'react-icons/fi';
import AuthLayout from './AuthLayout';
import { Alert, Badge } from '../../components/ui';
import { useStore } from '../../lib/store';

type State = 'checking' | 'done' | 'failed' | 'missing';

/** Page ouverte depuis le lien de confirmation (mode serveur uniquement). */
export default function ConfirmEmail() {
  const { confirmEmail, authKind } = useStore();
  const [params] = useSearchParams();
  const token = (params.get('token') ?? '').trim();
  const [state, setState] = useState<State>(token ? 'checking' : 'missing');
  const [message, setMessage] = useState('');
  const startedRef = useRef(false);

  useEffect(() => {
    if (!token || startedRef.current) return;
    startedRef.current = true;
    confirmEmail(token).then(
      () => setState('done'),
      (err: unknown) => {
        setMessage(err instanceof Error ? err.message : 'Confirmation impossible.');
        setState('failed');
      },
    );
  }, [confirmEmail, token]);

  return (
    <AuthLayout>
      <Badge tone="accent"><FiMail /> Confirmation d’adresse</Badge>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Vérification de l’e-mail</h1>

      {state === 'checking' && (
        <p className="mt-6 text-sm text-base-content/60" role="status">Vérification de votre lien…</p>
      )}

      {state === 'done' && (
        <div className="mt-6 space-y-4">
          <Alert kind="success">Adresse e-mail confirmée. Vous pouvez maintenant vous connecter.</Alert>
          <Link to="/connexion?confirmed=1" className="btn btn-sm btn-primary w-full py-3!">
            <FiCheckCircle aria-hidden="true" /> Se connecter <FiArrowRight aria-hidden="true" />
          </Link>
        </div>
      )}

      {(state === 'failed' || state === 'missing') && (
        <div className="mt-6 space-y-4">
          <Alert kind="danger">
            <span className="flex items-start gap-2">
              <FiXCircle className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {state === 'missing'
                  ? 'Lien de confirmation incomplet : aucun jeton n’a été fourni.'
                  : message || 'Lien de confirmation invalide ou expiré.'}
              </span>
            </span>
          </Alert>
          <p className="text-xs leading-relaxed text-base-content/60">
            Aucune donnée n’a été modifiée. Demandez un nouveau lien depuis la page de connexion, ou connectez-vous si votre adresse est déjà confirmée.
          </p>
          <Link to="/connexion" className="btn btn-sm btn-primary w-full py-3!">Retour à la connexion <FiArrowRight aria-hidden="true" /></Link>
        </div>
      )}

      {authKind === 'local' && (
        <div className="mt-5"><Alert kind="warn">La confirmation par e-mail n’existe pas en mode stockage navigateur.</Alert></div>
      )}
    </AuthLayout>
  );
}
