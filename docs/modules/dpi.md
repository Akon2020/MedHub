# Module DPI : dossier médical longitudinal

- **Phase** : MVP (S8, S9)
- **Dépend de** : PAT
- Cœur de la valeur clinique.

## Principe

Le dossier est une **chronologie unique et immuable** (`clinical_event`) à laquelle chaque événement s'ajoute. Aucune donnée n'est écrasée : une correction crée une nouvelle version (`supersedes_id`), l'ancienne reste consultable avec la mention « corrigée » ou « saisie par erreur ».

## 1. Résumé patient (un écran)

Calculé localement à partir de Dexie (`packages/domain/src/dpi/summary.ts`) :
- alertes : allergies (gravité), contre-indications, pathologies chroniques actives, grossesse en cours, isolement, statut sensible (visible selon permission) ;
- traitements en cours et récents (90 jours, configurable), dose, voie, durée, prescripteur, structure d'origine ;
- dernières constantes avec tendance (comparaison à la mesure précédente, seuil de stabilité par constante) et marquage hors normes ;
- problèmes actifs, antécédents par catégorie ;
- derniers résultats anormaux, examens en attente ;
- prochains rendez-vous, rappels de programme, vaccins en retard (avec VAC, phase 2).

Chaque ouverture écrit le journal d'accès.

## 2. Antécédents, allergies, problèmes

- Antécédents structurés (codés CIM-10 en option) : catégorie, libellé, début, fin, statut, source (patient, autre structure, dossier).
- Allergies : substance (code ATC ou libellé), catégorie, réaction, gravité, certitude, date. Option « Aucune allergie connue » horodatée (distincte de « non renseigné »).
- Problèmes actifs et résolus, liés aux consultations.
- Stratégie `union` : rien n'est perdu entre deux postes hors connexion. Retrait logique avec motif.

## 3. Constantes et courbes

- Constantes configurables (`vital_sign_definition`) : température, pouls, tension systolique et diastolique, fréquence respiratoire, saturation, poids, taille, périmètre crânien, périmètre brachial (MUAC), glycémie capillaire, douleur (0 à 10), diurèse. Unités, décimales, plages normales par âge et sexe, bornes de plausibilité.
- Calculs automatiques (`packages/domain/src/dpi/calculations.ts`) : IMC, surface corporelle (Mosteller), score de Glasgow (via formulaire), score d'alerte précoce configurable (NEWS2 par défaut, désactivable), âge exact.
- Courbes d'évolution sur toute la durée du dossier (Recharts, chargé à la demande).
- **Courbes de croissance OMS** (0 à 5 ans, puis 5 à 19 ans) : poids pour l'âge, taille pour l'âge, poids pour la taille, IMC pour l'âge, périmètre crânien. Tables LMS de l'OMS embarquées en JSON (`packages/domain/src/dpi/who-growth/`), percentiles et Z-scores, alerte de malnutrition (Z inférieur à -2, -3) et MUAC (seuils 115 et 125 mm).
- Contrôle de plausibilité : hors bornes = confirmation avec motif.

## 4. Consultation

- Structure : motif, anamnèse, examen clinique, hypothèses, diagnostics codés (principal et secondaires, suspecté ou confirmé), conduite à tenir.
- Formulaires de spécialité (FORM) liés à l'étape « consultation » et au service.
- Aides à la saisie : modèles de phrases par utilisateur et par structure, copie du dernier compte rendu en modification, dictée libre (saisie vocale du système d'exploitation, rien de spécifique).
- Documents : certificat médical, arrêt de travail, lettre de référence, compte rendu, à partir des modèles (NOTIF).
- Pièces jointes : photos, PDF, images, compressées localement, envoi différé.
- **Signature** : la validation d'une note la signe (identité du clinicien, horodatage, signature Ed25519 de l'appareil sur le contenu canonique). Une note signée ne se modifie plus ; un addendum ou une correction crée une nouvelle version.
- Brouillon automatique local toutes les 5 secondes.

## 5. Prescription

