# Guide MedHub

Ce guide explique comment installer, lancer, tester et déployer MedHub. Il complète `AGENTS.md` (règles du projet) et `docs/` (spécifications). L'état d'avancement détaillé est tenu dans `docs/avancement.md`.

## 1. Où en est le projet

Le jalon **J0 Fondations** est construit :

- monorepo pnpm et Turborepo, TypeScript strict, lint, tests ;
- base PostgreSQL avec Row Level Security activée et forcée sur toutes les tables métier, journal d'audit chaîné, tables en ajout seul protégées par des triggers ;
- prototype de synchronisation hors connexion validé : 500 opérations sur deux postes avec coupures et réponses perdues, zéro perte, zéro doublon, convergence ;
- base locale IndexedDB chiffrée, déverrouillée par code PIN, avec recherche floue hors connexion ;
- application web au design MedHub (teal) : page publique, connexion, activation du poste, tableau de bord, patients, fiche patient avec constantes, diagnostic ;
- worker cron pour les tâches de fond, scripts de déploiement cPanel, CI GitHub Actions ;
- thème clair, sombre ou automatique (selon le système) sur toute l'application ;
- début de J1 (S4) : double authentification TOTP avec codes de secours, limitation de débit en base, règles d'IP, politique CSP à nonce, écran « Mon compte » (2FA, sessions ouvertes, apparence), mesure de la durée des requêtes.

Le journal complet de tout ce qui a été fait se trouve dans `walkthrough.md`.

Les modules suivants (rendez-vous, consultation, facturation, pharmacie, laboratoire, super-admin) arrivent dans l'ordre de `docs/11-feuille-de-route.md`. Ils apparaissent dans le menu avec la mention « bientôt ».

## 2. Prérequis

| Outil | Version | Remarque |
| --- | --- | --- |
| Node.js | 22 LTS conseillé (20.19 minimum) | Votre poste a Node 26, cela fonctionne aussi |
| pnpm | 12.11.2 | `corepack enable` puis `corepack prepare pnpm@12.11.2 --activate` |
| PostgreSQL | 14 ou plus | Votre poste a PostgreSQL 18 ; la CI utilise la 16 |
| Git | récent | Branche de travail : `develop` |
| Docker | facultatif | Seulement si vous préférez un PostgreSQL en conteneur |

## 3. Installation pas à pas

### 3.1 Récupérer le code

```bash
git clone https://github.com/Akon2020/MedHub.git
```

```bash
cd MedHub
```

```bash
git checkout develop
```

```bash
pnpm install
```

### 3.2 Préparer PostgreSQL (sans Docker, votre cas actuel)

L'application ne doit **jamais** se connecter avec un superutilisateur : un superutilisateur ignore la Row Level Security et l'isolation des structures ne serait plus garantie. On crée donc un rôle dédié `medhub_app`.

Sur votre poste, cette étape a déjà été faite pendant la session du 29/10/2026 : rôle `medhub_app`, bases `medhub_dev` et `medhub_test`, extensions `pg_trgm` et `unaccent`. Le mot de passe de `medhub_app` a été généré aléatoirement et se trouve uniquement dans votre fichier `.env.local` (non versionné).

Pour refaire l'installation sur un autre poste, ouvrez `psql` avec le compte `postgres` puis exécutez :

