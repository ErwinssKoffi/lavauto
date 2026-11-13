# Vitrine WashGuard `/`

**Date :** 12/11/2026 · Ce document décrit la vitrine présente dans cette branche, conservée dans son design WashGuard sombre. Les exemples de station, de caisse, de stock, de fiche et de commissions sont **fictifs** et identifiés comme tels ; ils ne représentent ni des clients ni des performances réelles. Aucun témoignage inventé n’est affiché.

## Navigation et contenu

| Élément | Destination / comportement |
| --- | --- |
| Logo WashGuard | `/` |
| Fonctionnalités, Caisse & Stock, Tarifs, FAQ | Ancres `#fonctionnalites`, `#caisse-stock`, `#tarifs`, `#faq` |
| Créer mon compte / Créer mon espace / CTA des formules | `/inscription` |
| Connexion / Explorer les modules | `/connexion` |
| Onglets de l’illustration et questions de la FAQ | État local de l’interface, sans écriture ni données réelles |

La page décrit les fiches, la caisse, les canaux, le stock et les relevés sans garantir l’élimination des erreurs ni une synchronisation hors ligne. Les moyens de paiement sont **enregistrés par canal** : il n’existe pas de connexion automatique aux opérateurs. Le plafond de remise du caissier est un contrôle d’interface/local ; la base connectée ne l’impose pas actuellement. Les règles et barèmes modifiés dans Paramètres ne configurent pas le serveur. Le résultat net dépend de l’attestation des coûts.

## Formules et tarifs

En mode local, la vitrine utilise les formules locales de démonstration. En mode Supabase, elle attend les lignes actives, leurs limites et les droits techniques depuis `plans`, `plan_limits` et `plan_entitlements`. Pendant le chargement, aucun prix local n’est affiché ; si la lecture échoue, si la table est vide ou si les données nécessaires sont invalides, un message explicite remplace les tarifs, sans repli fictif. La page Abonnement lit la formule effective sur le serveur et transmet les demandes en mode connecté ; une validation administrateur est nécessaire. L’essai couvre tous les modules pendant 14 jours, mais une validation anticipée l’arrête immédiatement. Aucun paiement automatique n’est effectué. La démo ne transmet ni demande ni paiement. Ces fonctionnalités exigent les migrations locales jusqu’à `057` et ne sont pas déployées sur `lavauto` : voir [subscriptions.md](subscriptions.md).

## Vérifications

`scripts/check.cjs` contrôle le contenu réel de la vitrine, ses CTA et le comportement des tarifs. Les parcours Playwright locaux et avec Supabase simulé couvrent le chargement, l’erreur, la table vide, les limites serveur, les ancres, les exemples et la navigation. Voir [testing.md](testing.md) pour les résultats et limites : aucune de ces simulations ne constitue une recette sur un projet Supabase réel.

## Historique et licence

Une vitrine antérieure s’inspirait du modèle public [ixartz/Next-js-Boilerplate](https://github.com/ixartz/Next-js-Boilerplate), sous licence MIT, Copyright (c) 2026 Remi W. La notice des éléments historiques conservés se trouve dans `public/assets/images/LICENSE.txt`. La page actuelle ne prétend pas reprendre fidèlement ce modèle. La licence générale du dépôt figure dans `LICENSE.md`.
