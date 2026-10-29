# Module SHARE : identité globale, consentement, partage inter-structures

- **Phase** : 2 (tables et points d'accroche créés dès le MVP)
- **Dépend de** : PAT
- **Prérequis** : validation juridique (Code du numérique de 2023 et textes sectoriels) avant ouverture.

## Modèle à deux couches

1. **Identité patient globale** (`person_global`, table plateforme) : état civil minimal (hachages pour la recherche), téléphone haché, **QR de santé** (jeton opaque imprimé sur la carte patient). Aucune donnée clinique.
2. **Dossier local** par structure (`patient`), **cloisonné par défaut**.

Le lien entre dossiers locaux d'une même personne passe par `person_global_id`.

## Consentement

- Objet `consent` : donneur (patient ou représentant légal), structure bénéficiaire, catégories de données (allergies, traitements, antécédents, résultats, comptes rendus, imagerie, vaccins), périmètre temporel (depuis, jusqu'à), motif, durée de validité, statut.
- Modes d'octroi : en présence (signature sur tablette ou code à usage unique envoyé par SMS au patient), via le portail patient (PORT), ou par code remis à l'accueil de la structure d'origine.
- Révocation à tout moment ; effective dès la synchronisation ; journalisée.
- Tous les consentements sont visibles par le patient (PORT) et par les structures concernées.

## Consultation externe

- La structure bénéficiaire, avec consentement valide, voit les catégories autorisées du dossier d'origine **en lecture seule**, avec filigrane de la structure d'origine et indication de fraîcheur.
- Les données externes s'affichent dans le résumé et les courbes, distinguées visuellement (`origin_tenant_id`).
- Chaque accès externe est journalisé dans `share_access_log`, visible par la structure d'origine et par le patient.
- Implémentation : API de partage interne `withPlatformScope` limitée à la lecture des catégories consenties, jamais d'accès direct d'une structure aux tables d'une autre.

## Accès d'urgence inter-structures

Bris de glace avec motif obligatoire, durée limitée (4 h), notification au patient et à la structure d'origine, revue a posteriori par les deux structures.

## Référence et contre-référence

Transfert d'un résumé clinique structuré (`docs/12-interoperabilite.md` section 10), accusé de réception, contre-référence en retour rattachée au dossier d'origine.

## Hors connexion

**Jamais disponible hors connexion** pour la recherche et l'octroi. Les copies externes déjà reçues restent affichées avec leur date de dernière mise à jour.

## Rapprochement d'identité

Recherche d'une personne globale par QR de santé (prioritaire), ou par combinaison nom, date de naissance et téléphone avec confirmation par code SMS au patient. Jamais de rapprochement automatique silencieux.

## Critères d'acceptation

Patient suivi par deux structures ; consentement accordé pour allergies et traitements uniquement ; la seconde structure voit ces seules catégories ; révocation effective à la synchronisation suivante ; journal visible côté patient.
