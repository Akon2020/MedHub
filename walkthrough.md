# Walkthrough MedHub

Ce document retrace **tout ce qui a été réalisé** sur MedHub depuis le premier commit : choix, code, tests, documentation, décisions, écarts et points ouverts. Il se lit de haut en bas comme une visite guidée du dépôt. Pour installer et lancer le projet, voir `guide.md` ; pour l'état courant et les décisions en attente, voir `docs/avancement.md` ; pour les règles du projet, voir `AGENTS.md` et `docs/`.

Dernière mise à jour : 30/10/2026, branche `develop`.

---

## Sommaire

1. Contexte et consignes du porteur du projet
2. Chronologie des travaux
3. Environnement de développement constaté
4. Vue d'ensemble du dépôt
5. `packages/shared` : briques communes
6. `packages/domain` : règles métier pures
7. `packages/sync` : protocole et moteurs de synchronisation
8. `packages/db` : base PostgreSQL, sécurité et migrations
9. `packages/local-db` : base locale chiffrée du navigateur
10. Paquets réservés : `conventions`, `forms`, `config`
11. `apps/web` : application Next.js
12. Identité visuelle et thème sombre
13. Sécurité de connexion (S4) : 2FA, limitation de débit, règles d'IP, CSP
14. `apps/worker` : tâches de fond
15. Infrastructure, déploiement et intégration continue
16. Tests et résultats
17. Documentation produite et mise à jour
18. Décisions prises et écarts par rapport à `docs/`
19. Points ouverts, risques et décisions attendues
20. Suite du plan de développement

---

## 1. Contexte et consignes du porteur du projet

MedHub est un système d'information de santé web, multi-structures, vendu en SaaS et conçu **local-first** : chaque poste continue de fonctionner sans réseau et se synchronise au retour de la connexion. Marché initial : République démocratique du Congo, français par défaut, anglais en seconde langue, devises USD et CDF. Hébergement v1 sur cPanel (Node.js via Passenger, PostgreSQL).

Consignes reçues et appliquées pendant les sessions :

| Consigne | Application |
| --- | --- |
| Lire `AGENTS.md` (copie des règles du projet) puis suivre `docs/` | Fait au début de chaque session ; ordre de priorité respecté |
| Style visuel des maquettes « Meditech » fournies et palette `.aco` (`#f3f8f9`, `#b4dadd`, `#a9c1ba`, `#6aafba`, `#0d1d1d`, `#425658`, `#677183`) | Identité teal, voir section 12 |
| Teal partout, effets de verre seulement sur les pages publiques et la connexion | Écrans opérationnels sobres, `.glass` réservé au public |
| Produire `guide.md` à la racine (lancement, intégration, variables, commandes) | Fait et tenu à jour |
| Commit et push réguliers sur `develop` avec messages explicites | Conventional Commits, push après chaque tranche |
| **Aucune trace de l'assistant ni de son éditeur dans les commits** | Aucun `Co-Authored-By`, aucun nom d'outil ; un message ancien a été réécrit (voir section 2) |
| Pas de tiret long dans les contenus générés | Respecté dans le code, la documentation et les messages |
| Base PostgreSQL locale fournie par le porteur | Rôle applicatif `medhub_app` non superutilisateur, secrets uniquement dans `.env.local` (jamais commité) |
| Périmètre de la première session : système visuel, coquille `/app`, page publique, page de connexion, prototype de synchronisation | Livré |
| « Poursuis avec la prochaine étape » (30/10/2026) | Banc Playwright à deux navigateurs, puis S4 et thème sombre |
| Créer ce `walkthrough.md` et ajouter le thème sombre à toute l'application | Ce document ; thème sombre en section 12 |

---

## 2. Chronologie des travaux

| Commit | Date | Contenu |
| --- | --- | --- |
| `ef82382` | 29/10/2026 | Squelette initial Create Next App (point de départ du dépôt) |
| `5fe3a7a` | 29/10/2026 | Premier commit du porteur du projet |
| `59e8202` | 29/10/2026 | `AGENTS.md` : règles du projet. Message réécrit à la demande du porteur (`git filter-branch` puis `push --force-with-lease`, contenu identique) pour ne citer aucun outil |
| `1882e34` | 29/10/2026 | `feat(sync)` : fondations du monorepo et prototype de synchronisation hors connexion |
| `12c92ab` | 29/10/2026 | `feat(db)` : schéma PostgreSQL, RLS forcée, contextes de structure, suite d'isolation |
| `9303633` | 29/10/2026 | `feat(local-db)` : IndexedDB chiffrée, déverrouillage par PIN, recherche hors connexion hachée |
| `374fb1e` | 29/10/2026 | `feat(web)` : application Next.js au design MedHub, connexion, activation du poste, coquille hors connexion |
| `fc33faf` | 29/10/2026 | `feat(worker)` : file de jobs pilotée par cron |
| `c89891a` | 29/10/2026 | `test(sync)` : rejeu du banc de coupures à deux postes contre PostgreSQL |
| `27fe30b` | 29/10/2026 | `chore(infra)` : CI, archive de version, scripts cPanel, outillage |
| `68f2e0c` | 29/10/2026 | `docs` : `guide.md`, journal d'avancement, identité teal |
| `71517a7` | 30/10/2026 | `test(e2e)` : banc Playwright à deux navigateurs sur build de production |
| `829036a` | 30/10/2026 | `docs` : résultats du banc et points ouverts de J0 |
| (cette session) | 30/10/2026 | Thème sombre sur toute l'application ; S4 : 2FA TOTP, codes de secours, limitation de débit, règles d'IP, événements de sécurité, CSP à nonce, écran « Mon compte », mesure de la durée des requêtes ; ce document |

---

## 3. Environnement de développement constaté

