# Journal d'avancement

Tenu à jour par Claude Code à la fin de chaque session de travail. Le porteur du projet le lit pour savoir où en est le projet.

## État courant

- Jalon en cours : **J0 Fondations** terminé côté code (critère de sortie atteint en tests automatisés) ; **J1, semaine S4, commencée** sur instruction du porteur du projet du 30/10/2026 (« poursuis avec l'étape suivante »). Reste à faire pour clore formellement J0 : liste de contrôle cPanel sur l'hébergement réel et premier déploiement, validation de la décision d'architecture et des écarts par le porteur du projet.
- S4 livré : double authentification TOTP (imposée aux rôles privilégiés, codes de secours, sans rejeu), limitation de débit en base, règles d'IP et blocage automatique, journal `security_event`, CSP à nonce, écran « Mon compte » (2FA, sessions ouvertes, apparence), mesure de la durée des requêtes. Seconde partie de S4 livrée le même jour : écrans Paramètres (organisation : structure, sites, services ; journal de sécurité), confirmation par second facteur (step-up, 15 minutes) avec rotation de l'identifiant de session, détection des connexions inhabituelles (nouvel appareil, horaire inhabituel). **S4 terminée.**
- S5 en cours : appareils (liste, retrait, perte, effacement à distance) et jetons signés Ed25519 (hors connexion 14 jours, licence) livrés. Reste : configuration versionnée (`config_entry`), utilisateurs (dont réinitialisation de la 2FA), catalogues de référence, i18n complète, diagnostic, base de formation.
- Thème sombre livré sur toute l'application (demande du porteur du 30/10/2026).
- Récapitulatif complet de tout ce qui a été fait : `walkthrough.md`.
- Dernière mise à jour : 30/10/2026
- Version déployée : aucune
- Branche de travail : `develop`

### Critère de sortie J0 : état

| Exigence | État | Preuve |
| --- | --- | --- |
| 500 opérations sur deux postes avec coupures aléatoires | Atteint (banc en mémoire) | `packages/sync/test/prototype.props.test.ts` : 500 opérations, 55 envois échoués, 7 réponses perdues après validation serveur, 25 doublons absorbés |
| Zéro perte, zéro doublon | Atteint | Nombre d'entités serveur égal au nombre de créations, aucun `op_id` en double, outbox vide à la fin |
| Convergence des bases | Atteint | Bases locales des deux postes identiques à la base serveur, solde de stock égal à la somme des mouvements ; propriété vérifiée sur 15 graines aléatoires |
| Même banc contre PostgreSQL réel | Atteint | `apps/web/test/integration/sync-postgres.test.ts` (160 opérations, RLS, triggers, audit chaîné intact) |
| Aucun nom en clair dans IndexedDB | Atteint | `packages/local-db/test/local-db.test.ts` inspecte le contenu brut de toutes les tables |
| Banc Playwright à deux navigateurs réels | Atteint | `apps/web/e2e/sync-bench.spec.ts` sur un build de production et une structure neuve à chaque passe : 500 opérations (226 enregistrements, 96 modifications, 178 constantes), 109 cycles de synchronisation coupés par `context.setOffline`, 38 réponses de push perdues après validation serveur ; zéro rejet, zéro doublon, postes identiques au serveur, aucun nom en clair dans IndexedDB |
| Saisie hors connexion depuis l'écran | Atteint | Même fichier : patient enregistré par le formulaire sans réseau, conservé après un rechargement complet, puis synchronisé |

## Résultats de la liste de contrôle cPanel

Non réalisée : l'hébergeur n'est pas encore choisi. Modèle à remplir : `infra/cpanel/checklist-resultats.md`.

Environnement de développement constaté sur le poste du porteur du projet : Windows 11, Node.js 26.3, pnpm 12.11, PostgreSQL 18.6 local (sans Docker). Rôle applicatif `medhub_app` non superutilisateur, bases `medhub_dev` et `medhub_test`, extensions `pg_trgm` et `unaccent` disponibles. La CI utilise PostgreSQL 16 et Node.js 22.

## Décisions prises en cours de route

| Date | Décision | Raison | Documents mis à jour |
| --- | --- | --- | --- |
| 29/10/2026 | Identité visuelle teal (accent `#0f6b6b`) avec effets de verre sur les pages publiques et la connexion, écrans opérationnels sobres | Choix du porteur du projet à partir des maquettes fournies | `docs/07-ui-ux.md` section 1 |
| 29/10/2026 | TypeScript 6.0.3 et ESLint 9.39 au lieu des toutes dernières versions (TypeScript 7, ESLint 10) | `typescript-eslint` exige TypeScript < 6.1 et `eslint-config-next` est validé sur ESLint 9 | aucun |
| 29/10/2026 | `lucide-react` 1.62.0 | La politique de pnpm refuse les paquets publiés depuis moins de 24 h | aucun |
| 29/10/2026 | Service worker compilé par esbuild avec le moteur Serwist, après `next build` | `@serwist/next` ne prend pas en charge le build Turbopack de Next.js 16 | aucun |
| 29/10/2026 | Hachage des mots de passe exposé par le sous-chemin `@medhub/db/password` | Le worker est un fichier unique sans module natif | aucun |
| 29/10/2026 | Point d'entrée Passenger `web/app.cjs` qui importe le serveur standalone | Le serveur standalone de Next.js 16 est un module ES | `guide.md` |
| 29/10/2026 | Rechargement complet d'une page de `/app` : nouveau déverrouillage par PIN | Les clés locales vivent uniquement en mémoire (`docs/02-offline-sync.md` section 3) | aucun |
| 30/10/2026 | Thème sombre livré dès maintenant sur toute l'application (Système, Clair, Sombre, cookie `medhub_theme`) | Demande du porteur du projet ; `docs/07` le prévoyait en phase 2 | `docs/07-ui-ux.md` section 1 |
| 30/10/2026 | S4 commencée | Instruction du porteur du projet ; critère de sortie technique de J0 atteint | aucun |
| 30/10/2026 | `otplib` 13.5.0 et `qrcode` 1.5.4 côté serveur uniquement | TOTP imposé par la pile ; QR produit en SVG par le serveur pour ne rien ajouter au budget client | aucun |

## Écarts par rapport à `docs/`

| Date | Document | Écart | Validé par le porteur du projet |
| --- | --- | --- | --- |
| 29/10/2026 | `docs/07-ui-ux.md` | Accent teal et effets de verre au lieu de bleu sombre sans dégradé | Oui (échange du 29/10/2026), document mis à jour |
| 29/10/2026 | `docs/03-multitenant-securite.md` section 1 | RLS appliquée par introspection après chaque migration (`ensureRls`, toute table ayant `tenant_id`) plutôt qu'un appel dans chaque migration. Plus sûr : aucune table ne peut être oubliée | À valider |
| 29/10/2026 | `docs/03-multitenant-securite.md` section 2 | Cookie de session `<tenantId>.<jeton>.<HMAC>` : l'identifiant de structure sert seulement à cibler la recherche sous RLS, l'accès dépend du hachage du jeton trouvé dans cette structure | À valider |
| 29/10/2026 | `docs/04-modele-donnees.md` | Table `job` exemptée de RLS de structure (infrastructure traitée par le worker pour toutes les structures, charge utile sans donnée de santé) | À valider |
| 29/10/2026 | `docs/04-modele-donnees.md` | `role.tenant_id` obligatoire : les rôles modèles vivent dans `packages/shared/src/permissions.ts` et sont copiés dans chaque structure ; `role_permission` et `user_role` portent `tenant_id` pour la RLS | À valider |
| 29/10/2026 | `docs/04-modele-donnees.md` | Colonne `patient.field_meta` (horloge HLC et version par champ) pour la stratégie `field_merge` | À valider |
| 29/10/2026 | `docs/05-roles-permissions.md` | Permission `device:register` ajoutée au catalogue (enregistrement d'un poste) et donnée aux rôles modèles | À valider |
| 29/10/2026 | `docs/02-offline-sync.md` section 8 | Périmètre de synchronisation : toute la structure pour l'instant, filtrée par permission de lecture par entité (`sync_scope_rule` en S6) | Temporaire |
| 30/10/2026 | `docs/10-tests-qualite.md` section 1 | Banc Playwright exécuté sur un build de production dédié (`.next-e2e`) plutôt que sur le serveur de développement, service worker bloqué | À valider |
| 29/10/2026 | `docs/09-hebergement-deploiement.md` section 8 | Développement sur PostgreSQL local (Docker absent du poste) ; `infra/docker` reste fourni | Constat |
| 30/10/2026 | `docs/03-multitenant-securite.md` section 2 | Défi de 2FA sans état (jeton HMAC lié à la structure, à l'utilisateur et à l'usage, 5 ou 15 minutes) ; il n'accorde rien seul et chaque échec alimente le verrouillage du compte | À valider |
| 30/10/2026 | `docs/03-multitenant-securite.md` section 2 | Codes de secours remplacés (supprimés puis recréés) à chaque régénération : identifiants, pas données cliniques ni financières | À valider |
| 30/10/2026 | `docs/03-multitenant-securite.md` section 5 | Secret TOTP chiffré avec une clé dérivée par HKDF de `MEDHUB_FIELD_MASTER_KEY` et de la structure, en attendant l'enveloppe complète (DEK par structure) | À valider |
| 30/10/2026 | `docs/04-modele-donnees.md` | Tables `rate_limit`, `ip_rule`, `security_event` sans `tenant_id` (colonne `target_tenant_id`) : elles servent avant la résolution de la structure ; `security_event` protégée en ajout seul par trigger | À valider |
| 30/10/2026 | `docs/03-multitenant-securite.md` section 2 | Step-up : toute modification de configuration exige une preuve du second facteur de moins de 15 minutes (valeur codée en attendant la configuration versionnée de S5) ; rotation de l'identifiant de session à chaque step-up et à l'activation de la 2FA | À valider |
| 30/10/2026 | `docs/06-configuration.md` | Organisation (structure, sites, services) modifiée directement avec audit, sans cycle brouillon et publication (S5) ; sites et services pas encore distribués aux postes (S5) | À valider |
| 30/10/2026 | `docs/03-multitenant-securite.md` section 2 | Connexions inhabituelles : nouvel appareil et horaire inhabituel seulement (aucune géolocalisation), signalées dans le journal de sécurité de la structure ; notification courriel ou SMS avec le module NOTIF | À valider |
| 30/10/2026 | `docs/02-offline-sync.md` section 9 | Clés publiques des jetons remises au poste à l'activation et conservées localement, au lieu d'être compilées dans l'application | À valider |
| 30/10/2026 | `docs/02-offline-sync.md` section 9 | Licence calquée sur l'état de la structure, tous les modules MVP, sans plan ni limite, jusqu'à SADM (S14) ; postes activés avant S5 tolérés sans jeton jusqu'à leur prochaine synchronisation | À valider |
| 30/10/2026 | `docs/03-multitenant-securite.md` section 7 | CSP : `style-src 'unsafe-inline'` conservé pour les attributs `style` de React et des graphiques ; scripts uniquement par nonce et `strict-dynamic` | À valider |

## Marqueurs `TODO(medhub-decision)` ouverts

| Fichier | Sujet | Valeur par défaut appliquée |
| --- | --- | --- |
| `packages/db/seeds/platform/plans.json` | Grille tarifaire publique affichée sur la page d'accueil | Valeurs médianes de `docs/13-tarification.md`, mention « valeurs indicatives » |
| `.env.example` | Fournisseurs SMS et paiement | Adaptateurs `console` et `manual` |

Variables d'environnement ajoutées en S4 : `MEDHUB_FIELD_MASTER_KEY` devient **obligatoire** (secrets 2FA), `MEDHUB_SLOW_REQUEST_MS` (2000 par défaut).

## Dépendances ajoutées et justification

| Paquet | Côté | Taille compressée | Raison |
| --- | --- | --- | --- |
| `dexie` | Client | environ 30 ko | Base locale IndexedDB (pile imposée) |
| `@noble/curves` (ed25519) | Client et serveur | environ 20 ko | Signature des opérations d'appareil |
| `recharts` | Client, chargé à la demande | environ 100 ko | Graphiques (pile imposée), importé par `next/dynamic` hors du shell |
| `serwist` | Service worker | environ 15 ko | Précache et stratégies de cache hors connexion |
| `radix-ui` (Slot seulement) | Client | moins de 5 ko | Composition des boutons shadcn |
| `otplib` | Serveur seulement | sans objet | TOTP (pile imposée) |
| `qrcode` | Serveur seulement | sans objet | Code QR SVG de configuration de la 2FA |

Budget mesuré au build du 29/10/2026 : **549 Kio compressés** pour l'ensemble de `.next/static` (budget : 1,5 Mo). Contrôle automatique dans la CI.

## Revues de risque de fin de jalon

J0 (en cours) : le risque principal, la synchronisation, est couvert par trois niveaux de tests (propriétés en mémoire, intégration PostgreSQL, parcours réel dans le navigateur). Risques restants : comportement réel de Passenger avec Next.js 16 (à vérifier lors de la liste de contrôle cPanel), quota IndexedDB sur tablettes d'entrée de gamme, performance de PBKDF2 à 600 000 itérations sur ces mêmes tablettes (mesure à faire). Aucun élément de la liste de repli activé.

## Matrice de compatibilité testée

| Appareil | Système | Navigateur | Résultat |
| --- | --- | --- | --- |
| PC de développement | Windows 11 | Chromium (navigateur intégré) | Connexion, activation du poste, enregistrement patient, synchronisation : OK |

## Journal des sessions

### 30/10/2026

Travail réalisé :
- **Thème sombre** sur toute l'application : jetons redéfinis (clair, sombre, système), surfaces décoratives en variables, couleurs en dur supprimées des composants, graphiques en variables CSS, sélecteur Système, Clair, Sombre (public, connexion, menu utilisateur, « Mon compte »), cookie `medhub_theme` lu par le serveur, aucun script en ligne.
- **S4, double authentification** : migration `0001_s4_mfa_security`, secret TOTP chiffré, configuration imposée aux rôles privilégiés à la connexion (code QR, clé manuelle, premier code, 10 codes de secours), vérification par code ou code de secours, refus du rejeu, échecs comptés dans le verrouillage, activation volontaire, régénération et désactivation avec code frais, audit chaîné de chaque étape.
- **S4, protection de la plateforme** : limitation de débit en base (connexion par adresse et par compte, vérification de code), blocage automatique d'une adresse 15 minutes, règles d'IP (plateforme et administration dans `proxy.ts`, structure dans `defineRoute`), journal `security_event` en ajout seul, purge horaire des compteurs par le worker.
- **S4, en-têtes** : CSP à nonce neuf par document (`strict-dynamic`), `upgrade-insecure-requests` en HTTPS.
- **S4, sessions** : écran « Mon compte » (`/app/compte`) avec sessions ouvertes et déconnexion des autres sessions ; option `permission` de `defineRoute` pour exiger une permission au niveau de la route.
- **Point ouvert de J0 (connexion lente)** : `Server-Timing` sur chaque route, métrique `http.duration_ms`, journalisation des requêtes lentes avec l'état du pool.
- `walkthrough.md` : récapitulatif complet du projet.

Constats :
- Le compte `admin` de la structure de démonstration `HOP-DEM-0001` (rôle privilégié) devra configurer la 2FA à sa prochaine connexion.
- Le test du worker échouait sous forte charge (build Playwright en parallèle) : le budget de 5 s du tick était dépassé avant le traitement du job de test. Budget du test porté à 20 s ; deux passes complètes de `pnpm test` vertes ensuite.
- L'annonceur de route de Next.js porte `role="alert"` : les tests doivent cibler le texte du message d'erreur.

S5, appareils et jetons (même jour) :
- Migration `0003_s5_devices` (colonnes de retrait), jetons JWS Ed25519 (`packages/sync/src/tokens.ts`), règles de licence (`packages/domain/src/core/license.ts`), émission serveur (`platform/tokens.ts`), écran `/app/parametres/appareils`, effacement à distance côté client, bandeaux de licence et d'expiration, écran de verrouillage « accès hors connexion expiré ».
- CI : une paire de clés de signature jetable est générée à chaque exécution (`pnpm keys:generate`), aucune clé n'est stockée dans le dépôt.
- Tests : 3 tests de jetons, 3 tests de licence, 4 tests d'intégration du cycle de vie d'un appareil, scénario Playwright d'effacement à distance. `pnpm test` (92 tests), `pnpm db:test-isolation` (79), `pnpm test:props`, typecheck, lint verts.

Seconde partie de S4 (même jour) :
- Migration `0002_s4_organization` : table `department` (RLS forcée automatiquement, fabrique d'isolation ajoutée), colonnes `session.mfa_verified_at` et `session.rotated_from`.
- Règles partagées `packages/domain/src/core/organization.ts` et `sign-in-risk.ts`.
- Service et routes d'organisation (`/api/v1/organization`, `/sites`, `/departments`), journal de sécurité de la structure (`/api/v1/security/events`), step-up (`/api/v1/auth/step-up`).
- Écrans `/app/parametres`, `/app/parametres/organisation`, `/app/parametres/securite` ; boîte « Confirmez votre identité » réutilisable (`useStepUp`) ; composants `NativeSelect` et `Textarea`.
- Services fictifs ajoutés à la structure de démonstration par `pnpm db:seed`.

Constat : sur ce poste, le build de production prend maintenant de 3 à 6 minutes et les suites lourdes lancées en parallèle (Playwright et `pnpm test`) se ralentissent mutuellement jusqu'à l'échec ; délai de démarrage du serveur Playwright porté à 10 minutes. Lancer ces suites l'une après l'autre.

Tests passés (seconde partie) : `pnpm typecheck`, `pnpm lint`, `pnpm test` (81 tests), `pnpm db:test-isolation` (79 tests), `pnpm test:props`, Playwright `mfa.spec.ts` (2FA, organisation, step-up).

Tests passés (première partie) : `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm db:test-isolation` (75 tests), tests de `apps/web` (18 tests dont la 2FA de bout en bout sur PostgreSQL), Playwright `public.spec.ts` et `mfa.spec.ts` (configuration imposée de la 2FA à l'écran, code faux refusé, bon code accepté, activation du poste, « Mon compte » en thème sombre, CSP à nonce neuf).


### 29/10/2026 (suite)

Travail réalisé :
- Banc Playwright à deux navigateurs réels (poste Accueil et poste Infirmier), connexion et activation par les écrans, coupures réseau, réponses perdues, vérification directe de la base serveur sous RLS.
- Point d'accroche de test `window.__medhubTest`, compilé uniquement quand `NEXT_PUBLIC_MEDHUB_E2E=1` ; le banc tourne sur un build de production séparé (`.next-e2e`) car le serveur de développement recompile sous charge et rendait le banc instable.
- Job `e2e` ajouté à la CI.

Constats :
- Le verrouillage automatique après 5 minutes d'inactivité ferme bien la session pendant un long traitement sans interaction ; le banc simule l'activité clavier et redemande le PIN si besoin (compté dans le résumé).
- **Risque de performance** : un nouveau poste télécharge toute la structure (périmètre complet tant que `sync_scope_rule` n'existe pas). Sur la structure de démonstration, qui grossissait de 200 patients à chaque passe, le banc est passé de 5 à plus de 10 minutes. Le banc utilise désormais une structure neuve par passe (`TST-BNC-NNNN`, créée par `pnpm db:seed --tenant`), et le périmètre de synchronisation de `docs/02-offline-sync.md` section 8 (patients du jour, des 7 jours, du service, favoris) devient prioritaire en S6.
- **Point ouvert** : une fois sur une dizaine de passes, une requête de connexion est restée 20 s sans réponse du serveur de production (abandonnée par le délai du client, aucune erreur dans les journaux serveur). Non reproduit sur 12 connexions consécutives mesurées entre 0,06 et 0,28 s. Le banc réessaie une fois et l'affiche ; à instrumenter en S4 (durée des requêtes, attente du pool et des verrous consultatifs d'audit).
- Le point d'accroche de test attend le verrou Web Locks de la boucle de synchronisation, sinon un cycle demandé pendant un cycle automatique rendait la main sans rien faire.

Tests passés : sur les trois dernières passes complètes de la suite Playwright (4 scénarios, structure neuve à chaque fois), deux sont entièrement vertes ; la troisième a échoué à la connexion initiale (point ouvert ci-dessus), avant toute opération. `pnpm typecheck`, `pnpm lint`, `pnpm test`.

### 29/10/2026

Travail réalisé :
- Monorepo pnpm et Turborepo (`apps/web`, `apps/worker`, `packages/shared`, `domain`, `sync`, `local-db`, `db`, `conventions`, `forms`, `config`), TypeScript strict avec `noUncheckedIndexedAccess`, ESLint avec règles de frontières, Prettier, Vitest, fast-check.
- `packages/shared` : UUID v7, horloge injectable, HLC, argent en entiers avec conversion à taux décimal, codes d'erreur, manifeste des modules, catalogue des permissions et rôles modèles.
- `packages/domain` : commandes `patient.register`, `patient.update`, `vital_sign.record`, `stock_movement.record`, recherche normalisée et clé phonétique, plausibilité des constantes, solde de stock, numérotation hors connexion, âge.
- `packages/sync` : protocole, signature Ed25519, moteur serveur idempotent (stratégies `field_merge` avec conflit sur champ sensible, `append_only` avec correction, `movements` avec alerte de stock négatif, dépendances), pull avec fenêtre de rattrapage, moteur client avec outbox.
- `packages/db` : schéma Drizzle, première migration, RLS forcée sur 16 tables, triggers d'ajout seul, journal d'audit chaîné et vérification, `withTenant`, `withPlatformScope`, file de jobs, seed de la structure fictive `HOP-DEM-0001`.
- `packages/local-db` : IndexedDB chiffrée (PIN, code de récupération, clés dérivées), index de recherche haché, politique d'échecs de PIN qui ne perd jamais une opération non envoyée.
- `apps/web` : page publique, connexion, activation du poste, shell `/app` avec indicateur de synchronisation, tableau de bord, patients, fiche patient avec constantes, diagnostic ; API `/api/health`, `/api/v1/auth/*`, `/api/v1/devices/register`, `/api/v1/sync/*` ; service worker.
- `apps/worker` : tick cron avec verrou consultatif, reprises, lettres mortes, planification, vérification quotidienne des chaînes d'audit.
- Infrastructure : scripts cPanel (déploiement, migration avec sauvegarde, retour arrière, sauvegarde chiffrée, cron, `.htaccess`), Docker de développement, CI GitHub Actions, `pnpm release`.

Tests passés : `pnpm typecheck`, `pnpm lint`, `pnpm test` (41 tests), `pnpm db:test-isolation` (71 tests), `pnpm test:props`, `pnpm build`. Parcours vérifié dans le navigateur : connexion `accueil`, activation, enregistrement d'un patient, synchronisation, refus correct de l'enregistrement de constantes pour le rôle Accueil.

Prochaines étapes :
1. Liste de contrôle cPanel sur l'hébergement retenu et premier déploiement « bonjour ».
2. S4 : 2FA TOTP, limitation de débit en base, règles d'IP, `requirePermission` généralisé par route, en-têtes CSP avec nonces.
3. S5 : jeton hors connexion et jeton de licence (JWS Ed25519), révocation d'appareil, configuration versionnée.
