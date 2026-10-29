# Module MPAY : mobile money intégré

- **Phase** : 2 (paiement d'abonnement par agrégateur possible dès le MVP si le fournisseur est choisi)
- **Dépend de** : FACT
- **Prérequis** : choix de l'agrégateur couvrant la RDC (FlexPay ou équivalent, à confirmer selon couverture et conditions). `TODO(medhub-decision)`.

## Capacités

1. **Encaissement patient intégré** : depuis la caisse ou le portail patient, demande de paiement poussée sur le téléphone du patient (M-Pesa, Orange Money, Airtel Money) via l'agrégateur ; statut suivi par webhook et par vérification périodique (job) ; reçu automatique à la confirmation.
2. **Paiement d'abonnement** de la plateforme par la structure (SADM), même mécanisme.
3. **Rapprochement** : quotidien entre encaissements déclarés et relevés de l'opérateur ou de l'agrégateur (import de fichier ou API), écarts signalés.
4. **Contrôle des doublons** de référence de transaction.
5. **Remboursements** si l'agrégateur le permet, sinon procédure manuelle tracée.

## Technique

- Interface `PaymentProvider` (`docs/01-architecture.md` section 8) : `createPayment({ amount, currency, msisdn, reference, idempotencyKey })`, `getPaymentStatus(id)`, `verifyWebhook(req)`, `parseWebhook(req)`.
- Route de webhook `/api/v1/payments/webhooks/:provider` : vérification de signature, idempotence par identifiant de transaction, traitement par job.
- États : `initiated`, `pending`, `succeeded`, `failed`, `expired`, `reversed`.
- Un paiement mobile initié hors connexion n'est pas possible : la caisse propose alors la saisie manuelle (mode v1), rapprochée plus tard.
- Frais de l'agrégateur enregistrés pour le calcul des charges.

## Critères d'acceptation

Paiement de bout en bout avec l'environnement de test de l'agrégateur ; webhook rejoué deux fois sans double encaissement ; rapprochement d'un relevé de test avec un écart détecté.
