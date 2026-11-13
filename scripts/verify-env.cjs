#!/usr/bin/env node
/* ───────────────────────────────────────────────────────────────────────────
   WashGuard — vérification du câblage des variables runtime.

   npm run verify:env              → variables du processus / fichiers .env locaux
   npm run verify:env:bundle       → + analyse du bundle produit dans dist/

   Objectif : garantir que la configuration navigateur vise UNIQUEMENT le
   projet Supabase `cgxrqorwmmcyqescatzs` et ne contient jamais de clé
   privilégiée. Aucune valeur sensible n'est affichée : seuls l'hôte public,
   le préfixe du type de clé et une empreinte SHA-256 tronquée le sont.

   Le script ne fait aucun appel réseau. Il refuse par défaut tout autre
   projet ; `--allow-other-project` n'existe volontairement pas, car les
   documents du dépôt imposent une cible unique. Pour un environnement de
   recette explicitement autorisé, utiliser `SUPABASE_PROJECT_REF` (variable
   de processus, jamais versionnée) — l'écart reste alors visible dans la
   sortie.
   ─────────────────────────────────────────────────────────────────────────── */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PROJECT_REF = 'cgxrqorwmmcyqescatzs';
const DEFAULT_STORAGE_BUCKET = 'station-assets';
const SUPABASE_HOST_RE = /^([a-z0-9]{20})\.supabase\.co$/;
const BUNDLE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.map', '.json', '.txt']);
const FORBIDDEN_VITE_VAR_RE = /^VITE_.*(SERVICE_ROLE|SECRET|PASSWORD)/i;

function expectedRef(options = {}) {
  return (options.expectedRef || process.env.SUPABASE_PROJECT_REF || DEFAULT_PROJECT_REF).trim();
}

function expectedUrl(options = {}) {
  return `https://${expectedRef(options)}.supabase.co`;
}

/* ── Lecture .env minimale, sans dépendance ──────────────────────────────── */
function parseDotEnv(text) {
  const parsed = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rest] = match;
    let value = rest;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    parsed[key] = value;
  }
  return parsed;
}

/** Fichiers explicites, sinon .env.local puis .env, sans écraser process.env. */
function loadEnvironment(argvEnvFile) {
  const candidates = argvEnvFile
    ? [path.resolve(process.cwd(), argvEnvFile)]
    : ['.env.local', '.env']
        .map((name) => path.join(ROOT, name))
        .filter((file) => fs.existsSync(file));
  const fromFiles = {};
  const usedFiles = [];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    Object.assign(fromFiles, parseDotEnv(fs.readFileSync(file, 'utf8')));
    usedFiles.push(path.relative(ROOT, file) || file);
  }
  return { env: { ...fromFiles, ...process.env }, usedFiles };
}

/* ── Analyse pure (testable) ─────────────────────────────────────────────── */
function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const decoded = JSON.parse(payload);
    return decoded && typeof decoded === 'object' ? decoded : null;
  } catch {
    return null;
  }
}

