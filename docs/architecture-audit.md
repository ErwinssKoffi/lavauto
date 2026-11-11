# WashGuard / Lavauto — Audit Technique et Cartographie de l'Existant (Prompt 01)

> **Date :** 11 novembre 2026  
> **Auteur :** Architecte Logiciel Senior ERP SaaS  
> **Statut :** Validé — Baseline initiale du repository `ErwinssKoffi/lavauto`  
> **Portée :** Audit exhaustif du code, des données, des règles métier, de la sécurité et des dépendances.

---

## 1. Synthèse Exécutive de l'Audit

Le projet `ErwinssKoffi/lavauto` (nom commercial interne : **WashGuard**) constitue une excellente base de départ pour un ERP de station de lavage. Loin d'être une coquille vide ou une simple maquette statique, le repository dispose déjà d'un ensemble cohérent de règles métier et d'une interface utilisateur complète en français, calibrée pour le marché d'Afrique de l'Ouest (devises en **FCFA / XOF**, moyens de paiement Mobile Money, gestion des pourcentages de commission des laveurs).

### Points forts majeurs
1. **Règles métier saines et strictes** : Les principes comptables et opérationnels de base sont déjà bien pensés :
   - Tarifs des prestations **figés** sur chaque ligne de lavage (`WashItem.unitPrice`) au moment de la création.
   - Les remises caissier sont bornées (`maxCashierDiscount`).
   - Les encaissements en espèces nécessitent une caisse ouverte (`cashRequiresOpen`).
   - Les dépenses et les fiches annulées ne sont jamais effacées de la base (`status: 'annulee'`, avec motif obligatoire et traçabilité).
   - Les commissions des laveurs sont calculées uniquement sur les prestations achevées (`status === 'termine'`), avec prise en charge d'un barème général ou d'un taux préférentiel par laveur.
   - Le système de clôture de caisse compare le solde théorique calculé au comptage physique et calcule l'écart.
2. **Onboarding constaté (13 étapes / 8 obligatoires)** : Le parcours d'ouverture de station n'est pas un formulaire gadget mais un véritable moteur d'invariants qui bloque toute écriture d'exploitation (`409 onboarding_incomplete`) tant que les tarifs, catégories, horaires et identités ne sont pas enregistrés.
3. **Protection contre la tempête de requêtes (`fetchMeOnce`)** : Présence d'un garde-fou empêchant les boucles de rafraîchissement d'authentification 401.

### Principales limites à adresser pour le passage en ERP SaaS multi-entreprises
1. **Persistance 100 % locale (`localStorage`)** : Toutes les données sont sérialisées dans la clé navigateur `washguard.state.v1`. Aucune donnée n'est partagée en temps réel entre plusieurs postes (ex. caissier sur tablette + gérant sur PC).
2. **Authentification simulée** : Les mots de passe sont stockés en clair dans le state local (`passwords: Record<string, string>`).
3. **Mono-station en mémoire** : Bien que les types `Company` et `Station` prévoient des identifiants distincts, l'état applicatif actuel (`AppState`) ne manipule qu'une seule entreprise et une seule station active à la fois.
4. **Périmètre fonctionnel incomplet par rapport au Playbook ERP** :
   - Absence de module de gestion des stocks (produits consommables, shampooings, microfibres) et approvisionnements fournisseurs.
   - Absence de gestion des postes de lavage (postes extérieur, intérieur, detailing).
   - Cycle de vie des lavages restreint à 4 états (`en_attente`, `en_cours`, `termine`, `annule`) sans les étapes intermédiaires critiques (`assigned`, `quality_check`, `ready`, `delivered`).
   - Absence de contrôle qualité formalisé avant restitution du véhicule.
   - CRM basique sans programme de fidélité par points, forfaits ou flottes d'entreprises.

---

## 2. Cartographie des Fichiers et de l'Architecture Actuelle

