# Module MAT : maternité

- **Phase** : 2
- **Dépend de** : DPI (HOSP pour le séjour)

## Capacités

1. **Dossier de grossesse** : date des dernières règles, terme calculé (et corrigé par échographie), gestité, parité, antécédents obstétricaux, facteurs de risque (score configurable), groupe sanguin et rhésus.
2. **Consultations prénatales (CPN)** : calendrier recommandé (configurable, modèle OMS 8 contacts par défaut), formulaire CPN (FORM), examens recommandés par âge gestationnel, supplémentation (fer, acide folique), TPI, vaccination antitétanique (lien VAC), rappels SMS (sans contenu médical).
3. **Partogramme numérique** (modèle OMS) : dilatation, descente, contractions, rythme cardiaque fœtal, constantes maternelles, médicaments, lignes d'alerte et d'action, alertes automatiques au franchissement ; saisie sur tablette hors connexion.
4. **Accouchement** : mode (voie basse, instrumentale, césarienne avec lien bloc HOSP), délivrance, complications, pertes sanguines.
5. **Nouveau-né** : création automatique d'un dossier patient lié à la mère (filiation), poids, taille, périmètre crânien, Apgar 1 et 5 minutes, réanimation, vaccinations BCG et polio 0 (VAC), allaitement.
6. **Postnatal** : suivi de la mère et du nouveau-né, planification familiale.
7. **Registres** : registre des naissances (export pour l'état civil), notification des décès maternels et néonatals (EPID).

## Commandes

`pregnancy.open`, `pregnancy.close`, `anc_visit.record`, `partograph.record_point` (`append_only`), `delivery.record`, `newborn.register`, `postnatal_visit.record`.

## Indicateurs

CPN1 précoce, nombre de CPN par grossesse, accouchements assistés, taux de césarienne, mortalité maternelle et néonatale, faible poids de naissance.

## Critères d'acceptation

Partogramme complet hors connexion avec alerte de ligne d'action ; nouveau-né créé avec filiation et vaccins programmés.
