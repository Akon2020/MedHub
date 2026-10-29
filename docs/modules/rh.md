# Module RH : personnel, plannings et gardes

- **Phase** : 2
- **Dépend de** : CORE
- **Hors périmètre** : paie et gestion RH complète.

## Capacités

1. **Fiches du personnel** : identité professionnelle, fonction, qualifications, numéro d'ordre, service, contrat (type, dates), contacts d'urgence, documents (diplômes, autorisations), lien avec le compte utilisateur (optionnel : tout le personnel n'utilise pas l'application).
2. **Plannings** : modèles de rotation (jour, nuit, garde, astreinte), affectation par service, vue mensuelle, détection des conflits et des repos insuffisants (règles configurables).
3. **Gardes** : tableau des gardes, médecin de garde par service visible dans l'application, échanges de garde avec validation.
4. **Présences** : pointage (saisie manuelle ou par connexion au poste), absences, congés (demande et validation), export pour la paie externe.
5. **Lien avec les agendas** RDV (indisponibilités automatiques) et avec les délégations d'accès (CORE).

## Commandes

`shift.assign`, `shift.swap_request`, `shift.swap_approve`, `attendance.record`, `leave.request`, `leave.decide`.

## Indicateurs

Effectif par service et par créneau, heures planifiées et réalisées, absentéisme, couverture des gardes.