- Catalogue de médicaments : liste modèle OMS (DCI, ATC) + liste nationale (import) + liste de la structure. Produits de la pharmacie liés à `drug_id`.
- Ordonnance structurée : médicament, forme, dose, unité, voie, fréquence (codes structurés : `1x/d`, `2x/d`, `3x/d`, `toutes les 8 h`, `si besoin`...), durée, quantité calculée automatiquement, instructions, substitution générique autorisée ou non.
- **Alertes** (`packages/domain/src/dpi/prescription-checks.ts`, déterministe, testé) :
  - allergie (correspondance par ATC et classe) ;
  - doublon thérapeutique (même classe ATC niveau 4 active) ;
  - interaction connue (`drug_interaction_rule`, base de règles importable) ;
  - dose maximale (par prise et par jour, par poids et âge si renseignés) ;
  - grossesse ;
  - âge (pédiatrie, gériatrie) ;
  - insuffisance rénale ou hépatique si renseignée dans les problèmes.
  Gravité : information, avertissement, bloquante. Passer outre une alerte bloquante exige la permission `prescription:override_alert` et une justification enregistrée dans `alerts_acknowledged`.
- **Réconciliation médicamenteuse** à l'admission, à la sortie (phase 2 avec HOSP) et sur demande en consultation : comparaison des traitements habituels (`medication_statement`), récents et prescrits ; décision pour chacun (continuer, arrêter, modifier) ; enregistrée.
- Statut de chaque ligne : prescrite, dispensée, partiellement dispensée, administrée, arrêtée (motif).
- Ordonnance imprimée avec QR de vérification ; transmission électronique à la pharmacie interne (file de dispensation).

## 6. Programmes chroniques

- Inscription à un programme (diabète, HTA, VIH, drépanocytose, tuberculose, malnutrition...) avec protocole (intervalle de suivi, examens périodiques, formulaire de suivi).
- Rendez-vous récurrents (RDV), renouvellement d'ordonnance, courbes ciblées.
- **Perdu de vue** : si aucun contact dans `follow_up_interval_days + délai de grâce` (14 jours par défaut), le patient passe en « perdu de vue » (job), liste d'appels pour l'équipe, rappel SMS sans information médicale.

## 7. Confidentialité

- Niveaux de sensibilité par catégorie de données (VIH, santé mentale, violences, IVG...) configurables : ces données sont chiffrées côté serveur et masquées sans permission `clinical_record:read_sensitive` ou bris de glace.
- Dossiers sensibles (`patient.sensitivity`) : accès restreint.
- Journal des accès au dossier (visible par le patient via le portail en phase 2).

## Commandes de synchronisation

| Commande | Stratégie |
| --- | --- |
| `vital_sign.record`, `vital_sign.correct` | `append_only` |
| `observation.record` | `append_only` |
| `clinical_note.create`, `clinical_note.sign`, `clinical_note.addendum`, `clinical_note.mark_error` | `append_only` |
| `diagnosis.add`, `diagnosis.correct` | `append_only` |
| `problem.add`, `problem.resolve`, `problem.retract` | `union` |
| `allergy.add`, `allergy.retract`, `allergy.set_none_known` | `union` |
| `medical_history.add`, `medical_history.retract` | `union` |
| `medication_statement.add`, `medication_statement.stop` | `union` |
| `prescription.create`, `prescription_item.stop`, `prescription.cancel` | `append_only` |
| `medication_reconciliation.record` | `append_only` |
| `program_enrollment.enroll`, `program_enrollment.discharge` | `union` |
| `attachment.add` | `append_only` + `fileOutbox` |
| `break_glass.start` | `append_only` |

## API

`/api/v1/patients/:id/summary`, `/timeline`, `/vitals`, `/notes`, `/diagnoses`, `/problems`, `/allergies`, `/history`, `/prescriptions`, `/attachments`, `/programs`; `/api/v1/drugs`, `/api/v1/drug-interactions` (import), `/api/v1/programs`, `/api/v1/vital-sign-definitions`.

## Écrans

Résumé patient, chronologie, consultation, constantes et courbes, prescription, réconciliation, programmes et perdus de vue.

## Critères d'acceptation

- Scénario P1 étapes 4 à 6, P9, P10.
- Ouverture du résumé local en moins de 300 ms pour un dossier de 200 événements.
- Les alertes de prescription passent tous les cas des jeux d'essai.
- Une note signée ne peut plus être modifiée (refus serveur et interface).

## Points d'accroche

`clinical_event.origin_tenant_id` (copies reçues d'autres structures avec SHARE), `medication_administration` (HOSP), `kind = 'vaccination'` (VAC), `kind = 'imaging_report'` (IMG), aide à la décision avancée (phase 3) branchée sur `prescription-checks` et les parcours FORM.
