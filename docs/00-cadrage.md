# 00. Cadrage du projet MedHub

## 1. Vision

Offrir à toute structure sanitaire, du comptoir de pharmacie à l'hôpital multi-sites, un outil qui se met en route en quelques jours, qui ne s'arrête jamais, qui suit chaque patient dans la durée et qui sécurise les recettes de la structure.

Le produit se nomme **MedHub**. Les documents de travail antérieurs utilisaient le nom provisoire « MediHub » : il est remplacé partout (code, interface, documents, noms de bases locales, cookies, variables d'environnement).

## 2. Principes directeurs

1. **Tout est configurable par l'interface** avant de toucher au code : rôles, formulaires cliniques, tarifs, conventions, workflows, modules, documents imprimés, notifications.
2. **Offline d'abord (local-first)** : chaque poste travaille sur une base locale chiffrée et se synchronise dès que le réseau le permet. Exigence non négociable.
3. **Dossier patient longitudinal** : antécédents, mesures passées, traitements récents et documents réunis dans une chronologie unique, avec partage inter-structures soumis au consentement du patient.
4. **SaaS piloté par un portail super-admin** : comptes, modules, abonnements, licences, factures, supervision, sauvegardes, support, communication.
5. **Réalisme de déploiement** : hébergement cPanel pour démarrer, architecture sans service exotique, migration vers VPS sans réécriture.
6. **Règle d'or du terrain** (retour d'expérience Open Clinic GA) : pas de double saisie, et un bénéfice personnel visible pour chaque utilisateur final.

## 3. Objectifs mesurables

| Objectif | Indicateur cible |
| --- | --- |
| Mise en service rapide | Dispensaire opérationnel en moins de 5 jours ouvrés ; hôpital moyen en moins de 4 semaines. |
| Continuité de service | 100 % des fonctions critiques (enregistrement, consultation, prescription, caisse, dispensation) utilisables hors connexion. |
| Fiabilité des données | Zéro perte à la synchronisation. Moins de 1 % de conflits non résolus automatiquement. |
| Sécurité des recettes | Écart de caisse détecté le jour même. Traçabilité complète de chaque acte facturé. |
| Adoption | Un utilisateur formé en moins de 2 heures pour son rôle principal. |
| Qualité de soin | Allergies, antécédents et traitements en cours visibles en un écran à chaque consultation. |
| Performance | Application mise en cache inférieure à 1,5 Mo compressé ; ouverture d'un dossier local en moins de 300 ms ; recherche patient locale en moins de 200 ms. |

## 4. Acteurs

| Acteur | Rôle | Portail |
| --- | --- | --- |
| Super-administrateur | Exploitant de la plateforme : structures, modules, abonnements, supervision, support. | Super-admin (`/admin`) |
| Support plateforme | Assiste les structures. Accès limité, consenti et tracé. | Super-admin |
| Administrateur de structure | Configure sa structure : utilisateurs, rôles, tarifs, services, formulaires, conventions. | Application (`/app`) |
| Réceptionniste, agent d'accueil | Enregistrement, rendez-vous, files d'attente, orientation, contrôle de convention. | Application |
| Infirmier | Triage, constantes, soins, administration des médicaments, suivi d'hospitalisation. | Application |
| Médecin, spécialiste | Consultation, diagnostic, prescription, demandes d'examens, hospitalisation. | Application |
| Sage-femme | Suivi prénatal, accouchement, postnatal, vaccination. | Application |
| Biologiste, technicien de laboratoire | Prélèvements, résultats, validation. | Application |
| Radiologue, technicien d'imagerie | Examens, comptes rendus, images (phase 2). | Application |
| Pharmacien, magasinier | Dispensation, stock, commandes, inventaires. | Application |
| Caissier | Encaissement, reçus, clôture de caisse. | Application |
| Gestionnaire de facturation | Conventions, factures aux tiers, relances, contentieux. | Application |
| Gestionnaire, directeur | Tableaux de bord, validation de remises, supervision. | Application |
| Médecin-conseil d'assureur ou d'entreprise | Accords préalables, validation de factures (accès restreint). | Portail partenaire (phase 2) |
| Patient | Rendez-vous, résultats, ordonnances, consentements. | Portail patient (phase 2) |

## 5. Périmètre par phase

### 5.1 MVP (pilote hospitalier)

Modules : CORE, PAT, RDV, DPI, FORM, FACT, CONV, PHAR, LAB (saisie manuelle des résultats), NOTIF (notifications, documents, impression), SADM (portail super-admin, abonnements, licences, facturation plateforme, portail client « Mon compte »).

Capacités transverses : multi-structures, rôles et permissions configurables, assistant de démarrage, base de formation, mode hors connexion complet, audit, sauvegardes.

Services du pilote : accueil, caisse, consultation, pharmacie, laboratoire. Hospitalisation et maternité arrivent en phase 2.

### 5.2 Phase 2

