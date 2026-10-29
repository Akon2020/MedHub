# Module SADM : portail super-admin, abonnements, portail client

- **Phase** : MVP (S14), version complète ; newsletter et analyses avancées reportables (liste de repli)
- **Dépend de** : aucun (module plateforme)
- **Accès** : `/admin`, comptes plateforme (`is_platform_staff`), 2FA obligatoire, liste blanche d'IP optionnelle, en ligne seulement, `withPlatformScope()`.

## 1. Fonctions du portail

| Domaine | Fonctions |
| --- | --- |
| Tableau de bord | Structures actives, essais en cours, revenu récurrent mensuel, créances, incidents, appareils actifs, versions client déployées |
| Structures | Création (code de structure, type, modèle, contacts), activation, désactivation, suspension, archivage ; fiche complète (identité, contacts, modules, plan, historique, appareils, utilisateurs, volumes, état de sync) |
| Plans et modules | Catalogue des plans, modules, limites, options, prix par devise, modèles de structure |
| Modules par structure | Ajout et retrait avec dates d'effet, quotas, prorata, contrôle des dépendances |
| Abonnements et licences | Cycle de vie, essais, renouvellements, jetons signés, révocation, historique |
| Facturation plateforme | Factures, avoirs, paiements, relances, remises, coupons, export comptable |
| Support | Tickets, base de connaissances, prise en main consentie, état du service |
| Communication | Newsletter, annonces dans l'application, bannières de maintenance, notifications ciblées |
| Supervision | Santé du service, erreurs, jobs en retard, synchronisation par structure, stockage, consommation |
| Sécurité | Règles d'IP, événements de sécurité, comptes plateforme, sessions |
| Sauvegardes | Planification, rétention, vérification, restauration globale ou par structure, rapports de test |
| Catalogues globaux | Diagnostics, médicaments, examens, listes administratives, modèles de formulaires et de documents, traductions |
| Journal et conformité | Audit des actions de la plateforme, exports |
| Paramètres | Taux de change de référence, fournisseurs (SMS, courriel, paiement), modèles de messages plateforme, seuils du cycle d'impayé, clés de signature (rotation) |

## 2. Cycle de vie d'une structure

| État | Déclencheur (paramétrable) | Effets | Communication |
| --- | --- | --- | --- |
| `prospect` | Création | Aucun accès | Courriel de bienvenue |
| `trial` | Activation de l'essai (30 j) | Modules choisis, limites (ex. 100 dossiers) | Rappels J+15, J+25, J+29 |
| `active` | Paiement reçu ou contrat signé | Plein accès selon plan et modules | Facture et reçu |
| `past_due` | Échéance dépassée (J+0) | Plein accès, bannière d'information | Rappels J+3, J+7 |
| `grace` | J+15 | Plein accès, avertissement ; pas de création de module ni d'utilisateur | Avertissement formel |
| `read_only` | J+30 | Consultation, impression, export, saisies d'urgence tracées ; création de dossiers et facturation courante suspendues | Notification aux administrateurs et au contact de facturation |
| `suspended` | J+60 | Connexion limitée à l'export et à la régularisation | Mise en demeure |
| `terminated` puis `archived` | Résiliation ou fin de conservation | Export final remis ; données conservées selon contrat ; suppression uniquement sur décision explicite double validée | Confirmation écrite |

**Règle absolue** : accès d'urgence et export complet jamais bloqués ; aucune suppression automatique ; dérogation datée possible (prolongation, plan de paiement).

Implémentation : machine à états pure (`packages/domain/src/sadm/tenant-lifecycle.ts`) avec horloge injectée, job quotidien de transition, émission d'un nouveau jeton de licence à chaque transition. En lecture seule, les commandes refusées renvoient `LICENSE_READ_ONLY` (sauf liste blanche : bris de glace, lecture, impression, export, saisies cliniques d'urgence marquées).

## 3. Essais

Durée, modules et limites par offre d'essai (`trial_offer`), limitation par volume, prolongation manuelle motivée, conversion en un clic, contrôle anti-abus (une seule période par téléphone, courriel, numéro d'identification, nom légal), fin d'essai sans paiement : lecture seule puis suspension, export toujours possible.

## 4. Licences

