# 08. Parcours métier et scénarios d'acceptation

Ces scénarios servent de tests de bout en bout (Playwright) et de critères de recette du pilote. Chaque scénario doit passer **en ligne et avec une coupure réseau** au moment indiqué.

## P1. Consultation externe avec coupure réseau (MVP, S9 puis S14)

1. **Accueil** : la réceptionniste cherche « Mukendi » ; le patient enregistré « Moukendi » apparaît (tolérance phonétique). Elle vérifie la couverture (convention modèle B, plafond restant), crée la visite en médecine générale, imprime le ticket.
2. **Caisse** (si la structure exige le paiement avant soins) : la consultation est ajoutée au panier ; part patient nulle car incluse au forfait.
3. **Coupure réseau** : le poste de triage passe hors connexion (`context.setOffline(true)`).
4. **Triage** : l'infirmière saisit température, poids, taille, tension. Le poids apparaît sur la courbe. Une valeur impossible déclenche la demande de confirmation.
5. **Consultation** : le médecin (poste hors connexion) ouvre le résumé, voit l'allergie à l'amoxicilline. Il prescrit de l'amoxicilline : alerte bloquante, il choisit un autre antibiotique. Il demande une goutte épaisse.
6. **Retour du réseau** : synchronisation automatique ; zéro opération rejetée ; le serveur contient le triage, la note signée, la prescription et la demande.
7. **Laboratoire** : saisie du résultat, validation technique puis biologique par une autre personne. Le médecin est notifié.
8. **Pharmacie** : dispensation de l'ordonnance ; stock décrémenté par mouvement ; couverture forfaitaire appliquée.
9. **Caisse** : seule la part non couverte reste à payer ; encaissement en CDF d'une facture en USD au taux du jour ; reçu.
10. **Clôture de caisse** à 17 h : écart nul ou justifié.
11. **Direction** : le tableau de bord affiche la visite, la recette et le mouvement de stock.

Vérifications : chronologie du patient complète et ordonnée ; audit présent pour chaque écriture et chaque ouverture de dossier ; aucune donnée de santé dans les journaux.

## P2. Deux postes modifient le même patient hors connexion (MVP, S6)

1. Poste A et poste B hors connexion.
2. A corrige le téléphone ; B corrige l'adresse ; B ajoute une allergie ; A ajoute un antécédent.
3. Reconnexion des deux postes dans un ordre quelconque.
4. Résultat : téléphone de A, adresse de B, allergie et antécédent présents, historique des champs conservé, zéro conflit à revoir.
5. Variante : A et B corrigent tous deux la date de naissance ; résultat : valeur au HLC le plus récent, un conflit `needs_review` créé et visible pour l'administrateur.

## P3. Doublon créé hors connexion (MVP, S6)

1. Poste A crée « Kabila Jean, 12/03/1990, 0991234567 » hors connexion ; poste B crée « Kabila Jean, 1990, 0991234567 » hors connexion.
2. Synchronisation : deux dossiers créés, un `duplicate_candidate` avec score élevé.
3. Un utilisateur habilité compare et fusionne (en ligne) ; validation par un second utilisateur si configuré.
4. Les deux chronologies sont réunies sous le survivant ; le dossier fusionné pointe vers lui ; annulation de la fusion possible.

## P4. Convention d'entreprise, modèle Open Clinic (MVP, S11)

1. Création du tiers payant « Entreprise Démo SARL » et d'une convention modèle B (75 USD par famille et par mois, 5 jours d'hospitalisation forfaitaire, garantie 75 USD par travailleur).
2. Import de la liste de 40 agents et de leurs ayants droit ; encaissement des garanties.
3. Un agent arrive avec un bon d'envoi signé : consultation et examens inclus, part patient nulle.
4. Un scanner est demandé : exclu avec accord préalable ; la caisse bloque et propose « Demander l'accord » ; l'accord est enregistré ; la facturation au tiers est alors autorisée pour le montant accordé.
5. Urgence de nuit sans bon d'envoi : prise en charge sur présentation de la carte de service ; régularisation exigée sous 72 heures (configurable) ; alerte si non fournie.
6. Journalier d'un sous-traitant : urgence facturée hors forfait, rattachée à son billet d'envoi.
7. Fin de mois : génération de la facture mensuelle consolidée le 25 (configurable) : forfaits (tout mois commencé dû), hors forfaits, journaliers, détail par bénéficiaire et par acte.
8. Rejet partiel par l'entreprise : motif enregistré, correction, refacturation, paiement partiel suivi.
9. Résiliation : restitution des garanties, solde de tout compte.

## P5. Dépassement de forfait d'hospitalisation (phase 2, avec HOSP)

1. Patient couvert modèle A (3 jours) hospitalisé.
2. À J+2, alerte à l'approche de la durée forfaitaire.
3. À J+4, bascule de la facturation à l'acte pour le séjour et les actes ; justification obligatoire saisie.

## P6. Cycle d'abonnement (MVP, S14)

1. Le super-admin crée une structure en essai 30 jours limité à 100 dossiers.
2. Rappels à J+15, J+25, J+29 ; conversion en abonnement Clinique+ avec trois modules.
3. Facture générée à l'échéance ; non payée ; rappels J+3 et J+7 ; grâce à J+15 (bannière, création d'utilisateurs et de modules bloquée) ; lecture seule à J+30 (consultation, impression, export, saisies d'urgence tracées ; création de dossiers et facturation courante suspendues) ; suspension à J+60 (connexion limitée à l'export et à la régularisation).
4. Hors connexion, un poste applique le même cycle à partir du jeton de licence.
5. À toute étape : bris de glace et export restent disponibles.
6. Paiement manuel avec preuve ; validation super-admin ; retour à l'état actif ; nouveau jeton de licence distribué à la synchronisation.

## P7. Appareil perdu (MVP, S5)

1. L'administrateur déclare la tablette « Triage 2 » perdue.
2. À sa prochaine connexion, la tablette tente d'envoyer son outbox (si la politique l'autorise) puis efface sa base locale.
3. L'audit enregistre la révocation et l'effacement.

## P8. Pharmacie : stock négatif après synchronisation tardive (MVP, S12)

1. Deux postes hors connexion dispensent chacun 10 unités d'un produit dont le stock est 15.
2. Synchronisation : les deux dispensations sont acceptées ; stock à -5 ; alerte de régularisation `PHAR_NEGATIVE_STOCK` au pharmacien ; inventaire ou réception corrective proposés.

## P9. Patient chronique perdu de vue (MVP, S8 pour le programme, S13 pour l'alerte)

1. Patient inscrit au programme hypertension, rendez-vous tous les 30 jours.
2. Rendez-vous non honoré ; après le délai configuré (14 jours), le patient apparaît dans la liste « perdus de vue » avec téléphone et dernier contact.
3. Rappel SMS envoyé selon le modèle (sans information médicale).

## P10. Bris de glace (MVP, S8)

1. Un médecin d'un autre service ouvre un dossier marqué `restricted`.
2. Motif obligatoire ; accès limité à 4 heures ; notification au responsable ; entrée dans le tableau de revue.
3. Le même scénario fonctionne hors connexion pour un dossier présent sur l'appareil, et en état « suspendu » de la structure.
