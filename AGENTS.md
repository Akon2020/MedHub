# CLAUDE.md : MedHub

Ce fichier est lu par Claude Code au début de chaque session. Il fixe les règles non négociables, la pile technique, l'organisation du code et l'ordre de travail. Le détail fonctionnel et technique se trouve dans `docs/`. **Avant de toucher à un module, lire le document qui le décrit.**

Ordre de priorité en cas de contradiction : `CLAUDE.md` > `docs/00-cadrage.md` > documents transverses (`docs/01` à `docs/13`) > documents de module (`docs/modules/*`). Toute contradiction repérée est signalée dans `docs/avancement.md` et au porteur du projet.

---

## 1. Le projet en bref

MedHub est un système d'information de santé (HIMS) web, multi-structures (multi-tenant), vendu en SaaS et conçu **local-first** : chaque poste continue de fonctionner sans connexion et se synchronise quand le réseau revient.

- **Cibles** : toute structure sanitaire, publique ou privée : pharmacie, dispensaire ou centre de santé, cabinet médical, laboratoire, centre d'imagerie, clinique, hôpital, réseau multi-sites.
- **Inspiration** : Open Clinic GA, dont MedHub reprend la couverture fonctionnelle (administratif et financier, paramédical et technique, médical) en corrigeant ses limites : interface datée, serveur local lourd, facturation rigide, absence de dossier partagé entre structures, absence de gestion d'abonnement.
- **Marché initial** : République démocratique du Congo. Français par défaut, anglais en seconde langue. Devises USD et CDF.
- **Équipe** : un développeur unique (le porteur du projet), assisté par Claude Code.
- **Hébergement v1** : cPanel (Node.js via Passenger, PostgreSQL). Migration vers VPS et Docker prévue sans réécriture.
- **Pilote** : un hôpital de 15 à 20 membres du personnel, parc mixte (PC, ordinateurs de bureau, tablettes, smartphones), électricité stable, connexion passable.
- **Phases** : MVP (pilote, environ 18 semaines), Phase 2, Phase 3. Les trois sont décrites en détail dans `docs/`. Elles se construisent **dans l'ordre** (voir section 8).

---

## 2. Règles non négociables

Relire cette liste avant chaque tâche. Une implémentation qui en viole une est refusée, même si elle « marche ».

1. **Offline d'abord.** Les fonctions critiques (enregistrement patient, file d'attente, triage, consultation, prescription, caisse, dispensation, saisie et validation de résultats de laboratoire) fonctionnent sans réseau. Les écrans opérationnels lisent la base locale (IndexedDB via Dexie) et écrivent des **commandes** dans le journal local (outbox). Aucun appel réseau bloquant dans ces écrans.
2. **Aucune perte, aucun doublon.** Chaque opération porte un `opId` UUID v7. Le serveur applique chaque opération de façon idempotente (contrainte d'unicité sur `op_log.op_id`).
3. **Dossier médical en ajout seul.** Jamais d'`UPDATE` destructif ni de `DELETE` sur une donnée clinique. Une correction crée une nouvelle version ; l'ancienne reste lisible.
4. **Finances immuables.** Factures, lignes, paiements, mouvements de caisse et de stock ne sont jamais modifiés ni supprimés. Toute correction passe par une écriture inverse (avoir, mouvement contraire).
5. **Stock = somme des mouvements.** Aucun champ de solde modifiable. Le solde est calculé (ou matérialisé par une vue ou une table de cache recalculable).
6. **Argent en entiers.** Montants en unités mineures (`bigint`) avec code devise ISO 4217. Jamais de `float`/`double` pour l'argent. Taux de change en `numeric(18,6)`.
7. **Isolation des structures.** Colonne `tenant_id` sur chaque table métier, Row Level Security PostgreSQL **activée et forcée** (`FORCE ROW LEVEL SECURITY`). Le `tenant_id` vient toujours de la session signée, jamais d'un paramètre envoyé par le client. Toute requête métier passe par `withTenant()`.
8. **Configurer avant de coder.** Ce qui varie d'une structure à l'autre (rôles, permissions, formulaires, tarifs, conventions, documents imprimés, messages, workflows, numérotation, constantes) est une **donnée de configuration**, jamais du code. Aucune logique propre à un client dans le code.
9. **L'urgence et l'export ne sont jamais bloqués.** Ni la licence, ni un impayé, ni une suspension n'empêchent l'accès d'urgence (bris de glace) au dossier d'un patient ni l'export des données d'une structure. Aucune suppression automatique de données.
10. **Tout est tracé.** Chaque écriture, et chaque lecture d'un dossier médical, est journalisée dans un journal d'audit chaîné par hachage.
11. **Compatible cPanel.** Pas de WebSocket, pas de Server-Sent Events longue durée, pas de processus permanent, pas de Redis ni de file de messages externe. Tâches de fond = table `job` + cron toutes les minutes. Requêtes HTTP courtes (moins de 25 s).
12. **Secrets et données de santé.** Aucun secret dans le dépôt. Aucune donnée de santé ni donnée personnelle en clair dans les journaux applicatifs ou les rapports d'erreur.
13. **Ne jamais inventer une donnée métier externe.** Prix, mentions légales et fiscales, fournisseurs SMS et paiement, listes nationales (médicaments, actes), taux de change : ce sont des valeurs de configuration ou de données de référence. Utiliser une valeur par défaut documentée ou un marqueur `TODO(medhub-decision): ...` et l'ajouter à la liste de `docs/avancement.md`.
14. **Une règle métier s'écrit une fois.** Validations et calculs métier vivent dans les paquets partagés et s'exécutent à l'identique sur le client et sur le serveur.
15. **Pas de double saisie.** Une information saisie une fois (constante, prescription, acte) alimente automatiquement les étapes suivantes (facture, stock, rapports).
16. **Un commit claire chaque fois qu'on le peut.** Lors du développement, nous travaillerons sur la branche `develop` pour permettre à la `main`. Le commit doit porter une référence des modifications qui ont été faite (feat:ajout d'une ..., chore:message, etc.)
17. **Pas de trace de Claude encore moi d'Antropuic dans les commit.** Une information saisie une fois (constante, prescription, acte) alimente automatiquement les étapes suivantes (facture, stock, rapports).

