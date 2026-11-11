# WashGuard / Lavauto — Architecture Cible SaaS ERP Multi-Entreprises (Prompt 01)

> **Date :** 11 novembre 2026  
> **Auteur :** Architecte Logiciel Senior ERP SaaS  
> **Statut :** Spécification Technique de Référence  
> **Cadre :** AI Development Playbook — Évolution du repository `ErwinssKoffi/lavauto`

---

## 1. Vision et Principes Directeurs

L'architecture cible transforme WashGuard d'une application mono-station stockée en mémoire navigateur en un **ERP SaaS multi-entreprises, multi-stations et multi-rôles**, haute disponibilité, déployable en Côte d'Ivoire et extensible à la zone UEMOA / CEMAC.

### Principes Fondamentaux :
1. **Multi-Tenancy Strict (Isolation par Entreprise)** : Une entreprise (`company_id`) possède une ou plusieurs stations de lavage (`station_id`). Aucune donnée ne peut fuiter d'une entreprise à une autre au niveau base de données grâce aux politiques PostgreSQL RLS (Row Level Security).
2. **Double Pilote de Données (Dual Driver)** : L'application conserve un adaptateur local hors-ligne / démo pour permettre le développement et les tests immédiats, tout en connectant de manière transparente le client Supabase dès que les variables d'environnement sont injectées.
3. **Immutabilité des Écritures Sensibles** :
   - Figeage du prix unitaire des prestations à la création du ticket.
   - Enregistrement chronologique sans suppression des transactions financières (paiements, clôtures de caisse, réouvertures motivées, annulations de dépenses).
   - Traçabilité complète des mouvements de stock et des consommations théoriques/réelles.
4. **Séparation des Responsabilités (Clean Architecture)** :
   - Présentation : Composants UI réutilisables, formulaires, tables, modales et graphiques.
   - Domaine & Métier : Entités, règles de calcul (commissions, marges, stock, TVA/taxes).
   - Services : Communication réseau, requêtes Supabase, transactions SQL.
   - État applicatif : Hooks TanStack Query ou Contexts modulaires spécialisés par domaine.

---

## 2. Structure Modulaire des Dossiers Cible

Pour éviter le monolythe de `store.tsx` (747 lignes) sans fragmenter artificiellement le projet, l'arborescence est organisée par domaines métier (« feature modules ») :

```
src/
├── app/
│   ├── router/                   # Définition des routes publiques, protégées et admin
│   ├── providers/                # AuthProvider, TenantProvider, QueryProvider, ToastProvider
│   └── layouts/                  # AppShell, AuthLayout, PlatformLayout
├── components/
│   ├── ui/                       # Composants atomiques (Button, Card, Badge, Modal, Drawer, Table...)
│   ├── forms/                    # FormField, Select, MoneyInput, DatePicker, Toggle
│   ├── feedback/                 # Toast, ConfirmDialog, SkeletonLoader, EmptyState
│   └── charts/                   # Graphiques de chiffre d'affaires, rentabilité et performance
├── modules/
│   ├── dashboard/                # KPIs en temps réel, alertes, activités récentes
│   ├── stations/                 # Gestion multi-stations, configuration horaires, postes
│   ├── washes/                   # Workflow complet : file d'attente, postes, fiches, statut, contrôle qualité
│   ├── services/                 # Prestations, catégories véhicules, grille tarifaire matricielle
│   ├── customers/                # CRM, véhicules, fidélité (points/cartes), flottes entreprises
│   ├── employees/                # Gestion des équipes, rôles, présences, pointage
│   ├── cash/                     # Caisse physique : ouverture, clôture comptée, rapprochement Mobile Money
│   ├── expenses/                 # Gestion des charges d'exploitation, justificatifs, catégories
│   ├── commissions/              # Moteur de calcul des commissions laveurs, périodes et règlements
│   ├── inventory/                # Consommables (shampooing, cire), alertes seuil bas, inventaires physiques
│   ├── suppliers/                # Fournisseurs de produits, contacts, conditions
│   ├── purchases/                # Commandes d'approvisionnement et réceptions en stock
│   ├── finance/                  # Rentabilité globale, compte de résultat simplifié, marge brute
│   ├── reports/                  # Rapports d'exploitation, exports Excel/CSV, synthèses périodiques
│   └── settings/                 # Paramètres entreprise, règles de caisse, monnaie, seuils
├── services/
│   ├── supabase/                 # Client typé, requêtes SQL/RPCs, gestion des sessions
│   ├── storage/                  # Stockage de justificatifs et logos via Supabase Storage
│   └── local/                    # Adaptateur de compatibilité démo locale (fallback)
├── hooks/                        # useAuth, useTenant, usePermissions, useDebounce, useNetwork
├── types/                        # Interfaces TypeScript strictes du domaine et de la base
├── schemas/                      # Schémas de validation Zod pour formulaires et APIs
└── utils/                        # Formatage monnaie FCFA, fuseaux horaires, calculs arithmétiques
```

