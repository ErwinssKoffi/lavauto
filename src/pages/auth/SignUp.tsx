import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  FiAlertCircle, FiArrowRight, FiBriefcase, FiCheckCircle, FiInfo, FiLock, FiUser,
} from 'react-icons/fi';
import AuthLayout from './AuthLayout';
import { Alert, Badge } from '../../components/ui';
import { PasswordField } from '../../components/PasswordField';
import { useStore } from '../../lib/store';
import {
  emailIssue, emailSuggestion, passwordIssue, phoneIssue,
} from '../../lib/passwordPolicy';

const fieldCls = 'w-full rounded-xl border bg-base-200 px-3.5 py-2.5 text-sm outline-none transition focus:bg-base-100 focus:ring-4';
const labelCls = 'mb-1.5 block text-xs font-bold text-base-content/70';

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
  // Formule captée depuis la vitrine (`/inscription?plan=…`) ; le choix détaillé
  // se fait ensuite dans Abonnement, après création de l'espace.
  const [requestedPlanId] = useState<'essai' | 'standard' | 'premium'>(
    initialPlan === 'standard' || initialPlan === 'premium' ? initialPlan : 'essai',
  );
  const availablePlans = plans.filter((plan) => ['essai', 'standard', 'premium'].includes(plan.id));
  const selectedAvailable = availablePlans.some((plan) => plan.id === requestedPlanId);
  const requestedPlan = availablePlans.find((plan) => plan.id === requestedPlanId);
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
      <p className="mt-2 text-sm text-base-content/60">Deux temps : votre exploitation, puis votre compte de propriétaire.</p>

      <form onSubmit={(e) => { void submit(e); }} className="mt-7 space-y-6" noValidate>
        {requestedPlan && requestedPlan.id !== 'essai' && (
          <p className="inline-flex items-center gap-1.5 rounded-full border border-base-300 bg-base-100 px-3 py-1 text-[11px] font-semibold text-base-content/70">
            <FiCheckCircle className="text-primary" aria-hidden="true" />
            Formule {requestedPlan.name} demandée · validation administrateur
          </p>
        )}
        {!selectedAvailable && (
          <p className="text-[11px] text-base-content/60" role="status">
            {plansError ? `Formules indisponibles : ${plansError}` : 'Chargement des formules…'}
          </p>
        )}

        {/* Temps 1 */}
        <section className="rounded-2xl border border-base-300 p-5">
          <div className="mb-5 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary"><FiBriefcase size={14} aria-hidden="true" /></span>
            <div>
              <h2 className="text-sm font-bold">Votre entreprise et sa station</h2>
              <p className="text-[11px] text-base-content/60">Ces informations identifient votre exploitation.</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="companyName">Nom de l’entreprise *</label>
              <input id="companyName" required maxLength={120} className={`${fieldCls} ${inlineError('companyName') ? 'border-error/40 focus:border-error focus:ring-error/20' : 'border-base-300 focus:border-primary focus:ring-primary/20'}`}
                value={form.companyName} onChange={set('companyName')} onBlur={blur('companyName')} placeholder="Ex. SARL Clean Auto"
                autoComplete="organization" aria-invalid={inlineError('companyName') ? true : undefined} />
              {inlineError('companyName') && <p className="mt-1.5 text-[11px] font-semibold text-error" role="alert">{inlineError('companyName')}</p>}
            </div>
            <div>
              <label className={labelCls} htmlFor="stationName">Nom de la station *</label>
              <input id="stationName" required maxLength={120} className={`${fieldCls} ${inlineError('stationName') ? 'border-error/40 focus:border-error focus:ring-error/20' : 'border-base-300 focus:border-primary focus:ring-primary/20'}`}
                value={form.stationName} onChange={set('stationName')} onBlur={blur('stationName')} placeholder="Ex. Clean Auto Cocody" />
              {inlineError('stationName') && <p className="mt-1.5 text-[11px] font-semibold text-error" role="alert">{inlineError('stationName')}</p>}
            </div>
            <div>
              <label className={labelCls} htmlFor="phone">Téléphone *</label>
              <input id="phone" required type="tel" inputMode="tel" autoComplete="tel" className={`${fieldCls} ${inlineError('phone') ? 'border-error/40 focus:border-error focus:ring-error/20' : 'border-base-300 focus:border-primary focus:ring-primary/20'}`}
                value={form.phone} onChange={set('phone')} onBlur={blur('phone')} placeholder="+225 00 00 00 00"
                aria-describedby="phone-hint" aria-invalid={inlineError('phone') ? true : undefined} />
              {inlineError('phone')
                ? <p className="mt-1.5 text-[11px] font-semibold text-error" role="alert">{inlineError('phone')}</p>
                : <p className="mt-1.5 text-[11px] text-base-content/60" id="phone-hint">Indicatif compris, 7 à 15 chiffres.</p>}
            </div>
            <div>
              <label className={labelCls} htmlFor="city">Ville *</label>
              <input id="city" required maxLength={120} className={`${fieldCls} ${inlineError('city') ? 'border-error/40 focus:border-error focus:ring-error/20' : 'border-base-300 focus:border-primary focus:ring-primary/20'}`}
                value={form.city} onChange={set('city')} onBlur={blur('city')} placeholder="Abidjan" autoComplete="address-level2" />
              {inlineError('city') && <p className="mt-1.5 text-[11px] font-semibold text-error" role="alert">{inlineError('city')}</p>}
            </div>
          </div>
        </section>

        {/* Temps 2 */}
        <section className="rounded-2xl border border-base-300 p-5">
          <div className="mb-5 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary"><FiUser size={14} aria-hidden="true" /></span>
            <div>
              <h2 className="text-sm font-bold">Votre compte de propriétaire</h2>
              <p className="text-[11px] text-base-content/60">Il pourra créer les autres comptes depuis Employés.</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="ownerName">Votre nom *</label>
              <input id="ownerName" required maxLength={120} className={`${fieldCls} ${inlineError('ownerName') ? 'border-error/40 focus:border-error focus:ring-error/20' : 'border-base-300 focus:border-primary focus:ring-primary/20'}`}
                value={form.ownerName} onChange={set('ownerName')} onBlur={blur('ownerName')} placeholder="Prénom et nom" autoComplete="name" />
              {inlineError('ownerName') && <p className="mt-1.5 text-[11px] font-semibold text-error" role="alert">{inlineError('ownerName')}</p>}
            </div>
            <div>
              <label className={labelCls} htmlFor="email">Adresse e-mail *</label>
              <input id="email" required type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
                className={`${fieldCls} ${inlineError('email') ? 'border-error/40 focus:border-error focus:ring-error/20' : 'border-base-300 focus:border-primary focus:ring-primary/20'}`}
                value={form.email} onChange={set('email')} onBlur={blur('email')} placeholder="vous@exemple.ci"
                aria-invalid={inlineError('email') ? true : undefined} />
              {inlineError('email') && <p className="mt-1.5 text-[11px] font-semibold text-error" role="alert">{inlineError('email')}</p>}
              {!inlineError('email') && suggestion && (
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-base-content/60">
                  <FiAlertCircle className="text-warning" aria-hidden="true" />
                  Vouliez-vous dire <strong className="font-semibold text-base-content/70">{suggestion}</strong> ?
                  <button type="button" className="font-bold text-primary hover:underline"
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
                inputClassName="w-full rounded-xl border bg-base-200 px-3.5 py-2.5 text-sm outline-none transition focus:bg-base-100 focus:ring-4"
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
                inputClassName="w-full rounded-xl border bg-base-200 px-3.5 py-2.5 text-sm outline-none transition focus:bg-base-100 focus:ring-4"
              />
            </div>
          </div>
        </section>

        {error && <div className="text-xs"><Alert kind="danger">{error}</Alert></div>}
        {notice && (
          <div className="space-y-2 text-xs">
            <Alert kind="success">{notice}</Alert>
            {confirmUrl && (
              <a href={confirmUrl} className="btn btn-sm btn-primary w-full py-2.5!">
                Ouvrir le lien de confirmation <FiArrowRight aria-hidden="true" />
              </a>
            )}
          </div>
        )}

        <div className="rounded-xl bg-base-200 p-3 text-[11px] leading-relaxed text-base-content/60">
          <div className="flex items-start gap-2"><FiInfo className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
            {authKind === 'local' ? (
              <p>Aucun e-mail n’est envoyé : l’espace est créé uniquement dans ce navigateur, aucun lien de récupération n’est disponible, et un espace existant ne sera pas remplacé.</p>
            ) : (
              <p>La confirmation par e-mail peut être exigée selon la configuration du serveur ; dans ce cas, ouvrez le lien reçu avant la première connexion. Le serveur crée l’entreprise, sa station, le profil propriétaire et l’abonnement d’essai. Aucun tarif de lavage n’est prérempli.</p>
            )}
          </div>
        </div>

        <button type="submit" disabled={busy || !selectedAvailable}
          className="btn btn-sm btn-primary w-full py-3! disabled:opacity-60"
          aria-describedby={invalidCount > 0 ? 'signup-status' : undefined}>
          {busy ? 'Création…' : 'Créer mon espace'} <FiArrowRight aria-hidden="true" />
        </button>
        {invalidCount > 0 && touched.email && (
          <p className="text-center text-[11px] text-base-content/60" id="signup-status" role="status">
            {invalidCount} champ(s) à corriger avant la création.
          </p>
        )}
      </form>

      <p className="mt-5 text-center text-sm text-base-content/60">
        Déjà inscrit ? <Link to="/connexion" className="font-bold text-primary hover:underline">Se connecter</Link>
      </p>
      <div className="mt-5 flex items-center justify-center gap-2 text-[11px] text-base-content/60"><FiCheckCircle aria-hidden="true" /> <FiLock aria-hidden="true" /> {authKind === 'local' ? 'Stockage navigateur · session locale' : 'Authentification serveur sécurisée'}</div>
    </AuthLayout>
  );
}
