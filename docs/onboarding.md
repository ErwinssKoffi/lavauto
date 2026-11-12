# Mise en route — parcours d'ouverture

> Ce document décrit le parcours **tel qu'implémenté dans le frontend**. Depuis le Prompt 04, l'identité, les permissions et le tenant viennent de Supabase Auth / `my_context()` ; les RPC du Prompt 05 couvrent désormais le cycle lavages ; le logo utilise le Storage privé et la migration `051` en mode connecté ; plusieurs autres écritures métier de ce parcours restent locales dans `src/lib/store.tsx`. Le schéma distant applique déjà `company_id`, RLS et les contraintes d'unicité décrites derrière ce contrat.

Ce n'est **pas** un formulaire de bienvenue. C'est un parcours de **treize étapes** dont l'état est **constaté sur les données réellement enregistrées** : aucune étape n'est cochée par le navigateur, aucun bouton ne déclare une étape « faite ». Le badge « Constaté » apparaît uniquement quand les données correspondantes existent.

## Prérequis : l'inscription

Le formulaire d'inscription est groupé en deux temps :

1. **Votre entreprise et sa station** — nom de l'entreprise, nom de la station, téléphone, ville ;
2. **Votre compte de propriétaire** — nom, e-mail, mot de passe, confirmation.

Le contrat crée **une seule fois** l'entreprise, sa station, le compte propriétaire et l'abonnement d'essai, puis ouvre l'écran **Mise en route**. Une seconde soumission ne recrée rien (idempotence). En mode Supabase, `mailer_autoconfirm=false` impose de confirmer l'e-mail avant la première session ; le bootstrap idempotent est déclenché par le trigger `AFTER INSERT ON auth.users`.

À ce stade, la station n'a **ni horaires, ni catégories, ni prestations, ni prix, ni moyens de paiement**. Aucune donnée d'exemple n'est ajoutée et **aucun prix n'est inventé** : la station ouvre quand vous avez choisi vos tarifs.

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

Les libellés proposés à la saisie (« Berline », « Lavage extérieur »…) sont des **raccourcis** : rien n'est inséré sans un clic de l'utilisateur. Les champs de prix démarrent vides ; la grille n'est constatée complète que lorsque toutes les cases sont renseignées.

## Refus : `409 onboarding_incomplete`

Tant que l'activation n'a pas eu lieu, **toute écriture de métier est refusée** :

- création ou modification d'une fiche de lavage ;
- encaissement (total ou partiel) ;
- ouverture, clôture ou réouverture de caisse ;
- enregistrement ou annulation d'une dépense.

La réponse est `409 onboarding_incomplete` et contient la liste des étapes obligatoires manquantes. L'interface affiche ce blocage dans un panneau dédié sur chaque module concerné, avec un lien vers la mise en route.

Le garde est centralisé : `assertActivated()` dans `src/lib/store.tsx`. Il n'est **pas** possible de contourner le blocage depuis un écran, puisque chaque action métier passe par ce garde.

L'activation elle-même refuse (`409 onboarding_incomplete`) si une étape obligatoire manque ; le bouton se débloque automatiquement quand les données sont enregistrées.

L'objectif est simple : **ne pas ouvrir l'exploitation avec des tarifs que vous n'avez pas choisis**.

## Vérifications

Vérifications appliquées à la saisie d'une fiche (voir `createWash` dans `store.tsx`) :

- la catégorie de véhicules doit exister et être active ;
- l'employé doit être renseigné ;
- au moins une prestation active doit être sélectionnée ;
- chaque prestation doit avoir un prix dans la grille pour la catégorie choisie, sinon `missing_price` ;
- la remise ne peut pas dépasser la remise maximale du caissier (`discount_exceeded`) ;
- le montant encaissé ne peut pas dépasser le total (`overpayment`) ;
- un encaissement en espèces exige une caisse ouverte, sauf si la règle a été désactivée pour la station (`cash_closed`). Le Mobile Money peut être enregistré à tout moment ;
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
- L'inscription, l'activation, les réinitialisations de mot de passe, les annulations et les changements de formule écrivent une ligne dans `auditLogs` (journal des opérations sensibles).
- Le frontend conserve l'état dans `localStorage` (`washguard.state.v1`). *Paramètres → Réinitialiser la démonstration* permet de repartir à vide.
