// ─── Politique de mot de passe et d'e-mail (Auth) ───────────────────────────
// Module pur, partagé par les formulaires du navigateur et par le serveur
// (`server/routes.ts`). L'UI ne fait que refléter ces règles : le serveur les
// applique de nouveau à chaque inscription, changement et réinitialisation.
// Aucune de ces fonctions ne contacte le réseau ni ne stocke quoi que ce soit.

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

/** Mots de passe les plus courants : refusés explicitement, jamais silencieusement renforcés. */
export const WEAK_PASSWORDS: readonly string[] = [
  '12345678', '123456789', '1234567890', 'password', 'password1', 'passw0rd',
  'motdepasse', 'motdepasse1', 'azerty123', 'qwerty123', 'azertyuiop',
  'station123', 'lavage123', 'washguard', 'washguard123', 'admin123',
  'administrateur', 'iloveyou', 'soleil123', 'abidjan123', 'cocody123',
  'abcdefgh', '00000000', '11111111',
];

export interface PasswordRule {
  id: 'length' | 'letters' | 'digits' | 'not-common' | 'not-email';
  label: string;
  ok: boolean;
}

function hasLetter(value: string): boolean {
  return /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(value);
}

function hasDigit(value: string): boolean {
  return /[0-9]/.test(value);
}

function hasSymbol(value: string): boolean {
  return /[^A-Za-z0-9À-ÖØ-öø-ÿ]/.test(value);
}

/** Règles affichées en direct sous le champ ; `email` permet de refuser un mot
 *  de passe identique à l'adresse saisie. */
export function passwordRules(password: string, email = ''): PasswordRule[] {
  const normalized = password.trim().toLowerCase();
  const emailLocal = email.trim().toLowerCase().split('@')[0] ?? '';
  return [
    {
      id: 'length',
      label: `Au moins ${PASSWORD_MIN_LENGTH} caractères`,
      ok: password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH,
    },
    { id: 'letters', label: 'Au moins une lettre', ok: hasLetter(password) },
    { id: 'digits', label: 'Au moins un chiffre', ok: hasDigit(password) },
    {
      id: 'not-common',
      label: 'Pas un mot de passe courant',
      ok: password.length > 0 && !WEAK_PASSWORDS.includes(normalized),
    },
    {
      id: 'not-email',
      label: 'Différent de votre adresse e-mail',
      ok: password.length > 0 && (!emailLocal || normalized !== emailLocal),
    },
  ];
}

/** Première règle bloquante, ou `null` si le mot de passe est acceptable. */
export function passwordIssue(password: string, email = ''): string | null {
  if (password.length === 0) return 'Saisissez un mot de passe.';
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Le mot de passe ne doit pas dépasser ${PASSWORD_MAX_LENGTH} caractères.`;
  }
  if (!hasLetter(password)) return 'Le mot de passe doit contenir au moins une lettre.';
  if (!hasDigit(password)) return 'Le mot de passe doit contenir au moins un chiffre.';
  if (WEAK_PASSWORDS.includes(password.trim().toLowerCase())) {
    return 'Ce mot de passe est trop courant. Choisissez-en un autre.';
  }
  const emailLocal = email.trim().toLowerCase().split('@')[0] ?? '';
  if (emailLocal && password.trim().toLowerCase() === emailLocal) {
    return 'Le mot de passe ne doit pas reprendre votre adresse e-mail.';
  }
  return null;
}

export type PasswordStrengthTone = 'danger' | 'warn' | 'accent' | 'success';

export interface PasswordStrength {
  /** 0 (vide) à 4 (fort). */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  tone: PasswordStrengthTone;
  /** Indice actionnable, jamais un faux sentiment de sécurité. */
  hint: string;
}

/** Estimation locale et explicable : longueur + variété de caractères.
 *  Ce n'est pas une garantie cryptographique, seulement une aide à la saisie. */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length === 0) {
    return { score: 0, label: 'Non renseigné', tone: 'danger', hint: `Au moins ${PASSWORD_MIN_LENGTH} caractères.` };
  }
  const classes = [hasLetter(password), hasDigit(password), hasSymbol(password)].filter(Boolean).length;
  let score = 0;
  if (password.length >= PASSWORD_MIN_LENGTH) score += 1;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  if (classes >= 2) score += 1;
  if (classes >= 3 && password.length >= 12) score += 1;
  if (WEAK_PASSWORDS.includes(password.trim().toLowerCase())) score = Math.min(score, 1);
  const capped = Math.max(1, Math.min(4, score)) as 1 | 2 | 3 | 4;
  const table: Record<1 | 2 | 3 | 4, PasswordStrength> = {
    1: {
      score: 1, label: 'Faible', tone: 'danger',
      hint: password.length < PASSWORD_MIN_LENGTH
        ? `Encore ${PASSWORD_MIN_LENGTH - password.length} caractère(s).`
        : 'Allongez le mot de passe ou ajoutez un symbole.',
    },
    2: {
      score: 2, label: 'Moyen', tone: 'warn',
      hint: 'Ajoutez un symbole ou portez-le à 12 caractères.',
    },
    3: {
      score: 3, label: 'Bon', tone: 'accent',
      hint: 'Acceptable. Une phrase de passe de 16 caractères reste plus sûre.',
    },
    4: {
      score: 4, label: 'Fort', tone: 'success',
      hint: 'Long et varié : conservez-le dans un gestionnaire de mots de passe.',
    },
  };
  return table[capped];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Validation d'e-mail partagée formulaire / serveur (longueur RFC raisonnable). */
export function emailIssue(email: string): string | null {
  const value = email.trim();
  if (!value) return 'Saisissez votre adresse e-mail.';
  if (value.length > 254) return 'Adresse e-mail trop longue.';
  if (/\s/.test(value)) return 'L’adresse e-mail ne doit pas contenir d’espace.';
  if (!EMAIL_PATTERN.test(value)) return 'Adresse e-mail invalide : exemple vous@exemple.ci.';
  const [local, domain] = value.split('@');
  if (!local || !domain || local.length > 64) return 'Adresse e-mail invalide.';
  return null;
}

/** Domaines fréquemment mal saisis : proposition affichée, jamais appliquée seule. */
const DOMAIN_FIXES: Record<string, string> = {
  'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.fr': 'gmail.com',
  'gmial.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmail.con': 'gmail.com',
  'yahoo.co': 'yahoo.fr', 'yahoo.cm': 'yahoo.fr', 'yaho.fr': 'yahoo.fr',
  'hotmail.co': 'hotmail.com', 'hotmial.com': 'hotmail.com',
  'outlook.co': 'outlook.com', 'orange.ci': 'orange.fr',
  'icloud.co': 'icloud.com', 'free.co': 'free.fr',
};

export function emailSuggestion(email: string): string | null {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0) return null;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const fixed = DOMAIN_FIXES[domain];
  return fixed ? `${local}@${fixed}` : null;
}

/** Validation légère d'un téléphone : 7 à 15 chiffres, séparateurs tolérés. */
export function phoneIssue(phone: string): string | null {
  const value = phone.trim();
  if (!value) return 'Saisissez un numéro de téléphone.';
  if (value.length > 40) return 'Numéro de téléphone trop long.';
  if (!/^\+?[0-9 ()-]+$/.test(value)) return 'Téléphone invalide : chiffres, espaces, +, - et parenthèses uniquement.';
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.length < 7 || digits.length > 15) return 'Téléphone invalide : indiquez 7 à 15 chiffres, indicatif compris.';
  return null;
}
