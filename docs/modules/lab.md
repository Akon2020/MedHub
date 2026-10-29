# Module LAB : laboratoire

- **Phase** : MVP (S13) pour la saisie manuelle ; phase 2 pour l'interface des analyseurs
- **Dépend de** : DPI (et FACT pour la facturation)

## Capacités MVP

1. **Catalogue d'examens** : code, nom, LOINC optionnel, type de prélèvement, tube, délai de rendu, unité, type de résultat (numérique, texte, choix, profil), profils (NFS, bilan hépatique...), prix lié à un `service_item`, sous-traitance.
2. **Valeurs de référence** par sexe et tranche d'âge (en jours), bornes critiques, texte ; éditables.
3. **Demande** depuis la consultation ou à l'accueil (prescripteur externe), renseignements cliniques, priorité (routine, urgent).
4. **Prélèvement** : étiquettes avec code-barres (Code 128, impression sur imprimante d'étiquettes ou A4), heure, préleveur, rejet avec motif (hémolysé, insuffisant...).
5. **Saisie manuelle des résultats** avec contrôle de plausibilité, calcul automatique du drapeau (L, H, LL, HH, N), comparaison au résultat antérieur (delta check configurable).
6. **Validation** technique (technicien) puis biologique (biologiste), par deux personnes différentes (configurable : une seule validation pour les petites structures). Mode « saisie simple » de la liste de repli.
7. **Valeurs critiques** : notification immédiate au prescripteur (application et SMS sans valeur ni nom d'examen : « Un résultat urgent vous attend »), accusé de lecture tracé.
8. **Comptes rendus** imprimables (modèle NOTIF), historique comparatif des résultats antérieurs, courbe par analyte.
9. **Envoi au patient** : impression ; portail patient en phase 2.
10. **Sous-traitance** : envoi vers un laboratoire externe (bordereau), réception des résultats (saisie ou pièce jointe), refacturation.

## Règles de gestion

- Un résultat validé biologiquement est visible par le prescripteur et ne peut être corrigé que par une nouvelle version avec motif (`lab_result.correct`, notification du prescripteur).
- Le même utilisateur ne peut pas faire les deux validations si la double validation est active.
- Une demande annulée après prélèvement garde la trace du prélèvement.

## Commandes de synchronisation

`lab_order.create`, `lab_order.cancel`, `lab_specimen.collect`, `lab_specimen.reject`, `lab_result.enter`, `lab_result.tech_validate`, `lab_result.bio_validate`, `lab_result.correct` (toutes `append_only`), `lab_critical.acknowledge`.

## API

`/api/v1/lab/catalog`, `/lab/reference-ranges`, `/lab/orders`, `/lab/specimens`, `/lab/results`, `/lab/worklist`, `/lab/external-labs`.

## Écrans

Liste de travail (à prélever, en cours, à valider), saisie des résultats (par demande ou par série d'analytes), validation, compte rendu, catalogue et valeurs de référence.

## Indicateurs

Délai de rendu par examen, taux de rejet, valeurs critiques et délai d'accusé, activité par examen.

## Critères d'acceptation

- P1 étape 7.
- Valeur critique saisie hors connexion : notification au prescripteur à la synchronisation, accusé tracé.

## Phase 2 : interface des analyseurs

Agent local (`docs/12-interoperabilite.md` section 7), correspondance des codes, résultats en attente de validation humaine, contrôle qualité interne. Le modèle de données MVP (`lab_result.entered_by` pouvant être un agent) est prévu pour cela.