- Jeton JWS Ed25519 (`docs/02-offline-sync.md` section 9), renouvelé à chaque synchronisation, vérifiable hors connexion.
- Rotation de clés planifiée (plusieurs `kid` acceptés), révocation immédiate en cas de suspension, historique (`license_token`).
- Dépassement de limites : alerte et proposition de montée en gamme, pas de blocage brutal (blocage seulement à la création d'utilisateurs ou de sites au-delà de 110 % de la limite).

## 5. Facturation de la plateforme

- Tarifs par plan, module, option (`plan_price`), USD avec équivalent CDF au taux du jour ; périodicité mensuelle, trimestrielle, annuelle.
- Génération automatique à l'échéance (job), numérotation séquentielle continue (plateforme, en ligne), mentions légales de l'émetteur configurées (`TODO(medhub-decision)`), PDF envoyé par courriel et visible dans le portail client.
- Prorata d'ajout ou de retrait de module (au jour près), avoirs, remise annuelle, coupons, offre pilote.
- Paiements : agrégateur mobile money et carte (adaptateur, rapprochement par webhook et vérification périodique), virement et paiement manuel avec preuve téléversée validée par le super-admin.
- Relances automatiques selon le cycle (courriel, SMS, notification), modèles éditables.
- Échéanciers négociés et dérogations tracés.
- États : revenu récurrent, facturé et encaissé, créances par ancienneté, désabonnement, valeur vie client ; export comptable CSV et Excel.

## 6. Supervision

Santé (disponibilité, temps de réponse, erreurs, jobs), par structure (utilisateurs actifs, appareils, dernière sync, retard, conflits, espace, version), alertes configurables, page d'état publique (`/statut`) et gestion des incidents avec historique.

## 7. Sécurité et IP

Règles d'IP (`docs/03-multitenant-securite.md` section 7), blocage automatique après seuils d'abus, événements de sécurité, comptes plateforme et sessions.

## 8. Sauvegardes

Interface sur `backup_job` et `backup_artifact` (`docs/09-hebergement-deploiement.md` section 7) : planification, rétention, vérification, rapport du test de restauration mensuel, restauration par structure avec double validation, export de portabilité.

## 9. Newsletter et annonces

Segmentation (type, plan, module, état, région, langue), éditeur avec modèles, planification, envoi test, suivi des ouvertures et désabonnements, séparation transactionnel et marketing (désabonnement obligatoire pour le marketing). Annonces dans l'application ciblées par structure ou rôle (maintenance, nouvelle version, formation).

## 10. Support

Billetterie (création depuis l'application avec diagnostic de synchronisation joint, par courriel, ou saisie d'un échange téléphonique ou WhatsApp), priorités et délais selon le plan, affectation, notes internes, historique par structure, base de connaissances fr et en par rôle, prise en main consentie (durée limitée, bandeau, traçabilité), satisfaction et indicateurs (délai de première réponse, délai de résolution, motifs récurrents).

## 11. Portail client « Mon compte MedHub »

Accessible dans l'application de la structure (`/app/mon-compte`, permission `account:read`), distinct des finances internes de la structure.

| Rubrique | Contenu |
| --- | --- |
| Abonnement | Plan, modules actifs, limites et consommation (utilisateurs, stockage, SMS), prochaine échéance, état du compte |
| Total dépensé | Cumul depuis l'ouverture, par année, trimestre, mois et module, USD et CDF, graphique |
| Dettes et solde | Montant dû, factures échues, ancienneté, pénalités éventuelles, avoirs et crédits |
| Factures | Liste filtrable, statut, PDF, paiement en ligne |
| Paiements | Historique, preuves, reçus |
| Relevé de compte | Sur période, export PDF et Excel |
| Prévisions | Échéances à venir, simulation d'ajout de module (prix et prorata) |
| Changement d'offre | Montée en gamme immédiate avec prorata, descente en fin de période, ajout ou retrait de module |
| Alertes | Avant échéance, impayé, dépassement de limite, fin d'essai |
| Support | Tickets, guides |

Les données affichées sont lues hors connexion depuis la dernière copie synchronisée (avec date) ; le paiement et le changement d'offre exigent la connexion.

## Données

`plan`, `plan_price`, `module`, `tenant_module`, `subscription` (tenant, plan, période, statut, dates), `subscription_item` (module ou option, quantité, prix, dates), `license_token`, `trial_offer`, `coupon`, `platform_invoice`, `platform_invoice_line`, `platform_payment` (méthode, référence, preuve, statut, validé par), `dunning_event`, `usage_counter`, `ticket`, `ticket_message`, `kb_article`, `newsletter`, `newsletter_send`, `announcement`, `ip_rule`, `security_event`, `backup_job`, `backup_artifact`, `platform_audit_log`.

## Critères d'acceptation

- Scénario P6 complet avec horloge simulée.
- Une structure ne voit jamais les données d'abonnement d'une autre.
- Toute action du super-admin sur une structure apparaît dans le journal visible par cette structure.
