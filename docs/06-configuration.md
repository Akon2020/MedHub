# 06. Moteur de configuration

Principe : **tout ce qui varie d'une structure à l'autre se règle dans l'interface**. Le code ne contient que des mécanismes génériques.

## 1. Domaines configurables

| Domaine | Éléments | Écran |
| --- | --- | --- |
| Organisation | Structure, sites, services, salles, lits (phase 2), horaires, jours fériés, gardes, centres de coût | `/app/parametres/organisation` |
| Utilisateurs | Comptes, rôles, permissions, politique de mot de passe, 2FA, durée de session, appareils autorisés, délai maximal hors connexion | `/app/parametres/utilisateurs` |
| Clinique | Formulaires, protocoles, listes de choix, constantes et plages, modèles de comptes rendus, diagnostics favoris, programmes chroniques | `/app/parametres/clinique` |
| Financier | Tarifs, grilles, taxes, devises, taux de change, remises, conventions, forfaits, règles de couverture, séries de numérotation, modèles de factures, majorations | `/app/parametres/finances` |
| Stock | Magasins, catégories, unités, seuils, règles de péremption, marges, arrondis | `/app/parametres/stock` |
| Workflows | Étapes du parcours patient, états, transitions autorisées, paiement avant ou après soins, validations, délais, escalades | `/app/parametres/parcours` |
| Documents | Modèles imprimés, logos, en-têtes, pieds de page, signatures, mentions légales, langues | `/app/parametres/documents` |
| Communication | Modèles SMS et courriel, déclencheurs, fournisseur | `/app/parametres/messages` |
| Synchronisation | Périmètre par rôle, pré-chargement complet, verrouillage, PIN | `/app/parametres/synchronisation` |
| Plateforme (super-admin) | Modules actifs, quotas, plan, options offline | `/admin` |
| Données de référence | Imports de catalogues, codes, listes administratives (provinces, territoires), correspondances DHIS-2 (phase 2) | `/app/parametres/referentiels` |

Tous ces écrans sont **en ligne seulement**. Les valeurs publiées sont distribuées aux appareils en lecture seule.

## 2. Stockage et versionnement

- Les objets structurés ont leurs tables propres (`price`, `contract`, `form_version`, `document_template`...). Les réglages simples vont dans `config_entry` (`domain`, `key`, `value jsonb`).
- Chaque valeur est validée par un schéma Zod déclaré dans `packages/domain/src/core/config-schemas.ts`.
- **Cycle de vie des configurations critiques** (tarifs, conventions, formulaires, modèles de documents, règles de parcours) : `draft` → aperçu ou simulation → `published` avec `effective_from` → `archived` à son remplacement. Une configuration publiée n'est jamais modifiée : une modification crée une nouvelle version.
- Chaque changement est daté, attribué, audité (`config_publish`) et **réversible** (republication d'une version précédente comme nouvelle version).
- Les données saisies gardent la référence de la version de configuration utilisée (ex. `form_response.form_version_id`, `invoice_line.coverage_decision.rule_version`).

## 3. Assistant de démarrage

Parcours guidé, reprenable, affiché au premier accès de l'administrateur de structure :
1. Type de structure et modèle associé (modules, rôles, formulaires, catalogues, documents, parcours).
2. Identité : nom, logo, sites, adresses, devises, langue, fuseau, mentions légales (champs libres, aucune valeur inventée).
3. Utilisateurs clés et rôles.
4. Import des tarifs et des produits par fichier modèle, avec contrôle ligne par ligne.
5. Conventions principales (assistant de convention, `docs/modules/conv.md`).
6. Test guidé : parcours d'un patient fictif du triage à la facture, en base de formation.
7. Récapitulatif et liste des points restants.

Objectif : dispensaire en moins de 5 jours ouvrés, hôpital moyen en moins de 4 semaines.

## 4. Modèles par type de structure

Fichiers de données dans `packages/db/seeds/templates/<type>.json` : modules, rôles, formulaires, catalogues de départ, modèles de documents, parcours. Types : `pharmacy`, `health_center`, `practice`, `laboratory`, `imaging_center`, `clinic`, `hospital`.

| Type | Modules par défaut | Particularités |
| --- | --- | --- |
| Pharmacie | CORE, PAT simplifié, FACT, PHAR | Vente au comptoir, ordonnances, produits sous contrôle |
| Dispensaire, centre de santé | CORE, PAT, RDV, DPI, FORM, FACT, PHAR, LAB simple | Consultation curative, CPN, vaccination, rapports SNIS (phase 2) |
| Cabinet | CORE, PAT, RDV, DPI, FORM, FACT | Agenda et honoraires |
| Laboratoire | CORE, PAT, LAB, FACT | Prescripteurs externes |
| Centre d'imagerie | CORE, PAT, IMG (phase 2), FACT | Comptes rendus |
| Clinique | Dispensaire + CONV, HOSP, MAT (phase 2) | Conventions d'entreprise |
| Hôpital | Clinique + IMG, VAC, EPID, RH, ANA (phase 2) | Multi-services, multi-sites |

## 5. Base de formation

- Une structure de formation (`tenant.is_training = true`) est créée à côté de chaque structure, avec la même configuration publiée (copie à la demande) et des patients fictifs générés.
- Bandeau permanent « Base de formation » de couleur distincte, impossible à confondre.
- Aucun SMS ni courriel réel n'est envoyé depuis une base de formation (adaptateur `console` forcé).
- Réinitialisation des données de formation à la demande.

## 6. Export et import de configuration

- Export d'une configuration complète (ou d'un domaine) en JSON signé, import dans une autre structure avec aperçu des différences. Usages : réseaux multi-sites, modèles du super-admin.
- Les identifiants internes sont remappés à l'import ; les références par code sont conservées.

## 7. Imports de données (CSV et Excel)

Cadre commun dans `server/platform/import/` :
- Modèles téléchargeables (en-têtes en français, une ligne d'exemple) pour : patients, tarifs, produits, stock initial (par lot), bénéficiaires de convention, utilisateurs, examens de laboratoire, diagnostics, médicaments.
- Étapes : téléversement, détection des colonnes, **simulation** (validation ligne par ligne, rapport d'erreurs téléchargeable), confirmation, exécution en job par lots de 500, rapport final.
- Import idempotent : une clé de dédoublonnage par type (ex. code produit, matricule de bénéficiaire).
- Lecture Excel par une bibliothèque légère côté serveur (`exceljs` ou équivalent). Taille max 10 Mo.
- Stock initial importé sous forme de mouvements `receipt` avec motif « stock initial ».
