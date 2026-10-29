# Module RDV : rendez-vous, accueil et files d'attente

- **Phase** : MVP (S7)
- **Dépend de** : PAT

## Capacités

1. **Agendas** par professionnel, service, salle ou équipement : modèles hebdomadaires (`schedule_template`), exceptions (congés, fermetures, plages supplémentaires), durée par type de rendez-vous, jours de garde.
2. **Prise de rendez-vous** à l'accueil (et via le portail patient en phase 2), avec recherche du premier créneau libre, surréservation contrôlée (`overbook_max`), liste d'attente.
3. **Rendez-vous récurrents** pour les programmes chroniques (création d'une série).
4. **Annulation** avec motif, détection des absences répétées (compteur affiché dans le bandeau patient).
5. **Rappels** par SMS ou WhatsApp (fournisseur configurable), modèle éditable, envoi J-1 à heure configurable (job), sans information médicale.
6. **Visites** : création de l'`encounter` à l'arrivée (avec ou sans rendez-vous), choix du service, type de visite, couverture.
7. **Files d'attente** par service : ticket numéroté (préfixe par file), priorité (urgence, personne âgée, femme enceinte, enfant, normal), temps d'attente affiché, appel par le soignant (salle), statut.
8. **Écran d'appel** pour salle d'attente (`/app/ecran-appel/:queueId`, plein écran, tablette ou téléviseur), affichant les numéros appelés et la salle ; mise à jour par interrogation locale (l'écran est lui-même un appareil enregistré) toutes les 5 secondes.
9. **Urgences 24 h sur 24** : enregistrement minimal (patient provisoire possible) et priorité maximale.
10. **Triage** : motif principal, priorité, constantes (saisies via DPI), orientation.

## Règles de gestion

- Ordre de la file : priorité, puis heure d'arrivée. Une priorité « urgence » passe toujours en tête.
- Un ticket n'est pas supprimé : il passe à `left` (parti sans être vu) avec heure.
- Conflit de créneau hors connexion : `first_wins` (`docs/02-offline-sync.md`).
- Le paiement avant soins est un réglage du parcours (`workflow.pay_before_consultation`) : si actif, le ticket n'est appelable qu'après encaissement ou vérification de prise en charge.

## Configurable

Types de rendez-vous et durées, modèles d'agenda, surréservation, délais de rappel, modèles de messages, files et préfixes, règles de priorité, écran d'appel (texte d'accueil, langue, son).

## Commandes de synchronisation

`appointment.book` (`first_wins`), `appointment.reschedule`, `appointment.cancel`, `appointment.mark_arrived`, `appointment.mark_no_show`, `encounter.open`, `encounter.update_status`, `encounter.close`, `queue_ticket.issue`, `queue_ticket.call` (`first_wins` sur statut), `queue_ticket.start_service`, `queue_ticket.complete`, `queue_ticket.mark_left`, `triage.record` (`append_only`).

## API

`/api/v1/schedules`, `/api/v1/appointments`, `/api/v1/appointments/availability?resource=&from=&to=`, `/api/v1/encounters`, `/api/v1/queues`, `/api/v1/queue-tickets`.

## Écrans

Agenda (vue jour, semaine, par ressource), prise de rendez-vous, accueil du jour, files (`/app/files`), écran d'appel, triage.

## Indicateurs

Temps d'attente moyen par service, taux d'absence, taux d'occupation des agendas, patients partis sans être vus.

## Critères d'acceptation

- Deux postes hors connexion réservent le même créneau : un seul gagne, l'autre est notifié avec proposition.
- File fonctionnelle hors connexion sur un poste ; l'écran d'appel reflète les appels du même poste immédiatement et ceux des autres postes après synchronisation.

## Points d'accroche

`appointment.source = 'portal'` (PORT, phase 2), ressource `equipment` (IMG), téléconsultation (`encounter.kind = 'teleconsult'`, phase 3).
