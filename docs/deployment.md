# LAVAUTO — Déploiement

**Date :** 12/11/2026 · **Statut :** PR #3 **fusionnée** (`f6f6301`) ; configuration de production préparée. Le workflow `deploy.yml` a été corrigé et validé, `site_url` et l'allow-list Auth Supabase pointent sur le domaine de production. Le déploiement effectif reste conditionné aux secrets GitHub/Vercel et au rafraîchissement des origines CORS dans le tableau de bord Supabase.

## 1. Domaine et environnements

| Variable | Développement | Production |
| --- | --- | --- |
| Domaine | `http://localhost:5173`, aperçu Arena `https://5173-….e2b.app` | **`https://lavauto-five.vercel.app`** |
| `VITE_DATA_SOURCE` | `local` ou `supabase` | `supabase` |
| `VITE_SUPABASE_URL` | URL du projet | `https://cgxrqorwmmcyqescatzs.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Clé **publishable** | Clé **publishable** du même projet |
| `VITE_SUPABASE_STORAGE_BUCKET` | `station-assets` | `station-assets` |
| `VITE_WG_TEST_AUTH` | `1` uniquement pour E2E | **vide** |
| `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | absents | **GitHub Secrets** |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | `.env.local` ignoré | **GitHub Variables** (ou Secrets) |

Aucune clé `service_role`, aucun secret Supabase, aucun `sb_secret` et aucun mot de passe ne doit être exposé au navigateur ni versionné. Les valeurs `VITE_DATA_SOURCE`, `VITE_SUPABASE_STORAGE_BUCKET` et `VITE_WG_TEST_AUTH` sont fixées directement dans `.github/workflows/deploy.yml` ; elles ne sont pas des secrets.

### Secrets et variables à créer dans GitHub

`Settings → Secrets and variables → Actions` du dépôt `ErwinssKoffi/lavauto` :

| Nom | Type | Valeur |
| --- | --- | --- |
| `VERCEL_TOKEN` | Secret | Token d'accès Vercel |
| `VERCEL_ORG_ID` | Secret | ID de l'organisation / du scope Vercel |
| `VERCEL_PROJECT_ID` | Secret | ID du projet Vercel `lavauto` |
| `VITE_SUPABASE_URL` | Variable (ou Secret) | `https://cgxrqorwmmcyqescatzs.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Variable (ou Secret) | Clé publishable `sb_publishable_…` ou clé `anon` legacy |

Le connecteur Supabase de cette session expose les clés publishable ; le jeton d'intégration GitHub d'Arena n'a pas le droit `secrets:write` (HTTP 403 sur l'API des secrets) et l'application Vercel est déconnectée : ces valeurs doivent donc être saisies dans les interfaces GitHub / Vercel, jamais collées dans le chat ni dans le dépôt.

## 2. Auth, CORS et redirections

Configuration Supabase Auth appliquée au projet `cgxrqorwmmcyqescatzs` :

- `site_url` : `https://lavauto-five.vercel.app`
- `uri_allow_list` : `http://localhost:5173/**`, `http://127.0.0.1:5173/**`, `https://5173-in4mdo7zgflqt72vpkywe.e2b.app/**`, `https://lavauto-five.vercel.app/**`, `https://lavauto-git-arena-868cde36-lavauto-durandobi634-8314s-projects.vercel.app/**`
- `mailer_autoconfirm=false`, `jwt_exp=3600`, `disable_signup=false`, e-mail activé, téléphone désactivé, rotation des refresh tokens conservée, aucun SMTP / fournisseur OAuth / hook. La relecture `get_auth_config` après update confirme que les valeurs par défaut non transmises sont restaurées (`rate_limit_email_sent=2`, `security_captcha_provider=hcaptcha`, `sms_provider=twilio`, `sessions_inactivity_timeout=0`).

Les **origines CORS autorisées** du projet Supabase (tableau de bord → *Project Settings → API → CORS Allowed Origins*) ne sont pas exposées par le connecteur Supabase disponible ; elles doivent y être renseignées manuellement avec la liste :

```text
http://localhost:5173
http://127.0.0.1:5173
https://5173-in4mdo7zgflqt72vpkywe.e2b.app
https://lavauto-five.vercel.app
https://lavauto-git-arena-868cde36-lavauto-durandobi634-8314s-projects.vercel.app
```

