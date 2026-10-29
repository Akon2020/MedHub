# 05. Rôles et permissions

## 1. Modèle

- **RBAC** : une permission est une clé `ressource:action` (ex. `invoice:void`). Un rôle regroupe des permissions, chacune avec une **portée**.
- **Portées** : `self` (ce que l'utilisateur a créé ou ce qui lui est assigné), `department`, `site`, `tenant`, `warehouse` (magasins assignés), `cash_register` (caisses assignées), `patient` (pour le consentement).
- **ABAC** : conditions complémentaires stockées dans `role_permission.conditions` et évaluées par `packages/domain/src/core/access.ts` :
  - `sites: uuid[]`, `departments: uuid[]` ;
  - `hours: { from: '07:00', to: '19:00', weekdays: [1..7] }` ;
  - `sensitivity_max: 'normal' | 'staff' | 'vip' | 'restricted'` (niveau de sensibilité des dossiers accessibles) ;
  - `amount_max` (montant maximal de remise ou d'annulation sans validation).
- **Rôles entièrement configurables** par l'administrateur de structure. La plateforme fournit des **rôles modèles** par type de structure ; à la création, ils sont copiés dans la structure (modifiables, avec `template_code` pour proposer les mises à jour du modèle).
- **Évaluation** : `can(user, permissionKey, resource?)` côté client (instantané de permissions) pour l'interface ; `requirePermission(ctx, key, resource)` côté serveur, obligatoire dans chaque route et chaque appliqueur de commande.

## 2. Mécanismes complémentaires

- **Quatre yeux** : une action au-delà du seuil (`amount_max` ou seuil de configuration) crée une `approval_request`. Hors connexion, la demande est envoyée à la synchronisation ; l'action reste en attente (remise non appliquée) ou est appliquée avec validation par un second utilisateur **présent sur le même poste** (saisie de son PIN), selon la configuration `four_eyes_mode` (`remote` ou `same_device`).
- **Bris de glace** : voir `docs/03-multitenant-securite.md`.
- **Délégations** : `access_delegation` (remplacement pendant une garde ou un congé), date de fin obligatoire, tracée.
- **Sensibilité des dossiers** : un patient `staff`, `vip` ou `restricted`, ou une catégorie de donnée sensible (VIH, santé mentale, violences), exige `sensitivity_max` suffisant ou un bris de glace.
- **2FA obligatoire** pour les rôles `is_privileged` ou `requires_mfa`.

## 3. Catalogue de permissions (MVP)

| Ressource | Actions | Portées |
| --- | --- | --- |
| `patient` | `read`, `create`, `update`, `merge`, `export`, `mark_sensitive` | site, tenant |
| `encounter` | `read`, `create`, `update_status`, `close` | department, site, tenant |
| `appointment` | `read`, `create`, `update`, `cancel` | self, department, site |
| `queue` | `read`, `call`, `manage` | department, site |
| `triage` | `read`, `create` | department, site |
| `clinical_record` | `read`, `create`, `correct`, `sign`, `break_glass`, `read_sensitive` | self, department, tenant |
| `vital_sign` | `read`, `create`, `override_plausibility` | department, tenant |
| `diagnosis` | `read`, `create` | department, tenant |
| `prescription` | `read`, `create`, `update`, `cancel`, `override_alert` | self, department |
| `medication_administration` | `read`, `create` | department |
| `lab_order` | `read`, `create`, `cancel` | department, tenant |
| `lab_result` | `read`, `enter`, `tech_validate`, `bio_validate`, `correct` | department, tenant |
| `dispensation` | `read`, `create`, `void` | warehouse |
| `stock` | `read`, `move`, `transfer`, `count`, `adjust`, `receive`, `order` | warehouse |
| `controlled_substance` | `read`, `move`, `cosign` | warehouse |
| `invoice` | `read`, `create`, `add_line`, `finalize`, `void`, `discount`, `print` | site, tenant |
| `payment` | `read`, `receive`, `refund` | cash_register, site |
| `cash_session` | `open`, `close`, `withdraw`, `review`, `reconcile` | cash_register, site |
| `price` | `read`, `manage`, `publish` | tenant |
| `contract` | `read`, `create`, `update`, `activate`, `simulate` | tenant |
| `beneficiary` | `read`, `import`, `update` | tenant |
| `prior_authorization` | `read`, `request`, `decide` | tenant |
| `payer_invoice` | `read`, `generate`, `send`, `record_payment`, `handle_rejection` | tenant |
| `form` | `read`, `design`, `publish` | tenant |
| `configuration` | `read`, `edit`, `publish` | tenant |
| `user` | `read`, `create`, `update`, `disable`, `delegate`, `reset_password` | tenant |
| `role` | `read`, `manage` | tenant |
| `device` | `read`, `revoke` | tenant |
| `report` | `read`, `create`, `export`, `schedule` | department, site, tenant |
| `audit` | `read`, `export`, `review` | tenant |
| `account` (Mon compte MedHub) | `read`, `pay`, `change_plan` | tenant |
| `support` | `create_ticket`, `grant_remote_access` | tenant |
| `approval` | `decide` | department, site, tenant |

Plateforme (comptes `is_platform_staff`) : `platform:tenant_manage`, `platform:billing`, `platform:support`, `platform:remote_access`, `platform:security`, `platform:backup`, `platform:catalog`, `platform:communication`, `platform:settings`, `platform:audit_read`.

Chaque module de phase 2 et 3 ajoute ses permissions dans son document.

## 4. Rôles modèles par défaut

| Code | Nom | Résumé des droits |
| --- | --- | --- |
| `tenant_admin` | Administrateur de structure | Configuration, utilisateurs, rôles, appareils, audit, lecture de tout sauf contenu clinique sensible (selon politique). 2FA. |
| `director` | Direction | Rapports, tableaux de bord, validation des remises et annulations, revue d'audit. 2FA. |
| `receptionist` | Accueil | Patients (lire, créer, modifier), rendez-vous, files, visites, lecture des conventions et plafonds, lecture des factures. |
| `nurse` | Infirmier | Triage, constantes, lecture du dossier, administration des médicaments, création de notes de soins. |
| `physician` | Médecin | Dossier complet (département), diagnostics, prescriptions, demandes d'examens, signature, bris de glace. |
| `midwife` | Sage-femme | Comme infirmier + suivi prénatal et prescriptions limitées (liste configurable). |
| `lab_tech` | Technicien de laboratoire | Prélèvements, saisie, validation technique. |
| `lab_biologist` | Biologiste | Validation biologique, correction de résultats. |
| `pharmacist` | Pharmacien | Dispensation, stock, commandes, inventaires, produits sous contrôle. |
| `storekeeper` | Magasinier | Stock, réceptions, transferts, inventaires. |
| `cashier` | Caissier | Factures (lire, ajouter des lignes, finaliser), encaissements, sessions de caisse. |
| `billing_manager` | Facturation et conventions | Tarifs, conventions, bénéficiaires, accords préalables, factures aux tiers, contentieux. 2FA. |

### Matrice indicative

L : lire, C : créer, M : modifier, V : valider, A : annuler.

| Ressource | Accueil | Infirmier | Médecin | Labo | Pharmacie | Caisse | Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Fiche patient | LCM | L | L | L | L | L | LCMA |
| Dossier médical | aucun | LC | LCMV | L partiel | L partiel | aucun | Selon politique |
| Prescription | aucun | L | LCV | aucun | L | aucun | L |
| Résultats de laboratoire | aucun | L | L | LCMV | aucun | aucun | L |
| Dispensation et stock | aucun | L | L | aucun | LCMV | aucun | L |
| Facturation et caisse | L | aucun | L | aucun | C | LCM | LCMVA |
| Configuration | aucun | aucun | aucun | aucun | aucun | aucun | LCMA |

« L partiel » : le laboratoire voit les informations cliniques utiles à l'examen (renseignements cliniques, traitements en cours) ; la pharmacie voit allergies, poids, traitements et ordonnances.

## 5. Rôles modèles par type de structure

- **Pharmacie** : `tenant_admin`, `pharmacist`, `cashier` (souvent fusionnés : rôle `pharmacy_counter`).
- **Dispensaire** : `tenant_admin`, `receptionist`, `nurse`, `physician` (ou infirmier titulaire avec droit de prescription limité), `lab_tech`, `pharmacist`, `cashier`.
- **Cabinet** : `tenant_admin`, `receptionist`, `physician`.
- **Laboratoire indépendant** : `tenant_admin`, `receptionist`, `lab_tech`, `lab_biologist`, `cashier`.
- **Clinique et hôpital** : tous les rôles ci-dessus + `director`, `billing_manager`, `midwife`, et en phase 2 `ward_nurse`, `surgeon`, `radiologist`.

## 6. Hors connexion

- L'instantané de permissions (liste des clés avec portées et conditions) est inclus dans le jeton hors connexion et dans Dexie.
- Une modification de rôle prend effet sur un appareil à sa prochaine synchronisation. Le serveur applique toujours les permissions **en vigueur au moment de la réception** ; une opération faite hors connexion avec une permission retirée entre-temps est rejetée `PERMISSION_REVOKED` sauf pour les actes cliniques déjà réalisés (constantes, notes, administrations), qui sont acceptés et marqués pour revue (on ne perd pas la trace d'un soin effectué).
