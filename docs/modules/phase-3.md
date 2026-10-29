# Phase 3 : évolutions

**Ne rien commencer de ce document sans instruction explicite du porteur du projet.** Chaque section indique les points d'accroche déjà présents dans le MVP.

## 1. Sous-domaines et marque blanche

- Une adresse par structure (`hop-kin-0042.medhub.cd`) ou un domaine personnalisé (`dossier.hopital-exemple.cd`).
- `resolveTenant` lit le nom d'hôte en plus de la session (point d'accroche : fonction unique, adresses internes sans code de structure).
- Prérequis : VPS (certificats génériques, reverse proxy). Personnalisation visuelle (logo, couleur d'accent) par structure.
- La base locale reste nommée par structure et utilisateur ; migration transparente de l'origine (export et réimport chiffré de l'outbox lors du changement d'adresse, à prototyper).

## 2. On-premise et hybride

- Distribution Docker Compose pour un serveur local dans la structure (même code).
- Mode hybride : le serveur local est la référence sur site et se synchronise avec le cloud MedHub (même protocole push et pull, le serveur local agissant comme un « appareil » de grande capacité avec son propre périmètre).
- Mises à jour signées, licences hors ligne longues, outil de sauvegarde local.

## 3. FHIR R4 complet

Écriture, recherche standard, `CapabilityStatement`, `Bundle` de transaction, profils nationaux s'ils existent, SMART on FHIR à étudier. Point d'accroche : façade de lecture de phase 2.

## 4. Aide à la décision avancée

- Parcours cliniques enrichis (PCIME complète, protocoles nationaux), rappels contextuels, scores automatiques.
- Moteur de règles cliniques déclaratives (même évaluateur sûr que FORM).
- Toute suggestion reste une suggestion : décision et responsabilité au clinicien, trace de la suggestion et de la décision.

## 5. Applications natives

Enveloppes Android (prioritaire) et iOS de la PWA (Capacitor ou équivalent, à décider) pour : stockage plus fiable sur iOS, biométrie de déverrouillage, impression Bluetooth 80 mm, lecture de codes-barres native. Même code d'interface.

## 6. Langues

Lingala (`ln`) et swahili (`sw`) : fichiers de messages, libellés configurables multilingues déjà prévus. Tshiluba et kikongo à étudier.

## 7. Biométrie

Empreinte digitale ou reconnaissance faciale pour l'identification des patients (lecteur USB ou application native), stockage de gabarits chiffrés, jamais d'image brute, consentement explicite. Point d'accroche : `patient_identifier`.

## 8. MAINT : équipements et maintenance

Inventaire des biens (équipements biomédicaux, informatique), affectation, maintenance préventive planifiée, déclaration de pannes depuis l'application, interventions, coûts, disponibilité des équipements (lien avec les agendas d'équipements RDV).

## 9. DIET : repas

Régimes prescrits (lien HOSP), commandes de repas par lit et par service, préparation en cuisine, facturation éventuelle, allergies alimentaires vérifiées.

## 10. AMB : ambulance et soins à domicile

Missions (appel, équipage, véhicule, trajets, heures), fiche d'intervention (formulaire FORM hors connexion sur téléphone), soins à domicile planifiés, facturation (FACT, CONV), consommables.

## 11. Télémédecine (étude)

Téléconsultation vidéo depuis le portail patient : étude de faisabilité (débit, fournisseur, cadre légal). Point d'accroche : `encounter.kind = 'teleconsult'`.

## 12. Autres pistes

Réseaux multi-structures avec consolidation (`tenant.parent_tenant_id`), commandes groupées, CIM-11, intégration avec l'assurance maladie nationale si elle se met en place, médecin-conseil avec signature électronique qualifiée.
