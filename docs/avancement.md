# Journal d'avancement

Tenu à jour par Claude Code à la fin de chaque session de travail. Le porteur du projet le lit pour savoir où en est le projet.

## État courant

- Jalon en cours : **J0 Fondations**, S1 réalisée, prototype de synchronisation S2 et S3 livré et validé en tests automatisés. Reste à faire pour clore J0 : liste de contrôle cPanel sur l'hébergement réel, banc Playwright à deux navigateurs avec `context.setOffline`, jeton hors connexion et jeton de licence (prévus en S5 mais utiles au prototype), validation de la décision d'architecture par le porteur du projet.
- Dernière mise à jour : 29/10/2026
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
| Banc Playwright à deux navigateurs | À faire | Configuration non encore écrite |

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
| 29/10/2026 | `docs/09-hebergement-deploiement.md` section 8 | Développement sur PostgreSQL local (Docker absent du poste) ; `infra/docker` reste fourni | Constat |

## Marqueurs `TODO(medhub-decision)` ouverts

| Fichier | Sujet | Valeur par défaut appliquée |
| --- | --- | --- |
| `packages/db/seeds/platform/plans.json` | Grille tarifaire publique affichée sur la page d'accueil | Valeurs médianes de `docs/13-tarification.md`, mention « valeurs indicatives » |
| `.env.example` | Fournisseurs SMS et paiement | Adaptateurs `console` et `manual` |

## Dépendances ajoutées et justification

| Paquet | Côté | Taille compressée | Raison |
| --- | --- | --- | --- |
| `dexie` | Client | environ 30 ko | Base locale IndexedDB (pile imposée) |
| `@noble/curves` (ed25519) | Client et serveur | environ 20 ko | Signature des opérations d'appareil |
| `recharts` | Client, chargé à la demande | environ 100 ko | Graphiques (pile imposée), importé par `next/dynamic` hors du shell |
| `serwist` | Service worker | environ 15 ko | Précache et stratégies de cache hors connexion |
| `radix-ui` (Slot seulement) | Client | moins de 5 ko | Composition des boutons shadcn |

Budget mesuré au build du 29/10/2026 : **549 Kio compressés** pour l'ensemble de `.next/static` (budget : 1,5 Mo). Contrôle automatique dans la CI.

## Revues de risque de fin de jalon

J0 (en cours) : le risque principal, la synchronisation, est couvert par trois niveaux de tests (propriétés en mémoire, intégration PostgreSQL, parcours réel dans le navigateur). Risques restants : comportement réel de Passenger avec Next.js 16 (à vérifier lors de la liste de contrôle cPanel), quota IndexedDB sur tablettes d'entrée de gamme, performance de PBKDF2 à 600 000 itérations sur ces mêmes tablettes (mesure à faire). Aucun élément de la liste de repli activé.

## Matrice de compatibilité testée

| Appareil | Système | Navigateur | Résultat |
| --- | --- | --- | --- |
| PC de développement | Windows 11 | Chromium (navigateur intégré) | Connexion, activation du poste, enregistrement patient, synchronisation : OK |

## Journal des sessions

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
1. Banc Playwright à deux navigateurs avec coupures (`context.setOffline`) pour clore J0.
2. Liste de contrôle cPanel sur l'hébergement retenu et premier déploiement « bonjour ».
3. S4 : 2FA TOTP, limitation de débit en base, règles d'IP, `requirePermission` généralisé par route, en-têtes CSP avec nonces.
4. S5 : jeton hors connexion et jeton de licence (JWS Ed25519), révocation d'appareil, configuration versionnée.