---

## 3. Schéma Relationnel PostgreSQL / Supabase Cible

### 3.1 Entités d'Organisation & Sécurité
- **`companies`** :
  - `id` (UUID, PK), `name` (TEXT), `legal_id` (TEXT), `city` (TEXT), `country` (TEXT default 'CI'), `currency` (TEXT default 'FCFA'), `phone` (TEXT), `suspended` (BOOLEAN), `created_at` (TIMESTAMPTZ).
- **`stations`** :
  - `id` (UUID, PK), `company_id` (UUID, FK -> companies.id), `name` (TEXT), `address` (TEXT), `city` (TEXT), `phone` (TEXT), `cash_requires_open` (BOOLEAN default true), `max_cashier_discount` (NUMERIC), `default_commission_rate` (NUMERIC), `monthly_target` (NUMERIC), `activated` (BOOLEAN), `activated_at` (TIMESTAMPTZ).
- **`user_profiles`** :
  - `id` (UUID, PK, matches `auth.users.id`), `company_id` (UUID, FK -> companies.id), `email` (TEXT UNIQUE), `name` (TEXT), `phone` (TEXT), `role` (TEXT: 'proprietaire' | 'gerant' | 'caissier' | 'laveur' | 'support'), `active` (BOOLEAN), `created_at` (TIMESTAMPTZ).
- **`user_station_assignments`** :
  - `id` (UUID, PK), `user_id` (UUID, FK -> user_profiles.id), `station_id` (UUID, FK -> stations.id), `is_primary` (BOOLEAN).

### 3.2 Exploitation & Lavages
- **`vehicle_categories`** :
  - `id` (UUID, PK), `company_id` (UUID), `station_id` (UUID), `name` (TEXT), `display_order` (INT), `active` (BOOLEAN).
- **`services`** :
  - `id` (UUID, PK), `company_id` (UUID), `station_id` (UUID), `name` (TEXT), `description` (TEXT), `estimated_duration_min` (INT), `active` (BOOLEAN).
- **`service_prices`** :
  - `id` (UUID, PK), `service_id` (UUID, FK), `category_id` (UUID, FK), `price` (NUMERIC), UNIQUE(service_id, category_id).
- **`wash_bays` (Postes de travail)** :
  - `id` (UUID, PK), `station_id` (UUID), `name` (TEXT: 'Extérieur 1', 'Intérieur', 'Detailing'), `type` (TEXT), `status` (TEXT: 'libre' | 'occupe' | 'maintenance').
- **`customers`** :
  - `id` (UUID, PK), `company_id` (UUID), `name` (TEXT), `phone` (TEXT), `email` (TEXT), `notes` (TEXT), `is_fleet` (BOOLEAN).
- **`vehicles`** :
  - `id` (UUID, PK), `customer_id` (UUID, FK), `plate` (TEXT UNIQUE), `category_id` (UUID, FK), `brand` (TEXT), `model` (TEXT), `color` (TEXT).
