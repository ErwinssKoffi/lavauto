# WashGuard / Lavauto — Documentation du Schéma de Données PostgreSQL & Sécurité RLS (Prompt 03)

> **Date :** 11 novembre 2026  
> **Auteur :** Architecte Base de Données Senior & Spécialiste PostgreSQL/Supabase  
> **Statut :** Spécification de Référence et Migrations Validées  
> **Cadre :** AI Development Playbook — Évolution du repository `ErwinssKoffi/lavauto`

---

## 1. Principes Directeurs du Modèle Relationnel

Le modèle de données PostgreSQL conçu pour WashGuard répond aux exigences d'un **ERP SaaS industriel** adapté au secteur du lavage automobile en Afrique de l'Ouest (Côte d'Ivoire, zone UEMOA / CEMAC) :

1. **Étanchéité Multi-Tenants Absolue** : Chaque entité commerciale est partitionnée par `company_id`. Les stations secondaires sont indexées par `station_id`.
2. **Immutabilité Comptable & Opérationnelle** :
   - Figeage strict du prix unitaire sur la ligne de lavage (`wash_items.unit_price`).
   - Interdiction de modification des fiches terminées (`prevent_completed_wash_tampering`).
   - Traçabilité sans effacement des dépenses et fiches annulées (`status: 'annulee'`).
   - Clôture de caisse avec calcul automatique et immuable de l'écart (`finalize_cash_session_closing`).
3. **Sécurité au Niveau Ligne (Row Level Security - RLS)** activée sur 100 % des tables applicatives avec fonctions d'accès en `SECURITY DEFINER`.

---

## 2. Dictionnaire des Tables (24+ Entités)

### 2.1 Organisation, Accès & Multi-Tenancy

| Table | Description | Clé Primaire | Clés Étrangères Principales |
| :--- | :--- | :--- | :--- |
| **`companies`** | Entreprises clientes (Tenants SaaS). Raison sociale, ville, devise (FCFA), statut suspension. | `id` (UUID) | — |
| **`stations`** | Stations de lavage rattachées à une entreprise. Horaires, règles de caisse, objectifs de CA. | `id` (UUID) | `company_id -> companies(id)` |
| **`user_profiles`** | Profils utilisateurs rattachés au service d'authentification Supabase (`auth.users`). | `id` (UUID) | `company_id -> companies(id)` |
| **`user_station_assignments`** | Affectation des gérants, caissiers et laveurs aux différentes stations de l'entreprise. | `id` (UUID) | `user_id`, `station_id` |
| **`wash_bays`** | Postes de travail physiques (postes extérieurs, intérieurs, detailing, séchage). | `id` (UUID) | `station_id -> stations(id)` |

---

### 2.2 Exploitation, Véhicules & Lavages

| Table | Description | Clé Primaire | Clés Étrangères Principales |
| :--- | :--- | :--- | :--- |
| **`vehicle_categories`** | Catégories de véhicules (Berline, 4×4/SUV, Moto, Minibus, Pick-up). | `id` (UUID) | `station_id -> stations(id)` |
| **`services`** | Prestations proposées (Extérieur, Intérieur, Complet VIP, Moteur, Sièges). | `id` (UUID) | `station_id -> stations(id)` |
| **`service_prices`** | Matrice des tarifs : prix exact de chaque prestation par catégorie de véhicule. | `id` (UUID) | `service_id`, `category_id` (Unique) |
| **`customers`** | Fiches clients CRM (Nom, téléphone, email, flotte d'entreprise, notes). | `id` (UUID) | `company_id -> companies(id)` |
| **`vehicles`** | Véhicules enregistrés rattachés aux clients et immatriculations. | `id` (UUID) | `company_id`, `customer_id`, `category_id` |
| **`washes`** | Fiches de lavage avec numéro de ticket, total, remise, statut et employé assigné. | `id` (UUID) | `company_id`, `station_id`, `employee_id`, `vehicle_id` |
| **`wash_items`** | Prestations composant la fiche de lavage avec prix unitaire figé à l'enregistrement. | `id` (UUID) | `wash_id -> washes(id)`, `service_id` |
| **`wash_status_history`** | Journal d'audit chronologique de passage d'un statut à un autre. | `id` (UUID) | `wash_id -> washes(id)`, `changed_by` |
| **`wash_quality_checks`** | Checklist de contrôle qualité avant restitution (vitres, jantes, intérieur, tapis). | `id` (UUID) | `wash_id -> washes(id)`, `inspector_id` |

---

### 2.3 Finance, Caisse & Dépenses

| Table | Description | Clé Primaire | Clés Étrangères Principales |
| :--- | :--- | :--- | :--- |
| **`payment_methods`** | Référentiel des modes de règlement (Espèces, Wave, Orange Money, MTN MoMo, Carte). | `code` (VARCHAR) | — |
| **`cash_sessions`** | Sessions de caisse physique : ouverture avec fond, clôture avec comptage et calcul d'écart. | `id` (UUID) | `station_id`, `opened_by`, `closed_by` |
| **`payments`** | Encaissements réalisés sur les fiches de lavage avec liaison caisse espèces si applicable. | `id` (UUID) | `company_id`, `station_id`, `wash_id`, `cash_session_id` |
| **`expense_categories`** | Catégories comptables de charges d'exploitation (Eau, CIE, Carburant, Produits, Loyer). | `id` (UUID) | `company_id -> companies(id)` |
| **`expenses`** | Dépenses d'exploitation décaissées avec motif, justificatif et traçabilité d'annulation. | `id` (UUID) | `company_id`, `station_id`, `cash_session_id` |

---

### 2.4 Ressources Humaines & Commissions

| Table | Description | Clé Primaire | Clés Étrangères Principales |
| :--- | :--- | :--- | :--- |
| **`commission_periods`** | Périodes de calcul des commissions laveurs (semaine, quinzaine, mois). | `id` (UUID) | `station_id -> stations(id)` |
| **`commission_payouts`** | Montant figé dû à chaque laveur (base lavages terminés × taux station ou exception). | `id` (UUID) | `period_id`, `employee_id` |
| **`attendance_records`** | Feuilles d'émargement et pointage du personnel de la station. | `id` (UUID) | `station_id`, `employee_id` |

---

### 2.5 Stocks & Approvisionnements

| Table | Description | Clé Primaire | Clés Étrangères Principales |
| :--- | :--- | :--- | :--- |
| **`product_categories`** | Familles de consommables (Shampooings, Cires, Dégraissants, Accessoires). | `id` (UUID) | `company_id -> companies(id)` |
| **`suppliers`** | Fournisseurs de produits de lavage et matériel. | `id` (UUID) | `company_id -> companies(id)` |
| **`products`** | Références de stock avec unité (litre, ml, pièce), coût unitaire et seuil d'alerte. | `id` (UUID) | `station_id`, `supplier_id`, `category_id` |
| **`service_recipes`** | Consommation théorique paramétrée de produits consommables par prestation. | `id` (UUID) | `service_id`, `category_id`, `product_id` |
| **`purchase_orders`** | Bons de commande d'approvisionnement fournisseur. | `id` (UUID) | `station_id`, `supplier_id`, `created_by` |
| **`purchase_order_items`**| Lignes de commande avec quantités commandées et reçues. | `id` (UUID) | `purchase_order_id`, `product_id` |
| **`stock_movements`** | Mouvements physiques de stock (réceptions, consommations, pertes, ajustements). | `id` (UUID) | `station_id`, `product_id` |

---

### 2.6 Plateforme SaaS & Audit

| Table | Description | Clé Primaire | Clés Étrangères Principales |
| :--- | :--- | :--- | :--- |
| **`plans`** | Tarifs et quotas des formules WashGuard (Essai, Standard, Premium). | `id` (VARCHAR) | — |
| **`subscriptions`** | Formule souscrite par l'entreprise avec échéances et statut. | `id` (UUID) | `company_id`, `plan_id` |
| **`audit_logs`** | Journal d'audit de sécurité des actions critiques (activation, clôtures, annulations). | `id` (UUID) | `company_id`, `station_id`, `actor_id` |

---

## 3. Politiques de Sécurité Row Level Security (RLS)

L'accès aux données est filtré à la source par PostgreSQL à travers les fonctions `SECURITY DEFINER` :

```sql
-- Règle d'or : chaque utilisateur n'accède qu'aux données de son entreprise
CREATE POLICY "washes_tenant_isolation" ON washes
    FOR ALL
    USING (company_id = get_auth_company_id() OR is_support_admin())
    WITH CHECK (company_id = get_auth_company_id() OR is_support_admin());
```

Les gérants et caissiers sont en outre restreints à leurs stations assignées grâce au prédicat :
`user_has_station_access(station_id)`.

---

## 4. Déclencheurs & Invariants Métier (Triggers)

1. **Synchronisation automatique des encaissements (`trg_payments_sync_wash`)** :
   À chaque ajout ou modification de paiement, le champ `washes.paid` est recalculé immédiatement. Si le total est atteint et que la fiche était en attente, son statut bascule automatiquement à `'en_cours'`.
2. **Garde-fou d'immutabilité des prestations (`trg_wash_items_immutability`)** :
   Toute tentative de modification ou de suppression d'une ligne de prestation sur un lavage ayant atteint le statut `'termine'` ou `'livre'` est immédiatement rejetée par la base de données (`RAISE EXCEPTION`).
3. **Contrôle strict de caisse ouverte pour espèces (`trg_payments_cash_rule`)** :
   Si la station exige une caisse ouverte (`cash_requires_open = true`), aucun paiement en espèces ne peut être inséré sans session ouverte active.
4. **Mise à jour en temps réel des stocks (`trg_stock_movements_apply`)** :
   Chaque mouvement dans `stock_movements` incrémente ou décrémente automatiquement le stock actuel dans `products.current_stock`.
5. **Calcul officiel de clôture de caisse (`trg_cash_sessions_finalize`)** :
   Lors de la clôture d'une session, le solde théorique et l'écart physique sont calculés automatiquement côté serveur et scellés dans l'enregistrement.
