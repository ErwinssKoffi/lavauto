# Reçu client et avis WhatsApp « lavage prêt »

**État de cette branche, 12/11/2026 :** le reçu, la migration `053_whatsapp_wash_notifications.sql` et les deux fonctions Meta sont implémentés et testés localement. `053`, les fonctions, leurs secrets, le webhook, l’ordonnanceur et le frontend de cette branche **ne sont pas déployés**. Aucun message réel n’a été envoyé. Le compte et l’expéditeur sont indiqués comme approuvés par l’utilisateur ; l’approbation d’un modèle précis n’a pas été vérifiée. Sur `lavauto`, seules les migrations `051` puis `052` ont été autorisées et appliquées : **ne pas les rejouer et ne pas appliquer `053` sans autorisation distincte**.

## Reçu

Dans **Lavages → Détails → Reçu client**, l’opérateur visualise un instantané de la fiche chargée, puis choisit **Imprimer** ou **Télécharger le PDF**. Les deux actions fonctionnent aussi en mode local ; le PDF est produit dans le navigateur, avec la police DejaVu Sans incluse dans le déploiement (`public/fonts/`, licence incluse), sans service externe. L’impression isole le reçu du reste de l’application. En cas d’échec du téléchargement de la police ou du PDF, l’erreur est affichée et l’impression reste disponible.

Le reçu reprend station, client et véhicule lorsqu’ils sont connus, date d’émission, statut, prestations et prix figés, remise totale, total, encaissements actifs et annulés, montant encaissé et reste. La remise de promotion est déjà incluse dans la remise totale : elle n’est pas déduite une seconde fois. Les données d’une autre station ne sont pas attribuées à la fiche ; seules les coordonnées disponibles pour sa station sont affichées. Une fiche annulée est signalée ; une incohérence entre prestations, remise, total ou paiements fait apparaître un avertissement. L’opérateur doit vérifier la fiche avant de remettre le document.

Le reçu reflète **les données chargées à l’ouverture**, pas les changements ultérieurs : actualiser la fiche et générer un nouveau reçu après une modification. Ce récapitulatif n’est **pas une facture fiscale**, ne prouve pas la conformité fiscale ni ne remplace les pièces comptables. Le tableau connecté des lavages est limité aux fiches chargées par `my_wash_board()` ; l’aperçu ne fait pas une nouvelle requête indépendante de certification.

## Consentement et parcours opérateur

1. En mode connecté, enregistrer un client **rattaché à la même station** avec son numéro international explicite, par exemple `+2250700000000` (exemple fictif). Le serveur accepte `+` suivi de 8 à 15 chiffres, sans deviner de pays ; espaces, parenthèses et tirets sont normalisés.
2. Dans **Clients → fiche du client → Consentement WhatsApp**, demander son accord explicite pour les avis de disponibilité du lavage **au numéro affiché**, consigner son origine (5 à 500 caractères, sans données sensibles), cocher la confirmation puis enregistrer. Ce consentement est **distinct** du canal préféré et de l’opt-in fidélité. Lors de l’accord, le serveur verrouille la fiche et refuse si le numéro confirmé ne correspond plus au numéro enregistré ; recharger alors la page et vérifier le numéro avant de recueillir à nouveau l’accord. Un retrait reste possible même si le numéro a changé. La consultation exige `customers.view` ou `customers.manage` ; l’enregistrement et le retrait exigent `customers.manage` et l’accès à la station. Après une réponse perdue ou invalide, actualiser le consentement avant toute autre action : la commande a pu aboutir.
3. Le passage à **Prêt / terminé** après contrôle qualité crée automatiquement une demande : `pending` si le client et son accord sont valides, sinon `blocked` avec une raison. Aucun réseau n’est appelé pendant la transaction du lavage. La restitution (`delivered`) ou l’annulation de la fiche annule une demande encore en attente.
4. Dans **Lavages → Détails → Notifications WhatsApp**, consulter le journal et l’actualiser. Le bouton **Demander l’envoi WhatsApp** n’est disponible que pour une fiche encore prête, un client rattaché et un utilisateur ayant `notifications.enqueue` ou `customers.manage`. Il met en attente ou retrouve une demande existante ; il ne signifie pas qu’un message a été envoyé. Si l’accord a été donné après le passage à prêt, ou si un échec certain a été corrigé, une demande manuelle est nécessaire.
5. Dans la fiche client, consigner la source du **retrait** pour révoquer l’accord. Un changement de numéro le révoque également ; revenir à l’ancien numéro ne le réactive pas. Les demandes non encore réclamées sont annulées. Une transmission déjà commencée ne peut pas être rappelée.

En mode local, le reçu est disponible, mais ni consentement serveur ni envoi WhatsApp réel ne sont simulés. Si `053` manque sur une cible connectée, l’interface signale que les fonctions WhatsApp sont indisponibles ; elle ne prétend pas envoyer.

## Signification des états

