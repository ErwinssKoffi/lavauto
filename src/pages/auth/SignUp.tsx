import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  FiAlertCircle, FiArrowRight, FiBriefcase, FiCheckCircle, FiInfo, FiLock, FiUser,
} from 'react-icons/fi';
import AuthLayout from './AuthLayout';
import { Alert, Badge } from '../../components/ui';
import { PasswordField } from '../../components/PasswordField';
import { useStore } from '../../lib/store';
import { formatFCFA } from '../../lib/format';
import { PlanDetails } from '../../components/PlanDetails';
import {
  emailIssue, emailSuggestion, passwordIssue, phoneIssue,
} from '../../lib/passwordPolicy';

const fieldCls = 'w-full rounded-xl border bg-slate-50 px-3.5 py-2.5 text-sm outline-none transition focus:bg-white focus:ring-4';
const labelCls = 'mb-1.5 block text-xs font-bold text-slate-600';

type FieldKey = 'companyName' | 'stationName' | 'phone' | 'city' | 'ownerName' | 'email';
type Touched = Partial<Record<FieldKey | 'password' | 'confirm', boolean>>;

/** Validation locale : mêmes règles que le serveur, affichées champ par champ. */
function fieldError(key: FieldKey | 'password' | 'confirm', form: Record<string, string>): string | null {
  const value = form[key] ?? '';
  switch (key) {
    case 'companyName':
      return value.trim().length < 2 ? 'Indiquez le nom de l’entreprise (2 caractères minimum).' : null;
    case 'stationName':
      return value.trim().length < 2 ? 'Indiquez le nom de la station (2 caractères minimum).' : null;
    case 'city':
      return value.trim().length < 2 ? 'Indiquez la ville de la station.' : null;
    case 'ownerName':
      return value.trim().length < 2 ? 'Indiquez votre nom complet.' : null;
    case 'phone':
      return phoneIssue(value);
    case 'email':
      return emailIssue(value);
    case 'password':
      return passwordIssue(value, form.email ?? '');
    case 'confirm':
      return value !== form.password ? 'Les deux mots de passe ne correspondent pas.' : null;
    default:
      return null;
  }
}

