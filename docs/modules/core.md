# Module CORE : noyau

- **Phase** : MVP (S1, S4, S5)
- **Dépend de** : aucun
- **Toujours actif** pour toute structure.

## Objectif

Fournir les mécanismes génériques communs : structures et sites, utilisateurs, rôles, permissions, appareils, sessions, audit, configuration, catalogues de référence, numérotation, file de jobs, stockage de fichiers, notifications internes, activation des modules.

## Capacités

1. **Structures et organisation** : structure, sites, services (départements), salles, horaires d'ouverture, jours fériés (calendrier RDC par défaut, modifiable), centres de coût.
2. **Utilisateurs** : création (en ligne), désactivation (jamais suppression), réinitialisation de mot de passe, rattachement à des sites et services, signature scannée, numéro d'ordre professionnel.
3. **Rôles et permissions** : `docs/05-roles-permissions.md`. Duplication de rôle modèle, éditeur de rôle (grille ressource et action avec portée et conditions), aperçu « voir comme ».
4. **Appareils** : enregistrement, liste, dernière synchronisation, version, révocation, déclaration de perte, délai maximal hors connexion.
5. **Activation des modules** : lecture du jeton de licence et de `tenant_module` ; le menu et les routes n'exposent que les modules actifs ; l'API refuse `MODULE_NOT_ENABLED`. Vérification des dépendances à l'activation (refus d'activer CONV sans FACT).
6. **Audit et journal d'accès** : écriture centralisée `audit.write(tx, entry)` ; tableau de revue.
7. **Configuration** : `docs/06-configuration.md`.
8. **Catalogues de référence** : provinces et territoires de la RDC (importables), devises, unités, listes de choix configurables (`choice_list`, `choice_item` avec libellés fr et en).
9. **Numérotation** : `number_series` et gabarits (`docs/02-offline-sync.md` section 10).
10. **Jobs** : `docs/01-architecture.md` section 6.
11. **Approbations (quatre yeux)** : `approval_request`, file des demandes pour les valideurs, notifications.
12. **Diagnostic et état** : `/app/diagnostic`, `SyncIndicator`.
13. **Mode formation** : base de formation par structure.

## Règles de gestion

- Un utilisateur doit toujours avoir au moins un rôle actif pour se connecter.
- Le dernier administrateur actif d'une structure ne peut être désactivé.
- La désactivation d'un utilisateur révoque ses sessions et ses jetons hors connexion à la prochaine synchronisation de chaque appareil.
- Toute modification de rôle ou d'utilisateur privilégié exige la 2FA de l'auteur.

## Configurable

Politique de mot de passe, durées de session, verrouillage du PIN, délai maximal hors connexion, `four_eyes_mode` et seuils, jours fériés, horaires, listes de choix, gabarits de numérotation.

## Commandes de synchronisation

Aucune commande métier d'écriture hors connexion dans CORE (configuration en ligne seulement), à l'exception de :
- `audit.record_read` (lectures de dossier faites hors connexion) ;
- `approval.decide_on_device` (validation quatre yeux sur le même poste, si autorisée) ;
- `break_glass.start`.

Tables distribuées en lecture : utilisateurs actifs (nom, rôle, titre), rôles et permissions, sites, services, salles, listes de choix, configuration publiée.

## API principale

`/api/v1/auth/*` (login, logout, mfa, pin-setup, password-reset), `/api/v1/users`, `/api/v1/roles`, `/api/v1/permissions`, `/api/v1/sites`, `/api/v1/departments`, `/api/v1/rooms`, `/api/v1/devices`, `/api/v1/config/*`, `/api/v1/approvals`, `/api/v1/audit` (lecture, export), `/api/v1/choice-lists`, `/api/v1/imports`.

## Écrans

`/connexion`, `/app` (accueil par rôle), `/app/parametres/*` (organisation, utilisateurs, rôles, appareils, synchronisation, référentiels), `/app/approbations`, `/app/audit`, `/app/diagnostic`.

## Critères d'acceptation

- Les scénarios P7 et P10 passent.
- Un utilisateur sans permission ne voit pas l'action et l'API la refuse (`403 PERMISSION_DENIED`).
- La suite d'isolation passe pour toutes les tables du module.
- La vérification de la chaîne d'audit détecte une ligne modifiée manuellement en base.

## Points d'accroche pour les phases suivantes

- `tenant.parent_tenant_id` (réseaux, phase 2).
- `resolveTenant` lira le nom d'hôte (phase 3).
- Langues `ln` et `sw` ajoutables sans changement de code (phase 3).
