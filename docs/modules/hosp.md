# Module HOSP : hospitalisation, soins infirmiers, bloc

- **Phase** : 2
- **Dépend de** : DPI, FACT (CONV pour les forfaits)
- **Ne pas commencer avant validation du pilote.**

## Capacités

1. **Cartographie des lits** : services d'hospitalisation, chambres, lits ; état (libre, occupé, à nettoyer, hors service) ; vue graphique par service ; taux d'occupation en temps quasi réel (selon synchronisation).
2. **ADT** : décision d'admission (depuis consultation ou urgence), choix du lit, dépôt de caution, vérification de la convention et de la durée forfaitaire, transfert entre lits et services, sortie (domicile, référence, contre avis médical, évasion, décès).
3. **Réconciliation médicamenteuse** à l'admission et à la sortie (DPI).
4. **Prescriptions hospitalières** : récurrentes (horaires d'administration générés), conditionnelles (« si douleur »), perfusions (débit, volume), arrêt et modification.
5. **Plan de soins infirmiers** : tâches planifiées (soins, surveillances, administrations), tour de soins par infirmier et par service, cochage avec heure réelle et signature.
6. **Administration des médicaments** (`medication_administration`) : heure prévue, heure réelle, dose, voie, statut (donné, refusé, non donné avec motif), double contrôle pour les produits à risque.
7. **Feuille de surveillance** avec courbes (constantes, score d'alerte précoce, bilans entrées et sorties, diurèse).
8. **Visites médicales** quotidiennes (notes de suivi), demandes d'examens.
9. **Forfait de séjour** : compteur de jours, alerte à J-1 de la fin du forfait de la convention, proposition de bascule de facturation à l'acte avec justification (scénario P5) ; facturation journalière automatique des lignes de séjour.
10. **Bloc opératoire** : programmation (salle, équipe, durée), check-list OMS de sécurité chirurgicale (formulaire FORM), compte rendu opératoire, anesthésie (formulaire), consommables liés au stock (armoire du bloc).
11. **Lettre de sortie** générée à partir du dossier (diagnostics, traitements, résultats clés, consignes, rendez-vous de contrôle) ; ordonnance de sortie ; facturation consolidée.
12. **Blocage de sortie impayée** configurable, jamais contre une décision médicale tracée.

## Hors connexion

Tour de soins et administrations entièrement hors connexion sur tablette ; périmètre de sync : tous les patients hospitalisés du service de l'utilisateur. Conflit de lit (deux admissions sur le même lit) : `first_wins`, la seconde est mise en file d'attribution.

## Commandes

`admission.create`, `bed.assign`, `bed.release`, `bed.set_status`, `transfer.record`, `discharge.record`, `care_task.plan`, `care_task.complete`, `medication_administration.record`, `fluid_balance.record`, `surgery.book`, `surgery_checklist.complete`, `operative_report.create`.

## Permissions ajoutées

`admission:*`, `bed:*`, `care_task:*`, `surgery:*`, `discharge:*`. Rôles modèles ajoutés : `ward_nurse`, `surgeon`, `anesthetist`.

## Indicateurs

Taux d'occupation, durée moyenne de séjour, rotation des lits, dépassements de forfait, mortalité hospitalière, réadmissions à 30 jours.

## Critères d'acceptation

Scénario P5 ; tour de soins complet hors connexion sur deux tablettes sans perte ; facture de séjour exacte avec bascule de forfait.
