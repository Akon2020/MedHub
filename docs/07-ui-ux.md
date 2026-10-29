# 07. Interface et expérience utilisateur

## 1. Principes

1. **Sobre et professionnel** : fond clair brumeux (`#f3f8f9`), une couleur d'accent **teal profond** (`#0f6b6b`, nuances `#6aafba`, `#b4dadd`, `#a9c1ba`), encre `#0d1d1d`, gris ardoise pour la structure, rouge, orange et vert réservés aux états (alerte, attention, succès), bleu réservé à la synchronisation en cours. Effets de verre dépoli, bandes verticales lumineuses et dégradés doux **uniquement** sur les pages publiques et l'écran de connexion ; les écrans opérationnels (`/app`) restent sobres : cartes blanches, fond clair, aucun effet de flou coûteux pour le matériel d'entrée de gamme. Polices : Sora (titres) et Plus Jakarta Sans (texte), auto-hébergées par `next/font`. Mode sombre facultatif (phase 2). Décision du porteur du projet du 29/10/2026, voir `docs/avancement.md`.
2. **Lisible sur matériel d'entrée de gamme** : texte de base 15 px minimum (16 px sur tablette), contraste WCAG AA, zones tactiles de 44 px minimum.
3. **Rapide à saisir** : navigation complète au clavier, raccourcis, champs pré-remplis, valeurs favorites, saisie numérique adaptée sur tablette (`inputMode="decimal"`).
4. **Un écran, une tâche** : chaque rôle a un écran d'accueil centré sur sa file de travail.
5. **Toujours dire l'état** : indicateur de synchronisation permanent, horodatage de fraîcheur sur toute donnée potentiellement ancienne, message explicite pour les fonctions en ligne seulement.
6. **Bénéfice visible pour chaque utilisateur** (règle d'or) : moins de clics que le papier, aucune information à recopier.
7. **Responsive** : PC et ordinateurs de bureau (1280 px et plus), tablettes (768 à 1280 px, usage principal triage et consultation), smartphones (lecture, file d'attente, recherche ; saisie clinique possible mais secondaire).

## 2. Mise en page

- **En-tête** : nom de la structure et du site, sélecteur de service (si plusieurs), recherche patient globale (raccourci `/`), indicateur de synchronisation, notifications, menu utilisateur (verrouiller, langue, diagnostic, déconnexion).
- **Barre latérale** repliable : modules accessibles selon les permissions, dans l'ordre du parcours.
- **Bandeau patient** (dès qu'un patient est ouvert) : nom, âge, sexe, MRN, photo, alertes (allergies en rouge, grossesse, chronique, sensibilité), couverture (convention et plafond restant).
- **Zone principale** et, sur grand écran, panneau latéral contextuel (résumé patient, historique).
- Bannières plateforme : base de formation, impayé (grâce, lecture seule), maintenance planifiée, prise en main par le support.

## 3. Indicateur de synchronisation

| État | Couleur | Libellé | Détail au survol ou au clic |
| --- | --- | --- | --- |
| À jour | Vert | Connecté | Dernière synchronisation il y a N s |
| En cours | Bleu | Synchronisation | Nombre d'opérations envoyées |
| Hors connexion | Orange | Hors connexion | N opérations en attente, dernière synchro à HH:MM |
| Attention | Rouge | Attention requise | Rejets, conflits, horloge, stockage, jeton bientôt expiré, version minimale |

Un clic ouvre le panneau de diagnostic résumé, avec lien vers `/app/diagnostic`.

## 4. Écrans d'accueil par rôle

- **Accueil** : recherche patient, création rapide, rendez-vous du jour, files par service.
- **Infirmier** : file de triage, patients en attente de soins.
- **Médecin** : sa file, ses rendez-vous, résultats à voir, patients perdus de vue de ses programmes.
- **Laboratoire** : demandes à prélever, en cours, à valider.
- **Pharmacie** : ordonnances à dispenser, alertes de stock et de péremption.
- **Caisse** : patients à encaisser, session de caisse (ouvrir, clôturer).
- **Direction** : tableau de bord (fréquentation, recettes, créances, ruptures).
- **Administrateur** : assistant de démarrage, alertes de configuration, appareils, revue d'audit.

## 5. Les cinq écrans critiques (à maquetter en S1 à S3)

### 5.1 Accueil et enregistrement
- Champ de recherche unique (nom, téléphone, MRN, nom du père ou de la mère, date de naissance) avec résultats au fil de la frappe, tolérants aux fautes.
- Création rapide en moins de 60 secondes : nom, postnom, prénom, sexe, date de naissance ou âge estimé, téléphone. Le reste est complétable plus tard.
- Alerte de doublon probable avec comparaison côte à côte avant création.
- Après sélection : couverture (convention, ayant droit, plafond restant, validité), création de la visite, choix du service, ticket de file (impression 80 mm).

### 5.2 Résumé patient (un seul écran)
- Alertes : allergies, contre-indications, pathologies chroniques, grossesse, statut sensible.
- Traitements en cours et récents (90 jours) avec dose, voie, durée, prescripteur, structure d'origine.
- Dernières constantes avec tendance (flèche haut, bas, stable) et alerte hors normes ; mini-courbes.
- Problèmes actifs, antécédents par catégorie.
- Derniers résultats anormaux, examens en attente.
- Prochains rendez-vous, rappels, vaccins en retard (phase 2 pour la vaccination).
- Chronologie complète accessible en un clic, filtrable par type.

### 5.3 Consultation
- Colonne gauche : résumé compact. Centre : formulaire de consultation (motif, anamnèse, examen, hypothèses, diagnostic codé, conduite à tenir). Droite : prescription, demandes d'examens, documents (certificat, arrêt, référence).
- Formulaires de spécialité choisis selon le service ou par le médecin.
- Modèles de phrases, copie du dernier compte rendu en modification.
- Alertes de prescription en ligne (allergie, doublon, interaction, dose, grossesse, âge), justification exigée pour passer outre une alerte majeure.
- Signature et clôture : verrouille la note (nouvelles corrections = nouvelle version).

### 5.4 Caisse
- Panier du patient alimenté automatiquement par les actes réalisés.
- Répartition part patient et part tiers payant, avec justification visible par ligne (règle de convention appliquée).
- Encaissement multi-moyens et multi-devises, monnaie à rendre, reçu.
- Remise : demande avec motif, validation selon seuil.
- Clôture de caisse : comptage par devise et par moyen, écart calculé, justification obligatoire en cas d'écart.

### 5.5 Convention
- Liste des conventions, fiche du tiers payant, modèle de forfait, règles de couverture (tableau des actes et catégories avec inclus, exclu, pourcentage, plafond, accord préalable).
- Simulateur : choix d'un bénéficiaire fictif et d'actes, affichage de la répartition et de la règle appliquée.
- Bénéficiaires : import, mouvements, recherche.

## 6. Raccourcis clavier (configurables, affichés par `?`)

`/` recherche patient ; `N` nouveau patient ; `Alt+R` résumé ; `Alt+C` consultation ; `Alt+P` prescription ; `Alt+F` facture du patient ; `Ctrl+Entrée` enregistrer et continuer ; `Ctrl+P` imprimer le document courant ; `Échap` fermer ; `Alt+L` verrouiller le poste.

## 7. Saisie et validation

- Validation au fil de la saisie par les schémas Zod partagés ; messages courts en français.
- Contrôles de plausibilité (ex. poids de 200 kg pour un nourrisson) : confirmation explicite avec motif (`vital_sign.plausibility_override_reason`).
- Aucune perte de saisie : brouillons automatiques en Dexie toutes les 5 secondes pour les formulaires longs (consultation, compte rendu).
- Dates : saisie au format `JJ/MM/AAAA`, âge estimé accepté (`35 ans`, `18 mois`, `3 sem`).
- Montants : séparateur de milliers espace, devise toujours affichée, double affichage USD et CDF quand utile.

## 8. Internationalisation

- `next-intl`, fichiers `apps/web/messages/fr.json` (référence) et `en.json`. Clés en anglais hiérarchisées par module (`pat.register.title`).
- Formats de date, nombre et devise par locale (`fr-CD`, `en`).
- Les libellés configurables (formulaires, catalogues, modèles) ont des champs par langue (`labels: { fr, en }`).
- Phase 3 : lingala (`ln`) et swahili (`sw`).

## 9. Impression

- Documents générés côté client (`@react-pdf/renderer`, chargé à la demande) à partir des modèles `document_template` : fonctionne hors connexion.
- Formats : A4, A5, ticket 80 mm (ticket de file, reçu de caisse).
- Ordonnance et résultats avec QR de vérification (code de vérification lisible ; la vérification en ligne est une page publique minimale qui confirme l'authenticité sans afficher de données de santé).
- Mentions légales issues de la configuration (vide par défaut, jamais inventées).

## 10. Accessibilité et aide

- Navigation au clavier, focus visible, libellés ARIA sur les composants shadcn.
- Aide contextuelle (icône « ? » ouvrant l'article de la base de connaissances lié à l'écran).
- Parcours guidés intégrés pour la formation (premier accès à chaque écran clé).

## 11. Mode formation et démonstration

Bandeau « Base de formation » permanent (`docs/06-configuration.md`).

## 12. Composants communs à créer (S4 et S5)

`PatientBanner`, `PatientSearch`, `SyncIndicator`, `OfflineNotice` (pour les écrans en ligne seulement), `MoneyInput`, `MoneyDisplay`, `DateOrAgeInput`, `CodedSelect` (CIM-10, ATC, examens), `VitalSignInput`, `TrendSparkline`, `AlertList`, `ApprovalDialog` (quatre yeux), `BreakGlassDialog`, `PrintButton`, `FreshnessBadge`, `EmptyState`, `DataTable` (tri, filtre, pagination locale).
