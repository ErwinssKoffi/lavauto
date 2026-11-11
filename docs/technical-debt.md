# WashGuard / Lavauto — Registre de Dette Technique et Analyse des Risques (Prompt 01)

> **Date :** 11 novembre 2026  
> **Auteur :** Architecte Logiciel Senior ERP SaaS  
> **Statut :** Document d'évaluation et de remédiation  
> **Cadre :** AI Development Playbook — Évolution du repository `ErwinssKoffi/lavauto`

---

## 1. Classification de la Dette Technique

L'audit approfondi du repository permet de classifier la dette technique selon 6 axes critiques :

### 1. Dette Architecturale : Monostore d'État (`src/lib/store.tsx`)
- **Constat** : Le fichier `store.tsx` cumule 747 lignes et concentre l'ensemble des responsabilités applicatives :
  1. État global des données (entreprises, stations, utilisateurs, fiches, caisse, dépenses).
  2. Logique de persistance (`localStorage.setItem`).
  3. Moteur d'authentification simulé et gestion des sessions.
  4. Moteur de validation métier (calcul des montants, contrôle des remises, contrôle de caisse).
  5. Gestion des notifications toast et du thème graphique.
  6. Journal d'audit en mémoire.
- **Impact** : Risque élevé de régression à chaque modification, re-rendus React massifs lors de la mise à jour d'un sous-élément, impossibilité de mettre en place une pagination serveur ou un cache optimiste par requête.
- **Plan de remédiation** : Découpage progressif en services autonomes par module (`services/wash.service.ts`, `services/cash.service.ts`, etc.) et adoption de contextes spécialisés ou de TanStack Query dès la connexion Supabase.

---

### 2. Dette de Sécurité & Gestion des Identités
- **Constat** :
  - Les mots de passe sont conservés en texte brut dans le dictionnaire `passwords: Record<string, string>`.
  - La vérification du rôle (`role === 'proprietaire'`, etc.) s'effectue exclusivement dans les composants React (`AppShell.tsx`, `App.tsx`).
  - Aucun jeton d'authentification cryptographique (JWT) ni mécanisme de rafraîchissement de session n'est encore implémenté côté serveur.
- **Impact** : Tout utilisateur disposant d'un accès aux Developer Tools du navigateur peut modifier son rôle dans le state React et contourner les barrières visuelles.
- **Plan de remédiation (Prompt 04)** :
  - Remplacement complet du système d'authentification local par Supabase Auth.
  - Déplacement de la validation des droits vers les politiques de sécurité PostgreSQL (RLS) et les fonctions RPC `SECURITY DEFINER`.

---

### 3. Dette de Données & Multi-Tenancy
- **Constat** :
  - L'état de l'application est mono-station : l'interface ne propose aucun sélecteur permettant à un propriétaire possédant 3 stations de basculer de l'une à l'autre.
  - L'intégrité référentielle repose sur des conventions de code et non sur des contraintes de base de données (pas de clés étrangères réelles).
  - Le stockage dans `localStorage` est limité en volume (~5 Mo) et vulnérable à l'effacement par le navigateur.
- **Impact** : Impossibilité de passage à l'échelle pour des chaînes de stations ou des gestionnaires multisites.
- **Plan de remédiation (Prompt 03)** : Modèle de données PostgreSQL relationnel avec contraintes `FOREIGN KEY`, indexation B-Tree, partitions RLS par `company_id` et sélecteur de station active dans le layout principal.

---

### 4. Dette UX / UI & Cohérence Visuelle
- **Constat** :
  - Bien que le thème actuel soit fonctionnel, il existe un mélange de classes utilitaires Tailwind et de styles personnalisés dans `index.css` (`.wg-card`, `.wg-input`, `.wg-btn`).
  - Absence de composants avancés nécessaires pour un ERP : tables avec tri multi-colonnes, pagination, tiroirs latéraux (drawers) pour l'inspection rapide d'un véhicule, confirmations de suppression à deux étapes.
  - Saisie des prestations dans les fiches de lavage optimisée pour un petit nombre d'éléments, mais peu adaptée à un catalogue de plus de 25 prestations.
- **Impact** : Fatigue visuelle et ralentissement des opérateurs en caisse aux heures de pointe.
- **Plan de remédiation (Prompt 02)** : Standardisation d'un Design System ERP moderne, sobre et responsive inspiré des standards SaaS (Stripe, Linear), avec composants UI réutilisables, raccourcis clavier et fluidité tactile.

---

### 5. Dette de Couverture de Tests (Test Debt)
- **Constat** :
  - Le repository ne comporte aucun fichier de test unitaire (`*.test.ts`) ni d'intégration.
  - Seule la compilation TypeScript (`tsc -b --noEmit`) valide actuellement la correction statique du code.
- **Impact** : Risque de rupture silencieuse des calculs financiers critiques (écarts de caisse, commissions, marges) lors d'un refactoring.
- **Plan de remédiation** : Introduction progressive de suites de tests unitaires sur les moteurs de calcul (`metrics.ts`, `commissions.ts`, `cash.ts`) avec Vitest.

---

### 6. Dette d'Environnement & Dépendances
- **Constat** :
  - Dans `package.json`, React 19 est installé (`^19.0.0`) avec `@types/react: ^19.3.0`.
  - Les scripts originaux omettaient la commande `"lint"`, provoquant un avertissement dans la suite d'outils.
  - La configuration Vite d'origine utilisait le port `5173`, incompatible avec le conteneur AI Studio (port `3000` obligatoire).
- **Correctifs immédiats appliqués au Prompt 01** :
  - Correction de `vite.config.ts` : port fixé à `3000`, écoute sur `0.0.0.0`, `allowedHosts: true`.
  - Ajout du script `"lint": "tsc -b --noEmit"` dans `package.json`.
  - Vérification réussie de `compile_applet` et `lint_applet`.

---

## 2. Matrice d'Impact et Ordre de Priorité

| Dette Technique | Gravité | Effort de Remédiation | Étape de Résolution |
| :--- | :---: | :---: | :---: |
| **Port & Scripts d'environnement** | Critique | Faible | ✅ Résolu au Prompt 01 |
| **Monostore store.tsx non modulaire** | Haute | Moyen | 🔄 Traité aux Prompts 02 & 03 |
| **Authentification & Mots de passe en clair** | Critique | Moyen | 🔄 Traité au Prompt 04 |
| **Absence de multi-stations réel** | Haute | Moyen | 🔄 Traité au Prompt 03 |
| **Absence des modules Stocks & Postes** | Haute | Élevé | 🔄 Traité aux Prompts 05 & 07 |
| **Absence de tests automatisés sur les calculs** | Moyenne | Faible | 🔄 Traité aux Prompts 06 & 10 |
