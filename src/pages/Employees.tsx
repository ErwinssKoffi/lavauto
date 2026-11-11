import React, { useState } from 'react';
import { FiKey, FiPlus, FiUserCheck, FiUserX, FiX } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { formatDate, formatFCFA } from '../lib/format';
import { ROLE_LABELS, type Role } from '../types';
import { Alert, Badge, Card, Input, Modal, PageHeader, Select, useSafeAction } from '../components/ui';

export default function Employees() {
  const { state, addEmployee, updateEmployee, resetPassword, notify } = useStore();
  const safe = useSafeAction();
  const [open, setOpen] = useState(false);
  const [resetId, setResetId] = useState<string | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [f, setF] = useState({ name: '', email: '', phone: '', role: 'caissier' as Role, password: '' });
  const reset = state.users.find((u) => u.id === resetId);

  return (
    <div>
      <PageHeader title="Employés" subtitle="Comptes et rôles, activation / désactivation, réinitialisation de mot de passe et activité enregistrée par employé."
        actions={<button className="wg-btn wg-btn-primary" onClick={() => setOpen(true)}><FiPlus /> Ajouter un employé</button>} />

      <div className="mb-5"><Alert kind="info">C’est ici — et seulement ici — que le propriétaire réinitialise un mot de passe oublié. WashGuard n’envoie aucun e-mail.</Alert></div>

      <Card className="!p-0 overflow-hidden">
        <div className="wg-scroll-x">
          <table>
            <thead><tr><th className="wg-th">Employé</th><th className="wg-th">Rôle</th><th className="wg-th">Téléphone</th><th className="wg-th">Créé le</th><th className="wg-th">Activité</th><th className="wg-th">Commission</th><th className="wg-th">État</th><th className="wg-th">Actions</th></tr></thead>
            <tbody>
              {state.users.map((u) => {
                const washes = state.washes.filter((w) => w.employeeId === u.id && w.status !== 'annule');
                return (
                  <tr key={u.id}>
                    <td className="wg-td"><p className="font-bold">{u.name}</p><p className="wg-muted text-xs">{u.email}</p></td>
                    <td className="wg-td"><Badge tone={u.role === 'proprietaire' ? 'accent' : 'neutral'}>{ROLE_LABELS[u.role]}</Badge></td>
                    <td className="wg-td">{u.phone || '—'}</td>
                    <td className="wg-td">{formatDate(u.createdAt)}</td>
                    <td className="wg-td">{washes.length} lavage(s) · {formatFCFA(washes.reduce((s, w) => s + w.total, 0))}</td>
                    <td className="wg-td">
                      <input type="number" min="0" max="100" placeholder="Barème station" className="wg-input !w-28 !py-1 text-xs"
                        value={u.commissionRateOverride ?? ''} onChange={(e) => updateEmployee(u.id, { commissionRateOverride: e.target.value === '' ? null : Number(e.target.value) })} />
                      <p className="wg-muted mt-1 text-[10px]">Vide = barème de la station</p>
                    </td>
                    <td className="wg-td"><Badge tone={u.active ? 'success' : 'danger'}>{u.active ? 'Actif' : 'Désactivé'}</Badge></td>
                    <td className="wg-td">
                      <div className="flex gap-1.5">
                        <button className="wg-btn wg-btn-ghost !px-2 !py-1 text-[11px]" title="Réinitialiser le mot de passe" onClick={() => { setResetId(u.id); setNewPwd(''); }}><FiKey /></button>
                        {u.role !== 'proprietaire' && (
                          <button className="wg-btn wg-btn-ghost !px-2 !py-1 text-[11px]" title={u.active ? 'Désactiver' : 'Activer'} onClick={() => updateEmployee(u.id, { active: !u.active })}>
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

      <Modal open={open} onClose={() => setOpen(false)} title="Ajouter un employé">
        <div className="space-y-3">
          <Input label="Nom complet *" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Adresse e-mail *" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <Input label="Téléphone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Rôle" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
              <option value="gerant">Gérant</option><option value="caissier">Caissier</option>
            </Select>
            <Input label="Mot de passe provisoire *" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </div>
          <p className="wg-muted text-xs">Le propriétaire peut réinitialiser ce mot de passe à tout moment depuis cette page.</p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" onClick={() => setOpen(false)}><FiX /> Annuler</button>
          <button className="wg-btn wg-btn-primary" onClick={() => safe(() => { if (!f.name.trim() || !f.email.trim() || !f.password) return notify('error', 'Remplissez tous les champs obligatoires.'); addEmployee(f); setOpen(false); setF({ name: '', email: '', phone: '', role: 'caissier', password: '' }); })}><FiPlus /> Créer le compte</button>
        </div>
      </Modal>

      <Modal open={Boolean(reset)} onClose={() => setResetId(null)} title={`Réinitialiser le mot de passe — ${reset?.name ?? ''}`}>
        <p className="wg-muted mb-4 text-sm">Aucun e-mail n’est envoyé. Communiquez le nouveau mot de passe directement à l’employé.</p>
        <Input label="Nouveau mot de passe *" type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" onClick={() => setResetId(null)}>Annuler</button>
          <button className="wg-btn wg-btn-primary" onClick={() => { if (reset && newPwd.length >= 8) { resetPassword(reset.id, newPwd); setResetId(null); notify('success', 'Mot de passe réinitialisé (opération journalisée).'); } else notify('error', '8 caractères minimum.'); }}><FiKey /> Réinitialiser</button>
        </div>
      </Modal>
    </div>
  );
}
