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

- Bucket `station-assets` : **privé**, 5 Mo, `image/png`, `image/jpeg`, `image/webp`. Le navigateur tente un WebP de 512 px maximum lorsqu’il est pris en charge et plus léger ; sinon il envoie l’original.
- `station_asset_path()` construit le premier dossier à partir de l’entreprise de l’appelant et normalise le nom de fichier.
- Policies objets : SELECT / INSERT / UPDATE / DELETE limitées au dossier de l’entreprise ou au super admin.
- Policies `p10_anon_objects_deny` et `p10_anon_buckets_deny` : deny-all **RESTRICTIVE** pour `anon`.
- Policies `p10_bucket_insert_deny`, `p10_bucket_update_deny`, `p10_bucket_delete_deny` : aucune création / modification / suppression de bucket par `authenticated`, sans bloquer le SELECT du bucket.
- Les grants historiques de `supabase_storage_admin` ne peuvent pas être révoqués depuis le rôle de migration (rôle réservé). Le grant `SELECT` de `anon` subsiste donc, mais les policies restrictives filtrent **0 ligne** : le test distant insère un objet réel, puis lit `storage.objects` et `storage.buckets` sous le rôle `anon` et obtient 0 dans les deux cas. Les écritures `anon` et l’insertion de bucket `authenticated` sont refusées en `42501`.
- La migration `051` ajoute `stations.logo_path`, un garde sur les écritures directes, la RPC `save_station_logo` et des policies restrictives exigeant `settings.manage` pour les écritures dans ce bucket. La RPC vérifie la station, le tenant et l’existence de l’objet. Appliquée sur `lavauto`, elle a fait l’objet de contrôles structurels distants ; la recette avec des comptes et l’API Storage réels reste à effectuer.
- L’aperçu demande une URL signée d’une heure, conservée uniquement en mémoire et renouvelée avant expiration. Une URL signée est un lien porteur : toute personne qui l’obtient peut l’utiliser jusqu’à son expiration ; ne pas la partager ni la persister. Un retrait dissocie le chemin mais ne supprime pas le fichier privé.

## 4. Secrets et réseau

- **WhatsApp non déployé :** `053` place ses trois tables sous RLS sans accès direct utilisateur, protège les RPC par tenant, station et permission, et réserve les RPC worker à `service_role`. Le dispatch exige son secret dédié ; le webhook vérifie le HMAC des octets bruts et filtre WABA/expéditeur. Ces deux endpoints n’utilisent pas la vérification JWT Supabase ; ne pas étendre cette exception aux autres fonctions. Les numéros et preuves d’accord sont des données personnelles soumises à une politique de conservation à définir. Détails et limites : [whatsapp-receipts.md](whatsapp-receipts.md).
- Aucune clé `service_role`, aucun secret Vercel, aucun token, aucun mot de passe dans le dépôt ou le bundle.
- `.env.local` est ignoré ; `.env.example` ne contient que des noms de variables et des valeurs vides.
- Variables de production fournies par l’environnement Vercel et les GitHub Secrets (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`).
- `withRetry()` applique un backoff exponentiel uniquement sur panne réseau / 5xx / 429. La stabilité d’une clé dépend aussi du cycle de vie de chaque commande ; elle ne suffit pas à garantir la reprise de toutes les actions.
- Pour la nouvelle création atomique, `052` réserve une clé par entreprise et compare le condensat, l’utilisateur et la station. Le navigateur conserve la commande exacte dans `sessionStorage` avant l’envoi, y compris ses données saisies, et la garde après une réponse incertaine. La branche conserve aussi la clé et le contenu d’un paiement ultérieur jusqu’à confirmation par relecture. Ces protections sont limitées au même onglet, compte et station et ne remplacent pas une vérification serveur ; la liste actuelle ne contient que les 200 dernières fiches. Les changements associés dépendent de `054` et `055`, non déployées.
- Le plafond de remise du caissier est vérifié dans l’interface, mais n’est pas imposé par la base connectée. Les paramètres de caisse et barèmes locaux ne configurent pas le serveur.
- `claim_rpc_idempotency()` refuse les RPC hors liste blanche et les clés invalides (`23514`).

## 5. Journalisation et tests

- `platform_audit_logs` et `audit_logs` restent append-only ; `rpc_idempotency_keys` est accessible uniquement via la fonction dédiée.
- `supabase/tests/p10_rollback.sql` vérifie isolation A/B, policies Storage, grants `anon`, pagination, idempotence et 0 fixture après rollback ; il a aussi été exécuté à une phase distante historique. `station_logo_rollback.sql` vérifie l’association, les permissions et le retrait ; `atomic_wash_rollback.sql` couvre la transaction, les permissions, les collisions et les canaux. Ces deux nouveaux scripts ont été exécutés en PostgreSQL isolé avec Auth/Storage simulés, pas sur la cible Supabase. Les contrôles distants actuels sont structurels, pas une recette réelle.
- `npm audit` conserve les vulnérabilités modérées connues ; aucun `npm audit fix --force` (React Router v7 reste reporté).

Voir [testing.md](testing.md) et [deployment.md](deployment.md).