- Windows 11 Pro, Node.js 26.3, pnpm 12.11, PostgreSQL 18.6 local **sans Docker** (Docker absent du poste ; `infra/docker` reste fourni).
- Bases `medhub_dev` (développement) et `medhub_test` (tests d'intégration et d'isolation), rôle `medhub_app` non superutilisateur (un superutilisateur contournerait la RLS), extensions `pg_trgm` et `unaccent` disponibles.
- La CI utilise Node.js 22 et PostgreSQL 16, conformément à la cible cPanel.
- Chromium installé pour Playwright (`pnpm --filter @medhub/web exec playwright install chromium`).

---

## 4. Vue d'ensemble du dépôt

```
MedHub/
├── AGENTS.md              Règles du projet
├── guide.md               Installation, lancement, variables, commandes, déploiement, dépannage
├── walkthrough.md         Ce document
├── docs/                  Spécifications (00 à 13, modules, glossaire, avancement)
├── apps/
│   ├── web/               Next.js 16 : interface + API REST, service worker, tests Playwright
│   └── worker/            Tick cron de la file de jobs (bundle unique tsup)
├── packages/
│   ├── shared/            UUID v7, HLC, argent, erreurs, énumérations, modules, permissions
│   ├── domain/            Commandes métier et règles pures (patients, constantes, stock, numérotation)
│   ├── sync/              Protocole, signature, moteurs client et serveur, bancs de test
│   ├── db/                Schéma Drizzle, migrations, RLS, triggers, audit, jobs, sécurité, seeds
│   ├── local-db/          IndexedDB chiffrée (Dexie), PIN, récupération, index hachés
│   ├── conventions/       Réservé (moteur de conventions, S11)
│   ├── forms/             Réservé (formulaires configurables, S9)
│   └── config/            tsconfig, ESLint, Prettier partagés
├── infra/
│   ├── cpanel/            deploy, migrate, rollback, backup, cron, .htaccess, résultats de checklist
│   ├── docker/            PostgreSQL de développement (docker compose)
│   └── scripts/           dev, release, generate-keys
└── .github/workflows/ci.yml
```

Outillage commun : pnpm workspaces et Turborepo (`build`, `test`, `lint`, `typecheck`), TypeScript 6.0.3 en mode `strict` avec `noUncheckedIndexedAccess`, ESLint 9.39 avec règles de frontières entre modules, Prettier, Vitest 5, fast-check, Playwright 1.64. Toutes les dépendances sont épinglées.

Commandes racine (détail dans `guide.md` section 5) : `dev`, `build`, `typecheck`, `lint`, `format`, `test`, `test:props`, `test:e2e`, `db:generate`, `db:migrate`, `db:seed`, `db:test-isolation`, `worker:tick`, `release`, `keys:generate`.

---

## 5. `packages/shared` : briques communes

Code pur, sans Node.js, DOM ni Dexie, utilisé à l'identique par le client et le serveur.

- `uuid.ts` : `uuidv7()`, `isUuid`, `isUuidV7`. Tous les identifiants et `opId` sont des UUID v7.
- `clock.ts` : horloge injectable (`systemClock`, `ManualClock` pour les tests), `toIso`.
- `hlc.ts` : horloge logique hybride (`formatHlc`, `parseHlc`, `compareHlc`) pour ordonner les écritures entre postes.
- `canonical-json.ts` : sérialisation canonique (clés triées), base des signatures et du chaînage d'audit.
- `money.ts` : argent en **entiers d'unités mineures** avec code ISO 4217 (`money`, `addMoney`, `subtractMoney`, `sumMoney`, `allocateMoney` sans perte de centime, `convertMoney` à taux décimal, `formatMoney`), schémas Zod. Aucun flottant.
- `errors.ts` : codes d'erreur stables (`AUTH_*`, `SYNC_*`, `PAT_*`, `DPI_*`, `PHAR_*`, `CSRF_ORIGIN_MISMATCH`, `RATE_LIMITED`, et depuis S4 `AUTH_MFA_INVALID`, `AUTH_MFA_CHALLENGE_EXPIRED`, `AUTH_MFA_NOT_ENROLLED`, `AUTH_MFA_ALREADY_ENABLED`, `AUTH_MFA_REQUIRED_BY_ROLE`, `IP_BLOCKED`), classe `AppError`. L'interface traduit le code ; aucun message ne contient de donnée personnelle.
- `enums.ts` : types de structure, statuts, types d'appareil, sexes, sensibilité du dossier, statuts cliniques, statuts d'opération, stratégies de conflit, statuts de job, mouvements de stock, codes de constantes.
- `modules.ts` : manifeste des modules (MVP, phase 2, phase 3) avec dépendances (`missingDependencies`).
- `permissions.ts` : catalogue de 68 permissions et rôles modèles (administrateur de structure et direction **privilégiés avec 2FA obligatoire**, accueil, infirmier, médecin, laboratoire, pharmacie, caisse). Permission `device:register` ajoutée.
- `tenant-code.ts` : format et normalisation du code de structure (`HOP-KIN-0042`).

---

## 6. `packages/domain` : règles métier pures

- `commands.ts` : registre des entités et des commandes synchronisées : `patient.register`, `patient.update`, `vital_sign.record` (permission `vital_sign:create`), `stock_movement.record`. Chaque commande a un schéma Zod, une permission, une stratégie de conflit et une fonction d'application.
- `pat/search.ts` : normalisation (accents, casse), clé phonétique adaptée aux noms congolais, trigrammes pour la recherche floue.
- `pat/commands.ts`, `pat/age.ts` : enregistrement rapide, âge exact ou estimé.
- `dpi/vital-signs.ts` : plausibilité des constantes ; une valeur hors limites exige un motif (`DPI_VITAL_IMPLAUSIBLE`).
- `phar/stock.ts` : solde = somme des mouvements, alerte de stock négatif.
- `core/numbering.ts` : numérotation hors connexion sans collision (`{PREFIX}-{DEVICE}-{YY}-{SEQ:5}` par défaut, configurable).

---

