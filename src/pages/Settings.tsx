import React, { useState } from 'react';
import { FiDatabase, FiLock, FiSave, FiShield, FiTrash2 } from 'react-icons/fi';
import { useStore, DEFAULT_DAYS } from '../lib/store';
import { isSupabaseConfigured as sbConfigured } from '../lib/supabase';
import { formatDateTime } from '../lib/format';
import { Alert, Badge, Breadcrumbs, Card, Input, PageHeader, SectionTitle } from '../components/ui';

export default function Settings() {
  const { state, updateStation, updateCompany, setHours, resetAll, updateMyPassword, notify } = useStore();
  const st = state.station;
  const co = state.company;
  const [stationDraft, setStationDraft] = useState({ name: st?.name ?? '', address: st?.address ?? '', city: st?.city ?? '', phone: st?.phone ?? '', logoUrl: st?.logoUrl ?? '' });
  const [companyDraft, setCompanyDraft] = useState({ name: co?.name ?? '', city: co?.city ?? '', phone: co?.phone ?? '' });
  const [rules, setRules] = useState({ cashRequiresOpen: st?.cashRequiresOpen ?? true, maxCashierDiscount: st?.maxCashierDiscount ?? 0, commissionRate: st?.commissionRate ?? 0, monthlyTarget: st?.monthlyTarget ?? 0 });
  const [hours, setLocalHours] = useState(st?.hours?.length ? st.hours : DEFAULT_DAYS.map((h) => ({ ...h })));

  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const [pwdLoading, setPwdLoading] = useState(false);

  const handlePasswordChange = async () => {
    if (!passwordForm.current || !passwordForm.next || !passwordForm.confirm) {
      notify('error', 'Remplissez tous les champs du mot de passe.');
      return;
    }
    if (passwordForm.next !== passwordForm.confirm) {
      notify('error', 'Le nouveau mot de passe et sa confirmation ne correspondent pas.');
      return;
    }
    if (passwordForm.next.length < 8) {
      notify('error', 'Le mot de passe doit comporter au moins 8 caractères.');
      return;
    }
    setPwdLoading(true);
    try {
      await updateMyPassword(passwordForm.current, passwordForm.next);
      setPasswordForm({ current: '', next: '', confirm: '' });
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Erreur lors de la modification');
    } finally {
      setPwdLoading(false);
    }
  };

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Administration', to: '/app/parametres' }, { label: 'Paramètres station' }]} />
      <PageHeader title="Paramètres" subtitle="Identité de la station, horaires, devise, logo, règles de caisse, barème, objectif, entreprise et journal des opérations sensibles."
        actions={<Badge tone="accent">Devise : FCFA</Badge>} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle hint="Apparaît sur les fiches et les rapports.">Identité de la station</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Nom" value={stationDraft.name} onChange={(e) => setStationDraft({ ...stationDraft, name: e.target.value })} />
            <Input label="Adresse" value={stationDraft.address} onChange={(e) => setStationDraft({ ...stationDraft, address: e.target.value })} />
            <Input label="Ville" value={stationDraft.city} onChange={(e) => setStationDraft({ ...stationDraft, city: e.target.value })} />
            <Input label="Téléphone" value={stationDraft.phone} onChange={(e) => setStationDraft({ ...stationDraft, phone: e.target.value })} />
            <Input label="Logo (URL)" value={stationDraft.logoUrl} onChange={(e) => setStationDraft({ ...stationDraft, logoUrl: e.target.value })} />
            <Input label="Devise" value="FCFA" disabled hint="La devise est fixée en FCFA pour toutes les stations." />
          </div>
          <button className="wg-btn wg-btn-primary mt-4" onClick={() => { updateStation({ ...stationDraft, logoUrl: stationDraft.logoUrl.trim() || null }); notify('success', 'Identité de la station enregistrée.'); }}><FiSave /> Enregistrer</button>
        </Card>

        <Card>
          <SectionTitle hint="Règles appliquées aux fiches et aux encaissements.">Caisse et remises</SectionTitle>
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-4" style={{ borderColor: 'var(--wg-border)' }}>
            <div><p className="text-sm font-bold">Espèces : caisse ouverte obligatoire</p><p className="wg-muted text-xs">Désactivable station par station. Mobile Money enregistrable à tout moment.</p></div>
            <input type="checkbox" className="h-5 w-5 accent-sky-500" checked={rules.cashRequiresOpen} onChange={(e) => setRules({ ...rules, cashRequiresOpen: e.target.checked })} />
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input label="Remise maximale du caissier (FCFA)" type="number" min="0" value={rules.maxCashierDiscount} onChange={(e) => setRules({ ...rules, maxCashierDiscount: Number(e.target.value) })} />
            <Input label="Barème des commissions (%)" type="number" min="0" max="100" value={rules.commissionRate} onChange={(e) => setRules({ ...rules, commissionRate: Number(e.target.value) })} />
            <Input label="Objectif de CA du mois (FCFA)" type="number" min="0" value={rules.monthlyTarget} onChange={(e) => setRules({ ...rules, monthlyTarget: Number(e.target.value) })} />
          </div>
          <button className="wg-btn wg-btn-primary mt-4" onClick={() => { updateStation({ cashRequiresOpen: rules.cashRequiresOpen, maxCashierDiscount: Math.max(0, rules.maxCashierDiscount), commissionRate: Math.min(100, Math.max(0, rules.commissionRate)), monthlyTarget: Math.max(0, rules.monthlyTarget) }); notify('success', 'Règles enregistrées.'); }}><FiSave /> Enregistrer</button>
        </Card>

        <Card>
          <SectionTitle hint="Sept jours déclarés ; cochez « Fermé » pour les jours sans activité.">Horaires d’ouverture</SectionTitle>
          <div className="space-y-2">
            {hours.map((h, i) => (
              <div key={h.day} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--wg-border)' }}>
                <span className="w-20 font-bold">{h.day}</span>
                <input type="time" className="wg-input !w-28 !py-1" disabled={h.closed} value={h.open} onChange={(e) => setLocalHours((hs) => hs.map((x, idx) => idx === i ? { ...x, open: e.target.value } : x))} />
                <span className="wg-muted">→</span>
                <input type="time" className="wg-input !w-28 !py-1" disabled={h.closed} value={h.close} onChange={(e) => setLocalHours((hs) => hs.map((x, idx) => idx === i ? { ...x, close: e.target.value } : x))} />
                <label className="wg-muted ml-auto flex items-center gap-1.5"><input type="checkbox" className="accent-sky-500" checked={h.closed} onChange={(e) => setLocalHours((hs) => hs.map((x, idx) => idx === i ? { ...x, closed: e.target.checked } : x))} /> Fermé</label>
              </div>
            ))}
          </div>
          <button className="wg-btn wg-btn-primary mt-4" onClick={() => { setHours(hours); notify('success', 'Horaires enregistrés.'); }}><FiSave /> Enregistrer les horaires</button>
        </Card>

        <Card>
          <SectionTitle hint="Raison sociale et coordonnées de l’entreprise.">Entreprise</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Nom de l’entreprise" value={companyDraft.name} onChange={(e) => setCompanyDraft({ ...companyDraft, name: e.target.value })} />
            <Input label="Ville" value={companyDraft.city} onChange={(e) => setCompanyDraft({ ...companyDraft, city: e.target.value })} />
            <Input label="Téléphone" value={companyDraft.phone} onChange={(e) => setCompanyDraft({ ...companyDraft, phone: e.target.value })} />
          </div>
          <button className="wg-btn wg-btn-primary mt-4" onClick={() => { updateCompany(companyDraft); notify('success', 'Entreprise enregistrée.'); }}><FiSave /> Enregistrer</button>

          <div className="mt-6 border-t pt-5" style={{ borderColor: 'var(--wg-border)' }}>
            <SectionTitle hint="Les opérations sensibles sont conservées, jamais effacées.">Journal des opérations sensibles</SectionTitle>
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {state.auditLogs.length === 0 ? <p className="wg-muted text-xs">Aucune opération sensible enregistrée.</p> : state.auditLogs.map((l) => (
                <div key={l.id} className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--wg-surface-2)' }}>
                  <div className="flex flex-wrap justify-between gap-2"><span className="font-bold">{l.action}</span><span className="wg-muted">{formatDateTime(l.at)}</span></div>
                  <p className="wg-muted mt-0.5">{l.actor} · {l.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Sécurité et Mot de passe personnel */}
        <Card className="lg:col-span-2">
          <SectionTitle hint="Changement sécurisé du mot de passe de votre compte connecté.">Sécurité & Authentification personnelle</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-3 max-w-3xl">
            <Input
              label="Mot de passe actuel *"
              type="password"
              placeholder="••••••••"
              value={passwordForm.current}
              onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
            />
            <Input
              label="Nouveau mot de passe *"
              type="password"
              placeholder="8 caractères min."
              value={passwordForm.next}
              onChange={(e) => setPasswordForm({ ...passwordForm, next: e.target.value })}
            />
            <Input
              label="Confirmer le nouveau mot de passe *"
              type="password"
              placeholder="••••••••"
              value={passwordForm.confirm}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="wg-btn wg-btn-primary"
              onClick={handlePasswordChange}
              disabled={pwdLoading}
            >
              <FiLock /> {pwdLoading ? 'Mise à jour…' : 'Mettre à jour mon mot de passe'}
            </button>
            <p className="wg-muted text-xs">
              Connecté en tant que <strong>{state.session?.email}</strong> ({state.session?.name}).
            </p>
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <SectionTitle hint="État du branchement et données locales de démonstration.">Environnement</SectionTitle>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={sbConfigured ? 'success' : 'warn'}><FiDatabase /> Supabase : {sbConfigured ? 'configuré' : 'non branché (mode local)'}</Badge>
          <Badge><FiShield /> Thème sombre par défaut, clair disponible</Badge>
          <Badge><FiLock /> Montants FCFA · dates jj/mm/aaaa</Badge>
        </div>
        <p className="wg-muted mt-3 text-xs leading-relaxed">Le frontend tourne aujourd’hui sur une couche de données locale qui reproduit le contrat du serveur (mise en route constatée, 409 onboarding_incomplete, caisse, commissions). Les données sont conservées dans ce navigateur uniquement.</p>
        <button className="wg-btn wg-btn-danger mt-4" onClick={() => { if (window.confirm('Effacer toutes les données locales de démonstration et repartir à vide ?')) { resetAll(); window.location.href = '/'; } }}><FiTrash2 /> Réinitialiser la démonstration</button>
      </Card>
    </div>
  );
}
