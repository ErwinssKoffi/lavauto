# WashGuard / Lavauto — Feuille de Route de Migration Progressive (Prompt 01)

> **Date :** 11 novembre 2026  
> **Auteur :** Architecte Logiciel Senior ERP SaaS  
> **Statut :** Plan Directeur de Développement  
> **Cadre :** AI Development Playbook — Évolution du repository `ErwinssKoffi/lavauto`

---

## 1. Stratégie de Transition & Compatibilité Continue (Dual-Driver)

Pour garantir que l'application reste **toujours compilable, exécutable et testable à 100 %** à chaque étape du Playbook, nous appliquons la stratégie du **Double Pilote (Dual-Driver Pattern)** :

```
                        ┌─────────────────────────────────┐
                        │   Interface Utilisateur (UI)    │
                        │      Pages & Modules ERP        │
                        └────────────────┬────────────────┘
                                         │
                        ┌────────────────┴────────────────┐
                        │      Couche de Service Métier   │
                        │    (Washes, Cash, Stock, Auth)  │
                        └────────────────┬────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │                                               │
     [SI VITE_SUPABASE_URL ACTIF]                    [MODE DÉMO / HORS LIGNE]
                 ▼                                               ▼
  ┌─────────────────────────────┐                 ┌─────────────────────────────┐
  │     SupabaseDriver          │                 │     LocalStorageDriver      │
  │  PostgreSQL + RLS + Auth    │                 │  Stockage local persistant  │
  └─────────────────────────────┘                 └─────────────────────────────┘
```

### Avantages majeurs :
- **Zéro régression** : Même sans projet Supabase provisionné immédiatement, l'utilisateur et l'agent peuvent manipuler et tester l'ensemble des modules dans l'aperçu AI Studio.
- **Bascule instantanée** : Dès que les identifiants Supabase sont configurés dans `.env.local`, l'application s'appuie directement sur les tables et procédures stockées de PostgreSQL.

---

## 2. Déroulé des 10 Étapes du Playbook

### ✅ Étape 01 — Foundation & Audit Technique (En cours de validation)
- **Objectifs** : Audit complet du code existant, identification des fonctionnalités, normalisation de l'environnement (port 3000, scripts lint/build), cartographie de la dette et définition de l'architecture cible.
- **Livrables créés** :
  - `docs/architecture-audit.md`
  - `docs/architecture-target.md`
  - `docs/technical-debt.md`
  - `docs/migration-roadmap.md`
- **Critères de validation** : Compilation sans erreur, dev server opérationnel, diagnostic documenté.

---

### ⏳ Étape 02 — Design System & UX Professionnelle (Prochaine étape)
- **Objectifs** :
  - Standardiser un Design System sobre et premium (palette claire/sombre, typographie Inter, micro-interactions).
  - Créer les composants structurels : Sidebar repliable avec regroupements ergonomiques (Pilotage, Exploitation, Commercial, RH, Finance, Stock, Analyse, Administration), Topbar avec sélecteur de station, recherche globale (Command palette `Ctrl+K`), DataTables enrichies, Drawers d'inspection de véhicule, Modales de confirmation à double étape.
  - Conserver toutes les interactions existantes sans régression.

---

### ⏳ Étape 03 — Database & Domain Architecture
- **Objectifs** :
  - Écriture des scripts de migration SQL PostgreSQL pour l'ensemble des 24+ entités (entreprises, stations, profils, véhicules, lavages, caisses, dépenses, stocks, abonnements).
  - Définition des clés étrangères, index B-Tree sur les colonnes de filtrage fréquent (`station_id`, `created_at`, `plate`), et contraintes d'unicité.
  - Déploiement des politiques Row Level Security (RLS) avec isolation multi-entreprises.

---