HOSP (hospitalisation, ADT, soins infirmiers, bloc), MAT (maternité, partogramme), IMG (imagerie et DICOM sur serveur séparé), VAC (vaccination), PORT (portail patient complet), SHARE (identité globale, consentement, partage inter-structures, référence et contre-référence), MPAY (mobile money intégré pour l'encaissement patient), EPID et ANA (santé publique, DHIS-2, analytique avancée), RH (personnel, plannings, gardes), interface des analyseurs de laboratoire (agent local), portail partenaire (médecins-conseils), assurances avancées.

### 5.3 Phase 3

Sous-domaines par structure et domaines personnalisés (marque blanche), option on-premise ou hybride, FHIR R4 complet, aide à la décision avancée, applications natives, lingala et swahili, biométrie, MAINT (équipements), DIET (repas), AMB (ambulance et soins à domicile), étude de la télémédecine.

### 5.4 Hors périmètre (toutes phases sauf décision contraire)

- Comptabilité générale complète : seule une comptabilité de gestion simple est incluse, avec export vers un logiciel comptable.
- Paie et gestion RH complète : seuls le personnel, les plannings, les gardes et les présences sont gérés (module RH, phase 2).
- Télémédecine vidéo : étudiée en phase 3 seulement.

## 6. Décisions actées

| Sujet | Décision |
| --- | --- |
| Nom du produit | MedHub. |
| Marché initial | RDC. Français par défaut, anglais en seconde langue. USD et CDF. Deux fuseaux horaires (Kinshasa UTC+1, Lubumbashi UTC+2). |
| Pile | Next.js (React), Node.js, PostgreSQL, Drizzle ORM, TypeScript, monorepo pnpm, API dans Next.js, shadcn/ui et Tailwind. |
| Distribution | SaaS cloud uniquement en v1. On-premise et hybride en phase 3. |
| Hébergement v1 | cPanel. Données (base et fichiers) sur l'hébergement cPanel. Recommandation : offre cPanel sur VPS ou serveur dédié plutôt que mutualisé classique. |
| Offline | Obligatoire. PWA, base locale chiffrée, synchronisation par journal d'opérations écrite à la main (Dexie et API REST). Pas de RxDB, PowerSync ni équivalent nécessitant un service non disponible sur cPanel. |
| Sous-domaines | Reportés en phase 3. Adresse unique en v1, structure identifiée par un code saisi à la connexion. |
| Multi-tenant | Base unique, colonne `tenant_id`, Row Level Security forcée. |
| Partage inter-structures | Cloisonné par défaut. Dossier longitudinal unique avec consentement du patient, révocable et audité (phase 2, points d'accroche dès le MVP). |
| Modèle commercial | Abonnement par plan et modules (comme un SaaS). Grille à valider sur le terrain (`docs/13-tarification.md`). |
| Impayés | Rappels, période de grâce, lecture seule, suspension. Accès d'urgence et export jamais bloqués. |
| Mobile money | Abonnement plateforme : agrégateur en v1 si disponible, sinon paiement manuel avec preuve. Encaissement patient : saisie manuelle de la référence en v1, intégration directe en phase 2. |
| Calendrier | Option A : environ 18 semaines jusqu'au pilote, développeur unique, marge de 15 à 20 %. |
| Pilote | Hôpital de 15 à 20 personnes, parc mixte, électricité stable, connexion passable. |

## 7. Questions ouvertes et valeurs par défaut

Claude Code ne tranche pas ces points. Il applique la valeur par défaut indiquée, la rend configurable, et laisse un marqueur `TODO(medhub-decision)`.

| Question | Valeur par défaut à appliquer en attendant |
| --- | --- |
| Entité qui facture l'abonnement, mentions légales et fiscales des factures (plateforme et structures) | Champs de configuration `legal_mentions` vides par défaut, affichés sur les modèles de facture. Aucune mention inventée. |
| Hébergeur cPanel retenu et caractéristiques exactes | Architecture compatible avec le pire cas décrit dans `docs/09-hebergement-deploiement.md`. |
| Identité de l'hôpital pilote, conventions existantes, volume réel | Structure de démonstration fictive « Hôpital Pilote Démo », code `HOP-DEM-0001`. Conventions de démonstration reproduisant les modèles A à D. |
| Liste nationale des médicaments essentiels de la RDC et nomenclature d'actes | Import CSV prévu. Jeu de démonstration réduit basé sur la liste modèle OMS (noms DCI et codes ATC). |
| Licence de la CIM-10 en français | Le catalogue de diagnostics est importable ; le code ne dépend d'aucun fichier sous licence. Jeu de démonstration limité aux codes utilisés dans les tests. |
| Fournisseurs SMS et WhatsApp | Adaptateur `console` (journalise le message, sans contenu de santé) en développement ; adaptateur HTTP générique configurable. |
| Agrégateur mobile money (FlexPay ou équivalent, à confirmer) | Interface `PaymentProvider` avec adaptateur `manual` (preuve téléversée et validation super-admin). Adaptateur agrégateur écrit quand le fournisseur est choisi. |
| Matériel d'impression | A4, A5 et ticket 80 mm par le dialogue d'impression du navigateur. Pas de pilote ESC/POS en v1. |
| Données à reprendre (registres, Excel, ancien logiciel) | Imports CSV et Excel avec modèles (`docs/06-configuration.md`). |
| Support de premier niveau pendant le pilote | Billetterie intégrée au portail super-admin. |
| Grille tarifaire définitive | Valeurs de `docs/13-tarification.md`, toutes modifiables dans le portail super-admin. |
| Exigence légale de numérotation officielle continue des factures | Paramètre `official_numbering_required` par structure, `false` par défaut. |
| Cadre juridique (Code du numérique de 2023, localisation des données de santé) | Aucune hypothèse codée. Vérification juridique avant l'ouverture commerciale. |