## 7. `packages/sync` : protocole et moteurs de synchronisation

- `protocol.ts` : types et schémas des opérations (`opId`, commande, entité, charge utile, HLC, horodatage client, version de schéma, dépendances, signature). Limites : 200 opérations ou 512 Kio par envoi, 500 lignes par lecture, fenêtre de rattrapage de 500 numéros de séquence ou 2 minutes.
- `signing.ts` : signature Ed25519 de chaque opération par la clé de l'appareil (`@noble/curves`), vérifiée par le serveur.
- `reducers.ts` : application des commandes sur l'état local et serveur.
- `server/engine.ts` (`processPush`) : application **idempotente** (clé primaire `op_log.op_id`, `DuplicateOperationError` absorbée). Stratégies :
  - `field_merge` : fusion champ par champ à la dernière HLC, conflit enregistré sur champ sensible ;
  - `append_only` : une correction crée une nouvelle ligne et marque l'ancienne `superseded` ;
  - `movements` : ajout de mouvements, avertissement en cas de stock négatif ;
  - dépendances (`dependsOn`) : une opération dont la dépendance est rejetée est rejetée (`DEPENDENCY_REJECTED`).
- `server/pull.ts` (`processPull`) : lecture par curseur `change_log.seq` avec fenêtre de rattrapage pour les transactions validées en retard, filtrée par permission de lecture.
- `client/engine.ts` (`SyncClient`) : outbox locale, envoi par lots, rejeu en cas de réponse perdue, rebasage des opérations en attente après une modification distante ; les erreurs de transport remontent telles quelles.
- `testing.ts` : magasins en mémoire (`MemoryServerStore`, `MemoryClientStore`) pour les bancs.
- Tests : `prototype.props.test.ts` (500 opérations, deux postes, coupures aléatoires, propriété vérifiée sur 15 graines), `engine.test.ts`, `harness.ts`.

---

## 8. `packages/db` : base PostgreSQL, sécurité et migrations

### 8.1 Schéma (27 tables)

| Domaine | Tables |
| --- | --- |
| Plateforme | `tenant`, `site`, `person_global` (point d'accroche du dossier partagé phase 2), `permission` (catalogue), `platform_audit_log` |
| Identité | `user_account` (dont, depuis S4, `mfa_secret_enc`, `mfa_enabled_at`, `mfa_last_step`), `role`, `role_permission`, `user_role`, `session`, `mfa_recovery_code` (S4) |
| Traçabilité | `audit_log` (chaîné par hachage), `data_access_log` |
| Appareils et numérotation | `device`, `number_series` |
| Clinique | `patient` (avec `field_meta` pour la fusion par champ), `vital_sign` |
| Stock | `stock_movement` |
| Synchronisation | `op_log`, `change_log`, `sync_conflict` |
| Tâches de fond | `job`, `job_schedule`, `job_tick` |
| Sécurité de la plateforme (S4) | `rate_limit`, `ip_rule`, `security_event` |

Colonnes communes, index composites commençant par `tenant_id`, contraintes `check` sur les statuts. Détail des choix dans `docs/04-modele-donnees.md` et `docs/avancement.md`.

### 8.2 Isolation des structures

- `rls.ts` (`ensureRls`) : après chaque migration, **toute** table possédant `tenant_id` (sauf `job`) reçoit `ENABLE` et `FORCE ROW LEVEL SECURITY`, la politique `tenant_isolation` (`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`) et la politique `platform_scope` en lecture seule. Aucune table ne peut être oubliée. 17 tables protégées aujourd'hui.
- Les tables de plateforme de S4 (`rate_limit`, `ip_rule`, `security_event`) n'ont volontairement pas de colonne `tenant_id` (elles protègent la plateforme avant qu'une structure soit connue) ; elles utilisent `target_tenant_id`.
- `context.ts` : `withTenant` (transaction avec `set_config(..., true)` de la structure, de l'utilisateur et de l'appareil), `withPlatformScope` (lecture seule, réservée à `server/platform` et `sadm`), `withSystem` (tables de plateforme).

### 8.3 Ajout seul et immuabilité

`guards.ts` installe des triggers PostgreSQL : `DELETE` interdit sur `vital_sign`, `stock_movement`, `op_log`, `audit_log`, `change_log`, `data_access_log`, `platform_audit_log`, `security_event`, `patient` ; `UPDATE` interdit sur les journaux, les mouvements et `security_event` ; sur `vital_sign`, seules les métadonnées de remplacement peuvent changer.

### 8.4 Audit chaîné

`audit.ts` : `hash = SHA-256(prev_hash || canonical_json(ligne))`, insertion sérialisée par structure avec `pg_advisory_xact_lock(hashtext(tenant_id))`, vérification de chaîne (`verifyAuditChain`) exécutée chaque nuit par le worker.

### 8.5 Autres modules

- `client.ts` : pool `pg` (10 connexions max par défaut, délai de connexion 10 s, `statement_timeout` 20 s).
- `jobs.ts` : `enqueue`, délais de reprise (1 min, 5 min, 30 min, 2 h, 12 h).
- `password.ts` (sous-chemin `@medhub/db/password`) : Argon2id via `@node-rs/argon2`, isolé pour que le worker n'embarque pas le module natif.
- `security.ts` (S4) : `consumeRateLimit` (compteur à fenêtre fixe en une seule requête `insert ... on conflict`, sûr entre plusieurs processus Passenger), `purgeRateLimits`, `recordSecurityEvent`.

### 8.6 Migrations et scripts