- **`washes`** :
  - `id` (UUID, PK), `company_id` (UUID), `station_id` (UUID), `number` (TEXT), `vehicle_id` (UUID, FK), `customer_id` (UUID, FK), `category_id` (UUID, FK), `bay_id` (UUID, FK), `employee_id` (UUID, FK), `discount` (NUMERIC), `total_amount` (NUMERIC), `paid_amount` (NUMERIC), `status` (TEXT: 'en_attente' | 'assigne' | 'en_cours' | 'controle_qualite' | 'pret' | 'livre' | 'annule'), `created_at` (TIMESTAMPTZ), `started_at` (TIMESTAMPTZ), `finished_at` (TIMESTAMPTZ), `delivered_at` (TIMESTAMPTZ), `cancel_reason` (TEXT).
- **`wash_items`** :
  - `id` (UUID, PK), `wash_id` (UUID, FK), `service_id` (UUID, FK), `service_name` (TEXT), `unit_price` (NUMERIC), `quantity` (INT).
- **`wash_quality_checks`** :
  - `id` (UUID, PK), `wash_id` (UUID, FK), `inspector_id` (UUID, FK), `exterior_clean` (BOOLEAN), `interior_clean` (BOOLEAN), `windows_clean` (BOOLEAN), `rims_clean` (BOOLEAN), `mats_clean` (BOOLEAN), `approved` (BOOLEAN), `notes` (TEXT), `inspected_at` (TIMESTAMPTZ).

### 3.3 Finance & Caisse
- **`cash_sessions`** :
  - `id` (UUID, PK), `station_id` (UUID), `opened_by` (UUID, FK), `opened_at` (TIMESTAMPTZ), `opening_float` (NUMERIC), `closed_at` (TIMESTAMPTZ), `closed_by` (UUID, FK), `counted_amount` (NUMERIC), `theoretical_amount` (NUMERIC), `difference_amount` (NUMERIC), `status` (TEXT: 'ouverte' | 'cloturee'), `reopened_at` (TIMESTAMPTZ), `reopen_reason` (TEXT).
- **`payments`** :
  - `id` (UUID, PK), `company_id` (UUID), `station_id` (UUID), `wash_id` (UUID, FK), `cash_session_id` (UUID, FK nullable), `amount` (NUMERIC), `method` (TEXT: 'especes' | 'orange_money' | 'wave' | 'mtn_momo' | 'carte' | 'virement'), `transaction_reference` (TEXT), `collected_by` (UUID, FK), `created_at` (TIMESTAMPTZ).
- **`expenses`** :
  - `id` (UUID, PK), `company_id` (UUID), `station_id` (UUID), `cash_session_id` (UUID, FK nullable), `category` (TEXT), `reason` (TEXT), `supplier` (TEXT), `amount` (NUMERIC), `method` (TEXT), `date` (DATE), `receipt_url` (TEXT), `status` (TEXT: 'enregistree' | 'annulee'), `cancel_reason` (TEXT), `created_by` (UUID, FK), `created_at` (TIMESTAMPTZ).

### 3.4 Stocks, Consommables & Approvisionnements
- **`product_categories`** :
  - `id` (UUID, PK), `company_id` (UUID), `name` (TEXT).
- **`products`** :
  - `id` (UUID, PK), `company_id` (UUID), `station_id` (UUID), `name` (TEXT), `sku` (TEXT), `category_id` (UUID, FK), `unit` (TEXT: 'ml', 'litre', 'unite', 'kg'), `unit_cost` (NUMERIC), `current_stock` (NUMERIC), `alert_threshold` (NUMERIC), `active` (BOOLEAN).
- **`service_recipes` (Consommations théoriques)** :
  - `id` (UUID, PK), `service_id` (UUID, FK), `category_id` (UUID, FK), `product_id` (UUID, FK), `quantity_used` (NUMERIC).
- **`suppliers`** :
  - `id` (UUID, PK), `company_id` (UUID), `name` (TEXT), `contact_name` (TEXT), `phone` (TEXT), `email` (TEXT), `address` (TEXT).
- **`purchase_orders`** :
  - `id` (UUID, PK), `station_id` (UUID), `supplier_id` (UUID, FK), `order_number` (TEXT), `total_amount` (NUMERIC), `status` (TEXT: 'brouillon' | 'commandee' | 'recue_partielle' | 'recue_totale' | 'annulee'), `created_at` (TIMESTAMPTZ), `received_at` (TIMESTAMPTZ).
