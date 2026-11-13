# LAVAUTO — Guide utilisateur

**Date :** 12/11/2026 · P10 historique : **19 écrans `/app`**. Cette branche prépare de nouvelles fonctions, dont les abonnements, mais son frontend et les migrations `053`–`057` ne sont pas déployés sur `lavauto`. La recette réelle et toute mise en service nécessitent une autorisation distincte.

## 1. Deux modes

| Mode | Usage | Données |
| --- | --- | --- |
| `local` | Démonstration et recette UI sans service Supabase ; ne pas saisir de données réelles. | État métier dans `localStorage`, session en mémoire ; le PDF charge la police depuis le déploiement de l’application. |
| `supabase` | Mode connecté préparé dans le code, sous réserve de migrations et recette autorisées. | Supabase Auth, RLS, RPC, Storage, audits côté serveur. |

Le mode est choisi par `VITE_DATA_SOURCE` ; toute autre valeur est refusée au démarrage. En démonstration, les changements affichés peuvent attendre leur sauvegarde : ne rechargez ni ne fermez tant que « Enregistrement local en cours » est visible. Un avertissement de fermeture est demandé en cas de changements non sauvegardés, sans garantie que le navigateur l’affiche.

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

Le téléversement est indisponible en mode local. Les anciens liens saisis à la main ne sont plus utilisés : téléversez à nouveau le fichier. La migration locale `056` prépare également la sauvegarde serveur des autres champs de station et du catalogue ; elle n’est pas déployée.

## Abonnement et accès

L’essai donne accès à tous les modules pendant 14 jours. Le propriétaire peut demander Standard ou Premium depuis **Abonnement** ; seule une validation de la plateforme active la formule. **Si elle intervient avant la fin des 14 jours, l’activation est immédiate et l’essai s’arrête.** Aucun paiement automatique n’est effectué. Après expiration, les données incluses dans la dernière formule restent consultables, mais les écritures ordinaires sont bloquées jusqu’à validation d’une nouvelle période ; le retrait WhatsApp décrit ci-dessous reste possible sous réserve des droits. En mode démonstration, le choix est seulement noté dans le navigateur. Si les quotas ne peuvent pas être relus, ils sont indiqués comme indisponibles plutôt que présentés comme un relevé actuel. Détails : [subscriptions.md](subscriptions.md).

## Employés et invitations — parcours préparé localement

Après déploiement et recette autorisés, **Inviter un employé** demande le rôle et les stations autorisées ; un lien Auth permet à l’employé de définir son propre mot de passe. Si l’invitation n’est pas confirmée, un compte ou un e-mail peut déjà exister : notez l’adresse, ne renvoyez pas et contactez le support. L’avertissement bloque les actions sur les comptes pendant la navigation, mais disparaît au rechargement ou à la déconnexion ; ne poursuivez pas sans vérification, même s’il n’est plus affiché.

Si la modification d’un compte n’est pas confirmée, elle peut déjà avoir été enregistrée. Notez l’identifiant affiché et les changements demandés, ne répétez pas l’action et contactez le support. L’avertissement bloque les actions sur les comptes pendant la navigation mais disparaît au rechargement ou à la déconnexion ; il ne s’affiche pas si le rechargement a lieu pendant la requête. Une simple relecture ne prouve pas qu’une requête encore en cours ne sera pas appliquée plus tard.

Pour une invitation en attente, **Révoquer** demande confirmation et désactive également le compte lié. Cette action exige les permissions d’invitation et de désactivation. Elle ne supprime pas le compte, le lien ni les sessions Auth ; réactiver le compte peut lui redonner accès. Les anciennes invitations sans liaison fiable demandent une vérification par le support. Après expiration de l’abonnement, la révocation est bloquée : contactez le support si l’accès doit être traité.

En cas de réponse de révocation incertaine, ne recommencez pas une autre opération sur les comptes. Dans le même onglet et avec le même compte, utilisez **Reprendre la même révocation** ; un refus lors du nouvel essai ne prouve pas que le premier a échoué. Le rappel survit au rechargement et à la reconnexion du même compte dans cet onglet, mais pas nécessairement à sa fermeture, à l’effacement du stockage ou à un changement d’appareil : notez l’identifiant affiché et contactez le support si nécessaire. Si le stockage est indisponible ou illisible, ne le supprimez pas avant vérification. Si l’opération a été enregistrée mais que les données n’ont pas pu être relues, utilisez **Actualiser les comptes et invitations** avant toute autre action.

En démonstration, aucun e-mail ni compte Auth réel n’est créé et les invitations restent seulement en mémoire. Attendez la confirmation de sauvegarde locale avant de fermer ou recharger. Le réglage individuel de commission dans la liste des employés est réservé à cette démonstration ; il n’est pas disponible ici en mode connecté. Les relevés connectés utilisent les contrats et le barème station côté serveur.

