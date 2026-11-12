# LAVAUTO — Guide utilisateur

**Date :** 12/11/2026 · **Statut :** P10 livré · **19 écrans `/app`**.

## 1. Deux modes

| Mode | Usage | Données |
| --- | --- | --- |
| `local` | Démonstration, formation, recette UI sans service Supabase. | État métier dans `localStorage`, session en mémoire ; le PDF charge la police depuis le déploiement de l’application. |
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
| `/app/qualite` | QA, Storage, CI/CD, 22 parcours locaux | `reports.view` |
| `/app/parametres` | Station, horaires, règles | `settings.manage` |
| `/app/abonnement` | Formule, quotas serveur | `subscription.manage` |
| `/app/plateforme` | Back-office super admin | `platform.view` |

L’ancienne entrée désactivée « Prévisions & alertes » n’est pas un module livré : P10 l’a remplacée par l’écran réel « Qualité & déploiement ». Elle ne fournit pas de module de prévision ou d’alerte additionnel.

## 3. Écran « Qualité & déploiement »

- **État du socle** : migrations, tables, vues, permissions, index, RPC, bucket, policies, idempotence.
- **Pagination serveur** : `my_washes_page()` avec 5 lignes par page, total réel et boutons précédent / suivant ; 100 lignes maximum par appel.
- **Diagnostic de stockage** : envoi d’un PNG/JPEG/WebP ≤ 5 Mo dans le bucket privé et génération d’une URL signée. Cet essai ne modifie pas le logo de la station.
- **22 parcours E2E locaux** et liens vers les 7 documents de déploiement ; d’autres parcours utilisent un backend Supabase simulé.

En mode `local`, les compteurs serveur et l’envoi Storage sont remplacés par un message explicite ; aucun chiffre n’est simulé.

## 4. Ajouter ou remplacer le logo de la station

`051` est appliquée sur `lavauto` ; la recette réelle et le déploiement du frontend de cette branche restent à effectuer.

1. Après validation de la migration `051` et du frontend sur la cible autorisée, connectez-vous avec la permission `settings.manage` et ouvrez **Paramètres → Identité de la station** (ou l’étape facultative dans Mise en route).
2. Choisissez un fichier PNG, JPEG ou WebP de 5 Mo maximum, puis cliquez sur **Enregistrer le logo**. Le navigateur l’optimise si possible et conserve sinon l’original.
3. L’aperçu sécurisé apparaît après confirmation. Une nouvelle URL temporaire est générée pour l’affichage ; si l’aperçu échoue, utilisez **Réessayer l’aperçu**. En cas d’échec de l’association, le logo précédent reste affiché : rechargez ou réessayez.
4. **Retirer le logo** dissocie le fichier de la station. Le retrait et le remplacement ne suppriment pas l’ancien fichier du stockage privé.

Le téléversement est indisponible en mode local. Les anciens liens saisis à la main ne sont plus utilisés : téléversez à nouveau le fichier. Les autres champs d’identité de Paramètres restent locaux.

## Reçu client et avis WhatsApp

Dans **Lavages → Détails → Reçu client**, vérifiez les montants, puis imprimez ou téléchargez le PDF. Le reçu est disponible en mode local ; il reflète la fiche chargée et n’est pas une facture fiscale. Après un changement ou un avertissement de cohérence, actualisez et vérifiez la fiche avant d’émettre un nouveau reçu.

Après déploiement autorisé et configuration complète, un avis WhatsApp peut être mis en attente au passage à **Prêt / terminé**, puis demandé manuellement si nécessaire. Le client doit d’abord avoir donné son accord explicite dans sa fiche, pour son numéro international. Dans le détail du lavage, consultez et actualisez le journal : **accepté par Meta ne veut pas dire livré**. Un résultat incertain ne doit pas être renvoyé sans vérification. Le retrait d’accord annule les demandes encore en attente, mais pas une transmission déjà commencée. La file CRM historique reste distincte et non expédiée.

**À ce jour, la migration `053`, les fonctions Meta, le webhook et l’ordonnanceur ne sont pas déployés ; aucun message réel n’a été envoyé.** Étapes et limites : [whatsapp-receipts.md](whatsapp-receipts.md).

## 5. Règles métier à retenir

- `partialBalance = encaissé − dépenses` est un **solde partiel**, pas un bénéfice net.
- Le résultat net n’est publié qu’après attestation des coûts de période.
- Les lavages déjà enregistrés ne sont jamais recalculés quand un tarif change.
- Après déploiement et recette de `052`, en mode connecté, la fiche et son éventuel paiement initial sont enregistrés dans une seule transaction. Si la réponse est incertaine, ne ressaisissez pas l’opération : dans **Lavages**, utilisez **Vérifier la création** puis **Vérifier / réessayer la même opération** avec le même compte, la même station et le même onglet. La tentative est conservée dans cet onglet même après rechargement. Si le stockage a été effacé, est illisible ou qu’une ancienne clé entre en collision, vérifiez les fiches et les paiements avec un administrateur avant toute nouvelle saisie. Un refus après une incertitude ne prouve pas que la première tentative a échoué. Les anciens clients restent non atomiques.
- Pour un paiement ultérieur depuis le détail d’une fiche, cette branche conserve également la tentative dans le même onglet jusqu’à sa confirmation par relecture. Après une réponse incertaine, vérifiez les paiements et reprenez la même opération ; ne changez ni d’onglet ni de compte. La liste connectée ne contient que les 200 dernières fiches, ce qui peut empêcher la confirmation d’une fiche plus ancienne. Ces changements ne sont pas encore déployés.
- En mode connecté, le rapprochement affiche d’abord une estimation sur les fiches chargées (200 maximum). Saisissez le comptage réel en FCFA entiers ; après validation, l’attendu et l’écart proviennent du relevé serveur figé. Les canaux Wave, Orange Money et MTN restent distincts après application de `052` ; aucun rapprochement automatique auprès des opérateurs n’est effectué.
- Les règles de caisse, le plafond de remise caissier et les barèmes modifiés dans Paramètres restent locaux. La base connectée exige une caisse ouverte pour les espèces, mais ne contrôle pas ce plafond de remise ; les réglages locaux ne configurent pas ses relevés de commission. La formule d’abonnement courante et les notes de changement sont locales, non confirmées ni envoyées au serveur.
- Une dépense est annulée, jamais supprimée.
- En démonstration entièrement locale, Paramètres et le bandeau de stock proposent des raccourcis explicitement simulés ; les quantités et les seuils modifiés restent dans le navigateur. Si aucun produit n’existe, des exemples sont créés dans ce mode seulement.
- En mode connecté ou mixte, ces raccourcis disparaissent et les seuils de Paramètres sont en lecture seule. La modification du seuil d’un produit existant n’est pas encore proposée dans l’interface connectée. Pour les mouvements, utiliser les réceptions, consommations et inventaires des modules dédiés. Si la configuration est mixte ou le port serveur indisponible, les écritures stock sont refusées.
- Les anciennes données de stock en cache ne sont pas supprimées automatiquement ; après un changement de mode ou en cas d’erreur de lecture serveur, ne pas les considérer comme confirmées avant une actualisation réussie.
- Les quotas sont lus côté serveur ; le navigateur n’envoie aucune limite.
- Les tarifs affichés en mode connecté sont lus dans les formules disponibles ; si cette lecture échoue, aucun prix local n’est présenté à leur place. Les prix du mode local sont des hypothèses de démonstration.

Voir [installation.md](installation.md), [security.md](security.md) et [analytics.md](analytics.md).
