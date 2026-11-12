# LAVAUTO — Installation

**Date :** 12/11/2026 · **Branche :** `arena/868cde36-lavauto` · **Statut :** P10 livré.

## 1. Prérequis

- Node.js **22** et npm.
- Un projet Supabase existant (`cgxrqorwmmcyqescatzs`) avec les **49 migrations** déjà appliquées. Les migrations `001`–`044` sont figées ; `045`, `046`, `047`, `049` et `050` sont les cinq migrations P10. Le fichier `048_storage_grants_fix.sql` a été retiré après un essai de révocation impossible : la sécurité Storage est assurée par les policies RLS **restrictives** de `050`, vérifiées avec 0 ligne visible pour `anon`.
- Aucun compte Auth, e-mail de test, secret ou clé API n’est créé par l’installation.

## 2. Installation locale

```bash
git clone <url-du-depot>
cd lavauto
npm ci
cp .env.example .env.local
```

Renseigner `.env.local` :

| Variable | Valeur |
| --- | --- |
| `VITE_DATA_SOURCE` | `local` pour la démonstration hors ligne, `supabase` pour le mode réel. |
| `VITE_SUPABASE_URL` | URL du projet Supabase. |
| `VITE_SUPABASE_ANON_KEY` | Clé **publishable / anon** uniquement. |
| `VITE_SUPABASE_STORAGE_BUCKET` | `station-assets` (bucket privé P10). |
| `VITE_WG_TEST_AUTH` | **Laisser vide en production**. `1` uniquement pour le harnais E2E. |

Ne jamais placer de clé `service_role`, de secret Vercel ou de mot de passe dans un fichier `VITE_*` : tout est embarqué dans le bundle navigateur.

## 3. Démarrage

```bash
npm run dev        # http://localhost:5173
npm run preview    # prévisualisation de dist
npm run build      # tsc -b && vite build
```

Le sandbox Arena expose le preview sur un hôte `*.e2b.app` ; `vite.config.ts` autorise explicitement `.e2b.app`, `localhost` et `127.0.0.1`, et refuse les autres en-têtes `Host`.

## 4. Vérifications

```bash
npm run typecheck
npm run lint
npm run check
WG_DATA_SOURCE=supabase npm run check
npm run test:unit
npm run test:e2e:list
npm run test:e2e       # nécessite Chromium installé
```

`npm run test:e2e` exécute les 15 specs Playwright. La CI GitHub Actions installe Chromium via `npx playwright install --with-deps chromium`. Le sandbox Arena ne peut pas joindre `cdn.playwright.dev`, mais un binaire Chromium headless empaqueté récupéré depuis npm a permis la recette locale **15 / 15** via `PLAYWRIGHT_CHROMIUM_PATH` ; ce binaire n’est pas ajouté au dépôt. `npm run check` rejoue également les 15 parcours équivalents en JSDOM.

## 5. Dépannage

- **Source invalide** : `resolveDataSource()` refuse toute valeur autre que `local` ou `supabase`.
- **Supabase sans clé publishable** : `getDataAdapter()` lève une erreur explicite, sans repli silencieux.
- **Session absente** : `onAuthStateChange` + `auth.getUser()` + `my_context()` restent la seule source d’autorité ; aucune session n’est forgeable depuis `localStorage`.
- **Bucket Storage** : privé, 5 Mo, PNG/JPEG/WebP, chemin construit par `station_asset_path()` et URL signée une heure.

Voir aussi [architecture.md](architecture.md), [security.md](security.md), [deployment.md](deployment.md) et [testing.md](testing.md).
