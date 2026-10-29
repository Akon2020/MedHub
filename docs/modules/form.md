# Module FORM : formulaires cliniques et protocoles configurables

- **Phase** : MVP (S9)
- **Dépend de** : DPI

## Objectif

Permettre à un administrateur ou à un médecin référent de créer, **sans code**, des formulaires cliniques, des modèles de comptes rendus et des parcours cliniques, rendus à l'identique en ligne et hors connexion.

## Capacités

1. **Constructeur visuel** (en ligne, chargé à la demande) : glisser-déposer de sections et de champs, aperçu en direct sur tablette et PC.
2. **Types de champs** : texte court, texte long, nombre avec unité et décimales, date, heure, choix unique (boutons ou liste), choix multiple, oui/non, échelle (0 à 10, Likert), tableau (lignes répétables), calcul, schéma anatomique annotable (image + points), image ou photo, signature, champ codé (CIM-10, ATC, examen, produit), lien vers une constante (`vital_sign` : la saisie crée une constante, pas de double saisie), information (texte d'aide non saisissable).
3. **Règles conditionnelles** : afficher, masquer, rendre obligatoire selon une réponse, l'âge, le sexe, la grossesse ; validation par plage ; message d'erreur personnalisé.
4. **Calculs** : expressions définies dans l'interface (IMC, scores, dose par kg) avec un **langage d'expression sûr** (section Technique).
5. **Versionnement** : un formulaire publié est figé ; une modification crée une nouvelle version ; les saisies restent lisibles avec leur version d'origine.
6. **Liaison à une étape** : triage, consultation, hospitalisation, suivi chronique, sortie, profil patient (champs `extra`), laboratoire (fiche de renseignements), et filtre par service, rôle, âge, sexe.
7. **Modèles de départ** fournis (seeds) : consultation générale, CPN, pédiatrie (avec PCIME simplifiée), diabète, hypertension, tuberculose, VIH, malnutrition, santé mentale (basique), certificat médical.
8. **Parcours cliniques** : suite d'étapes avec propositions d'actes, d'examens et de traitements standards (le médecin accepte, modifie ou refuse) ; import de protocoles nationaux au format JSON.
9. **Modèles de comptes rendus** avec variables (`{{patient.nom}}`, `{{vital.weight}}`...) pour NOTIF.

## Technique

- Définition : **JSON Schema étendu** (`packages/forms/src/schema.ts`), validée par Zod. Structure : `{ id, version, title: {fr, en}, sections: [{ id, title, fields: [...] }], rules: [...], calculations: [...], bindings: {...} }`.
- Identifiants de champ stables (`snake_case`), jamais réutilisés entre versions pour un sens différent.
- Saisies : `form_response` (`form_version_id`, `patient_id`, `encounter_id`, `data jsonb`, `status` (`draft`, `completed`, `signed`), `supersedes_id`). Index ciblés sur les champs déclarés « reportables » (colonne générée ou table `form_response_value` pour les rapports).
- **Évaluateur d'expressions** (`packages/forms/src/expr/`) : analyse par `jsep`, évaluation par un interpréteur maison sur liste blanche : opérateurs arithmétiques, comparaisons, logiques, `if(c, a, b)`, `round`, `min`, `max`, `abs`, `sqrt`, `pow`, `ageYears()`, `ageMonths()`, `value('champ')`, `vital('weight')`, `isPregnant()`. Aucun accès à des propriétés, aucun appel de fonction non listée, aucune boucle, profondeur et longueur limitées. Jamais `eval` ni `new Function`.
- **Moteur de rendu sans interface** (`packages/forms/src/engine.ts`) : calcule visibilité, obligations, valeurs calculées, erreurs à partir de la définition et des réponses. Le composant React (`features/form/FormRenderer.tsx`) ne fait qu'afficher. Le serveur réutilise le moteur pour valider une saisie reçue.

## Règles de gestion

- Publier un formulaire exige qu'aucune expression ne soit invalide et qu'aucun identifiant de champ ne change de type par rapport à la version précédente.
- Les champs liés aux constantes créent des `vital_sign` lors de l'enregistrement de la saisie (une seule saisie).
- Une saisie signée suit les règles de la note signée (DPI).

## Commandes de synchronisation

`form_response.save_draft` (`field_merge` sur un brouillon local uniquement, non synchronisé tant que non terminé : configurable), `form_response.complete`, `form_response.sign`, `form_response.correct` (`append_only`).

Les définitions publiées sont des catalogues synchronisés en lecture.

## API

`/api/v1/forms` (définitions, versions, publication, import et export JSON), `/api/v1/form-responses`, `/api/v1/clinical-pathways`.

## Écrans

Constructeur (`/app/parametres/clinique/formulaires`), bibliothèque de modèles, aperçu, parcours cliniques.

## Critères d'acceptation

- Création d'un formulaire « suivi diabète » avec une règle conditionnelle et un calcul, publication, utilisation hors connexion, synchronisation, réouverture identique.
- Tests de l'évaluateur : expressions valides, expressions malveillantes refusées (accès `constructor`, `__proto__`, boucle, longueur excessive).
- Une ancienne saisie s'affiche avec sa version d'origine après publication d'une nouvelle version.

## Points d'accroche

Partogramme (MAT), plan de soins (HOSP), checklists chirurgicales, formulaires du portail patient (PORT), aide à la décision avancée (phase 3).
