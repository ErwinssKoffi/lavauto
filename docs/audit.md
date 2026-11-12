# Audit complet du frontend WashGuard

**Date :** 11/11/2026 · **Branche :** `arena/868cde36-lavauto` · **Base :** `b119692` (`main`, après merge de la PR #1)
**Périmètre historique :** frontend seul au Prompt 01 / 1.0.1 (React 19, TypeScript, Tailwind CSS, Vite, client Supabase prêt mais non branché). Aucun backend ni projet Supabase n'avait été modifié. **État actuel :** 29 migrations, Supabase Auth/RBAC (P04), cœur lavages (P05) et finance P06 appliqués ; voir [database.md](database.md), [auth-rbac.md](auth-rbac.md), [washes.md](washes.md) et [finance.md](finance.md).

---

## 1. Verdict

| Contrôle | Résultat |
| --- | --- |
| `npm ci` (installation reproductible depuis `package-lock.json`) | ✅ |
| `npm run typecheck` (`tsc -b --noEmit`) | ✅ 0 erreur |
| `npm run build` (`tsc -b` + `vite build`) | ✅ 92 modules, `dist/` ~408 ko JS / 29 ko CSS |
| **`npm run check`** (66 assertions : logique, gardes, rendu DOM, parcours, cahier des charges) | ✅ **66 OK / 0 KO** |
| Rendu des 16 routes + redirection visiteur | ✅ 0 erreur d'exécution |
| Serveur de dev (`0.0.0.0:5173`) | ✅ hôte preview `*.e2b.app` : 200, hôte arbitraire : 403, photo : 200, route SPA : 200 |
| `npm audit` | ⚠️ 5 modérées, **0 haute, 0 critique** (détail §6) |

Le projet est **cohérent, compilable et fonctionnel**. Les corrections listées au §4 ont été appliquées puis re-vérifiées.

---

## 2. Méthode

`npm run check` exécute `scripts/check.cjs`, sans framework de test : esbuild compile les modules TypeScript à la volée, JSDOM fournit un vrai DOM, et React monte réellement l'application. Cinq familles de contrôles :

1. **Logique métier et formatage** (19 assertions) — `computeOnboarding`, `missingRequired`, `buildReport`, `buildCommissions`, `theoreticalCash`, `fetchMeOnce`, `formatFCFA`, `formatDate`, `downloadCSV`, `PLANS`.
2. **Gardes serveur** (8 assertions) — harnais React appelant directement `createWash`, `addExpense`, `addPayment`, `setWashStatus`, `cancelExpense`, `reopenCash` dans quatre contextes (inscription fraîche, complet non activé, activé caisse fermée, activé caisse ouverte).
3. **Rendu DOM** (22 assertions) — les 16 routes, la redirection d'un visiteur non connecté, et les gardes de rôle par URL directe.
4. **Parcours d'inscription** (6 assertions) — saisie réelle du formulaire, soumission, vérification de l'état persisté.
5. **Cahier des charges** (11 assertions statiques) — absence de témoignages, de connexion tierce, de « Se souvenir de moi », renvoi du mot de passe oublié vers *Employés*, français / FCFA / jj-mm-aaaa, thème, photo unique, Supabase, absence de reliquats CRA, absence de prix de prestation prédéfini, documentation.

---

## 3. Conformité au cahier des charges (vérifiée)

| Exigence | Constat |
| --- | --- |
| Vitrine `/` : aperçus du rendu de l'application | ✅ `AppPreview` est un composant React rendu en direct, pas une image |
| Tarifs lus depuis la base, jamais désynchronisés | ✅ source unique `src/lib/plans.ts` partagée vitrine / Abonnement / plateforme — **à remplacer par `SELECT * FROM plans`** |
| Aucun témoignage | ✅ section explicite « Pas de témoignages — pour l'instant » |
| Visiteur identifié → son espace | ✅ `LandingRoute` (support → plateforme, non activé → mise en route, sinon tableau de bord) |
| `AuthLayout` commun, formulaire clair centré, photo + dégradé sombre, panneau masqué sur mobile | ✅ `public/images/lav-auto.jpeg`, `lg:block`, deux dégradés superposés |
| Inscription en deux temps, 4 champs serveur | ✅ entreprise/station puis propriétaire |
| Création **une seule fois** entreprise + station + propriétaire + essai | ✅ idempotence dans `signUp`, testée |
| Mise en route : 13 étapes, 8 obligatoires, **état constaté** | ✅ `computeOnboarding(state)`, aucune case cochée ; testé sur état vide, complet et grille incomplète |
| `409 onboarding_incomplete` + liste des manques | ✅ garde centralisé `assertActivated`, testé dans 4 contextes (6 manques après inscription fraîche, 0 si tout est rempli mais non activé) |
| Aucun prix inventé, aucune donnée d'exemple | ✅ `prices: {}`, `hours: []`, `paymentMethods: []`, `services/clients/washes` vides après inscription ; testé |
| Un seul appel `/auth/me`, 401 sans invalidation de cache | ✅ promesse mémorisée (`fetchMeOnce() === fetchMeOnce()`), testé |
| Pas de Google/Facebook, pas d'e-mail de reset, pas de « Se souvenir de moi » | ✅ contrôles statiques |
| Prix figés sur les fiches | ✅ `unitPrice` copié à la création ; la grille peut changer sans toucher l'historique |
| Caisse : espèces conditionnées à une caisse ouverte, Mobile Money libre | ✅ `assertCashRule`, testé |
| Dépenses annulées avec motif, jamais supprimées | ✅ `status: 'annulee'` + `cancelReason` |
| Commissions : lavages **terminés**, barème station ou exception, CSV paie | ✅ testé (10 % → 300 FCFA, 20 % → 600 FCFA) |
| Français, FCFA, jj/mm/aaaa, thème sombre par défaut + clair | ✅ contrôles statiques et de formatage |

---

## 4. Anomalies trouvées et corrigées

| # | Anomalie | Correction |
| --- | --- | --- |
| 1 | `addPayment` acceptait d'encaisser une fiche **annulée** | `wash_cancelled` ajouté dans `addPayment` |
| 2 | `setWashStatus` permettait de modifier une fiche annulée | vérification du statut courant + `not_found` / `wash_cancelled` |
| 3 | `cancelExpense` pouvait annuler deux fois la même dépense et écraser le motif | `already_cancelled` + `not_found` |
| 4 | `reopenCash` pouvait réouvrir une caisse déjà ouverte, une session inconnue, ou créer **deux caisses ouvertes** | contrôles `cash_open` / `not_found`, session ciblée doit être `cloturee` |
| 5 | Après réouverture, `theoreticalCash` recomptait les anciens paiements/dépenses en espèces (double comptage) | période bornée par `reopenedAt`, le dernier comptage devient le fond ; test dédié |
| 6 | `formatDate('2026-01-03')` pouvait afficher le 02/01 à l'ouest de Greenwich (`new Date` traite une date seule comme UTC) | construction explicite en heure locale |
| 7 | **Injection de formule CSV** : un nom de client ou un motif commençant par `=`, `+`, `-`, `@` était exécutable par Excel | neutralisation par `'` sur les textes uniquement (les nombres négatifs restent numériques) |
| 8 | `allowedHosts: true` acceptait n'importe quel en-tête `Host` en dev/preview (DNS rebinding) | liste explicite `localhost`, `127.0.0.1`, `.e2b.app` ; vérifié : preview 200, hôte arbitraire 403 |
| 9 | Navigation masquait les modules interdits mais les **URL directes** restaient accessibles (caissier → Paramètres/Rapports, propriétaire → Plateforme…) | `RoleRoute` au niveau des routes + lien « Paramètres » du menu réservé propriétaire/gérant ; 5 tests de rôles |
| 10 | Flash de thème sombre pour les utilisateurs en thème clair | script inline dans `index.html` appliquant le thème avant le premier rendu |
| 11 | Reliquats du template CRA : `jsconfig.json`, `prettier.config.js` (plugin désinstallé), `manifest.json` « Create React App Sample » | fichiers morts supprimés, manifeste rebrandé WashGuard |
| 12 | Coquilles / incohérences : « Especes », notification de fiche sans `formatFCFA` | corrigés |
| 13 | Dérive de versions : un `npm install --no-save` d'outils de test avait fait passer React 19.0.0 → 19.3.1 et Tailwind 3.4.17 → 3.4.19 | `jsdom` et `esbuild` ajoutés comme devDependencies **pinnées**, `npm ci` restauré et re-vérifié |

---

## 5. Limites connues (documentées, non corrigées car hors périmètre frontend)

1. **Pas de backend.** L'état est dans `localStorage` (`washguard.state.v1`) ; les mots de passe de démonstration y sont en clair pour rendre la connexion testable. L'authentification réelle sera Supabase Auth + RLS. Aucune donnée ne quitte le navigateur.
2. **Tarifs des formules** : 0 / 15 000 / 35 000 FCFA sont des valeurs de démonstration concentrées dans `src/lib/plans.ts`. À brancher sur la table `plans`.
3. **`make rendu`** (captures automatisées) et **`Cache-Control: no-cache`** sur les fichiers statiques relèvent du backend / de l'API Go et ne sont pas implémentés. Les aperçus de la vitrine sont déjà du rendu React en direct.
4. **Réouverture de caisse** : le premier comptage est conservé comme fond de la nouvelle période ; l'historique ne garde qu'un seul comptage par session (le dernier). Une table `cash_closings` sera nécessaire côté base pour un historique complet.
5. **Caissier et `maxCashierDiscount`** : la limite est appliquée dans `createWash`, pas dans une policy serveur (inexistante à ce stade).
6. **`logoUrl`** accepté sans validation de schéma ; React échappe l'attribut et un `javascript:` n'est pas exécuté dans `<img>`, mais une validation `https:`/`data:image` sera préférable côté API.
7. **Pas de tests unitaires framework** (Vitest/Jest) : la vérification repose sur `scripts/check.cjs`, volontairement léger et sans runner.
8. **`LICENSE.md`** reste la licence MIT du template Horizon UI d'origine, conservée pour conformité.

---

## 6. Dépendances

`npm audit fix` (sans `--force`) a été appliqué puis re-vérifié (`npm ci`, build, `npm run check`) :

| Avant | Après |
| --- | --- |
| 9 vulnérabilités : 5 hautes, 4 modérées | **5 modérées, 0 haute, 0 critique** |

Restantes, toutes **sans exposition navigateur** :

- `react-router` / `react-router-dom` (modérée, directe) : open redirect via backslash dans `Link`/`useNavigate` et `deserializeErrors()` côté SSR. Correctif disponible uniquement en **v7 (breaking)** ; l'application est une SPA qui ne navigue jamais vers une URL fournie par l'utilisateur et n'utilise pas l'hydratation SSR. Migration à planifier séparément.
- `glob`, `minimatch`, `sucrase` (modérées, transitives, outils de build) : contournements de annulation / DoS sur motif, uniquement au moment du build.

Versions vérifiées après `npm ci` : React 19.0.0, react-router-dom 6.30.6, Tailwind 3.4.17, Vite 8.3.8, TypeScript 7.0.2, jsdom 31.0.0, esbuild 0.28.2.

---

## 7. Rejouer l'audit

```bash
npm ci
npm run typecheck
npm run build
npm run check      # 66 assertions, code de sortie 0 si tout passe
npm audit
make web           # aperçu sur 0.0.0.0:5173
```

`npm run check` échoue (code 1) dès qu'une assertion tombe, ce qui en fait un garde-fou utilisable en CI.

---

## 8. Conclusion

Le frontend livré est **complet au regard du cahier des charges** et **sain** : compilation, types, 66 contrôles fonctionnels, rendu de toutes les routes et conformité textuelle passent. Treize anomalies — dont quatre règles métier, une injection CSV, un contrôle d'accès et un réglage d'hôte — ont été corrigées et couvertes par des tests. Les limites restantes sont toutes liées à l'absence volontaire de backend, à la migration React Router v7 ou à des choix de périmètre explicites ; aucune ne bloque la poursuite du frontend.
