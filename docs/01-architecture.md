# 01. Architecture technique

## 1. Vue d'ensemble

MedHub suit le modèle **local-first** : le poste de travail est la première source de lecture et d'écriture ; le serveur centralise, valide, arbitre et redistribue.

```
Navigateur (PWA installée)                         Hébergement cPanel
┌─────────────────────────────────┐               ┌──────────────────────────────────────┐
│ Écrans opérationnels (client)   │               │ Next.js standalone (Passenger)       │
│   lisent Dexie (useLiveQuery)   │               │   /api/v1/*  Route Handlers REST     │
│   écrivent des commandes        │  HTTPS court  │   /admin     portail super-admin     │
│ Outbox (opérations en attente)  │ ────────────► │   /connexion pages de connexion      │
│ Moteur de sync (push/pull)      │ ◄──────────── │ Modules serveur (services, repos)    │
│ IndexedDB chiffrée (Dexie)      │               │ PostgreSQL (RLS forcée)              │
│ Service worker (Serwist)        │               │ Fichiers chiffrés hors public_html   │
└─────────────────────────────────┘               │ Cron chaque minute → worker (jobs)   │
                                                  └──────────────────────────────────────┘
```

## 2. Monolithe modulaire

Un seul déploiement, organisé en modules métier isolés. Chaque module possède :
- ses tables (préfixe libre mais regroupées dans `packages/db/src/schema/<module>.ts`) ;
- ses règles pures dans `packages/domain/src/<module>/` (commandes, validations, calculs) ;
- son code serveur dans `apps/web/src/server/modules/<module>/` :
  - `index.ts` : API publique du module (seul fichier importable par les autres modules) ;
  - `service.ts` : orchestration (appelle le domaine, les repositories, l'audit) ;
  - `repository.ts` : accès Drizzle, toujours avec une transaction fournie par `withTenant()` ;
  - `routes.ts` : handlers REST appelés par `app/api/v1/<module>/.../route.ts` ;
  - `permissions.ts` : déclaration des permissions du module ;
  - `sync.ts` : appliqueurs serveur des commandes du module ;
  - `jobs.ts` : tâches de fond du module ;
- son interface dans `apps/web/src/features/<module>/`.

Codes de module : `core`, `pat`, `rdv`, `dpi`, `form`, `fact`, `conv`, `phar`, `lab`, `notif`, `sadm` (MVP) ; `hosp`, `mat`, `img`, `vac`, `port`, `share`, `mpay`, `epid`, `ana`, `rh` (phase 2) ; `maint`, `diet`, `amb` (phase 3).

Chaque module déclare dans un manifeste (`packages/shared/src/modules.ts`) : code, nom, dépendances, phase, permissions, commandes de sync, tables synchronisées. L'activation d'un module pour une structure vérifie les dépendances (`docs/modules/core.md`).

## 3. Rendu et routes

| Préfixe | Contenu | Rendu |
| --- | --- | --- |
| `/` | Pages publiques (présentation, page d'état, conditions) | RSC |
| `/connexion` | Code de structure, identifiant, mot de passe, 2FA, définition et saisie du PIN | RSC + client |
| `/app` | Application des structures | Écrans opérationnels en composants client ; écrans de paramétrage sous `/app/parametres` en ligne |
| `/admin` | Portail super-admin | RSC autorisés, en ligne seulement, politique de sécurité renforcée |
| `/api/v1` | API REST versionnée | Route Handlers |
| `/api/health` | Santé (base, migrations, file de jobs) | Route Handler |

Les adresses internes n'incluent **jamais** le code de structure (préparation des sous-domaines de phase 3).

Le shell de l'application `/app` est précaché par le service worker et doit s'ouvrir sans réseau. Les pages `/app/**` sont statiques côté serveur (aucune donnée de la structure dans le HTML) : toutes les données viennent de Dexie.

## 4. Résolution de la structure

Une fonction unique `resolveTenant(request)` dans `server/platform/tenant.ts` :
- v1 : lit la session signée (cookie `medhub_session`) et retourne `{ tenantId, siteId, userId, deviceId }` ;
- phase 3 : lira aussi le nom d'hôte (sous-domaine) ; aucun autre code ne doit changer.

Le code de structure (exemple `HOP-KIN-0042`) est saisi à la première connexion puis mémorisé sur l'appareil (localStorage non sensible). Format : `[A-Z]{3}-[A-Z]{3}-[0-9]{4}`, attribué par le super-admin, unique, non secret. Lettres ambiguës acceptées en saisie insensible à la casse.

## 5. API REST

- Préfixe `/api/v1`. Ressources au pluriel en anglais (`/api/v1/patients`, `/api/v1/invoices`).
- Corps JSON validés par Zod (schémas de `packages/domain` ou `packages/shared`). Rejet `400` avec liste d'erreurs `{ code, path, message }`.
- Format d'erreur unique : `{ "error": { "code": "PAT_NOT_FOUND", "message": "...", "details": {...}, "requestId": "..." } }`.
- En-tête `Idempotency-Key` obligatoire sur toute écriture hors synchronisation (table `idempotency_key`, conservation 48 h).
- Pagination par curseur : `?cursor=...&limit=50` (limite max 200), réponse `{ items, nextCursor }`.
- Authentification : cookie de session (application) ou clé d'API à portée limitée (`Authorization: Bearer mhk_...`) pour les intégrations.
- Limitation de débit en base (table `rate_limit_bucket`, fenêtre glissante) par utilisateur, clé d'API et adresse IP.
- Chaque handler : `resolveTenant` → contrôle de permission → `withTenant` → service → réponse. Utilitaire `defineRoute({ permission, schema, handler })` pour éviter les oublis.
- OpenAPI généré depuis les schémas Zod, servi sur `/api/v1/openapi.json` (authentifié).
- Toutes les réponses : `Cache-Control: no-store` sauf ressources statiques.

## 6. Tâches de fond

Pas de processus permanent. Mécanisme :
- Table `job` : `id`, `tenant_id` (nullable pour les tâches plateforme), `type`, `payload jsonb`, `run_at`, `attempts`, `max_attempts`, `status` (`queued`, `running`, `done`, `failed`, `dead`), `locked_at`, `locked_by`, `last_error`, `created_at`.
- `enqueue(type, payload, { runAt, tenantId })` depuis les services.
- Cron cPanel chaque minute : `node /home/<compte>/medhub/current/worker/index.js tick`.
- Le tick prend des jobs par lots avec `SELECT ... FOR UPDATE SKIP LOCKED`, exécute pendant au plus 50 secondes, puis s'arrête. Reprise avec attente croissante (1 min, 5 min, 30 min, 2 h, 12 h). Après `max_attempts` : statut `dead` et alerte super-admin.
- Jobs planifiés récurrents (table `job_schedule` : `type`, `cron`, `next_run_at`) : le tick insère les occurrences dues.
- Verrou anti-chevauchement : `pg_try_advisory_lock` global au début du tick ; si déjà pris, sortie immédiate.

Jobs prévus au MVP : envoi de SMS et courriels, génération de factures plateforme, cycle d'impayé, rappels de rendez-vous, alertes de péremption, calcul de la consommation moyenne mensuelle, détection de doublons de patients, sauvegardes, vérification de sauvegarde, purge des clés d'idempotence expirées, recalcul des caches de solde de stock, rapports planifiés, détection « perdu de vue ».

## 7. Fichiers

Interface `StorageDriver` (`server/platform/storage.ts`) : `put(key, stream, meta)`, `get(key)`, `delete(key)` (réservé aux fichiers temporaires), `exists(key)`, `signedUrl(key, ttl)`.
- v1 : `LocalEncryptedStorage`, répertoire hors de `public_html` (`MEDHUB_STORAGE_DIR`), chiffrement AES-256-GCM par fichier, clé de fichier enveloppée par la clé maîtresse (`MEDHUB_FILE_MASTER_KEY`).
- Futur : `S3Storage` compatible S3, sans changement du code métier.
- Clés de stockage : `tenants/<tenantId>/<module>/<yyyy>/<mm>/<uuid>`. Table `attachment` pour les métadonnées.
- Téléchargement uniquement par route authentifiée qui vérifie la permission puis diffuse le fichier déchiffré.
- Côté client : compression des images avant envoi (largeur max 1600 px, JPEG ou WebP qualité 0,8), envoi différé par l'outbox de fichiers (`docs/02-offline-sync.md`).

## 8. Adaptateurs externes

Chaque fournisseur est derrière une interface, choisi par configuration (plateforme ou structure) :
- `SmsProvider` : `send({ to, body, idempotencyKey })` → `{ providerMessageId, status }`. Adaptateurs : `console`, `http-generic`, fournisseurs réels plus tard.
- `EmailProvider` : SMTP via Nodemailer.
- `PaymentProvider` : `createPayment`, `getPaymentStatus`, `verifyWebhook`, `parseWebhook`. Adaptateurs : `manual`, agrégateur à venir.
- `WhatsAppProvider` : même contrat que SMS (phase 2 si fournisseur retenu).
- `Telemetry` : `captureError`, `recordMetric`, `securityEvent`. Adaptateurs : `internal` (tables `error_event`, `metric_sample`), `batela` (emplacement réservé).

Les messages envoyés à l'extérieur (SMS, courriel) ne contiennent jamais de diagnostic ni de résultat d'examen : uniquement des informations de service (« Votre résultat est disponible »).

## 9. Recherche floue

- Serveur : `pg_trgm` et `unaccent` si disponibles (index GIN sur une colonne normalisée `search_text`). Repli si absents : colonne `search_text` normalisée par l'application (minuscules, sans accents) et recherche `ILIKE` + score calculé en application.
- Phonétique : fonction maison `phoneticKey(name)` adaptée au français et aux noms congolais (suppression des voyelles doubles, équivalences `ou/u`, `k/c/q`, `ph/f`, `y/i`, consonnes finales muettes), dans `packages/domain/pat`. Colonne `phonetic_key` indexée.
- Client : index de jetons hachés (voir `docs/02-offline-sync.md`).

## 10. Observabilité

- Journaux `pino` en JSON, un fichier par jour, rotation 14 jours, champ `requestId`. Liste blanche de champs journalisables ; filtre qui supprime tout champ nommé `name`, `phone`, `birthDate`, `diagnosis`, `note`, `payload`.
- `Telemetry.captureError` : message, pile, route, version, `tenantId`, `userId` pseudonymisé ; jamais le corps de la requête.
- Indicateurs de synchronisation par structure : retard, opérations rejetées, conflits ouverts, appareils inactifs.
- Sonde `/api/health` : état base, version des migrations, âge du dernier tick réussi, espace disque si lisible.
- Alertes super-admin (courriel puis SMS) : espace disque, erreurs répétées, échec de sauvegarde, file de jobs bloquée, pic de connexions échouées.

## 11. Performance et dimensionnement du pilote

| Paramètre | Hypothèse |
| --- | --- |
| Utilisateurs simultanés | 15 à 20 au maximum, 8 à 12 en usage courant |
| Activité | 100 à 150 consultations par jour, 40 000 à 55 000 par an |
| Croissance de la base | Quelques Go par an avec documents simples (pas de DICOM) |
| Pool de connexions | 5 à 10 |
| Budget client | Application mise en cache inférieure à 1,5 Mo compressé ; code des écrans lourds (constructeur de formulaires, PDF, graphiques) chargé à la demande |
| Latence locale | Ouverture d'un dossier inférieure à 300 ms ; recherche patient locale inférieure à 200 ms |
| Lots de synchronisation | 200 opérations ou 512 ko par requête au maximum |

## 12. Portabilité

Rien dans le code ne dépend de cPanel. La migration VPS (`docs/09-hebergement-deploiement.md`) change uniquement : le lanceur (Docker), le stockage (S3), le worker (processus permanent possible), et éventuellement l'ajout d'un canal temps réel optionnel. Les écrans continuent de fonctionner par interrogation périodique si le canal temps réel est absent.
