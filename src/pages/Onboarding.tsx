import { readNumber } from '../lib/validation';
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FiAlertCircle, FiArrowRight, FiCheck, FiCheckCircle, FiClock, FiDollarSign,
  FiInfo, FiLock, FiPlus, FiSave, FiSettings, FiTrash2, FiTruck, FiUsers,
} from 'react-icons/fi';
import { useStore, DEFAULT_DAYS } from '../lib/store';
import type { OnboardingStep } from '../lib/store';
import { PAY_METHOD_LABELS, type DayHours, type PayMethod } from '../types';
import { formatFCFA } from '../lib/format';
import { StationLogoEditor } from '../components/StationLogoEditor';
import {
  Alert, Badge, Card, Input, PageHeader, Progress, SectionTitle, Select, useSafeAction,
} from '../components/ui';

const CATEGORY_SUGGESTIONS = ['Berline', '4×4 / SUV', 'Moto', 'Utilitaire', 'Minibus'];
const SERVICE_SUGGESTIONS = ['Lavage extérieur', 'Lavage intérieur', 'Lavage complet', 'Nettoyage des sièges', 'Lavage moteur'];
const METHODS: PayMethod[] = ['especes', 'mobile_money', 'carte', 'virement'];

function SaveButton({ onClick, label = 'Enregistrer' }: { onClick: () => void; label?: string }) {
  const safe = useSafeAction();
  return <button className="wg-btn wg-btn-primary mt-4" onClick={() => safe(onClick)}><FiSave /> {label}</button>;
}

function CompanyForm() {
  const { state, updateCompany, notify } = useStore();
  const [d, setD] = useState({ name: state.company?.name ?? '', city: state.company?.city ?? '', phone: state.company?.phone ?? '' });
  return (
    <div>
      <p className="wg-muted mb-4 text-sm">La raison sociale, la ville et le téléphone de l’entreprise. Ces données sont celles réellement enregistrées par le serveur.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Nom de l’entreprise *" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        <Input label="Ville *" value={d.city} onChange={(e) => setD({ ...d, city: e.target.value })} />
        <Input label="Téléphone *" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} />
      </div>
      <SaveButton onClick={() => { updateCompany(d); notify('success', 'Identité de l’entreprise enregistrée.'); }} />
    </div>
  );
}

function StationForm() {
  const { state, updateStation, notify } = useStore();
  const st = state.station;
  const [d, setD] = useState({ name: st?.name ?? '', address: st?.address ?? '', city: st?.city ?? '', phone: st?.phone ?? '' });
  return (
    <div>
      <p className="wg-muted mb-4 text-sm">Le nom et l’adresse apparaissent sur les fiches et les rapports.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Nom de la station *" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        <Input label="Adresse *" value={d.address} onChange={(e) => setD({ ...d, address: e.target.value })} placeholder="Rue, quartier, repère" />
        <Input label="Ville *" value={d.city} onChange={(e) => setD({ ...d, city: e.target.value })} />
        <Input label="Téléphone" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} />
      </div>
      <SaveButton onClick={() => { updateStation(d); notify('success', 'Identité de la station enregistrée.'); }} />
    </div>
  );
}

