# LAVAUTO — Déploiement

**Date :** 12/11/2026 · **Statut :** PR #3 **fusionnée** (`f6f6301`) ; configuration de production préparée. Le workflow `deploy.yml` a été corrigé et validé, `site_url` et l'allow-list Auth Supabase pointent sur le domaine de production. Le déploiement effectif reste conditionné aux secrets GitHub/Vercel et au rafraîchissement des origines CORS dans le tableau de bord Supabase.

> **Migrations sur `lavauto` :** après confirmation de la cible et de la sauvegarde par l’utilisateur, `051_station_logo.sql` puis `052_atomic_wash_creation.sql` ont été appliquées le 12/11/2026 via le connecteur, sous les versions `20261112130423_station_logo` et `20261112130520_atomic_wash_creation`. L’historique, le contenu et les principaux objets/permissions ont été vérifiés ; la sauvegarde n’a pas été contrôlée indépendamment. Aucun frontend de cette branche n’a été déployé et la recette métier/Auth/Storage réelle reste à effectuer sur un environnement autorisé. Voir [testing.md](testing.md).
>
> **CLI :** la version npm `3.1.0` est installée et initialisée localement (`supabase/config.toml`), mais elle n’est ni authentifiée ni liée au projet. Le sandbox n’a pas de sortie réseau directe vers Supabase ; le connecteur est une intégration distincte. Le journal distant comporte 51 migrations horodatées ; le dépôt contient maintenant 54 fichiers numérotés (`001`–`055` sans `048`) et trois fichiers datés historiques. `053`, `054` et `055` restent locales et n’ont pas été appliquées à distance. Les migrations et le seed sont désactivés dans la configuration locale par précaution. **Ne pas lancer `supabase db push`, `--include-all`, `migration repair`, `db reset` ou `config push` aveuglément**, même avec ce garde-fou : ils peuvent rejouer ou désynchroniser l’historique, écraser des données ou modifier la configuration distante. Une réconciliation exacte et un aperçu vérifié sont nécessaires.
>
> **WhatsApp :** aucun déploiement de `053`, des fonctions, des secrets, du webhook ou de l’ordonnanceur n’a eu lieu. Une autorisation distincte et une recette isolée sont nécessaires. L’approbation du compte et de l’expéditeur, déclarée par l’utilisateur, ne suffit pas à établir celle du modèle. Procédure et risques de backlog : [whatsapp-receipts.md](whatsapp-receipts.md).

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

