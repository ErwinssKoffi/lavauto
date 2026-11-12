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
    state, identity, invitations, authKind, notify,
    inviteUser, updateUser, updateEmployee, requestPasswordReset, revokeInvitation,
  } = useStore();
  const { can } = usePermissions();
  const safe = useSafeAction();
  const stations = identity?.stations ?? [];
  const defaultStation = stations[0]?.id ?? state.station?.id ?? '';
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<string | null>(null);
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
  const canInvite = can('employees.invite');
  const canManage = can('employees.manage');
  const canDisable = can('employees.disable');
  const canAssign = can('employees.assign_stations');
  const canReset = can('users.reset_password');
  const stationName = (id: string) => stations.find((s) => s.id === id)?.name ?? id.slice(0, 8);

  const selected = (event: React.ChangeEvent<HTMLSelectElement>): string[] =>
    Array.from(event.target.selectedOptions).map((option) => option.value);

  const submitInvite = async () => {
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
    if (!editing) return;
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
    if (!resetUser) return;
    setBusy(true);
    try {
      await requestPasswordReset(resetUser.email);
      setResetTarget(null);
      notify('success', 'Lien de réinitialisation envoyé si ce compte existe.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Réinitialisation impossible.');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title="Employés" subtitle="Comptes et rôles, affectations multi-stations, invitations, activation / désactivation et liens de réinitialisation Supabase Auth."
        actions={canInvite ? <button className="wg-btn wg-btn-primary" onClick={() => setOpen(true)}><FiPlus /> Inviter un employé</button> : null} />

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
                      <input type="number" min="0" max="100" placeholder="Barème station" className="wg-input !w-28 !py-1 text-xs"
                        value={u.commissionRateOverride ?? ''} onChange={(e) => updateEmployee(u.id, { commissionRateOverride: e.target.value === '' ? null : Number(e.target.value) })} />
                      <p className="wg-muted mt-1 text-[10px]">Vide = barème de la station</p>
                    </td>
                    <td className="wg-td"><Badge tone={u.active ? 'success' : 'danger'}>{u.active ? 'Actif' : 'Désactivé'}</Badge></td>
                    <td className="wg-td">
                      <div className="flex gap-1.5">
                        {canReset && <button className="wg-btn wg-btn-ghost !px-2 !py-1 text-[11px]" title="Envoyer un lien de réinitialisation" onClick={() => setResetTarget(u.id)}><FiKey /></button>}
                        {canManage && u.role !== 'proprietaire' && <button className="wg-btn wg-btn-ghost !px-2 !py-1 text-[11px]" title="Rôle, état et stations" onClick={() => openEdit(u.id)}><FiSettings /></button>}
                        {canDisable && u.role !== 'proprietaire' && (
                          <button className="wg-btn wg-btn-ghost !px-2 !py-1 text-[11px]" title={u.active ? 'Désactiver' : 'Activer'}
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
                    <td className="wg-td">{!i.acceptedAt && !i.revokedAt && canInvite && (
                      <button className="wg-btn wg-btn-ghost !px-2 !py-1 text-[11px]" title="Révoquer" onClick={() => safe(() => revokeInvitation(i.id))}><FiTrash2 /></button>
                    )}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Inviter un employé">
        <div className="space-y-3">
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
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" onClick={() => setOpen(false)}><FiX /> Annuler</button>
          <button className="wg-btn wg-btn-primary" disabled={busy} onClick={() => { void submitInvite(); }}><FiPlus /> Envoyer l’invitation</button>
        </div>
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => setEditingId(null)} title={`Modifier le compte — ${editing?.name ?? ''}`}>
        <div className="space-y-3">
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
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" onClick={() => setEditingId(null)}>Annuler</button>
          <button className="wg-btn wg-btn-primary" disabled={busy} onClick={() => { void submitEdit(); }}><FiSettings /> Enregistrer</button>
        </div>
      </Modal>

      <Modal open={Boolean(resetUser)} onClose={() => setResetTarget(null)} title="Lien de réinitialisation">
        <p className="wg-muted mb-4 text-sm">Un lien signé sera envoyé à <strong>{resetUser?.email}</strong>. Vous ne verrez jamais le nouveau mot de passe.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" onClick={() => setResetTarget(null)}>Annuler</button>
          <button className="wg-btn wg-btn-primary" disabled={busy} onClick={() => { void submitReset(); }}><FiMail /> Envoyer le lien</button>
        </div>
      </Modal>
    </div>
  );
}
