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
- début de J1 (S4) : double authentification TOTP avec codes de secours, limitation de débit en base, règles d'IP, politique CSP à nonce, écran « Mon compte » (2FA, sessions ouvertes, apparence), mesure de la durée des requêtes, organisation de la structure ;
- S5 (en cours) : appareils et effacement à distance, jetons signés, configuration versionnée, gestion des utilisateurs, éditeur de rôles, référentiels, traduction anglaise complète, diagnostic et base de formation (S5 terminée) ;
- S6 (terminée) : détection des doublons de patients (alerte à la saisie, file des doublons), fusion supervisée et réversible, identité complète avec historique et revue des conflits, recherche serveur, carte patient avec QR, patients provisoires, décès, sensibilité des dossiers, favoris et périmètre de synchronisation.
- S7 (terminée) : files d'attente et tickets, écran d'appel, triage, rendez-vous et agendas.
- S8 (terminée côté code) : allergies, antécédents, problèmes, journal des accès, constantes (plages normales, tendances, IMC, NEWS2), accès d'urgence, programmes chroniques, courbes de croissance OMS.
- S9 (terminée côté code) : consultation, note signée, diagnostics codés, formulaires cliniques, prescription avec alertes, ordonnance avec QR ; critère de sortie de J1 atteint en test automatisé (scénario P1).

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
| `MEDHUB_SIGNING_PUBLIC_KEY` | Clé publique correspondante, remise à chaque poste lors de son activation | généré |
| `MEDHUB_SIGNING_PREVIOUS_KEYS` | Anciennes clés publiques encore acceptées pendant une rotation, format `kid:base64,kid:base64` | vide |
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

`db:migrate` applique les migrations SQL, force la RLS sur toute table qui possède `tenant_id`, installe les triggers d'ajout seul et charge le catalogue des permissions. `db:seed` crée la structure fictive **Hôpital Pilote Démo**, les rôles modèles, le modèle de formulaire « Consultation générale » publié et un compte par rôle (section 3.6).

### 3.6 Comptes de test

Pour se connecter : **Accéder à ma structure**, puis le code de structure, l'identifiant et le mot de passe. Au premier passage sur un navigateur, le poste est activé (code PIN d'au moins 6 chiffres, nom du poste) ; le PIN sert ensuite à déverrouiller l'écran.

| Élément | Valeur |
| --- | --- |
| Code de structure | `HOP-DEM-0001` (Hôpital Pilote Démo, site `KIN`) |
| Mot de passe de tous les comptes | valeur de `MEDHUB_SEED_PASSWORD` dans votre `.env.local` (voir ci-dessous) |
| Base de formation | code `FOR-DEM-0001` une fois créée dans Paramètres, Base de formation ; mêmes comptes et mêmes mots de passe |

| Identifiant | Nom affiché | Rôle | Double authentification | Pour tester |
| --- | --- | --- | --- | --- |
| `admin` | Administrateur Démo | Administrateur de structure et Direction | Obligatoire (configurée à la première connexion) | Paramètres, utilisateurs, rôles, imports (diagnostics, médicaments), formulaires, sécurité, appareils |
| `direction` | Sagesse Direction | Direction | Obligatoire | Tableaux de bord et lecture des finances (au fil de J2) |
| `accueil` | Bienvenu Accueil | Accueil | Non | Enregistrement et recherche des patients, visites, tickets, rendez-vous |
| `infirmier` | Espérance Soins | Infirmier | Non | Files d'attente, appel, triage, constantes |
| `medecin` | Dr Dieudonné Kasongo | Médecin | Non | Consultation, note signée, diagnostics, formulaires, prescription (peut passer outre une alerte), décès, accès d'urgence |
| `laboratoire` | Tech. Fidèle Analyses | Technicien de laboratoire | Non | Laboratoire (S13) |
| `pharmacie` | Ph. Patience Lukusa | Pharmacien | Non | Pharmacie et stock (S12) |
| `caisse` | Héritier Mwamba | Caissier | Non | Facturation et caisse (S10 et S11) |

**Pourquoi le mot de passe n'est pas écrit ici** : ce guide est versionné et poussé sur GitHub ; la règle 12 de `CLAUDE.md` interdit tout secret dans le dépôt, et ces comptes ouvrent une vraie base de développement. Le mot de passe reste donc seulement dans `.env.local` (non versionné). Pour l'afficher sur votre poste :

```bash
grep MEDHUB_SEED_PASSWORD .env.local
```

