import React, { useCallback, useEffect, useState } from 'react';
import {
  FiAlertTriangle, FiCheckCircle, FiGlobe, FiKey, FiLogOut, FiMonitor,
  FiRefreshCw, FiShield, FiSmartphone, FiActivity,
} from 'react-icons/fi';
import { Alert, Badge, Modal, Tabs } from './ui';
import { PasswordField } from './PasswordField';
import { useStore } from '../lib/store';
import { passwordIssue } from '../lib/passwordPolicy';
import { formatDateTime } from '../lib/format';
import type { AuthActivityEntry, SecuritySession } from '../services/auth/AuthPort';

// ─── Sécurité du compte (mot de passe, sessions, activité) ──────────────────
// L'UI n'accorde aucun droit : chaque action est revérifiée par le serveur.
// En mode local la session vit en mémoire et ne peut pas être listée à distance.

type Tab = 'password' | 'sessions' | 'activity';

const EVENT_LABELS: Record<string, { label: string; tone: 'success' | 'warn' | 'danger' }> = {
  signin_success: { label: 'Connexion réussie', tone: 'success' },
  signin_failed: { label: 'Connexion refusée', tone: 'danger' },
  signout: { label: 'Déconnexion', tone: 'warn' },
  signup: { label: 'Inscription', tone: 'success' },
  password_changed: { label: 'Mot de passe modifié', tone: 'success' },
  password_reset_requested: { label: 'Réinitialisation demandée', tone: 'warn' },
  password_reset_completed: { label: 'Mot de passe réinitialisé', tone: 'success' },
  session_revoked: { label: 'Session fermée', tone: 'warn' },
  sessions_revoked: { label: 'Autres sessions fermées', tone: 'warn' },
  email_confirmed: { label: 'E-mail confirmé', tone: 'success' },
  email_confirmation_requested: { label: 'Confirmation demandée', tone: 'warn' },
  rate_limited: { label: 'Tentatives limitées', tone: 'danger' },
  session_expired: { label: 'Session expirée', tone: 'warn' },
};

function deviceIcon(label: string) {
  if (/Android|iOS/i.test(label)) return <FiSmartphone aria-hidden="true" />;
  return <FiMonitor aria-hidden="true" />;
}

