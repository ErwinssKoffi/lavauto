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
  danger: 'bg-error',
  warn: 'bg-warning',
  accent: 'bg-primary',
  success: 'bg-success',
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
 step <= strength.score ? TONE_BAR[strength.tone] : 'bg-base-300'
 }`}
          />
        ))}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-base-content/60">
        <span className="font-bold text-base-content/70">{strength.label}</span> · {strength.hint}
      </p>
    </div>
  );
}

export function PasswordChecklist({
  password, email = '', rules,
}: { password: string; email?: string; rules?: PasswordRule[] }) {
  const list = rules ?? passwordRules(password, email);
  return (
    <ul className="mt-2 grid gap-1 text-[11px] text-base-content/60 sm:grid-cols-2">
      {list.map((rule) => (
        <li key={rule.id} className="flex items-center gap-1.5">
          {rule.ok
            ? <FiCheck className="shrink-0 text-success" aria-hidden="true" />
            : <FiX className="shrink-0 text-base-content/70" aria-hidden="true" />}
          <span className={rule.ok ? 'text-base-content/70' : ''}>{rule.label}</span>
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
    ?? 'w-full rounded-xl border bg-base-200 px-3.5 py-3 text-sm outline-none transition focus:bg-base-100 focus:ring-4';
  const border = error
    ? 'border-error/40 focus:border-error focus:ring-error/20'
    : 'border-base-300 focus:border-primary focus:ring-primary/20';

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label className="text-xs font-bold text-base-content/70" htmlFor={id}>{label}</label>
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
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-base-content/60 transition hover:bg-base-200 hover:text-base-content/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
          aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          aria-pressed={visible}
          tabIndex={0}
        >
          {visible ? <FiEyeOff aria-hidden="true" /> : <FiEye aria-hidden="true" />}
        </button>
      </div>
      {capsLock && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-warning">
          <FiAlertCircle aria-hidden="true" /> Verrouillage majuscules activé.
        </p>
      )}
      {hint && !error && <p className="mt-1.5 text-[11px] text-base-content/60" id={hintId}>{hint}</p>}
      {error && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] font-semibold text-error" id={errorId} role="alert">
          <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden="true" /> {error}
        </p>
      )}
      {showStrength && <PasswordStrengthMeter password={value} />}
      {showChecklist && <PasswordChecklist password={value} email={email} />}
    </div>
  );
}
