# WashGuard — frontend

Application de gestion de station de lavage en React, TypeScript et Tailwind CSS. **Par défaut, c’est une démonstration locale, pas un service de production : les données restent dans le navigateur, sans synchronisation Supabase et avec des accès non sécurisés.** N’utilisez ni données réelles ni mot de passe personnel. Le mode connecté et ses RPC sont disponibles dans le code, mais cette branche dépend de migrations et d’une recette qui ne sont pas encore appliquées ou réalisées sur `lavauto`.

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
npm run test:unit  # Vitest et PostgreSQL isolé (PGlite)
npm run test:postgres:concurrency  # exige un cluster PostgreSQL temporaire vierge ; voir docs/testing.md
npm run test:e2e   # Playwright : données et Auth locales de test
npm run test:e2e:connected  # Playwright : Supabase simulé, sans service distant
npx supabase --version  # CLI locale ; l’installation n’authentifie ni ne lie le projet
```

Les parcours E2E couvrent notamment lavage, paiements, clôture et invitation ; les limites du mode local et du backend simulé sont décrites dans [docs/testing.md](docs/testing.md). Aucun de ces tests n’envoie d’e-mail réel.

Le serveur de développement écoute sur `0.0.0.0:5173`. En production, servez `dist/` derrière un serveur qui renvoie `index.html` pour toutes les routes (SPA).

La vitrine `/` conserve son design WashGuard et identifie ses illustrations comme fictives. Les tarifs proviennent des formules locales en démonstration et de `plans` en mode connecté, sans repli fictif en cas d’erreur. Voir [docs/landing.md](docs/landing.md). La génération automatisée de captures (`make rendu`) n'est pas encore en place.

## Ce qui est implémenté

| Écran | Contenu |
| --- | --- |
| `/` — Vitrine | Design WashGuard, navigation et CTA vers `/connexion`, `/inscription` et les ancres ; illustrations explicitement fictives, aucun témoignage inventé et tarifs lus dans `plans` en mode connecté, sans repli local sur erreur. |
| `/connexion`, `/inscription` | Même mise en page `AuthLayout` : formulaire sur surface claire et centrée, panneau photo à droite (`public/images/lav-auto.jpeg`) avec dégradé sombre, masqué sur téléphone. Connexion avec affichage du mot de passe, alerte verrouillage majuscules, validation du champ e-mail et messages de verrouillage (`429`). Inscription groupée en deux temps : *votre entreprise et sa station* (nom de l'entreprise, nom de la station, téléphone, ville), puis *votre compte de propriétaire*, avec jauge de robustesse, liste des règles, confirmation du mot de passe et suggestion de domaine e-mail. |
| Mise en route | 13 étapes, **8 obligatoires**, dont l'état est **constaté sur les données enregistrées** : aucune case n'est cochée par le navigateur. Voir [docs/onboarding.md](docs/onboarding.md). |
| Tableau de bord | CA du jour, lavages, encaissements, dépenses, état de la caisse, alertes, dernières opérations, objectif du mois et tendance Recharts du mois. |
| Lavages | Fiche rapide, statuts, encaissement et annulation ; reçu client imprimable / PDF en local et en connecté ; journal et demande WhatsApp pour lavage prêt lorsque le serveur est configuré. |
| Prestations | Catalogue propre à la station et grille tarifaire par catégorie de véhicules. **Modifier un tarif ne change jamais les lavages déjà enregistrés.** |
| Clients | Fiche facultative, historique, recherche et accord explicite distinct pour les avis WhatsApp de lavage prêt. Un lavage peut être encaissé sans client. |
| Employés | Comptes, rôles, activation, réinitialisation de mot de passe et activité. Le réglage individuel de commission dans cette liste est réservé à la démonstration locale. |
| Caisse | Ouverture avec fond, clôture avec **comptage** et écart théorique / compté, réouverture motivée, rapprochement par canal et historique. En mode connecté, les espèces exigent une caisse ouverte ; le réglage local ne change pas cette règle serveur. |
| Dépenses | Montant, catégorie, motif, fournisseur, date, moyen de paiement, rattachement à la caisse ouverte, annulation motivée (**jamais de suppression**). |
| Rapports | Jour / semaine / mois, meilleures prestations, activité par employé, répartition par moyen de paiement, historique de caisse, meilleurs clients, **export CSV**. |
| Commissions | Aperçu des lavages **terminés** et relevés validés figés avec **export CSV pour la paie**. En mode connecté, les relevés utilisent les contrats et le barème station côté serveur ; l’exception locale par compte est une simulation. Réservé au propriétaire et au gérant. |
| Stocks & achats | Produits, fournisseurs, commandes sans incrémentation de stock, réceptions partielles idempotentes, coût moyen pondéré, inventaires, mouvements immuables, rattachement des dépenses d'achat et attestations de coûts. |
| Consommations | Normes `prestation × produit`, consommation théorique agrégée et valorisée une seule fois par fiche prête, journal des sorties et coût de revient. |
| Paramètres | La migration locale `056` prépare l’enregistrement et la relecture serveur de l’identité, des horaires, moyens de paiement, barème et objectif, ainsi que du catalogue. Elle n’est pas déployée sur `lavauto`. Les règles de caisse et le plafond de remise sont verrouillés en mode connecté, car non garantis côté serveur ; les simulations de stock sont réservées à la démo. |
| Abonnement | Essai, comparaison des formules, relevé et demande de changement ; en mode connecté, activation uniquement après validation administrateur, sans paiement automatique. Lecture seule après expiration. Voir [docs/subscriptions.md](docs/subscriptions.md). |
| Consolidation multi-stations | Comparaison de deux périodes avec les mêmes définitions, courbes, classement des stations par chiffre d'affaires, détail par station et règles de certification. |
| Espace plateforme | Réservé au super admin : entreprises clientes, formules et quotas administrables, abonnements, suspension, compteurs d'usage, recalcul serveur et journal. |

### Règles respectées

- **Aucun prix de prestation n'est prédéfini.** Les libellés proposés pendant la mise en route (Berline, Lavage extérieur…) ne sont que des raccourcis de saisie. Un tableau de stock serveur vide ne reçoit aucun produit fictif ; des exemples de stock peuvent être créés dans la démonstration entièrement locale.
- Tant que la station n'est pas activée, les écritures de métier lèvent `409 onboarding_incomplete` avec la liste de ce qui manque (`src/lib/store.tsx`, `assertActivated`). Les écrans concernés affichent le panneau de blocage.
- **Session réactive** : en mode connecté, `auth.getUser()` et `my_context()` relisent l’identité et les permissions. La session de démonstration reste en mémoire et n’est pas restaurée depuis `localStorage` ; cela ne fait pas du mode local une authentification sûre.
- **Mot de passe oublié** : en mode Supabase, les écrans utilisent les liens Auth et dépendent de la configuration réelle d’envoi ; en mode API, un jeton à usage unique (1 heure) est généré et toutes les sessions sont fermées après usage ; en mode local aucun e-mail ni lien de récupération n’est disponible. OAuth Google / Facebook et l’option « Se souvenir de moi » sont absents.
- **Sécurité du compte** (menu du compte → *Sécurité du compte*) : changement de mot de passe avec mot de passe actuel, liste des sessions actives avec révocation (une session précise, la session courante ou toutes les autres) et journal des 20 derniers événements d’authentification. En mode Supabase Auth, seule la fermeture des autres appareils est disponible ; en mode local la session vit en mémoire.
- **Connexion protégée (mode API)** : politique de mot de passe partagée formulaire/serveur (8 à 200 caractères, lettre et chiffre, mots de passe courants refusés), limitation de débit avec `429` et `Retry-After` (8 échecs par compte et 25 par IP par quart d’heure), messages sans énumération de comptes, expiration glissante des sessions plafonnée à 180 jours et journal `auth_events` sans secret. Le compteur est en mémoire : un déploiement multi-instances doit ajouter un limiteur partagé. La confirmation d’e-mail est optionnelle (`WASHGUARD_REQUIRE_EMAIL_CONFIRMATION=1`) et aucun e-mail réel n’est expédié par ce dépôt.
- **Garde de rôle au niveau des routes** (`RoleRoute`) : la navigation et l'URL directe rejettent les modules interdits d'après `usePermissions()`. Ce n'est qu'un confort d'interface : RLS, `has_permission()` et les RPC `SECURITY DEFINER` restent les seules barrières serveur. Fiches annulées non encaissables, dépenses non réannulables, réouverture de caisse unique et motivée, exports CSV protégés contre l'injection de formule.
- **Vérification reproductible** : `npm run check` (JSDOM + esbuild) couvre la logique, le rendu DOM, le schéma SQL, les deux sources de données et Auth/RBAC ; `npm run lint` applique les garde-fous statiques. Rapport initial : [docs/audit.md](docs/audit.md).

## Changer la photo des écrans d'authentification

Remplacez le seul fichier `public/images/lav-auto.jpeg` (même nom). En développement (`npm run dev`), le changement est immédiat ; après un `npm run build`, rechargez la page. Le dégradé sombre posé sur la photo garde le badge « Espace station », l'accroche et les trois repères lisibles, même sur une photo très claire. Sur téléphone, le panneau disparaît et le formulaire reste plein largeur.

## Supabase

`VITE_DATA_SOURCE` choisit le port (`local` par défaut, `supabase` sans repli silencieux). Le mode Supabase exige `VITE_SUPABASE_URL` et **uniquement** la clé publishable `VITE_SUPABASE_ANON_KEY` (voir `.env.example`, le fichier `.env.local` du bac à sable est ignoré par Git) : `AuthPort` utilise alors `SupabaseAuthAdapter`, les lectures RLS de `plans` / catalogue / `my_context()` et l'Edge Function d'invitation. Aucune clé `service_role` ni `sb_secret_` n'est stockée dans le dépôt ou le bundle navigateur ; le secret de la fonction est fourni par son environnement.

En mode local, une empreinte de mot de passe faible est stockée séparément et la session reste en mémoire : ce dispositif n’est **pas sécurisé**. Les changements affichés sont enregistrés de façon asynchrone sous verrou ; attendez la fin de l’indicateur « Enregistrement local en cours » avant de recharger, fermer ou exporter. Un avertissement avant fermeture est demandé si des changements restent en mémoire, mais certains navigateurs peuvent l’ignorer. La copie JSON non chiffrée des deux clés locales ne contient que les données effectivement sauvegardées ; aucune restauration par l’interface n’est fournie. Consultez [docs/security.md](docs/security.md) avant toute manipulation.

En mode connecté, `create_wash_atomic` réunit fiche et paiement initial et dépend de `052` ; le frontend et les droits de cette branche dépendent également de `053`–`057`, absentes sur `lavauto`. Créations, paiements et dépenses incertains conservent leurs données de reprise dans le `sessionStorage` du même onglet, compte et station : perte du stockage, autre onglet ou autre appareil ne sont pas coordonnés. Les autres actions financières n’ont pas toutes cette reprise ; une relecture défaillante nécessite une vérification manuelle avant répétition. Voir [docs/testing.md](docs/testing.md).

L’état distant historique P10 comptait **49 migrations** (`001` → `050`, correctif `048` retiré), **70 tables publiques**, **2 vues analytics**, **48 permissions**, **112 liaisons** `role_permissions`, **5 index `ix_p10_*`** et un bucket Storage privé. Après application autorisée de `051` et `052`, le journal distant du projet `lavauto` compte **51 migrations** ; la nouvelle table d’idempotence est sous RLS. Détails : [docs/database.md](docs/database.md), [docs/security.md](docs/security.md), [docs/deployment.md](docs/deployment.md), [docs/testing.md](docs/testing.md), [docs/auth-rbac.md](docs/auth-rbac.md), [docs/washes.md](docs/washes.md), [docs/finance.md](docs/finance.md), [docs/stock.md](docs/stock.md), [docs/crm.md](docs/crm.md) et [docs/analytics.md](docs/analytics.md). Pour repartir à vide en mode local : *Paramètres → Réinitialiser la démonstration*.

### Abonnements

L’essai donne accès à tous les modules pendant 14 jours, sauf si une formule demandée est validée plus tôt : **la validation active immédiatement la formule et termine l’essai**. Standard couvre la gestion essentielle ; Premium ajoute les modules avancés. Une demande ou validation ne constitue pas un paiement. Après expiration, les données restent lisibles selon la dernière formule effective et les écritures métier ordinaires sont bloquées ; le retrait WhatsApp avec preuve reste possible sous réserve des droits. Le mois de quota est UTC ; le propriétaire et les invitations réservées comptent dans le quota de comptes connecté. Modalités, tarifs indicatifs et limites : [docs/subscriptions.md](docs/subscriptions.md).

### Migrations et logo privé de la station

Le dépôt contient **56 migrations locales numérotées** (`001`–`057`, sans `048`). Avec l’accord de l’utilisateur, `051` et `052` ont été appliquées sur `lavauto` sous les versions `20261112130423` et `20261112130520` : ne pas les réappliquer. `053` (WhatsApp), `054` (stations/métriques), `055` (validation/finance), `056` (configuration/catalogue) et `057` (abonnements et droits) restent **locales**. Aucun déploiement en production ni aucune migration supplémentaire n’a été autorisé ; un aperçu Vercel créé automatiquement pour une PR et les essais isolés ne remplacent pas une recette réelle.

La CLI locale est installée et initialisée (`supabase/config.toml`), mais elle n’est ni authentifiée ni liée au projet. Les migrations et le seed sont désactivés dans cette configuration locale par précaution : les versions locales et distantes divergent. Ne pas lancer `supabase db push`, `migration repair` ou `db reset` aveuglément, même avec ce garde-fou. Voir [docs/deployment.md](docs/deployment.md) et [docs/testing.md](docs/testing.md).

Dans **Paramètres → Identité de la station**, un utilisateur autorisé (`settings.manage`) peut choisir un PNG, JPEG ou WebP de 5 Mo maximum. L’image est optimisée lorsque possible, enregistrée dans le bucket privé, puis associée à la station. Seul le chemin est conservé ; l’aperçu utilise une URL signée temporaire régénérée à l’affichage. L’étape facultative de mise en route utilise le même éditeur. En mode local l’envoi est désactivé. Les anciennes URL ne sont pas réutilisées : il faut téléverser le logo à nouveau. Remplacer ou retirer le logo ne supprime pas l’ancien fichier Storage.

### Reçu client et WhatsApp Meta

Dans **Lavages → Détails → Reçu client**, l’aperçu peut être imprimé ou téléchargé en PDF, y compris en mode local. Il reflète la fiche chargée, inclut les paiements annulés et signale les incohérences ; il ne constitue pas une facture fiscale. La police est servie par le déploiement et le PDF généré dans le navigateur.

Le code WhatsApp prépare une demande au passage à **Prêt / terminé** et propose une demande manuelle, uniquement avec consentement explicite valide du client. La demande attend un worker, un modèle Meta approuvé et un ordonnanceur ; acceptation, livraison et résultat incertain sont distingués. Après expiration, le retrait avec preuve est préparé localement pour les utilisateurs autorisés et annule les demandes non encore réclamées. Un envoi déjà réclamé peut encore atteindre Meta ; si le retrait est refusé ou incertain, contacter le support avant toute reprise. L’ancienne file CRM reste séparée et non expédiée. **`053`–`057`, les fonctions, les secrets et l’ordonnanceur ne sont pas déployés : aucun message réel n’a été envoyé.** Le compte et l’expéditeur sont déclarés approuvés par l’utilisateur ; le modèle n’a pas été vérifié. [Guide de configuration, consentement, statuts et limites](docs/whatsapp-receipts.md).

## Structure

```
index.html              point d'entrée Vite
src/
  main.tsx              thème initial + providers
  App.tsx               routes, garde de session et gardes de rôle
  types.ts              types métier (reflet des tables Supabase)
  index.css             Tailwind 4 + thèmes DaisyUI 5 (CSS-first) + règles globales (fond, focus, reçu)
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
supabase/config.toml    configuration CLI locale ; migrations/seed désactivés par précaution
supabase/migrations/    49 historiques + 051/052 appliquées + 053–057 locales ; 3 fichiers datés historiques
supabase/functions/     invitation ; dispatch et webhook WhatsApp Meta non déployés
scripts/check.cjs       contrôles reproductibles (npm run check)
scripts/lint.cjs        lint statique (npm run lint)
docs/onboarding.md      parcours, prérequis, refus et vérifications
docs/landing.md         vitrine actuelle, exemples, liens, tarifs et attribution historique
docs/database.md        schéma appliqué, RLS, fonctions, tests d'isolation
docs/stock.md           P07 : stock valorisé, consommations, coûts certifiés
docs/crm.md             P08 : CRM, fidélité, forfaits, promotions, flottes, file historique
docs/whatsapp-receipts.md  reçu, consentement, Meta, webhook et déploiement contrôlé
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
- [docs/design-system.md](docs/design-system.md) — **DaisyUI** : 37 thèmes (thème par défaut `cupcake`, sélecteur dans la topbar), 8 sections de navigation, composants réels (palette `Ctrl/Cmd + K`, fil d'Ariane, confirmation accessible, `DataTable`, états de chargement/erreur), accessibilité et dette restante.
- [docs/migration-daisyui.md](docs/migration-daisyui.md) — journal de la migration vers DaisyUI : ordre des étapes, table de correspondance `wg-*` → DaisyUI, densité, garde-fous et écarts visuels assumés.
- [docs/database.md](docs/database.md) — **Prompt 03** : 10 migrations initiales, 51 tables, RLS sur 100 % des tables, 8 fonctions transactionnelles, isolation A/B vérifiée, `DataAdapter` en lecture seule derrière `VITE_DATA_SOURCE`, aucune donnée de démonstration. État historique après P10 : 49 migrations, 70 tables, 2 vues analytics, 48 permissions, 112 liaisons RBAC, 5 index P10 et Storage privé.
- [docs/auth-rbac.md](docs/auth-rbac.md) — **Prompt 04** : 10 migrations supplémentaires (20 au total), Supabase Auth, confirmation e-mail, reset réel, invitations, affectations multi-stations, 31 permissions, `usePermissions`, audit append-only, aucune session forgeable depuis `localStorage`, aucun compte ni e-mail de test.
- [docs/landing.md](docs/landing.md) — Vitrine WashGuard actuelle, navigation, exemples fictifs, prix et attribution historique.
- [docs/washes.md](docs/washes.md) — **Prompt 05** : 3 migrations supplémentaires, 7 statuts EN, postes, affectations multiples, contrôle qualité, historique véhicule, 17/17 tests distants.
- [docs/finance.md](docs/finance.md) — **Prompt 06** : 6 migrations supplémentaires (29 au total), clôtures immuables, rapprochement par canal, commissions figées, rapport « coûts manquants », 32/32 tests distants, aucun faux bénéfice net.
- [docs/stock.md](docs/stock.md) — **Prompt 07** : 4 migrations additives (33 au total), 11 RPC, `my_stock_board()`, consommations au coût moyen pondéré, attestation immuable des coûts, 22/22 tests distants, résultat net publié uniquement après certification.
- [docs/crm.md](docs/crm.md) — **Prompt 08 historique** : 5 migrations, CRM et ancienne file sans fournisseur ni envoi, 35/35 tests distants en `ROLLBACK`. Les nouveaux avis de lavage prêt sont séparés et non déployés : [docs/whatsapp-receipts.md](docs/whatsapp-receipts.md).
- [docs/analytics.md](docs/analytics.md) — **Prompt 09** : 6 migrations additives (44 au total), 2 vues, 12 RPC, quotas serveur, dashboards Recharts, comparaison de périodes, classement des stations, back-office super admin et 30/30 tests distants en `ROLLBACK`.
- [docs/installation.md](docs/installation.md), [docs/architecture.md](docs/architecture.md), [docs/database.md](docs/database.md), [docs/security.md](docs/security.md), [docs/user-guide.md](docs/user-guide.md), [docs/deployment.md](docs/deployment.md), [docs/testing.md](docs/testing.md) — **Prompt 10, résultats historiques** : QA, Storage privé, pagination serveur, retry/idempotence, CI GitHub Actions, Vercel et tests distants en `ROLLBACK`. Les résultats de la présente branche figurent dans [docs/testing.md](docs/testing.md).

Rapport de vérification antérieur : [docs/audit.md](docs/audit.md) · Parcours d'ouverture : [docs/onboarding.md](docs/onboarding.md).

## Licence

Voir [LICENSE.md](LICENSE.md) (template Horizon UI d'origine, remplacé par cette application).
