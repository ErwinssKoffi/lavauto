# LAVAUTO — Tests

**Date :** 12/11/2026 · **Statut :** P10 livré.

## 1. Matrice

| Niveau | Commande | Portée |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | `src`, configs Vite/Vitest/Playwright, `tests`, `e2e`. |
| Garde-fous statiques | `npm run lint` | **25 / 25**. |
| Contrôles fonctionnels | `npm run check` | **238 OK / 0 KO** ; section `[14]` : réseau, 7 documents, Vitest, CI, rollback, lazy loading, optimisation image, 15 parcours JSDOM P10. |
| Contrôles mode serveur | `WG_DATA_SOURCE=supabase npm run check` | **239 OK / 0 KO**. |
| Règles pures | `npm run test:unit` | **16 tests Vitest**. |
| Build | `npm run build` | Vite, lazy loading, CSS, bundle. |
| E2E navigateur | `npm run test:e2e` | 15 specs Playwright / Chromium. |
| Liste E2E | `npm run test:e2e:list` | Découverte des 15 specs sans navigateur. |
| SQL distant | `supabase/tests/p10_rollback.sql` | 30 contrôles `BEGIN … ROLLBACK`, 0 fixture. |

## 2. Tests SQL distants

| Phase | Fichier | Résultat |
| --- | --- | --- |
| P05 | `p05_rollback.sql` | 17/17 |
| P06 | `p06_rollback.sql` | 32/32 |
| P07 | `p07_rollback.sql` | 22/22 |
| P08 | `p08_rollback.sql` | 35/35 |
| P09 | `p09_rollback.sql` | 30/30 |
| P10 | `p10_rollback.sql` | 30/30 |

Le test P10 couvre : 49 migrations, 70 tables, 5 index, 4 RPC, bucket privé, 5 policies objets, 5 policies buckets, 5 gardes `RESTRICTIVE`, 0 ligne Storage visible par `anon` malgré le grant `SELECT` historique, refus d’écriture `anon` et de bucket `authenticated` en `42501`, SELECT du bucket autorisé pour `authenticated`, pagination A/B, limite 100, offset négatif, période inversée `23514`, idempotence `true` puis `false`, clé invalide `23514`, RPC non autorisée `23514`, écriture directe `42501`, chemin Storage serveur, isolation A/B et déclencheurs quota conservés. Les règles pures couvrent en plus le nom WebP et la limite 512 px de l’optimisation d’image. Après `ROLLBACK`, l’introspection confirme 0 compte, 0 entreprise, 0 lavage, 0 objet Storage, 0 ligne d’idempotence, 0 journal plateforme.

## 3. EXPLAIN ANALYZE

Après `ANALYZE` (`34eba461-6c02-43d9-9f57-ba05508a5a70`), trois plans ont été relevés avec `enable_seqscan=off` :

| Requête | Plan | Request id |
| --- | --- | --- |
| Page lavages | `Index Scan using ix_p10_washes_page` | `ecf17085-d185-477d-95e8-466ab1ac596e` |
| Page paiements | `Index Scan using ix_p10_payments_page` | `c45728e6-59a0-4cbf-9f87-044b87096e6c` |
| Journal plateforme | `Index Scan using ix_p10_platform_audit_page` | `e3df9e1f-987f-48dd-8b65-6a61c5149b14` |

La base étant vide en dehors des transactions annulées, les temps sont sub-millisecondes ; l’objet du contrôle est l’utilisation des index, pas un benchmark de charge.

## 4. Playwright et JSDOM

`e2e/erp.spec.ts` contient **15 parcours** : vitrine, connexion, inscription, tableau de bord, mise en route, lavages, prestations, clients, employés, caisse, dépenses, rapports, consolidation, qualité, back-office super admin. L’état est injecté par `page.addInitScript` avec `VITE_WG_TEST_AUTH=1`, sans compte Auth ni réseau Supabase.

Le sandbox Arena ne permet pas `npx playwright install chromium` (`cdn.playwright.dev` bloqué par l’allow-list). Les 15 specs sont donc listées et validées statiquement, et les 15 parcours équivalents sont rejoués en JSDOM ; aucun navigateur réel n’est annoncé vert depuis le sandbox. En conséquence :

- `npm run test:e2e:list` valide la découverte des 15 specs ;
- `npm run check` rejoue les 15 parcours en JSDOM ;
- `.github/workflows/ci.yml` installe Chromium et exécute réellement `npm run test:e2e`.

## 5. Non-régression

Aucun test ne crée de compte Auth persistant, d’e-mail, de secret, de clé API, de bucket public, de fournisseur d’envoi ou de fixture métier. Aucun `npm audit fix --force`, aucun navigateur réel exécuté dans le sandbox, aucun déploiement Vercel effectif. Les migrations `001`–`044` ne sont jamais réappliquées.

Vérifications finales : `npm run typecheck` 0 erreur ; `npm run lint` 25/25 ; `npm run check` 238 OK / 0 KO · local ; `WG_DATA_SOURCE=supabase npm run check` 239 OK / 0 KO · supabase ; `npm run test:unit` 16/16 ; `npm run test:e2e:list` 15 specs ; `npm run build` 509 modules avec 7 chunks paresseux et `index-D-EI3sxK.js` 1 179,85 kB / gzip 314,10 kB (avertissement > 500 kB sur le bundle Recharts) ; `git diff --check` propre ; preview `0.0.0.0:5173` : `/` et `/app/qualite` 200, hôte `.e2b.app` 200, `evil.example.com` 403.

Voir [security.md](security.md) et [deployment.md](deployment.md).