```sql
CREATE ROLE medhub_app LOGIN PASSWORD 'choisissez-un-mot-de-passe' NOSUPERUSER NOBYPASSRLS NOCREATEROLE;
CREATE DATABASE medhub_dev OWNER medhub_app;
CREATE DATABASE medhub_test OWNER medhub_app;
\connect medhub_dev
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
\connect medhub_test
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

Conseil de sécurité : le mot de passe actuel du compte `postgres` de votre poste est très simple. Changez-le dès que possible (`ALTER ROLE postgres PASSWORD '...';`). MedHub ne l'utilise pas.

### 3.3 Préparer PostgreSQL (avec Docker)

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

Le conteneur crée automatiquement `medhub_app` (mot de passe de développement `medhub_dev_password`, à changer si le port est exposé), `medhub_dev` et `medhub_test`.

### 3.4 Variables d'environnement

Copiez le modèle puis complétez-le :

```bash
cp .env.example .env.local
```

Générez les secrets (session, clés de chiffrement, clé de signature Ed25519) :

```bash
pnpm keys:generate
```

Collez les lignes affichées dans `.env.local`. Sur votre poste, `.env.local` existe déjà et contient des valeurs de développement.

| Variable | Rôle | Valeur en développement |
| --- | --- | --- |
| `NODE_ENV` | Mode d'exécution | `development` |
| `MEDHUB_BASE_URL` | Adresse publique, sert aussi au contrôle d'origine (CSRF) | `http://localhost:3000` |
| `DATABASE_URL` | Connexion PostgreSQL de l'application (rôle `medhub_app`) | `postgres://medhub_app:...@localhost:5432/medhub_dev` |
| `TEST_DATABASE_URL` | Base des tests d'intégration et d'isolation | `postgres://medhub_app:...@localhost:5432/medhub_test` |
| `DATABASE_POOL_MAX` | Taille du pool (5 à 10 sur cPanel) | `10` |
| `MEDHUB_SESSION_SECRET` | Signature HMAC des cookies de session (48 octets aléatoires) | généré |
| `MEDHUB_FIELD_MASTER_KEY` | Clé maîtresse du chiffrement des champs sensibles, dont les secrets de double authentification (32 octets, base64, **obligatoire**). La changer rend illisibles les secrets 2FA déjà enregistrés | généré |
| `MEDHUB_FILE_MASTER_KEY` | Clé maîtresse du chiffrement des fichiers | généré |
| `MEDHUB_BACKUP_ENCRYPTION_KEY` | Chiffrement des sauvegardes `pg_dump` | généré |
| `MEDHUB_SIGNING_KID` | Identifiant de la clé de signature (rotation) | généré |
| `MEDHUB_SIGNING_PRIVATE_KEY` | Clé privée Ed25519 de la plateforme (jetons de licence et hors connexion, S5) | généré |
| `MEDHUB_SIGNING_PUBLIC_KEY` | Clé publique correspondante, embarquée dans l'application | généré |
| `MEDHUB_SESSION_IDLE_HOURS` | Expiration d'une session inactive | `12` |
| `MEDHUB_SESSION_ABSOLUTE_DAYS` | Durée maximale d'une session | `7` |
| `MEDHUB_STORAGE_DIR` | Fichiers chiffrés, hors `public_html` en production | `./storage` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Courriel | vides |
| `MEDHUB_SMS_PROVIDER` | Adaptateur SMS (fournisseur non choisi) | `console` |
| `MEDHUB_PAYMENT_PROVIDER` | Adaptateur de paiement (agrégateur non choisi) | `manual` |
| `MEDHUB_TELEMETRY_ADAPTER` | Observabilité : `internal` ou `batela` | `internal` |
| `MEDHUB_LOG_DIR`, `LOG_LEVEL` | Journaux | `./logs`, `info` |
| `MEDHUB_SLOW_REQUEST_MS` | Seuil (ms) au-delà duquel une requête est journalisée avec l'état du pool de connexions | `2000` |
| `MEDHUB_BACKUP_REMOTE_URL` | Destination externe des sauvegardes | vide |
| `MEDHUB_SEED_PASSWORD` | Mot de passe des comptes fictifs créés par `pnpm db:seed` (développement uniquement) | généré |

Règles : aucun secret dans le dépôt ; en production, les variables se saisissent dans « Setup Node.js App » de cPanel ; changez toutes les clés après le départ d'un intervenant.

