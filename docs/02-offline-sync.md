# 02. Mode hors connexion et synchronisation

C'est le risque technique principal du projet. Il est prototypé en S2 et S3 (`docs/11-feuille-de-route.md`) avant toute autre construction.

## 1. Principes

1. L'écran lit la base locale, jamais le réseau.
2. L'utilisateur produit des **commandes** ; chaque commande devient une **opération** appliquée immédiatement en local puis placée dans l'outbox.
3. Le serveur rejoue les opérations de façon **idempotente** et **déterministe**, valide les règles métier, et répond opération par opération.
4. Le client récupère les changements validés par curseur et met à jour sa base locale.
5. Chaque type de donnée a une stratégie de conflit explicite (section 7). Aucune donnée clinique ou financière n'est écrasée.

## 2. Base locale (`packages/local-db`)

- IndexedDB via Dexie. Une base par structure et par utilisateur : `medhub-{tenantId}-{userId}`.
- Au premier démarrage : `navigator.storage.persist()`. Suivi de `navigator.storage.estimate()` ; avertissement à 80 % du quota, blocage des pièces jointes locales à 95 %.
- Tables locales : une table par entité synchronisée (mêmes noms que côté serveur, en camelCase), plus :
  - `outbox` : opérations en attente (`opId`, `status`: `pending` | `sending` | `rejected` | `needs_review`, `attempts`, `lastError`) ;
  - `fileOutbox` : pièces jointes en attente d'envoi ;
  - `syncState` : curseur, dernière synchronisation réussie, dernière date serveur connue, version de schéma ;
  - `conflicts` : conflits remontés par le serveur, à présenter à l'utilisateur habilité ;
  - `searchIndex` : jetons hachés pour la recherche hors connexion ;
  - `meta` : clé de données enveloppée, sel, paramètres de dérivation, identité de l'appareil.
- Schéma versionné (`db.version(n).stores(...).upgrade(...)`). Toute montée de version conserve l'outbox. Un poste resté un mois hors connexion doit se mettre à jour sans perte.

## 3. Chiffrement local

- **Clé de données** (DEK) aléatoire AES-GCM 256 bits par appareil et par utilisateur, générée à l'activation.
- DEK enveloppée par une **clé dérivée du PIN** (PBKDF2-SHA-256, 600 000 itérations, sel aléatoire 16 octets). Argon2id en WebAssembly possible si le budget de taille le permet.
- DEK aussi enveloppée par un **code de récupération d'appareil** (24 caractères base32, affiché et imprimable une seule fois à l'activation), qui permet de récupérer les opérations en attente en cas d'oubli du PIN.
- Chaque enregistrement est stocké sous la forme `{ id, tenantId, ...champsIndexés, enc: { iv, ct } }`. Champs en clair autorisés pour l'indexation : identifiants, clés étrangères, dates, statuts, codes de catégorie. **Jamais en clair** : nom, téléphone, adresse, contenu clinique, montants rattachés à un patient.
- Recherche hors connexion : `searchIndex` contient des jetons `HMAC-SHA-256(clé_index, trigramme normalisé)` et `HMAC(clé_index, clé phonétique)`, où `clé_index` est dérivée de la DEK. La recherche calcule les mêmes jetons sur la saisie et classe par nombre de jetons communs.
- PIN : 6 chiffres minimum (configurable). Verrouillage automatique après 5 minutes d'inactivité (configurable par structure). Après 10 échecs (configurable) : effacement local **seulement si** l'outbox est vide ; sinon blocage et obligation d'utiliser le code de récupération ou une connexion en ligne.
- La DEK déverrouillée vit uniquement en mémoire (objet `CryptoKey` non extractible) et disparaît au verrouillage.
- Recommandation affichée à l'administrateur : chiffrement du disque des postes.

## 4. Opérations