---

## 3. Pile technique

| Domaine | Choix |
| --- | --- |
| Langage | TypeScript partout, mode `strict` et `noUncheckedIndexedAccess`. Interdiction de `any` (utiliser `unknown` puis valider). |
| Runtime | Node.js 22 LTS (20 en repli si l'hébergeur l'impose). |
| Monorepo | pnpm workspaces, Turborepo pour orchestrer `build`, `test`, `lint`, `typecheck`. |
| Application | Next.js (App Router) et React, **une seule application** `apps/web` qui sert l'interface et l'API REST (Route Handlers). Build `output: 'standalone'`. |
| Interface | Tailwind CSS et shadcn/ui (composants copiés dans `apps/web/src/components/ui`), icônes `lucide-react`, graphiques Recharts (via les composants chart de shadcn). |
| Formulaires | React Hook Form et Zod (`@hookform/resolvers`). |
| Validation et contrat | Zod, schémas partagés client et serveur. Documentation OpenAPI générée depuis les schémas Zod. |
| Base de données | PostgreSQL 14 ou plus. Extensions `pg_trgm` et `unaccent` si l'hébergeur les fournit (sinon repli applicatif, voir `docs/01-architecture.md`). Pool `pg` de 5 à 10 connexions. |
| ORM | Drizzle ORM et drizzle-kit. Migrations SQL générées, relues et versionnées dans le dépôt. Jamais de `drizzle-kit push` hors poste de développement. |
| Base locale | IndexedDB via Dexie et `dexie-react-hooks` (`useLiveQuery`). Chiffrement WebCrypto AES-GCM. |
| PWA | Serwist (service worker, précache, mises à jour contrôlées). |
| Identifiants | UUID v7 (paquet `uuid`), générés côté client ou serveur. |
| Cryptographie | Argon2id via `@node-rs/argon2` (repli `bcryptjs`), TOTP via `otplib`, signatures Ed25519 via `@noble/curves` (licences, jetons hors connexion, signature des opérations d'appareil). |
| i18n | `next-intl`. Locale `fr` par défaut, `en` en seconde langue. Aucune chaîne d'interface en dur. |
| Dates | `date-fns` et `date-fns-tz`. Stockage en UTC, affichage dans le fuseau du site (`Africa/Kinshasa` ou `Africa/Lubumbashi`). |
| PDF et impression | Génération côté client avec `@react-pdf/renderer`, chargé à la demande (import dynamique), pour imprimer hors connexion. Formats A4, A5, ticket 80 mm. |
| Courriel | Nodemailer (SMTP). |
| SMS, paiement | Adaptateurs derrière une interface (`SmsProvider`, `PaymentProvider`). Fournisseurs non choisis : voir `docs/00-cadrage.md`. |
| Journaux | `pino` (JSON structuré), rotation, identifiant de corrélation par requête. |
| Observabilité | Interface interne `Telemetry` (erreurs, métriques, événements de sécurité) avec un adaptateur interne par défaut (table `error_event`) et un emplacement prévu pour un adaptateur Batela (outil de monitoring maison du porteur du projet). |
| Tests | Vitest (unitaires et intégration), fast-check (propriétés), Playwright (bout en bout avec simulation hors connexion), k6 (charge). |
| Qualité | ESLint (config Next.js et règle de frontières entre modules), Prettier, `tsc --noEmit`. |
| CI | GitHub Actions : typecheck, lint, tests, build, archive de déploiement. |

Règles sur les dépendances :
- Prendre la dernière version stable de chaque dépendance au moment de l'initialisation et l'épingler.
- Refuser toute dépendance incompatible avec cPanel (binaire natif sans version précompilée, processus permanent, besoin de WebSocket).
- Toute nouvelle dépendance de plus de 50 ko compressés côté client est justifiée dans `docs/avancement.md` (budget de 1,5 Mo compressé pour l'application mise en cache).

---

## 4. Organisation du dépôt

```
medhub/
├── CLAUDE.md
├── docs/                         Spécifications détaillées (lire avant de coder)
├── apps/
│   ├── web/                      Next.js : interface + API REST
│   │   ├── messages/             fr.json, en.json
│   │   └── src/
│   │       ├── app/
│   │       │   ├── (public)/     Pages publiques (RSC)
│   │       │   ├── connexion/    Connexion, code de structure, 2FA, PIN
│   │       │   ├── app/          Application des structures (écrans client, offline)
│   │       │   ├── admin/        Portail super-admin (en ligne seulement, RSC autorisés)
│   │       │   └── api/
│   │       │       ├── v1/       Route Handlers REST versionnés
│   │       │       └── health/   Sonde de santé
│   │       ├── client/           Moteur offline navigateur : démarrage, boucle de sync, verrou PIN, état réseau
│   │       ├── features/<module>/ Composants et hooks d'interface par module
│   │       ├── components/ui/    Composants shadcn
│   │       ├── server/
│   │       │   ├── platform/     Résolution de structure, auth, sessions, audit, jobs, telemetry, stockage de fichiers
│   │       │   └── modules/<module>/  service.ts, repository.ts, routes.ts, permissions.ts, jobs.ts, index.ts
│   │       └── sw.ts             Service worker (Serwist)
│   └── worker/                   Script Node lancé par cron (tick de la file de jobs), bundle unique via tsup
├── packages/
│   ├── db/                       Schéma Drizzle, migrations SQL, politiques RLS, withTenant, withPlatformScope, seeds
│   ├── shared/                   Types communs, argent, dates, UUID v7, HLC, codes d'erreur, schémas Zod communs
│   ├── domain/                   Règles métier pures et isomorphes, un dossier par module (commandes, validations, calculs)
│   ├── sync/                     Protocole (types d'opération, push, pull, bootstrap), moteur client, application serveur
│   ├── local-db/                 Schéma Dexie, migrations locales, chiffrement, index de recherche hachés
│   ├── conventions/              Moteur de règles de conventions (pur, déterministe, versionné)
│   ├── forms/                    Schéma de formulaires, évaluateur d'expressions sûr, moteur de rendu sans interface
│   └── config/                   tsconfig, ESLint, Prettier partagés
├── infra/
│   ├── cpanel/                   Scripts de déploiement, cron, liste de contrôle, modèle .htaccess
│   └── docker/                   docker-compose de développement (PostgreSQL), futur déploiement VPS
└── .github/workflows/
```

Règles de frontières (vérifiées par ESLint) :
- `packages/shared`, `domain`, `conventions`, `forms` : aucune dépendance vers Next.js, Node.js (fs, crypto Node), Dexie ou le DOM. Code pur, testable en isolation.
- `server/modules/A` n'importe de `server/modules/B` que son `index.ts` public.
- Rien sous `src/app/app/**` ni `src/features/**` n'importe `src/server/**`.
- `withPlatformScope()` n'est importable que depuis `server/platform` et `server/modules/sadm`.
- `packages/local-db` et `src/client` ne sont jamais importés par du code serveur.

---

## 5. Commandes

Ces scripts sont créés à l'initialisation (S1) et maintenus. Toujours les utiliser plutôt que des commandes ad hoc.

| Commande | Rôle |
| --- | --- |
| `pnpm install` | Installe les dépendances. |
| `pnpm dev` | Lance PostgreSQL local (docker compose) si absent, puis Next.js en développement. |
| `pnpm build` | Build de production (Next.js standalone et worker). |
| `pnpm typecheck` | `tsc --noEmit` sur tout le monorepo. |
| `pnpm lint` | ESLint et Prettier en vérification. |
| `pnpm test` | Tests unitaires et d'intégration (Vitest). |
| `pnpm test:props` | Tests de propriétés de la synchronisation (fast-check). |
| `pnpm test:e2e` | Playwright, dont les scénarios hors connexion. |
| `pnpm db:generate` | Génère une migration SQL depuis le schéma Drizzle. |
| `pnpm db:migrate` | Applique les migrations (script contrôlé, sauvegarde préalable en production). |
| `pnpm db:seed` | Charge les données de référence et une structure de démonstration. |
| `pnpm db:test-isolation` | Exécute la suite qui tente des lectures et écritures croisées entre structures. |
| `pnpm worker:tick` | Exécute une passe de la file de jobs (ce que fait le cron en production). |
| `pnpm release` | Construit l'archive versionnée à déployer sur cPanel. |

Avant de déclarer une tâche terminée : `pnpm typecheck && pnpm lint && pnpm test` doivent passer. Si la tâche touche la synchronisation : `pnpm test:props` aussi. Si elle touche une table métier : `pnpm db:test-isolation` aussi.

---

## 6. Conventions de code

- **Langues** : code, identifiants, noms de tables et de colonnes, messages de commit et commentaires de code en **anglais**. Interface, documentation et messages à l'utilisateur en **français** (fichiers de messages, anglais en second).
- **Nommage** : tables PostgreSQL en `snake_case` au singulier (`patient`, `invoice_line`) ; fichiers en `kebab-case` ; composants React en `PascalCase` ; paquets internes sous le préfixe `@medhub/` (`@medhub/db`, `@medhub/domain`...).
- **Commandes métier** : nommées `<entité>.<verbe>` en anglais (`patient.register`, `vital_sign.record`, `prescription.create`, `invoice.add_line`, `cash_session.close`). Chaque commande a un schéma Zod de charge utile, une fonction d'application locale et une fonction d'application serveur (voir `docs/02-offline-sync.md`).
- **Erreurs** : codes stables en majuscules préfixés par le module (`PAT_DUPLICATE_SUSPECTED`, `FACT_DISCOUNT_REQUIRES_APPROVAL`). Le message affiché est traduit côté interface à partir du code.
- **Colonnes communes** sur chaque table métier synchronisée : `id`, `tenant_id`, `site_id` (si pertinent), `created_at`, `created_by`, `updated_at`, `updated_by`, `version`, `device_id`, `hlc`, `deleted_at`. Détail dans `docs/04-modele-donnees.md`.
- **Nouvelle table métier** = colonne `tenant_id`, RLS activée et forcée, politique `tenant_isolation`, index composites commençant par `tenant_id`, test d'isolation ajouté.
- **Pas de logique métier dans les composants React ni dans les Route Handlers.** Elle vit dans `packages/domain` (règles pures) et `server/modules/*/service.ts` (orchestration serveur).
- **Accès aux données serveur** uniquement via les `repository.ts` des modules, eux-mêmes appelés dans `withTenant()`.
- **Commits** au format Conventional Commits (`feat(pat): ...`, `fix(sync): ...`). Petites modifications cohérentes.
- **Pas de commentaire superflu.** Un commentaire explique un « pourquoi », jamais un « quoi ».

---

## 7. Deux familles d'écrans

| Famille | Exemples | Rendu | Données | Hors connexion |
| --- | --- | --- | --- | --- |
| Opérationnels | Accueil, file, triage, consultation, résumé patient, prescription, caisse, dispensation, laboratoire, stock courant | Composants client (`'use client'`), sous `/app` | Lecture Dexie (`useLiveQuery`), écriture par `dispatch(command)` vers l'outbox | Oui, complet |
| En ligne seulement | Connexion, super-admin, configuration, création d'utilisateurs, imports massifs, fusion de patients, partage inter-structures, paiement d'abonnement | RSC autorisés, sous `/connexion`, `/admin`, et écrans de configuration sous `/app/parametres` | API REST `/api/v1` ou appel direct des services en RSC | Non : message explicite et, si utile, dernière copie synchronisée avec sa date |

Un indicateur d'état permanent est visible dans l'application : connecté, hors connexion, synchronisation en cours, attention requise (voir `docs/07-ui-ux.md`).

---

## 8. Ordre de travail

Le détail semaine par semaine, les livrables et les critères de sortie sont dans `docs/11-feuille-de-route.md`. Résumé :

| Jalon | Semaines | Contenu | Critère de sortie |
| --- | --- | --- | --- |
| J0 Fondations | S1 à S3 | Initialisation du monorepo, test de l'hébergement, schéma de base, **prototype de synchronisation** | 500 opérations sur deux postes avec coupures aléatoires : zéro perte, zéro doublon |
| J1 Plateforme et clinique | S4 à S9 | Auth, structures, RLS, rôles, audit, PWA, appareils, licence, configuration, patients, rendez-vous et files, dossier longitudinal, consultation, formulaires, prescription | Accueil, triage et consultation d'un patient sans réseau, puis synchronisation sans erreur |
| J2 Finances et services | S10 à S14 | Tarification, facturation, caisse, conventions (modèles A à D), pharmacie et stock, laboratoire, super-admin, abonnements, portail client | Parcours complet jusqu'à la facture et la dispensation ; un abonnement facturé, payé, puis suspendu selon le cycle |
| J3 Pilote | S15 à S18 | Sécurité, sauvegardes, supervision, tests de charge et de coupure, formation, import, mise en service | Indicateurs du pilote atteints (`docs/11-feuille-de-route.md`) |
| Phase 2 | Après le pilote | Hospitalisation, maternité, imagerie, vaccination, portail patient, partage inter-structures, mobile money, santé publique et DHIS-2, personnel et gardes, analytique avancée | Voir chaque module |
| Phase 3 | Après la phase 2 | Sous-domaines et marque blanche, on-premise et hybride, FHIR complet, aide à la décision avancée, applications natives, lingala et swahili, biométrie, équipements, repas, ambulance | Voir `docs/modules/phase-3.md` |

Règles de séquencement :
- **Ne jamais commencer un jalon avant que le critère de sortie du précédent soit atteint**, sauf instruction explicite du porteur du projet.
- **Ne pas implémenter un module de phase 2 ou 3 pendant le MVP.** En revanche, l'architecture du MVP doit déjà prévoir leurs points d'accroche (identité patient globale, colonne `person_global_id`, interfaces de paiement, de stockage, de messagerie, résolution de structure par nom d'hôte). Chaque document de module indique ces points d'accroche.
- Si le prototype de synchronisation échoue en S3, s'arrêter et présenter le diagnostic au porteur du projet avant toute autre construction.
- En cas de retard, appliquer la liste de repli de `docs/11-feuille-de-route.md`. Ne jamais sacrifier : offline, dossier, caisse, conventions, sécurité.

---

## 9. Méthode de travail

1. **Au début de chaque session** : lire ce fichier, puis `docs/avancement.md` (état courant, décisions, points ouverts), puis les documents du module concerné.
2. **Avant de coder** : écrire un plan court (fichiers touchés, tables, commandes, tests) dans la conversation. Si une décision produit manque et qu'aucune valeur par défaut n'est documentée, poser la question au porteur du projet au lieu de deviner.
3. **Construire par tranches verticales** : schéma et migration, règles dans `packages/domain`, service et route serveur, commande de synchronisation (si l'écran est opérationnel), interface, tests. Une tranche doit être démontrable.
4. **Définition de « terminé »** :
   - typecheck, lint et tests passent ;
   - tests d'isolation entre structures à jour pour toute nouvelle table ;
   - commande testée en ligne **et** hors connexion pour tout écran opérationnel ;
   - permissions vérifiées côté serveur (jamais seulement masquées dans l'interface) ;
   - chaînes d'interface dans `messages/fr.json` et `messages/en.json` ;
   - audit écrit pour toute écriture et toute lecture de dossier médical ;
   - `docs/avancement.md` mis à jour.
5. **Documentation vivante** : si l'implémentation impose un écart par rapport à `docs/`, mettre le document à jour dans le même commit et le signaler dans `docs/avancement.md`.
6. **Données de démonstration** : toujours fictives. Ne jamais utiliser de vraies données de patients, même pour un test.

---

## 10. Index de la documentation

| Fichier | Contenu |
| --- | --- |
| `docs/00-cadrage.md` | Vision, objectifs mesurables, acteurs, périmètre par phase, décisions actées, questions ouvertes et valeurs par défaut |
| `docs/01-architecture.md` | Vue d'ensemble, monolithe modulaire, rendu, résolution de structure, API, jobs, fichiers, adaptateurs, observabilité, performance |
| `docs/02-offline-sync.md` | Base locale, chiffrement, outbox, protocole push/pull/bootstrap, conflits, périmètre de sync, appareils, licence hors connexion, numérotation |
| `docs/03-multitenant-securite.md` | RLS, contextes d'exécution, authentification, 2FA, sessions, bris de glace, audit chaîné, chiffrement serveur, protection de la plateforme, conformité |
| `docs/04-modele-donnees.md` | Conventions, colonnes communes, toutes les entités par domaine avec leurs colonnes clés |
| `docs/05-roles-permissions.md` | RBAC et ABAC, catalogue de permissions, rôles par défaut, quatre yeux, délégations |
| `docs/06-configuration.md` | Moteur de configuration, versionnement et publication, assistant de démarrage, base de formation, imports |
| `docs/07-ui-ux.md` | Principes d'interface, mise en page, écrans critiques, raccourcis, accessibilité, impression, états hors connexion |
| `docs/08-parcours-acceptation.md` | Parcours métier complets écrits comme scénarios d'acceptation |
| `docs/09-hebergement-deploiement.md` | Contraintes cPanel, liste de contrôle du premier jour, déploiement, variables d'environnement, cron, sauvegardes, migration VPS |
| `docs/10-tests-qualite.md` | Stratégie de test, jeux d'essai obligatoires, CI, environnements |
| `docs/11-feuille-de-route.md` | Plan semaine par semaine du MVP, critères de sortie, liste de repli, séquence des phases 2 et 3, plan du pilote |
| `docs/12-interoperabilite.md` | API publique, webhooks, imports et exports, FHIR, HL7, DICOM, DHIS-2, agent local |
| `docs/13-tarification.md` | Plans, modules payants, essais, remises, valeurs de configuration initiales |
| `docs/glossaire.md` | Termes métier et techniques |
| `docs/avancement.md` | Journal d'avancement tenu par Claude Code |
| `docs/modules/*.md` | Un fichier par module : CORE, PAT, RDV, DPI, FORM, FACT, CONV, PHAR, LAB, NOTIF, SADM (MVP) ; HOSP, MAT, IMG, VAC, PORT (avec portail partenaire), SHARE, MPAY, EPID-ANA, RH (phase 2) ; phase 3 regroupée |

---

## 11. Interdits

- Écrire une logique qui suppose la présence du réseau dans un écran opérationnel.
- Modifier ou supprimer une ligne clinique, financière ou de stock existante.
- Lire `tenant_id` depuis le corps, l'URL ou un en-tête de la requête pour décider de l'accès.
- Exécuter une requête métier hors de `withTenant()` (ou de `withPlatformScope()` dans le portail super-admin).
- Utiliser des nombres à virgule flottante pour l'argent.
- Ajouter un WebSocket, un processus permanent, Redis, ou tout service qui ne tourne pas sur cPanel.
- Bloquer l'accès d'urgence ou l'export pour une raison de licence ou de paiement.
- Supprimer automatiquement des données de patient ou de structure.
- Écrire une donnée de santé ou un identifiant de patient dans un journal applicatif.
- Coder en dur un tarif, un forfait, une règle de convention, un formulaire clinique ou un texte de document imprimé.
- Fusionner automatiquement deux dossiers patients.
- Inventer un prix, une mention légale, un fournisseur ou une liste nationale.
- Commencer un module de phase 2 ou 3 sans instruction explicite.
