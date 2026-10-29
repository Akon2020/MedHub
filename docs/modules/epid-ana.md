# Modules EPID et ANA : santé publique, rapports, analytique avancée

- **Phase** : 2 (rapports prédéfinis de base dès le MVP dans chaque module)
- **Dépend de** : DPI (EPID), CORE (ANA)

## Rapports de base (MVP, dans chaque module)

Fréquentation par service, âge et sexe ; morbidité (diagnostics les plus fréquents) ; recettes, créances, clôtures de caisse ; stock et ruptures ; activité du laboratoire ; tableau de bord de direction (recettes, créances, fréquentation, ruptures de stock en vue).

## EPID : santé publique

1. **Rapports SNIS** prédéfinis (canevas mensuels des structures publiques, à configurer à partir des formulaires officiels, `TODO(medhub-decision)` sur les canevas exacts).
2. **Export DHIS-2** (`docs/12-interoperabilite.md` section 5) : correspondances, agrégation, validation, envoi API ou fichier, hiérarchie des unités d'organisation.
3. **Maladies à déclaration obligatoire** : liste configurable (choléra, rougeole, Ebola, mpox, méningite, fièvre jaune, paludisme grave...), déclenchement à la saisie d'un diagnostic codé correspondant, fiche de notification, seuils d'alerte épidémique par période et zone, notification au responsable désigné.
4. **Mortalité** : registre des décès, causes (CIM-10), décès maternels et néonatals (MAT).

## ANA : analytique avancée

1. **Tableaux de bord** de direction : recettes, créances, fréquentation, durée de séjour, taux d'occupation, ruptures, productivité par service et par professionnel, délais de passage.
2. **Constructeur de rapports** : choix d'une source (vue analytique déclarée), filtres, regroupements, indicateurs, graphiques ; export Excel et PDF ; planification d'envoi par courriel (job).
3. **Alertes** configurables : stock, impayés, signal épidémique, patients perdus de vue, chute de fréquentation.
4. **Vues analytiques** : vues matérialisées PostgreSQL rafraîchies par job (nuit et toutes les heures), toujours filtrées par `tenant_id` (RLS appliquée aux vues via `security_barrier` et fonctions).

## Contraintes

- Les rapports lourds s'exécutent en job, jamais dans une requête HTTP longue (limite cPanel).
- Les exports respectent les permissions et sont audités.
- Pas de données nominatives dans les exports agrégés de santé publique.

## Critères d'acceptation

Rapport SNIS mensuel généré et validé ; envoi à une instance DHIS-2 de test ; alerte épidémique déclenchée par une série de diagnostics simulés.
