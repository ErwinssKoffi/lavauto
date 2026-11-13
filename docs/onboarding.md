# Mise en route — parcours d'ouverture

> Ce document décrit le code de cette branche, **pas une recette de production**. En démonstration les données restent dans le navigateur. En mode connecté, l’identité vient de Supabase Auth / `my_context()` ; `056` prépare la lecture et les écritures autorisées des réglages et du catalogue, et `057` les droits d’abonnement. `053`–`057` ne sont pas appliquées sur `lavauto` ; ne pas activer ce frontend connecté avant réconciliation, recette et autorisation distincte. L’essai de 14 jours s’arrête immédiatement si une formule payante est validée avant son échéance : voir [subscriptions.md](subscriptions.md).

Ce n'est **pas** un formulaire de bienvenue. C'est un parcours de **treize étapes** dont l'état est **constaté sur les données réellement enregistrées** : aucune étape n'est cochée par le navigateur, aucun bouton ne déclare une étape « faite ». Le badge « Constaté » apparaît uniquement quand les données correspondantes existent.

## Prérequis : l'inscription

Le formulaire d'inscription est groupé en deux temps :

1. **Votre entreprise et sa station** — nom de l'entreprise, nom de la station, téléphone, ville ;
2. **Votre compte de propriétaire** — nom, e-mail, mot de passe, confirmation.

En démo, l’inscription crée un espace uniquement dans ce navigateur, refuse de remplacer un espace existant et ne vérifie ni n’envoie d’e-mail. Une perte de stockage empêche la connexion ultérieure. En mode Supabase, la création dépend du bootstrap serveur et de la configuration Auth réelle ; la confirmation par e-mail et la délivrabilité doivent être vérifiées sur une recette autorisée.

À ce stade, la station n'a **ni horaires, ni catégories, ni prestations, ni prix, ni moyens de paiement**. Aucun prix n'est inventé ; des produits de stock d’exemple peuvent être ajoutés en démonstration locale seulement.

## Les treize étapes

| # | Étape | Obligatoire | Constatée sur |
| --- | --- | --- | --- |
| 1 | Identité de l'entreprise | ✅ | `companies.name`, `city`, `phone` non vides |
| 2 | Identité de la station | ✅ | `stations.name`, `address`, `city` non vides |
| 3 | Horaires d'ouverture | ✅ | 7 jours déclarés, au moins un jour ouvert |
| 4 | Catégories de véhicules | ✅ | au moins une catégorie active |
| 5 | Catalogue des prestations | ✅ | au moins une prestation active |
| 6 | Grille tarifaire | ✅ | **chaque** prestation active a un prix > 0 pour **chaque** catégorie active |
| 7 | Moyens de paiement | ✅ | au moins un moyen sélectionné |
| 8 | Comptes employés | facultatif | au moins un compte autre que le propriétaire |
| 9 | Logo de la station | facultatif | chemin d’un objet privé associé à la station |
| 10 | Règles de caisse | facultatif | remise maximale > 0 ou règle « caisse obligatoire » désactivée |
| 11 | Barème des commissions | facultatif | taux > 0 (0 % par défaut, aucune commission calculée) |
| 12 | Objectif du mois | facultatif | objectif > 0 |
| 13 | Activation de la station | ✅ | `stations.activated = true` |

**Huit étapes obligatoires** au total : les sept premières (identité de l'entreprise et de la station, horaires, catégories, catalogue, grille tarifaire, moyens de paiement) plus l'activation.

L’étape logo utilise le même éditeur que **Paramètres** : fichier PNG, JPEG ou WebP de 5 Mo maximum, puis **Enregistrer le logo**. Elle nécessite Supabase et la migration `051` sur la cible ; elle est désactivée en mode local. L’ancienne saisie d’URL ne constitue plus un logo : un nouveau téléversement est nécessaire. Le remplacement et le retrait dissocient l’ancien fichier sans le supprimer.

Les libellés proposés à la saisie (« Berline », « Lavage extérieur »…) sont des **raccourcis** : rien n'est inséré sans un clic de l'utilisateur. Les champs de prix démarrent vides ; valider un prix en quittant la case ou avec Entrée. En mode connecté, l’écran attend la relecture serveur et bloque les réglages en cas d’échec ou de réponse incohérente. En local, une alerte signale une persistance impossible.

## Refus : `409 onboarding_incomplete`

Tant que l'activation n'a pas eu lieu, **toute écriture de métier est refusée** :

- création ou modification d'une fiche de lavage ;
- encaissement (total ou partiel) ;
- ouverture, clôture ou réouverture de caisse ;
- enregistrement ou annulation d'une dépense.

L’interface locale signale `onboarding_incomplete` avec les étapes manquantes. Les refus SQL connectés peuvent avoir un autre code HTTP ; ils doivent être vérifiés sur la cible et ne sont pas démontrés par ce garde d’interface.

Le garde d’interface est `assertActivated()` dans `src/lib/store.tsx`. Il ne remplace pas les contrôles serveur, RLS et permissions, qui doivent être vérifiés indépendamment.

L'activation elle-même refuse (`409 onboarding_incomplete`) si une étape obligatoire manque ; le bouton se débloque automatiquement quand les données sont enregistrées.

L'objectif est simple : **ne pas ouvrir l'exploitation avec des tarifs que vous n'avez pas choisis**.

## Vérifications

Vérifications appliquées à la saisie d'une fiche (voir `createWash` dans `store.tsx`) :

- la catégorie de véhicules doit exister et être active ;
- l'employé doit être renseigné ;
- au moins une prestation active doit être sélectionnée ;
- chaque prestation doit avoir un prix dans la grille pour la catégorie choisie, sinon `missing_price` ;
- le plafond de remise du caissier n’est pas garanti par la base connectée ; le réglage est verrouillé en mode connecté ;
- le montant encaissé ne peut pas dépasser le total (`overpayment`) ;
- en connecté, les espèces exigent une caisse ouverte ; le réglage local ne désactive pas cette règle serveur. Le moyen sélectionné doit aussi être accepté par la station ;
- **les prix sont figés** sur la fiche au moment de sa création : modifier la grille tarifaire ne change jamais les lavages déjà enregistrés, donc l'historique et les rapports restent justes.

Vérifications de caisse et de dépenses :

- une seule caisse ouverte à la fois (`cash_open`) ;
- clôture avec **comptage** et calcul de l'écart théorique / compté ;
- réouverture **motivée**, conservée dans l'historique ;
- annulation d'une dépense **motivée**, jamais supprimée.

## Après l'activation

`stations.activated` passe à `true` avec sa date. Le tableau de bord, les lavages, la caisse, les dépenses, les rapports et les commissions deviennent utilisables. Les étapes facultatives restent accessibles à tout moment depuis Paramètres, Employés ou la Mise en route.

## Notes d'implémentation frontend

- L'état du parcours est recalculé à chaque changement de données (`computeOnboarding(state)`), jamais stocké comme « étape cochée ».
- En démonstration, l’état et les empreintes d’accès sont deux clés locales, sans synchronisation ni chiffrement. Exporter et vérifier une copie avant toute réinitialisation ; celle-ci efface les deux clés uniquement après confirmation.
- Les commandes connectées de `056` vérifient station et permissions, relisent le résultat et enregistrent un audit côté base. Après une réponse perdue, relire et vérifier avant de recommencer une création : ces réglages ne sont pas tous idempotents.