Pour le changer : modifiez la ligne dans `.env.local`, puis relancez `pnpm db:seed` (il ne crée rien en double et applique le nouveau mot de passe à tous ces comptes).

Autres codes utiles :
- **Double authentification** des comptes `admin` et `direction` : à la première connexion, scannez le QR avec une application d'authentification et notez les 10 codes de secours. Téléphone perdu : un autre administrateur réinitialise la 2FA dans Paramètres, Utilisateurs.
- **Code PIN** : choisi par vous à l'activation de chaque poste ; oublié, utilisez le code de récupération affiché à l'activation, ou reconnectez-vous en ligne.
- **Structures de test** `TST-BNC-NNNN` : créées par `pnpm test:e2e` avec les mêmes identifiants et le même mot de passe.

## 4. Lancer l'application

```bash
pnpm dev
```

Ouvrez http://localhost:3000.

Parcours de démonstration :

1. Page publique : présentation, modules, avantages, tarifs indicatifs.
2. « Accéder à ma structure » : code `HOP-DEM-0001`, identifiant `accueil`, mot de passe `MEDHUB_SEED_PASSWORD` (tous les comptes : section 3.6).
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

### Paramètres de la structure

Menu **Paramètres** (permission `configuration:read`, administrateur de structure dans les rôles modèles), en ligne seulement :
- **Organisation** : nom usuel, raison sociale, langue et devise par défaut, fuseau horaire (Kinshasa ou Lubumbashi), contact, adresse, mentions légales des documents ; sites (code de 3 lettres définitif, nom, adresse, téléphone, désactivation, au moins un site actif) ; services de chaque site.
- **Journal de sécurité** (permission `audit:review`) : connexions inhabituelles (nouvel appareil, horaire inhabituel), tentatives excessives, adresses bloquées, activation ou désactivation de la 2FA.
- Toute modification demande une **preuve récente du second facteur** : si la dernière date de plus de 15 minutes, une fenêtre « Confirmez votre identité » demande un code, puis la modification est enregistrée. Chaque modification est tracée dans l'audit.

### Appareils, accès hors connexion et licence

- À l'activation, chaque poste reçoit deux **jetons signés** par la plateforme (Ed25519) : un jeton hors connexion valable **14 jours** et un jeton de licence. Ils sont renouvelés automatiquement, au plus une fois par heure, après une synchronisation réussie. Les clés de signature sont `MEDHUB_SIGNING_*` (`pnpm keys:generate`) : **obligatoires** pour activer un poste.
- Un poste qui n'a pas synchronisé depuis plus de 14 jours ne se déverrouille plus hors connexion : l'écran propose « Me connecter en ligne ». Les opérations en attente sont conservées et partent dès la reconnexion. Un bandeau prévient trois jours avant l'échéance.
- La licence reflète pour l'instant l'état de la structure (essai, actif, retard, lecture seule, suspendu) ; les plans et abonnements arrivent avec le super-admin (S14). Un bandeau signale le retard, la lecture seule ou la suspension ; l'accès d'urgence et l'export ne sont jamais bloqués.
- **Paramètres, Appareils** (permission `device:read`, action `device:revoke` avec confirmation du second facteur) : liste des postes, dernière synchronisation, version ; **Retirer** (poste remplacé, avec option « envoyer une dernière fois les opérations en attente ») ou **Déclarer perdu** (sessions fermées immédiatement). Au contact suivant avec le serveur, le poste **efface ses données locales** et la page de connexion explique pourquoi.

### Configuration versionnée (postes et sécurité)

**Paramètres, Postes et sécurité** (`/app/parametres/synchronisation`) : durée de l'accès hors connexion (14 jours par défaut, 1 à 30), verrouillage automatique (5 minutes), essais de code PIN (10), validité de la confirmation des changements sensibles (15 minutes), longueur minimale des mots de passe (10). Chaque changement est d'abord un **brouillon** (permission `configuration:edit`), puis une **publication** (`configuration:publish`) ; la version précédente est archivée et peut être restaurée en brouillon. Une version publiée n'est jamais modifiée (trigger PostgreSQL). Les postes reçoivent les valeurs publiées avec leurs jetons, à la synchronisation suivante.

### Utilisateurs

