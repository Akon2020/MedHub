# Module IMG : imagerie médicale

- **Phase** : 2 (la version sans DICOM peut être avancée si un client le demande)
- **Dépend de** : DPI
- **Prérequis d'infrastructure** : serveur d'imagerie sur VPS séparé (non hébergeable sur cPanel).

## Capacités

1. **Demandes** d'examens d'imagerie depuis la consultation (catalogue : radiographie, échographie, scanner, IRM, mammographie...), renseignements cliniques, priorité.
2. **Planification** par équipement (ressource RDV `equipment`).
3. **Compte rendu structuré** avec modèles par type d'examen (FORM), conclusion, recommandation, signature du radiologue, impression.
4. **Version légère sans DICOM** : images (JPEG, PNG) et PDF joints au compte rendu (échographie, radiographie numérisée par photo). Disponible dès qu'activée, sans serveur supplémentaire.
5. **Version DICOM** :
   - serveur **Orthanc** sur VPS, DICOMweb (WADO-RS, STOW-RS, QIDO-RS), authentification par jeton émis par MedHub ;
   - **visionneuse OHIF** intégrée au dossier patient (iframe ou route dédiée), accès par jeton à durée limitée (15 minutes) ;
   - **agent local** (`apps/agent`) : DICOM Modality Worklist alimentée par les demandes, réception C-STORE des modalités, envoi en arrière-plan vers Orthanc avec reprise après coupure ;
   - rapprochement étude et demande par numéro d'accès (`accession_number`) ;
   - stockage objet et politique de rétention configurable ; volume estimé intégré au prix du module.
6. **Facturation** des examens par la nomenclature FACT et couverture CONV.

## Données

`imaging_order`, `imaging_study` (study_instance_uid, accession_number, modality, orthanc_id, series_count, status), `imaging_report` (append-only).

## Hors connexion

Demandes et comptes rendus hors connexion ; images DICOM consultables en ligne seulement (indicateur clair) ; images légères suivent la règle des pièces jointes (téléchargement à la demande).

## Critères d'acceptation

Demande créée, étude reçue d'une modalité de test (simulateur DICOM), rapprochée, visualisée dans OHIF, compte rendu signé ; coupure entre l'agent et Orthanc sans perte d'image.
