# Changelog

## 1.0.0 — Frontend WashGuard

- Remplacement du template Horizon UI (CRA/JS) par une application **Vite + React 19 + TypeScript + Tailwind CSS**, avec le client Supabase prêt mais non branché.
- Vitrine `/` : aperçus issus du rendu de l'application, formules et tarifs lus depuis la table `plans`, questions fréquentes, **aucun témoignage inventé**.
- Connexion / inscription avec `AuthLayout` : formulaire clair et centré, panneau photo `public/images/lav-auto.jpeg` avec dégradé sombre, masqué sur téléphone.
- Mise en route : 13 étapes (8 obligatoires) constatées sur les données enregistrées, refus `409 onboarding_incomplete` avec liste des manques, aucun prix ni donnée d'exemple prérempli.
- Modules : tableau de bord, lavages, prestations, clients, employés, caisse, dépenses, rapports (CSV), commissions (CSV), paramètres, abonnement, espace plateforme.
- Montants en FCFA, dates jj/mm/aaaa, thème sombre par défaut et thème clair.
- Garde-fou `/auth/me` : une seule requête par visiteur, un 401 n'invalide plus le cache.
- Documentation : `README.md`, `docs/onboarding.md`, `.env.example`, `Makefile`.
