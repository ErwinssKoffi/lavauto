# LAVAUTO — Sécurité

**Date :** 12/11/2026 · **Statut :** P10 livré.

## 1. Authentification

- Supabase Auth avec confirmation e-mail obligatoire (`mailer_autoconfirm=false`), reset réel et invitations.
- `onAuthStateChange` est la seule entrée ; `auth.getUser()` valide le JWT et `my_context()` relit les permissions côté serveur.
- `load()` / `persist()` n’écrivent jamais `state.session` dans `localStorage`.
- Configuration distante de production : `site_url=https://lavauto-five.vercel.app`, allow-list `http://localhost:5173/**`, `http://127.0.0.1:5173/**`, `https://5173-in4mdo7zgflqt72vpkywe.e2b.app/**`, `https://lavauto-five.vercel.app/**` et le preview Vercel de la PR #3, JWT 3 600 s, aucun SMTP, aucun fournisseur OAuth, aucun hook e-mail/SMS. Les origines CORS du projet restent à renseigner dans le tableau de bord Supabase (voir [`deployment.md`](deployment.md)).
- Ne jamais activer `mailer_autoconfirm` ; ne jamais exposer de clé `service_role` dans une variable `VITE_*`.

## 2. Autorisation et RLS

- `current_company_id()` lit l’entreprise depuis `auth.uid()` ; aucun écran ne fournit `company_id`.
- 48 permissions, 112 liaisons `role_permissions`, `is_platform_admin()` pour le back-office.
- RLS sur toutes les tables métier ; écritures directes révoquées sur `plans`, `plan_limits`, `subscriptions`, `subscription_usage`, `companies`, `platform_audit_logs`, `audit_logs` et `rpc_idempotency_keys`.
- 12 RPC P09 + 4 RPC P10 en `SECURITY DEFINER`, `search_path = public, pg_temp`, exposées à `authenticated` uniquement, **0 grant `anon`**.
- 3 triggers de quota P09 conservés ; `23514` sur dépassement, `42501` sur permission insuffisante.

## 3. Storage

- Bucket `station-assets` : **privé**, 5 Mo, `image/png`, `image/jpeg`, `image/webp`. Le navigateur optimise le logo en WebP 512 px avant l’envoi ; aucun fichier n’est exposé publiquement.
- `station_asset_path()` construit le premier dossier à partir de l’entreprise de l’appelant et normalise le nom de fichier.
- Policies objets : SELECT / INSERT / UPDATE / DELETE limitées au dossier de l’entreprise ou au super admin.
- Policies `p10_anon_objects_deny` et `p10_anon_buckets_deny` : deny-all **RESTRICTIVE** pour `anon`.
- Policies `p10_bucket_insert_deny`, `p10_bucket_update_deny`, `p10_bucket_delete_deny` : aucune création / modification / suppression de bucket par `authenticated`, sans bloquer le SELECT du bucket.
- Les grants historiques de `supabase_storage_admin` ne peuvent pas être révoqués depuis le rôle de migration (rôle réservé). Le grant `SELECT` de `anon` subsiste donc, mais les policies restrictives filtrent **0 ligne** : le test distant insère un objet réel, puis lit `storage.objects` et `storage.buckets` sous le rôle `anon` et obtient 0 dans les deux cas. Les écritures `anon` et l’insertion de bucket `authenticated` sont refusées en `42501`.
- URL signée d’une heure, jamais d’URL publique, aucun fichier persistant après les tests.

## 4. Secrets et réseau

- Aucune clé `service_role`, aucun secret Vercel, aucun token, aucun mot de passe dans le dépôt ou le bundle.
- `.env.local` est ignoré ; `.env.example` ne contient que des noms de variables et des valeurs vides.
- Variables de production fournies par l’environnement Vercel et les GitHub Secrets (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`).
- `withRetry()` applique un backoff exponentiel uniquement sur panne réseau / 5xx / 429 ; une clé d’idempotence stable est conservée pour les rejeux.
- `claim_rpc_idempotency()` refuse les RPC hors liste blanche et les clés invalides (`23514`).

## 5. Journalisation et tests

- `platform_audit_logs` et `audit_logs` restent append-only ; `rpc_idempotency_keys` est accessible uniquement via la fonction dédiée.
- `supabase/tests/p10_rollback.sql` vérifie isolation A/B, policies Storage, grants `anon`, pagination, idempotence et 0 fixture après rollback.
- `npm audit` conserve les vulnérabilités modérées connues ; aucun `npm audit fix --force` (React Router v7 reste reporté).

Voir [testing.md](testing.md) et [deployment.md](deployment.md).
