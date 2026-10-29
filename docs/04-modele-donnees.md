# 04. Modèle de données

Ce document liste les entités et leurs colonnes clés. Les types précis, contraintes et index sont fixés dans le schéma Drizzle (`packages/db/src/schema/*.ts`). Toute divergence est reportée ici.

## 1. Conventions

- Clé primaire `id uuid` (UUID v7), générée côté client ou serveur. **Aucun auto-incrément** pour les entités synchronisées (seuls `change_log.seq`, `audit_log.seq` et les séquences internes en utilisent).
- Montants : `bigint` en unités mineures + `currency char(3)`. Table `currency` : `code`, `minor_unit` (USD 2, CDF 2), `symbol`, `rounding_step` (arrondi d'affichage et de caisse, ex. CDF 50).
- Taux de change : `numeric(18,6)`, datés.
- Horodatages : `timestamptz`, stockés en UTC. Dates civiles (naissance, échéance) : `date`.
- Énumérations : `text` + contrainte `CHECK` (plus simple à faire évoluer que les types `enum` PostgreSQL), valeurs listées dans `packages/shared/src/enums.ts`.
- Données configurables (formulaires, règles de convention, modèles de documents, extra du patient) : `jsonb` avec schéma Zod et colonne `schema_version`.
- Dossier médical : tables en ajout seul, correction par `supersedes_id`.
- Noms de tables au singulier, `snake_case`, en anglais.

### Colonnes communes des tables métier synchronisées

| Colonne | Type | Rôle |
| --- | --- | --- |
| `id` | uuid | UUID v7 |
| `tenant_id` | uuid not null | Structure (RLS) |
| `site_id` | uuid null | Site, si pertinent |
| `created_at`, `created_by` | timestamptz, uuid | Création |
| `updated_at`, `updated_by` | timestamptz, uuid | Dernière modification (tables mutables seulement) |
| `version` | integer not null default 1 | Incrémentée à chaque modification serveur |
| `device_id` | uuid null | Appareil d'origine |
| `hlc` | text | Horloge logique hybride de l'opération d'origine |
| `op_id` | uuid null | Dernière opération appliquée |
| `deleted_at`, `deleted_by`, `delete_reason` | | Suppression logique (jamais de `DELETE`) |

Les tables en ajout seul n'ont pas `updated_*` et ont en plus `supersedes_id uuid null`, `status` (`active`, `superseded`, `entered_in_error`).

## 2. Plateforme

| Table | Colonnes clés |
| --- | --- |
| `tenant` | id, code (unique, ex. HOP-KIN-0042), legal_name, display_name, type (`pharmacy`, `health_center`, `practice`, `laboratory`, `imaging_center`, `clinic`, `hospital`, `network`), status (`prospect`, `trial`, `active`, `past_due`, `grace`, `read_only`, `suspended`, `terminated`, `archived`), country (CD), default_locale, default_currency, timezone, logo_file_id, contact (jsonb), billing_contact (jsonb), is_training (bool), parent_tenant_id (réseau, phase 2), created_at |
| `site` | id, tenant_id, code (3 lettres, ex. KIN), name, address (jsonb : province, territoire/ville, commune, quartier, avenue), timezone, phone, is_active |
| `department` | id, tenant_id, site_id, code, name, kind (`clinical`, `technical`, `administrative`, `pharmacy`, `laboratory`, `cashier`), cost_center_code |
| `room` | id, tenant_id, site_id, department_id, name, kind |
| `module` | code (pk), name, phase, depends_on text[], is_billable |
| `tenant_module` | tenant_id, module_code, enabled_from, enabled_until, quotas (jsonb), source (`plan`, `addon`, `trial`, `grant`) |
| `plan`, `plan_price`, `subscription`, `subscription_item`, `license_token`, `platform_invoice`, `platform_invoice_line`, `platform_payment`, `dunning_event`, `usage_counter`, `trial_offer`, `coupon` | voir `docs/modules/sadm.md` |
| `device` | id, tenant_id, user_id, device_code (2 lettres), name, kind (`desktop`, `laptop`, `tablet`, `phone`), public_key, user_agent, registered_at, last_seen_at, last_sync_at, app_version, status (`active`, `revoked`, `lost`), revoked_reason |
| `feature_flag` | key, scope (`platform`, `tenant`), tenant_id, value jsonb |
| `number_series` | id, tenant_id, site_id, doc_type, device_id, year, template, last_value |
| `idempotency_key` | key, tenant_id, user_id, request_hash, response jsonb, created_at |
| `job`, `job_schedule` | voir `docs/01-architecture.md` |

## 3. Identité, accès, audit

| Table | Colonnes clés |
| --- | --- |
| `user_account` | id, tenant_id (null pour les comptes plateforme), username, phone, email, display_name, title (Dr, Inf...), professional_number, password_hash, password_changed_at, must_change_password, status (`active`, `disabled`, `locked`), locale, default_site_id, default_department_id, signature_file_id, is_platform_staff, last_login_at |
| `role` | id, tenant_id (null = rôle modèle plateforme), code, name, description, is_privileged, requires_mfa, template_code, version |
| `permission` | key (pk, ex. `invoice:discount`), module_code, description, scopes_allowed text[] |
| `role_permission` | role_id, permission_key, scope (`self`, `department`, `site`, `tenant`, `warehouse`, `cash_register`), conditions jsonb (ABAC) |
| `user_role` | user_id, role_id, site_id null, department_id null, valid_from, valid_until |
| `access_delegation` | id, tenant_id, from_user_id, to_user_id, role_id, starts_at, ends_at, reason |
| `session` | voir `docs/03-multitenant-securite.md` |
| `mfa_factor` | id, user_id, kind (`totp`), secret_enc, confirmed_at, backup_codes_hash text[] |
| `break_glass_event` | id, tenant_id, user_id, patient_id, reason_code, reason_text, started_at, ends_at, device_id, reviewed_by, reviewed_at, review_outcome |
| `approval_request` | id, tenant_id, kind (`discount`, `invoice_void`, `stock_adjustment`, `patient_merge`...), entity, entity_id, requested_by, amount, payload, status (`pending`, `approved`, `rejected`), decided_by, decided_at, reason |
| `audit_log` | voir `docs/03-multitenant-securite.md` |
| `data_access_log` | id, tenant_id, at, user_id, device_id, patient_id, screen, reason |
| `platform_audit_log` | id, at, actor_id, tenant_id, action, details, ip, prev_hash, hash |

## 4. Patients

| Table | Colonnes clés |
| --- | --- |
| `person_global` | id, created_at, family_name_hash, birth_year, phone_hash, health_qr_token. **Table plateforme** (pas de RLS de structure), minimale, point d'accroche du partage (phase 2). Au MVP : remplie mais jamais exposée entre structures. |
| `patient` | colonnes communes + person_global_id, mrn, official_mrn, family_name, middle_name (postnom), given_name, sex (`M`, `F`, `U`), birth_date, birth_date_estimated, age_at_registration, phone, phone_alt, address (jsonb), marital_status, profession, father_name, mother_name, nationality, language, photo_file_id, is_provisional (inconnu, urgence, nouveau-né), sensitivity (`normal`, `staff`, `vip`, `restricted`), search_text, phonetic_key, extra jsonb (champs configurables), merged_into_id, deceased_at |
| `patient_identifier` | patient_id, kind (`national_id`, `insurance_card`, `employee_card`, `external_mrn`...), value, issuer, valid_until |
| `patient_contact` | patient_id, relation, name, phone, is_emergency_contact, is_guardian |
| `patient_field_history` | patient_id, field, old_value, new_value, changed_at, changed_by, op_id |
| `patient_coverage` | patient_id, contract_id, beneficiary_id, role (`holder`, `spouse`, `child`, `dependent`), valid_from, valid_until, status |
| `patient_favorite` | user_id, patient_id |
| `duplicate_candidate` | id, tenant_id, patient_a_id, patient_b_id, score, reasons jsonb, status (`open`, `merged`, `dismissed`), decided_by |
| `patient_merge` | id, tenant_id, survivor_id, merged_id, merged_at, merged_by, approved_by, snapshot jsonb, reverted_at, reverted_by |

## 5. Consentement et partage (phase 2, tables créées au MVP)

`consent` (id, tenant_id, person_global_id, patient_id, grantor_kind (`patient`, `guardian`), grantee_tenant_id, categories text[], period_from, period_to, purpose, expires_at, granted_via (`in_person`, `portal`, `code`), status, revoked_at), `consent_scope`, `share_grant`, `share_access_log`. Au MVP, ces tables existent sans écran : elles fixent le modèle.

## 6. Visites et parcours

| Table | Colonnes clés |
| --- | --- |
| `encounter` | colonnes communes + patient_id, kind (`outpatient`, `emergency`, `inpatient`, `day_care`, `teleconsult`, `lab_only`, `pharmacy_only`), status (`planned`, `arrived`, `triaged`, `in_consultation`, `waiting_results`, `completed`, `cancelled`), department_id, practitioner_id, started_at, ended_at, coverage_id, referral (jsonb), visit_number |
| `appointment` | colonnes communes + patient_id, resource_kind (`practitioner`, `department`, `room`, `equipment`), resource_id, appointment_type_id, starts_at, ends_at, status (`booked`, `confirmed`, `arrived`, `no_show`, `cancelled`, `completed`), cancel_reason, source (`front_desk`, `portal`, `recurring`), reminder_status |
| `appointment_type` | id, tenant_id, name, duration_min, color, department_id, requires_payment |
| `schedule_template` | id, tenant_id, resource_kind, resource_id, weekday, start_time, end_time, slot_min, overbook_max |
| `schedule_exception` | id, tenant_id, resource_id, date, kind (`closed`, `extra`), start_time, end_time |
| `queue` | id, tenant_id, site_id, department_id, name, ticket_prefix |
| `queue_ticket` | colonnes communes + queue_id, encounter_id, patient_id, number, priority (`emergency`, `elderly`, `pregnant`, `child`, `normal`), status (`waiting`, `called`, `in_service`, `done`, `left`), called_at, called_by, room_id |
| `triage` | append-only + encounter_id, priority, chief_complaint, notes, triaged_by |

## 7. Clinique

| Table | Colonnes clés |
| --- | --- |
| `clinical_event` | append-only + patient_id, encounter_id, kind (`vital_sign`, `observation`, `diagnosis`, `problem`, `allergy`, `history`, `note`, `form_response`, `prescription`, `lab_result`, `document`, `procedure`, `vaccination`...), ref_table, ref_id, occurred_at, author_id, origin_tenant_id. **Chronologie unique** : chaque spécialisation crée une ligne ici. |
| `vital_sign` | append-only + patient_id, encounter_id, code (`temp`, `pulse`, `sbp`, `dbp`, `rr`, `spo2`, `weight`, `height`, `head_circ`, `muac`, `glucose`, `pain`, `diuresis`...), value numeric, unit, measured_at, measured_by, method, is_out_of_range, plausibility_override_reason |
| `vital_sign_definition` | id, tenant_id, code, label, unit, decimals, normal_ranges jsonb (par âge et sexe), plausible_min, plausible_max, display_order, is_active |
| `observation` | append-only + patient_id, encounter_id, code, value jsonb, unit |
| `diagnosis` | append-only + encounter_id, patient_id, code_system (`ICD10`, `ICPC2`, `local`), code, label, certainty (`suspected`, `confirmed`), is_primary |
| `problem` | union + patient_id, code, label, onset_date, resolved_date, status (`active`, `resolved`, `inactive`), source_encounter_id |
| `allergy` | union + patient_id, substance_code, substance_label, category (`drug`, `food`, `environment`, `other`), reaction, severity (`mild`, `moderate`, `severe`, `life_threatening`), certainty, noted_at, source |
| `medical_history` | union + patient_id, kind (`medical`, `surgical`, `family`, `obstetric`, `vaccination`, `social`), code, label, started_on, ended_on, details jsonb, source |
| `clinical_note` | append-only + encounter_id, patient_id, kind (`anamnesis`, `exam`, `plan`, `progress`, `discharge`, `free`), content (texte, chiffré si sensible), signed_by, signed_at, signature (Ed25519 de l'appareil + identité du clinicien) |
| `form_definition`, `form_version`, `form_response` | voir `docs/modules/form.md` |
| `attachment` | id, tenant_id, patient_id, encounter_id, file_key, mime, size, sha256, title, category, uploaded_at, status (`local_only`, `uploaded`) |
| `clinical_program` | id, tenant_id, code (`diabetes`, `hypertension`, `hiv`, `tb`, `sickle_cell`...), name, follow_up_interval_days, protocol jsonb |
| `program_enrollment` | id, tenant_id, patient_id, program_id, enrolled_at, status, next_due_at, lost_to_follow_up_at |

## 8. Prescription

| Table | Colonnes clés |
| --- | --- |
| `drug` | id, tenant_id (null = catalogue global), inn (DCI), atc_code, form, strength, route, dispense_unit, is_essential, is_controlled, max_daily_dose (jsonb par âge et poids), pregnancy_category, renal_adjust, hepatic_adjust, source (`who_eml`, `national`, `local`) |
| `drug_interaction_rule` | id, tenant_id, atc_a, atc_b, severity (`minor`, `moderate`, `major`, `contraindicated`), message, source |
| `prescription` | append-only + encounter_id, patient_id, prescriber_id, prescribed_at, kind (`outpatient`, `inpatient`, `discharge`), status (`active`, `completed`, `cancelled`), verification_code (pour le QR) |
| `prescription_item` | append-only + prescription_id, drug_id, free_text_drug, dose_value, dose_unit, route, frequency (code structuré, ex. `3x/d`), duration_days, quantity, instructions, substitution_allowed, status (`prescribed`, `dispensed`, `partially_dispensed`, `administered`, `stopped`), stop_reason, alerts_acknowledged jsonb |
| `medication_administration` | append-only + prescription_item_id, patient_id, administered_at, dose_given, administered_by, status (`given`, `refused`, `not_given`), reason |
| `medication_statement` | union + patient_id, drug label, source (`patient_report`, `other_facility`), started_on, stopped_on : traitements habituels pour la réconciliation |
| `medication_reconciliation` | id, tenant_id, encounter_id, kind (`admission`, `discharge`, `consultation`), decisions jsonb, performed_by, performed_at |

## 9. Laboratoire

`lab_catalog_item` (id, tenant_id, code, name, loinc, specimen_type, container, turnaround_hours, unit, result_type (`numeric`, `text`, `choice`, `panel`), choices, panel_items, price_service_item_id, is_outsourced, outsource_lab_id), `lab_reference_range` (catalog_item_id, sex, age_min_days, age_max_days, low, high, critical_low, critical_high, text), `lab_order` (append-only + encounter_id, patient_id, ordered_by, priority, clinical_info, status (`ordered`, `collected`, `in_progress`, `tech_validated`, `bio_validated`, `cancelled`)), `lab_order_item`, `lab_specimen` (order_id, barcode, collected_at, collected_by, status, rejection_reason), `lab_result` (append-only + order_item_id, value, unit, flag (`L`, `H`, `LL`, `HH`, `N`), comment, entered_by, tech_validated_by, bio_validated_by, validated_at), `external_lab`.

## 10. Imagerie (phase 2)

`imaging_order`, `imaging_study` (study_instance_uid, modality, orthanc_id, status), `imaging_report` (append-only, template_id, findings, conclusion, recommendation, signed_by).

## 11. Hospitalisation (phase 2)

`ward`, `bed` (status `free`, `occupied`, `cleaning`, `out_of_service`), `admission`, `bed_assignment`, `care_plan`, `care_task`, `fluid_balance`, `surgery_booking`, `surgery_checklist`, `operative_report`.

## 12. Tarification et facturation

| Table | Colonnes clés |
| --- | --- |
| `service_item` | id, tenant_id, code, name, category (`consultation`, `procedure`, `lab`, `imaging`, `bed_day`, `drug`, `consumable`, `other`), department_id, is_active, product_id (si produit stocké) |
| `price_list` | id, tenant_id, code, name, kind (`public`, `private`, `contract`, `foreigner`, `staff`, `indigent`), currency, valid_from, valid_until, status (`draft`, `published`) |
| `price` | id, tenant_id, price_list_id, service_item_id, amount (bigint), currency, valid_from, valid_until |
| `tax` | id, tenant_id, code, name, rate (numeric), applies_to (catégories), is_active |
| `surcharge_rule` | id, tenant_id, kind (`night`, `sunday`, `holiday`, `file_fee`), rule jsonb |
| `currency`, `exchange_rate` | exchange_rate : tenant_id (null = plateforme), from_currency, to_currency, rate numeric(18,6), valid_from, source |
| `invoice` | colonnes communes + patient_id, encounter_id, payer_kind (`patient`, `third_party`), payer_id, contract_id, number, official_number, status (`open`, `finalized`, `partially_paid`, `paid`, `voided`), currency, total_gross, total_discount, total_tax, total_patient, total_third_party, finalized_at, finalized_by |
| `invoice_line` | append-only + invoice_id, service_item_id, quantity, unit_price, currency, discount_amount, tax_amount, patient_share, third_party_share, coverage_decision jsonb (trace du moteur de conventions), source_ref (table et id de l'acte d'origine), performed_by, performed_at |
| `payment` | append-only + patient_id, invoice_id null, cash_session_id, method (`cash`, `mobile_money`, `card`, `cheque`, `transfer`, `offset`), currency, amount, exchange_rate_used, amount_in_invoice_currency, reference (numéro de transaction), operator (`mpesa`, `orange`, `airtel`...), received_at, received_by, receipt_number |
| `payment_allocation` | payment_id, invoice_id, amount |
| `credit_note` | append-only + invoice_id, number, reason, amount, lines jsonb, approved_by |
| `deposit` | append-only + patient_id, encounter_id, amount, currency, kind (`advance`, `hospital_deposit`, `guarantee`), status |
| `discount_grant` | invoice_line_id ou invoice_id, amount ou percent, reason, requested_by, approved_by |
| `cash_register` | id, tenant_id, site_id, name |
| `cash_session` | colonnes communes + cash_register_id, device_id, cashier_id, opened_at, opening_float jsonb (par devise), closed_at, expected jsonb, counted jsonb, difference jsonb, justification, status (`open`, `closed`, `reconciled`) |
| `cash_movement` | append-only + cash_session_id, kind (`payment_in`, `refund_out`, `withdrawal`, `float_in`, `transfer_out`), currency, amount, reference |
| `receivable` | vue ou table de cache recalculable : patient_id, invoice_id, outstanding, due_date, aging_bucket |
| `payment_plan` | id, tenant_id, patient_id, invoices uuid[], installments jsonb, status |

## 13. Conventions

`payer`, `contract`, `contract_plan`, `coverage_rule`, `beneficiary`, `beneficiary_movement`, `prior_authorization`, `referral_voucher` (bon d'envoi), `guarantee`, `payer_invoice`, `payer_invoice_line`, `payer_claim_rejection`. Détail des colonnes dans `docs/modules/conv.md`.

## 14. Pharmacie et stock

| Table | Colonnes clés |
| --- | --- |
| `product` | id, tenant_id, drug_id null, code, name, category, unit, pack_size, purchase_price, sale_price_rule, min_stock, max_stock, is_controlled, is_active |
| `product_lot` | id, tenant_id, product_id, lot_number, expiry_date, supplier_id |
| `warehouse` | id, tenant_id, site_id, code, name, kind (`central`, `pharmacy`, `ward_cabinet`, `lab`) |
| `stock_movement` | append-only + warehouse_id, product_id, lot_id, kind (`receipt`, `dispense`, `sale`, `transfer_out`, `transfer_in`, `return_supplier`, `return_patient`, `adjustment_plus`, `adjustment_minus`, `destruction`, `consumption`, `count_correction`), quantity (positive, sens donné par le type), unit_cost, ref_table, ref_id, reason, approved_by |
| `stock_balance` | table de cache recalculable par job et par trigger : warehouse_id, product_id, lot_id, quantity, updated_at |
| `supplier` | id, tenant_id, name, contacts |
| `purchase_order`, `purchase_order_line`, `goods_receipt`, `goods_receipt_line` | commandes et réceptions |
| `stock_transfer` | id, tenant_id, from_warehouse_id, to_warehouse_id, status (`sent`, `received`, `disputed`), lines jsonb |
| `stock_count`, `stock_count_line` | inventaires : expected, counted, difference, justification |
| `dispensation` | append-only + patient_id, prescription_id null, encounter_id, warehouse_id, kind (`prescription`, `otc_sale`, `contract_package`), dispensed_by, dispensed_at |
| `dispensation_line` | dispensation_id, prescription_item_id null, product_id, lot_id, quantity |
| `controlled_substance_log` | append-only + product_id, movement_id, balance_after, signed_by, cosigned_by |

## 15. Synchronisation

| Table | Colonnes clés |
| --- | --- |
| `op_log` | op_id (pk), tenant_id, device_id, user_id, command, entity, entity_id, payload jsonb, hlc, client_ts, received_at, status, result jsonb, schema_version, signature |
| `change_log` | seq bigserial, tenant_id, entity, entity_id, version, op_id, scope_keys text[], changed_at |
| `sync_conflict` | voir `docs/02-offline-sync.md` |
| `sync_scope_rule` | id, tenant_id, role_id null, entity, rule jsonb |

## 16. Notifications, documents, support, sécurité

`notification` (id, tenant_id, user_id, kind, title, body, link, read_at), `message_template` (tenant_id null = plateforme, channel (`sms`, `email`, `in_app`, `whatsapp`), event, locale, subject, body avec variables, version), `outbound_message` (id, tenant_id, channel, to, template_id, rendered_body, status, provider_message_id, attempts, sent_at, error), `document_template` (tenant_id, kind (`prescription`, `invoice`, `receipt`, `certificate`, `lab_report`, `patient_card`, `referral_letter`, `sick_leave`, `discharge_letter`), paper (`A4`, `A5`, `80mm`), layout jsonb, version, status), `ticket`, `ticket_message`, `kb_article`, `newsletter`, `newsletter_send`, `announcement`, `ip_rule`, `security_event`, `backup_job`, `backup_artifact`, `error_event`, `metric_sample`, `webhook_endpoint`, `webhook_delivery`, `api_key`.

## 17. Configuration

`config_entry` (id, tenant_id, domain, key, value jsonb, version, status (`draft`, `published`, `archived`), effective_from, published_by, published_at, previous_version_id). Voir `docs/06-configuration.md`.

## 18. Extrait de schéma Drizzle (référence de style)

```ts
export const patient = pgTable('patient', {
  ...syncColumns(),               // id, tenantId, siteId, createdAt, createdBy, updatedAt, updatedBy, version, deviceId, hlc, opId, deletedAt...
  personGlobalId: uuid('person_global_id'),
  mrn: text('mrn').notNull(),
  officialMrn: text('official_mrn'),
  familyName: text('family_name').notNull(),
  middleName: text('middle_name'),
  givenName: text('given_name'),
  sex: text('sex').notNull(),     // CHECK (sex in ('M','F','U'))
  birthDate: date('birth_date'),
  birthDateEstimated: boolean('birth_date_estimated').notNull().default(false),
  phone: text('phone'),
  sensitivity: text('sensitivity').notNull().default('normal'),
  searchText: text('search_text').notNull(),
  phoneticKey: text('phonetic_key').notNull(),
  extra: jsonb('extra').$type<Record<string, unknown>>().notNull().default({}),
  mergedIntoId: uuid('merged_into_id'),
}, (t) => [
  uniqueIndex('patient_mrn_uq').on(t.tenantId, t.mrn),
  index('patient_phonetic_idx').on(t.tenantId, t.phoneticKey),
  index('patient_phone_idx').on(t.tenantId, t.phone),
]);
```
