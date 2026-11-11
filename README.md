# WashGuard — frontend

Application de gestion de station de lavage. **Ce dépôt ne contient, pour l'heure, que le frontend** : React, TypeScript, Tailwind CSS, avec Supabase prêt à être branché.

Toute l'interface est en **français**, les montants en **FCFA** (`12 500 FCFA`), les dates au format **jj/mm/aaaa**. Thème **sombre par défaut**, thème clair disponible (bouton soleil / lune dans l'en-tête).

## Démarrer

```bash
npm install
npm run dev        # ou : make web
npm run build      # ou : make build — vérifie les types puis produit dist/
npm run preview    # sert dist/ sur le port 5173
```

Le serveur de développement écoute sur `0.0.0.0:5173`. En production, servez `dist/` derrière un serveur qui renvoie `index.html` pour toutes les routes (SPA).

L'aperçu de la vitrine est un **composant React rendu en direct** (`AppPreview` dans `src/pages/Landing.tsx`) et non une image retouchée : il ne peut pas se désynchroniser de l'application. La génération automatisée de captures (`make rendu`) n'est pas encore en place — elle viendra avec le branchement backend.

## Ce qui est implémenté

| Écran | Contenu |
| --- | --- |
| `/` — Vitrine | Présentation, aperçus **issus du rendu de l'application**, formules et tarifs lus dans `src/lib/plans.ts` (la table `plans` en attendant Supabase), questions fréquentes. **Aucun témoignage** : des avis inventés seraient pires que pas d'avis du tout. Une personne déjà identifiée est conduite directement à son espace. |
| `/connexion`, `/inscription` | Même mise en page `AuthLayout` : formulaire sur surface claire et centrée, panneau photo à droite (`public/images/lav-auto.jpeg`) avec dégradé sombre, masqué sur téléphone. Inscription groupée en deux temps : *votre entreprise et sa station* (nom de l'entreprise, nom de la station, téléphone, ville), puis *votre compte de propriétaire*. |
| Mise en route | 13 étapes, **8 obligatoires**, dont l'état est **constaté sur les données enregistrées** : aucune case n'est cochée par le navigateur. Voir [docs/onboarding.md](docs/onboarding.md). |
| Tableau de bord | CA du jour, lavages, encaissements, dépenses, état de la caisse, alertes, dernières opérations, objectif du mois. |
| Lavages | Fiche rapide (prestations, véhicule, plaque facultative, employé, remise autorisée, client facultatif), statuts, encaissement total ou partiel, reste à payer, annulation motivée. |
| Prestations | Catalogue propre à la station et grille tarifaire par catégorie de véhicules. **Modifier un tarif ne change jamais les lavages déjà enregistrés.** |
| Clients | Fiche facultative, historique, recherche. Un lavage peut être encaissé sans client. |
| Employés | Comptes, rôles, activation, réinitialisation de mot de passe, exception de barème de commission, activité. |
| Caisse | Ouverture avec fond, clôture avec **comptage** et écart théorique / compté, réouverture motivée, historique. Règle : les espèces exigent une caisse ouverte (désactivable dans Paramètres) ; Mobile Money à tout moment. |
| Dépenses | Montant, catégorie, motif, fournisseur, date, moyen de paiement, rattachement à la caisse ouverte, annulation motivée (**jamais de suppression**). |
| Rapports | Jour / semaine / mois, meilleures prestations, activité par employé, répartition par moyen de paiement, historique de caisse, meilleurs clients, **export CSV**. |
| Commissions | Lavages **terminés** de la période, barème de la station ou exception par compte, montant dû, **export CSV pour la paie**. Réservé au propriétaire et au gérant. |
| Paramètres | Station, horaires, devise FCFA, logo, règles de caisse, remise maximale du caissier, barème, objectif, entreprise, journal des opérations sensibles. |
| Abonnement | Formule en cours, consommation / limites, comparaison, demande de changement. |
| Espace plateforme | Réservé au support : entreprises clientes, formules, suspension, journal. |

### Règles respectées

- **Aucun prix de prestation n'est prédéfini, aucune donnée d'exemple n'est ajoutée.** Les libellés proposés pendant la mise en route (Berline, Lavage extérieur…) ne sont que des raccourcis de saisie : rien n'est inséré sans une action de l'utilisateur.
- Tant que la station n'est pas activée, les écritures de métier lèvent `409 onboarding_incomplete` avec la liste de ce qui manque (`src/lib/store.tsx`, `assertActivated`). Les écrans concernés affichent le panneau de blocage.
- **Garde-fou de session** : un visiteur sans cookie ne déclenche qu'**un seul** appel à `/auth/me`. La promesse est mémorisée une fois (`fetchMeOnce`), et un 401 résout `null` sans invalider le cache — c'était le défaut réel qui produisait 2 300 requêtes en cinq secondes.
- Absents volontairement, faute de les tenir : « Continuer avec Google / Facebook », « Mot de passe oublié » par e-mail (le texte renvoie vers *Employés*), « Se souvenir de moi » (session de 30 jours, l'option n'aurait aucun effet).

## Changer la photo des écrans d'authentification

Remplacez le seul fichier `public/images/lav-auto.jpeg` (même nom). En développement (`npm run dev`), le changement est immédiat ; après un `npm run build`, rechargez la page. Le dégradé sombre posé sur la photo garde le badge « Espace station », l'accroche et les trois repères lisibles, même sur une photo très claire. Sur téléphone, le panneau disparaît et le formulaire reste plein largeur.

## Supabase

Le client est prêt dans `src/lib/supabase.ts` et n'est activé que si `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` sont renseignées (voir `.env.example`). Sans ces variables, l'application tourne en **mode démonstration local** : l'état est conservé dans le `localStorage` du navigateur (`washguard.state.v1`).

`src/lib/store.tsx` est la seule couche de données. Elle simule le *contrat* du serveur (inscription idempotente, onboarding constaté, 409, caisse, commissions) et non des données. Quand Supabase sera branché, ses actions seront remplacées par des appels aux tables `companies`, `stations`, `users`, `services`, `vehicle_categories`, `clients`, `washes`, `wash_items`, `payments`, `cash_sessions`, `expenses`, `plans`, `subscriptions`, `audit_logs`, **sans modifier les écrans**.

Les mots de passe de la démonstration sont stockés localement uniquement pour rendre la connexion testable ; l'authentification réelle sera Supabase Auth, aucun mot de passe ne doit transiter par le frontend.

Pour repartir à vide : *Paramètres → Réinitialiser la démonstration*.

## Structure

```
index.html              point d'entrée Vite
src/
  main.tsx              thème initial + providers
  App.tsx               routes et garde de session
  types.ts              types métier (reflet des tables Supabase)
  index.css             thème sombre / clair (variables CSS) + composants Tailwind
  lib/
    format.ts           FCFA, jj/mm/aaaa, export CSV
    metrics.ts          rapports, commissions, théorique de caisse
    plans.ts            table `plans` (source unique des tarifs)
    supabase.ts         client prêt, non branché
    store.tsx           couche de données + règles métier
  components/
    ui.tsx              briques d'interface
    AppShell.tsx        sidebar, topbar, navigation par rôle
  pages/                vitrine, auth, 13 modules
docs/onboarding.md      parcours, prérequis, refus et vérifications
public/images/          photo de lavage
```

## Licence

Voir [LICENSE.md](LICENSE.md) (template Horizon UI d'origine, remplacé par cette application).
