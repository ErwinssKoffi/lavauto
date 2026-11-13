import React, { useId, useState } from 'react';
import { FiAlertCircle, FiCheck, FiEye, FiEyeOff, FiX } from 'react-icons/fi';
import {
  PASSWORD_MAX_LENGTH, passwordRules, passwordStrength, type PasswordRule,
} from '../lib/passwordPolicy';

// ─── Champs de mot de passe (connexion / inscription / réinitialisation) ────
// Aucun contrôle de sécurité ici : ces composants aident la saisie. Le serveur
// revérifie chaque règle. Pas de case à cocher « se souvenir » : le choix de
// persistance est explicite dans les pages qui l'exposent.

const TONE_BAR: Record<string, string> = {
  danger: 'bg-red-500',
  warn: 'bg-amber-500',
  accent: 'bg-sky-500',
  success: 'bg-emerald-500',
};

export function PasswordStrengthMeter({ password, id }: { password: string; id?: string }) {
  const strength = passwordStrength(password);
  if (!password) return null;
  return (
    <div className="mt-2" id={id} aria-live="polite">
      <div className="flex items-center gap-1.5" role="img" aria-label={`Robustesse : ${strength.label}`}>
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              step <= strength.score ? TONE_BAR[strength.tone] : 'bg-slate-200'
            }`}
          />
        ))}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
        <span className="font-bold text-slate-700">{strength.label}</span> · {strength.hint}
      </p>
    </div>
  );
}

export function PasswordChecklist({
  password, email = '', rules,
}: { password: string; email?: string; rules?: PasswordRule[] }) {
  const list = rules ?? passwordRules(password, email);
  return (
    <ul className="mt-2 grid gap-1 text-[11px] text-slate-500 sm:grid-cols-2">
      {list.map((rule) => (
        <li key={rule.id} className="flex items-center gap-1.5">
          {rule.ok
            ? <FiCheck className="shrink-0 text-emerald-600" aria-hidden="true" />
            : <FiX className="shrink-0 text-slate-300" aria-hidden="true" />}
          <span className={rule.ok ? 'text-slate-600' : ''}>{rule.label}</span>
        </li>
      ))}
    </ul>
  );
}

export interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Texte du lien à droite du libellé (ex. « Mot de passe oublié ? »). */
  labelAction?: React.ReactNode;
  autoComplete?: 'current-password' | 'new-password';
  placeholder?: string;
  hint?: string;
  /** Erreur de champ : bordure rouge et message associé. */
  error?: string | null;
  /** Affiche les règles détaillées (inscription, réinitialisation). */
  showChecklist?: boolean;
  /** Adresse e-mail du compte, pour refuser un mot de passe identique. */
  email?: string;
  /** Affiche la jauge de robustesse. */
  showStrength?: boolean;
  required?: boolean;
  disabled?: boolean;
  /** Classes du conteneur du champ (bordures, fond). */
  inputClassName?: string;
}

export function PasswordField({
  id, label, value, onChange, labelAction, autoComplete = 'current-password',
  placeholder = '••••••••', hint, error, showChecklist = false, email = '',
  showStrength = false, required = true, disabled = false, inputClassName,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const hintId = useId();
  const errorId = useId();
  const describedBy = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  const base = inputClassName
    ?? 'w-full rounded-xl border bg-slate-50 px-3.5 py-3 text-sm outline-none transition focus:bg-white focus:ring-4';
  const border = error
    ? 'border-red-300 focus:border-red-500 focus:ring-red-100'
    : 'border-slate-200 focus:border-sky-500 focus:ring-sky-100';

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label className="text-xs font-bold text-slate-600" htmlFor={id}>{label}</label>
        {labelAction}
      </div>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          required={required}
          disabled={disabled}
          minLength={autoComplete === 'new-password' ? 8 : undefined}
          maxLength={PASSWORD_MAX_LENGTH}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          value={value}
          placeholder={placeholder}
          className={`${base} ${border} pr-12`}
          onChange={(e) => onChange(e.target.value)}
          onKeyUp={(e) => setCapsLock(e.getModifierState?.('CapsLock') ?? false)}
          onKeyDown={(e) => setCapsLock(e.getModifierState?.('CapsLock') ?? false)}
          onBlur={() => setCapsLock(false)}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
          aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          aria-pressed={visible}
          tabIndex={0}
        >
          {visible ? <FiEyeOff aria-hidden="true" /> : <FiEye aria-hidden="true" />}
        </button>
      </div>
      {capsLock && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-amber-600">
          <FiAlertCircle aria-hidden="true" /> Verrouillage majuscules activé.
        </p>
      )}
      {hint && !error && <p className="mt-1.5 text-[11px] text-slate-400" id={hintId}>{hint}</p>}
      {error && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] font-semibold text-red-600" id={errorId} role="alert">
          <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden="true" /> {error}
        </p>
      )}
      {showStrength && <PasswordStrengthMeter password={value} />}
      {showChecklist && <PasswordChecklist password={value} email={email} />}
    </div>
  );
}
