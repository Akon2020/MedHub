# Module CONV : conventions, forfaits et assurances

- **Phase** : MVP (S11)
- **Dépend de** : FACT
- **Cœur financier de MedHub.** Il doit reproduire sans programmation les contrats observés chez Open Clinic asbl (Kinshasa) et en permettre d'autres.

## 1. Cas de référence : Open Clinic asbl

| Modèle | Nom commercial | Prix | Hospitalisation forfaitaire | Particularités |
| --- | --- | --- | --- | --- |
| A | KITOKO (Bien-être) | 55 USD par famille et par mois | 3 jours | Plateau minimum : laboratoire de base, échographie obstétricale, ECG. Accouchements, maladies chroniques et grandes chirurgies exclus. |
| B | SEPELA (Joie de vivre) | 75 USD par famille et par mois | 5 jours | Plateau semi-complet : accouchements, radios standards, échographies courantes, 3 maladies chroniques incluses. |
| C | ELENGI (Mieux vivre) | 100 USD par famille et par mois | 7 jours | Plateau complet : césarienne, spécialités, kinésithérapie, soins dentaires, verres, laboratoire étendu. |
| D | À facturer | Facturation à l'acte | Durée moyenne de 3 jours | Facture disponible au plus tard le 25 du mois. Caution de 100 USD par travailleur. Médecin-conseil pour l'orientation. |

Ces quatre modèles sont fournis comme **modèles de démonstration** (seeds) et comme **jeux d'essai** obligatoires. Leurs listes détaillées d'actes inclus et exclus sont saisies par l'administrateur (les montants et listes réels du pilote seront importés).

## 2. Objets configurables

| Objet | Table | Contenu |
| --- | --- | --- |
| Tiers payant | `payer` | Type (`company`, `insurer`, `mutual`, `ngo`, `public_program`), nom, contacts, modalités de facturation, délai de paiement, format d'export, médecin-conseil |
| Convention | `contract` | Tiers, dates, statut (`draft`, `active`, `suspended`, `terminated`), devise, modèle de forfait, mode de facturation (`per_act`, `family_monthly_package`, `per_case_package`), garantie par travailleur, jour de génération de la facture (25 par défaut), délai de régularisation du bon d'envoi (72 h), version des règles |
| Modèle de forfait | `contract_plan` | Code (A, B, C, D...), nom commercial, prix, périmètre, durée d'hospitalisation forfaitaire, plafonds, règles |
| Règle de couverture | `coverage_rule` (JSONB versionné dans `contract_plan.rules`) | Pour un acte, une catégorie, un service ou un examen : `included`, `excluded`, `percent`, `capped`, `prior_authorization` |
| Bénéficiaires | `beneficiary` | Matricule, nom, rôle (titulaire, conjoint, enfant, autre ayant droit), famille, dates d'entrée et de sortie, statut ; lien au patient (`patient_coverage`) |
| Mouvements | `beneficiary_movement` | Entrée, sortie, changement, avec date d'effet et source (import, saisie) |
| Bon d'envoi | `referral_voucher` | Numéro, signataire, date, pièce scannée, bénéficiaire, validité, actes liés |
| Accord préalable | `prior_authorization` | Demande, pièces jointes, décision du tiers, montant autorisé, validité, actes liés |
| Garantie | `guarantee` | Montant par travailleur, encaissement, restitution |
| Facture au tiers | `payer_invoice`, `payer_invoice_line` | Période, forfaits, hors forfaits, journaliers, détail par bénéficiaire et par acte, statut, paiements |
| Rejet | `payer_claim_rejection` | Ligne, motif, correction, refacturation |

## 3. Représentation des règles

Stockées en JSON, validées par Zod (`packages/conventions/src/schema.ts`), versionnées. Exemple :

```json
{
  "plan": "B",
  "currency": "USD",
  "billing": "family_monthly_package",
  "price": 7500,
  "guaranteePerWorker": 7500,
  "hospitalization": { "packageDays": 5, "beyond": "bill_per_act", "justificationRequired": true },
  "caps": [{ "scope": "beneficiary", "period": "year", "amount": 200000, "categories": ["drug"] }],
  "copay": [{ "category": "drug", "patientPercent": 0 }],
  "rules": [
    { "match": { "category": "consultation", "specialties": ["general_surgery", "dentistry", "gynecology", "pediatrics"] }, "coverage": "included" },
    { "match": { "category": "specialized_surgery" }, "coverage": "excluded", "priorAuthorization": true },
    { "match": { "serviceCodes": ["CT_SCAN", "MRI", "EEG"] }, "coverage": "excluded", "priorAuthorization": true },
    { "match": { "category": "delivery" }, "coverage": "included" }
  ],
  "default": { "coverage": "excluded", "action": "warn" }
}
```

Montants en unités mineures (7500 = 75,00 USD).

## 4. Moteur (`packages/conventions`)

Fonction pure et déterministe :

