# WashGuard — frontend

Application de gestion de station de lavage en React, TypeScript et Tailwind CSS. Le schéma Supabase, l'authentification réelle, l'isolation multi-entreprises et le RBAC serveur sont appliqués (**Prompts 03–04**) ; le cœur métier lavages (**Prompt 05**), la finance (**Prompt 06**), le stock / les consommations valorisées (**Prompt 07**) et le CRM / la fidélité / les forfaits / les flottes (**Prompt 08**) sont branchés sur des RPC serveur ; seules quelques écritures (catalogue, abonnement, paramètres) restent locales.

Toute l'interface est en **français**, les montants en **FCFA** (`12 500 FCFA`), les dates au format **jj/mm/aaaa**. Thème **sombre par défaut**, thème clair disponible (bouton soleil / lune dans l'en-tête).

## Démarrer

```bash
npm ci
npm run dev        # ou : make web
npm run build      # ou : make build — vérifie les types puis produit dist/
npm run preview    # sert dist/ sur le port 5173
npm run check      # contrôles reproductibles : logique, DOM, schéma, adaptateurs, Auth/RBAC
npm run lint       # garde-fous statiques (Recharts 2.15.4 utilisé en P09)
npm run typecheck  # TypeScript seul
```

Le serveur de développement écoute sur `0.0.0.0:5173`. En production, servez `dist/` derrière un serveur qui renvoie `index.html` pour toutes les routes (SPA).