### 2.1 Arborescence actuelle du code source
```
/
├── index.html                   # Entrypoint HTML (titre, dark mode, Google Fonts Inter)
├── package.json                 # Dépendances, scripts (dev, build, preview, typecheck, lint)
├── vite.config.ts               # Configuration Vite (Vite React, port 3000, allowedHosts: true)
├── tailwind.config.js           # Configuration Tailwind v3 (purge sur src, extension de thème)
├── postcss.config.js            # PostCSS (Tailwind, Autoprefixer)
├── tsconfig.json                # TypeScript ES2020, Bundler resolution, strict mode
├── docs/
│   └── onboarding.md            # Spécification détaillée du parcours de mise en route en 13 étapes
├── public/
│   ├── favicon.ico
│   ├── manifest.json            # PWA manifest de base
│   ├── robots.txt
│   └── images/lav-auto.jpeg     # Asset illustration
└── src/
    ├── main.tsx                 # Bootstrapping React 19, BrowserRouter, StoreProvider
    ├── App.tsx                  # Routage React Router v6, SessionGate, LandingRoute, AuthRoute, AppRoute
    ├── index.css                # Variables CSS de thème (--wg-*), composants Tailwind (@layer components)
    ├── types.ts                 # Interfaces TypeScript de l'ensemble du domaine
    ├── components/
    │   ├── AppShell.tsx         # Layout principal avec Sidebar responsive, Topbar, breadcrumbs, thème
    │   └── ui.tsx               # Composants UI (Logo, Card, PageHeader, StatCard, Badge, Dialog, Modal...)
    ├── lib/
    │   ├── format.ts            # Utilitaires de formatage FCFA, dates, numéros de facture, UID
    │   ├── metrics.ts           # Moteur de calcul (chiffre d'affaires, commissions, caisse théorique, rapports)
    │   ├── plans.ts             # Grille des forfaits SaaS (Essai, Standard, Premium)
    │   ├── store.tsx            # Context React & Moteur métier (747 lignes, store unique, persistance localStorage)
    │   └── supabase.ts          # Client Supabase instancié si VITE_SUPABASE_URL et ANON_KEY sont présents
    └── pages/
        ├── Landing.tsx          # Page vitrine publique avec tarification, fonctionnalités et FAQ
        ├── Onboarding.tsx       # Assistant de configuration 13 étapes
        ├── Dashboard.tsx        # Tableau de bord opérationnel & financier
        ├── Washes.tsx           # Gestion des fiches de lavage (création, filtres, paiement)
        ├── Services.tsx         # Catalogue de prestations & matrice tarifaire par catégorie de véhicule
        ├── Clients.tsx          # Carnet d'adresses clients et plaques d'immatriculation
        ├── Employees.tsx        # Équipe (propriétaire, gérants, caissiers, laveurs) & barèmes
        ├── Cash.tsx             # Gestion de la caisse (ouverture, clôture avec comptage, réouverture motivée)
        ├── Expenses.tsx         # Dépenses d'exploitation et liaison avec la caisse espèces
        ├── Reports.tsx          # Rapports d'activité (jour, semaine, mois) et export CSV
        ├── Commissions.tsx      # Calcul des commissions dues aux laveurs
        ├── Settings.tsx         # Paramètres de la station (horaires, règles caisse, objectifs)
        ├── Subscription.tsx     # Gestion de l'abonnement SaaS WashGuard
        ├── Platform.tsx         # Console Super-Admin (plateforme WashGuard)
        └── auth/
            ├── AuthLayout.tsx   # Layout centré avec carte de connexion/inscription
            ├── SignIn.tsx       # Écran de connexion (mot de passe local ou démo support)
            └── SignUp.tsx       # Écran d'inscription en 2 volets (Entreprise + Propriétaire)
```

---

## 3. Matrice d'Audit Fonctionnel

| Module / Fonctionnalité | Statut Actuel | Mécanisme de Persistance | Évaluation Technique |
| :--- | :---: | :--- | :--- |
| **Vitrine commerciale (Landing)** | ✅ Opérationnel | Données statiques + `PLANS` | Très propre, tarification synchronisée, responsive. |
| **Authentification & Session** | ⚠️ Partiel (Simulé) | `localStorage` (mots de passe clairs) | Logique de session OK (`SessionGate`), mais sécurité inadaptée pour la prod. |
| **Onboarding (13 étapes)** | ✅ Opérationnel | `localStorage` | Excellente architecture basée sur la détection d'état réel (`computeOnboarding`). |
| **Garde 409 `onboarding_incomplete`** | ✅ Opérationnel | `store.tsx` (`assertActivated`) | Fonctionne parfaitement. Bloque fiches, paiements, caisse et dépenses. |
| **Fiches de lavage (Washes)** | ✅ Opérationnel | `localStorage` | Calcul correct, remise caissier bornée, prix figés, association employé. |
| **Cycle de vie du lavage** | ⚠️ Partiel | `localStorage` | 4 statuts seulement (`en_attente`, `en_cours`, `termine`, `annule`). Manque contrôle qualité et postes. |
| **Catalogue & Tarifs (Services)** | ✅ Opérationnel | `localStorage` | Matrice dynamique Prestations × Catégories de véhicules. Très ergonomique. |
| **Clients & Véhicules** | ⚠️ Partiel | `localStorage` | Fiche client avec plaque et notes, mais pas de multi-véhicules par client ni contrat flotte. |
| **Gestion de caisse (Cash)** | ✅ Opérationnel | `localStorage` | Ouverture, fond initial, encaissements espèces, dépenses espèces, clôture avec écart. |
| **Dépenses (Expenses)** | ✅ Opérationnel | `localStorage` | Enregistrement, annulation tracée non destructrice, liaison caisse espèces. |
| **Commissions laveurs** | ✅ Opérationnel | Calcul dynamique en mémoire | Filtrage des lavages terminés, gestion des taux préférentiels d'employés. |
| **Rapports & KPI (Reports)** | ✅ Opérationnel | Calcul dynamique en mémoire | Filtrage par période, top prestations, répartition par moyen de paiement. |
| **Abonnements & Limites SaaS** | ⚠️ Partiel (Simulé) | `localStorage` | Sélection de formule présente, mais les quotas (nb employés, lavages max) ne sont pas strictement bloquants. |
| **Espace Plateforme (Support)** | ⚠️ Partiel (Simulé) | `localStorage` | Vue globale et suspension d'entreprise fonctionnelles en mode démo. |
| **Stocks & Consommables** | ❌ Absent | Néant | Nécessaire pour le calcul de marge réelle (Prompt 07). |
| **Fournisseurs & Approvisionnements** | ❌ Absent | Néant | Prévu pour Prompt 07. |
| **Contrôle Qualité Lavage** | ❌ Absent | Néant | Prévu pour Prompt 05. |
| **Postes de Lavage (Bays)** | ❌ Absent | Néant | Prévu pour Prompt 05. |
| **Fidélisation & Forfaits** | ❌ Absent | Néant | Prévu pour Prompt 08. |
| **Multi-stations par entreprise** | ❌ Absent | Structure mono-station dans state | Prévu pour Prompts 03 & 04. |

