# Module PORT : portail patient (et portail partenaire)

- **Phase** : 2
- **Dépend de** : PAT (SHARE pour les consentements, MPAY pour le paiement)

## Portail patient

- **Adresse** : `/patient` sur la même application, interface légère (budget inférieur à 300 ko), utilisable sur smartphone d'entrée de gamme et à faible débit.
- **Connexion** : téléphone et code à usage unique par SMS, ou code famille et date de naissance (configurable par structure). Session courte.
- **Fonctions** :
  - prise et annulation de rendez-vous (créneaux ouverts au portail par la structure) ;
  - résultats d'examens (selon la politique de la structure : immédiat, après validation médicale, ou après consultation) ;
  - ordonnances, factures, solde, paiement (MPAY) ;
  - dossier résumé (allergies, traitements, vaccins), comptes rendus selon la politique ;
  - gestion des consentements (voir, accorder, restreindre, révoquer) ;
  - journal des accès à son dossier ;
  - comptes des proches (enfants, parents âgés) par délégation, avec vérification par la structure ;
  - préférences de notification.
- **Multi-structures** : un même patient voit ses données dans chaque structure MedHub où il est suivi (via `person_global`), chacune séparément sauf consentement.
- **Sécurité** : limitation de débit forte, aucune information médicale par SMS, téléchargements par liens à durée limitée.

## Portail partenaire (médecins-conseils, tiers payants)

- **Adresse** : `/partenaire`, comptes rattachés à un `payer`, 2FA obligatoire.
- **Fonctions** : file des accords préalables à décider, consultation des pièces, décision motivée ; consultation et validation des factures mensuelles ; contestation de lignes (alimente `payer_claim_rejection`) ; liste des bénéficiaires et mise à jour des mouvements par import ; tableau de consommation.
- Accès limité aux bénéficiaires de leurs conventions, aux données strictement nécessaires (codes d'actes, montants, diagnostics seulement si la convention le prévoit et avec consentement).

## Critères d'acceptation

Un patient prend un rendez-vous, voit son résultat validé, paie une facture ; un médecin-conseil décide un accord préalable qui débloque la facturation à la caisse.