```ts
type Operation = {
  opId: string;            // UUID v7, généré sur l'appareil
  tenantId: string;
  siteId: string | null;
  deviceId: string;
  userId: string;
  command: string;         // ex. 'patient.register', 'vital_sign.record'
  entity: string;          // table visée, ex. 'patient'
  entityId: string;        // UUID v7 de l'entité
  baseVersion: number | null; // version connue au moment de la modification (null à la création)
  payload: unknown;        // validé par le schéma Zod de la commande
  hlc: string;             // horloge logique hybride, format 'physicalMs:counter:deviceId'
  clientTs: string;        // ISO 8601, horloge locale
  schemaVersion: number;   // version du protocole et des schémas
  signature: string;       // Ed25519 de l'appareil sur le contenu canonique
};
```

Registre des commandes : `packages/domain/src/commands.ts`. Chaque commande déclare :
- `name`, `entity`, `payloadSchema` (Zod) ;
- `conflictStrategy` (section 7) ;
- `applyLocal(localTx, op)` : mise à jour optimiste de Dexie (dans `packages/local-db`) ;
- `applyServer(tx, op, ctx)` : application serveur (dans `server/modules/<module>/sync.ts`) ;
- `permission` requise (contrôlée sur le client pour l'interface et **revérifiée** sur le serveur) ;
- `onlineOnly` (vrai pour les commandes interdites hors connexion).

`dispatch(command, payload)` côté client : valide le payload, vérifie la permission locale, crée l'opération, l'applique en local et l'ajoute à l'outbox **dans une seule transaction Dexie**.

## 5. Horloge logique hybride (HLC)

Implémentation dans `packages/shared/src/hlc.ts` : `now()`, `receive(remoteHlc)`, `compare(a, b)`. Le composant physique ne recule jamais. Le serveur horodate chaque opération à réception (`received_at`) et conserve `hlc` et `client_ts`. Le tri des événements d'une chronologie utilise `hlc`, puis `opId`.

Contrôle d'horloge : le client mémorise la dernière date serveur connue. Si l'horloge locale est antérieure de plus de 5 minutes à cette date, l'indicateur d'état passe en « attention requise », les opérations sont marquées `clockSuspect: true` et le serveur les signale dans la supervision.

## 6. Protocole

### 6.1 Points de terminaison

| Méthode et chemin | Rôle |
| --- | --- |
| `POST /api/v1/devices/register` | Enregistre un appareil (clé publique Ed25519, nom, type, empreinte navigateur). Retourne `deviceId`, `deviceCode` (2 lettres, unique dans la structure), jeton de licence, jeton hors connexion, paramètres de sync. En ligne seulement. |
| `POST /api/v1/sync/push` | Reçoit un lot d'opérations. Réponse par opération. |
| `GET /api/v1/sync/pull?cursor=...&limit=...` | Changements depuis le curseur, filtrés par le périmètre de l'appareil. |
| `POST /api/v1/sync/bootstrap` | Premier chargement ou rechargement complet, par blocs avec reprise (`{ table, afterId }`). |
| `GET /api/v1/sync/status` | Retard, opérations en attente côté serveur, version de schéma minimale supportée, date serveur, jeton de licence renouvelé. |
| `POST /api/v1/files` | Envoi d'une pièce jointe (multipart, max 10 Mo, découpage par morceaux de 1 Mo avec reprise). |

### 6.2 Push

Requête : `{ deviceId, schemaVersion, ops: Operation[] }` (200 opérations ou 512 ko au maximum).

Serveur, pour chaque opération, dans l'ordre reçu :
1. Vérifie la session, l'appareil (non révoqué), la signature, `tenantId` égal à celui de la session.
2. Si `op_id` existe déjà dans `op_log` : renvoie le résultat enregistré (`duplicate`). C'est la garantie d'idempotence.
3. Ouvre une transaction `withTenant`, vérifie la permission, valide le payload, exécute `applyServer`.
4. Écrit `op_log` (op complète, statut, résultat) et une ligne `change_log` par entité modifiée, puis l'audit.
5. Valide la transaction. Une opération en échec n'empêche pas les suivantes, sauf dépendance explicite (`dependsOn: opId[]`) : une opération dont une dépendance est rejetée est rejetée avec `DEPENDENCY_REJECTED`.

Réponse : `{ results: [{ opId, status, reason?, serverVersion?, assigned?: { officialNumber?, mrn? }, conflictId? }], serverTime, licenseToken? }` avec `status` dans `applied` | `merged` | `duplicate` | `rejected` | `needs_review`.

Client : retire de l'outbox `applied`, `merged`, `duplicate` ; marque `rejected` (visible dans l'écran de diagnostic, avec possibilité de corriger et renvoyer une nouvelle opération) ; place `needs_review` dans `conflicts`.