| État | Signification |
| --- | --- |
| Bloqué | Aucun client admissible, aucun accord explicite ou numéro invalide au passage à prêt. |
| En attente | Demande enregistrée ; aucun envoi n’est affirmé. Un dispatch configuré et planifié est nécessaire. |
| Transmission en cours | Une seule exécution a réclamé la demande ; l’issue reste inconnue. |
| Accepté par Meta | Le POST a reçu un identifiant `wamid` ; **ce n’est pas une confirmation de livraison**. |
| Envoyé par Meta | Statut `sent` confirmé par webhook, livraison non confirmée. |
| Livré / lu | Statut `delivered` / `read` reçu et authentifié par webhook. |
| Échec | Refus HTTP explicite accompagné d’un code d’erreur Meta ou échec signalé par webhook. Corriger la cause avant une nouvelle demande manuelle. Une réponse HTTP ambiguë sans code Meta reste incertaine. |
| Annulé avant envoi | Accord/numéro changé, fiche restituée ou autre condition devenue invalide avant le claim. |
| Résultat incertain | Délai réseau, réponse ambiguë ou worker interrompu : **ne pas réexpédier** sans investigation. |

Les événements répétés sont dédupliqués et les statuts livrés/lus ne sont pas rétrogradés par un événement tardif. Si Meta confirme tardivement la livraison d’une ancienne tentative après un échec, une relance encore en attente est annulée ; une relance déjà réclamée ne peut pas être rappelée. Une demande en attente, en cours, incertaine ou déjà acceptée/livrée bloque une nouvelle demande pour la même fiche. Après réponse manuelle perdue ou relecture incohérente, l’interface conserve la même clé tant que le panneau reste ouvert et invite à actualiser ; le serveur évite aussi de recréer une demande active. La confirmation du panneau exige un identifiant valide et sa présence dans les 50 dernières entrées du journal : une entrée plus ancienne peut donc nécessiter une vérification par l’exploitant. Après une interruption du worker, un claim de plus de cinq minutes est marqué `unknown` au prochain dispatch, **jamais remis automatiquement en attente**. Un webhook ou une réponse HTTP tardifs peuvent le résoudre ; il n’existe pas de bouton d’effacement forcé de l’incertitude. Investiguer auprès de Meta et de l’exploitant, ne pas modifier la base à l’aveugle.

La file historique CRM `notification_outbox` (fidélité / flottes) est **distincte et toujours non expédiée**. Elle n’est pas reliée à Meta par cette livraison.

## Contrat Meta du modèle

Le code utilise exclusivement un **message template** approuvé pour le bon compte WhatsApp Business et la langue configurée. Le composant `body` doit avoir **exactement deux paramètres textuels positionnels, dans cet ordre** : `{{1}}` = numéro de fiche et `{{2}}` = nom de station. Exemple de texte à soumettre dans Meta, sans garantie d’approbation :

> Bonjour, votre lavage {{1}} est prêt à la station {{2}}. Merci.

Ne pas configurer un modèle nécessitant d’autres paramètres, une pièce jointe ou des boutons variables : le code ne les fournit pas. Le nom, la langue et le texte doivent correspondre au modèle réellement approuvé ; l’approbation du compte ou de l’expéditeur ne démontre pas celle du modèle. Vérifier aussi la catégorie, les règles et les tarifs Meta applicables. Le message n’inclut ni reçu PDF, ni solde, ni plaque ; il utilise le numéro de téléphone, la référence de la fiche et la station. Vérifier l’information donnée au client et les obligations applicables avant activation.

## Configuration serveur uniquement

Les valeurs ci-dessous sont des **noms**, pas des secrets à communiquer dans le chat. Les saisir dans une interface de secrets autorisée ou un gestionnaire sécurisé, jamais dans le dépôt, `VITE_*`, le bundle navigateur, les arguments de commande, les journaux ou un ticket. Un seul tenant et un seul expéditeur sont configurés **par déploiement** ; ce n’est pas une configuration SaaS multi-entreprises automatique. Les demandes d’autres entreprises ne seront pas traitées par ce worker.

| Nom | Rôle |
| --- | --- |
| `WHATSAPP_COMPANY_ID` | UUID réel de l’entreprise autorisée ; le worker est limité à ce tenant. |
| `WHATSAPP_SEND_ENABLED` | `false` pendant la préparation ; seul `true` permet les claims et les POST Meta. |
| `WHATSAPP_DISPATCH_SECRET` | Secret aléatoire distinct, au moins 32 caractères, partagé avec le seul ordonnanceur. |
| `META_PHONE_NUMBER_ID` | Identifiant numérique du numéro expéditeur Meta, **pas** son numéro de téléphone. |
| `META_WABA_ID` | Identifiant numérique du compte WhatsApp Business, utilisé pour filtrer les webhooks. |
| `META_ACCESS_TOKEN` | Jeton serveur ayant les droits et l’accès aux actifs Meta nécessaires. |
| `META_TEMPLATE_NAME` | Nom exact du modèle approuvé, en minuscules/chiffres/soulignés. |
| `META_TEMPLATE_LANGUAGE` | Code exact de langue approuvée, par exemple `fr` ou `fr_FR`. |
| `META_GRAPH_VERSION` | Version Graph API supportée par le compte, au format `vNN.N`, à valider lors du déploiement. |
| `META_VERIFY_TOKEN` | Secret choisi pour le challenge du webhook, au moins 32 caractères. |
| `META_APP_SECRET` | App Secret Meta utilisé pour vérifier `X-Hub-Signature-256` (HMAC SHA-256). |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Fournis à l’environnement Edge Supabase ; accès serveur privilégié, jamais au navigateur. |