export default function SignUp() {
  const { signUp, authKind, plans, plansError } = useStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialPlan = params.get('plan');
  const [requestedPlanId, setRequestedPlanId] = useState<'essai' | 'standard' | 'premium'>(
    initialPlan === 'standard' || initialPlan === 'premium' ? initialPlan : 'essai',
  );
  const availablePlans = plans.filter((plan) => ['essai', 'standard', 'premium'].includes(plan.id));
  const selectedAvailable = availablePlans.some((plan) => plan.id === requestedPlanId);
  const [form, setForm] = useState({
    companyName: '', stationName: '', phone: '', city: '',
    ownerName: '', email: '', password: '', confirm: '',
  });
  const [touched, setTouched] = useState<Touched>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmUrl, setConfirmUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const blur = (k: keyof Touched) => () => setTouched((t) => ({ ...t, [k]: true }));

  const suggestion = useMemo(() => emailSuggestion(form.email), [form.email]);
  const errors = useMemo(() => {
    const keys: (FieldKey | 'password' | 'confirm')[] = [
      'companyName', 'stationName', 'phone', 'city', 'ownerName', 'email', 'password', 'confirm',
    ];
    return keys.reduce<Record<string, string | null>>((acc, key) => {
      acc[key] = fieldError(key, form);
      return acc;
    }, {});
  }, [form]);
  const invalidCount = Object.values(errors).filter(Boolean).length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setConfirmUrl(null);
    setTouched({
      companyName: true, stationName: true, phone: true, city: true,
      ownerName: true, email: true, password: true, confirm: true,
    });
    if (!selectedAvailable) {
      setError('Choisissez une formule disponible avant de continuer.');
      return;
    }
    const firstProblem = Object.values(errors).find((value) => Boolean(value));
    if (firstProblem) {
      setError(firstProblem);
      return;
    }
    setBusy(true);
    try {
      const result = await signUp({ ...form, requestedPlanId });
      if (result.confirmationRequired) {
        setConfirmUrl(result.confirmUrl ?? null);
        setNotice(`${result.message ?? 'Confirmez votre adresse e-mail avant la première connexion.'} Après connexion, ouvrez Abonnement pour vérifier la formule et toute demande en attente.`);
        return;
      }
      const activated = result.identity?.stations[0]?.activated ?? false;
      navigate(activated ? '/app/tableau-de-bord' : '/app/mise-en-route', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inscription impossible.');
    } finally {
      setBusy(false);
    }
  };

  const inlineError = (key: keyof Touched) => (touched[key] ? errors[key] : null);

  return (
    <AuthLayout>
      <Badge tone="accent">{authKind === 'local' ? 'Espace local' : 'Inscription par e-mail'}</Badge>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Créer mon espace</h1>
      <p className="mt-2 text-sm text-slate-500">Comparez les formules, puis créez votre entreprise et votre compte.</p>

      <form onSubmit={(e) => { void submit(e); }} className="mt-6 space-y-5" noValidate>
        <fieldset className="rounded-2xl border border-slate-200 p-4">
          <legend className="px-1 text-sm font-bold">Votre formule souhaitée</legend>
          <p className="mb-3 text-xs leading-relaxed text-slate-500">L’essai donne accès à tous les modules pendant 14 jours. Standard et Premium sont des demandes, activées seulement après validation administrateur. Aucun paiement automatique.</p>
          {plansError && <Alert kind="danger">Formules indisponibles : {plansError}</Alert>}
          {!plansError && availablePlans.length === 0 && <p role="status" className="text-xs text-slate-500">Chargement des formules…</p>}
          <div className="space-y-3">
            {availablePlans.map((plan) => <label key={plan.id} className={`block cursor-pointer rounded-xl border p-3 ${requestedPlanId === plan.id ? 'border-sky-500 bg-sky-50' : 'border-slate-200'}`}>
              <span className="flex items-center justify-between gap-2 text-sm font-bold">
                <span className="flex items-center gap-2"><input type="radio" name="plan" value={plan.id} checked={requestedPlanId === plan.id}
                  onChange={() => setRequestedPlanId(plan.id as 'essai' | 'standard' | 'premium')} /> {plan.name}</span>
                <span>{plan.id === 'essai' ? 'Gratuit · 14 jours' : `${formatFCFA(plan.priceMonthly)} / mois`}</span>
              </span>
              <div className="mt-2 text-slate-600"><PlanDetails plan={plan} compact /></div>
            </label>)}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">Comptes actifs : propriétaire inclus. Tarifs indicatifs à valider commercialement. Une validation payante anticipée met fin immédiatement à l’essai. À son échéance sans validation, les données restent consultables et les écritures ordinaires sont bloquées.</p>
        </fieldset>

        {/* Temps 1 */}
        <section className="rounded-2xl border border-slate-200 p-4">
          <div className="mb-4 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-100 text-sky-600"><FiBriefcase size={14} aria-hidden="true" /></span>
            <div>
              <h2 className="text-sm font-bold">Votre entreprise et sa station</h2>
              <p className="text-[11px] text-slate-400">Ces informations identifient votre exploitation.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="companyName">Nom de l’entreprise *</label>
              <input id="companyName" required maxLength={120} className={`${fieldCls} ${inlineError('companyName') ? 'border-red-300 focus:border-red-500 focus:ring-red-100' : 'border-slate-200 focus:border-sky-500 focus:ring-sky-100'}`}
                value={form.companyName} onChange={set('companyName')} onBlur={blur('companyName')} placeholder="Ex. SARL Clean Auto"
                autoComplete="organization" aria-invalid={inlineError('companyName') ? true : undefined} />
              {inlineError('companyName') && <p className="mt-1.5 text-[11px] font-semibold text-red-600" role="alert">{inlineError('companyName')}</p>}
            </div>
            <div>
              <label className={labelCls} htmlFor="stationName">Nom de la station *</label>
              <input id="stationName" required maxLength={120} className={`${fieldCls} ${inlineError('stationName') ? 'border-red-300 focus:border-red-500 focus:ring-red-100' : 'border-slate-200 focus:border-sky-500 focus:ring-sky-100'}`}
                value={form.stationName} onChange={set('stationName')} onBlur={blur('stationName')} placeholder="Ex. Clean Auto Cocody" />
              {inlineError('stationName') && <p className="mt-1.5 text-[11px] font-semibold text-red-600" role="alert">{inlineError('stationName')}</p>}
            </div>
            <div>
              <label className={labelCls} htmlFor="phone">Téléphone *</label>
              <input id="phone" required type="tel" inputMode="tel" autoComplete="tel" className={`${fieldCls} ${inlineError('phone') ? 'border-red-300 focus:border-red-500 focus:ring-red-100' : 'border-slate-200 focus:border-sky-500 focus:ring-sky-100'}`}
                value={form.phone} onChange={set('phone')} onBlur={blur('phone')} placeholder="+225 00 00 00 00"
                aria-describedby="phone-hint" aria-invalid={inlineError('phone') ? true : undefined} />
              {inlineError('phone')
                ? <p className="mt-1.5 text-[11px] font-semibold text-red-600" role="alert">{inlineError('phone')}</p>
                : <p className="mt-1.5 text-[11px] text-slate-400" id="phone-hint">Indicatif compris, 7 à 15 chiffres.</p>}
            </div>
            <div>
              <label className={labelCls} htmlFor="city">Ville *</label>
              <input id="city" required maxLength={120} className={`${fieldCls} ${inlineError('city') ? 'border-red-300 focus:border-red-500 focus:ring-red-100' : 'border-slate-200 focus:border-sky-500 focus:ring-sky-100'}`}
                value={form.city} onChange={set('city')} onBlur={blur('city')} placeholder="Abidjan" autoComplete="address-level2" />
              {inlineError('city') && <p className="mt-1.5 text-[11px] font-semibold text-red-600" role="alert">{inlineError('city')}</p>}
            </div>
          </div>
        </section>

        {/* Temps 2 */}
        <section className="rounded-2xl border border-slate-200 p-4">
          <div className="mb-4 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-100 text-sky-600"><FiUser size={14} aria-hidden="true" /></span>
            <div>
              <h2 className="text-sm font-bold">Votre compte de propriétaire</h2>
              <p className="text-[11px] text-slate-400">Il pourra créer les autres comptes depuis Employés.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="ownerName">Votre nom *</label>
              <input id="ownerName" required maxLength={120} className={`${fieldCls} ${inlineError('ownerName') ? 'border-red-300 focus:border-red-500 focus:ring-red-100' : 'border-slate-200 focus:border-sky-500 focus:ring-sky-100'}`}
                value={form.ownerName} onChange={set('ownerName')} onBlur={blur('ownerName')} placeholder="Prénom et nom" autoComplete="name" />
              {inlineError('ownerName') && <p className="mt-1.5 text-[11px] font-semibold text-red-600" role="alert">{inlineError('ownerName')}</p>}
            </div>
            <div>
              <label className={labelCls} htmlFor="email">Adresse e-mail *</label>
              <input id="email" required type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
                className={`${fieldCls} ${inlineError('email') ? 'border-red-300 focus:border-red-500 focus:ring-red-100' : 'border-slate-200 focus:border-sky-500 focus:ring-sky-100'}`}
                value={form.email} onChange={set('email')} onBlur={blur('email')} placeholder="vous@exemple.ci"
                aria-invalid={inlineError('email') ? true : undefined} />
              {inlineError('email') && <p className="mt-1.5 text-[11px] font-semibold text-red-600" role="alert">{inlineError('email')}</p>}
              {!inlineError('email') && suggestion && (
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                  <FiAlertCircle className="text-amber-500" aria-hidden="true" />
                  Vouliez-vous dire <strong className="font-semibold text-slate-700">{suggestion}</strong> ?
                  <button type="button" className="font-bold text-sky-600 hover:underline"
                    onClick={() => setForm((f) => ({ ...f, email: suggestion }))}>Utiliser</button>
                </p>
              )}
            </div>
            <div className="sm:col-span-2">
              <PasswordField
                id="password"
                label="Mot de passe *"
                value={form.password}
                onChange={(value) => setForm((f) => ({ ...f, password: value }))}
                autoComplete="new-password"
                placeholder="8 caractères minimum"
                email={form.email}
                showStrength
                showChecklist
                error={inlineError('password')}
                inputClassName="w-full rounded-xl border bg-slate-50 px-3.5 py-2.5 text-sm outline-none transition focus:bg-white focus:ring-4"
              />
            </div>
            <div className="sm:col-span-2">
              <PasswordField
                id="confirm"
                label="Confirmer le mot de passe *"
                value={form.confirm}
                onChange={(value) => setForm((f) => ({ ...f, confirm: value }))}
                autoComplete="new-password"
                placeholder="••••••••"
                error={inlineError('confirm')}
                inputClassName="w-full rounded-xl border bg-slate-50 px-3.5 py-2.5 text-sm outline-none transition focus:bg-white focus:ring-4"
              />
            </div>
          </div>
        </section>

        {error && <div className="text-xs"><Alert kind="danger">{error}</Alert></div>}
        {notice && (
          <div className="space-y-2 text-xs">
            <Alert kind="success">{notice}</Alert>
            {confirmUrl && (
              <a href={confirmUrl} className="btn btn-sm btn-primary w-full !py-2.5">
                Ouvrir le lien de confirmation <FiArrowRight aria-hidden="true" />
              </a>
            )}
          </div>
        )}

        <div className="rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
          <div className="flex items-start gap-2"><FiInfo className="mt-0.5 shrink-0 text-sky-600" aria-hidden="true" />
            {authKind === 'local' ? (
              <p>Aucun e-mail n’est envoyé : l’espace est créé uniquement dans ce navigateur, aucun lien de récupération n’est disponible, et un espace existant ne sera pas remplacé.</p>
            ) : (
              <p>La confirmation par e-mail peut être exigée selon la configuration du serveur ; dans ce cas, ouvrez le lien reçu avant la première connexion. Le serveur crée l’entreprise, sa station, le profil propriétaire et l’abonnement d’essai. Aucun tarif de lavage n’est prérempli.</p>
            )}
          </div>
        </div>

        <button type="submit" disabled={busy || !selectedAvailable}
          className="btn btn-sm btn-primary w-full !py-3 disabled:opacity-60"
          aria-describedby={invalidCount > 0 ? 'signup-status' : undefined}>
          {busy ? 'Création…' : 'Créer mon espace'} <FiArrowRight aria-hidden="true" />
        </button>
        {invalidCount > 0 && touched.email && (
          <p className="text-center text-[11px] text-slate-400" id="signup-status" role="status">
            {invalidCount} champ(s) à corriger avant la création.
          </p>
        )}
      </form>

      <p className="mt-5 text-center text-sm text-slate-500">
        Déjà inscrit ? <Link to="/connexion" className="font-bold text-sky-600 hover:underline">Se connecter</Link>
      </p>
      <div className="mt-5 flex items-center justify-center gap-2 text-[11px] text-slate-400"><FiCheckCircle aria-hidden="true" /> <FiLock aria-hidden="true" /> {authKind === 'local' ? 'Stockage navigateur · session locale' : 'Authentification serveur sécurisée'}</div>
    </AuthLayout>
  );
}