## Reçu client et avis WhatsApp

Dans **Lavages → Détails → Reçu client**, vérifiez les montants, puis imprimez ou téléchargez le PDF. Le reçu est disponible en mode local ; il reflète la fiche chargée et n’est pas une facture fiscale. Après un changement ou un avertissement de cohérence, actualisez et vérifiez la fiche avant d’émettre un nouveau reçu.

Après déploiement autorisé et configuration complète, un avis WhatsApp peut être mis en attente au passage à **Prêt / terminé**, puis demandé manuellement si nécessaire. Le client doit d’abord avoir donné son accord explicite dans sa fiche, pour son numéro international. Dans le détail du lavage, consultez et actualisez le journal : **accepté par Meta ne veut pas dire livré**. Un résultat incertain ne doit pas être renvoyé sans vérification. Après expiration, un utilisateur autorisé peut enregistrer dans la fiche client le retrait avec sa preuve. Cela annule les demandes non encore réclamées, mais un envoi déjà réclamé peut encore atteindre Meta. Si le retrait est refusé ou non confirmé, contactez le support avant toute reprise des envois ; une relecture ne prouve pas qu’une requête encore en vol est terminée. La file CRM historique reste distincte et non expédiée.

**À ce jour, la migration `053`, les fonctions Meta, le webhook et l’ordonnanceur ne sont pas déployés ; aucun message réel n’a été envoyé.** Étapes et limites : [whatsapp-receipts.md](whatsapp-receipts.md).

## 5. Règles métier à retenir

- `partialBalance = encaissé − dépenses` est un **solde partiel**, pas un bénéfice net.
- Le résultat net n’est publié qu’après attestation des coûts de période.
- Les lavages déjà enregistrés ne sont jamais recalculés quand un tarif change.
- Après déploiement et recette de `052`, en mode connecté, la fiche et son éventuel paiement initial sont enregistrés dans une seule transaction. Si la réponse est incertaine, ne ressaisissez pas l’opération : dans **Lavages**, utilisez **Vérifier la création** puis **Vérifier / réessayer la même opération** avec le même compte, la même station et le même onglet. La tentative est conservée dans cet onglet même après rechargement. Si le stockage a été effacé, est illisible ou qu’une ancienne clé entre en collision, vérifiez les fiches et les paiements avec un administrateur avant toute nouvelle saisie. Un refus après une incertitude ne prouve pas que la première tentative a échoué. Les anciens clients restent non atomiques.
- Pour un paiement ultérieur depuis le détail d’une fiche, cette branche conserve également la tentative dans le même onglet jusqu’à sa confirmation par relecture. Après une réponse incertaine, vérifiez les paiements et reprenez la même opération ; ne changez ni d’onglet ni de compte. La liste connectée ne contient que les 200 dernières fiches, ce qui peut empêcher la confirmation d’une fiche plus ancienne. Ces changements ne sont pas encore déployés en production.
- En mode connecté, le rapprochement affiche d’abord une estimation sur les fiches chargées (200 maximum). Saisissez le comptage réel en FCFA entiers ; après validation, l’attendu et l’écart proviennent du relevé serveur figé. Les canaux Wave, Orange Money et MTN restent distincts après application de `052` ; aucun rapprochement automatique auprès des opérateurs n’est effectué.
- Les règles de caisse et le plafond de remise caissier sont verrouillés en mode connecté, car la base ne garantit pas ces réglages. La migration locale `056` prépare le barème et les autres réglages station côté serveur. La formule courante et les demandes d’abonnement sont lues et transmises au serveur connecté après application autorisée de `057` ; leur validation est manuelle, sans paiement automatique.
- Une dépense est annulée, jamais supprimée.
- En démonstration entièrement locale, Paramètres et le bandeau de stock proposent des raccourcis explicitement simulés ; les quantités et les seuils modifiés restent dans le navigateur. Si aucun produit n’existe, des exemples sont créés dans ce mode seulement.
- En mode connecté ou mixte, ces raccourcis disparaissent et les seuils de Paramètres sont en lecture seule. La modification du seuil d’un produit existant n’est pas encore proposée dans l’interface connectée. Pour les mouvements, utiliser les réceptions, consommations et inventaires des modules dédiés. Si la configuration est mixte ou le port serveur indisponible, les écritures stock sont refusées.
- Les anciennes données de stock en cache ne sont pas supprimées automatiquement ; après un changement de mode ou en cas d’erreur de lecture serveur, ne pas les considérer comme confirmées avant une actualisation réussie.
- Les quotas sont lus côté serveur ; le navigateur n’envoie aucune limite.
- Les tarifs affichés en mode connecté sont lus dans les formules disponibles ; si cette lecture échoue, aucun prix local n’est présenté à leur place. Les prix du mode local sont des hypothèses de démonstration.

Voir [installation.md](installation.md), [security.md](security.md) et [analytics.md](analytics.md).
