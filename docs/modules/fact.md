# Module FACT : tarification, facturation, caisse

- **Phase** : MVP (S10)
- **Dépend de** : PAT
- Les recettes de la structure en dépendent : exigence d'exactitude maximale.

## 1. Tarification

- **Nomenclature** (`service_item`) : consultations, actes, examens, hospitalisation (journée), produits, consommables, services ; codes et catégories ; import CSV.
- **Grilles** (`price_list`) multiples : public, privé, convention, étranger, personnel, indigent ; prix datés (`valid_from`, `valid_until`) avec historique ; une grille par devise ou prix multi-devises.
- **Choix du prix** (`packages/domain/src/fact/pricing.ts`) : grille de la couverture du patient, sinon grille du type de patient, sinon grille publique ; date de l'acte ; erreur explicite `FACT_NO_PRICE` si aucun prix (l'acte est quand même enregistré et signalé à la caisse).
- **Devises** : USD et CDF au minimum ; table `exchange_rate` datée (saisie quotidienne par un habilité ou reprise du taux de référence plateforme) ; règle d'arrondi par devise (`rounding_step`, ex. 50 CDF pour la caisse). La devise de facturation et la devise de paiement peuvent différer : le taux appliqué est celui du jour du paiement et il est enregistré dans le paiement.
- **Taxes et frais** configurables : TVA le cas échéant (désactivée par défaut, `TODO(medhub-decision)` sur les règles fiscales), frais de dossier, majorations de nuit, dimanche et jours fériés.

## 2. Facture panier

- Chaque acte réalisé (consultation clôturée, examen demandé ou réalisé selon configuration, dispensation, journée d'hospitalisation) ajoute automatiquement une ligne à la facture ouverte de la visite (pas de double saisie). Ajout manuel possible par la caisse avec permission.
- Chaque ligne passe par le **moteur de conventions** (CONV) qui calcule part patient et part tiers et enregistre sa trace (`coverage_decision`).
- Statuts : `open` → `finalized` (numérotée, imprimable, plus de nouvelles lignes ; un acte tardif ouvre une facture complémentaire) → `partially_paid` → `paid` ; `voided` uniquement par avoir total.
- **Annulation uniquement par écriture inverse** (`credit_note`), avec motif et approbation selon seuil.
- **Remises et exonérations** : demande avec motif, application selon `amount_max` du rôle ou approbation quatre yeux ; indigents : grille ou exonération avec justificatif.
- Impression : A4, A5 ou ticket 80 mm, modèles éditables, mentions légales configurées (vides par défaut).
- Numérotation hors connexion par appareil, numéro officiel optionnel à la synchronisation.

## 3. Encaissements

- Moyens : espèces, mobile money (v1 : saisie de l'opérateur, du numéro de transaction et du montant, contrôle de doublon de référence par opérateur ; phase 2 : intégration), carte (saisie de référence), chèque, virement, compensation (avec dépôt ou avoir).
- Multi-devises : payer une facture USD en CDF ou en mélange ; monnaie rendue calculée dans la devise choisie, avec arrondi.
- Dépôts, acomptes, cautions d'hospitalisation ; solde patient en temps réel ; imputation automatique (plus ancienne facture d'abord) ou manuelle.
- Reçu numéroté pour chaque paiement.
- Remboursement (`refund_out`) avec permission et motif.

## 4. Sessions et clôture de caisse

- Ouverture par caissier **et par appareil** avec fonds initial par devise.
- Tous les encaissements et sorties sont des `cash_movement` rattachés à la session.
- Clôture : comptage par devise et par moyen, montant théorique calculé, écart, justification obligatoire si écart non nul ; session close définitivement (pas de réouverture : un oubli fait l'objet d'un mouvement dans la session suivante avec motif).
- Rapprochement à la synchronisation : le serveur recalcule le théorique à partir des mouvements reçus et signale toute différence.
- Rapport de clôture imprimable ; récapitulatif journalier par caisse et par site pour la direction.

## 5. Contrôles anti-fraude (rapports et alertes)

Actes réalisés non facturés (consultation clôturée sans ligne, dispensation sans ligne) ; annulations répétées par un même utilisateur ; remises atypiques (montant, fréquence) ; écarts de caisse récurrents ; encaissements hors horaires ; références mobile money dupliquées.

## 6. Créances patients

Dettes, échéanciers (`payment_plan`), relances SMS (sans information médicale), plafond de crédit par patient, blocage configurable de la sortie d'un patient hospitalisé impayé **sauf décision médicale** (jamais de rétention d'un patient pour raison financière sans décision tracée), relevé de compte patient, balance âgée (0-30, 31-60, 61-90, plus de 90 jours).

## 7. Comptabilité de gestion simple

Ventilation des recettes par service, par centre de coût, par catégorie ; export CSV et Excel vers un logiciel comptable (journal des ventes, journal de caisse) ; pas de comptabilité générale.

## Règles de gestion clés

- Montants en entiers d'unité mineure ; arrondi uniquement au paiement en espèces, l'écart d'arrondi est une ligne explicite.
- Une facture finalisée est immuable.
- Le total d'une facture = somme de ses lignes (vérification à chaque écriture et test de propriété).
- Toute écriture financière est auditée.

## Commandes de synchronisation

| Commande | Stratégie |
| --- | --- |
| `invoice.open`, `invoice.add_line`, `invoice.finalize` | `immutable_ledger` |
| `credit_note.issue` | `immutable_ledger`, approbation selon seuil |
| `discount.request`, `discount.apply` | `immutable_ledger` |
| `payment.receive`, `payment.refund`, `payment.allocate` | `immutable_ledger` |
| `deposit.receive`, `deposit.apply` | `immutable_ledger` |
| `cash_session.open`, `cash_session.withdraw`, `cash_session.close` | `immutable_ledger` |
| `exchange_rate.set` | en ligne seulement |

Garde-fou serveur : `invoice.add_line` sur une facture déjà finalisée par un autre poste est transformée en ligne d'une facture complémentaire (`merged`), jamais rejetée (l'acte a eu lieu).

## API

`/api/v1/service-items`, `/price-lists`, `/prices`, `/taxes`, `/exchange-rates`, `/invoices`, `/invoices/:id/lines`, `/credit-notes`, `/payments`, `/deposits`, `/cash-registers`, `/cash-sessions`, `/receivables`, `/payment-plans`, `/reports/finance/*`.

## Écrans

Caisse (`/app/caisse`), facture du patient, session de caisse, clôture, tarifs (`/app/parametres/finances`), créances, rapports financiers.

## Critères d'acceptation

- P1 étapes 9 et 10 ; jeux d'essai caisse de `docs/10-tests-qualite.md`.
- Paiement d'une facture USD en CDF au taux du jour, arrondi correct, reçu exact.
- Clôture avec écart : justification obligatoire, rapport exact.

## Points d'accroche

MPAY (phase 2) : `payment.method = 'mobile_money'` avec `provider_payment_id`. HOSP : lignes de journée et dépassement de forfait. AMB (phase 3) : facturation des missions.
