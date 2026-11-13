import { describe, expect, it } from 'vitest';
import {
  emailIssue, emailSuggestion, passwordIssue, passwordRules, passwordStrength, phoneIssue,
} from '../../src/lib/passwordPolicy';
import { consume, peek, reset, resetAll, POLICIES } from '../../server/rateLimit';

// Politique d'authentification : règles pures partagées formulaire / serveur,
// et limiteur de débit en mémoire. Aucun accès réseau ni base de données.

describe('politique de mot de passe', () => {
  it('refuse un mot de passe trop court ou trop simple', () => {
    expect(passwordIssue('court1')).toMatch(/au moins 8 caractères/i);
    expect(passwordIssue('motdepasse')).toMatch(/chiffre/i);
    expect(passwordIssue('12345678')).toMatch(/lettre/i);
  });

  it('refuse les mots de passe courants et l’adresse elle-même', () => {
    expect(passwordIssue('motdepasse1')).toMatch(/courant/i);
    expect(passwordIssue('awacompany2026', 'awacompany2026@exemple.ci')).toMatch(/adresse e-mail/i);
  });

  it('accepte un mot de passe long et varié', () => {
    expect(passwordIssue('lavageAuto2026', 'awa@exemple.ci')).toBeNull();
    const rules = passwordRules('lavageAuto2026', 'awa@exemple.ci');
    expect(rules.every((rule) => rule.ok)).toBe(true);
  });

  it('note la robustesse sans jamais dépasser 4', () => {
    expect(passwordStrength('').score).toBe(0);
    expect(passwordStrength('abc12345').score).toBeLessThanOrEqual(2);
    expect(passwordStrength('Lavage-Auto-2026-Abidjan').score).toBe(4);
    expect(passwordStrength('motdepasse1').score).toBe(1);
  });
});

describe('validation e-mail et téléphone', () => {
  it('accepte une adresse plausible', () => {
    expect(emailIssue('awa@exemple.ci')).toBeNull();
    expect(emailIssue('')).toMatch(/Saisissez/);
    expect(emailIssue('awa@exemple')).toMatch(/invalide/i);
    expect(emailIssue('awa kone@exemple.ci')).toMatch(/espace/i);
  });

  it('propose une correction de domaine sans l’imposer', () => {
    expect(emailSuggestion('awa@gmial.com')).toBe('awa@gmail.com');
    expect(emailSuggestion('awa@exemple.ci')).toBeNull();
  });

  it('contrôle le nombre de chiffres du téléphone', () => {
    expect(phoneIssue('+225 07 00 00 00 00')).toBeNull();
    expect(phoneIssue('12345')).toMatch(/7 à 15 chiffres/i);
    expect(phoneIssue('00 00 abc')).toMatch(/invalide/i);
  });
});

describe('limiteur de débit', () => {
  it('bloque au-delà du quota puis se réinitialise', () => {
    resetAll();
    const key = 'signin:email:test@exemple.ci';
    const policy = { limit: 3, windowMs: 60_000 };
    expect(consume(key, policy).allowed).toBe(true);
    expect(consume(key, policy).allowed).toBe(true);
    expect(consume(key, policy).allowed).toBe(true);
    const blocked = consume(key, policy);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(peek(key, policy).allowed).toBe(false);
    reset(key);
    expect(peek(key, policy).allowed).toBe(true);
  });

  it('expose des quotas de connexion cohérents', () => {
    expect(POLICIES.signInPerAccount.limit).toBeLessThan(POLICIES.signInPerIp.limit);
    expect(POLICIES.signInPerAccount.windowMs).toBe(15 * 60 * 1000);
  });
});