Lors de la configuration historique, le jeton d'intégration GitHub ne disposait pas du droit `secrets:write` (HTTP 403) et le connecteur Vercel n’était pas connecté. Saisir les valeurs nécessaires dans les interfaces sécurisées GitHub / Vercel, jamais dans le chat ni dans le dépôt ; vérifier séparément l’état actuel des intégrations.

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
npx --yes deno@2.9.6 check --no-config supabase/functions/whatsapp-dispatch/index.ts supabase/functions/whatsapp-webhook/index.ts
npm run lint
npm run test:unit
# PostgreSQL 17 temporaire vierge : npm run test:postgres:concurrency
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
npm run test:e2e:connected
npm run check
WG_DATA_SOURCE=supabase npm run check
```

La **PR #3** (« P10 — QA, Storage privé, performance, CI/CD et déploiement ») a été fusionnée dans `main` le 12/11/2026 (`mergeCommit f6f6301`) après résolution du conflit avec la PR #2. Ses checks `quality`, `Vercel` et `Vercel Preview Comments` étaient **pass** : typecheck, lint, `check` ×2, Vitest, build, installation Chromium et 15 specs Playwright rejoués en CI. Le workflow de déploiement est séparé et protégé par les secrets ; aucun secret n'est versionné.

### Avant toute autre cible et le déploiement du frontend

1. Confirmer la référence et l’environnement visés (recette ou production), inspecter leur historique **effectif** et vérifier une sauvegarde/restauration exploitable. Sur `lavauto`, `051` et `052` sont déjà enregistrées : **ne pas les réappliquer**. La présence de certaines tables sans données ne remplace pas la vérification de sauvegarde.
2. Pour une autre cible autorisée où elles sont absentes, établir un plan compatible avec son historique, puis appliquer `051` et `052` dans cet ordre, une seule fois chacune. Ne pas utiliser `seed.sql` ni les trois migrations datées historiques de la branche parallèle ; ne pas modifier l’historique pour masquer un écart.
3. Sur une recette autorisée et isolée, vérifier le schéma, les grants, les policies et l’ordre dans le journal ; exécuter les scripts SQL de rollback et les parcours avec des comptes de recette. Tester caisse fermée, refus, même clé/contenu, réponse perdue, concurrence, canaux distincts, dépenses et logo. PGlite et le faux serveur ne remplacent pas ces contrôles ; les e-mails et les fixtures de recette ne doivent pas viser la production.
4. Après recette, vérification de sauvegarde et autorisation de déploiement, déployer le frontend. Sans `052`, la création est refusée explicitement ; avec les anciens frontends, création et paiement restent deux opérations distinctes. Sans `053`, les panneaux WhatsApp affichent une erreur et n’envoient rien. L’activation de Meta exige en outre les deux fonctions, les secrets, le modèle approuvé, le webhook et un ordonnanceur : voir [whatsapp-receipts.md](whatsapp-receipts.md). Vérifier les anciennes opérations avant de les rapprocher.

### Activer la CLI dans un environnement réseau autorisé

La configuration de CLI du dépôt a été initialisée sans toucher au projet distant ; elle ne reflète pas nécessairement ses réglages. `db.migrations.enabled` et `db.seed.enabled` sont `false` en attendant l’analyse de l’historique ; les commandes locales qui en dépendent ne joueront donc pas automatiquement le schéma ni le seed. La connexion du connecteur n’authentifie pas la CLI. Depuis un environnement autorisé pouvant joindre Supabase, on peut ensuite vérifier et lier le projet confirmé :

```bash
npx supabase --version
npx supabase login
npx supabase whoami
npx supabase link --project-ref cgxrqorwmmcyqescatzs
npx supabase migration list --remote
```

Le flux de connexion est interactif ; conserver tout identifiant dans l’environnement sécurisé, jamais dans le chat, le dépôt ou les arguments de commande. Ces commandes n’appliquent pas de migration. Inspecter le résultat avant toute action : les versions de l’historique distant ne correspondent pas aux noms locaux, y compris pour `051` et `052`. Ne retirer les garde-fous et ne proposer un plan de migration qu’après réconciliation vérifiée et autorisation ; ne pas lancer aveuglément les commandes de mutation mentionnées plus haut.

## 5. Sauvegardes et rollback

- Avant toute migration de production : `pg_dump --schema-only` et `pg_dump --data-only` horodatés, conservés hors du dépôt.
- Les 49 migrations historiques et `051` puis `052` sont enregistrées sur `lavauto`. `051` et `052` ajoutent des objets et remplacent certaines fonctions ; elles ne réécrivent pas les fichiers `001`–`044`. Les trois fichiers SQL datés présents après fusion de `main` sont historiques et ne doivent pas être rejoués sur ce projet. L’historique distant utilise des versions horodatées différentes des noms de fichiers locaux : réconcilier sans réappliquer les migrations déjà présentes.
- Stratégie de retour arrière : préparer et tester sur un environnement isolé une restauration adaptée à la sauvegarde et à l’historique réel de la cible. Ne pas rejouer aveuglément les fichiers du dépôt après restauration, ni réappliquer une migration déjà enregistrée dans `schema_migrations`.
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

Après déploiement : vérifier `/`, `/connexion`, `/app/tableau-de-bord`, `/app/qualite`, l'Auth, `my_context()` et `my_qa_board()`. Tester le logo sur un environnement de recette autorisé. Retirer le logo ne supprime pas l'objet Storage : un éventuel nettoyage des fichiers de test doit être effectué séparément après vérification qu'ils ne sont plus référencés. Aucun compte de démonstration ne doit rester.

Voir [installation.md](installation.md), [security.md](security.md) et [testing.md](testing.md).
