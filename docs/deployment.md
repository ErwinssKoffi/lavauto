# LAVAUTO — Déploiement

**Date :** 12/11/2026 · **Statut :** configuration P10 prête ; aucun déploiement Vercel effectif depuis le sandbox Arena (hôte non autorisé par l’allow-list réseau).

## 1. Environnements

| Variable | Développement | Production |
| --- | --- | --- |
| `VITE_DATA_SOURCE` | `local` ou `supabase` | `supabase` |
| `VITE_SUPABASE_URL` | URL du projet de dev | URL du projet de prod |
| `VITE_SUPABASE_ANON_KEY` | Clé publishable de dev | Clé publishable de prod |
| `VITE_SUPABASE_STORAGE_BUCKET` | `station-assets` | `station-assets` |
| `VITE_WG_TEST_AUTH` | `1` uniquement pour E2E | **vide** |
| `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | GitHub Secrets | GitHub Secrets |

Aucune clé `service_role`, aucun secret Supabase et aucun mot de passe ne doit être exposé au navigateur.

## 2. Auth, CORS et redirections

1. Dans Supabase Auth, remplacer `site_url` par l’URL Vercel de production.
2. Renseigner l’allow-list : `https://<domaine>/**`, plus les domaines de preview autorisés.
3. Conserver `mailer_autoconfirm=false`, JWT 3 600 s et l’absence de SMTP / fournisseur / hook.
4. Ajouter l’origine Vercel dans les origines autorisées du projet Supabase ; le frontend n’appelle jamais `localhost` depuis le navigateur.
5. Vérifier que les redirections `/auth/*`, `/mot-de-passe-oublie` et `/reinitialiser-mot-de-passe` restent couvertes par le rewrite SPA.

## 3. Vercel

`vercel.json` fixe :

- framework Vite, `npm run build`, sortie `dist`, région `cdg1` ;
- rewrite `/(.*)` → `/index.html` pour React Router ;
- en-têtes `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.

`.github/workflows/deploy.yml` s’exécute sur `workflow_dispatch` ou `push` vers `main`, mais ignore le déploiement si `VERCEL_TOKEN` est absent. Les étapes utilisent `vercel pull`, `vercel build --prod`, `vercel deploy --prebuilt --prod`.

## 4. CI/CD

`.github/workflows/ci.yml` exécute sur `push` et `pull_request` :

```text
npm ci
npm run typecheck
npm run lint
npm run check
WG_DATA_SOURCE=supabase npm run check
npm run test:unit
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

Le workflow de déploiement est séparé et protégé par les secrets ; aucun secret n’est versionné.

## 5. Sauvegardes et rollback

- Avant toute migration de production : `pg_dump --schema-only` et `pg_dump --data-only` horodatés, conservés hors du dépôt.
- Les migrations sont **additives** : aucune `DROP TABLE`, aucune réécriture de `001`–`044`.
- Stratégie de retour arrière : restaurer le dump, puis rejouer les migrations jusqu’à la version cible depuis `supabase/migrations/`. Ne jamais réappliquer une migration déjà enregistrée dans `schema_migrations`.
- Chaque phase dispose d’un test `BEGIN … ROLLBACK` : `p05` 17/17, `p06` 32/32, `p07` 22/22, `p08` 35/35, `p09` 30/30, `p10` 30/30. Le test P10 couvre en plus la RLS restrictive Storage avec un objet réel et 0 ligne visible par `anon`. Aucun test ne laisse de fixture.
- `docs/database.md` et `CHANGELOG.md` conservent les compteurs attendus après chaque phase.

## 6. Mise en production minimale

```bash
npm ci
npm run typecheck && npm run lint && npm run check && npm run test:unit && npm run build
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
```

Après déploiement : vérifier `/`, `/connexion`, `/app/tableau-de-bord`, `/app/qualite`, l’Auth, `my_context()`, `my_qa_board()` et l’upload d’un logo de test **supprimé ensuite**. Aucun compte de démonstration ne doit rester.

Voir [installation.md](installation.md), [security.md](security.md) et [testing.md](testing.md).