---

## 4. Analyse des Dépendances & Environnement

### 4.1 Packages actuels
- **Runtime :**
  - `react`: `^19.0.0`
  - `react-dom`: `^19.0.0`
  - `react-router-dom`: `^6.30.6`
  - `react-icons`: `^4.12.0`
  - `@supabase/supabase-js`: `^2.119.0` (déjà présent et prêt pour l'intégration)
- **Dev :**
  - `vite`: `^8.3.8`
  - `@vitejs/plugin-react`: `^6.3.0`
  - `typescript`: `^7.0.2`
  - `tailwindcss`: `^3.1.8`
  - `postcss`: `^8.4.16`
  - `autoprefixer`: `^10.4.8`

### 4.2 Évaluation des besoins futurs
- **Zod & React Hook Form** : recommandés pour la validation stricte des formulaires d'approvisionnement, d'inventaire et de configuration multi-stations.
- **date-fns** : recommandé pour les calculs de dates, clôtures mensuelles et échéances d'abonnement.
- **Lucide React** : peut compléter ou harmoniser `react-icons`.

---

## 5. Audit de Sécurité et Risques Identifiés

1. **Absence d'isolation multi-tenant côté serveur** :
   - Risque : En l'absence de base de données PostgreSQL avec Row Level Security (RLS), la séparation des données repose sur des filtres mémoire. Tout utilisateur accédant au terminal navigateur pourrait lire l'ensemble du `localStorage`.
   - Remède : Migration vers Supabase avec tables partitionnées par `company_id` et `station_id` sous contrôle strict de politiques RLS `auth.uid() = user_profiles.id`.
2. **Stockage des mots de passe en clair** :
   - Risque : Violation majeure de sécurité (`passwords[email]`).
   - Remède : Remplacement par Supabase Auth qui gère le hachage sécurisé bcrypt/argon2 et les jetons JWT HTTP-only ou sécurisés.
3. **Absence de contrôle d'intégrité référentielle** :
   - Risque : La suppression d'une catégorie de véhicule ou d'une prestation pourrait rendre incohérentes d'anciennes fiches de lavage si l'id disparaît.
   - Remède actuel : Le code actuel atténue cela en figeant les prix (`WashItem.unitPrice`) et en effectuant des soft-deletes (`active: false`). En base PostgreSQL, des contraintes de clés étrangères avec `ON DELETE RESTRICT` ou `soft-delete` formalisé garantiront l'intégrité absolue.
4. **Perte de données sur vidage de cache** :
   - Risque : Le nettoyage des données de navigation par un laveur ou un caissier efface l'intégralité de l'historique commercial de la station.
   - Remède : Persistance cloud Supabase PostgreSQL avec synchronisation locale optimiste.

---

## 6. Conclusion de l'Étape 01

Le repository `lavauto` dispose d'un capital applicatif solide : la logique métier ivoirienne (FCFA, commissions, caisse obligatoire, onboarding strict) est déjà implémentée et testée. Notre stratégie consiste à **ne détruire aucun acquis fonctionnel**, mais à extraire progressivement cette logique du bloc monolithique `src/lib/store.tsx` vers une architecture modulaire en couches, couplée à un Design System ERP premium et à une base de données PostgreSQL/Supabase sécurisée.