**Paramètres, Utilisateurs** (`/app/parametres/utilisateurs`, permission `user:read`), en ligne seulement. Toute modification demande la confirmation récente du second facteur.
- **Créer** un compte (`user:create`) : identifiant définitif (lettres minuscules, chiffres, point, tiret), nom, titre, numéro d'ordre, téléphone, courriel, site et service principaux, langue, au moins un rôle. Un **mot de passe temporaire** est affiché une seule fois : remettez-le en personne. À sa première connexion, l'utilisateur choisit son propre mot de passe.
- **Modifier** le profil et les rôles (`user:update`) : un rôle retiré garde son historique (date de fin), rien n'est supprimé.
- **Réinitialiser le mot de passe** (`user:reset_password`) : nouveau mot de passe temporaire, verrouillage levé, sessions fermées. **Déverrouiller** un compte bloqué après des échecs. **Réinitialiser la 2FA** (téléphone perdu, avec motif) : si le rôle l'impose, l'utilisateur configure un nouveau téléphone à sa prochaine connexion.
- **Désactiver** ou **réactiver** (`user:disable`, avec motif) : sessions fermées immédiatement ; chaque poste de l'utilisateur retire son accès hors connexion à sa synchronisation suivante, sans perdre les opérations en attente.
- Garde-fous : on n'agit jamais sur son propre compte depuis cet écran (« Mon compte » sert à cela) ; la structure garde toujours au moins un administrateur actif capable de gérer les rôles (`role:manage`) ; un compte sans rôle actif ne peut pas se connecter.
- **Politique de mot de passe** : 10 caractères au moins (réglable de 10 à 64 dans Postes et sécurité), refus des mots de passe courants (liste embarquée) et de ceux qui contiennent le nom ou l'identifiant, aucune règle de composition. Chacun peut changer son mot de passe dans « Mon compte » (ses autres sessions sont fermées).

### Rôles et permissions

