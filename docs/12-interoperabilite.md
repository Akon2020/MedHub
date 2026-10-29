# 12. Interopérabilité

## 1. API publique (MVP, base ; enrichie en phase 2)

- Même API REST `/api/v1` que l'application, documentée en OpenAPI.
- Authentification par **clé d'API** (`api_key` : préfixe `mhk_`, hachage stocké, portée = liste de permissions, structure, date d'expiration, IP autorisées). Création et révocation par l'administrateur de structure.
- Clés d'idempotence sur toutes les écritures, pagination par curseur, filtres standard (`updated_since`, `status`), limitation de débit par clé.
- Versionnement : une rupture de contrat crée `/api/v2` ; `/api/v1` maintenue 12 mois au moins.

## 2. Webhooks sortants (MVP)

- `webhook_endpoint` (structure, URL, événements, secret, actif) et `webhook_delivery` (événement, charge utile, tentatives, statut, réponse).
- Événements : `patient.created`, `encounter.closed`, `invoice.finalized`, `payment.received`, `lab_result.validated`, `stock.below_minimum`, `contract.invoice_generated`.
- Signature HMAC-SHA-256 dans l'en-tête `X-MedHub-Signature` (horodatage + corps), relances avec attente croissante (jobs), journal consultable.
- Charges utiles minimales (identifiants et statuts) ; le destinataire récupère le détail par l'API avec sa clé.

## 3. Imports et exports (MVP)

Voir `docs/06-configuration.md` section 7. Exports CSV et Excel de toute liste (selon permission `report:export`), export complet d'une structure (portabilité) en JSON et CSV par table, zippé et chiffré, généré par job.

## 4. Codifications

| Domaine | Standard | Usage |
| --- | --- | --- |
| Diagnostics | CIM-10 (CIM-11 à terme), ICPC-2 | `diagnosis.code_system`. Catalogues importables, aucune dépendance du code à un fichier sous licence. |
| Médicaments | ATC, DCI, liste OMS des médicaments essentiels, liste nationale | `drug` |
| Laboratoire | LOINC (optionnel) | `lab_catalog_item.loinc` |
| Actes | Nomenclature locale, ICHI à terme | `service_item` |

Couche d'abstraction : `code_system` + `code` + `label` partout, tables de correspondance (`code_mapping`) pour passer d'un système à l'autre.

## 5. Santé publique : DHIS-2 (phase 2, module EPID)

- Table `dhis2_mapping` : indicateur MedHub (requête agrégée déclarée) vers `dataElement`, `categoryOptionCombo`, `orgUnit`, période.
- Génération périodique des valeurs agrégées par job, validation par un responsable, envoi par l'API DHIS-2 (`/api/dataValueSets`) ou export de fichier (JSON ou CSV DHIS-2).
- Synchronisation de la hiérarchie des unités d'organisation depuis DHIS-2.
- Cible : rapports SNIS des structures publiques.

## 6. FHIR R4 (façade en phase 2, complet en phase 3)

- Phase 2 : façade en lecture `/fhir/r4` pour `Patient`, `Encounter`, `Observation`, `MedicationRequest`, `DiagnosticReport`, `Immunization`, `AllergyIntolerance`, `Condition`. Correspondances dans `server/modules/interop/fhir/`.
- Phase 3 : écriture, recherche FHIR standard, `CapabilityStatement`, profils nationaux s'ils existent, `Bundle` de transaction, SMART on FHIR à étudier.

## 7. Laboratoire : analyseurs (phase 2)

- **Agent local** (`apps/agent`, Node.js empaqueté en exécutable Windows et Linux) installé dans la structure.
- Lecture de l'analyseur par port série, réseau TCP ou dépôt de fichiers ; décodage HL7 v2 (ORU) ou ASTM E1394.
- Correspondance configurable entre codes de l'analyseur et `lab_catalog_item`.
- File locale (SQLite) pendant les coupures, envoi par HTTPS authentifié (clé d'API d'agent) vers `/api/v1/lab/instrument-results`.
- Résultats en statut « à valider » : **validation humaine obligatoire** avant publication.
- Contrôle qualité interne (Levey-Jennings) en option.

## 8. Imagerie : DICOM (phase 2)

- Serveur Orthanc sur VPS séparé (non hébergeable sur cPanel), DICOMweb (WADO-RS, STOW-RS, QIDO-RS).
- Visionneuse OHIF intégrée au dossier, accès par jeton à durée limitée émis par MedHub.
- Agent local (le même `apps/agent`) : DICOM Modality Worklist pour les modalités, réception C-STORE, envoi en tâche de fond vers Orthanc avec reprise.
- Stockage objet et politique de rétention configurable.
- Alternative dès la v1 : images et comptes rendus joints sans DICOM.

## 9. Assurances (phase 2)

Échanges CSV, Excel ou API selon le tiers payant : export des factures mensuelles au format demandé (modèle de colonnes configurable par tiers), import des décisions et paiements.

## 10. Référence et contre-référence (phase 2, avec SHARE)

Lettre de référence structurée (résumé clinique, motif, traitements, résultats) transmise électroniquement à une autre structure MedHub avec consentement, ou imprimée avec QR pour une structure non équipée. Contre-référence en retour, rattachée au dossier d'origine.
