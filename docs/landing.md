# Vitrine `/` — modèle public ixartz/Next-js-Boilerplate

**Date :** 11/11/2026 · **Branche :** `arena/868cde36-lavauto` · **Portée :** remplacement complet de la seule route `/`.

## Source et décisions

Le dépôt privé `ErwinssKoffi/next-js-boilerplate` n'était pas lisible depuis l'intégration GitHub de l'espace de travail. À la demande explicite, la référence retenue est le modèle public [ixartz/Next-js-Boilerplate](https://github.com/ixartz/Next-js-Boilerplate), branche `main`, avec une **reprise fidèle** des textes, sections, illustrations et de la navigation. Les libellés traduits du modèle (`fr.json`) sont conservés : `Accueil`, `A propos`, `Compteur`, `Portfolio`, `Se connecter`, `S'inscrire`, `Partenaires`, ainsi que le pied de page français.

Trois autres choix ont été appliqués :

1. **Landing + CTA existants** : aucune nouvelle page publique, aucune migration vers Next.js, aucune réécriture des modules `/app/*`.
2. **Aucune nouvelle fonctionnalité** : ni formulaire, ni table, ni RPC, ni e-mail, ni secret, ni dépendance.
3. **Arrêt avant P05 conservé pour cette refonte** : les écritures métier n'ont pas été branchées ici. Le Prompt 05 a ensuite été validé séparément (`p05_complet`).

Le modèle public est sous **licence MIT**, Copyright (c) 2026 Remi W. La notice complète est conservée dans `public/assets/images/LICENSE.txt` ; les neuf logos du tableau des partenaires sont copiés depuis `public/assets/images/` du modèle.

## Correspondance des actions

| Élément repris du modèle | Destination dans WashGuard | Nature |
| --- | --- | --- |
| Bandeau « Live Demo of Next.js Boilerplate — Explore the Authentication » | `Link` → `/inscription` | route Auth existante |
| `Accueil` | `Link` → `/` | route existante |
| `A propos` | ancre `#a-propos` sur le premier paragraphe | section existante |
| `Compteur` | `Link` → `/app/tableau-de-bord` | route protégée existante ; un visiteur non connecté est redirigé vers `/connexion` |
| `Portfolio` | ancre `#partenaires` | section du modèle |
| `Tarifs` | ancre `#tarifs` | section WashGuard conservée |
| `GitHub` | `https://github.com/ixartz/Next-js-Boilerplate` | lien externe du modèle |
| `Se connecter` | `Link` → `/connexion` | route Auth existante |
| `S'inscrire` | `Link` → `/inscription` | route Auth existante |
| Sélecteur de langue | contrôle visuel inerte `FR` / `EN` | reflet du modèle ; aucune route i18n ni fonctionnalité ajoutée |
| Badge « Demo of Next.js Boilerplate » | lien externe vers le dépôt public | lien du modèle |
| `@Ixartz on Twitter`, Clerk, Neon, Crowdin, CodeRabbit, Sentry, Arcjet | URL externes exactes du modèle | aucun bouton mort |
| Tableau des 9 partenaires | URL externes exactes du modèle | illustrations + liens exacts |
| Lien du pied de page | `https://nextjs-boilerplate.com` | lien du modèle |
| CTA de chaque formule | `Link` → `/inscription` | route Auth existante |

La navigation du modèle ne contenait pas de section tarifs. Une section `Formules et tarifs` est donc **conservée depuis l'ancienne vitrine WashGuard** et restylée avec les bordures du modèle : elle lit `plans` via `useStore()`, affiche `formatFCFA(plan.priceMonthly)` et refuse tout prix local de repli lorsque la base Supabase est indisponible (`plansError`). C'est le seul ajout par rapport au contenu exact du modèle, nécessaire pour garder la connexion aux tarifs demandée.

## Sécurité et non-régression

- `AuthPort`, `onAuthStateChange`, `my_context()`, `usePermissions`, `RoleRoute`, RLS et audit P04 restent inchangés.
- `src/pages/Landing.tsx` n'introduit aucun `company_id`, aucun mot de passe, aucune clé `service_role` / `sb_secret_`, ni `getSession()`.
- Le thème global sombre/clair P02 reste disponible dans l'application ; la page `/` force uniquement son propre fond clair, comme le modèle public, via des règles ciblées `.wg-boilerplate-landing`.
- `docs/audit.md`, `docs/architecture-audit.md` et `docs/design-system.md` restent des rapports historiques ; ce document décrit l'état actuel de `/`.

## Vérifications

`npm ci` (185 paquets), `npm run typecheck` (0 erreur), `npm run lint` (11/11), `npm run build` (110 modules ; JS `663,46 kB` / gzip `176,94 kB`, CSS `31,25 kB` / gzip `7,40 kB`), `npm run check` (**140 OK / 0 KO · local**) et `WG_DATA_SOURCE=supabase npm run check` (**141 OK / 0 KO · supabase**) sont rejoués après la refonte. La section `[5]` de `scripts/check.cjs` valide la reprise du texte, l'attribution MIT, les neuf illustrations, la table de correspondance, les liens internes et le branchement des tarifs à `plans`. La section `[7]` continue de vérifier qu'en mode Supabase la vitrine affiche `16 000 FCFA` et non le repli local `15 000 FCFA`, et qu'aucun prix local n'est présenté comme tarif de la base si celle-ci ne répond pas.

**Le Prompt 05 n'a pas été engagé par cette refonte.** Il a été livré séparément après validation `p05_complet` : voir [washes.md](washes.md).