- `migrations/0000_init.sql` : schéma initial.
- `migrations/0001_s4_mfa_security.sql` : colonnes 2FA de `user_account`, tables `mfa_recovery_code`, `rate_limit`, `ip_rule`, `security_event` et leurs index.
- `scripts/migrate.ts` : extensions, migrations Drizzle, `ensureRls`, `ensureGuards`, données de référence. Option `--test` pour la base de test.
- `scripts/seed.ts` : structure fictive `HOP-DEM-0001` et comptes `admin`, `accueil`, `infirmier`, `medecin`, `pharmacie`, `caisse` (mot de passe `MEDHUB_SEED_PASSWORD`). Option `--tenant CODE` pour créer une structure de test neuve (utilisée par Playwright : `TST-BNC-NNNN`).
- `scripts/reference-data.ts`, `seeds/platform/plans.json` (grille indicative, marqueur `TODO(medhub-decision)`).

---

## 9. `packages/local-db` : base locale chiffrée du navigateur

- `crypto.ts` : un secret maître par poste, **enveloppé deux fois** : par une clé dérivée du PIN (PBKDF2-SHA-256, 600 000 itérations) et par le code de récupération imprimé. HKDF en dérive deux clés non extractibles : la clé de données AES-GCM et la clé HMAC des index de recherche.
- `database.ts` : schéma Dexie, compteurs de numérotation (`nextCounter`).
- `store.ts` (`EncryptedClientStore`) : toutes les lignes sont chiffrées ; WebCrypto ne pouvant pas s'exécuter dans une transaction IndexedDB, les écritures passent par une surcouche puis un vidage. Recherche hors connexion par jetons hachés (trigrammes et clé phonétique) : aucun nom n'est lisible dans IndexedDB.
- `session.ts` : activation, déverrouillage par PIN, récupération par code imprimé, politique d'échecs (10 essais par défaut). Le poste n'est effacé que si l'outbox est vide : une opération non envoyée n'est jamais perdue.
- Les clés ne vivent qu'en mémoire : un rechargement complet redemande le PIN (comportement voulu, `docs/02-offline-sync.md` section 3).

---

## 10. Paquets réservés : `conventions`, `forms`, `config`

