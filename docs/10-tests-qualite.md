# 10. Tests et qualité

## 1. Pyramide de tests

| Type | Objet | Outil | Emplacement |
| --- | --- | --- | --- |
| Unitaires | Règles pures : moteur de conventions, calculs de dose, scores, IMC, Z-scores OMS, numérotation, règles de caisse, phonétique, HLC, évaluateur d'expressions | Vitest | `packages/*/src/**/*.test.ts` |
| Propriétés | Synchronisation : ordre aléatoire, rejeu, doublons, fusion de champs, convergence | fast-check | `packages/sync/test/*.props.test.ts` |
| Intégration | API, RLS, migrations, jobs, imports | Vitest + PostgreSQL de test (Docker) | `apps/web/test/integration/` |
| Isolation | Lectures et écritures croisées entre structures, pour chaque table et chaque route | Vitest | `packages/db/test/isolation/` |
| Bout en bout | Parcours de `docs/08-parcours-acceptation.md`, y compris coupures réseau | Playwright (`context.setOffline`, interception de requêtes) | `apps/web/e2e/` |
| Charge | 20 à 50 utilisateurs, pic de synchronisation après longue coupure (10 appareils avec 500 opérations chacun) | k6 | `infra/k6/` |
| Sécurité | Contrôle d'accès, injections, CSRF, en-têtes, audit chaîné | Vitest + scan de dépendances | `apps/web/test/security/` |
| Compatibilité | Chrome, Edge, Firefox, Chrome Android sur matériel d'entrée de gamme | Playwright (projets) + appareils réels | matrice dans `docs/avancement.md` |
| Accessibilité | Contraste, clavier, ARIA | `@axe-core/playwright` | `apps/web/e2e/a11y/` |

## 2. Jeux d'essai obligatoires

- **Conventions** : les quatre modèles A, B, C, D (`packages/conventions/test/fixtures/`), avec au moins : acte inclus, acte exclu, acte avec accord préalable, plafond atteint, dépassement de durée d'hospitalisation, mois commencé, journalier, urgence sans bon d'envoi, ticket modérateur. Chaque cas vérifie la répartition et la trace de règle.
- **Caisse** : multi-devises avec arrondi, monnaie rendue, avoir, clôture avec écart, réouverture interdite.
- **Stock** : premier périmé premier sorti, mouvements concurrents hors connexion, stock négatif, inventaire avec écart.
- **Clinique** : alertes de prescription (allergie, interaction, dose maximale par poids et âge, grossesse), plausibilité des constantes, courbes OMS (valeurs de référence connues).
- **Sync** : prototype de 500 opérations (`docs/02-offline-sync.md` section 13), bascule de version de schéma N-1, appareil révoqué, jeton expiré, horloge en retard.
- **Abonnement** : cycle complet d'impayé, avec dates simulées (horloge injectée).

## 3. Règles

- Toute fonction de `packages/domain`, `conventions`, `forms`, `sync` a des tests unitaires ; couverture visée 90 % sur ces paquets.
- Toute nouvelle table métier ajoute son test d'isolation.
- Toute nouvelle commande de synchronisation ajoute un test d'idempotence (rejeu de la même opération) et un test d'application hors ordre.
- Horloge injectable partout (`Clock` dans `packages/shared`) : aucun appel direct à `Date.now()` dans le code métier.
- Données de test fictives générées (`packages/db/seeds/fake.ts`), noms congolais plausibles mais inventés.

## 4. Intégration continue

Workflow GitHub Actions sur chaque push et demande de fusion :
1. Installation (cache pnpm).
2. `pnpm typecheck`, `pnpm lint`.
3. `pnpm test` avec service PostgreSQL de la même version majeure que la production.
4. `pnpm db:test-isolation`.
5. `pnpm test:props` (temps limité en CI, complet la nuit).
6. `pnpm build` et vérification du budget de taille (échec si le précache dépasse 1,5 Mo compressé).
7. `pnpm test:e2e` (scénarios essentiels à chaque push, complet la nuit).
8. `pnpm audit --prod` (échec sur vulnérabilité critique).
9. Sur étiquette de version : `pnpm release` et archive publiée comme artefact.

## 5. Revue de code (Claude Code)

Avant de proposer une modification, vérifier : règles non négociables de `CLAUDE.md`, permissions serveur, audit, isolation, comportement hors connexion, traductions, absence de données de santé dans les journaux, migrations réversibles et compatibles avec la version précédente.
