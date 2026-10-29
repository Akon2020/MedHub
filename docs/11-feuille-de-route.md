# 11. Feuille de route

Option A : environ 18 semaines jusqu'au pilote, développeur unique. Le risque principal (offline et synchronisation) est traité en premier. Prévoir 15 à 20 % de marge.

## J0. Fondations (S1 à S3)

### S1. Initialisation et hébergement
- Liste de contrôle cPanel du premier jour (`docs/09-hebergement-deploiement.md`), résultats consignés.
- Monorepo pnpm et Turborepo, paquets vides avec leurs frontières ESLint, TypeScript strict, Prettier, Vitest, Playwright.
- `apps/web` Next.js avec Tailwind, shadcn/ui, next-intl (fr, en), page `/api/health`.
- PostgreSQL de développement (Docker), Drizzle, première migration (`tenant`, `site`, `user_account`, `op_log`, `change_log`, `audit_log`, `job`), utilitaire RLS, `withTenant`.
- `apps/worker` minimal (tick qui traite un job de test).
- CI GitHub Actions. Archive `pnpm release` et premier déploiement « bonjour » sur cPanel avec cron.
- Maquettes basse fidélité des cinq écrans critiques (`docs/07-ui-ux.md` section 5).

### S2 et S3. Prototype de synchronisation
- `packages/shared` : UUID v7, HLC, horloge injectable, argent.
- `packages/local-db` : Dexie, chiffrement DEK et PIN, code de récupération, index haché.
- `packages/sync` : types d'opération, registre de commandes, outbox, push, pull, bootstrap, boucle client, verrou Web Locks.
- Serveur : `/sync/push`, `/sync/pull`, `/sync/bootstrap`, `/sync/status`, `/devices/register`, idempotence par `op_log`.
- Trois entités de démonstration : `patient` (`field_merge`), `vital_sign` (`append_only`), `stock_movement` (`movements`).
- Service worker Serwist et shell `/app` hors connexion.
- Banc d'essai de 500 opérations (`docs/02-offline-sync.md` section 13), tests de propriétés.

**Critère de sortie J0** : zéro perte, zéro doublon, convergence des bases, aucun nom en clair dans IndexedDB. Décision d'architecture confirmée par le porteur du projet. **Si échec : arrêt et réorientation.**

## J1. Plateforme et clinique (S4 à S9)

| Semaine | Contenu |
| --- | --- |
| S4 | Authentification (code de structure, mot de passe, Argon2id, sessions, 2FA TOTP), structures et sites, RLS sur toutes les tables, rôles et permissions (catalogue, rôles modèles, `requirePermission`), audit chaîné, coquille PWA, mise en page, `SyncIndicator`. |
| S5 | Appareils (enregistrement, révocation, effacement), jeton hors connexion, jeton de licence, configuration (`config_entry`, cycle brouillon et publication), catalogues de référence, i18n complète, écran de diagnostic, base de formation. |
| S6 | Patients : enregistrement rapide, recherche floue en ligne et hors connexion, phonétique, dédoublonnage (score, candidats), fusion supervisée et réversible, carte patient et QR, couverture (structure seulement, sans convention). Scénarios P2 et P3. |
| S7 | Rendez-vous (agendas, créneaux, exceptions, conflits `first_wins`), files d'attente et tickets, écran d'appel, triage. |
| S8 | Dossier longitudinal : `clinical_event`, résumé en un écran, constantes et définitions, courbes, courbes OMS, antécédents, allergies, problèmes, programmes chroniques, bris de glace, journal d'accès. Scénario P10. |
| S9 | Consultation, notes signées, diagnostics codés, constructeur et moteur de formulaires (FORM), prescription avec alertes, réconciliation médicamenteuse simple, impression d'ordonnance avec QR. |

**Critère de sortie J1** : un patient parcourt accueil, triage et consultation hors connexion et se synchronise sans erreur (P1 étapes 1 à 6). Démonstration à un utilisateur final de l'hôpital pilote dès S6.

## J2. Finances et services (S10 à S14)

| Semaine | Contenu |
| --- | --- |
| S10 | Tarification (services, grilles, prix datés, taxes, majorations, devises, taux), facture panier, encaissements multi-moyens et multi-devises, numérotation hors connexion, avoirs, remises avec quatre yeux, sessions de caisse et clôture, impression des reçus. |
| S11 | Conventions : tiers payants, conventions, modèles de forfait, règles de couverture, bénéficiaires et import, bons d'envoi, accords préalables, garanties, moteur `packages/conventions`, simulateur, facture mensuelle consolidée, contentieux. Scénario P4. |
| S12 | Pharmacie et stock : produits, lots, magasins, mouvements, dispensation, ventes libres, réceptions, transferts, inventaires, péremptions, seuils et consommation moyenne, stupéfiants. Scénario P8. |
| S13 | Laboratoire : catalogue, valeurs de référence, demandes, étiquettes, prélèvements, saisie, validation technique et biologique, valeurs critiques, comptes rendus, sous-traitance. Alertes perdus de vue (P9). Notifications et messages. |
| S14 | Super-admin : structures, plans, modules, abonnements, essais, licences, factures plateforme, paiements manuels, cycle d'impayé, portail client « Mon compte », support (tickets), annonces. Scénario P6. |