function keyFingerprint(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

function describeKey(key) {
  if (key.startsWith('sb_publishable_')) {
    return `clé publishable (${key.length} car., sha256:${keyFingerprint(key)})`;
  }
  if (key.split('.').length === 3) {
    const payload = decodeJwtPayload(key);
    const role = payload && typeof payload.role === 'string' ? payload.role : 'inconnu';
    return `JWT « ${role} » (${key.length} car., sha256:${keyFingerprint(key)})`;
  }
  return `valeur non reconnue (${key.length} car., sha256:${keyFingerprint(key)})`;
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {{ expectedRef?: string, production?: boolean }} [options]
 */
function analyzeEnv(env = process.env, options = {}) {
  const errors = [];
  const warnings = [];
  const ref = expectedRef(options);
  const production = options.production === true;
  const facts = {
    mode: 'local',
    projectRef: null,
    urlConfigured: false,
    keyConfigured: false,
    keyDescription: null,
    bucket: DEFAULT_STORAGE_BUCKET,
    production,
  };

  const rawMode = String(env.VITE_DATA_SOURCE ?? '').trim().toLowerCase();
  if (rawMode === '' || rawMode === 'local') facts.mode = 'local';
  else if (rawMode === 'supabase') facts.mode = 'supabase';
  else errors.push(`VITE_DATA_SOURCE invalide : « ${rawMode} ». Valeurs acceptées : local, supabase.`);

  const rawUrl = String(env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  if (rawUrl !== '') {
    facts.urlConfigured = true;
    let parsed = null;
    try {
      parsed = new URL(rawUrl);
    } catch {
      errors.push('VITE_SUPABASE_URL n’est pas une URL absolue valide.');
    }
    if (parsed) {
      if (parsed.protocol !== 'https:') errors.push('VITE_SUPABASE_URL doit utiliser HTTPS.');
      if (parsed.username || parsed.password) errors.push('VITE_SUPABASE_URL ne doit contenir aucun identifiant.');
      if (parsed.search || parsed.hash) errors.push('VITE_SUPABASE_URL ne doit contenir ni query ni fragment.');
      if (parsed.pathname !== '/' && parsed.pathname !== '') {
        errors.push('VITE_SUPABASE_URL ne doit viser que la racine du projet.');
      }
      const hostMatch = SUPABASE_HOST_RE.exec(parsed.hostname);
      if (!hostMatch) {
        errors.push(`Hôte Supabase inattendu : « ${parsed.hostname} ». Format attendu : <ref>.supabase.co.`);
      } else {
        facts.projectRef = hostMatch[1];
        if (hostMatch[1] !== ref) {
          errors.push(
            `VITE_SUPABASE_URL vise le projet « ${hostMatch[1]} » alors que la cible documentée est « ${ref} ».`
          );
        }
      }
    }
  }

  const key = String(env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (key !== '') {
    facts.keyConfigured = true;
    facts.keyDescription = describeKey(key);
    if (key.startsWith('sb_secret_')) {
      errors.push('VITE_SUPABASE_ANON_KEY contient une clé secrète sb_secret_ : interdite dans le navigateur.');
    } else if (key.startsWith('sb_publishable_')) {
      if (key.length < 32) errors.push('La clé publishable paraît tronquée.');
    } else if (key.split('.').length === 3) {
      const payload = decodeJwtPayload(key);
      if (!payload) {
        errors.push('VITE_SUPABASE_ANON_KEY ressemble à un JWT mais sa charge utile est illisible.');
      } else {
        if (payload.role !== 'anon') {
          errors.push(`JWT interdit : rôle « ${String(payload.role)} ». Seule la clé publishable/anon est acceptée.`);
        }
        if (typeof payload.ref === 'string' && payload.ref !== ref) {
          errors.push(`La clé JWT appartient au projet « ${payload.ref} », pas à « ${ref} ».`);
        }
        if (typeof payload.ref === 'string' && facts.projectRef && payload.ref !== facts.projectRef) {
          errors.push('La clé JWT et VITE_SUPABASE_URL ne visent pas le même projet.');
        }
      }
    } else {
      errors.push('VITE_SUPABASE_ANON_KEY n’est ni une clé publishable sb_publishable_ ni une clé anon JWT.');
    }
  }

  if (facts.mode === 'supabase') {
    if (!facts.urlConfigured) errors.push('VITE_DATA_SOURCE=supabase exige VITE_SUPABASE_URL.');
    if (!facts.keyConfigured) errors.push('VITE_DATA_SOURCE=supabase exige VITE_SUPABASE_ANON_KEY (publishable).');
  }
  if (facts.mode === 'local' && facts.urlConfigured && facts.keyConfigured) {
    warnings.push(
      'Cible Supabase configurée mais VITE_DATA_SOURCE=local : aucune connexion n’est établie (bascule volontaire).'
    );
  }
  if (facts.mode === 'local' && facts.urlConfigured !== facts.keyConfigured) {
    warnings.push('Configuration Supabase partielle : URL et clé doivent être fournies ensemble.');
  }

  const bucket = String(env.VITE_SUPABASE_STORAGE_BUCKET ?? '').trim() || DEFAULT_STORAGE_BUCKET;
  facts.bucket = bucket;
  if (bucket !== DEFAULT_STORAGE_BUCKET) {
    errors.push(`VITE_SUPABASE_STORAGE_BUCKET doit valoir « ${DEFAULT_STORAGE_BUCKET} » (reçu « ${bucket} »).`);
  }

  const testAuth = String(env.VITE_WG_TEST_AUTH ?? '').trim();
  if (testAuth !== '') {
    if (testAuth !== '1') errors.push('VITE_WG_TEST_AUTH n’accepte que la valeur « 1 » (harnais local).');
    if (production) errors.push('VITE_WG_TEST_AUTH doit rester vide en production.');
    else if (facts.mode !== 'local') errors.push('VITE_WG_TEST_AUTH n’est autorisé qu’en mode local de test.');
    else warnings.push('VITE_WG_TEST_AUTH=1 : harnais de test local uniquement, jamais déployé.');
  }

  for (const [name, value] of Object.entries(env)) {
    if (FORBIDDEN_VITE_VAR_RE.test(name) && String(value ?? '').trim() !== '') {
      errors.push(`Variable interdite dans le bundle navigateur : ${name}.`);
    }
  }

  return { errors, warnings, facts, expectedRef: ref, expectedUrl: expectedUrl(options) };
}

/* ── Analyse du bundle produit ───────────────────────────────────────────── */
function collectFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else if (BUNDLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

/**
 * @param {string} bundleDir
 * @param {{ expectedRef?: string, requireUrl?: boolean }} [options]
 */
function scanBundle(bundleDir, options = {}) {
  const errors = [];
  const warnings = [];
  const ref = expectedRef(options);
  const refs = new Map();
  if (!fs.existsSync(bundleDir)) {
    return { errors: [`Bundle introuvable : ${bundleDir}. Lancez npm run build d’abord.`], warnings, refs, files: 0 };
  }
  const files = collectFiles(bundleDir);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const relative = path.relative(ROOT, file) || file;
    // Une vraie clé secrète est un jeton long ; le préfixe seul apparaît dans
    // le code de @supabase/supabase-js pour distinguer les types de clés.
    if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(text)) {
      errors.push(`${relative} contient une clé secrète sb_secret_.`);
    }
    if (/SUPABASE_SERVICE_ROLE_KEY|["']role["']\s*:\s*["']service_role["']/.test(text)) {
      errors.push(`${relative} contient une référence service_role.`);
    }
    const jwtRe = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
    for (const match of text.match(jwtRe) || []) {
      const payload = decodeJwtPayload(match);
      if (payload && typeof payload.role === 'string' && payload.role !== 'anon') {
        errors.push(`${relative} embarque un JWT de rôle « ${payload.role} ».`);
      }
    }
    const urlRe = /https:\/\/([a-z0-9]{20})\.supabase\.co/g;
    for (const match of text.matchAll(urlRe)) {
      const found = match[1];
      if (found !== ref) errors.push(`${relative} vise le projet Supabase « ${found} » au lieu de « ${ref} ».`);
      refs.set(found, (refs.get(found) || 0) + 1);
    }
  }
  if (options.requireUrl === true && !refs.has(ref)) {
    errors.push(`Le bundle ne contient aucune URL https://${ref}.supabase.co : variable non injectée au build.`);
  }
  if (refs.size === 0) warnings.push('Aucune URL Supabase dans le bundle (mode local attendu).');
  return { errors, warnings, refs, files: files.length };
}

/* ── Sortie ──────────────────────────────────────────────────────────────── */
function printReport(title, result) {
  console.log(`\n${title}`);
  for (const [name, value] of Object.entries(result.facts || {})) {
    if (value === null || value === undefined || value === '') continue;
    console.log(`  · ${name} : ${value}`);
  }
  for (const warning of result.warnings) console.log(`  ! ${warning}`);
  for (const error of result.errors) console.log(`  ✗ ${error}`);
  console.log(
    result.errors.length === 0
      ? `  ✓ ${title} : ${result.warnings.length} avertissement(s)`
      : `  ✗ ${title} : ${result.errors.length} erreur(s)`
  );
}

function parseArgs(argv) {
  const args = { bundle: null, envFile: null, production: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--bundle') args.bundle = argv[++i] || 'dist';
    else if (arg === '--env-file') args.envFile = argv[++i] || null;
    else if (arg === '--production') args.production = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Argument inconnu : ${arg}`);
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    return 2;
  }
  if (args.help) {
    console.log('Usage : node scripts/verify-env.cjs [--env-file .env.local] [--bundle dist] [--production]');
    console.log(`Cible vérifiée : https://${expectedRef()}.supabase.co (jamais de clé affichée).`);
    return 0;
  }

  const { env, usedFiles } = loadEnvironment(args.envFile);
  const production = args.production || env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production';
  const analysis = analyzeEnv(env, { production });
  if (usedFiles.length > 0) analysis.facts.sources = usedFiles.join(', ');
  printReport('Câblage des variables runtime', analysis);

  let bundle = null;
  if (args.bundle) {
    const dir = path.resolve(ROOT, args.bundle);
    const result = scanBundle(dir, {
      requireUrl: analysis.facts.mode === 'supabase' && analysis.facts.urlConfigured,
    });
    result.facts = {
      bundle: path.relative(ROOT, dir) || dir,
      fichiers: result.files,
      projetsVus: [...result.refs.keys()].join(', ') || 'aucun',
    };
    printReport('Bundle produit', result);
    bundle = result;
  }

  const failed =
    analysis.errors.length > 0 || (bundle !== null && bundle.errors.length > 0);
  console.log(
    failed
      ? '\n✗ Câblage refusé : corriger les erreurs ci-dessus.\n'
      : `\n✓ Câblage conforme — cible ${analysis.expectedUrl} (aucune clé affichée).\n`
  );
  return failed ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  DEFAULT_PROJECT_REF,
  DEFAULT_STORAGE_BUCKET,
  analyzeEnv,
  decodeJwtPayload,
  describeKey,
  expectedRef,
  expectedUrl,
  loadEnvironment,
  main,
  parseDotEnv,
  scanBundle,
};