### 3.5 Créer le schéma et la structure de démonstration

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
```

`db:migrate` applique les migrations SQL, force la RLS sur toute table qui possède `tenant_id`, installe les triggers d'ajout seul et charge le catalogue des permissions. `db:seed` crée la structure fictive **Hôpital Pilote Démo**, code **HOP-DEM-0001**, site `KIN`, les rôles modèles et six comptes :

| Identifiant | Rôle |
| --- | --- |
| `admin` | Administrateur de structure et direction |
| `accueil` | Accueil |
| `infirmier` | Infirmier |
| `medecin` | Médecin |
| `pharmacie` | Pharmacien |
| `caisse` | Caissier |

Le mot de passe de ces comptes est la valeur `MEDHUB_SEED_PASSWORD` de votre `.env.local`. Relancer `pnpm db:seed` est sans danger : il ne crée rien en double et remet ce mot de passe.

## 4. Lancer l'application

```bash
pnpm dev
```

Ouvrez http://localhost:3000.

Parcours de démonstration :

1. Page publique : présentation, modules, avantages, tarifs indicatifs.
2. « Accéder à ma structure » : code `HOP-DEM-0001`, identifiant `accueil`, mot de passe `MEDHUB_SEED_PASSWORD`.
3. Activation du poste : choisissez un code PIN d'au moins 6 chiffres et un nom de poste. Un **code de récupération** s'affiche une seule fois : notez-le.
4. Tableau de bord, puis « Nouveau patient » : l'enregistrement fonctionne avec ou sans réseau. Le numéro de dossier contient le code du poste (`KIN-AA-26-00001`), ce qui évite tout doublon entre postes.
5. Connectez-vous avec `infirmier` (bouton « Changer d'utilisateur » sur l'écran verrouillé) pour enregistrer des constantes sur la fiche patient. Une valeur hors limites plausibles demande un motif ; une correction crée une nouvelle mesure et l'ancienne reste visible, barrée.
6. `Diagnostic` : opérations en attente, rejetées, conflits, dernière synchronisation, stockage.

Raccourcis : `/` recherche un patient, `Alt+L` verrouille le poste. Le poste se verrouille aussi seul après 5 minutes d'inactivité et à chaque rechargement complet de la page (les clés ne vivent qu'en mémoire).

### 4.1 Tester le mode hors connexion

En développement :

1. Ouvrez les outils du navigateur (F12), onglet Réseau, cochez « Hors connexion ».
2. Enregistrez des patients : ils apparaissent immédiatement avec le badge « En attente » et l'indicateur passe à l'orange avec le nombre d'opérations en attente.
3. Décochez « Hors connexion » : l'indicateur passe au bleu puis au vert, les badges deviennent « Synchronisé ».

Le service worker (ouverture de l'application sans réseau, y compris après fermeture du navigateur) n'est actif qu'en production :

```bash
pnpm build
```

```bash
pnpm --filter @medhub/web start
```

## 5. Commandes

| Commande | Rôle |
| --- | --- |
| `pnpm install` | Installe les dépendances |
| `pnpm dev` | Vérifie PostgreSQL (démarre le conteneur Docker s'il existe), puis lance Next.js |
| `pnpm build` | Build de production (Next.js standalone, service worker, worker) |
| `pnpm typecheck` | Contrôle de types de tout le monorepo |
| `pnpm lint` | ESLint (dont frontières entre modules) et Prettier |
| `pnpm format` | Reformate le code avec Prettier |
| `pnpm test` | Tests unitaires et d'intégration |
| `pnpm test:props` | Banc de synchronisation de 500 opérations et tests de propriétés |
| `pnpm test:e2e` | Playwright : page publique, banc hors connexion à deux navigateurs, saisie hors connexion depuis l'écran (section 6.1) |
| `pnpm db:generate` | Génère une migration SQL depuis le schéma Drizzle (à relire avant commit) |
| `pnpm db:migrate` | Applique les migrations, la RLS et les triggers |
| `pnpm db:seed` | Charge la structure de démonstration fictive |
| `pnpm db:test-isolation` | Tente des lectures et écritures croisées entre structures sur chaque table |
| `pnpm worker:tick` | Exécute une passe de la file de jobs (ce que fait le cron) |
| `pnpm release` | Construit l'archive à déployer sur cPanel (à lancer sous Linux, la CI le fait) |
| `pnpm keys:generate` | Affiche des secrets neufs au format `.env` |

Avant de considérer une tâche terminée : `pnpm typecheck && pnpm lint && pnpm test`, plus `pnpm test:props` si la synchronisation est touchée et `pnpm db:test-isolation` si une table métier est touchée.

## 6. Ce que vérifient les tests

| Suite | Emplacement | Contenu |
| --- | --- | --- |
| Partagé | `packages/shared` | UUID v7 ordonnés, HLC monotone, répartition d'argent exacte, conversion à taux décimal, JSON canonique |
| Domaine | `packages/domain` | Normalisation, clé phonétique (Kabwe et Cabwe, Mbouyi et Mbuyi), plausibilité, solde de stock, numérotation, âge |
| Synchronisation | `packages/sync` | Banc de 500 opérations, propriété de convergence sur graines aléatoires, rejeu idempotent, signature falsifiée, structure étrangère, conflit sur champ sensible, ordre d'arrivée, correction d'une constante, stock négatif, dépendance rejetée |
| Base locale | `packages/local-db` | Aucune donnée en clair dans IndexedDB, synchronisation, recherche floue, PIN erroné, blocage sans perte, récupération, effacement seulement si l'outbox est vide |
| Isolation | `packages/db/test/isolation` | RLS activée et forcée partout, lecture, modification et insertion croisées refusées, aucune ligne sans contexte, gardes d'ajout seul, détection d'une altération du journal d'audit |
| Intégration | `apps/web/test/integration` | Banc à deux postes contre PostgreSQL réel |
| Worker | `apps/worker/test` | Cron, exécution, reprise, lettre morte |

### 6.1 Tests de bout en bout (Playwright)

Une seule fois, installez le navigateur de test :

```bash
pnpm --filter @medhub/web exec playwright install chromium
```

Puis lancez :

```bash
pnpm test:e2e
```

Playwright construit l'application dans `apps/web/.next-e2e` avec le point d'accroche de test activé (`NEXT_PUBLIC_MEDHUB_E2E=1`), la sert sur le port 3100 et crée une structure fictive neuve (`TST-BNC-NNNN`) dans `medhub_dev`, puis ouvre deux navigateurs indépendants (Accueil et Infirmier). Prérequis : `pnpm db:migrate` fait et `MEDHUB_SEED_PASSWORD` présent dans `.env.local`. La suite dure environ 8 minutes, build compris. Les structures `TST-BNC-...` sont des données de test fictives ; elles s'accumulent dans `medhub_dev` (MedHub ne supprime jamais de données automatiquement). Ce build de test ne doit jamais être déployé : `pnpm release` utilise uniquement `.next`.

## 7. Organisation du code

```
apps/web            Next.js : interface et API REST
  src/app           routes : (public), connexion, app, api
  src/client        moteur hors connexion du navigateur (runtime, boucle de sync, activation)
  src/features      composants par domaine (public, auth, shell, patients, charts)
  src/server        plateforme (env, db, session, http, audit) et modules (core, sync)
  src/sw.ts         service worker
