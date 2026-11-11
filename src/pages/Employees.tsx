import React, { useState } from 'react';
import { FiKey, FiMail, FiMapPin, FiPlus, FiUserCheck, FiUserPlus, FiUserX, FiX } from 'react-icons/fi';
import { useStore } from '../lib/store';
import { formatDate, formatFCFA } from '../lib/format';
import { ROLE_LABELS, type Role } from '../types';
import { Alert, Badge, Breadcrumbs, Card, Input, Modal, PageHeader, Select, useSafeAction } from '../components/ui';

export default function Employees() {
  const { state, assignedStations, inviteEmployee, updateEmployee, resetPassword, notify } = useStore();
  const safe = useSafeAction();
  const [open, setOpen] = useState(false);
  const [resetId, setResetId] = useState<string | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [f, setF] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'caissier' as Role,
    stationId: state.station?.id ?? '',
    password: '',
  });
  const reset = state.users.find((u) => u.id === resetId);
  const stationsList = assignedStations.length > 0 ? assignedStations : (state.station ? [state.station] : []);

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Ressources humaines', to: '/app/employes' }, { label: 'Équipe & Collaborateurs' }]} />
      <PageHeader
        title="Équipe & Collaborateurs"
        subtitle="Comptes, rôles RBAC (gérant, caissier, laveur), assignation par station, activation / désactivation et réinitialisation de mot de passe."
        actions={
          <button className="wg-btn wg-btn-primary" onClick={() => setOpen(true)}>
            <FiUserPlus /> Inviter un collaborateur
          </button>
        }
      />

      <div className="mb-5">
        <Alert kind="info">
          C’est ici — et seulement ici — que le propriétaire ou le gérant réinitialise un mot de passe oublié pour l'équipe. WashGuard n’envoie aucun e-mail pour préserver l'autonomie totale sur site.
        </Alert>
      </div>

      <Card className="!p-0 overflow-hidden">
        <div className="wg-scroll-x">
          <table>
            <thead>
              <tr>
                <th className="wg-th">Collaborateur</th>
                <th className="wg-th">Rôle RBAC</th>
                <th className="wg-th">Station assignée</th>
                <th className="wg-th">Téléphone</th>
                <th className="wg-th">Créé le</th>
                <th className="wg-th">Activité</th>
                <th className="wg-th">Commission</th>
                <th className="wg-th">État</th>
                <th className="wg-th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.users.map((u) => {
                const washes = state.washes.filter((w) => w.employeeId === u.id && w.status !== 'annule');
                const userStation = stationsList.find((s) => s.id === u.stationId);
                return (
                  <tr key={u.id}>
                    <td className="wg-td">
                      <p className="font-bold">{u.name}</p>
                      <p className="wg-muted text-xs">{u.email}</p>
                    </td>
                    <td className="wg-td">
                      <Badge tone={u.role === 'proprietaire' ? 'accent' : u.role === 'gerant' ? 'neutral' : 'neutral'}>
                        {ROLE_LABELS[u.role] ?? u.role}
                      </Badge>
                    </td>
                    <td className="wg-td">
                      <span className="flex items-center gap-1 text-xs text-slate-300">
                        <FiMapPin size={11} className="text-sky-400 shrink-0" />
                        {userStation?.name ?? (u.role === 'proprietaire' ? 'Toutes stations' : 'Station courante')}
                      </span>
                    </td>
                    <td className="wg-td">{u.phone || '—'}</td>
                    <td className="wg-td">{formatDate(u.createdAt)}</td>
                    <td className="wg-td">
                      {washes.length} lavage(s) · {formatFCFA(washes.reduce((s, w) => s + w.total, 0))}
                    </td>
                    <td className="wg-td">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        placeholder="Barème station"
                        className="wg-input !w-28 !py-1 text-xs"
                        value={u.commissionRateOverride ?? ''}
                        onChange={(e) =>
                          updateEmployee(u.id, {
                            commissionRateOverride: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                      <p className="wg-muted mt-1 text-[10px]">Vide = barème station</p>
                    </td>
                    <td className="wg-td">
                      <Badge tone={u.active ? 'success' : 'danger'}>{u.active ? 'Actif' : 'Désactivé'}</Badge>
                    </td>
                    <td className="wg-td">
                      <div className="flex gap-1.5">
                        <button
                          className="wg-btn wg-btn-ghost !px-2 !py-1 text-[11px]"
                          title="Réinitialiser le mot de passe"
                          onClick={() => {
                            setResetId(u.id);
                            setNewPwd('');
                          }}
                        >
                          <FiKey />
                        </button>
                        {u.role !== 'proprietaire' && (
                          <button
                            className="wg-btn wg-btn-ghost !px-2 !py-1 text-[11px]"
                            title={u.active ? 'Désactiver' : 'Activer'}
                            onClick={() => updateEmployee(u.id, { active: !u.active })}
                          >
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

      {/* Modal Inviter / Ajouter collaborateur */}
      <Modal open={open} onClose={() => setOpen(false)} title="Inviter un collaborateur">
        <div className="space-y-3">
          <Input
            label="Nom complet *"
            placeholder="Ex : Koffi Kouassi"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Adresse e-mail professionnelle *"
              type="email"
              placeholder="koffi@mastation.ci"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
            />
            <Input
              label="Téléphone"
              placeholder="+225 07 00 00 00"
              value={f.phone}
              onChange={(e) => setF({ ...f, phone: e.target.value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Rôle attribué (RBAC) *"
              value={f.role}
              onChange={(e) => setF({ ...f, role: e.target.value as Role })}
            >
              <option value="gerant">Gérant (Gestion complète & rapports)</option>
              <option value="caissier">Caissier (Encaissement & dépenses)</option>
              <option value="laveur">Laveur (File des lavages & commissions)</option>
            </Select>

            {stationsList.length > 1 ? (
              <Select
                label="Station assignée *"
                value={f.stationId}
                onChange={(e) => setF({ ...f, stationId: e.target.value })}
              >
                {stationsList.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name} ({st.city})
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                label="Station"
                value={state.station?.name ?? 'Station principale'}
                disabled
              />
            )}
          </div>

          <Input
            label="Mot de passe provisoire *"
            type="password"
            placeholder="8 caractères min."
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
          />

          <p className="wg-muted text-xs leading-relaxed">
            Le collaborateur utilisera cette adresse e-mail et ce mot de passe pour se connecter. Vous pourrez réinitialiser son mot de passe ou désactiver son accès à tout instant.
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" onClick={() => setOpen(false)}>
            <FiX /> Annuler
          </button>
          <button
            className="wg-btn wg-btn-primary"
            onClick={() =>
              safe(async () => {
                if (!f.name.trim() || !f.email.trim() || !f.password) {
                  return notify('error', 'Remplissez tous les champs obligatoires.');
                }
                if (f.password.length < 8) {
                  return notify('error', 'Le mot de passe doit comporter au moins 8 caractères.');
                }
                await inviteEmployee(f);
                setOpen(false);
                setF({
                  name: '',
                  email: '',
                  phone: '',
                  role: 'caissier',
                  stationId: state.station?.id ?? '',
                  password: '',
                });
              })
            }
          >
            <FiPlus /> Créer le compte collaborateur
          </button>
        </div>
      </Modal>

      {/* Modal Réinitialiser mot de passe */}
      <Modal
        open={Boolean(reset)}
        onClose={() => setResetId(null)}
        title={`Réinitialiser le mot de passe — ${reset?.name ?? ''}`}
      >
        <p className="wg-muted mb-4 text-sm leading-relaxed">
          Aucun e-mail n’est envoyé. Le mot de passe sera immédiatement mis à jour et actif pour <strong>{reset?.email}</strong>.
        </p>
        <Input
          label="Nouveau mot de passe provisoire *"
          type="password"
          placeholder="8 caractères minimum"
          value={newPwd}
          onChange={(e) => setNewPwd(e.target.value)}
        />
        <div className="mt-5 flex justify-end gap-2">
          <button className="wg-btn wg-btn-ghost" onClick={() => setResetId(null)}>
            Annuler
          </button>
          <button
            className="wg-btn wg-btn-primary"
            onClick={() => {
              if (reset && newPwd.length >= 8) {
                resetPassword(reset.id, newPwd);
                setResetId(null);
                notify('success', `Mot de passe de ${reset.name} réinitialisé.`);
              } else {
                notify('error', 'Le mot de passe doit comporter au moins 8 caractères.');
              }
            }}
          >
            <FiKey /> Confirmer la réinitialisation
          </button>
        </div>
      </Modal>
    </div>
  );
}