### ⏳ Étape 04 — Authentication, Multi-Tenancy & Access Control
- **Objectifs** :
  - Intégration de Supabase Auth (inscription, connexion, réinitialisation de mot de passe).
  - Gestion des rôles RBAC : Propriétaire, Gérant, Caissier, Laveur, Super-Administrateur plateforme.
  - Découplage de la gestion multi-stations (affectation des employés à une ou plusieurs stations d'une entreprise).
  - Traçabilité et audit log des opérations sensibles en base.

---

### ⏳ Étape 05 — Core Business : Gestion des Lavages & Postes
- **Objectifs** :
  - Enrichissement du cycle de vie des lavages avec 7 états : `pending` ➔ `assigned` ➔ `in_progress` ➔ `quality_check` ➔ `ready` ➔ `delivered` (ou `cancelled`).
  - Gestion des postes de travail physiques (postes extérieurs, intérieurs, detailing, finition).
  - Module de contrôle qualité avant restitution du véhicule.
  - Fiche détaillée du véhicule et historique des passages.

---

### ⏳ Étape 06 — Caisse, Paiements & Gestion Financière
- **Objectifs** :
  - Séparation stricte de la caisse physique (espèces) et des encaissements dématérialisés (Orange Money, MTN MoMo, Wave, Cartes bancaires).
  - Comptage physique contradictoire à la clôture et calcul automatique des écarts de caisse.
  - Catégorisation des dépenses d'exploitation avec justificatifs.
  - Calcul des commissions des laveurs avec gel sur périodes validées.
  - Tableau de rentabilité réelle (Chiffre d'affaires, Marge brute, Résultat d'exploitation).

---

### ⏳ Étape 07 — Stock, Fournisseurs & Approvisionnements
- **Objectifs** :
  - Catalogue des produits et consommables (shampooings, dégraissants, cires, microfibres).
  - Fiches fournisseurs et gestion des commandes d'approvisionnement.
  - Consommation théorique automatique de produit liée aux formules de lavage choisies.
  - Module d'inventaire physique et alertes sur stock bas.

---

### ⏳ Étape 08 — CRM, Fidélisation & Flottes Automobiles
- **Objectifs** :
  - Fiche client 360° avec multi-véhicules rattachés et historique de dépenses.
  - Moteur de fidélité configurable (points cumulés ou 10e lavage offert).
  - Gestion des flottes professionnelles (contrats d'entreprises, facturation groupée en fin de mois).
  - Préparation de l'architecture pour notifications client (WhatsApp / SMS).

---

### ⏳ Étape 09 — Dashboard, Analytics & Administration SaaS
- **Objectifs** :
  - Tableaux de bord analytiques multi-périodes avec comparaisons (J vs J-1, Mois vs Mois-1).
  - Vue consolidée multi-stations pour les propriétaires exploitant plusieurs sites.
  - Console Super-Administrateur pour la gestion des formules SaaS, quotas et suspensions.

---

### ⏳ Étape 10 — QA, Sécurité, Performance & Déploiement
- **Objectifs** :
  - Tests automatisés des flux financiers et des règles critiques.
  - Validation des politiques RLS et étanchéité multi-tenant.
  - Optimisations de performance (chargement différé, requêtes indexées, mise en cache).
  - Documentation finale de mise en production (guide de déploiement et manuel utilisateur).

---

## 3. Matrice de Risques et Stratégie d'Atténuation

| Risque Identifié | Probabilité | Gravité | Mesure d'Atténuation Prévue |
| :--- | :---: | :---: | :--- |
| **Régression sur l'onboarding 13 étapes** | Faible | Élevée | Conservation de la logique `computeOnboarding()` existante comme invariant de test. |
| **Perte des données locales pendant la migration** | Moyenne | Moyenne | Maintien du fallback `LocalStorageDriver` et outil d'export JSON des données avant bascule. |
| **Incohérence des commissions lors de refontes** | Faible | Élevée | Validation unitaire sur le moteur `metrics.ts` avec cas de test figés (barème vs override). |
| **Conflits de ports dans AI Studio** | Nulle | Critique | Port `3000` et écoute `0.0.0.0` verrouillés dans `vite.config.ts`. |