**Paramètres, Rôles et permissions** (`/app/parametres/roles`, lecture `role:read`, modification `role:manage` avec confirmation du second facteur).
- Chaque rôle a une **grille** : une ligne par ressource (patients, constantes, factures, stock...), les actions permises en cases à cocher et un **périmètre** (toute la structure, son site, son service, ses propres éléments, magasins ou caisses assignés selon la ressource). Le bouclier marque les droits d'administration.
- Un rôle qui accorde un droit d'administration est **privilégié** : la double authentification y est toujours exigée. Pour les autres, la case « Double authentification obligatoire » reste au choix.
- **Dupliquer** un rôle (ou partir d'un rôle vide) pour créer une variante ; le code du rôle ne change plus ensuite. Un rôle copié d'un modèle MedHub indique ses différences avec le modèle et peut **revenir au modèle**.
- Les changements s'appliquent dès la requête suivante et, sur chaque poste, à la synchronisation suivante. Un changement qui laisserait la structure sans administrateur capable de gérer les rôles est refusé.

### Référentiels

**Paramètres, Référentiels** (`/app/parametres/referentiels`, lecture `configuration:read`, modification `configuration:edit` avec confirmation du second facteur).
- **Listes de choix** de la structure (mode d'arrivée, profession...) : code de liste définitif, nom en français et en anglais, éléments avec code, libellés et ordre. Un élément n'est jamais supprimé : il est désactivé, et son code ne change plus une fois enregistré.
- **Import CSV** : téléchargez le modèle (`code;libelle;libelle_en;ordre`), choisissez le fichier ou collez son contenu, puis **Vérifier le fichier** : chaque ligne fautive est signalée et rien n'est enregistré. Les lignes valides sont reprises dans la liste ; « Enregistrer la liste » les écrit.
- **Catalogues de la plateforme**, en lecture seule : devises (USD, CDF, ISO 4217), unités de mesure (codes UCUM), les 26 provinces (Constitution de 2006, codes ISO 3166-2:CD).
- Les territoires, villes et communes se chargent depuis un **fichier officiel**, par la plateforme : `pnpm db:import-areas fichier.csv --source="Document, date"` (colonnes `code;niveau;type;nom;code_parent`). Sans `--apply`, c'est une simulation qui ne fait que lister les erreurs.
- Chaque poste garde une **copie locale** des référentiels (sites, services, listes actives, provinces, devises, unités), vérifiée au plus toutes les dix minutes après une synchronisation, pour les formulaires hors connexion. Le champ « Province » des adresses propose désormais la liste des provinces.

### Langue de l'interface

- Français par défaut, anglais complet. Le sélecteur FR ou EN est en haut des pages publiques et de la connexion, dans le menu utilisateur et dans « Mon compte ».
- La langue d'un utilisateur est enregistrée sur son compte (champ « Langue » de l'écran Utilisateurs, ou sélecteur une fois connecté) : elle s'applique dès sa connexion, sur n'importe quel poste. Hors connexion, le poste garde le dernier choix.
- Aucun texte d'interface n'est écrit dans le code : tout est dans `apps/web/messages/fr.json` et `en.json`. Le test `apps/web/test/unit/messages.test.ts` refuse une clé absente d'une des deux langues, un message ICU invalide, des variables différentes entre les deux langues, un reste de français dans l'anglais et toute clé appelée par le code mais absente des fichiers.

### Diagnostic du poste

**Diagnostic** (menu utilisateur, `/app/diagnostic`), disponible hors connexion : opérations en attente, rejetées et en conflit, dernière synchronisation et dernière heure serveur, accès hors connexion (date d'expiration), licence, date de la copie des référentiels, état de l'horloge, version, stockage, réseau.
- **Forcer une synchronisation**, **Recharger les catalogues** (copie des référentiels téléchargée tout de suite).
- **Exporter le journal** : un fichier `.medhub-diag` chiffré pour le support MedHub, qui seul peut le lire. Il ne contient ni nom ni donnée médicale (compteurs, identifiants techniques, codes d'erreur). Il fonctionne hors connexion : le fichier peut être transmis par n'importe quel moyen.
- Côté plateforme : `pnpm keys:support` produit la paire de clés du support. La clé publique va dans l'environnement du serveur (`MEDHUB_SUPPORT_PUBLIC_KEY`) et parvient aux postes avec leurs jetons ; la clé privée reste sur le poste du support, qui ouvre un journal avec `MEDHUB_SUPPORT_PRIVATE_KEY=... pnpm support:decrypt fichier.medhub-diag`. Sans clé configurée, l'export l'explique et ne produit rien.

### Base de formation

**Paramètres, Base de formation** (`/app/parametres/formation`, lecture `configuration:read`, création et réinitialisation `configuration:publish` avec confirmation du second facteur).
- **Créer** : une structure d'entraînement est créée à côté de la vôtre, avec le code `FOR-` suivi de la fin de votre code (HOP-KIN-0042 donne FOR-KIN-0042). Elle reprend la configuration publiée, les sites et services, les rôles, les listes de choix et les comptes actifs (mêmes mots de passe et même double authentification), et contient 40 patients fictifs.
- Pour s'exercer, chacun se connecte avec ce code au lieu du code habituel. Le bandeau « Base de formation » reste affiché.
- **Réinitialiser** : la base actuelle est archivée (rien n'est supprimé), ses postes effacent leurs données de formation à leur prochain contact, et une nouvelle base est créée sous le même code avec la configuration du jour.
- Aucun SMS ni courriel réel ne doit partir d'une base de formation : règle à appliquer par le module de notifications quand il arrivera (aucun envoi n'existe aujourd'hui).

### Consultation (S9)

- Depuis la fiche, **Consulter** (rôles qui signent des notes, Médecin par défaut) ouvre `/app/consultation` ; sans patient choisi, la page liste les visites du jour ouvertes sur ce poste.
- À gauche : allergies en rouge, problèmes actifs, **Diagnostics** (recherche dans la liste de la structure, ou libellé libre avec code CIM-10 facultatif ; principal, suspecté ; « Corriger » remplace le diagnostic). Au centre : la **note** en cinq rubriques, enregistrée sur le poste toutes les 5 secondes (rien n'est perdu si la tablette s'éteint), puis **Signer la note**. Une note signée ne change plus : « Corriger » crée une nouvelle version avec un motif.
- La première note signée passe la visite « En consultation » ; **Terminer la visite** la clôt et termine le ticket en cours.
- Tout fonctionne hors connexion et part à la synchronisation suivante.

### Formulaires cliniques (S9)

- **Paramètres, Formulaires cliniques** (en ligne) : bibliothèque, **Nouveau formulaire** ou **Partir du modèle « Consultation générale »**, sections et champs (type, libellés français et anglais, obligatoire, « afficher si », « obligatoire si », unité, bornes, options une par ligne `code | libellé | libellé anglais`, constante liée, calcul). L'aperçu à droite fonctionne comme sur les postes, avec un patient d'exemple.
- Expressions : `value('poids') > 3`, `vital('weight') / pow(vital('height') / 100, 2)`, `ageYears() >= 18`, `sex() == 'F'`, `selected('signes', 'toux')`, `if(a, b, c)`, `round(x, 1)`. Rien d'autre n'est accepté (aucun accès aux propriétés, aucune fonction inconnue).
- **Enregistrer le brouillon**, puis **Publier** (second facteur) : une version publiée est figée, la modifier prépare la version suivante ; les anciennes saisies restent lisibles avec leur version. Export et import JSON.
- En consultation, carte **Formulaires** : choisir un formulaire publié pour l'étape, le remplir (brouillon sur le poste toutes les 5 secondes), **Enregistrer** ou **Signer**. Une constante saisie dans le formulaire est enregistrée dans les constantes, sans double saisie.

### Prescription et ordonnance (S9)

- **Paramètres, Clinique** : importer le **catalogue des médicaments** et les **règles d'interaction** (CSV, vérification puis import avec second facteur). MedHub ne fournit aucune liste : importez la liste nationale ou celle de votre structure. Sans catalogue, le médicament se saisit en texte libre (sans contrôle de dose ni d'interaction).
- En consultation, carte **Prescription** : **Ajouter une ligne**, choisir le médicament, la dose, la fréquence, la durée ; la quantité totale se calcule. Les alertes s'affichent aussitôt, hors connexion compris : allergie, même classe, interaction, dose maximale (par prise, par jour, par kilo), grossesse (case « Patiente enceinte »), âge, personne âgée, insuffisance rénale ou hépatique.
- Une alerte **bloquante** empêche de signer : changez de médicament ou de dose, ou, si votre rôle le permet (Médecin par défaut), écrivez une justification pour passer outre. **Signer l'ordonnance**, puis **Imprimer** : ordonnance A5 avec un QR et un code de vérification. **Annuler l'ordonnance** demande un motif.
- Carte **Traitements habituels** : ajouter ce que le patient prend déjà ; pour chacun, Continuer, Arrêter ou Modifier, puis **Enregistrer la réconciliation**.
- Vérification : le QR ouvre `/verifier?code=...` (ou tapez le code sur cette page). La page dit si l'ordonnance est authentique ou annulée, sa date et la structure, sans aucune donnée de santé.

### Allergies, antécédents et problèmes (S8)

- Rôles cliniques (lecture du dossier médical) : sous l'en-tête de la fiche, les **allergies en rouge** ; sinon « Aucune allergie connue (déclaré le ...) » ou « Allergies non renseignées ».
- Cartes **Allergies** (substance, catégorie, gravité, réaction, suspectée ou confirmée ; bouton « Aucune allergie connue »), **Problèmes actifs** (bouton « Résolu ») et **Antécédents** (catégorie, code CIM-10 facultatif, début). Tout fonctionne hors connexion ; deux postes qui ajoutent chacun un élément les gardent tous les deux.
- Rien ne s'efface : la croix **Retirer** demande un motif ; « Afficher les éléments retirés ou résolus » les montre barrés.

### Constantes : plages normales, tendances, IMC et NEWS2 (S8)

- La carte **Constantes et courbes** montre la dernière valeur de chaque constante, une flèche de tendance, et la marque « au-dessus de la normale » ou « sous la normale » lorsque la structure a réglé des plages normales. Elle affiche aussi l'IMC, la surface corporelle et, pour les adultes, le score **NEWS2** (marqué « partiel » tant que la conscience et l'oxygène ne sont pas saisis), avec une courbe pour n'importe quelle constante sur tout le dossier.
- **Paramètres, Clinique, Constantes** : bornes de plausibilité, marge de stabilité de la tendance et **plages normales par sexe et âge**. Aucune plage normale n'est fournie : ce sont des références cliniques que la structure choisit.

### Accès d'urgence (bris de glace) (S8)

- Un dossier au-dessus de votre niveau s'affiche « Dossier protégé ». Si votre rôle le permet (Médecin par défaut), choisissez le motif, précisez-le, puis **Ouvrir l'accès d'urgence** : le dossier s'ouvre pour 4 heures (réglage `security.break_glass_hours`), même hors connexion, avec un bandeau rouge rappelant l'heure de fin.
- Depuis la recherche « Sur le serveur », un dossier protégé propose aussi **Accès d'urgence**.
- Chaque accès est journalisé, signalé dans le journal de sécurité et doit être revu : **Paramètres, Sécurité, Accès d'urgence à revoir** (« Justifié » ou « À examiner », avec commentaire).
- La carte **Journal des accès** de la fiche (rôles d'audit) montre qui a ouvert le dossier, quand et depuis quel poste.

### Programmes chroniques (S8)

- **Paramètres, Clinique, Programmes chroniques** : nom, intervalle de suivi et délai de grâce (14 jours par défaut).
- Sur la fiche, carte **Programmes chroniques** : inscription, sortie avec motif, date du prochain suivi attendu ou « perdu de vue ».
- **Programmes chroniques** (menu Clinique, en ligne) : la liste d'appels de l'équipe, les perdus de vue en tête, avec le téléphone.

### Courbes de croissance OMS (S8)

- Pour un patient de moins de 19 ans, la carte **Croissance (OMS)** donne les Z-scores et percentiles (poids, taille, poids pour la taille, IMC, périmètre crânien), les alertes (émaciation, retard de croissance, insuffisance pondérale, périmètre brachial sous 115 ou 125 mm) et la courbe de l'enfant entre les lignes de l'OMS. Calcul sur le poste, hors connexion compris.
- Sources : standards de croissance de l'OMS (2006) et référence OMS (2007), tables officielles téléchargées le 05/11/2026.

### Accueil, files et agendas : réglages (S7)

- **Paramètres, Accueil, files et agendas** (en ligne, double authentification récente) :
  - **Files d'attente** : une par point de passage (accueil, triage, consultation...), avec un préfixe de ticket d'une à trois lettres et, au besoin, le service rattaché.
  - **Types de rendez-vous** : durée proposée à la prise de rendez-vous.
  - **Agendas** : pour chaque soignant ou service, les plages de la semaine (début, fin, durée d'un créneau, surréservation permise) et les exceptions (jour ou heures fermés, plage supplémentaire).
- Les postes reçoivent ces réglages avec leurs catalogues, à la connexion suivante ou par **Diagnostic, Recharger les catalogues**.

### Arrivée d'un patient et files d'attente (S7)

- Sur la fiche patient, carte **Arrivée** : type de visite, file, priorité, puis **Créer la visite et le ticket**. Le numéro affiché (par exemple `A-AB-001`) est formé du préfixe de la file, du code du poste et d'un compteur du jour : deux postes ne donnent jamais le même numéro, même hors connexion. Une urgence passe toujours en tête.
- **Files d'attente** (menu Clinique) : choisissez la file et la salle de ce poste. Ordre de passage : urgences, puis personnes âgées, femmes enceintes et enfants, puis heure d'arrivée. Boutons **Appeler**, **Prendre en charge**, **Terminer**, **Parti** (le ticket n'est jamais supprimé).
- Si deux postes appellent le même ticket hors connexion, le premier appel arrivé au serveur est gardé ; l'autre poste se met à jour à la synchronisation.
- **Écran d'appel** : bouton du même nom, à ouvrir sur une télévision ou une tablette de la salle d'attente. Il affiche les numéros appelés et la salle, jamais un nom. **Activer le son** et **Plein écran** se règlent sur l'écran ; il se relit toutes les cinq secondes et se synchronise régulièrement.

### Triage (S7)

- Sur la fiche, carte **Triage de la visite du jour** (rôle infirmier) : motif principal, priorité, observations et **Orienter vers** une autre file. L'orientation termine le ticket en cours et donne au patient un ticket dans la file choisie, avec la priorité du triage.
- Les constantes saisies sur la fiche pendant la visite y sont rattachées. Une correction du triage crée une nouvelle version ; l'ancienne reste lisible.

### Rendez-vous (S7)

- **Rendez-vous** (menu Clinique) : choisissez l'agenda et le jour, ou **Premier créneau libre**. Depuis une fiche patient, **Prendre rendez-vous** ouvre l'agenda avec le patient déjà choisi. Fonctionne hors connexion.
- Sur un rendez-vous : **Arrivé** (crée aussi la visite et le ticket), **Déplacer** (puis choisir le nouveau créneau), **Absent** (après l'heure), **Annuler** (motif obligatoire).
- Si deux postes prennent le même créneau hors connexion, le premier arrivé au serveur le garde ; l'autre poste affiche « Créneaux pris entre-temps sur un autre poste » avec **Choisir un autre créneau**. La surréservation réglée sur l'agenda permet d'ajouter des rendez-vous au même créneau.
- La fiche patient montre les prochains rendez-vous et le nombre de rendez-vous manqués.
- Avec la règle de synchronisation « Périmètre », un patient qui a un rendez-vous dans les sept jours ou une visite récente arrive sur les postes.
- Les rappels par SMS attendent le choix d'un fournisseur (point ouvert).

### Patients provisoires (S6)

- Dans le formulaire d'enregistrement, choisissez **Inconnu** (urgence non identifiée : sexe et âge apparent) ou **Nouveau-né** (nom de la mère, date de naissance du jour). Le dossier reçoit un nom descriptif, par exemple « Inconnu homme 30 ans environ, arrivé le 14/03 22:15 » ou « Nouveau-né de MBUYI Grâce », et le badge **Provisoire**. Cela fonctionne hors connexion.
- Dès que l'identité est connue : sur la fiche, **Identifier le patient** (carte Identité), saisissez les noms, laissez cochée « Identité confirmée » et enregistrez. La recherche de doublons s'applique alors au dossier.
- Si la personne avait déjà un dossier : dans le bandeau « Dossier provisoire », recherchez ce dossier et cliquez **C'est la même personne** (en ligne). La paire arrive dans la file des doublons, où un utilisateur habilité fusionne les deux dossiers.

### Décès (S6)

- Permission dédiée `patient:mark_deceased` (rôle modèle Médecin et administrateur). Sur la fiche, **Déclarer le décès**, date et heure, **Confirmer le décès** ; fonctionne hors connexion.
- Ensuite, le dossier refuse tout nouvel acte clinique daté après le décès, sur le poste comme sur le serveur (un autre poste qui ne le savait pas encore voit son envoi refusé avec le motif « Patient décédé »). Une mesure antérieure peut encore être saisie ou corrigée.
- Une déclaration faite par erreur se retire avec un motif (**Annuler la déclaration de décès**) ; les deux restent dans l'historique.

### Sensibilité des dossiers (S6)

- Permission `patient:mark_sensitive`. Sur la fiche, **Sensibilité du dossier** : Normal, Membre du personnel, Personnalité, Accès restreint, avec un motif.
- Un dossier sensible n'est ouvert qu'aux rôles dont le niveau le permet. Réglage dans **Paramètres, Rôles**, champ « Dossiers sensibles accessibles ». Par défaut, un rôle n'ouvre que les dossiers normaux, sauf s'il peut lui-même marquer la sensibilité (il les ouvre alors tous).
- Depuis S8 (décision du 02/11/2026), le dossier reste sur les postes, chiffré, mais **verrouillé** pour les utilisateurs qui n'ont pas le niveau : la fiche affiche « Dossier protégé » et son numéro seulement, les listes, files et agendas masquent le nom. L'ouverture passe par l'**accès d'urgence** (voir plus bas), qui fonctionne hors connexion. La recherche serveur montre le dossier masqué.

### Favoris et patients gardés sur les postes (S6)

- L'étoile **Ajouter aux favoris** de la fiche est personnelle et fonctionne hors connexion ; le bouton **Mes favoris** de l'écran Patients filtre la liste.
- **Paramètres, Postes et synchronisation, Patients gardés sur les postes** : règle de la structure et, au besoin, règle par rôle. **Toute la structure** (par défaut) convient aux petites structures. **Périmètre** garde sur le poste les patients enregistrés sur ce poste, les favoris de l'utilisateur, les patients ouverts depuis la section « Sur le serveur » et ceux qui ont eu une activité récente (nombre de jours réglable) ; les autres restent accessibles par la recherche en ligne.
- Un patient qui sort du périmètre disparaît du poste à la synchronisation suivante ; un patient qui y entre arrive avec tout son dossier.

### Carte patient (S6)

- Sur la fiche, **Imprimer la carte** produit un PDF au format carte bancaire (85,6 x 54 mm), même hors connexion : nom de la structure, nom, numéro de dossier, sexe, naissance et un **code QR**. Le QR contient un jeton opaque (`MHC1-` suivi de 20 caractères tirés au hasard), jamais le nom ni le numéro de dossier.
- La première impression attribue le jeton au patient ; il se synchronise comme les autres champs d'identité. **Carte perdue** imprime une nouvelle carte avec un nouveau jeton : l'ancienne ne retrouve plus le patient.
- Pour retrouver un patient, scannez sa carte avec une douchette (elle tape le jeton dans le champ de recherche de l'écran Patients) ou saisissez le jeton : la fiche s'ouvre directement. En ligne, le serveur retrouve aussi un patient absent du poste par son jeton.

### Recherche de patients sur le serveur (S6)

- La recherche de l'écran **Patients** fonctionne d'abord sur le poste, même hors connexion. En ligne, une section **Sur le serveur** ajoute les patients de la structure absents de ce poste (badge « Hors de ce poste ») ; **Ouvrir sur ce poste** copie le dossier sur le poste, qui l'ouvre ensuite même sans réseau.
- On peut taper un nom (orthographe approximative tolérée), un téléphone (« 0991234567 » ou « +243 991 234 567 »), un numéro de dossier, le nom du père ou de la mère, et ajouter une année de naissance (« Kabila 1990 »).
- Le serveur utilise `pg_trgm` s'il est installé (index créé par `pnpm db:migrate`, qui l'annonce) ; sinon, une recherche par mots et par prononciation. `MEDHUB_SEARCH_TRIGRAM=off` force ce repli.

### Identité complète et historique (S6)

- Sur la fiche patient, **Compléter ou corriger** (même hors connexion) : noms, sexe, naissance (date ou estimée), téléphone, adresse (province choisie dans la liste), profession, état civil, nationalité, langue parlée, noms du père et de la mère, personne à contacter. Seuls les champs modifiés partent au serveur, fusionnés champ par champ : deux postes qui changent des champs différents gardent tous les deux leur modification (scénario P2).
- Si deux postes changent hors connexion la même date de naissance, le même nom ou le même sexe, la valeur arrivée la première est gardée et l'autre devient un **conflit à revoir**, en tête de **Patients, Doublons et conflits** (`patient:merge`) : « Garder la valeur en vigueur » ou « Appliquer la valeur envoyée », avec motif.
- **Historique des modifications** (en ligne, sur la fiche) : chaque changement d'identité, champ par champ, avec l'ancienne et la nouvelle valeur, l'auteur, le poste et l'origine (synchronisation, fusion, revue). Chaque consultation est tracée.

### Doublons de patients (S6)

- **À l'enregistrement**, même hors connexion : avant de créer un dossier, le poste cherche dans sa base locale les patients qui ressemblent (nom, prononciation, date ou année de naissance, téléphone). S'il en trouve, il les montre avec « Ouvrir ce dossier » ; le bouton devient « Ce n'est aucun d'eux : enregistrer ».
- **Après la synchronisation**, le serveur compare chaque nouveau dossier à ses voisins (tâche de fond `pat.detect_duplicates`, exécutée par le cron) et range les paires ressemblantes dans **Patients, Doublons** (`/app/patients/doublons`, permission `patient:merge`, en ligne seulement) : comparaison côte à côte, différences surlignées, « Pas la même personne » avec motif, ou **Fusionner**.
- **Fusionner** (en ligne, `patient:merge`, motif obligatoire) : choix du dossier conservé (le plus ancien par défaut) et, pour chaque information qui diffère, de la valeur à garder (une valeur vide prend celle de l'autre dossier). L'autre dossier n'est pas effacé : il renvoie vers le dossier conservé, ses constantes et actes y restent rattachés et s'affichent sur la fiche conservée. Les postes reçoivent la fusion à la synchronisation suivante ; l'ancienne fiche ouvre la fiche conservée.
- **Fusions récentes**, sous la file : « Annuler la fusion » (motif) sépare à nouveau les dossiers et rend au dossier conservé ses anciennes valeurs, sauf celles modifiées depuis ; la paire revient dans la file.
- Seuils réglables dans **Paramètres, Postes et sécurité** : alerte à la saisie (50 par défaut) et candidat de fusion (60).

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
| « L'accès hors connexion de ce poste a expiré » | Plus de 14 jours sans synchronisation | Se connecter en ligne : le jeton est renouvelé, rien n'est perdu |
| Activation d'un poste impossible (`SIGNING_KEY_MISSING`) | Clés `MEDHUB_SIGNING_*` absentes | `pnpm keys:generate` et copier les trois lignes dans `.env.local` (ou dans cPanel) |
| « Trop de tentatives » à la connexion | Limitation de débit atteinte | Patienter 5 minutes ; vérifier la table `ip_rule` si l'adresse a été bloquée automatiquement |
| Code 2FA toujours refusé | Heure du téléphone décalée de plus de 30 s | Activer l'heure automatique sur le téléphone, ou utiliser un code de secours |
| `Invalid environment configuration: MEDHUB_FIELD_MASTER_KEY` | Clé absente ou pas de 32 octets en base64 | `pnpm keys:generate` et copier la ligne dans `.env.local` |