La vitrine `/` reprend fidèlement le modèle public [ixartz/Next-js-Boilerplate](https://github.com/ixartz/Next-js-Boilerplate) : mêmes textes, sections, illustrations et navigation, avec les actions branchées aux routes WashGuard et les tarifs à `plans`. Voir [docs/landing.md](docs/landing.md). La génération automatisée de captures (`make rendu`) n'est pas encore en place.

## Ce qui est implémenté

| Écran | Contenu |
| --- | --- |
| `/` — Vitrine | Reprise fidèle du modèle public `ixartz/Next-js-Boilerplate` (bandeau de démo, en-tête `Nextjs Starter`, liste de fonctionnalités, tableau des partenaires, badge et pied de page). Navigation et CTA branchés à `/connexion`, `/inscription`, `/app/tableau-de-bord` et aux ancres ; section **Formules et tarifs** conservée, lue dans la table `plans` en mode Supabase ou dans le repli local. Aucun témoignage inventé. Une personne déjà identifiée est conduite directement à son espace. |
| `/connexion`, `/inscription` | Même mise en page `AuthLayout` : formulaire sur surface claire et centrée, panneau photo à droite (`public/images/lav-auto.jpeg`) avec dégradé sombre, masqué sur téléphone. Inscription groupée en deux temps : *votre entreprise et sa station* (nom de l'entreprise, nom de la station, téléphone, ville), puis *votre compte de propriétaire*. |
| Mise en route | 13 étapes, **8 obligatoires**, dont l'état est **constaté sur les données enregistrées** : aucune case n'est cochée par le navigateur. Voir [docs/onboarding.md](docs/onboarding.md). |
| Tableau de bord | CA du jour, lavages, encaissements, dépenses, état de la caisse, alertes, dernières opérations, objectif du mois et tendance Recharts du mois. |
| Lavages | Fiche rapide (prestations, véhicule, plaque facultative, employé, remise autorisée, client facultatif), statuts, encaissement total ou partiel, reste à payer, annulation motivée. |
| Prestations | Catalogue propre à la station et grille tarifaire par catégorie de véhicules. **Modifier un tarif ne change jamais les lavages déjà enregistrés.** |
| Clients | Fiche facultative, historique, recherche. Un lavage peut être encaissé sans client. |
| Employés | Comptes, rôles, activation, réinitialisation de mot de passe, exception de barème de commission, activité. |
| Caisse | Ouverture avec fond, clôture avec **comptage** et écart théorique / compté, réouverture motivée, historique. Règle : les espèces exigent une caisse ouverte (désactivable dans Paramètres) ; Mobile Money à tout moment. |
| Dépenses | Montant, catégorie, motif, fournisseur, date, moyen de paiement, rattachement à la caisse ouverte, annulation motivée (**jamais de suppression**). |
| Rapports | Jour / semaine / mois, meilleures prestations, activité par employé, répartition par moyen de paiement, historique de caisse, meilleurs clients, **export CSV**. |
| Commissions | Lavages **terminés** de la période, barème de la station ou exception par compte, montant dû, **export CSV pour la paie**. Réservé au propriétaire et au gérant. |
| Stocks & achats | Produits, fournisseurs, commandes sans incrémentation de stock, réceptions partielles idempotentes, coût moyen pondéré, inventaires, mouvements immuables, rattachement des dépenses d'achat et attestations de coûts. |
| Consommations | Normes `prestation × produit`, consommation théorique agrégée et valorisée une seule fois par fiche prête, journal des sorties et coût de revient. |
| Paramètres | Station, horaires, devise FCFA, logo, règles de caisse, remise maximale du caissier, barème, objectif, entreprise, journal des opérations sensibles. |
| Abonnement | Formule en cours, consommation et limites relues côté serveur, comparaison, demande de changement. Les tarifs restent des hypothèses commerciales administrables. |
| Consolidation multi-stations | Comparaison de deux périodes avec les mêmes définitions, courbes, classement des stations par chiffre d'affaires, détail par station et règles de certification. |
| Espace plateforme | Réservé au super admin : entreprises clientes, formules et quotas administrables, abonnements, suspension, compteurs d'usage, recalcul serveur et journal. |

### Règles respectées

- **Aucun prix de prestation n'est prédéfini, aucune donnée d'exemple n'est ajoutée.** Les libellés proposés pendant la mise en route (Berline, Lavage extérieur…) ne sont que des raccourcis de saisie : rien n'est inséré sans une action de l'utilisateur.
- Tant que la station n'est pas activée, les écritures de métier lèvent `409 onboarding_incomplete` avec la liste de ce qui manque (`src/lib/store.tsx`, `assertActivated`). Les écrans concernés affichent le panneau de blocage.
- **Session réactive** : `onAuthStateChange` est la seule entrée ; `auth.getUser()` valide le JWT et `my_context()` relit les permissions côté serveur, avec déduplication des événements identiques. `load()`/`persist()` n'écrivent jamais `state.session` dans `localStorage` : aucune session n'est forgeable depuis le navigateur.
- **Mot de passe oublié réel** : `/mot-de-passe-oublie` demande un lien Supabase Auth et `/reinitialiser-mot-de-passe` finalise le changement ; confirmation e-mail obligatoire conservée (`mailer_autoconfirm=false`). Restent absents : OAuth Google / Facebook et l'option « Se souvenir de moi » (sans effet utile avec JWT 1 h + rotation).
- **Garde de rôle au niveau des routes** (`RoleRoute`) : la navigation et l'URL directe rejettent les modules interdits d'après `usePermissions()`. Ce n'est qu'un confort d'interface : RLS, `has_permission()` et les RPC `SECURITY DEFINER` restent les seules barrières serveur. Fiches annulées non encaissables, dépenses non réannulables, réouverture de caisse unique et motivée, exports CSV protégés contre l'injection de formule.
- **Vérification reproductible** : `npm run check` (JSDOM + esbuild) couvre la logique, le rendu DOM, le schéma SQL, les deux sources de données et Auth/RBAC ; `npm run lint` applique les garde-fous statiques. Rapport initial : [docs/audit.md](docs/audit.md).

## Changer la photo des écrans d'authentification

Remplacez le seul fichier `public/images/lav-auto.jpeg` (même nom). En développement (`npm run dev`), le changement est immédiat ; après un `npm run build`, rechargez la page. Le dégradé sombre posé sur la photo garde le badge « Espace station », l'accroche et les trois repères lisibles, même sur une photo très claire. Sur téléphone, le panneau disparaît et le formulaire reste plein largeur.

## Supabase

`VITE_DATA_SOURCE` choisit le port (`local` par défaut, `supabase` sans repli silencieux). Le mode Supabase exige `VITE_SUPABASE_URL` et **uniquement** la clé publishable `VITE_SUPABASE_ANON_KEY` (voir `.env.example`, le fichier `.env.local` du bac à sable est ignoré par Git) : `AuthPort` utilise alors `SupabaseAuthAdapter`, les lectures RLS de `plans` / catalogue / `my_context()` et l'Edge Function d'invitation. Aucune clé `service_role` ni `sb_secret_` n'est stockée dans le dépôt ou le bundle navigateur ; le secret de la fonction est fourni par son environnement.

En mode local, `LocalAuthAdapter` garde une démonstration hors ligne, sans e-mail : les empreintes de mot de passe sont isolées dans `src/lib/demoPasswords.ts` et la session reste en mémoire. `AppState.passwords` n'existe plus. `src/lib/store.tsx` conserve le contrat des écrans (inscription idempotente, onboarding constaté, 409, caisse, commissions) ; les écritures lavages, finance et stock utilisent les RPC transactionnelles en mode Supabase Auth vérifiée, et des transformateurs purs équivalents en mode local.

Le schéma distant compte **49 migrations** (`001` → `050`, correctif `048` retiré), **70 tables publiques** avec RLS, **2 vues analytics**, **48 permissions**, **112 liaisons** `role_permissions`, **5 index `ix_p10_*`**, un bucket Storage privé et les RPC du cycle lavages, de la finance, du stock, de la certification des coûts, du CRM, des analytics, de la QA et du back-office SaaS. Détails : [docs/database.md](docs/database.md), [docs/security.md](docs/security.md), [docs/deployment.md](docs/deployment.md), [docs/testing.md](docs/testing.md), [docs/auth-rbac.md](docs/auth-rbac.md), [docs/washes.md](docs/washes.md), [docs/finance.md](docs/finance.md), [docs/stock.md](docs/stock.md), [docs/crm.md](docs/crm.md) et [docs/analytics.md](docs/analytics.md). Pour repartir à vide en mode local : *Paramètres → Réinitialiser la démonstration*.

## Structure

```
index.html              point d'entrée Vite
src/
  main.tsx              thème initial + providers
  App.tsx               routes, garde de session et gardes de rôle
  types.ts              types métier (reflet des tables Supabase)
  index.css             thème sombre / clair (variables CSS) + composants Tailwind
  lib/
    format.ts           FCFA, jj/mm/aaaa, export CSV
    metrics.ts          rapports, commissions, théorique de caisse
    plans.ts            repli local + cache de la table `plans`
    supabase.ts         client publishable (Auth + lectures RLS)
    store.tsx           AuthPort, contexte RBAC, état métier local et RPC
    finance.ts / financeState.ts / stock.ts / stockState.ts
    crm.ts / crmState.ts
                        projections et transformations pures P06 / P07 / P08
    usePermissions.ts   reflet UI des permissions serveur
    demoPasswords.ts    empreintes isolées du mode démo local
  services/adapters/    DataAdapter, adaptateurs local / Supabase, commandes RPC
  services/auth/        AuthPort, adaptateurs local / Supabase, types RBAC
  components/
    ui.tsx              briques d'interface
    AppShell.tsx        sidebar, topbar, navigation par rôle
  pages/                vitrine, auth, 18 modules
supabase/migrations/    49 migrations SQL versionnées (Prompts 03–10)
supabase/functions/     Edge Function d'invitation (JWT + permission serveur)
scripts/check.cjs       contrôles reproductibles (npm run check)
scripts/lint.cjs        lint statique (npm run lint)
docs/onboarding.md      parcours, prérequis, refus et vérifications
docs/landing.md         vitrine ixartz : source MIT, mapping des routes, tarifs
docs/database.md        schéma appliqué, RLS, fonctions, tests d'isolation
docs/stock.md           P07 : stock valorisé, consommations, coûts certifiés
docs/crm.md             P08 : CRM, fidélité, forfaits, promotions, flottes, file
docs/analytics.md        P09 : analytics, quotas, Recharts et back-office SaaS
docs/audit.md           rapport d'audit complet
public/images/          photo de lavage
```

## Playbook ERP SaaS (Prompts 01–09)

Le projet évolue progressivement vers un ERP SaaS multi-entreprises. Le diagnostic initial, l'architecture cible, la dette et la stratégie de migration sont consignés ici ; le Prompt 03 a appliqué le schéma réel, le Prompt 04 a branché Supabase Auth et le RBAC serveur, le Prompt 05 le cycle lavages, le Prompt 06 la finance, le Prompt 07 le stock valorisé, le Prompt 08 le CRM et le Prompt 09 les analytics, les quotas serveur, les graphiques Recharts et le back-office SaaS :

- [docs/architecture-audit.md](docs/architecture-audit.md) — cartographie, fonctionnel / simulé / absent, dépendances, sécurité, exactitude financière, état du projet Supabase.
- [docs/architecture-target.md](docs/architecture-target.md) — organisation cible, contrat `DataAdapter`, multi-tenancy, RLS, RBAC, cycles de vie.
- [docs/technical-debt.md](docs/technical-debt.md) — 38 dettes priorisées et 14 risques.
- [docs/migration-roadmap.md](docs/migration-roadmap.md) — phases 02 → 10, mapping des données, cutover et rollback.
- [docs/design-system.md](docs/design-system.md) — **Prompt 02** : tokens clair/sombre, 8 sections de navigation, composants réels (palette `Ctrl/Cmd + K`, fil d'Ariane, confirmation accessible, `DataTable`, états de chargement/erreur), accessibilité et dette restante.
- [docs/database.md](docs/database.md) — **Prompt 03** : 10 migrations initiales, 51 tables, RLS sur 100 % des tables, 8 fonctions transactionnelles, isolation A/B vérifiée, `DataAdapter` en lecture seule derrière `VITE_DATA_SOURCE`, aucune donnée de démonstration. État actuel après P10 : 49 migrations, 70 tables, 2 vues analytics, 48 permissions, 112 liaisons RBAC, 5 index P10 et Storage privé.
- [docs/auth-rbac.md](docs/auth-rbac.md) — **Prompt 04** : 10 migrations supplémentaires (20 au total), Supabase Auth, confirmation e-mail, reset réel, invitations, affectations multi-stations, 31 permissions, `usePermissions`, audit append-only, aucune session forgeable depuis `localStorage`, aucun compte ni e-mail de test.
- [docs/landing.md](docs/landing.md) — Refonte de `/` d'après le modèle public ixartz/Next-js-Boilerplate, attribution MIT, mapping complet des CTA/routes et tarifs `plans` conservés ; `npm run check` **140/0 local** et **141/0 Supabase** après refonte.
- [docs/washes.md](docs/washes.md) — **Prompt 05** : 3 migrations supplémentaires, 7 statuts EN, postes, affectations multiples, contrôle qualité, historique véhicule, 17/17 tests distants.
- [docs/finance.md](docs/finance.md) — **Prompt 06** : 6 migrations supplémentaires (29 au total), clôtures immuables, rapprochement par canal, commissions figées, rapport « coûts manquants », 32/32 tests distants, aucun faux bénéfice net.
- [docs/stock.md](docs/stock.md) — **Prompt 07** : 4 migrations additives (33 au total), 11 RPC, `my_stock_board()`, consommations au coût moyen pondéré, attestation immuable des coûts, 22/22 tests distants, résultat net publié uniquement après certification.
- [docs/crm.md](docs/crm.md) — **Prompt 08** : 5 migrations additives (38 au total), 13 tables, 18 RPC, `my_crm_board()`, fidélité/forfaits/promotions/flottes, file de notifications sans fournisseur ni envoi, 35/35 tests distants en `ROLLBACK`.
- [docs/analytics.md](docs/analytics.md) — **Prompt 09** : 6 migrations additives (44 au total), 2 vues, 12 RPC, quotas serveur, dashboards Recharts, comparaison de périodes, classement des stations, back-office super admin et 30/30 tests distants en `ROLLBACK`.
- [docs/installation.md](docs/installation.md), [docs/architecture.md](docs/architecture.md), [docs/database.md](docs/database.md), [docs/security.md](docs/security.md), [docs/user-guide.md](docs/user-guide.md), [docs/deployment.md](docs/deployment.md), [docs/testing.md](docs/testing.md) — **Prompt 10** : QA, Storage privé, pagination serveur, retry/idempotence, 15 specs Playwright, 16 tests Vitest, CI GitHub Actions, Vercel, sauvegardes/rollback et 30/30 tests distants en `ROLLBACK`.

Rapport de vérification antérieur : [docs/audit.md](docs/audit.md) · Parcours d'ouverture : [docs/onboarding.md](docs/onboarding.md).

## Licence

Voir [LICENSE.md](LICENSE.md) (template Horizon UI d'origine, remplacé par cette application).