Le frontend n'appelle jamais `localhost` depuis le navigateur en production. Les redirections `/auth/*`, `/mot-de-passe-oublie` et `/reinitialiser-mot-de-passe` restent couvertes par le rewrite SPA de `vercel.json`.

## 3. Vercel

`vercel.json` fixe :

- framework Vite, `npm run build`, sortie `dist`, région `cdg1` ;
- rewrite `/(.*)` → `/index.html` pour React Router ;
- en-têtes `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.

Le projet Vercel lié à GitHub est `lavauto` (scope `durandobi634-8314s-projects`) ; les previews de PR sont générées automatiquement par l'application Vercel. Le domaine public `https://lavauto-five.vercel.app` est celui déclaré dans la page d'accueil du dépôt GitHub ; il doit être rafraîchi par un déploiement de production après configuration des secrets.

`.github/workflows/deploy.yml` s'exécute sur `workflow_dispatch`, `repository_dispatch` (`deploy_production`) ou `push` vers `main`. Il :

1. lit les secrets `VERCEL_*` et les variables `VITE_SUPABASE_*` ;
2. ignore proprement le déploiement si `VERCEL_TOKEN` est absent (au lieu d'échouer) ;
3. vérifie que `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` sont renseignés et que `VITE_WG_TEST_AUTH` reste vide ;
4. enchaîne `npm ci`, `vercel pull --yes --environment=production`, `vercel build --prod`, `vercel deploy --prebuilt --prod`.

Le workflow initial contenait une erreur YAML (`run: echo "… : …"` avec `:` suivi d'un espace dans un scalaire non quoté) qui faisait échouer chaque exécution en 0 s sans créer de job. Le `run` est désormais un bloc littéral et le fichier est validé par `@action-validator/cli` (0 erreur).

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

La **PR #3** (« P10 — QA, Storage privé, performance, CI/CD et déploiement ») a été fusionnée dans `main` le 12/11/2026 (`mergeCommit f6f6301`) après résolution du conflit avec la PR #2. Ses checks `quality`, `Vercel` et `Vercel Preview Comments` étaient **pass** : typecheck, lint, `check` ×2, Vitest, build, installation Chromium et 15 specs Playwright rejoués en CI. Le workflow de déploiement est séparé et protégé par les secrets ; aucun secret n'est versionné.

## 5. Sauvegardes et rollback

- Avant toute migration de production : `pg_dump --schema-only` et `pg_dump --data-only` horodatés, conservés hors du dépôt.
- Les migrations appliquées sont **additives** et numérotées `001`–`050` : aucune `DROP TABLE`, aucune réécriture de `001`–`044`. Les 3 fichiers SQL datés présents dans le dépôt après fusion de `main` sont historiques et ne doivent pas être rejoués sur ce projet.
- Stratégie de retour arrière : restaurer le dump, puis rejouer les migrations jusqu'à la version cible depuis `supabase/migrations/`. Ne jamais réappliquer une migration déjà enregistrée dans `schema_migrations`.
- Chaque phase dispose d'un test `BEGIN … ROLLBACK` : `p05` 17/17, `p06` 32/32, `p07` 22/22, `p08` 35/35, `p09` 30/30, `p10` 30/30. Le test P10 couvre en plus la RLS restrictive Storage avec un objet réel et 0 ligne visible par `anon`. Aucun test ne laisse de fixture.
- `docs/database.md` et `CHANGELOG.md` conservent les compteurs attendus après chaque phase.

## 6. Mise en production minimale

```bash
npm ci
npm run typecheck && npm run lint && npm run check && npm run test:unit && npm run build
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
```

Ou, depuis GitHub, déclencher `Deploy Vercel` (`workflow_dispatch`) ou envoyer :

```bash
gh api -X POST repos/ErwinssKoffi/lavauto/dispatches -f event_type=deploy_production
```

Après déploiement : vérifier `/`, `/connexion`, `/app/tableau-de-bord`, `/app/qualite`, l'Auth, `my_context()`, `my_qa_board()` et l'upload d'un logo de test **supprimé ensuite**. Aucun compte de démonstration ne doit rester.

Voir [installation.md](installation.md), [security.md](security.md) et [testing.md](testing.md).