Le contrôle de configuration vérifie la présence et le format, pas que le jeton, l’expéditeur ou le modèle sont réellement valides. Le worker exige **aussi** la configuration du webhook avant de réclamer une demande. Il n’existe aucun secret par défaut.

## Déploiement et exploitation, après autorisation

1. Choisir une **recette isolée**, vérifier projet, sauvegarde/restauration et historique. Sur `lavauto`, `051` et `052` sont déjà enregistrées. Convenir séparément de l’application de `053` et d’un plan compatible avec le journal horodaté ; les migrations et le seed sont désactivés dans la CLI locale. Ne pas lancer de `db push`, `--include-all`, `migration repair`, `db reset` ou `config push` aveugle.
2. Après accord sur la cible, appliquer `053` une fois par un processus contrôlé, vérifier RLS, grants, triggers et RPC ; tester son script de rollback avec des fixtures isolées. Configurer les valeurs serveur de recette, avec `WHATSAPP_SEND_ENABLED=false`. Ne jamais envoyer de messages de test à de vrais clients non consentants.
3. Déployer **uniquement** `whatsapp-webhook` et `whatsapp-dispatch` sur la cible confirmée. Ces deux endpoints serveur-à-serveur ont `verify_jwt=false` : Meta n’a pas de JWT Supabase et l’ordonnanceur utilise son secret dédié. La fonction webhook vérifie le token du challenge GET, puis la signature HMAC du corps brut POST et filtre WABA/expéditeur ; le dispatch vérifie son bearer secret avant toute opération. Ne pas désactiver la vérification JWT des autres fonctions ni déployer toutes les fonctions avec `--prune`.
4. Dans la configuration Webhooks de l’application Meta, déclarer l’URL HTTPS `…/functions/v1/whatsapp-webhook` de **cette cible**, le même `META_VERIFY_TOKEN`, souscrire au champ `messages` et relier l’application au WABA approprié. Vérifier le challenge et l’arrivée des statuts signés en recette. Les messages entrants et leur contenu ne sont pas traités. Les événements non corrélables à une demande de ce tenant/expéditeur sont ignorés ; un statut manquant peut donc rester non confirmé.
5. Préparer un ordonnanceur serveur fiable (par exemple un service de jobs autorisé, ou une solution Supabase Cron/Network/Vault convenablement configurée) : POST HTTPS vers `…/functions/v1/whatsapp-dispatch`, avec `Authorization: Bearer` suivi de `WHATSAPP_DISPATCH_SECRET`, sans exposer ce secret à l’utilisateur final ni l’écrire dans des logs. Chaque passage traite au plus **20** demandes ; prévoir cadence, reprise, surveillance des erreurs et limites Meta. Aucune planification n’est créée par le dépôt.
6. Avant de mettre `WHATSAPP_SEND_ENABLED=true` et de démarrer l’ordonnanceur, vérifier le modèle, le webhook, la cible et **les demandes déjà en attente** : l’activation peut expédier le backlog des fiches encore prêtes et consentantes. Tester le cycle complet avec des numéros de recette explicitement consentants, y compris retrait, refus, livraison, relecture, doublons et coupure réseau. Déployer le frontend seulement après la recette et l’autorisation de déploiement.

Le système conserve numéro, preuve d’accord, demandes et événements en base ; les journaux sont immuables et les clés étrangères restreignent la suppression. Définir avec l’exploitant une politique de conservation/suppression et de gestion des droits conforme aux obligations applicables avant mise en service. Protéger les logs d’infrastructure, rotations de secrets et accès privilégiés ; une révocation ne retire pas un message déjà transmis à Meta.

## Tests et limites

Les tests SQL en rollback (`supabase/tests/whatsapp_wash_rollback.sql`) et les courses PostgreSQL isolées vérifient notamment les consentements, verrouillages, réémissions et statuts. Les tests du fournisseur simulent requêtes et signatures HMAC. Les parcours Playwright interceptent entièrement Supabase ; aucun ne vérifie les droits, le modèle, la livraison, la configuration de Meta ou une plateforme Edge **réels**. Voir [testing.md](testing.md) pour les résultats et [deployment.md](deployment.md) pour les garde-fous de déploiement.
