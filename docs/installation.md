# LAVAUTO — Installation

**Date :** 12/11/2026 · Les migrations `051` (logo) et `052` (création atomique) ont été appliquées sur `lavauto` via le connecteur Supabase ; `053`–`057`, le frontend et les nouvelles fonctions de cette branche restent locaux. La recette réelle et tout déploiement nécessitent une autorisation distincte.

## 1. Prérequis

- Node.js **22** et npm.
- Le projet `lavauto` (`cgxrqorwmmcyqescatzs`) comporte **51 migrations enregistrées** après `051` et `052` ; à l’étape P10 il en comportait 49. Le fichier `048_storage_grants_fix.sql` a été retiré après un essai de révocation impossible : la sécurité Storage repose sur les policies RLS **restrictives** de `050` et les gardes supplémentaires de `051`.
- Le logo et la création connectée exigent `051` puis `052`. Elles sont déjà enregistrées sur `lavauto` : ne pas les réappliquer. Sur une autre cible, vérifier l’historique et la sauvegarde, puis planifier leur éventuelle application dans l’ordre. Avant le frontend, effectuer la recette métier, Auth et Storage sur un environnement autorisé.
- Le reçu fonctionne en local après installation. WhatsApp exige en plus `053`, les fonctions, un modèle Meta approuvé et un ordonnanceur ; ils ne sont pas déployés et `053` n’a pas été autorisée à distance. Ne placer aucun secret dans les variables `VITE_*` ; voir [whatsapp-receipts.md](whatsapp-receipts.md).
- La CLI Supabase `3.1.0` est une dépendance de développement épinglée ; `npm ci` installe la commande `npx supabase`. `supabase/config.toml` est initialisé pour le développement local, avec migrations et seed désactivés par précaution. L’installer ou l’initialiser n’authentifie pas la CLI et ne lie aucun projet. Dans ce sandbox, le connecteur Supabase est séparé de la CLI et l’accès réseau direct à Supabase est bloqué. Les versions locales et distantes divergent : ne pas utiliser `supabase db push` sans réconciliation préalable et aperçu vérifié, même avec les garde-fous. Voir [deployment.md](deployment.md) pour l’activation dans un environnement réseau autorisé.
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
npm run test:e2e:connected  # Supabase simulé, aucune donnée distante
```

`npm run test:e2e` exécute 22 parcours Playwright locaux ; `test:e2e:connected` ajoute 22 parcours avec Supabase simulé. Les deux suites reconstruisent `dist/` : les lancer séquentiellement. Ces commandes ne constituent pas une recette sur un vrai service et n’envoient aucun e-mail ni message WhatsApp réel. La CI installe Chromium via `npx playwright install --with-deps chromium`. Les résultats des deux commandes `check` et les prérequis du test de concurrence PostgreSQL isolé figurent dans [testing.md](testing.md).

## 5. Dépannage

- **Source invalide** : `resolveDataSource()` refuse toute valeur autre que `local` ou `supabase`.
- **Supabase sans clé publishable** : `getDataAdapter()` lève une erreur explicite, sans repli silencieux.
- **Session absente** : `onAuthStateChange` + `auth.getUser()` + `my_context()` restent la seule source d’autorité ; aucune session n’est forgeable depuis `localStorage`.
- **Bucket Storage** : privé, 5 Mo, PNG/JPEG/WebP, chemin construit par `station_asset_path()` et URL signée une heure. L’association à la station nécessite `051` ; le mode local ne téléverse pas de logo.

Voir aussi [architecture.md](architecture.md), [security.md](security.md), [deployment.md](deployment.md) et [testing.md](testing.md).