- `conventions` : frontière du moteur de règles de conventions (pur, déterministe, versionné), implémenté en S11.
- `forms` : frontière des formulaires cliniques configurables, implémentés en S9.
- `config` : `tsconfig` de base, configuration ESLint commune (dont les règles de frontières : `src/app/app/**` et `src/features/**` n'importent jamais `src/server/**`, `withPlatformScope` réservé), Prettier.

---

## 11. `apps/web` : application Next.js

### 11.1 Configuration

- Next.js 16.4 (App Router, Turbopack), React 19.3, build `output: 'standalone'`, `distDir` réglable (`NEXT_DIST_DIR`, `.next-e2e` pour Playwright).
- `next.config.ts` : lecture de `.env.local` à la racine du monorepo, en-têtes de sécurité (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`, HSTS), paquets internes transpilés, modules natifs externes (`@node-rs/argon2`, `pg`, `pino`).
- `next-intl` 4 : `fr` par défaut, `en` en second, choix mémorisé dans le cookie `NEXT_LOCALE`, fuseau `Africa/Kinshasa`, format `fr-CD`. Toutes les chaînes sont dans `messages/fr.json` et `messages/en.json`.
- Service worker Serwist compilé par esbuild après `next build` (`scripts/build-sw.mjs`, `src/sw.ts`) : précache de la coquille et stratégies hors connexion. Manifeste PWA `public/manifest.webmanifest`.
- `src/proxy.ts` (S4) : règles d'IP de plateforme et d'administration, puis nonce CSP pour chaque document (section 13).

### 11.2 Pages

| Route | Famille | Contenu |
| --- | --- | --- |
| `/` | Publique (RSC) | Accueil commercial : héros avec aperçu du tableau de bord, atouts, modules par onglets, avantages, tarifs indicatifs mensuels et annuels, appel à l'action, pied de page |
| `/connexion` | En ligne | Code de structure (mémorisé), identifiant, mot de passe ; puis, selon le compte, étape de 2FA ou configuration imposée de la 2FA (S4) ; lien de déverrouillage par PIN si hors connexion |
| `/connexion/activation` | En ligne | Activation du poste : PIN et confirmation, nom et type d'appareil, affichage unique du code de récupération |
| `/app` | Opérationnelle | Tableau de bord : indicateurs, graphique de tendance (Recharts chargé à la demande), activité |
| `/app/patients` | Opérationnelle | Recherche floue hors connexion, enregistrement rapide (`?new=1`), liste avec état de synchronisation |
| `/app/patients/fiche?id=` | Opérationnelle | Fiche patient, constantes avec plausibilité et motif, courbes |
| `/app/diagnostic` | Opérationnelle | État du poste : appareil, opérations en attente, rejets, conflits, dernière synchronisation, stockage, version, synchronisation forcée |
| `/app/bientot?m=` | Opérationnelle | Page d'attente des modules à venir avec la semaine prévue |
| `/app/compte` | En ligne seulement (S4) | Mon compte : double authentification, sessions ouvertes, apparence (thème et langue) |

La coquille `/app` (`features/shell`) comprend la barre latérale repliable filtrée par permissions, la recherche globale, l'**indicateur de synchronisation** permanent (connecté, synchronisation, hors connexion, attention requise) avec panneau de détail, le bandeau de base de formation, le menu utilisateur (thème, langue, « Mon compte et sécurité », verrouillage `Alt+L`, déconnexion) et le verrouillage automatique après 5 minutes d'inactivité.

### 11.3 Moteur client (`src/client`)

- `runtime.tsx` : phases (`loading`, `no-identity`, `not-activated`, `locked`, `ready`), déverrouillage, requêtes locales réactives, installation du point d'accroche de test.
- `activation.ts`, `identity.ts` : création de la clé d'appareil, enregistrement auprès du serveur, identité locale.
- `sync-loop.ts` : boucle de synchronisation protégée par le verrou Web Locks `medhub-sync` (un seul onglet synchronise), recul progressif en cas d'échec.
- `transport.ts`, `api.ts` : appels courts (délai 20 s), distinction erreur réseau et erreur applicative.
- `browser-state.ts` : état réseau et valeurs mémorisées via `useSyncExternalStore`.
- `service-worker.tsx` : enregistrement et mises à jour contrôlées.
- `e2e-hook.ts` : `window.__medhubTest`, compilé **uniquement** quand `NEXT_PUBLIC_MEDHUB_E2E=1` (build Playwright séparé, jamais déployé).

### 11.4 API REST (`/api/v1`)

Toutes les routes passent par `defineRoute` (`server/platform/http.ts`) : identifiant de requête, contrôle d'origine sur les écritures (CSRF), résolution de session, **règles d'IP de la structure** (S4), **permission optionnelle par route** (S4), validation Zod, format d'erreur uniforme (avec `Retry-After` sur 429), `Cache-Control: no-store`, en-tête `Server-Timing` et journalisation des requêtes lentes (S4).

| Méthode et chemin | Rôle |
| --- | --- |
| `GET /api/health` | Sonde de santé |
| `POST /api/v1/auth/login` | Mot de passe ; renvoie `signed_in`, `mfa_required` ou `mfa_enrollment_required` |
| `POST /api/v1/auth/mfa/verify` | Code TOTP ou code de secours, ouvre la session (S4) |
| `POST /api/v1/auth/mfa/enroll` | Secret, URI `otpauth` et code QR SVG de la 2FA imposée (S4) |
| `POST /api/v1/auth/mfa/activate` | Premier code, codes de secours et session (S4) |
| `POST /api/v1/auth/logout` | Révocation de la session |
| `GET /api/v1/auth/me` | Profil, structure, site, permissions |
| `POST /api/v1/devices/register` | Enregistrement du poste (clé publique Ed25519, code d'appareil à deux lettres) |
| `POST /api/v1/sync/push`, `GET /api/v1/sync/pull`, `GET /api/v1/sync/status` | Synchronisation |
| `GET /api/v1/account/security` | État de la 2FA et sessions ouvertes (S4) |
| `POST /api/v1/account/mfa/setup`, `.../confirm` | Activation volontaire de la 2FA (S4) |
| `POST /api/v1/account/mfa/recovery-codes` | Nouveaux codes de secours, avec code frais (S4) |
| `POST /api/v1/account/mfa/disable` | Désactivation, refusée si le rôle l'impose (S4) |
| `POST /api/v1/account/sessions/revoke` | Déconnexion d'une session ou de toutes les autres (S4) |

### 11.5 Serveur (`src/server`)

- `platform/env.ts` : validation Zod paresseuse des variables (le build n'exige pas les secrets) ; `MEDHUB_FIELD_MASTER_KEY` (32 octets) obligatoire depuis S4, `MEDHUB_SLOW_REQUEST_MS` ajoutée.
- `platform/session.ts` : cookie `medhub_session = <tenantId>.<jeton>.<HMAC>`, seul le SHA-256 du jeton est stocké, recherche sous RLS, inactivité 12 h, durée absolue 7 jours.
- `platform/permissions.ts` : `loadPermissions`, `requirePermission`.
- `platform/tenant.ts` : résolution unique de la structure depuis la session signée (jamais depuis le corps, l'URL ou un en-tête).
- `platform/logger.ts` (pino, JSON), `platform/telemetry.ts` (interface `Telemetry`, adaptateur interne, emplacement pour l'adaptateur Batela).
- `platform/mfa.ts`, `platform/ip.ts`, `platform/security.ts` : voir section 13.
- `modules/core` : connexion, 2FA, profil, compte, enregistrement d'appareil.
- `modules/sync` : magasin PostgreSQL du moteur de synchronisation (`pgSyncStore`), routes push, pull et statut.

---

## 12. Identité visuelle et thème sombre

### 12.1 Identité teal

- Palette : fond brumeux `#f3f8f9`, accent teal profond `#0f6b6b`, nuances `#6aafba`, `#b4dadd`, `#a9c1ba`, encre `#0d1d1d`, ardoise `#425658`. Rouge, orange, vert et bleu réservés aux états (alerte, attention, succès, synchronisation).
- Polices Sora (titres) et Plus Jakarta Sans (texte), auto-hébergées par `next/font`.
- Effets de verre (`.glass`), bandes verticales lumineuses (`.hero-backdrop`) et dégradés doux réservés aux pages publiques et à la connexion ; écrans `/app` sobres pour le matériel d'entrée de gamme.
- Composants style shadcn dans `components/ui` (`button`, `badge`, `card`, `input`, `label`), logo SVG (`components/brand/logo.tsx`), icônes `lucide-react`.
- Accessibilité : texte de base 15 px (16 px sur tablette), focus visible, zones tactiles de 44 px, réduction des animations respectée.

### 12.2 Thème sombre (30/10/2026)

- **Trois choix** : Système (par défaut, suit le réglage de l'appareil), Clair, Sombre. Sélecteur `ThemeSwitcher` (`components/theme-switcher.tsx`) en haut de la page publique (et dans son menu mobile), en haut de la connexion, dans le menu utilisateur de `/app` et dans « Mon compte ».
- **Mémorisation par poste** dans le cookie `medhub_theme` : le serveur pose `data-theme` sur `<html>` dès le premier rendu (pas de flash) ; « Système » n'en pose pas et laisse la requête média `prefers-color-scheme` décider, **sans script en ligne** (compatible avec la CSP stricte). Pour les pages servies par le cache hors connexion, le sélecteur réapplique le choix à l'hydratation.
- **Jetons** dans `apps/web/src/app/globals.css` : les variables (`--background`, `--card`, `--primary`, `--muted`, `--border`, états, etc.) sont redéfinies sous `:root[data-theme='dark']` et sous `@media (prefers-color-scheme: dark)` pour `:root:not([data-theme='light'])`. Fond `#0a1515`, cartes `#102020`, accent `#4fb3b5` avec texte foncé `#062222` (contraste AA), états éclaircis (`#4ade80`, `#fb923c`, `#f87171`, `#60a5fa`) sur fonds atténués.
- **Surfaces décoratives** converties en variables : verre (`--glass-*`), bandes du héros (`--hero-*`), fonds de page (`--backdrop-*`), ombres (`--shadow-ink`).
- **Variante Tailwind `dark:`** déclarée (`@custom-variant dark`) avec la même logique, pour les rares cas où un composant doit différer.
- **Couleurs en dur supprimées** : `bg-white` remplacé par `bg-card`, graphiques Recharts et aperçu du héros en `var(--primary)`, `var(--teal-mid)`, `var(--border)`, info-bulle en `var(--popover)`. Les panneaux de marque (côté gauche de la connexion, panneau d'illustration de la page publique) utilisent les jetons fixes `brand` et `brand-deep` ; le code QR de la 2FA reste noir sur blanc pour les caméras.
- `theme-color` du navigateur différent en clair (`#0f6b6b`) et en sombre (`#0a1515`), `color-scheme` déclaré pour les contrôles natifs.
- Vérifié dans le navigateur intégré sur la page publique et la connexion (clair, sombre, système), et par capture Playwright de `/app` et `/app/compte` en sombre.

---

## 13. Sécurité de connexion (S4) : 2FA, limitation de débit, règles d'IP, CSP

### 13.1 Double authentification TOTP

- **Quand** : obligatoire pour tout utilisateur ayant un rôle privilégié ou marqué « 2FA obligatoire » (`role.is_privileged` ou `role.requires_mfa` ; rôles modèles administrateur de structure et direction) ; facultative pour les autres, activable dans « Mon compte ».
- **Connexion en deux temps** : le mot de passe correct ne crée pas de session si un second facteur est requis ; le serveur renvoie un **défi signé** (HMAC avec `MEDHUB_SESSION_SECRET`, lié à la structure, à l'utilisateur et à l'usage `verify` ou `enroll`, valable 5 ou 15 minutes). Le défi n'accorde rien seul.
- **Configuration imposée** : écran « Protégez votre compte », code QR (SVG généré côté serveur par `qrcode`, affiché en image `data:`) et clé manuelle, premier code, puis 10 **codes de secours** (`XXXXX-XXXXX`, alphabet sans caractères ambigus) à imprimer ou noter, affichés une seule fois.
- **Vérification** : code à 6 chiffres (tolérance d'une période de 30 s) ou code de secours (insensible à la casse et aux tirets, usage unique). **Rejeu impossible** : le dernier pas de temps accepté est mémorisé (`mfa_last_step`).
- **Stockage** : secret TOTP chiffré AES-256-GCM avec une clé dérivée par HKDF de `MEDHUB_FIELD_MASTER_KEY` et de l'identifiant de la structure (`v1.<iv>.<chiffré>`) ; codes de secours stockés en SHA-256 seulement.
- **Échecs** : chaque code faux incrémente le compteur de verrouillage progressif du compte (5 échecs : 1 min, 10 : 15 min, 20 : verrouillage) ; le compteur n'est remis à zéro qu'une fois **tous** les facteurs validés.
- **Compte** : régénération des codes de secours et désactivation exigent un code frais ; désactivation refusée si le rôle l'impose.
- **Traçabilité** : audit chaîné `login` (avec la méthode : `password`, `totp`, `recovery_code`, `mfa_enrollment`), `login_failed`, `mfa_failed`, `mfa_enabled`, `mfa_disabled`, `mfa_recovery_regenerated`, `session_revoked` ; événements de sécurité `mfa_enabled` et `mfa_disabled`.
- **Sessions** : liste des sessions ouvertes (navigateur, système, dernière activité, adresse), déconnexion d'une session ou de toutes les autres.

### 13.2 Limitation de débit en base

Compatible cPanel (ni Redis ni processus permanent) : table `rate_limit` à fenêtre fixe, une seule requête atomique.

| Règle | Limite |
| --- | --- |
| Connexions par adresse IP | 30 par 5 minutes |
| Connexions par compte (clé hachée structure + identifiant) | 10 par 5 minutes |
| Vérifications de code 2FA par utilisateur | 8 par 5 minutes |

Au-delà : 429 `RATE_LIMITED` avec `Retry-After`, événement `rate_limited`. À trois fois la limite : **blocage automatique de l'adresse 15 minutes** (`ip_rule` d'origine `auto`) et événement critique `ip_auto_blocked`. Purge horaire des compteurs anciens par le worker.

### 13.3 Règles d'IP

Table `ip_rule` : adresse ou plage CIDR (IPv4 et IPv6), action `block`, `allow` ou `monitor`, portée `platform`, `admin` ou `tenant`, expiration, motif, origine. Appliquées dans `src/proxy.ts` pour la plateforme et `/admin` (avant toute structure), puis dans `defineRoute` pour la structure de la session. Une règle `allow` l'emporte sur un blocage ; des règles `allow` de structure forment une liste blanche. Cache mémoire de 60 secondes. Une base injoignable ne bloque pas la coquille hors connexion. Logique pure testée dans `platform/ip.ts`.

### 13.4 Événements de sécurité

Table `security_event` en ajout seul (triggers) : `rate_limited`, `ip_auto_blocked`, `ip_refused`, `mfa_enabled`, `mfa_disabled`, avec gravité, structure visée, utilisateur, adresse et détail sans donnée de santé. L'écriture d'un événement ne fait jamais échouer la requête.

### 13.5 Politique de sécurité du contenu (CSP)

Chaque document reçoit une CSP avec **nonce neuf** (`src/proxy.ts`) : `script-src 'self' 'nonce-...' 'strict-dynamic'` (plus `'unsafe-eval'` en développement uniquement, exigé par React), `style-src 'self' 'unsafe-inline'` (attributs `style` de React et des graphiques ; aucun script en ligne), `img-src 'self' blob: data:`, `connect-src 'self'`, `worker-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, et `upgrade-insecure-requests` quand l'adresse publique est en HTTPS. Next.js applique le nonce à ses scripts ; toutes les pages sont rendues dynamiquement.

### 13.6 Mesure de la durée des requêtes

Réponse au point ouvert de J0 (une connexion restée 20 s sans réponse) : chaque route renvoie `Server-Timing: app;dur=N`, la métrique `http.duration_ms` est émise, et toute requête plus lente que `MEDHUB_SLOW_REQUEST_MS` (2 s par défaut) est journalisée avec l'état du pool (`total`, `idle`, `waiting`) pour distinguer pool saturé, requête lente ou verrou.

---

## 14. `apps/worker` : tâches de fond

- Lancé par cron chaque minute (`pnpm worker:tick` en développement, bundle unique tsup en production).
- Verrou consultatif (un seul tick à la fois), `FOR UPDATE SKIP LOCKED`, budget de temps, reprises (1 min à 12 h), lettres mortes, enregistrement de chaque passe dans `job_tick`.
- Planification `job_schedule` avec un analyseur cron minimal en UTC.
- Tâches : `system.ping`, `audit.verify_chains` (chaque nuit à 01:30 UTC, alerte si une chaîne est rompue), `security.purge_rate_limits` (chaque heure, S4).

---

## 15. Infrastructure, déploiement et intégration continue

- `infra/scripts/release.mjs` (`pnpm release`) : archive versionnée contenant le serveur standalone, l'entrée Passenger `web/app.cjs` (le serveur Next.js 16 est un module ES), le worker, le script de migration autonome.
- `infra/cpanel/` : `deploy.sh`, `migrate.sh` (sauvegarde `pg_dump` préalable), `rollback.sh`, `backup.sh` (sauvegarde chiffrée), `cron.txt`, `htaccess.template`, `checklist-resultats.md` (à remplir chez l'hébergeur).
- `infra/scripts/generate-keys.mjs` (`pnpm keys:generate`) : secrets de session, clés maîtresses (champs, fichiers, sauvegardes), paire Ed25519.
- `infra/scripts/dev.mjs` : lancement du développement (PostgreSQL Docker si disponible, sinon local).
- `infra/docker/` : PostgreSQL de développement.
- `.github/workflows/ci.yml` :
  - job `verify` : rôle `medhub_app` non superutilisateur, migrations, typecheck, lint, tests, isolation, tests de propriétés, build, contrôle du budget de 1,5 Mo compressés, `pnpm audit`, archive sur étiquette ;
  - job `e2e` : migrations et seed, Chromium, suite Playwright, traces téléversées en cas d'échec ;
  - variables de CI non secrètes (`MEDHUB_SESSION_SECRET`, `MEDHUB_FIELD_MASTER_KEY` propres à la CI).

---

## 16. Tests et résultats

| Suite | Contenu | Résultat |
| --- | --- | --- |
| `packages/shared` | UUID, HLC, argent, codes | 9 tests verts |
| `packages/domain` | Commandes, recherche, plausibilité, stock, numérotation | 10 tests verts |
| `packages/db` (unitaires) | Hachage d'audit | 2 tests verts |
| `packages/db` (isolation, `pnpm db:test-isolation`) | RLS activée et forcée partout, une fabrique par table, lectures, mises à jour et insertions croisées refusées, triggers, chaîne d'audit | **75 tests verts** (71 avant S4 + `mfa_recovery_code`) |
| `packages/local-db` | Chiffrement, PIN, récupération, absence de nom en clair | 5 tests verts |
| `packages/sync` | Banc de propriétés : 500 opérations, deux postes, coupures, réponses perdues, doublons absorbés | 11 tests verts |
| `apps/worker` | Analyseur cron, tick, reprises, lettres mortes | 3 tests verts (budget du tick porté à 20 s dans le test : il échouait sous forte charge) |
| `apps/web` (unitaires, S4) | Correspondance d'adresses et décisions d'IP, chiffrement du secret, TOTP sans rejeu, codes de secours, défis signés | 11 tests verts |
| `apps/web` (intégration PostgreSQL) | Synchronisation réelle (160 opérations, RLS, triggers, audit) ; 2FA de bout en bout (rôle non privilégié, configuration imposée, code faux, rejeu refusé, code de secours à usage unique, désactivation refusée par le rôle, chaîne d'audit intacte, limitation de débit et événement) | 7 tests verts |
| Playwright `sync-bench.spec.ts` | Deux navigateurs réels, 500 opérations, coupures, réponses perdues | 500 opérations (226 enregistrements, 96 modifications, 178 constantes), 109 cycles coupés, 41 réponses perdues ; zéro rejet, zéro doublon, convergence, aucun nom en clair |
| Playwright `sync-bench.spec.ts` (second scénario) | Enregistrement hors connexion par le formulaire, rechargement, synchronisation | Vert |
| Playwright `public.spec.ts` | Page publique vers connexion ; bouton désactivé hors connexion ; projet tablette | Vert |
| Playwright `mfa.spec.ts` (S4) | Configuration imposée de la 2FA à l'écran, codes de secours, seconde connexion avec code faux puis bon code, activation du poste, « Mon compte » en thème sombre ; CSP à nonce neuf | 2 tests verts (1,4 min et 0,5 s) |

Commandes de contrôle avant chaque commit : `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm db:test-isolation` (table métier touchée), `pnpm test:props` (synchronisation touchée).

---

## 17. Documentation produite et mise à jour

- `guide.md` : prérequis, installation pas à pas (PostgreSQL avec ou sans Docker), variables d'environnement (tableau complet), création du schéma et de la démonstration, lancement, test du hors connexion, commandes, tests (dont Playwright), organisation du code, déploiement cPanel, sauvegardes, CI, Git, section « Sécurité de connexion et apparence » (S4), reste à faire, dépannage.
- `docs/avancement.md` : état de J0 et de S4, tableau du critère de sortie J0, décisions, écarts à valider, marqueurs `TODO(medhub-decision)`, dépendances et budget, revues de risque, matrice de compatibilité, journal des sessions.
- `docs/07-ui-ux.md` : identité teal (29/10/2026) et thème sombre (30/10/2026).
- `README.md` : présentation courte et renvois.
- `walkthrough.md` : ce document.

---

## 18. Décisions prises et écarts par rapport à `docs/`

| Date | Sujet | Décision |
| --- | --- | --- |
| 29/10/2026 | Identité visuelle | Teal, verre au public et à la connexion, `/app` sobre (validé par le porteur) |
| 29/10/2026 | Versions | TypeScript 6.0.3 et ESLint 9.39 (compatibilité `typescript-eslint` et `eslint-config-next`), `lucide-react` 1.62.0 (politique d'âge minimal de pnpm) |
| 29/10/2026 | Service worker | Compilé par esbuild après `next build` (`@serwist/next` ne gère pas le build Turbopack) |
| 29/10/2026 | Argon2id | Sous-chemin `@medhub/db/password` pour garder le worker sans module natif |
| 29/10/2026 | Passenger | Entrée `web/app.cjs` qui importe le serveur standalone ES |
| 29/10/2026 | Rechargement de `/app` | Nouveau déverrouillage par PIN (clés en mémoire seulement) |
| 29/10/2026 | RLS | Appliquée par introspection après chaque migration (à valider) |
| 29/10/2026 | Cookie de session | `<tenantId>.<jeton>.<HMAC>` (à valider) |
| 29/10/2026 | Table `job` | Sans RLS de structure (à valider) |
| 29/10/2026 | Rôles | `role.tenant_id` obligatoire, rôles modèles copiés par structure (à valider) |
| 29/10/2026 | `patient.field_meta` | HLC et version par champ (à valider) |
| 29/10/2026 | Permission `device:register` | Ajoutée au catalogue (à valider) |
| 29/10/2026 | Périmètre de synchronisation | Toute la structure, filtrée par permission (temporaire, `sync_scope_rule` en S6) |
| 30/10/2026 | Banc Playwright | Build de production dédié `.next-e2e`, service worker bloqué, structure neuve par passe (à valider) |
| 30/10/2026 | Thème sombre | Livré sur toute l'application alors que `docs/07` le prévoyait en phase 2 (demande du porteur) ; document mis à jour |
| 30/10/2026 | Défi 2FA | Jeton signé sans état plutôt qu'une table de défis : il n'accorde rien seul, expire en 5 ou 15 minutes, et les échecs alimentent le verrouillage du compte (à valider) |
| 30/10/2026 | Codes de secours | Remplacés (supprimés puis recréés) lors d'une régénération : ce sont des identifiants, pas des données cliniques ni financières (à valider) |
| 30/10/2026 | Tables de sécurité | `rate_limit`, `ip_rule`, `security_event` sans `tenant_id` (colonne `target_tenant_id`) car elles servent avant la résolution de la structure (à valider) |
| 30/10/2026 | Clé des secrets 2FA | Dérivée par HKDF de `MEDHUB_FIELD_MASTER_KEY` et de la structure, en attendant l'enveloppe complète (DEK par structure en base) prévue par `docs/03` section 5 (à valider) |
| 30/10/2026 | CSP | `style-src 'unsafe-inline'` conservé pour les attributs `style` de React ; aucun script en ligne autorisé (conforme à `docs/03` section 7) |

---

## 19. Points ouverts, risques et décisions attendues

- **Clôture de J0** : liste de contrôle cPanel sur l'hébergement réel et premier déploiement ; validation par le porteur des écarts marqués « à valider ».
- **Connexion lente isolée** : une requête de connexion restée 20 s sans réponse, une fois sur une dizaine de passes, non reproduite. L'instrumentation de S4 (section 13.6) permettra de l'expliquer si elle revient.
- **Périmètre de synchronisation** : un nouveau poste télécharge toute la structure ; priorité en S6 (`sync_scope_rule`).
- **Compte administrateur de démonstration** : depuis S4, `admin` de `HOP-DEM-0001` doit configurer la 2FA à sa prochaine connexion (rôle privilégié). Les structures fictives `TST-BNC-*`, `TST-ISO-*`, `TST-MFA-*`, `TST-UIX-*` s'accumulent dans les bases de développement et de test (aucune suppression automatique, règle 9).
- **Perte du téléphone et des codes de secours** : réinitialisation par un administrateur à livrer avec la gestion des utilisateurs (S5).
- **Risques matériels** : quota IndexedDB et coût de PBKDF2 (600 000 itérations) sur tablettes d'entrée de gamme, à mesurer pendant le pilote.
- **Marqueurs `TODO(medhub-decision)`** : grille tarifaire publique (valeurs indicatives en attendant), fournisseurs SMS et paiement (adaptateurs `console` et `manual`).
- **Dépendances ajoutées en S4** : `otplib` 13.5.0 et `qrcode` 1.5.4, **côté serveur uniquement** (aucun impact sur le budget client).

---

## 20. Suite du plan de développement

Reste de S4 (`docs/11-feuille-de-route.md`) :
- gestion des structures et des sites par l'administrateur de structure (écrans) ;
- rotation de l'identifiant de session à l'élévation de privilège ;
- détection d'anomalies de connexion (nouvel appareil, horaire atypique) notifiée à l'administrateur.

S5 : appareils (révocation, effacement à distance), jeton hors connexion et jeton de licence signés Ed25519, configuration versionnée (`config_entry`, brouillon et publication), catalogues de référence, i18n complète, base de formation, gestion des utilisateurs (dont réinitialisation de la 2FA).

S6 : patients (recherche floue complète, dédoublonnage, fusion supervisée et réversible, carte et QR), périmètre de synchronisation. Puis S7 à S9 jusqu'au critère de sortie de J1 : un patient parcourt accueil, triage et consultation hors connexion et se synchronise sans erreur.