**Critère de sortie J2** : parcours P1 complet jusqu'à la facture et la dispensation ; un abonnement facturé, payé, puis suspendu selon le cycle.

## J3. Pilote (S15 à S18)

| Semaine | Contenu |
| --- | --- |
| S15 | Durcissement sécurité (en-têtes, CSRF, règles d'IP, revue des permissions, chiffrement des champs sensibles), sauvegardes et test de restauration, supervision, tests de charge et de coupure, procédure d'incident. |
| S16 | Formation (base de formation, fiches mémo, parcours guidés), imports des données du pilote (tarifs, produits, stock initial, conventions, utilisateurs). |
| S17 | Mise en service sur site avec assistance (accueil, caisse, consultation d'abord). |
| S18 | Extension (pharmacie, laboratoire, conventions), corrections, mesure d'impact, décision. |

### Marge et liste de repli (dans cet ordre)
1. Courbes OMS reportées.
2. Laboratoire en saisie simple (sans validation à deux niveaux).
3. Newsletter reportée.
4. Portail client en lecture seule.
5. Mobile money en saisie manuelle uniquement.

**Jamais sacrifiés** : offline, dossier, caisse, conventions, sécurité.

### Points de contrôle
- Démonstration hebdomadaire d'une tranche utilisable.
- Revue de risque à la fin de chaque jalon, consignée dans `docs/avancement.md`.

## Plan du pilote hospitalier

- **Profil** : 15 à 20 personnes (1 direction, 2 accueil et caisse, 4 infirmiers, 3 à 4 médecins, 1 sage-femme, 1 laboratoire, 1 à 2 pharmacie, 1 facturation). Parc mixte à inventorier. Électricité stable, connexion passable (mesure par poste).
- **Préparation** (2 semaines avant) : diagnostic, inventaire matériel et réseau, collecte des tarifs, produits, conventions et personnel, configuration, import.
- **Formation** (1 semaine) : sessions de 2 heures par rôle, exercices en base de formation.
- **Mise en service** (semaine 1) : accueil, caisse, consultation ; double fonctionnement papier limité à 2 semaines ; assistance sur site.
- **Extension** (semaines 2 à 4) : pharmacie, laboratoire, conventions, rapports.
- **Suivi** (jusqu'à 3 mois) : réunion hebdomadaire, corrections, indicateurs.

### Indicateurs de succès
| Indicateur | Cible |
| --- | --- |
| Disponibilité perçue | Aucune interruption de saisie lors des coupures |
| Synchronisation | Moins de 1 % d'opérations à traiter à la main, zéro perte |
| Facturation | Au moins 98 % de factures sans correction ultérieure, écarts de caisse identifiés le jour même |
| Temps de passage | Réduction mesurée par rapport à la situation de départ |
| Stock | Écart d'inventaire sous le seuil défini avec la pharmacie, ruptures détectées avant survenue |
| Adoption | Au moins 90 % des actes saisis, satisfaction supérieure à 7 sur 10 |
| Support | Première réponse en moins de 2 heures ouvrées |

## Phase 2 (après validation du pilote)

Ordre recommandé (chaque bloc a son document dans `docs/modules/`) :

| Ordre | Bloc | Préalable | Estimation |
| --- | --- | --- | --- |
| 1 | Migration VPS (si un seuil est atteint) | Pilote stable | 1 à 2 semaines |
| 2 | MPAY : mobile money intégré (encaissement patient et abonnement) | Agrégateur choisi | 2 semaines |
| 3 | HOSP : hospitalisation, lits, soins infirmiers, administration, dépassement de forfait, bloc | Pilote stable | 4 à 5 semaines |
| 4 | MAT : prénatal, partogramme, accouchement, nouveau-né | HOSP | 3 semaines |
| 5 | VAC : vaccination, calendrier, carnet, stocks de vaccins | DPI, PHAR | 2 semaines |
| 6 | EPID et ANA : rapports SNIS, DHIS-2, maladies à déclaration, tableaux de bord avancés | DPI, données du pilote | 3 semaines |
| 7 | RH : personnel, plannings, gardes, présences | CORE | 2 semaines |
| 8 | SHARE : identité globale, consentement, partage, référence et contre-référence | Validation juridique | 4 semaines |
| 9 | PORT : portail patient | SHARE pour les consentements | 3 semaines |
| 10 | Interface analyseurs de laboratoire (agent local) | LAB | 3 semaines |
| 11 | IMG : imagerie avec Orthanc et OHIF sur VPS | VPS | 4 semaines |
| 12 | Portail partenaire (médecins-conseils), assurances avancées | CONV | 2 à 3 semaines |

## Phase 3

Voir `docs/modules/phase-3.md`. Ordre indicatif : sous-domaines et marque blanche, FHIR complet, lingala et swahili, MAINT, AMB, DIET, aide à la décision avancée, on-premise et hybride, applications natives, biométrie, étude de télémédecine.