```ts
evaluateCoverage(input: {
  plan: PlanRules; ruleVersion: string;
  line: { serviceItemId; serviceCode; category; department; specialty?; quantity; unitPrice; currency; performedAt };
  beneficiary: { role; status; validFrom; validUntil };
  consumption: { byCap: Record<string, number>; hospitalDaysUsed: number };
  context: { emergency: boolean; voucher?: VoucherStatus; priorAuthorization?: PriorAuthStatus; isDayLaborer: boolean };
}): {
  decision: 'covered' | 'partially_covered' | 'not_covered' | 'blocked' | 'needs_prior_authorization';
  patientShare: number; thirdPartyShare: number;
  matchedRule: string | null; reasons: string[]; warnings: string[];
  requires: ('voucher' | 'prior_authorization' | 'justification')[];
}
```

Ordre d'évaluation : validité du bénéficiaire, bon d'envoi (ou exception d'urgence), journalier (hors forfait), règle la plus spécifique (code de service, puis catégorie et spécialité, puis catégorie, puis défaut), accord préalable, plafonds et consommation, ticket modérateur et franchise, arrondis. La trace complète est enregistrée sur la ligne de facture.

## 5. Règles de gestion supportées

- Forfait mensuel par famille : tout mois commencé est dû ; paiement à terme échu ; facturation différée en fin de mois.
- Durée forfaitaire d'hospitalisation par modèle (3, 5, 7 jours) et bascule à l'acte au-delà avec justification obligatoire (alerte à J-1, avec HOSP en phase 2 ; au MVP, compteur de jours sur les visites `inpatient` simples).
- Actes inclus, exclus, hors convention : **blocage ou avertissement** à la caisse selon la règle, bouton « Demander l'accord préalable ».
- Prise en charge d'urgence sur présentation de la carte de service, régularisation par bon d'envoi sous délai configurable, alerte de régularisation en retard.
- Bon d'envoi signé : numéro, signataire, date, scan, lien aux actes.
- Journaliers de sous-traitants : urgences contre billet d'envoi, facturées hors forfait.
- Facture mensuelle consolidée par convention, détail par bénéficiaire et par acte, générée à la date configurée (job).
- Plafonds annuels ou par événement, par bénéficiaire et par famille, consommation visible à l'accueil.
- Ticket modérateur et franchise par catégorie.
- Liste des bénéficiaires tenue à jour à chaque mouvement de personnel (import de fichier de l'entreprise avec rapport des différences).
- Garantie remboursable à la résiliation.
- Sous-traitance de certains actes avec refacturation ; rôle de médecin-conseil (validation au portail partenaire en phase 2 ; au MVP, enregistrement manuel de sa décision).
- **Simulation** avant activation : scénarios d'actes, répartition patient et tiers, règle appliquée.
- **Contentieux** : factures rejetées, motifs, correction, refacturation, paiements partiels.

## 6. Hors connexion

- Conventions publiées, plans, règles, bénéficiaires actifs et consommations connues sont synchronisés.
- Le moteur s'exécute localement : la caisse fonctionne hors connexion.
- La consommation des plafonds peut être en retard entre postes : le serveur recalcule à la synchronisation ; un dépassement découvert tardivement crée une alerte de régularisation (jamais d'annulation silencieuse d'une ligne).
- Demande d'accord préalable : créée hors connexion, envoyée à la synchronisation ; la décision est saisie en ligne.

## Commandes de synchronisation

`referral_voucher.register`, `prior_authorization.request`, `prior_authorization.record_decision` (en ligne), `beneficiary.link_patient`, `coverage.emergency_override` (avec motif), `guarantee.receive`, `guarantee.refund`. Configuration des conventions et imports : en ligne.

## API

`/api/v1/payers`, `/contracts`, `/contracts/:id/plans`, `/contracts/:id/simulate`, `/contracts/:id/activate`, `/beneficiaries`, `/beneficiaries/import`, `/referral-vouchers`, `/prior-authorizations`, `/guarantees`, `/payer-invoices`, `/payer-invoices/:id/send`, `/payer-invoices/:id/payments`, `/payer-claim-rejections`.

## Écrans

Liste des conventions, assistant de convention (tiers, modèle, règles, bénéficiaires, garantie, simulation, activation), éditeur de règles en tableau (pas d'édition JSON pour l'utilisateur), bénéficiaires, accords préalables (file), factures aux tiers, contentieux, tableau de bord des tiers (encours, délai moyen de paiement).

## Critères d'acceptation

- Scénario P4 complet.
- Jeux d'essai A à D (`docs/10-tests-qualite.md`) : 100 % de réussite.
- Une modification de règle publiée n'affecte pas les lignes déjà facturées (trace de version).

## Points d'accroche

Portail partenaire et médecins-conseils (phase 2), échanges électroniques avec assureurs (phase 2), dépassement de forfait avec HOSP (phase 2).