export function AccountSecurity({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    identity, authKind, changePassword, listSessions, revokeSession,
    revokeOtherSessions, listAuthActivity, notify,
  } = useStore();
  const [tab, setTab] = useState<Tab>('password');

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const [pwdDone, setPwdDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const [sessions, setSessions] = useState<SecuritySession[] | null>(null);
  const [sessionsError, setSessionsError] = useState('');
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const [events, setEvents] = useState<AuthActivityEntry[] | null>(null);
  const [eventsError, setEventsError] = useState('');
  const [eventsLoading, setEventsLoading] = useState(false);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError('');
    try {
      setSessions(await listSessions());
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Lecture des sessions impossible.');
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, [listSessions]);

  const loadActivity = useCallback(async () => {
    setEventsLoading(true);
    setEventsError('');
    try {
      setEvents(await listAuthActivity(20));
    } catch (err) {
      setEventsError(err instanceof Error ? err.message : 'Lecture du journal impossible.');
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [listAuthActivity]);

  useEffect(() => {
    if (!open) return;
    setTab('password');
    setPwdError('');
    setPwdDone(false);
    setTouched(false);
    setCurrent('');
    setNext('');
    setConfirm('');
    setSessions(null);
    setEvents(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (tab === 'sessions' && sessions === null && !sessionsLoading) void loadSessions();
    if (tab === 'activity' && events === null && !eventsLoading) void loadActivity();
  }, [open, tab, sessions, events, sessionsLoading, eventsLoading, loadSessions, loadActivity]);

  const nextError = touched ? passwordIssue(next, identity?.email ?? '') : null;
  const confirmError = touched && next !== confirm ? 'Les deux mots de passe ne correspondent pas.' : null;
  const needsCurrent = authKind === 'api';

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setPwdError('');
    setPwdDone(false);
    const problem = passwordIssue(next, identity?.email ?? '');
    if (problem) return setPwdError(problem);
    if (next !== confirm) return setPwdError('Les deux mots de passe ne correspondent pas.');
    if (needsCurrent && !current) return setPwdError('Saisissez votre mot de passe actuel.');
    setSaving(true);
    try {
      const result = await changePassword(current, next);
      setPwdDone(true);
      setCurrent(''); setNext(''); setConfirm(''); setTouched(false);
      // Le store affiche déjà le message (et le nombre de sessions fermées).
      if (result.revoked > 0) setSessions(null);
    } catch (err) {
      setPwdError(err instanceof Error ? err.message : 'Changement de mot de passe impossible.');
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (session: SecuritySession) => {
    setRevoking(session.id);
    try {
      const result = await revokeSession(session.id);
      await loadSessions();
      if (result.signedOut) {
        onClose();
        notify('success', 'Session fermée. Reconnectez-vous.');
      } else {
        notify('success', 'Session fermée.');
      }
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Révocation impossible.');
    } finally {
      setRevoking(null);
    }
  };

  const handleRevokeOthers = async () => {
    setRevoking('others');
    try {
      const count = await revokeOtherSessions();
      await loadSessions();
      notify('success', count > 0
        ? `${count} autre(s) session(s) fermée(s).`
        : 'Aucune autre session active à fermer.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Révocation impossible.');
    } finally {
      setRevoking(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Sécurité du compte" wide>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { id: 'password', label: 'Mot de passe' },
            { id: 'sessions', label: 'Sessions actives' },
            { id: 'activity', label: 'Activité' },
          ]}
        />
        <Badge tone="accent"><FiShield /> {authKind === 'local' ? 'Démo locale' : 'Serveur'}</Badge>
      </div>

      {tab === 'password' && (
        <form onSubmit={(e) => { void submitPassword(e); }} className="space-y-4" noValidate>
          <p className="text-base-content/60 text-xs leading-relaxed">
            Le mot de passe est vérifié et enregistré côté serveur. Un changement ferme les autres sessions ouvertes.
          </p>
          {authKind === 'local' && (
            <Alert kind="warn">Mode stockage navigateur : le mot de passe est conservé sous forme d’empreinte faible dans ce navigateur. Ce n’est pas un stockage sécurisé.</Alert>
          )}
          {pwdDone && <Alert kind="success">Mot de passe mis à jour.</Alert>}
          {needsCurrent && (
            <PasswordField
              id="security-current-password"
              label="Mot de passe actuel"
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
            />
          )}
          <PasswordField
            id="security-new-password"
            label="Nouveau mot de passe"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            email={identity?.email ?? ''}
            showStrength
            showChecklist
            error={nextError}
          />
          <PasswordField
            id="security-confirm-password"
            label="Confirmer le nouveau mot de passe"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            error={confirmError}
          />
          {pwdError && <Alert kind="danger">{pwdError}</Alert>}
          <button type="submit" disabled={saving} className="btn btn-sm btn-primary w-full disabled:opacity-60">
            <FiKey aria-hidden="true" /> {saving ? 'Enregistrement…' : 'Changer mon mot de passe'}
          </button>
        </form>
      )}

      {tab === 'sessions' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-base-content/60 text-xs leading-relaxed">
              Chaque ligne est un appareil connecté. Fermer une session invalide son cookie immédiatement.
            </p>
            <button type="button" className="btn btn-sm px-3! py-1.5! text-xs" onClick={() => { void loadSessions(); }} disabled={sessionsLoading}>
              <FiRefreshCw aria-hidden="true" /> {sessionsLoading ? 'Lecture…' : 'Actualiser'}
            </button>
          </div>

          {sessionsError && <Alert kind="danger">{sessionsError}</Alert>}

          {authKind === 'local' && (
            <Alert kind="warn">La session de démonstration vit en mémoire : elle disparaît à la fermeture de l’onglet et ne peut pas être révoquée à distance.</Alert>
          )}
          {authKind === 'supabase' && (
            <Alert kind="warn">Avec Supabase Auth, seule la fermeture des autres appareils est disponible : la liste détaillée n’est pas exposée.</Alert>
          )}

          {sessions && sessions.length === 0 && !sessionsLoading && (
            <p className="text-base-content/60 text-xs">Aucune session active lisible.</p>
          )}

          <ul className="space-y-2">
            {(sessions ?? []).map((session) => (
              <li key={session.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-bold">
                      <span className="text-sky-500">{deviceIcon(session.userAgent)}</span>
                      {session.userAgent}
                      {session.current && <Badge tone="success">Cet appareil</Badge>}
                    </p>
                    <p className="text-base-content/60 mt-1 text-[11px]">
                      Dernière activité : {session.lastSeenAt ? formatDateTime(session.lastSeenAt) : '—'}
                      {session.ipAddress ? ` · ${session.ipAddress}` : ''}
                    </p>
                    <p className="text-base-content/60 text-[11px]">
                      {session.expiresAt
                        ? `Expire le ${formatDateTime(session.expiresAt)}${session.rememberMe ? ' (session persistante)' : ''}`
                        : 'Durée : jusqu’à la fermeture de l’onglet'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-error btn-outline px-3! py-1.5! text-xs disabled:opacity-50"
                    disabled={revoking === session.id || authKind !== 'api'}
                    onClick={() => { void handleRevoke(session); }}
                  >
                    <FiLogOut aria-hidden="true" /> Fermer
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="btn btn-sm w-full disabled:opacity-60"
            disabled={revoking === 'others' || authKind === 'local'}
            onClick={() => { void handleRevokeOthers(); }}
          >
            <FiGlobe aria-hidden="true" /> {revoking === 'others' ? 'Fermeture…' : 'Fermer toutes les autres sessions'}
          </button>
        </div>
      )}

      {tab === 'activity' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-base-content/60 text-xs leading-relaxed">
              Vingt derniers événements d’authentification de votre compte. Aucun mot de passe ni jeton n’y figure.
            </p>
            <button type="button" className="btn btn-sm px-3! py-1.5! text-xs" onClick={() => { void loadActivity(); }} disabled={eventsLoading}>
              <FiRefreshCw aria-hidden="true" /> {eventsLoading ? 'Lecture…' : 'Actualiser'}
            </button>
          </div>

          {eventsError && <Alert kind="danger">{eventsError}</Alert>}
          {authKind !== 'api' && (
            <Alert kind="warn">Le journal détaillé n’existe qu’avec le serveur WashGuard (mode API).</Alert>
          )}
          {events && events.length === 0 && !eventsLoading && authKind === 'api' && (
            <p className="text-base-content/60 text-xs">Aucun événement enregistré pour ce compte.</p>
          )}

          <ul className="space-y-2">
            {(events ?? []).map((event, index) => {
              const meta = EVENT_LABELS[event.event] ?? { label: event.event, tone: 'warn' as const };
              return (
                <li key={`${event.at}-${index}`} className="flex items-start gap-3 rounded-xl border p-3">
                  <span className={`mt-0.5 ${meta.tone === 'danger' ? 'text-red-400' : meta.tone === 'success' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {meta.tone === 'success' ? <FiCheckCircle aria-hidden="true" /> : meta.tone === 'danger' ? <FiAlertTriangle aria-hidden="true" /> : <FiActivity aria-hidden="true" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{meta.label}</p>
                    <p className="text-base-content/60 text-[11px]">
                      {formatDateTime(event.at)} · {event.device || 'Appareil inconnu'}
                      {event.ipAddress ? ` · ${event.ipAddress}` : ''}
                    </p>
                    {event.detail && <p className="text-base-content/60 mt-1 break-words text-[11px]">{event.detail}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}
