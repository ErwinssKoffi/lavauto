# LAVAUTO — Guide utilisateur

**Date :** 12/11/2026 · **Statut :** P10 livré · **19 écrans `/app`**.

## 1. Deux modes

| Mode | Usage | Données |
| --- | --- | --- |
| `local` | Démonstration hors ligne, formation, recette UI. | État métier dans `localStorage`, session en mémoire, aucun réseau. |
| `supabase` | Exploitation réelle. | Supabase Auth, RLS, RPC, Storage, audits côté serveur. |

Le mode est choisi par `VITE_DATA_SOURCE` ; toute autre valeur est refusée au démarrage.

## 2. Les 19 écrans

| URL | Écran | Permission |
| --- | --- | --- |
| `/app/tableau-de-bord` | Tableau de bord + tendance Recharts | `washes.view` |
| `/app/mise-en-route` | 13 étapes constatées, 8 obligatoires | `settings.manage` |
| `/app/lavages` | Fiches, 7 statuts, qualité, encaissement | `washes.view` |
| `/app/prestations` | Catalogue et grille tarifaire | `catalog.manage` |
| `/app/clients` | Fiches et historique | `customers.view` |
| `/app/employes` | Comptes, rôles, réinitialisation | `employees.manage` |
| `/app/caisse` | Ouverture, comptage, clôture | `cash.open` |
| `/app/depenses` | Charges, annulation motivée | `expenses.create` |
| `/app/rapports` | Rapports et export CSV | `reports.view` |
| `/app/commissions` | Barèmes et paie | `commissions.view` |
| `/app/stock` | Achats, réceptions, coût moyen | `inventory.view` |
| `/app/consommations` | Normes et valorisation | `inventory.consume` |
| `/app/fidelisation` | Points, forfaits, promotions | `crm.view` |
| `/app/flottes` | Contrats et créances | `fleets.view` |
| `/app/consolidation` | Comparaison, classement par CA | `analytics.view` |
| `/app/qualite` | QA, Storage, CI/CD, 15 parcours | `reports.view` |
| `/app/parametres` | Station, horaires, règles | `settings.manage` |
| `/app/abonnement` | Formule, quotas serveur | `subscription.manage` |
| `/app/plateforme` | Back-office super admin | `platform.view` |

L’ancienne entrée désactivée « Prévisions & alertes » n’est pas un module livré : P10 l’a remplacée par l’écran réel « Qualité & déploiement ». Aucune prévision ni alerte n’est fabriquée.

## 3. Écran « Qualité & déploiement »

- **État du socle** : migrations, tables, vues, permissions, index, RPC, bucket, policies, idempotence.
- **Pagination serveur** : `my_washes_page()` avec 5 lignes par page, total réel et boutons précédent / suivant ; 100 lignes maximum par appel.
- **Stockage du logo** : fichier PNG/JPEG/WebP ≤ 5 Mo, redimensionné à 512 px et recompressé en WebP côté navigateur, chemin serveur, upsert idempotent, URL signée une heure.
- **15 parcours E2E** et liens vers les 7 documents de déploiement.

En mode `local`, les compteurs serveur et l’envoi Storage sont remplacés par un message explicite ; aucun chiffre n’est simulé.

## 4. Règles métier à retenir

- `partialBalance = encaissé − dépenses` est un **solde partiel**, pas un bénéfice net.
- Le résultat net n’est publié qu’après attestation des coûts de période.
- Les lavages déjà enregistrés ne sont jamais recalculés quand un tarif change.
- Une dépense est annulée, jamais supprimée.
- Les quotas sont lus côté serveur ; le navigateur n’envoie aucune limite.
- Les tarifs 0 / 15 000 / 35 000 FCFA restent des **hypothèses commerciales administrables** à valider sur le terrain ivoirien.

Voir [installation.md](installation.md), [security.md](security.md) et [analytics.md](analytics.md).