### 6.3 Pull

- `change_log` : `seq bigserial`, `tenant_id`, `entity`, `entity_id`, `version`, `op_id`, `scope_keys text[]` (patient, site, service, magasin), `changed_at`.
- Curseur = dernier `seq` vu. Comme des transactions peuvent valider un `seq` inférieur après un `seq` supérieur, le serveur renvoie les lignes `seq > cursor - fenêtre` (fenêtre de 500 séquences ou 2 minutes) et le client **dédoublonne par `(entity, entityId, version)`**.
- Réponse : `{ changes: [{ entity, entityId, version, data | null (supprimée logiquement) }], nextCursor, hasMore }`.
- Le serveur filtre selon le périmètre (section 8) et les permissions de l'utilisateur (un caissier ne reçoit pas les notes cliniques).
- Fréquence : à chaque retour de réseau, après chaque push réussi, et toutes les 30 secondes quand l'application est visible (5 minutes en arrière-plan). Pas de connexion persistante.

### 6.4 Bootstrap

À l'activation d'un appareil ou à la demande (diagnostic) : téléchargement par tables (catalogues d'abord, puis patients du périmètre, puis dossiers), blocs de 500 lignes, reprise après coupure, barre de progression. L'appareil n'est utilisable qu'une fois les catalogues chargés ; les dossiers continuent en arrière-plan.

### 6.5 Boucle de synchronisation (client)

- Déclencheurs : événement `online`, minuteur, `visibilitychange`, fin d'une écriture, bouton « Synchroniser ».
- Ordre : push (jusqu'à vider l'outbox ou erreur réseau), puis pull (jusqu'à `hasMore = false`), puis fichiers.
- Erreurs réseau : attente croissante (2 s, 5 s, 15 s, 60 s, 5 min), jamais d'abandon.
- Un seul cycle à la fois (verrou par Web Locks API, repli sur un drapeau en mémoire), y compris entre onglets.
- Aucune étape non rejouable : un lot interrompu est renvoyé tel quel.

## 7. Stratégies de conflit

| Donnée | Stratégie | Détail |
| --- | --- | --- |
| Constantes, notes cliniques, résultats, prescriptions, diagnostics | `append_only` | Jamais d'écrasement. Une correction est une nouvelle ligne qui référence `supersedes_id`. L'affichage montre la dernière version et garde l'historique. |
| État civil du patient | `field_merge` | Dernier modificateur par champ (comparaison HLC), historique dans `patient_field_history`. Conflit sur un champ sensible (`birth_date`, `sex`, `family_name`) avec `baseVersion` périmée : application de la valeur serveur et création d'un `sync_conflict` à revoir (`needs_review`). |
| Allergies, antécédents, problèmes | `union` | Les ajouts s'additionnent. Suppression logique avec motif obligatoire, jamais physique. Deux ajouts identiques (même substance ou code) sont regroupés à l'affichage, pas fusionnés en base. |
| Stock | `movements` | Chaque sortie ou entrée est un mouvement. Solde recalculé. Stock négatif après synchronisation tardive : opération appliquée quand même (le produit a été remis au patient) et alerte de régularisation `PHAR_NEGATIVE_STOCK`. |
| Caisse et facturation | `immutable_ledger` | Écritures en ajout seul. Corrections par écriture inverse. Clôture par appareil. Rapprochement à la synchronisation. |
| Doublons de patients créés hors connexion | `review_merge` | Détection par score à la synchronisation (job), création de `duplicate_candidate`, fusion validée par un humain, réversible. |
| Rendez-vous | `first_wins` | Deux réservations du même créneau : la seconde (HLC postérieur) est rejetée `RDV_SLOT_TAKEN` ; le client propose un autre créneau et notifie l'agent. |
| File d'attente | `first_wins` sur le statut, `append_only` sur les événements | Un ticket appelé deux fois : le second appel est enregistré mais n'altère pas le statut. |
| Configuration | `server_authority` | Jamais modifiée hors connexion. Distribuée en lecture seule. |

Tout conflit non résolu automatiquement crée une ligne `sync_conflict` (`entity`, `entity_id`, `op_id`, `kind`, `server_value`, `client_value`, `status`, `resolved_by`, `resolved_at`). Objectif : moins de 1 % des opérations.

## 8. Périmètre de synchronisation

Règles par défaut (table `sync_scope_rule`, modifiables par structure et par rôle) :

| Donnée | Règle |
| --- | --- |
| Catalogues (tarifs, produits, examens, formulaires publiés, utilisateurs actifs, rôles, conventions et règles publiées, modèles de documents) | Totalité, mises à jour incrémentales. |
| Patients | Visite ou rendez-vous aujourd'hui ou dans les 7 jours ; hospitalisés ; vus dans les 30 derniers jours dans le service de l'utilisateur ; favoris ; créés sur l'appareil ; inscrits à un programme chronique suivi par l'utilisateur. |
| Dossier médical | Complet pour les patients du périmètre. Pièces jointes volumineuses (plus de 200 ko) téléchargées à la demande. |
| Stock | État courant pour les rôles pharmacie et magasin ; résumé (disponible ou non) pour les autres. |
| Factures et caisse | Factures ouvertes des patients du périmètre ; session de caisse de l'utilisateur. |
| Reste | Recherche en ligne avec indicateur clair. Option « pré-chargement complet » pour les petites structures (moins de 5 000 patients). |

Un patient trouvé par recherche en ligne peut être « épinglé » : il entre dans le périmètre de l'appareil.

## 9. Appareils, sessions hors connexion et licence

- **Enregistrement** : paire de clés Ed25519 générée dans le navigateur (clé privée chiffrée par la DEK). Le serveur garde la clé publique. Chaque opération est signée.
- **Jeton hors connexion** : JWS Ed25519 signé par la plateforme, contenant `userId`, `tenantId`, `deviceId`, empreinte des permissions, `iat`, `exp` (14 jours par défaut, configurable par structure, maximum 30). Renouvelé à chaque synchronisation réussie. Expiré : l'utilisateur doit se reconnecter en ligne ; l'outbox reste conservée et sera envoyée après reconnexion.
- **Instantané de permissions** : liste des permissions effectives stockée localement, utilisée pour l'interface hors connexion. Le serveur revérifie toujours.
- **Révocation** : appareil déclaré perdu ou volé dans l'administration. À la connexion suivante, le serveur répond `DEVICE_REVOKED` et le client efface ses données locales (après tentative d'envoi de l'outbox si la structure l'autorise).
- **Délai maximal hors connexion** configurable par structure : au-delà, verrouillage jusqu'à la prochaine connexion (sauf accès d'urgence en lecture).
- **Jeton de licence** : JWS Ed25519 avec `kid`, contenant `tenantId`, `plan`, `modules[]`, `limits`, `state`, `issuedAt`, `validUntil`, `graceAt`, `readOnlyAt`, `suspendAt`. Clé publique embarquée dans l'application (plusieurs `kid` pour la rotation). Le client applique le cycle d'impayé sans connexion en comparant la date courante (bornée par la dernière date serveur connue) aux dates du jeton. L'accès d'urgence et l'export ne dépendent jamais de la licence.