function HoursForm() {
  const { state, setHours, notify } = useStore();
  const [hours, setLocal] = useState<DayHours[]>(state.station?.hours?.length ? state.station.hours : DEFAULT_DAYS.map((h) => ({ ...h })));
  const update = (i: number, patch: Partial<DayHours>) => setLocal((hs) => hs.map((h, idx) => idx === i ? { ...h, ...patch } : h));
  return (
    <div>
      <p className="wg-muted mb-4 text-sm">Les sept jours doivent être déclarés. Cochez « Fermé » pour les jours sans activité ; au moins un jour doit rester ouvert.</p>
      <div className="space-y-2">
        {hours.map((h, i) => (
          <div key={h.day} className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--wg-border)' }}>
            <span className="w-24 text-xs font-bold">{h.day}</span>
            <input type="time" className="wg-input !w-32" value={h.open} disabled={h.closed} onChange={(e) => update(i, { open: e.target.value })} />
            <span className="wg-muted text-xs">→</span>
            <input type="time" className="wg-input !w-32" value={h.close} disabled={h.closed} onChange={(e) => update(i, { close: e.target.value })} />
            <label className="wg-muted ml-auto flex cursor-pointer items-center gap-2 text-xs">
              <input type="checkbox" checked={h.closed} onChange={(e) => update(i, { closed: e.target.checked })} className="accent-sky-500" /> Fermé
            </label>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="wg-btn wg-btn-primary" onClick={() => { setHours(hours); notify('success', 'Horaires enregistrés.'); }}><FiSave /> Enregistrer les horaires</button>
        <button className="wg-btn wg-btn-ghost" onClick={() => setLocal(DEFAULT_DAYS.map((h) => ({ ...h, closed: h.day === 'Dimanche' })))}><FiClock /> Semaine type (lundi–samedi)</button>
      </div>
    </div>
  );
}

function CategoriesForm() {
  const { state, addCategory, toggleCategory, removeCategory } = useStore();
  const [name, setName] = useState('');
  const add = (v: string) => { if (!v.trim()) return; addCategory(v); setName(''); };
  return (
    <div>
      <p className="wg-muted mb-4 text-sm">Les types de véhicules que vous lavez. Les libellés proposés ne sont que des raccourcis de saisie : rien n’est ajouté sans votre action.</p>
      <div className="flex flex-wrap gap-2">
        {CATEGORY_SUGGESTIONS.map((s) => <button key={s} className="wg-badge hover:wg-badge-accent" onClick={() => add(s)}><FiPlus /> {s}</button>)}
      </div>
      <div className="mt-4 flex gap-2">
        <input className="wg-input" placeholder="Nom d’une catégorie" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add(name))} />
        <button className="wg-btn wg-btn-primary" onClick={() => add(name)}><FiPlus /> Ajouter</button>
      </div>
      <div className="mt-5 space-y-2">
        {state.vehicleCategories.length === 0 && <EmptyLine text="Aucune catégorie enregistrée." />}
        {state.vehicleCategories.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm" style={{ borderColor: 'var(--wg-border)' }}>
            <FiTruck className="text-sky-400" />
            <span className="flex-1 font-medium">{c.name}</span>
            <Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? 'Active' : 'Désactivée'}</Badge>
            <button className="wg-btn wg-btn-ghost !px-2 !py-1 text-xs" onClick={() => toggleCategory(c.id)}>{c.active ? 'Désactiver' : 'Activer'}</button>
            <button className="wg-muted hover:text-red-400" onClick={() => removeCategory(c.id)} aria-label="Supprimer"><FiTrash2 size={15} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="wg-muted rounded-xl border border-dashed px-4 py-6 text-center text-xs" style={{ borderColor: 'var(--wg-border)' }}>{text}</div>;
}

function ServicesForm() {
  const { state, addService, updateService, removeService } = useStore();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const add = (n: string) => { if (!n.trim()) return; addService(n, desc); setName(''); setDesc(''); };
  return (
    <div>
      <p className="wg-muted mb-4 text-sm">Le catalogue est propre à votre station. Les prix se saisissent à l’étape suivante — aucun montant n’est suggéré.</p>
      <div className="flex flex-wrap gap-2">
        {SERVICE_SUGGESTIONS.map((s) => <button key={s} className="wg-badge hover:wg-badge-accent" onClick={() => add(s)}><FiPlus /> {s}</button>)}
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input className="wg-input" placeholder="Nom de la prestation" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="wg-input" placeholder="Description (facultative)" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <button className="wg-btn wg-btn-primary" onClick={() => add(name)}><FiPlus /> Ajouter</button>
      </div>
      <div className="mt-5 space-y-2">
        {state.services.length === 0 && <EmptyLine text="Aucune prestation enregistrée." />}
        {state.services.map((v) => (
          <div key={v.id} className="flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm" style={{ borderColor: 'var(--wg-border)' }}>
            <div className="min-w-0 flex-1"><p className="font-medium">{v.name}</p>{v.description && <p className="wg-muted truncate text-xs">{v.description}</p>}</div>
            <Badge tone={v.active ? 'success' : 'neutral'}>{v.active ? 'Active' : 'Désactivée'}</Badge>
            <button className="wg-btn wg-btn-ghost !px-2 !py-1 text-xs" onClick={() => updateService(v.id, { active: !v.active })}>{v.active ? 'Désactiver' : 'Activer'}</button>
            <button className="wg-muted hover:text-red-400" onClick={() => removeService(v.id)} aria-label="Supprimer"><FiTrash2 size={15} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PricesForm() {
  const { state, setPrice, notify } = useStore();
  const cats = state.vehicleCategories.filter((c) => c.active);
  const svcs = state.services.filter((s) => s.active);
  const total = cats.length * svcs.length;
  const filled = svcs.reduce((n, s) => n + cats.filter((c) => (s.prices[c.id] ?? 0) > 0).length, 0);
  return (
    <div>
      <p className="wg-muted mb-4 text-sm">Un prix en FCFA pour chaque couple prestation / catégorie. L’étape n’est constatée que lorsque toutes les cases sont renseignées.</p>
      <Alert kind="info">Les prix sont figés sur chaque fiche au moment de sa création : modifier cette grille ne change jamais les lavages déjà enregistrés.</Alert>
      {cats.length === 0 || svcs.length === 0 ? (
        <div className="mt-4"><EmptyLine text="Ajoutez d’abord au moins une catégorie et une prestation." /></div>
      ) : (
        <>
          <div className="mt-4 mb-2 flex items-center justify-between text-xs"><span className="wg-muted">{filled} / {total} prix renseignés</span><Progress value={filled} max={total} tone={filled === total ? 'success' : 'accent'} /></div>
          <div className="wg-scroll-x mt-3 rounded-xl border" style={{ borderColor: 'var(--wg-border)' }}>
            <table>
              <thead><tr><th className="wg-th">Prestation</th>{cats.map((c) => <th key={c.id} className="wg-th">{c.name}</th>)}</tr></thead>
              <tbody>
                {svcs.map((s) => (
                  <tr key={s.id}>
                    <td className="wg-td font-medium">{s.name}</td>
                    {cats.map((c) => (
                      <td key={c.id} className="wg-td">
                        <input type="number" min="0" step="500" placeholder="—" className="wg-input !w-32" value={s.prices[c.id] || ''}
                          onChange={(e) => { try { setPrice(s.id, c.id, readNumber(e.target.value)); } catch (error) { notify('error', error instanceof Error ? error.message : 'Prix invalide.'); } }} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="wg-muted mt-3 text-xs">Les montants sont enregistrés à chaque saisie.</p>
          {filled === total && <button className="wg-btn wg-btn-primary mt-4" onClick={() => notify('success', 'Grille tarifaire constatée complète.')}><FiCheck /> Vérifier la grille</button>}
        </>
      )}
    </div>
  );
}

function PaymentsForm() {
  const { state, updateStation, notify } = useStore();
  const [selected, setSelected] = useState<PayMethod[]>(state.station?.paymentMethods ?? []);
  const toggle = (m: PayMethod) => setSelected((s) => s.includes(m) ? s.filter((x) => x !== m) : [...s, m]);
  return (
    <div>
      <p className="wg-muted mb-4 text-sm">Sélectionnez les moyens de paiement acceptés. Par défaut, un encaissement en espèces exigera une caisse ouverte ; le Mobile Money peut être enregistré à tout moment.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {METHODS.map((m) => (
          <label key={m} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm ${selected.includes(m) ? 'border-sky-500 bg-sky-500/5' : ''}`} style={selected.includes(m) ? {} : { borderColor: 'var(--wg-border)' }}>
            <input type="checkbox" className="accent-sky-500" checked={selected.includes(m)} onChange={() => toggle(m)} />
            <span className="font-medium">{PAY_METHOD_LABELS[m]}</span>
            {selected.includes(m) && <FiCheck className="ml-auto text-sky-400" />}
          </label>
        ))}
      </div>
      <SaveButton onClick={() => { updateStation({ paymentMethods: selected }); notify('success', 'Moyens de paiement enregistrés.'); }} />
    </div>
  );
}

function TeamForm() {
  const { state } = useStore();
  const others = state.users.filter((u) => u.role !== 'proprietaire');
  return (
    <div>
      <p className="wg-muted mb-4 text-sm">Facultatif à l’ouverture : le compte propriétaire suffit. Vous pourrez ajouter l’équipe à tout moment depuis Employés.</p>
      <Card className="flex items-center gap-3">
        <FiUsers className="text-xl text-sky-400" />
        <div className="flex-1"><p className="text-sm font-bold">{others.length} autre(s) compte(s)</p><p className="wg-muted text-xs">Propriétaire : {state.users.find((u) => u.role === 'proprietaire')?.name ?? '—'}</p></div>
        <Link to="/app/employes" className="wg-btn wg-btn-ghost">Gérer l’équipe <FiArrowRight /></Link>
      </Card>
    </div>
  );
}

function LogoForm() {
  return (
    <div>
      <p className="wg-muted text-sm">Facultatif. Ajoutez le logo de la station dans le stockage privé.</p>
      <StationLogoEditor />
    </div>
  );
}

function CashRulesForm() {
  const { state, updateStation, notify } = useStore();
  const st = state.station;
  const [requires, setRequires] = useState(st?.cashRequiresOpen ?? true);
  const [max, setMax] = useState(st?.maxCashierDiscount ?? 0);
  return (
    <div>
      <p className="wg-muted mb-4 text-sm">Facultatif : des règles par défaut sont déjà appliquées. Elles restent modifiables dans Paramètres.</p>
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-4" style={{ borderColor: 'var(--wg-border)' }}>
        <div><p className="text-sm font-bold">Caisse ouverte obligatoire pour les espèces</p><p className="wg-muted text-xs">Désactivable station par station. Le Mobile Money reste enregistrable à tout moment.</p></div>
        <input type="checkbox" className="h-5 w-5 accent-sky-500" checked={requires} onChange={(e) => setRequires(e.target.checked)} />
      </label>
      <div className="mt-3"><Input label="Remise maximale du caissier (FCFA)" type="number" min="0" value={max} onChange={(e) => setMax(readNumber(e.target.value))} /></div>
      <SaveButton onClick={() => { updateStation({ cashRequiresOpen: requires, maxCashierDiscount: max }); notify('success', 'Règles de caisse enregistrées.'); }} />
    </div>
  );
}

function CommissionForm() {
  const { state, updateStation, notify } = useStore();
  const [rate, setRate] = useState(state.station?.commissionRate ?? 0);
  return (
    <div>
      <p className="wg-muted mb-4 text-sm">Barème appliqué aux lavages <strong>terminés</strong> de la période. Une exception peut être posée sur un compte depuis Employés.</p>
      <Input label="Barème de la station (%)" type="number" min="0" max="100" value={rate} onChange={(e) => setRate(readNumber(e.target.value))} hint="0 % tant que vous n’avez pas choisi : aucune commission n’est calculée." />
      <SaveButton onClick={() => { updateStation({ commissionRate: rate }); notify('success', 'Barème enregistré.'); }} />
    </div>
  );
}

function TargetForm() {
  const { state, updateStation, notify } = useStore();
  const [target, setTarget] = useState(state.station?.monthlyTarget ?? 0);
  return (
    <div>
      <p className="wg-muted mb-4 text-sm">Objectif de chiffre d’affaires du mois, suivi sur le tableau de bord.</p>
      <Input label="Objectif du mois (FCFA)" type="number" min="0" step="10000" value={target} onChange={(e) => setTarget(readNumber(e.target.value))} hint={target > 0 ? `Soit ${formatFCFA(target)}.` : 'Aucun objectif fixé.'} />
      <SaveButton onClick={() => { updateStation({ monthlyTarget: target }); notify('success', 'Objectif enregistré.'); }} />
    </div>
  );
}

function ActivationForm() {
  const { state, activateStation, missing, notify } = useStore();
  const safe = useSafeAction();
  const navigate = useNavigate();
  const done = state.station?.activated;
  const blockers = missing;
  return (
    <div>
      {done ? (
        <div className="text-center">
          <FiCheckCircle className="mx-auto text-5xl text-emerald-400" />
          <h3 className="mt-4 text-lg font-bold">Station activée</h3>
          <p className="wg-muted mx-auto mt-2 max-w-md text-sm">L’exploitation est ouverte : fiches, encaissements, caisse et dépenses sont disponibles.</p>
          <p className="wg-muted mt-1 text-xs">Activée le {state.station?.activatedAt ? new Date(state.station.activatedAt).toLocaleDateString('fr-FR') : '—'}</p>
          <Link to="/app/tableau-de-bord" className="wg-btn wg-btn-primary mt-5">Aller au tableau de bord <FiArrowRight /></Link>
        </div>
      ) : (
        <>
          <p className="wg-muted mb-4 text-sm">L’activation constate les étapes obligatoires sur vos données. Elle ouvre l’exploitation et lève le <code className="text-amber-400">409 onboarding_incomplete</code>.</p>
          {blockers.length > 0 ? (
            <Alert kind="warn">Il manque {blockers.length} étape(s) obligatoire(s) : {blockers.join(', ')}.</Alert>
          ) : (
            <Alert kind="success">Les sept étapes obligatoires sont constatées sur vos données. Vous pouvez activer la station.</Alert>
          )}
          <div className="mt-4 space-y-1.5">
            {state.services.filter((s) => s.active).slice(0, 3).map((s) => (
              <p key={s.id} className="wg-muted text-xs">· {s.name} — grille enregistrée</p>
            ))}
          </div>
          <button className="wg-btn wg-btn-primary mt-6 !px-6 !py-3" disabled={blockers.length > 0}
            onClick={() => safe(() => { activateStation(); setTimeout(() => navigate('/app/tableau-de-bord'), 900); })}>
            <FiLock /> Activer la station
          </button>
          {blockers.length > 0 && <p className="wg-muted mt-2 text-xs">Le bouton se débloquera automatiquement quand les données seront enregistrées.</p>}
        </>
      )}
    </div>
  );
}

function StepContent({ id }: { id: string }) {
  switch (id) {
    case 'entreprise': return <CompanyForm />;
    case 'station': return <StationForm />;
    case 'horaires': return <HoursForm />;
    case 'categories': return <CategoriesForm />;
    case 'catalogue': return <ServicesForm />;
    case 'tarifs': return <PricesForm />;
    case 'paiements': return <PaymentsForm />;
    case 'equipe': return <TeamForm />;
    case 'logo': return <LogoForm />;
    case 'caisse': return <CashRulesForm />;
    case 'commissions': return <CommissionForm />;
    case 'objectif': return <TargetForm />;
    case 'activation': return <ActivationForm />;
    default: return null;
  }
}

export default function Onboarding() {
  const { state, onboarding, missing } = useStore();
  const [activeId, setActiveId] = useState<string>(() => onboarding.find((s) => s.required && !s.done)?.id ?? 'activation');
  const required = onboarding.filter((s) => s.required);
  const doneRequired = required.filter((s) => s.done).length;
  const active = onboarding.find((s) => s.id === activeId) ?? onboarding[0];

  // Avance automatiquement uniquement quand l'étape AFFICHÉE passe de
  // « à faire » à « constaté ». Revenir modifier une étape déjà constatée
  // ne doit pas renvoyer ailleurs.
  const prevDone = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const current = onboarding.find((s) => s.id === activeId);
    if (current) {
      const wasDone = prevDone.current[activeId] ?? current.done;
      if (!wasDone && current.done && current.id !== 'activation') {
        const next = onboarding.find((s) => s.required && !s.done);
        if (next && next.id !== activeId) setActiveId(next.id);
      }
    }
    onboarding.forEach((s) => { prevDone.current[s.id] = s.done; });
  }, [onboarding, activeId]);

  return (
    <div>
      <PageHeader
        title="Mise en route"
        subtitle="Parcours d’ouverture en treize étapes. Chaque étape est constatée sur les données réellement enregistrées — aucun bouton ne déclare une étape « faite »."
        actions={<Badge tone={state.station?.activated ? 'success' : 'warn'}>{state.station?.activated ? 'Station active' : 'Exploitation fermée'}</Badge>}
      />

      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
          <span>{doneRequired} / {required.length} étapes obligatoires constatées</span>
          <span className="wg-muted">{onboarding.filter((s) => s.done).length} / {onboarding.length} au total</span>
        </div>
        <div className="mt-3"><Progress value={doneRequired} max={required.length} tone={doneRequired === required.length ? 'success' : 'accent'} /></div>
        <div className="mt-4 flex items-start gap-2 text-xs leading-relaxed" style={{ color: 'var(--wg-muted)' }}>
          <FiInfo className="mt-0.5 shrink-0 text-sky-400" />
          <span>Tant que la station n’est pas activée, le serveur refuse les fiches, les encaissements, la caisse et les dépenses (<code>409 onboarding_incomplete</code>) avec la liste de ce qui manque. Aucun prix n’est inventé et aucune donnée d’exemple n’est ajoutée.</span>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <Card className="!p-3">
          <div className="max-h-[720px] space-y-0.5 overflow-y-auto pr-1">
            {onboarding.map((step: OnboardingStep, i) => {
              const selected = step.id === active.id;
              return (
                <button key={step.id} onClick={() => setActiveId(step.id)}
                  className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${selected ? 'bg-sky-500/10' : 'hover:bg-sky-500/5'}`}>
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ${step.done ? 'wg-badge-success' : 'wg-muted'}`} style={step.done ? {} : { background: 'var(--wg-surface-2)' }}>
                    {step.done ? <FiCheck /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold">{step.title}</span>
                    <span className="wg-muted block truncate text-[10px]">{step.description}</span>
                  </span>
                  <span className="shrink-0">
                    {step.done ? <Badge tone="success">Constaté</Badge> : step.required ? <Badge tone="warn">À faire</Badge> : <Badge>Facultatif</Badge>}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card key={active.id} className="wg-fade-in">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b pb-4" style={{ borderColor: 'var(--wg-border)' }}>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">{active.title}</h2>
                {active.done ? <Badge tone="success"><FiCheck /> Constaté</Badge> : active.required ? <Badge tone="warn">Obligatoire</Badge> : <Badge>Facultatif</Badge>}
              </div>
              <p className="wg-muted mt-1 text-xs">{active.description}</p>
            </div>
            <span className="wg-muted text-[11px]">{onboarding.findIndex((s) => s.id === active.id) + 1} / 13</span>
          </div>
          <StepContent id={active.id} />
          {!active.done && <p className="wg-muted mt-5 border-t pt-3 text-[11px]" style={{ borderColor: 'var(--wg-border)' }}><FiAlertCircle className="mr-1 inline" />{active.hint}</p>}
        </Card>
      </div>

      {missing.length > 0 && (
        <div className="mt-5"><Alert kind="warn">Étapes obligatoires encore manquantes : {missing.join(', ')}.</Alert></div>
      )}
    </div>
  );
}
