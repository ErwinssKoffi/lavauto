import React, { useState } from 'react';
import { FiKey, FiMail, FiPlus, FiSettings, FiTrash2, FiUserCheck, FiUserX, FiX } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { usePermissions } from '../lib/usePermissions';
import { formatDate, formatFCFA } from '../lib/format';
import { ROLE_LABELS, type Role } from '../types';
import { Alert, Badge, Card, Input, Modal, PageHeader, Select, useSafeAction } from '../components/ui';

const INVITABLE: Role[] = ['gerant', 'caissier', 'laveur'];

export default function Employees() {
  const {
    state, identity, invitations, authKind, isLocalStockDemo, canWriteSubscription, notify,
    employeeReadWarning, unconfirmedInvitation, unconfirmedAccountUpdate, unconfirmedRevocation, revocationRecoveryLoading, revocationRecoveryError, refreshEmployeeData,
    inviteUser, updateUser, updateEmployee, requestPasswordReset, revokeInvitation,
  } = useStore();
  const { can } = usePermissions();
  const safe = useSafeAction();
  const stations = identity?.stations ?? [];
  const defaultStation = stations[0]?.id ?? state.station?.id ?? '';
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<{ name: string; email: string; phone: string; role: Role; stationIds: string[] }>({
    name: '', email: '', phone: '', role: 'caissier',
    stationIds: defaultStation ? [defaultStation] : [],
  });
  const [edit, setEdit] = useState<{ role: Role; active: boolean; stationIds: string[] }>({
    role: 'caissier', active: true, stationIds: [],
  });
  const editing = state.users.find((u) => u.id === editingId);
  const resetUser = state.users.find((u) => u.id === resetTarget);
  const revoking = invitations.find((invitation) => invitation.id === revokeTarget);
  const canInvite = can('employees.invite');
  const canManage = can('employees.manage');
  const canDisable = can('employees.disable');
  const canAssign = can('employees.assign_stations');
  const canReset = can('users.reset_password');
  const recoveryReady = !revocationRecoveryLoading && !revocationRecoveryError;
  const canEditEmployees = canWriteSubscription && recoveryReady && !employeeReadWarning
    && !unconfirmedInvitation && !unconfirmedAccountUpdate && !unconfirmedRevocation;
  const canRevokeTarget = canWriteSubscription && recoveryReady && !employeeReadWarning && !unconfirmedInvitation && !unconfirmedAccountUpdate
    && (!unconfirmedRevocation || unconfirmedRevocation.id === revokeTarget);
  const stationName = (id: string) => stations.find((s) => s.id === id)?.name ?? id.slice(0, 8);

  const selected = (event: React.ChangeEvent<HTMLSelectElement>): string[] =>
    Array.from(event.target.selectedOptions).map((option) => option.value);

  const submitInvite = async () => {
    if (!canEditEmployees || busy) return;
    if (!f.name.trim() || !f.email.trim()) return notify('error', 'Remplissez le nom et l’adresse e-mail.');
    if (f.stationIds.length === 0) return notify('error', 'Affectez au moins une station.');
    setBusy(true);
    try {
      await inviteUser({
        fullName: f.name, email: f.email, phone: f.phone,
        role: f.role, stationIds: f.stationIds,
      });
      setOpen(false);
      setF({ name: '', email: '', phone: '', role: 'caissier',
        stationIds: defaultStation ? [defaultStation] : [] });
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Invitation impossible.');
    } finally { setBusy(false); }
  };

  const openEdit = (id: string) => {
    if (!canEditEmployees || busy) return;
    const user = state.users.find((u) => u.id === id);
    if (!user) return;
    setEdit({
      role: INVITABLE.includes(user.role) ? user.role : 'caissier',
      active: user.active,
      stationIds: user.stationIds ?? (user.stationId ? [user.stationId] : []),
    });
    setEditingId(id);
  };

  const submitEdit = async () => {
    if (!editing || !canEditEmployees || busy) return;
    if (edit.stationIds.length === 0) return notify('error', 'Affectez au moins une station.');
    setBusy(true);
    try {
      await updateUser({
        userId: editing.id,
        role: editing.role === 'proprietaire' ? undefined : edit.role,
        active: edit.active,
        stationIds: canAssign ? edit.stationIds : undefined,
      });
      setEditingId(null);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Mise à jour impossible.');
    } finally { setBusy(false); }
  };

  const submitReset = async () => {
    if (!resetUser || !canEditEmployees || busy) return;
    setBusy(true);
    try {
      await requestPasswordReset(resetUser.email);
      setResetTarget(null);
      notify('success', 'Lien de réinitialisation envoyé si ce compte existe.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Réinitialisation impossible.');
    } finally { setBusy(false); }
  };

  const submitRevoke = async () => {
    if (!revoking || !canRevokeTarget || !canInvite || !canDisable || busy) return;
    setBusy(true);
    try {
      await revokeInvitation(revoking.id);
      setRevokeTarget(null);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Révocation impossible.');
    } finally { setBusy(false); }
  };

  const reloadEmployees = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await refreshEmployeeData();
      notify('success', 'Comptes et invitations actualisés.');
    } catch {
      notify('error', 'Actualisation incomplète. Réessayez avant toute action.');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title="Employés" subtitle="Comptes et rôles, affectations multi-stations, invitations, activation / désactivation et liens de réinitialisation Supabase Auth."
        actions={canInvite ? <button className="wg-btn wg-btn-primary" disabled={!canEditEmployees || busy} onClick={() => setOpen(true)}><FiPlus /> Inviter un employé</button> : null} />

      {revocationRecoveryLoading && <div role="status" className="mb-5"><Alert kind="info">Vérification des révocations précédentes dans cet onglet…</Alert></div>}
      {revocationRecoveryError && <div role="alert" className="mb-5"><Alert kind="warn">
        {revocationRecoveryError} Les actions sur les comptes sont bloquées dans cet onglet ; ne supprimez pas le stockage avant vérification.
      </Alert></div>}
      {employeeReadWarning && <div role="alert" className="mb-5"><Alert kind="warn">
        {employeeReadWarning} Les états affichés peuvent être périmés.{' '}
        <button type="button" className="wg-btn wg-btn-ghost !px-2 !py-1" disabled={busy} onClick={() => { void reloadEmployees(); }}>
          {busy ? 'Actualisation en cours…' : 'Actualiser les comptes et invitations'}
        </button>
      </Alert></div>}
      {unconfirmedInvitation && <div role="alert" className="mb-5"><Alert kind="warn">
        {unconfirmedInvitation.message} Les actions sur les comptes sont bloquées dans cette session ; après vérification par le support, rechargez la page.
      </Alert></div>}
      {unconfirmedAccountUpdate && <div role="alert" className="mb-5"><Alert kind="warn">
        {unconfirmedAccountUpdate.message} Les actions sur les comptes sont bloquées dans cette session ; après vérification par le support, rechargez la page.
      </Alert></div>}
      {unconfirmedRevocation && <div role="alert" className="mb-5"><Alert kind="warn">
        {unconfirmedRevocation.message}{' '}
        <button type="button" className="wg-btn wg-btn-ghost !px-2 !py-1"
          disabled={busy || !recoveryReady || !canWriteSubscription || Boolean(employeeReadWarning) || Boolean(unconfirmedInvitation) || Boolean(unconfirmedAccountUpdate) || !canInvite || !canDisable
            || !invitations.some((invitation) => invitation.id === unconfirmedRevocation.id)}
          onClick={() => setRevokeTarget(unconfirmedRevocation.id)}>Reprendre la même révocation</button>
      </Alert></div>}
      <div className="mb-5"><Alert kind="info">Aucun mot de passe n’est stocké dans WashGuard. Un nouvel employé reçoit une invitation et définit son mot de passe via Supabase Auth ; un mot de passe oublié se réinitialise avec un lien e-mail signé, jamais avec un mot de passe provisoire.</Alert></div>
      {authKind === 'local' && <div className="mb-5"><Alert kind="warn">Mode démonstration locale : aucun e-mail n’est envoyé. Le lien de réinitialisation réel est disponible avec la source Supabase.</Alert></div>}

      <Card className="!p-0 overflow-hidden">
        <div className="wg-scroll-x">
          <table>
            <thead><tr>
              <th className="wg-th">Employé</th><th className="wg-th">Rôle</th><th className="wg-th">Téléphone</th>
              <th className="wg-th">Stations</th><th className="wg-th">Créé le</th><th className="wg-th">Activité</th>
              <th className="wg-th">Commission</th><th className="wg-th">État</th><th className="wg-th">Actions</th>
            </tr></thead>
            <tbody>
              {state.users.map((u) => {
                const washes = state.washes.filter((w) => w.employeeId === u.id && w.status !== 'cancelled');
                const ids = u.stationIds ?? (u.stationId ? [u.stationId] : []);
                return (
                  <tr key={u.id}>
                    <td className="wg-td"><p className="font-bold">{u.name}</p><p className="wg-muted text-xs">{u.email}</p></td>
                    <td className="wg-td"><Badge tone={u.role === 'proprietaire' ? 'accent' : 'neutral'}>{ROLE_LABELS[u.role]}</Badge></td>
                    <td className="wg-td">{u.phone || '—'}</td>
                    <td className="wg-td"><div className="flex flex-wrap gap-1">{ids.length ? ids.map((id) => <Badge key={id}>{stationName(id)}</Badge>) : <span className="wg-muted text-xs">—</span>}</div></td>
                    <td className="wg-td">{formatDate(u.createdAt)}</td>
                    <td className="wg-td">{washes.length} lavage(s) · {formatFCFA(washes.reduce((sum, w) => sum + w.total, 0))}</td>
                    <td className="wg-td">
                      {isLocalStockDemo ? <>
                        <input type="number" min="0" max="100" placeholder="Barème station" className="wg-input !w-28 !py-1 text-xs"
                          disabled={!canEditEmployees || busy} value={u.commissionRateOverride ?? ''} onChange={(e) => { const rate = e.target.value === '' ? null : Number(e.target.value); void safe(() => updateEmployee(u.id, { commissionRateOverride: rate })); }} />
                        <p className="wg-muted mt-1 text-[10px]">Vide = barème de la station</p>
                      </> : <p className="wg-muted text-xs">Réglage individuel indisponible ici en mode connecté.</p>}
                    </td>
                    <td className="wg-td"><Badge tone={u.active ? 'success' : 'danger'}>{u.active ? 'Actif' : 'Désactivé'}</Badge></td>
                    <td className="wg-td">
                      <div className="flex gap-1.5">
                        {canReset && <button className="wg-btn wg-btn-ghost !px-2 !py-1 text-[11px]" disabled={!canEditEmployees || busy} title="Envoyer un lien de réinitialisation" onClick={() => setResetTarget(u.id)}><FiKey /></button>}
                        {canManage && u.role !== 'proprietaire' && <button className="wg-btn wg-btn-ghost !px-2 !py-1 text-[11px]" disabled={!canEditEmployees || busy} title="Rôle, état et stations" onClick={() => openEdit(u.id)}><FiSettings /></button>}
                        {canDisable && u.role !== 'proprietaire' && (
                          <button className="wg-btn wg-btn-ghost !px-2 !py-1 text-[11px]" disabled={!canEditEmployees || busy} title={u.active ? 'Désactiver' : 'Activer'}
                            onClick={() => safe(() => updateUser({ userId: u.id, active: !u.active }))}>
                            {u.active ? <FiUserX /> : <FiUserCheck />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {canManage && (
        <Card className="mt-5">
          <h2 className="mb-3 text-sm font-bold">Invitations</h2>
          {invitations.length === 0 ? <p className="wg-muted text-xs">Aucune invitation enregistrée.</p> : (
            <div className="wg-scroll-x">
              <table>
                <thead><tr><th className="wg-th">E-mail</th><th className="wg-th">Rôle</th><th className="wg-th">Stations</th><th className="wg-th">Expire le</th><th className="wg-th">État</th><th className="wg-th">Action</th></tr></thead>
                <tbody>{invitations.map((i) => (
                  <tr key={i.id}>
                    <td className="wg-td">{i.email}</td>
                    <td className="wg-td"><Badge>{ROLE_LABELS[i.role]}</Badge></td>
                    <td className="wg-td">{i.stationIds.map(stationName).join(', ') || '—'}</td>
                    <td className="wg-td">{formatDate(i.expiresAt)}</td>
                    <td className="wg-td"><Badge tone={i.revokedAt ? 'danger' : i.acceptedAt ? 'success' : 'warn'}>{i.revokedAt ? 'Révoquée' : i.acceptedAt ? 'Acceptée' : 'En attente'}</Badge></td>
                    <td className="wg-td">{!i.acceptedAt && !i.revokedAt && canInvite && canDisable && (
                      <button className="wg-btn wg-btn-ghost !px-2 !py-1 text-[11px]" disabled={!canEditEmployees || busy} title="Révoquer" onClick={() => setRevokeTarget(i.id)}><FiTrash2 /></button>
                    )}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal open={open} onClose={() => { if (!busy) setOpen(false); }} title="Inviter un employé">
        <fieldset disabled={!canEditEmployees || busy} className="min-w-0 space-y-3">
          <Input label="Nom complet *" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Adresse e-mail *" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <Input label="Téléphone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Rôle" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
              {INVITABLE.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
            </Select>
            <Select label="Stations * (sélection multiple)" multiple size={Math.min(4, Math.max(2, stations.length))}
              value={f.stationIds} onChange={(e) => setF({ ...f, stationIds: selected(e) })}>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <p className="wg-muted text-xs">Le collaborateur reçoit un lien pour définir son propre mot de passe. Aucun mot de passe provisoire n’est créé.</p>
        </fieldset>
        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" disabled={busy} onClick={() => setOpen(false)}><FiX /> Annuler</button>
          <button className="wg-btn wg-btn-primary" disabled={busy || !canEditEmployees} onClick={() => { void submitInvite(); }}><FiPlus /> {busy ? 'Invitation en cours…' : 'Envoyer l’invitation'}</button>
        </div>
      </Modal>

      <Modal open={Boolean(revoking)} onClose={() => { if (!busy) setRevokeTarget(null); }} title="Révoquer l’invitation">
        <p className="text-sm">Révoquer l’invitation de <strong>{revoking?.email}</strong> désactive aussi son accès à l’application.</p>
        {authKind === 'supabase' ? (
          <p className="wg-muted mt-3 text-xs">Le compte, le lien et les sessions Supabase Auth ne sont pas supprimés. Réactiver le compte peut lui rendre l’accès. Une invitation ancienne sans compte lié nécessite une vérification par le support.</p>
        ) : (
          <p className="wg-muted mt-3 text-xs">En démonstration, aucun e-mail ni compte Auth réel n’est créé.</p>
        )}
        {!canWriteSubscription && <p className="mt-3 text-xs text-amber-500">Abonnement en lecture seule : révocation indisponible.</p>}
        {unconfirmedRevocation?.id === revokeTarget && <div className="mt-3"><Alert kind="warn">{unconfirmedRevocation.message}</Alert></div>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" disabled={busy} onClick={() => setRevokeTarget(null)}>Annuler</button>
          <button className="wg-btn wg-btn-danger" disabled={busy || !canRevokeTarget || !canInvite || !canDisable} onClick={() => { void submitRevoke(); }}>
            {busy ? 'Révocation en cours…' : unconfirmedRevocation?.id === revokeTarget ? 'Vérifier / réessayer la même révocation' : 'Révoquer et désactiver'}
          </button>
        </div>
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => { if (!busy) setEditingId(null); }} title={`Modifier le compte — ${editing?.name ?? ''}`}>
        <fieldset disabled={!canEditEmployees || busy} className="min-w-0 space-y-3">
          <Select label="Rôle" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Role })}>
            {INVITABLE.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
          </Select>
          {canAssign && <Select label="Stations (sélection multiple)" multiple size={Math.min(4, Math.max(2, stations.length))}
            value={edit.stationIds} onChange={(e) => setEdit({ ...edit, stationIds: selected(e) })}>
            {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>}
          <label className="flex items-center gap-2 text-xs font-semibold">
            <input type="checkbox" className="h-4 w-4 accent-sky-500" checked={edit.active}
              onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />
            Compte actif
          </label>
        </fieldset>
        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" disabled={busy} onClick={() => setEditingId(null)}>Annuler</button>
          <button className="wg-btn wg-btn-primary" disabled={busy || !canEditEmployees} onClick={() => { void submitEdit(); }}><FiSettings /> {busy ? 'Enregistrement en cours…' : 'Enregistrer'}</button>
        </div>
      </Modal>

      <Modal open={Boolean(resetUser)} onClose={() => { if (!busy) setResetTarget(null); }} title="Lien de réinitialisation">
        <p className="wg-muted mb-4 text-sm">Un lien signé sera envoyé à <strong>{resetUser?.email}</strong>. Vous ne verrez jamais le nouveau mot de passe.</p>
        {!canWriteSubscription && <Alert kind="warn">En lecture seule, l’envoi depuis cet écran est suspendu. Chaque utilisateur peut toujours récupérer son propre accès depuis la page de connexion.</Alert>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" disabled={busy} onClick={() => setResetTarget(null)}>Annuler</button>
          <button className="wg-btn wg-btn-primary" disabled={busy || !canEditEmployees} onClick={() => { void submitReset(); }}><FiMail /> {busy ? 'Envoi en cours…' : 'Envoyer le lien'}</button>
        </div>
      </Modal>
    </div>
  );
}