apps/worker         tick cron de la file de jobs
packages/shared     types communs, argent, HLC, UUID v7, erreurs, permissions
packages/domain     règles métier pures, communes au client et au serveur
packages/sync       protocole, moteurs serveur et client, signature
packages/local-db   IndexedDB chiffrée (Dexie)
packages/db         schéma Drizzle, migrations, RLS, contextes, audit, jobs, seeds
packages/conventions, packages/forms   frontières réservées (S9 et S11)
infra/cpanel        scripts de déploiement, cron, .htaccess, liste de contrôle
infra/docker        PostgreSQL de développement
```

Ajouter une commande métier hors connexion : schéma Zod et définition dans `packages/domain/src/commands.ts`, table dans `packages/db/src/schema`, migration (`pnpm db:generate`), correspondance dans `apps/web/src/server/modules/sync/repository.ts`, fixture d'isolation dans `packages/db/test/isolation/fixtures.ts` (le test échoue si elle manque), puis l'écran.

## 8. Déploiement sur cPanel

### 8.1 Une fois, sur l'hébergement

1. Remplir `infra/cpanel/checklist-resultats.md` (Node 22, PostgreSQL 14 ou plus, `pg_trgm`, `unaccent`, cron, SSH, HTTPS). Si un point bloque, préférer une offre cPanel sur VPS.
2. Créer la base et un utilisateur PostgreSQL **non superutilisateur** dans « PostgreSQL Databases ». Activer `pg_trgm` et `unaccent` si l'interface le permet.
3. Créer l'arborescence `~/medhub/releases`, `~/medhub/shared/storage`, `~/medhub/shared/logs`, `~/medhub/shared/backups`.
4. Dans « Setup Node.js App » : Node 22, racine de l'application `medhub/current/web`, fichier de démarrage `app.cjs`, puis saisir toutes les variables de la section 3.4 avec des secrets neufs (`pnpm keys:generate` sur votre poste).
5. Installer les tâches de `infra/cpanel/cron.txt` dans « Cron Jobs » en remplaçant le chemin de `node` par celui affiché par cPanel.
6. Copier `infra/cpanel/htaccess.template` comme `.htaccess` du domaine.

### 8.2 À chaque version

1. Créer une étiquette : `git tag v0.1.0` puis `git push origin v0.1.0`. La CI construit l'archive sous Linux et la publie comme artefact `medhub-release`.
2. Envoyer l'archive sur le serveur (`scp`), puis en SSH :

```bash
~/medhub/current/scripts/deploy.sh ~/medhub-0.1.0.tar.gz
```

Pour le tout premier déploiement, le script se trouve dans l'archive : décompressez-la une fois et lancez `scripts/deploy.sh` depuis le dossier décompressé.

Le script fait une sauvegarde `pg_dump`, applique les migrations, bascule le lien `current`, redémarre Passenger, vérifie `/api/health` et revient automatiquement à la version précédente en cas d'échec.

3. Créer la première structure réelle : en attendant le portail super-admin (S14), utilisez `pnpm db:seed` uniquement en démonstration ; la création de structures réelles passera par le portail.

### 8.3 Sauvegardes

`scripts/backup.sh daily|weekly|monthly` produit un `pg_dump` chiffré (AES-256, clé `MEDHUB_BACKUP_ENCRYPTION_KEY`) avec somme SHA-256, et garde 7 quotidiennes, 4 hebdomadaires, 12 mensuelles. La copie hors serveur et le test de restauration mensuel sont à configurer en S15.

## 9. Intégration continue

`.github/workflows/ci.yml` s'exécute à chaque push sur `develop` et `main` et à chaque demande de fusion : installation, migration d'une base PostgreSQL 16 avec un rôle non superutilisateur, typecheck, lint, tests, isolation, propriétés, build, contrôle du budget client (1,5 Mo compressé), audit des dépendances. Sur une étiquette `v*`, elle produit l'archive de déploiement.

## 10. Travail avec Git

- Développement sur `develop`, fusion vers `main` pour une version stable.
- Messages au format Conventional Commits : `feat(pat): ...`, `fix(sync): ...`, `docs: ...`, `chore: ...`.
- Ne jamais committer `.env.local`, des sauvegardes ou des données réelles.

## 10 bis. Sécurité de connexion et apparence

### Double authentification (2FA)

- Les rôles **privilégiés** ou marqués « 2FA obligatoire » (administrateur de structure, direction dans les rôles modèles) doivent configurer une application d'authentification (Google Authenticator, Microsoft Authenticator, FreeOTP, Aegis...) à leur première connexion : code QR ou clé manuelle, premier code, puis **10 codes de secours** à imprimer ou noter (ils ne sont affichés qu'une fois).
- Ensuite, chaque connexion demande le mot de passe puis le code à 6 chiffres. Un code de secours remplace le téléphone une seule fois.
- Les autres rôles peuvent l'activer eux-mêmes : menu utilisateur, « Mon compte et sécurité » (`/app/compte`). Le même écran régénère les codes de secours, désactive la 2FA (sauf si le rôle l'impose) et liste les sessions ouvertes pour les déconnecter.
- Le secret TOTP est chiffré en base (AES-256-GCM, clé dérivée de `MEDHUB_FIELD_MASTER_KEY` et de la structure). Un même code n'est jamais accepté deux fois.
- **Utilisateur qui a perdu téléphone et codes de secours** : un administrateur de la structure devra réinitialiser sa 2FA (écran de gestion des utilisateurs prévu en S5). En attendant, en développement seulement : `update user_account set mfa_secret_enc = null, mfa_enabled_at = null where username = '...'` dans la structure concernée.

### Limitation de débit et règles d'IP

- 30 tentatives de connexion par adresse et 10 par compte en 5 minutes, 8 vérifications de code par utilisateur en 5 minutes. Au-delà : réponse 429 avec `Retry-After`.
- Une adresse qui dépasse trois fois une limite est **bloquée automatiquement 15 minutes** (table `ip_rule`, origine `auto`) et un événement critique est écrit dans `security_event`.
- Règles manuelles : table `ip_rule` (adresse ou plage CIDR, `block`, `allow` ou `monitor`, portée `platform`, `admin` ou `tenant`, expiration). Une règle `allow` de portée `tenant` transforme les règles de la structure en liste blanche. L'écran du super-admin arrive avec SADM (J2) ; en attendant, insertion SQL. Les règles sont relues toutes les 60 secondes.
- Le worker purge chaque heure les compteurs de plus de 24 h (`security.purge_rate_limits`).

### Thème sombre

Sélecteur Système, Clair ou Sombre en haut des pages publiques et de la connexion, dans le menu utilisateur et dans « Mon compte ». Le choix est propre au poste (cookie `medhub_theme`) ; « Système » suit le réglage du téléphone ou de l'ordinateur.

## 11. Ce qui reste à faire et décisions attendues

Pour clore J0 :
- liste de contrôle cPanel sur l'hébergement réel et premier déploiement ;
- votre validation de la décision d'architecture et des écarts listés dans `docs/avancement.md`.

Décisions qui vous reviennent (marqueurs `TODO(medhub-decision)`) :
- grille tarifaire publique affichée sur la page d'accueil (valeurs indicatives de `docs/13-tarification.md` en attendant) ;
- fournisseurs SMS et paiement (adaptateurs `console` et `manual` en attendant).

## 12. Dépannage

| Symptôme | Cause probable | Solution |
| --- | --- | --- |
| `Variable d'environnement manquante` | `.env.local` absent ou incomplet | Section 3.4 |
| Les tests d'isolation échouent tous | Connexion avec un superutilisateur | Utiliser `medhub_app` dans `DATABASE_URL` et `TEST_DATABASE_URL` |
| `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` | Paquet publié depuis moins de 24 h | Épingler la version précédente |
| L'écran demande le PIN après chaque rechargement | Comportement voulu : les clés ne restent qu'en mémoire | Naviguer avec les liens de l'application |
| Indicateur rouge « Attention requise » | Rejets, conflits, horloge du poste en retard ou session expirée | Ouvrir `Diagnostic` ; se reconnecter si la session a expiré |
| Code PIN oublié | Le PIN ne peut pas être retrouvé | « Utiliser le code de récupération » sur l'écran verrouillé |
| Poste volé ou perdu | Données chiffrées sur le poste | Révocation d'appareil (écran prévu en S5) ; en attendant, « Mon compte », « Déconnecter les autres » |
| « Trop de tentatives » à la connexion | Limitation de débit atteinte | Patienter 5 minutes ; vérifier la table `ip_rule` si l'adresse a été bloquée automatiquement |
| Code 2FA toujours refusé | Heure du téléphone décalée de plus de 30 s | Activer l'heure automatique sur le téléphone, ou utiliser un code de secours |
| `Invalid environment configuration: MEDHUB_FIELD_MASTER_KEY` | Clé absente ou pas de 32 octets en base64 | `pnpm keys:generate` et copier la ligne dans `.env.local` |