- **`purchase_order_items`** :
  - `id` (UUID, PK), `purchase_order_id` (UUID, FK), `product_id` (UUID, FK), `quantity_ordered` (NUMERIC), `quantity_received` (NUMERIC), `unit_cost` (NUMERIC).
- **`stock_movements`** :
  - `id` (UUID, PK), `product_id` (UUID, FK), `station_id` (UUID), `type` (TEXT: 'reception' | 'consommation_lavage' | 'ajustement_inventaire' | 'perte'), `quantity` (NUMERIC: positif ou négatif), `reference_id` (UUID: id lavage ou commande), `created_at` (TIMESTAMPTZ), `created_by` (UUID, FK).

### 3.5 Ressources Humaines & Commissions
- **`employees`** :
  - `id` (UUID, PK), `user_id` (UUID, FK nullable si compte système non attribué), `station_id` (UUID), `first_name` (TEXT), `last_name` (TEXT), `role` (TEXT), `phone` (TEXT), `base_salary` (NUMERIC default 0), `commission_rate_override` (NUMERIC nullable), `active` (BOOLEAN).
- **`commission_periods`** :
  - `id` (UUID, PK), `station_id` (UUID), `start_date` (DATE), `end_date` (DATE), `status` (TEXT: 'en_cours' | 'validee' | 'payee'), `validated_at` (TIMESTAMPTZ), `validated_by` (UUID, FK).
- **`commission_payouts`** :
  - `id` (UUID, PK), `period_id` (UUID, FK), `employee_id` (UUID, FK), `total_washes` (INT), `revenue_base` (NUMERIC), `commission_rate` (NUMERIC), `total_commission` (NUMERIC), `paid` (BOOLEAN), `paid_at` (TIMESTAMPTZ).

### 3.6 CRM, Fidélisation & Flottes
- **`loyalty_cards`** :
  - `id` (UUID, PK), `customer_id` (UUID, FK), `points_balance` (INT), `total_washes_count` (INT), `tier` (TEXT: 'bronze' | 'argent' | 'or' | 'vip').
- **`fleet_contracts`** :
  - `id` (UUID, PK), `company_id` (UUID), `client_name` (TEXT), `contact_phone` (TEXT), `billing_cycle` (TEXT: 'mensuel' | 'bimensuel'), `discount_percent` (NUMERIC), `active` (BOOLEAN).

### 3.7 SaaS Platform & Audit
- **`plans`** :
  - `id` (TEXT, PK: 'essai', 'standard', 'premium'), `name` (TEXT), `price_monthly` (NUMERIC), `max_stations` (INT), `max_employees` (INT), `max_washes_per_month` (INT), `features` (JSONB).
- **`subscriptions`** :
  - `id` (UUID, PK), `company_id` (UUID, FK), `plan_id` (TEXT, FK), `status` (TEXT: 'essai' | 'active' | 'en_attente' | 'suspendue'), `started_at` (TIMESTAMPTZ), `trial_ends_at` (TIMESTAMPTZ), `current_period_end` (TIMESTAMPTZ).
- **`audit_logs`** :
  - `id` (UUID, PK), `company_id` (UUID), `station_id` (UUID nullable), `actor_id` (UUID), `actor_name` (TEXT), `action` (TEXT), `details` (JSONB), `created_at` (TIMESTAMPTZ).

---

## 4. Politiques RLS (Row Level Security)

Exemple standard de politique d'isolation pour toute table comportant `company_id` :

```sql
ALTER TABLE washes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Isolation multi-entreprises pour les lavages"
ON washes
FOR ALL
USING (
  company_id IN (
    SELECT company_id FROM user_profiles
    WHERE user_profiles.id = auth.uid()
  )
)
WITH CHECK (
  company_id IN (
    SELECT company_id FROM user_profiles
    WHERE user_profiles.id = auth.uid()
  )
);
```

Une fonction de sécurité PostgreSQL `get_current_user_company_id()` en `SECURITY DEFINER` sera déployée au Prompt 03 pour optimiser les performances des index sans exécuter de sous-requêtes répétées.
