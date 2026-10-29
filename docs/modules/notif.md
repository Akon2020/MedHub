# Module NOTIF : notifications, messages, documents et impression

- **Phase** : MVP (S9 pour les documents cliniques, S13 pour les messages)
- **Dépend de** : CORE

## 1. Centre de notifications

- Notifications dans l'application (`notification`), affichées dans l'en-tête, marquables comme lues, synchronisées.
- Événements : résultat validé, valeur critique, demande d'approbation, accord préalable décidé, alerte de stock, conflit de synchronisation, rappel de régularisation de bon d'envoi, annonce de la plateforme, état d'abonnement.
- Préférences par utilisateur (canal par type d'événement, dans les limites fixées par la structure).

## 2. Messages sortants (SMS, courriel, WhatsApp en phase 2)

- Modèles (`message_template`) par événement, canal et langue, avec variables (`{{patient.prenom}}`, `{{rdv.date}}`, `{{structure.nom}}`, `{{structure.telephone}}`).
- **Règle absolue** : aucun diagnostic, résultat, nom d'examen ou de médicament dans un SMS ou un courriel envoyé à un patient.
- Envoi par job (`outbound_message`), idempotent, relances, journal de livraison, coût SMS compté (`usage_counter`) pour la facturation des dépassements.
- Déclencheurs MVP : rappel de rendez-vous, résultat disponible, relance de facture échue, rappel de programme chronique (perdu de vue), réinitialisation de mot de passe, alertes de sécurité aux administrateurs.
- Fenêtre d'envoi configurable (pas de SMS entre 21 h et 7 h).
- Désinscription des messages non transactionnels.

## 3. Modèles de documents imprimés

- `document_template` par type : ordonnance, certificat médical, arrêt de travail, facture, reçu, résultat de laboratoire, carte patient, ticket de file, lettre de référence, compte rendu de consultation, bon d'envoi interne, rapport de clôture de caisse ; phase 2 : lettre de sortie, compte rendu opératoire, carnet de vaccination.
- Contenu : mise en page déclarative en JSON (blocs : en-tête avec logo, bloc identité, tableau de lignes, texte avec variables, QR, signature, pied de page, mentions légales), formats A4, A5, 80 mm, langue.
- Éditeur en ligne avec aperçu sur données fictives ; versionné ; publication.
- Rendu côté client par `@react-pdf/renderer` (chargé à la demande) : impression hors connexion. Rendu serveur possible pour les envois par courriel (même moteur de mise en page, exécuté en Node).
- **QR de vérification** sur ordonnance, certificat et résultat : contient `{MEDHUB_BASE_URL}/v/{code}`. La page publique de vérification confirme seulement l'authenticité (structure, date, type de document, empreinte) sans aucune donnée de santé. Hors connexion, le code est généré localement et enregistré à la synchronisation.
- Les mentions légales viennent de la configuration de la structure (vides par défaut).

## Commandes de synchronisation

`notification.mark_read`, `document.print` (trace d'impression dans l'audit), `verification_code.register`.

## API

`/api/v1/notifications`, `/message-templates`, `/outbound-messages`, `/document-templates`, `/v/:code` (public, sans authentification, limité en débit).

## Critères d'acceptation

- Impression d'une ordonnance hors connexion sur A5 avec QR, vérification en ligne après synchronisation.
- Aucun SMS contenant un terme clinique (test de contenu des modèles par défaut).