## 10. Numérotation hors connexion

- Séries par structure, site, type de document, appareil et année : table `number_series` (`tenant_id`, `site_id`, `doc_type`, `device_id`, `year`, `prefix`, `last_value`).
- Format par défaut : `{SITE}-{DEVICE}-{YYYY}-{SEQ6}`, ex. `KIN-AB-2026-000123`. Format configurable par gabarit (`{SITE}`, `{DEVICE}`, `{YYYY}`, `{YY}`, `{SEQ:n}`, `{PREFIX}`), mais tout gabarit utilisé hors connexion **doit contenir `{DEVICE}`** (contrôle à l'enregistrement de la configuration).
- Le compteur local est dans Dexie et avance dans la même transaction que l'écriture.
- Si `official_numbering_required` est activé pour un type de document, le serveur attribue en plus un numéro officiel séquentiel continu à la synchronisation (`assigned.officialNumber`), imprimé sur les réimpressions.
- Le numéro de dossier patient (MRN) suit le même principe (`{PREFIX}-{DEVICE}-{YY}-{SEQ5}` par défaut) ; un MRN « officiel » optionnel peut être attribué à la synchronisation.

## 11. Fonctions réservées au mode connecté

Super-admin ; paiement d'abonnement et vérification des transactions ; fusion de patients ; partage inter-structures et consentements (phase 2) ; modification de configuration ; création d'utilisateurs et de rôles ; imports massifs ; enregistrement d'appareil ; recherche hors périmètre. Hors connexion, ces écrans affichent un message explicite et, si utile, la dernière copie synchronisée avec sa date.

## 12. Robustesse et exploitation

- **Mise à jour de l'application** : nouvelle version téléchargée en arrière-plan par le service worker, activée à un moment sûr (aucun formulaire modifié non enregistré), avec bandeau « Nouvelle version prête ». Le serveur peut imposer une version minimale (`minClientVersion` dans `/sync/status`) : au-delà, l'application exige la mise à jour avant tout push (l'outbox reste intacte et compatible car l'API accepte les deux dernières versions de schéma).
- **Compatibilité** : l'API accepte `schemaVersion` N et N-1. Les migrations de payload sont des fonctions `upgradeOp(op)` côté serveur.
- **Écran de diagnostic** (`/app/diagnostic`) : opérations en attente et rejetées, conflits, version, espace disque, dernier contact serveur, état de l'horloge, bouton « Exporter le journal » (fichier chiffré pour le support, sans données en clair), bouton « Forcer une synchronisation », bouton « Recharger les catalogues ».
- **Indicateur d'état permanent** dans l'en-tête : vert (connecté et à jour), bleu (synchronisation en cours), orange (hors connexion, avec nombre d'opérations en attente), rouge (attention requise : rejets, conflits, horloge, stockage, jeton bientôt expiré).
- **Outil de rejeu serveur** : script d'administration qui rejoue un `op_log` sur une base de test pour diagnostiquer un incident.

## 13. Prototype de synchronisation (S2 et S3)

Livrable : une mini-application avec deux entités (`patient` en `field_merge`, `vital_sign` en `append_only`) et une entité de stock (`stock_movement`), deux navigateurs, un serveur.

Banc d'essai automatisé (`packages/sync/test/prototype.spec.ts` et Playwright) :
- 500 opérations réparties sur deux appareils ;
- coupures réseau aléatoires (Playwright `context.setOffline`) et coupures en plein push (réponse perdue après validation serveur) ;
- rejeux de lots, ordre d'arrivée aléatoire ;
- vérifications : nombre d'entités serveur égal au nombre d'opérations de création, aucun doublon d'`op_id`, base locale des deux appareils identique à la base serveur sur le périmètre, solde de stock égal à la somme des mouvements, chiffrement local vérifié (aucun nom en clair dans IndexedDB).

Critère de réussite : zéro perte, zéro doublon, convergence des trois bases. En cas d'échec : arrêt et rapport au porteur du projet.
