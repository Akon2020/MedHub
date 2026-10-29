# Module PAT : patients et identité

- **Phase** : MVP (S6)
- **Dépend de** : CORE

## Objectif

Enregistrer et retrouver chaque patient rapidement, sans identifiant national fiable, sans créer de doublons durables, en ligne comme hors connexion.

## Capacités

1. **Enregistrement rapide** (moins de 60 secondes) : nom, postnom, prénom, sexe, date de naissance **ou** âge estimé, téléphone. Complément ultérieur.
2. **Identifiants** : `id` UUID v7 généré hors connexion ; MRN lisible configurable (`{PREFIX}-{DEVICE}-{YY}-{SEQ5}` par défaut) ; MRN officiel optionnel attribué à la synchronisation.
3. **Champs démographiques** : adresse structurée (province, ville ou territoire, commune, quartier, avenue et numéro), profession, état civil, langue, nationalité, nom du père, nom de la mère, personnes à contacter, tuteur légal. Champs supplémentaires configurables (`extra`, définis par un mini-formulaire FORM de type `patient_profile`).
4. **Photo** (caméra de la tablette ou du téléphone, compressée), carte patient imprimable avec QR (le QR contient un jeton opaque, jamais de donnée en clair).
5. **Patients provisoires** : inconnu, urgence non identifiée (« Inconnu homme 30 ans environ, arrivé 14/03 22 h 15 »), nouveau-né (« Nouveau-né de [mère] »), avec `is_provisional = true` et fusion ultérieure.
6. **Recherche tolérante** : nom (phonétique et trigrammes), téléphone (normalisé `+243`), MRN, nom du père ou de la mère, date de naissance ou année. Hors connexion : index haché (`docs/02-offline-sync.md`). En ligne : recherche serveur hors périmètre, avec indicateur.
7. **Couverture** : rattachement à une ou plusieurs conventions (ayant droit, plafonds, validité), visible dans le bandeau patient (détail dans CONV).
8. **Dédoublonnage** : score de similarité à la création (alerte avant création) et à la synchronisation (job), candidats de fusion, fusion supervisée, réversible.
9. **Sensibilité** : marquage `staff`, `vip`, `restricted` par un utilisateur habilité.
10. **Décès** : enregistrement de la date de décès (dossier en lecture seule pour les nouveaux actes non administratifs).
11. **Export du dossier** (droit d'accès) : PDF et JSON (permission `patient:export`).
12. **Favoris** par utilisateur (entrent dans le périmètre de synchronisation).

## Score de doublon

`packages/domain/src/pat/duplicate-score.ts`, déterministe, testé :
- nom phonétique identique : +35 ; similarité trigrammes supérieure à 0,7 : +20 ;
- date de naissance identique : +25 ; même année seulement : +10 ;
- téléphone identique : +30 ;
- nom de la mère ou du père identique : +15 ;
- sexe différent : -40.
Seuils configurables : alerte à la saisie à partir de 50, candidat de fusion à partir de 60.

## Fusion

- En ligne seulement, permission `patient:merge`, quatre yeux si configuré.
- Comparaison côte à côte, choix du survivant et des valeurs démographiques à garder.
- Toutes les lignes cliniques, financières et de rendez-vous du dossier fusionné sont rattachées au survivant par une table de redirection (`patient.merged_into_id`) : **aucune ligne clinique n'est réécrite** ; les requêtes de chronologie incluent les dossiers fusionnés.
- Snapshot conservé dans `patient_merge` ; annulation possible (`patient.unmerge`) qui restaure la séparation.
- Les appareils reçoivent la fusion à la synchronisation et redirigent l'ancien identifiant.

## Règles de gestion

- Sexe obligatoire (`U` autorisé). Date de naissance ou âge estimé obligatoire. Nom de famille obligatoire.
- Le téléphone est validé (format RDC ou international) mais non obligatoire.
- Le MRN ne change jamais après création.
- La modification de l'état civil est tracée champ par champ (`patient_field_history`).

## Configurable

Gabarit du MRN, champs obligatoires supplémentaires, champs `extra`, seuils de doublon, modèle de carte patient, ordre des noms à l'affichage (`NOM Postnom Prénom` par défaut).

## Commandes de synchronisation

| Commande | Stratégie | Remarques |
| --- | --- | --- |
| `patient.register` | création | Contrôle d'unicité du MRN ; job de détection de doublons |
| `patient.update_demographics` | `field_merge` | Champs sensibles en revue si conflit |
| `patient.add_contact`, `patient.add_identifier` | `union` | |
| `patient.set_photo` | `field_merge` | Fichier par `fileOutbox` |
| `patient.mark_deceased` | `field_merge` | Permission dédiée |
| `patient.set_sensitivity` | `field_merge` | Permission `patient:mark_sensitive` |
| `patient.favorite` | `union` | Par utilisateur |
| `patient.merge`, `patient.unmerge` | en ligne seulement | |

## API

`GET /api/v1/patients?q=&cursor=`, `GET /api/v1/patients/:id`, `POST /api/v1/patients`, `PATCH /api/v1/patients/:id`, `GET /api/v1/patients/:id/timeline`, `GET /api/v1/patients/duplicates`, `POST /api/v1/patients/merge`, `POST /api/v1/patients/:id/unmerge`, `GET /api/v1/patients/:id/export?format=pdf|json`.

## Écrans

Recherche et enregistrement (`/app/patients`), fiche patient (onglets identité, contacts, couverture, documents, historique des modifications), file des doublons (`/app/patients/doublons`), comparaison et fusion.

## Critères d'acceptation

- Scénarios P2 et P3.
- Création hors connexion en moins de 60 secondes chronométrées avec un utilisateur.
- Recherche locale sur 5 000 patients en moins de 200 ms sur une tablette d'entrée de gamme.
- Aucun nom en clair dans IndexedDB.

## Points d'accroche

- `person_global_id` renseigné à la création (table plateforme minimale) pour SHARE (phase 2).
- `patient_identifier` prêt pour un futur identifiant national et la biométrie (phase 3).
