# 03. Multi-tenant, sécurité, confidentialité

## 1. Isolation des structures

- Base unique. Chaque table métier a `tenant_id uuid not null`, clé primaire `id uuid` (UUID v7), index composites commençant par `tenant_id`.
- Sur **chaque** table métier :

```sql
ALTER TABLE patient ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patient
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY platform_scope ON patient
  USING (current_setting('app.scope', true) = 'platform');
```

- La politique `platform_scope` est en lecture seule (`FOR SELECT`) sur les tables métier : le super-admin peut lire pour la supervision et l'export, jamais écrire dans les données cliniques d'une structure.
- Les politiques sont générées par un utilitaire (`packages/db/src/rls.ts`) appelé dans chaque migration qui crée une table métier, pour qu'aucune table ne soit oubliée. Un test vérifie que toute table possédant `tenant_id` a RLS activée et forcée.

### Contextes d'exécution (`packages/db/src/context.ts`)

```ts
export async function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${ctx.tenantId}, true),
                                set_config('app.user_id', ${ctx.userId}, true),
                                set_config('app.scope', 'tenant', true)`);
    return fn(tx);
  });
}

export async function withPlatformScope<T>(ctx: PlatformContext, fn: (tx: Tx) => Promise<T>): Promise<T>;
// positionne app.scope = 'platform' et app.user_id ; journalise l'usage dans platform_audit_log
```

- `set_config(..., true)` limite la portée à la transaction : indispensable avec un pool de connexions.
- Les repositories reçoivent `tx` en paramètre ; ils n'importent jamais `db` directement (règle ESLint).
- Tables plateforme (`tenant`, `plan`, `module`, `subscription`, `platform_invoice`, etc.) : sans RLS de structure, accessibles uniquement par le code `sadm` et `platform`. Les vues que voit une structure sur ses propres données d'abonnement passent par des fonctions de service qui filtrent par `tenant_id` de la session.
- Sur cPanel, l'utilisateur de la base possède souvent les tables : `FORCE ROW LEVEL SECURITY` est donc obligatoire.

### Tests d'isolation (`pnpm db:test-isolation`)

Pour chaque table métier : création de données dans deux structures, puis tentatives de lecture, mise à jour, insertion avec un `tenant_id` étranger, depuis le contexte de l'autre structure. Toutes doivent échouer ou renvoyer zéro ligne. Test API équivalent sur chaque route de lecture par identifiant.

## 2. Authentification

### Connexion (en ligne)
1. Saisie du **code de structure** (mémorisé ensuite sur l'appareil), de l'identifiant (nom d'utilisateur ou téléphone) et du mot de passe.
2. Vérification Argon2id (`@node-rs/argon2`, mémoire 19 Mio, 2 itérations, parallélisme 1 ; paramètres ajustables si l'hébergeur limite la mémoire ; repli `bcryptjs` coût 12 avec migration du hachage à la connexion suivante).
3. 2FA TOTP si requise par le rôle ou la structure.
4. Si l'appareil n'est pas enregistré : enregistrement (`docs/02-offline-sync.md`), définition du PIN, affichage du code de récupération.
5. Création de session : table `session` (`id`, `user_id`, `tenant_id`, `device_id`, `created_at`, `last_seen_at`, `expires_at`, `ip`, `user_agent`, `revoked_at`), cookie `medhub_session` (`HttpOnly`, `Secure`, `SameSite=Lax`, chemin `/`), valeur = identifiant aléatoire 256 bits ; seul son hachage SHA-256 est stocké.
6. Durées : inactivité 12 h (configurable), absolue 7 jours, rotation de l'identifiant à chaque élévation de privilège.

### Déverrouillage hors connexion
Saisie du PIN : déchiffrement de la DEK, vérification du jeton hors connexion (signature, expiration, appareil). Aucun mot de passe n'est stocké sur le poste.

### Politique de mots de passe (configurable par structure)
Longueur minimale 10, vérification contre une liste de mots de passe courants embarquée, pas de règle de composition obligatoire par défaut, renouvellement optionnel. Réinitialisation par l'administrateur de structure (mot de passe temporaire à changer) ou par lien courriel ou SMS à usage unique (30 minutes).

### Double authentification
TOTP (`otplib`), obligatoire pour : super-admin, support plateforme, administrateur de structure, gestionnaire de facturation, et tout rôle marqué « privilégié ». Optionnelle ailleurs. Codes de secours (10 codes à usage unique, hachés).

### Protection contre la force brute
Verrouillage progressif par compte (5 échecs : 1 min, 10 : 15 min, 20 : verrouillage jusqu'à intervention), limitation par IP, règles d'IP automatiques (section 6). Détection d'anomalies : nouvel appareil, horaire atypique, pays inhabituel (si l'information est disponible), notifiés à l'administrateur.

## 3. Autorisation

Détail dans `docs/05-roles-permissions.md`. Points de sécurité :
- Contrôle **toujours** côté serveur (`requirePermission(ctx, 'invoice:discount', { scope })`), même si l'interface masque déjà l'action.
- Règles complémentaires (ABAC) évaluées par `packages/domain/src/core/access.ts` : site, service, plage horaire, sensibilité du dossier.
- Quatre yeux sur les opérations à risque au-delà d'un seuil (remise, annulation de facture, ajustement de stock, fusion de patients, désactivation d'un administrateur).

## 4. Bris de glace (accès d'urgence)

- Bouton « Accès d'urgence » sur un dossier hors des droits habituels ou sensible.
- Motif obligatoire (liste configurable + texte libre), durée limitée (4 heures par défaut).
- Fonctionne hors connexion **pour les dossiers déjà présents sur l'appareil**.
- Crée `break_glass_event` (utilisateur, patient, motif, début, fin, appareil), notifie le responsable désigné de la structure et, selon la configuration, le patient (phase 2 via le portail).
- Revue a posteriori obligatoire dans le tableau de revue des accès.
- Jamais bloqué par la licence ou l'état d'abonnement.

## 5. Protection des données

- TLS 1.2 minimum, HSTS.
- Chiffrement local (AES-GCM) : `docs/02-offline-sync.md`.
- **Chiffrement applicatif serveur** des champs les plus sensibles : catégories VIH, santé mentale, violences, identifiants nationaux éventuels, notes marquées confidentielles. Enveloppe : clé de données par structure (DEK serveur, AES-256-GCM) chiffrée par la clé maîtresse `MEDHUB_FIELD_MASTER_KEY` (variable d'environnement, jamais en base). Colonnes concernées de type `bytea` avec suffixe `_enc`. Rotation planifiée de la clé maîtresse par ré-enveloppement des DEK.
- Fichiers chiffrés (`docs/01-architecture.md` section 7).
- Sauvegardes chiffrées avant de quitter le serveur (`docs/09-hebergement-deploiement.md`).
- Minimisation dans les journaux et rapports d'erreur.
- Secrets hors du dépôt (variables d'environnement cPanel), accès restreint, rotation après départ d'un intervenant.

## 6. Traçabilité

### Journal d'audit (`audit_log`)
Colonnes : `id`, `tenant_id`, `seq` (par structure), `at`, `user_id`, `device_id`, `ip`, `action` (`create`, `update`, `void`, `read`, `export`, `print`, `login`, `break_glass`, `config_publish`...), `entity`, `entity_id`, `patient_id` (si applicable), `reason`, `diff jsonb` (sans contenu clinique en clair pour les catégories sensibles), `prev_hash`, `hash`.

Chaînage : `hash = SHA-256(prev_hash || canonical_json(ligne sans hash))`. Insertion sérialisée par structure via `pg_advisory_xact_lock(hashtext(tenant_id))`. Job quotidien de vérification de la chaîne ; rupture = alerte de sécurité.

### Journal d'accès au dossier (`data_access_log`)
Une ligne par ouverture de dossier (résumé, consultation, résultat, document) : utilisateur, patient, écran, motif si exceptionnel. Hors connexion, les lectures sont enregistrées localement et envoyées par la commande `audit.record_read`.

### Tableau de revue (administrateur)
Accès aux dossiers de collègues (patients marqués « personnel »), accès hors service ou hors horaire, consultations massives (plus de N dossiers en une heure), bris de glace, exports.

### Actions de la plateforme
Toute action du super-admin ou du support sur une structure est écrite dans `platform_audit_log` et **visible par la structure concernée** dans ses paramètres.

### Prise en main par le support
Uniquement avec autorisation de l'administrateur de la structure (durée limitée, 2 heures par défaut), bandeau visible pour tous les utilisateurs connectés, entièrement tracée, révocable à tout moment.

## 7. Protection de la plateforme

- En-têtes : `Content-Security-Policy` stricte (pas d'`unsafe-inline` pour les scripts, nonces), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictive, `X-Frame-Options: DENY`.
- CSRF : cookie `SameSite=Lax` + vérification de l'en-tête `Origin` sur toute écriture + jeton double soumission pour les formulaires classiques.
- Validation stricte des entrées (Zod), échappement des sorties (React), aucune construction SQL par concaténation.
- **Règles d'IP** (`ip_rule`) : adresse ou plage CIDR, action (`block`, `allow`, `monitor`), portée (`platform`, `admin`, `tenant`), durée, motif, origine (`manual`, `auto`). Contrôlées dans le middleware de Next.js (appelé `proxy` dans les versions récentes), avec cache mémoire de 60 s. Blocage automatique temporaire sur motifs d'abus (force brute, énumération de comptes, volume anormal). Liste blanche possible pour une structure. Sur cPanel, doublage possible par l'outil « IP Blocker ».
- Événements de sécurité (`security_event`) consultables et exportables, avec alertes.
- Analyse des dépendances en CI (`pnpm audit`), mises à jour régulières, test d'intrusion avant l'ouverture commerciale.

## 8. Réponse aux incidents

Procédure documentée dans `infra/cpanel/incident.md` (à créer en S15) : détection, confinement (révocation de sessions, blocage d'IP, mise en lecture seule), évaluation, notification des structures et des autorités selon la réglementation applicable, correction, retour d'expérience.

## 9. Conformité et droits des patients

- Principes : finalité, minimisation, exactitude, conservation limitée, sécurité, transparence.
- Droit d'accès : export du dossier d'un patient en PDF et en JSON structuré.
- Droit de rectification : correction par nouvelle version sans effacement de l'historique clinique.
- Consentement explicite et documenté pour tout partage entre structures (phase 2).
- Conditions d'utilisation et politique de confidentialité par structure (texte configurable).
- Politique de conservation configurable par structure. **Aucune suppression automatique** de dossier médical.
- Secret médical : accès limité aux professionnels impliqués, accès exceptionnel tracé.
- Vérification juridique avant ouverture commerciale (localisation des données, déclaration éventuelle, contrats de sous-traitance, durée de conservation, licences des nomenclatures). Aucun choix juridique n'est codé en dur.
