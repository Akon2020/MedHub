# Journal d'avancement

Tenu à jour par Claude Code à la fin de chaque session de travail. Le porteur du projet le lit pour savoir où en est le projet.

## État courant

- Jalon en cours : **J0 Fondations** terminé côté code (critère de sortie atteint en tests automatisés) ; **J1, semaine S4, commencée** sur instruction du porteur du projet du 30/10/2026 (« poursuis avec l'étape suivante »). Reste à faire pour clore formellement J0 : liste de contrôle cPanel sur l'hébergement réel et premier déploiement, validation de la décision d'architecture et des écarts par le porteur du projet.
- S4 livré : double authentification TOTP (imposée aux rôles privilégiés, codes de secours, sans rejeu), limitation de débit en base, règles d'IP et blocage automatique, journal `security_event`, CSP à nonce, écran « Mon compte » (2FA, sessions ouvertes, apparence), mesure de la durée des requêtes. Seconde partie de S4 livrée le même jour : écrans Paramètres (organisation : structure, sites, services ; journal de sécurité), confirmation par second facteur (step-up, 15 minutes) avec rotation de l'identifiant de session, détection des connexions inhabituelles (nouvel appareil, horaire inhabituel). **S4 terminée.**
- S9 (06/11/2026, « démarre S9 ») : consultation (note signée, diagnostics codés), formulaires cliniques configurables (moteur, constructeur, modèle « Consultation générale »), prescription avec alertes et réconciliation simple, ordonnance A5 avec QR et page de vérification. **Critère de sortie de J1 atteint en test automatisé** : scénario Playwright P1 (accueil, triage puis consultation hors connexion, synchronisation sans aucun rejet). **S9 terminée côté code.** Restent pour clore J1 formellement : votre validation des écarts « à valider » et les étapes de P1 qui dépendent de J2 (caisse, laboratoire, pharmacie).
- S8 (02/11/2026, « Start S8 ») : allergies, antécédents et problèmes ; index chronologique et journal des accès ; constantes (plages normales réglables, tendances, IMC, surface corporelle, NEWS2) ; accès d'urgence hors connexion avec revue ; programmes chroniques et perdus de vue ; courbes de croissance OMS. **S8 terminée côté code.** La consultation et les notes signées viennent en S9.
- S7 (02/11/2026, « Start S7 ») : configuration des files, types de rendez-vous et agendas ; visites et tickets hors connexion ; écran des files et écran d'appel ; triage avec orientation ; rendez-vous avec créneaux, surréservation et conflit tranché à l'arrivée au serveur ; visites et rendez-vous dans le périmètre de synchronisation. **S7 terminée côté code.** Rappels SMS en attente du fournisseur.
- S6 (31/10/2026, « Start S6 ») : détection des doublons de patients livrée (score partagé, alerte avant création sur le poste, tâche de fond après synchronisation, file des doublons) , fusion supervisée et réversible, identité complète avec historique et revue des conflits (partie démographique de P2) , recherche serveur, carte patient avec QR, patients provisoires, décès, sensibilité des dossiers, favoris et périmètre de synchronisation livrés. **S6 terminée côté code** (01/11/2026).
- S5 : appareils (liste, retrait, perte, effacement à distance) et jetons signés Ed25519 (hors connexion 14 jours, licence) livrés. Configuration versionnée (`config_entry`, brouillon, publication, archivage, restauration) livrée avec les réglages de sécurité des postes. Gestion des utilisateurs livrée (création avec mot de passe temporaire, rôles, désactivation, réinitialisation du mot de passe et de la 2FA, dernier administrateur protégé, politique de mot de passe). Éditeur de rôles livré (grille avec périmètres, duplication, retour au modèle, 2FA des rôles privilégiés). Référentiels livrés (listes de choix avec import CSV, devises, unités, provinces, copie locale sur les postes). Traduction anglaise complète livrée (langue du compte appliquée à la connexion, test de parité et de couverture des messages). Diagnostic complété et base de formation livrée. **S5 terminée.**
- Thème sombre livré sur toute l'application (demande du porteur du 30/10/2026).
- Récapitulatif complet de tout ce qui a été fait : `walkthrough.md`.
- Dernière mise à jour : 06/11/2026
- Version déployée : aucune
- Branche de travail : `develop`

### Critère de sortie J0 : état

| Exigence | État | Preuve |
| --- | --- | --- |
| 500 opérations sur deux postes avec coupures aléatoires | Atteint (banc en mémoire) | `packages/sync/test/prototype.props.test.ts` : 500 opérations, 55 envois échoués, 7 réponses perdues après validation serveur, 25 doublons absorbés |
| Zéro perte, zéro doublon | Atteint | Nombre d'entités serveur égal au nombre de créations, aucun `op_id` en double, outbox vide à la fin |
| Convergence des bases | Atteint | Bases locales des deux postes identiques à la base serveur, solde de stock égal à la somme des mouvements ; propriété vérifiée sur 15 graines aléatoires |
| Même banc contre PostgreSQL réel | Atteint | `apps/web/test/integration/sync-postgres.test.ts` (160 opérations, RLS, triggers, audit chaîné intact) |
| Aucun nom en clair dans IndexedDB | Atteint | `packages/local-db/test/local-db.test.ts` inspecte le contenu brut de toutes les tables |
| Banc Playwright à deux navigateurs réels | Atteint | `apps/web/e2e/sync-bench.spec.ts` sur un build de production et une structure neuve à chaque passe : 500 opérations (226 enregistrements, 96 modifications, 178 constantes), 109 cycles de synchronisation coupés par `context.setOffline`, 38 réponses de push perdues après validation serveur ; zéro rejet, zéro doublon, postes identiques au serveur, aucun nom en clair dans IndexedDB |
| Saisie hors connexion depuis l'écran | Atteint | Même fichier : patient enregistré par le formulaire sans réseau, conservé après un rechargement complet, puis synchronisé |

## Résultats de la liste de contrôle cPanel

Non réalisée : l'hébergeur n'est pas encore choisi. Modèle à remplir : `infra/cpanel/checklist-resultats.md`.

Environnement de développement constaté sur le poste du porteur du projet : Windows 11, Node.js 26.3, pnpm 12.11, PostgreSQL 18.6 local (sans Docker). Rôle applicatif `medhub_app` non superutilisateur, bases `medhub_dev` et `medhub_test`, extensions `pg_trgm` et `unaccent` disponibles. La CI utilise PostgreSQL 16 et Node.js 22.

## Décisions prises en cours de route

| Date | Décision | Raison | Documents mis à jour |
| --- | --- | --- | --- |
| 29/10/2026 | Identité visuelle teal (accent `#0f6b6b`) avec effets de verre sur les pages publiques et la connexion, écrans opérationnels sobres | Choix du porteur du projet à partir des maquettes fournies | `docs/07-ui-ux.md` section 1 |
| 29/10/2026 | TypeScript 6.0.3 et ESLint 9.39 au lieu des toutes dernières versions (TypeScript 7, ESLint 10) | `typescript-eslint` exige TypeScript < 6.1 et `eslint-config-next` est validé sur ESLint 9 | aucun |
| 29/10/2026 | `lucide-react` 1.62.0 | La politique de pnpm refuse les paquets publiés depuis moins de 24 h | aucun |
| 29/10/2026 | Service worker compilé par esbuild avec le moteur Serwist, après `next build` | `@serwist/next` ne prend pas en charge le build Turbopack de Next.js 16 | aucun |
| 29/10/2026 | Hachage des mots de passe exposé par le sous-chemin `@medhub/db/password` | Le worker est un fichier unique sans module natif | aucun |
| 29/10/2026 | Point d'entrée Passenger `web/app.cjs` qui importe le serveur standalone | Le serveur standalone de Next.js 16 est un module ES | `guide.md` |
| 29/10/2026 | Rechargement complet d'une page de `/app` : nouveau déverrouillage par PIN | Les clés locales vivent uniquement en mémoire (`docs/02-offline-sync.md` section 3) | aucun |
| 30/10/2026 | Thème sombre livré dès maintenant sur toute l'application (Système, Clair, Sombre, cookie `medhub_theme`) | Demande du porteur du projet ; `docs/07` le prévoyait en phase 2 | `docs/07-ui-ux.md` section 1 |
| 30/10/2026 | S4 commencée | Instruction du porteur du projet ; critère de sortie technique de J0 atteint | aucun |
| 30/10/2026 | `otplib` 13.5.0 et `qrcode` 1.5.4 côté serveur uniquement | TOTP imposé par la pile ; QR produit en SVG par le serveur pour ne rien ajouter au budget client | aucun |

## Écarts par rapport à `docs/`

| Date | Document | Écart | Validé par le porteur du projet |
| --- | --- | --- | --- |
| 06/11/2026 | `docs/modules/form.md` | Types tableau, schéma anatomique, image et signature reportés ; brouillon local non synchronisé ; correction par remplacement au lieu de `form_response.correct` ; le serveur contrôle la forme des réponses, pas les obligations (contexte du poste) ; index des champs « reportables », parcours cliniques et modèles de comptes rendus reportés | À valider |
| 06/11/2026 | `docs/modules/form.md` | Un seul modèle de départ livré, « Consultation générale » (décision du porteur au lancement de S9) | Tranché |
| 06/11/2026 | `docs/modules/dpi.md` section 5 | Catalogue de médicaments et règles d'interaction importés par CSV, aucune liste OMS ni nationale préchargée (décision du porteur au lancement de S9) ; doses maximales en nombres (par prise, par jour, par kilo et par jour) au lieu d'un `jsonb` par âge et poids | Tranché pour l'import, à valider pour les colonnes |
| 06/11/2026 | `docs/modules/dpi.md` section 5 | Gravité des interactions : majeure et contre-indiquée bloquantes, modérée avertit, mineure informe ; grossesse saisie par une case de la prescription en attendant MAT ; reconnaissance des insuffisances rénale et hépatique par les codes CIM-10 des problèmes actifs (N17 à N19, K70 à K77) | À valider |
| 06/11/2026 | `docs/modules/dpi.md` section 5 | Le serveur ne refuse pas une ordonnance dont il trouve une alerte bloquante que le poste ne connaissait pas : il la garde et la signale dans le journal de sécurité (aucune perte d'une ordonnance déjà remise) ; il refuse seulement un passage outre sans la permission | À valider |
| 06/11/2026 | `docs/modules/dpi.md` section 5 | Annulation d'une ordonnance entière avec motif (gardé dans `op_log`) ; arrêt d'une ligne et statuts de dispensation reportés à la pharmacie (S12) | À valider |
| 06/11/2026 | `docs/modules/dpi.md` section 4 | Diagnostics : code CIM-10 saisi avec contrôle de format et liste importée par la structure, aucune liste fournie (décision du porteur au lancement de S9) ; note en cinq rubriques fixes en attendant les formulaires de note | Tranché pour la liste, à valider pour les rubriques |
| 06/11/2026 | `docs/07-ui-ux.md` section 9 | Mise en page de l'ordonnance fixe en attendant les modèles de documents (`document_template`) ; page publique `/verifier` (structure, date, statut) | À valider |
| 06/11/2026 | `docs/08-parcours-acceptation.md` P1 | La demande de goutte épaisse (étape 5) arrive avec le laboratoire (S13) ; le scénario automatisé couvre les étapes 1 et 3 à 6 sans la caisse | À valider |
| 06/11/2026 | `docs/02-offline-sync.md` | Crochet `checkEntity` du moteur serveur : contrôles qui lisent la base (réponse de formulaire contre sa version, permission de passer outre) avant d'appliquer une opération | À valider |
| 29/10/2026 | `docs/07-ui-ux.md` | Accent teal et effets de verre au lieu de bleu sombre sans dégradé | Oui (échange du 29/10/2026), document mis à jour |
| 29/10/2026 | `docs/03-multitenant-securite.md` section 1 | RLS appliquée par introspection après chaque migration (`ensureRls`, toute table ayant `tenant_id`) plutôt qu'un appel dans chaque migration. Plus sûr : aucune table ne peut être oubliée | À valider |
| 29/10/2026 | `docs/03-multitenant-securite.md` section 2 | Cookie de session `<tenantId>.<jeton>.<HMAC>` : l'identifiant de structure sert seulement à cibler la recherche sous RLS, l'accès dépend du hachage du jeton trouvé dans cette structure | À valider |
| 29/10/2026 | `docs/04-modele-donnees.md` | Table `job` exemptée de RLS de structure (infrastructure traitée par le worker pour toutes les structures, charge utile sans donnée de santé) | À valider |
| 29/10/2026 | `docs/04-modele-donnees.md` | `role.tenant_id` obligatoire : les rôles modèles vivent dans `packages/shared/src/permissions.ts` et sont copiés dans chaque structure ; `role_permission` et `user_role` portent `tenant_id` pour la RLS | À valider |
| 29/10/2026 | `docs/04-modele-donnees.md` | Colonne `patient.field_meta` (horloge HLC et version par champ) pour la stratégie `field_merge` | À valider |
| 29/10/2026 | `docs/05-roles-permissions.md` | Permission `device:register` ajoutée au catalogue (enregistrement d'un poste) et donnée aux rôles modèles | À valider |
| 29/10/2026 | `docs/02-offline-sync.md` section 8 | Périmètre de synchronisation : toute la structure pour l'instant, filtrée par permission de lecture par entité (`sync_scope_rule` en S6) | Remplacé le 01/11/2026 (ligne suivante) |
| 01/11/2026 | `docs/02-offline-sync.md` section 8 | `sync_scope_rule` livrée avec le mode « toute la structure » par défaut (pilote bien en dessous de 5 000 patients) ; le mode « périmètre » couvre créés sur le poste, favoris, épinglés et activité récente (dernière modification ou constante), en attendant visites, rendez-vous, hospitalisations et programmes chroniques ; table `device_patient` et retrait des postes par `evict` | À valider |
| 30/10/2026 | `docs/10-tests-qualite.md` section 1 | Banc Playwright exécuté sur un build de production dédié (`.next-e2e`) plutôt que sur le serveur de développement, service worker bloqué | À valider |
| 29/10/2026 | `docs/09-hebergement-deploiement.md` section 8 | Développement sur PostgreSQL local (Docker absent du poste) ; `infra/docker` reste fourni | Constat |
| 30/10/2026 | `docs/03-multitenant-securite.md` section 2 | Défi de 2FA sans état (jeton HMAC lié à la structure, à l'utilisateur et à l'usage, 5 ou 15 minutes) ; il n'accorde rien seul et chaque échec alimente le verrouillage du compte | À valider |
| 30/10/2026 | `docs/03-multitenant-securite.md` section 2 | Codes de secours remplacés (supprimés puis recréés) à chaque régénération : identifiants, pas données cliniques ni financières | À valider |
| 30/10/2026 | `docs/03-multitenant-securite.md` section 5 | Secret TOTP chiffré avec une clé dérivée par HKDF de `MEDHUB_FIELD_MASTER_KEY` et de la structure, en attendant l'enveloppe complète (DEK par structure) | À valider |
| 30/10/2026 | `docs/04-modele-donnees.md` | Tables `rate_limit`, `ip_rule`, `security_event` sans `tenant_id` (colonne `target_tenant_id`) : elles servent avant la résolution de la structure ; `security_event` protégée en ajout seul par trigger | À valider |
| 30/10/2026 | `docs/03-multitenant-securite.md` section 2 | Step-up : toute modification de configuration exige une preuve du second facteur de moins de 15 minutes (valeur codée en attendant la configuration versionnée de S5) ; rotation de l'identifiant de session à chaque step-up et à l'activation de la 2FA | À valider |
| 30/10/2026 | `docs/06-configuration.md` | Organisation (structure, sites, services) modifiée directement avec audit, sans cycle brouillon et publication (S5) ; sites et services pas encore distribués aux postes (S5) | À valider |
| 30/10/2026 | `docs/03-multitenant-securite.md` section 2 | Connexions inhabituelles : nouvel appareil et horaire inhabituel seulement (aucune géolocalisation), signalées dans le journal de sécurité de la structure ; notification courriel ou SMS avec le module NOTIF | À valider |
| 30/10/2026 | `docs/02-offline-sync.md` section 9 | Clés publiques des jetons remises au poste à l'activation et conservées localement, au lieu d'être compilées dans l'application | À valider |
| 30/10/2026 | `docs/02-offline-sync.md` section 9 | Licence calquée sur l'état de la structure, tous les modules MVP, sans plan ni limite, jusqu'à SADM (S14) ; postes activés avant S5 tolérés sans jeton jusqu'à leur prochaine synchronisation | À valider |
| 02/11/2026 | `docs/03-multitenant-securite.md` section 4 et `docs/05` section 2 | Dossiers sensibles envoyés à tous les lecteurs, chiffrés et verrouillés sur le poste derrière l'accès d'urgence (décision du porteur) ; motifs d'accès d'urgence fixes (urgence vitale, patient inconscient, continuité des soins, autre) en attendant une liste configurable ; notification du responsable par le journal de sécurité et le tableau de revue (pas encore de courriel ni de SMS) | À valider |
| 02/11/2026 | `docs/modules/dpi.md` section 3 | Aucune plage normale fournie par défaut (références cliniques à choisir par la structure) ; tendance stable à 2 % de la mesure précédente sauf marge réglée ; NEWS2 sans conscience ni oxygène tant qu'ils ne sont pas saisis (marqué partiel) | À valider |
| 02/11/2026 | `docs/modules/dpi.md` section 6 | « Perdu de vue » calculé à la demande sur le serveur (liste d'appels en ligne) plutôt que par une tâche de fond ; la tâche viendra avec les rappels SMS ; dernier contact = visite, constante ou triage | À valider |
| 05/11/2026 | `docs/modules/dpi.md` section 3 | Tables OMS mensuelles (0 à 5 ans) et mensuelles étendues (5 à 19 ans) avec interpolation linéaire de L, M et S selon l'âge exact (30,4375 jours par mois), au lieu des tables journalières : précision suffisante, données 30 fois plus légères | À valider |
| 02/11/2026 | `docs/modules/rdv.md` | Numéro de ticket `{PRÉFIXE}-{POSTE}-{NNN}` (compteur par file, poste et jour) pour rester unique hors connexion ; numéro de visite `{SITE}-{POSTE}-{AAAA}-{SEQ6}` | À valider |
| 02/11/2026 | `docs/05-roles-permissions.md` section 3 | `queue_ticket.issue` exige `queue:call` (accueil, infirmier, médecin), pour que le triage puisse orienter ; rôle modèle Infirmier complété par `encounter:read` | À valider |
| 02/11/2026 | `docs/modules/rdv.md` | Événements de file non stockés à part : les appels ignorés restent dans `op_log` (`merged`, `TRANSITION_IGNORED`) ; `workflow.pay_before_consultation` inactif tant que la caisse n'existe pas (S10) ; rappels SMS et rendez-vous récurrents reportés (fournisseur SMS non choisi, programmes chroniques en S8) | À valider |
| 02/11/2026 | `docs/04-modele-donnees.md` | `queue.code`, `queue.is_active`, `appointment_type.code`, `schedule_exception.slot_min`, `appointment.notes`, `triage.orientation_queue_id` et `triage.triaged_at` ajoutés ; ressources salle et équipement sans table pour l'instant | À valider |
| 01/11/2026 | `docs/05-roles-permissions.md` section 3 | Permission `patient:mark_deceased` ajoutée (« permission dédiée » de `docs/modules/pat.md`), donnée au rôle modèle Médecin et à l'administrateur | À valider |
| 01/11/2026 | `docs/05-roles-permissions.md` section 2 | Sans condition `sensitivity_max`, un rôle n'ouvre que les dossiers normaux, sauf s'il porte `patient:mark_sensitive` (tous les niveaux) ; pas de bris de glace avant le dossier médical (S8) : un dossier au-dessus du niveau reste fermé hors urgence | À valider |
| 01/11/2026 | `docs/modules/pat.md` | Commandes `patient.update` (identité, identification d'un provisoire), `patient.mark_deceased`, `patient.set_sensitivity`, `patient.favorite` ; signalement manuel d'une paire de doublons (`reasons = ['manual']`) | À valider |
| 01/11/2026 | `docs/03-multitenant-securite.md` section 7 (CSP) | `'wasm-unsafe-eval'`, `connect-src data:` et `worker-src blob:` ajoutés pour la génération de PDF sur le poste | À valider |
| 01/11/2026 | `docs/modules/pat.md` carte | Modèle de carte fixe (format ID-1) en attendant les modèles de documents configurables ; lecture par douchette ou saisie, caméra plus tard | À valider |
| 01/11/2026 | `docs/02-offline-sync.md` et `docs/08-parcours-acceptation.md` (P2, variante) | Contradiction : valeur serveur gardée (docs/02) ou valeur au HLC le plus récent (docs/08). Tranché par le porteur le 01/11/2026 : `docs/02` ; `docs/08` aligné | Tranché |
| 01/11/2026 | `docs/modules/pat.md` | Une seule personne à contacter (valeur structurée) au lieu de `patient.add_contact` en union ; revue des conflits réservée à `patient:merge` | À valider |
| 31/10/2026 | `docs/modules/pat.md` fusion | « Quatre yeux si configuré » non appliqué en attendant le module d'approbations (`approval_request`) ; fusion soumise à `patient:merge` et à un motif | À valider |
| 31/10/2026 | `docs/06-configuration.md` section 5 | Réinitialisation de la base de formation par archivage de l'ancienne structure et création d'une nouvelle sous le même code (aucune suppression, tables cliniques en ajout seul) ; « copie à la demande » de la configuration réalisée par cette même réinitialisation | À valider |
| 31/10/2026 | `docs/04-modele-donnees.md` | Colonne `tenant.training_source_id` ajoutée ; unicité de `tenant.code` hors bases de formation archivées | À valider |
| 30/10/2026 | `docs/04-modele-donnees.md` | Tables `unit` et `admin_area` ajoutées (plateforme, sans `tenant_id`), `choice_list` et `choice_item` par structure ; `currency` sans `rounding_step` (l'arrondi de caisse sera une configuration de FACT) | À valider |
| 30/10/2026 | `docs/06-configuration.md` section 7 | Import des listes de choix sans job (petits fichiers, vérification puis confirmation à l'écran) ; le cadre complet en jobs par lots de 500 arrivera avec les gros imports (patients, tarifs, produits) | À valider |
| 30/10/2026 | `docs/05-roles-permissions.md` section 3 | Périmètre « toute la structure » proposé pour toutes les ressources, en plus de ceux du catalogue ; rôle privilégié calculé (modèle ou droit d'administration accordé) | À valider |
| 30/10/2026 | `docs/modules/core.md` règles de gestion | « Administrateur » de la règle du dernier administrateur : utilisateur actif titulaire d'un rôle en vigueur qui accorde `role:manage` | À valider |
| 30/10/2026 | `docs/03-multitenant-securite.md` section 2 | Utilisateur désactivé : ses postes retirent le jeton hors connexion à la synchronisation suivante mais conservent l'outbox chiffrée (aucune perte si le compte est réactivé) | À valider |
| 30/10/2026 | `docs/06-configuration.md` section 2 | Réglages simples publiés immédiatement (`effective_from` = date de publication) ; pas encore de publication datée dans le futur ni d'aperçu | À valider |
| 30/10/2026 | `docs/03-multitenant-securite.md` section 7 | CSP : `style-src 'unsafe-inline'` conservé pour les attributs `style` de React et des graphiques ; scripts uniquement par nonce et `strict-dynamic` | À valider |

## Marqueurs `TODO(medhub-decision)` ouverts

| Fichier | Sujet | Valeur par défaut appliquée |
| --- | --- | --- |
| `packages/db/seeds/platform/plans.json` | Grille tarifaire publique affichée sur la page d'accueil | Valeurs médianes de `docs/13-tarification.md`, mention « valeurs indicatives » |
| `.env.example` | Fournisseurs SMS et paiement | Adaptateurs `console` et `manual` |

Variables d'environnement ajoutées en S4 : `MEDHUB_FIELD_MASTER_KEY` devient **obligatoire** (secrets 2FA), `MEDHUB_SLOW_REQUEST_MS` (2000 par défaut).

## Dépendances ajoutées et justification

| Paquet | Côté | Taille compressée | Raison |
| --- | --- | --- | --- |
| `dexie` | Client | environ 30 ko | Base locale IndexedDB (pile imposée) |
| `@noble/curves` (ed25519) | Client et serveur | environ 20 ko | Signature des opérations d'appareil |
| `recharts` | Client, chargé à la demande | environ 100 ko | Graphiques (pile imposée), importé par `next/dynamic` hors du shell |
| `serwist` | Service worker | environ 15 ko | Précache et stratégies de cache hors connexion |
| `radix-ui` (Slot seulement) | Client | moins de 5 ko | Composition des boutons shadcn |
| `otplib` | Serveur seulement | sans objet | TOTP (pile imposée) |
| `qrcode` | Serveur seulement | sans objet | Code QR SVG de configuration de la 2FA |
| `jsep` 1.6.0 | Client et serveur | environ 6 ko | Analyse des expressions des formulaires (pile imposée par `docs/modules/form.md`), sans dépendance |

Budget mesuré au build du 06/11/2026 : **1 237 Kio compressés** (S9 ajoute environ 50 Kio : formulaires, constructeur, prescription). Mesure du 29/10/2026 : **549 Kio compressés** pour l'ensemble de `.next/static` (budget : 1,5 Mo). Contrôle automatique dans la CI.

## Revues de risque de fin de jalon

J0 (en cours) : le risque principal, la synchronisation, est couvert par trois niveaux de tests (propriétés en mémoire, intégration PostgreSQL, parcours réel dans le navigateur). Risques restants : comportement réel de Passenger avec Next.js 16 (à vérifier lors de la liste de contrôle cPanel), quota IndexedDB sur tablettes d'entrée de gamme, performance de PBKDF2 à 600 000 itérations sur ces mêmes tablettes (mesure à faire). Aucun élément de la liste de repli activé.

## Matrice de compatibilité testée

| Appareil | Système | Navigateur | Résultat |
| --- | --- | --- | --- |
| PC de développement | Windows 11 | Chromium (navigateur intégré) | Connexion, activation du poste, enregistrement patient, synchronisation : OK |

## Journal des sessions

### 06/11/2026

S9, consultation, formulaires et prescription (« démarre S9 ») :
- Décisions du porteur au lancement : médicaments par import CSV sans liste préchargée ; diagnostics par code saisi et import ; un seul modèle de formulaire, « Consultation générale ».
- Consultation : `packages/domain/src/dpi/consultation.ts`, migration `0022_s9_consultation` (`clinical_note`, `diagnosis`, `diagnosis_catalog_item`), brouillons chiffrés dans la base locale, écran `/app/consultation` (visites du jour, puis résumé, note, diagnostics, formulaires, prescription), bouton « Consulter » de la fiche, import de la liste des diagnostics dans Paramètres, Clinique. La première note signée passe la visite « en consultation » ; « Terminer la visite » clôt aussi le ticket en cours.
- Formulaires : paquet `@medhub/forms`, migration `0023_s9_forms`, routes `/api/v1/forms` et `/api/v1/forms/publish`, constructeur `/app/parametres/clinique/formulaires`, carte Formulaires de la consultation, modèle publié par `pnpm db:seed`.
- Prescription : `packages/domain/src/dpi/prescription.ts` et `prescription-checks.ts`, migration `0024_s9_prescription` (`drug`, `drug_interaction_rule`, `prescription`, `prescription_item`, `medication_statement`, `medication_reconciliation`), imports `/api/v1/drugs/import` et `/api/v1/drug-interactions/import`, cartes Prescription et Traitements habituels.
- Ordonnance : PDF A5 sur le poste, QR vers `/verifier`, limitation `verify-ip` (30 vérifications par 5 minutes et par adresse).
- Moteur de synchronisation : crochet `checkEntity` (réponses de formulaire, permission de passer outre) et opération signée transmise à `insertEntity`.
- Tests : 7 tests de domaine (notes, diagnostics, import), 12 tests de formulaires (expressions malveillantes refusées, conditions, calculs, publication), 11 tests de prescription (chaque alerte, imports, quantité, code de vérification), 11 tests d'intégration PostgreSQL (signature vérifiée, correction, import, publication et version figée, réponses refusées, passage outre refusé, alerte non vue signalée, annulation, traitements habituels, vérification publique), 11 tables ajoutées aux tests d'isolation (227 tests), scénario Playwright P1.
- Constat : deux commandes Bash à documents intégrés imbriqués ont échoué à l'analyse ; les scripts sont désormais écrits dans des fichiers.
- Constats Playwright : (1) le scénario « front desk registers a patient offline » a dépassé une fois ses 180 s juste après le banc de 500 opérations, puis a réussi seul et dans les deux passes complètes suivantes ; (2) le scénario du triage quittait la file juste après « Appeler », avant l'écriture locale de l'appel ; plus visible avec le ticket laissé par P1, corrigé en attendant l'état « Appelé ». Passe complète finale : 12 scénarios verts.

### 30/10/2026

Travail réalisé :
- **Thème sombre** sur toute l'application : jetons redéfinis (clair, sombre, système), surfaces décoratives en variables, couleurs en dur supprimées des composants, graphiques en variables CSS, sélecteur Système, Clair, Sombre (public, connexion, menu utilisateur, « Mon compte »), cookie `medhub_theme` lu par le serveur, aucun script en ligne.
- **S4, double authentification** : migration `0001_s4_mfa_security`, secret TOTP chiffré, configuration imposée aux rôles privilégiés à la connexion (code QR, clé manuelle, premier code, 10 codes de secours), vérification par code ou code de secours, refus du rejeu, échecs comptés dans le verrouillage, activation volontaire, régénération et désactivation avec code frais, audit chaîné de chaque étape.
- **S4, protection de la plateforme** : limitation de débit en base (connexion par adresse et par compte, vérification de code), blocage automatique d'une adresse 15 minutes, règles d'IP (plateforme et administration dans `proxy.ts`, structure dans `defineRoute`), journal `security_event` en ajout seul, purge horaire des compteurs par le worker.
- **S4, en-têtes** : CSP à nonce neuf par document (`strict-dynamic`), `upgrade-insecure-requests` en HTTPS.
- **S4, sessions** : écran « Mon compte » (`/app/compte`) avec sessions ouvertes et déconnexion des autres sessions ; option `permission` de `defineRoute` pour exiger une permission au niveau de la route.
- **Point ouvert de J0 (connexion lente)** : `Server-Timing` sur chaque route, métrique `http.duration_ms`, journalisation des requêtes lentes avec l'état du pool.
- `walkthrough.md` : récapitulatif complet du projet.

Constats :
- Le compte `admin` de la structure de démonstration `HOP-DEM-0001` (rôle privilégié) devra configurer la 2FA à sa prochaine connexion.
- Le test du worker échouait sous forte charge (build Playwright en parallèle) : le budget de 5 s du tick était dépassé avant le traitement du job de test. Budget du test porté à 20 s ; deux passes complètes de `pnpm test` vertes ensuite.
- L'annonceur de route de Next.js porte `role="alert"` : les tests doivent cibler le texte du message d'erreur.

S8, dossier longitudinal (02/11/2026 au 05/11/2026) :
- Décisions du porteur du 02/11/2026 : (1) télécharger les tables de croissance officielles de l'OMS (accord sur la liste de 22 fichiers XLSX, `cdn.who.int`, 374 Ko, le 05/11/2026) ; (2) garder les dossiers sensibles sur les postes, chiffrés et verrouillés derrière l'accès d'urgence, au lieu du retrait décidé en S6.
- Allergies, antécédents, problèmes : `packages/domain/src/dpi/record.ts`, migration `0018_s8_record` (`allergy`, `medical_history`, `problem`, `clinical_event`), journal d'accès `record_access.log`, bandeau d'allergies et cartes de la fiche.
- Constantes : `packages/domain/src/dpi/calculations.ts`, migration `0019_s8_vital_definitions`, module serveur `modules/dpi`, écran `/app/parametres/clinique`, carte « Constantes et courbes ».
- Accès d'urgence : `packages/domain/src/dpi/break-glass.ts`, migration `0020_s8_break_glass`, réglage `security.break_glass_hours`, niveau de sensibilité dans le profil, revue dans la page Sécurité, journal des accès sur la fiche, résultats masqués dans la recherche serveur.
- Programmes : `packages/domain/src/dpi/programs.ts`, migration `0021_s8_programs`, `/app/programmes`.
- Croissance OMS : `packages/domain/src/dpi/who-growth/` (moteur, tables, JSON de 57 Ko soit 18 Ko compressés, chargé à la demande). Fichiers XLSX lus avec la seule bibliothèque standard de Python puis supprimés ; contenu vérifié (les deux fichiers « poids pour l'âge 5 à 10 ans » portent un nom en `hfa` sur le site de l'OMS mais contiennent bien des poids). Le moteur reproduit les lignes de Z-scores publiées dans les mêmes fichiers.
- Tests : 21 tests de domaine, 7 tests d'intégration (dossier et journal, réglages des constantes, sensibilité revue, accès d'urgence et revue, programmes), 8 tables ajoutées aux tests d'isolation, scénario Playwright P10 (dossier restreint ouvert hors connexion par un médecin, accès et journal vérifiés en base).
- Constat : une passe des tests d'isolation a échoué une fois juste après la suite complète, puis trois passes consécutives ont réussi ; cause non reproduite.

S7, rendez-vous, files et triage (02/11/2026) :
- Configuration : `packages/domain/src/rdv/config.ts`, migration `0014_s7_rdv_config`, module serveur `modules/rdv`, routes `/api/v1/schedules`, `/queues`, `/appointment-types`, `/schedules/exceptions`, écran `/app/parametres/accueil` ; catalogues des postes complétés (files, types, agendas, exceptions à venir, soignants, fuseau) ; structure de démonstration : files Accueil (A) et Consultations externes (C), type Consultation, agenda du médecin du lundi au vendredi de 8 h à 12 h.
- Visites et files : `packages/domain/src/rdv/visits.ts`, migration `0015_s7_visits`, commandes `encounter.*` et `queue_ticket.*`, transitions « premier arrivé gagne » dans les deux moteurs, carte Arrivée de la fiche, `/app/files`, `/app/ecran-appel`.
- Triage : `packages/domain/src/rdv/triage.ts`, migration `0016_s7_triage`, carte de triage, orientation vers une autre file, constantes rattachées à la visite.
- Rendez-vous : `packages/domain/src/rdv/appointments.ts`, migration `0017_s7_appointments`, contrôle du créneau par le serveur (`slotCapacity`, `countSlotBookings`), `/app/rendez-vous`, rendez-vous de la fiche.
- Tests : 11 tests de domaine, 3 tests du moteur, 9 tests d'intégration (configuration, visites, appels concurrents, triage, réservations concurrentes, créneau hors agenda, périmètre), 4 tables ajoutées aux tests d'isolation, scénario Playwright (arrivée hors connexion, appel et triage hors connexion sur un autre poste, écran d'appel, rendez-vous hors connexion).
- Constat du banc Playwright : la copie des catalogues était stockée en clair sur le poste ; avec les noms du personnel ajoutés en S7, un nom de démonstration apparaissait dans la base locale. Les catalogues sont désormais chiffrés avec la clé de données du poste (une copie en clair d'une version antérieure est ignorée et téléchargée de nouveau), et téléchargés dès l'ouverture de la session plutôt qu'après la première synchronisation.
- Constat : sous forte charge, le test du worker échoue parfois dans la suite complète et passe seul ; même cause que le constat de S5 (budget du tick).

S6, favoris et périmètre de synchronisation (01/11/2026) :
- `packages/domain/src/pat/favorites.ts`, `packages/domain/src/core/sync-scope.ts`, migration `0013_s6_scope` (`patient_favorite` en ajout seul, `sync_scope_rule`, `device_patient`, fixtures d'isolation), `modules/sync/scope.ts` (règle effective, application au pull, arrivée du dossier complet, épinglage, écran de réglage), route `/api/v1/sync/scope`, étoile sur la fiche et filtre « Mes favoris ».
- Le pull applique : permission de lecture, propriétaire des favoris, sensibilité, périmètre. La récupération d'un patient depuis la recherche serveur renvoie maintenant ses lignes (constantes, favoris) et l'épingle sur le poste.
- Tests : 3 tests de domaine, 4 tests d'intégration (mode tout, périmètre, épinglage, règle de rôle).

S6, sensibilité des dossiers (01/11/2026) :
- `packages/domain/src/core/access.ts`, commande `patient.set_sensitivity`, condition `sensitivity_max` sur `patient:read` réglée depuis l'éditeur de rôles, `loadSensitivityMax` et `requireSensitivity` côté serveur, filtre du pull avec retrait des postes (`evict`), recherche, lecture et historique refusés au-delà du niveau (`PAT_SENSITIVE`), `evictPatient` dans les deux magasins du poste.
- Tests : 2 tests de domaine, 2 tests du moteur, 1 test de la base locale, 4 tests d'intégration, test des rôles complété.

S6, patients provisoires et décès (01/11/2026) :
- `packages/domain/src/pat/lifecycle.ts`, migration `0012_s6_lifecycle` (`is_provisional`, `provisional_kind`), modes du formulaire, bandeau et identification, signalement d'un doublon, `patient.mark_deceased`, refus des actes cliniques après le décès sur le poste et le serveur, constantes en lecture seule.
- Tests : 3 tests de domaine, 2 tests du moteur, 2 tests d'intégration, signalement et doublons provisoires (web et worker), scénario Playwright (inconnu enregistré hors connexion, favori, identifié, décès déclaré hors connexion par le médecin).

S6, carte patient et QR (01/11/2026) :
- `packages/domain/src/pat/card.ts`, migration `0011_s6_card` (`patient.card_token`), champ `cardToken` dans `patient.update`, recherche locale et serveur par jeton, `features/patients/patient-card.tsx` (PDF ID-1 avec QR, nouvelle carte en cas de perte).
- **Dépendance ajoutée** : `@react-pdf/renderer` 4.9.0 (bibliothèque de génération PDF prévue par la pile, `docs/07` section 9), chargée à la demande. Mesure sur le build : 440 Kio compressés pour son morceau ; l'ensemble mis en cache par le service worker passe à 1 092 Kio compressés, sous le budget de 1,5 Mo. `qrcode` (déjà présent côté serveur) est aussi utilisé sur le poste, chargé à la demande.
- **CSP** : `'wasm-unsafe-eval'` (WebAssembly du moteur de mise en page), `data:` dans `connect-src` et `blob:` dans `worker-src`. Sans ces trois ouvertures, aucun PDF ne peut être produit sur le poste ; découvert par le test Playwright (violations de CSP dans la console du navigateur).
- Constat sur le test « enregistrement hors connexion » : la navigation hors connexion lancée par le formulaire pouvait interrompre le `goto` suivant (`ERR_ABORTED`) ; un `goto` interrompu est maintenant relancé, au plus deux fois.
- Tests : 2 tests de domaine, attente ajoutée à la suite de recherche (deux modes), étape Playwright (impression, synchronisation du jeton, lecture).

S6, recherche serveur (01/11/2026) :
- `parsePatientQuery` dans `packages/domain`, index trigrammes conditionnel (`packages/db/src/search-index.ts`, appelé par le script de migration), service `modules/pat/search.ts` avec repli sans `pg_trgm` (`MEDHUB_SEARCH_TRIGRAM=off` pour le forcer), routes `/api/v1/patients` et `/api/v1/patients/state`, section « Sur le serveur » de l'écran Patients.
- Tant que le périmètre de synchronisation couvre toute la structure, la section ne montre que les patients pas encore reçus par le poste ; elle prendra son sens avec les règles de périmètre.
- Tests : 3 tests de domaine, 6 tests d'intégration (les deux modes), étape Playwright.

S6, identité complète et scénario P2 (01/11/2026) :
- Migration `0010_s6_demographics` (colonnes démographiques, `patient_field_history` en ajout seul, fixture d'isolation), champs ajoutés aux commandes `patient.register` et `patient.update`, historique écrit par le serveur, routes `/api/v1/patients/history` et `/api/v1/patients/conflicts*`, carte d'identité modifiable hors connexion, historique à la demande, revue des conflits dans `/app/patients/doublons`.
- **Contradiction signalée** : pour la variante de P2 (même date de naissance modifiée par deux postes), `docs/02-offline-sync.md` (tableau des stratégies) garde la valeur serveur et ouvre un conflit, `docs/08-parcours-acceptation.md` demande la valeur au HLC le plus récent. Le moteur suit `docs/02` (validé en J0). Tranché par le porteur le 01/11/2026 en faveur de `docs/02` ; `docs/08` mis à jour.
- Les allergies et antécédents de P2 sont reportés au dossier médical (S8). Une seule personne à contacter pour l'instant.
- Tests : 2 tests d'intégration (P2), étape Playwright (fiche complétée hors connexion).

S6, fusion (31/10/2026) :
- `packages/domain/src/pat/merge.ts`, migration `0009_s6_merge` (`patient_merge`, RLS, fixture d'isolation), service `modules/pat/merge.ts`, routes `/api/v1/patients/merge`, `/unmerge`, `/merges`, `updateServerPatient` dans le module sync, panneau de fusion et fusions récentes dans `/app/patients/doublons`, redirection et constantes rattachées sur la fiche.
- Écart : quatre yeux non appliqué (module d'approbations à venir).
- Tests : 4 tests de domaine, 3 tests d'intégration, étape Playwright (fusion, réception sur le poste, annulation).
- Corrigé en cours de route : l'écran Organisation fermait l'éditeur de site ou de service après le rechargement de la liste ; un clic sur « Modifier » pendant ce rechargement ouvrait un éditeur aussitôt refermé (le test Playwright tombait dans cette fenêtre sur un poste chargé). L'éditeur se ferme maintenant dès que le serveur a accepté la modification, avant le rechargement.
- Banc Playwright : quand la requête relayée pour simuler une réponse perdue est elle-même coupée (`ECONNRESET`), le banc la traite comme un envoi échoué de plus au lieu d'arrêter le test ; les vérifications finales (zéro perte, zéro doublon, convergence) sont inchangées.

S6, doublons (31/10/2026) :
- `packages/domain/src/pat/duplicate-score.ts` (score et normalisation des numéros), seuils `patient.duplicate_alert_score` (50) et `patient.duplicate_candidate_score` (60) dans la configuration versionnée, seuil d'alerte remis aux postes avec leurs jetons.
- Poste : patients semblables affichés avant la création (`features/patients/similar.ts`), confirmation explicite.
- Serveur : migration `0008_s6_duplicates` (`duplicate_candidate`, RLS, fixture d'isolation), tâche `pat.detect_duplicates` mise en file par chaque enregistrement synchronisé et traitée par le worker (nouvelle dépendance `@medhub/domain`), module `server/modules/pat`, routes `/api/v1/patients/duplicates*`, écran `/app/patients/doublons`.
- Tests : 5 tests de domaine, 1 test du worker (P3), 2 tests d'intégration, vérification d'une tâche par enregistrement dans le banc PostgreSQL, étape Playwright de l'alerte.
- Constat : avec toutes les suites en parallèle sur le poste (moins de 600 Mo de mémoire libre), deux tests dépassaient leur délai sans erreur de fond : la base locale chiffrée (PBKDF2 à 600 000 itérations, 5 s) et le banc de 500 opérations de `packages/sync` (60 s ; 88 s pour tout le paquet lancé seul). Délais portés à 60 s et 180 s, avec la raison en commentaire ; tous deux réussissent seuls et dans la passe complète.

S5, diagnostic et base de formation (31/10/2026) :
- Diagnostic : accès hors connexion, licence, copie des référentiels, horloge ; « Recharger les catalogues » ; « Exporter le journal » (fichier scellé pour le support avec X25519, HKDF et AES-GCM, sans nom ni donnée médicale, utilisable hors connexion). Clé publique du support remise aux postes avec les jetons (`MEDHUB_SUPPORT_PUBLIC_KEY`, facultative), scripts `pnpm keys:support` et `pnpm support:decrypt`.
- Base de formation : migration `0007_s5_training` (`tenant.training_source_id`, unicité du code hors bases de formation archivées), service `modules/core/training.ts`, routes `/api/v1/training`, écran `/app/parametres/formation`. Copie de la configuration publiée, des sites et services, des rôles, des listes et des comptes actifs (secrets 2FA rescellés), 40 patients fictifs créés par le serveur et distribués aux postes par la synchronisation. Réinitialisation par archivage et recréation sous le même code.
- Point d'accroche : quand le module NOTIF arrivera, il devra forcer l'adaptateur `console` pour toute structure `is_training` (`docs/06` section 5). Aucun envoi n'existe aujourd'hui.
- Tests : 5 tests d'intégration (formation), 2 tests de journal (enveloppe et script du support), 2 tests de domaine, scénario Playwright complété.

S5, traduction anglaise (même jour) :
- Les 860 messages existaient déjà dans les deux langues ; vérification systématique par un test (parité des clés, messages ICU, variables identiques, aucun reste de français en anglais, clés appelées par le code présentes). Derniers textes du code passés dans les messages (suffixe des rôles dupliqués, noms des langues).
- Langue du compte (`user_account.locale`) dans le profil, cookie de langue posé à la connexion, route `/api/v1/account/locale` et sélecteur relié au compte dans l'application.
- Scénario Playwright : passage en anglais depuis « Mon compte », vérifié en base, puis retour au français.
- Constat : deux passes complètes ont échoué alors que le poste manquait de mémoire (moins de 800 Mo libres sur 8 Go) : délai de 5 s dépassé par un test de `packages/local-db`, puis connexions refusées par le serveur de test (« serveur injoignable », `ECONNRESET`). Les mêmes tests ont réussi seuls, puis la suite complète (8 scénarios) et `pnpm test` (126 tests) ont réussi sur le poste libéré. Lancer Playwright sur une machine qui a au moins 2 Go libres.

S5, référentiels (même jour) :
- Migration `0006_s5_reference` : tables plateforme `currency`, `unit`, `admin_area`, tables de structure `choice_list` et `choice_item` (RLS forcée, fixtures d'isolation). Données de la plateforme dans `packages/shared/src/reference.ts` avec leur source, chargées à chaque migration ; lecteur CSV partagé.
- Service `modules/core/reference.ts`, routes `/api/v1/reference*` et `/api/v1/choice-lists*`, écran `/app/parametres/referentiels`, copie locale des référentiels sur les postes (`client/catalogs.ts`), province des adresses choisie dans la liste.
- Constat : le scénario Playwright « enregistrement hors connexion depuis l'écran » a échoué une fois sur trois passes (patient absent de la base locale après le clic, rien de rejeté), puis réussi seul et dans la passe complète suivante. Le test attend maintenant la navigation vers la fiche, que le formulaire ne lance qu'une fois l'écriture enregistrée dans l'outbox, au lieu d'attendre 2 s (une première version lisait le compteur de l'outbox après le clic : elle échouait quand la navigation hors connexion avait déjà quitté la page).
- `pnpm db:import-areas` pour les territoires, villes et communes à partir d'un fichier officiel (simulation par défaut).
- Tests : 5 tests d'intégration, 6 tests de domaine et de lecture CSV, isolation (91 tests), scénario Playwright complété.

S5, éditeur de rôles (même jour) :
- `packages/shared` : périmètres par ressource (`RESOURCE_SCOPES`) et droits d'administration (`PRIVILEGED_PERMISSIONS`) ; `permission.scopes_allowed` rempli par les données de référence. Règles `packages/domain/src/core/roles.ts`, service `modules/core/roles.ts`, routes `/api/v1/roles/*`, écran `/app/parametres/roles`.
- Correction : les événements de sécurité ajoutés avec les utilisateurs (mot de passe changé ou réinitialisé, 2FA réinitialisée, compte désactivé ou réactivé) s'affichaient comme « Autre événement » dans le journal de sécurité ; ils ont maintenant leur libellé.
- Tests : 6 tests d'intégration, 4 tests de domaine, scénario Playwright complété (duplication et modification d'un rôle).
- Reste de la capacité « Rôles » de `docs/modules/core.md` : conditions ABAC (`access.ts`), aperçu « voir comme », proposition des mises à jour des rôles modèles.

S5, utilisateurs (même jour) :
- Migration `0005_s5_users` (`user_account.default_department_id`), règles `packages/domain/src/core/password-policy.ts` et `users.ts`, réglage `security.password_min_length` (10), service `modules/core/users.ts` et routes `/api/v1/users/*`, étape « Choisissez votre mot de passe » à la connexion (`/api/v1/auth/password`), changement depuis « Mon compte » (`/api/v1/account/password`), écran `/app/parametres/utilisateurs`.
- Règles de `docs/modules/core.md` appliquées : désactivation sans suppression, sessions fermées et postes informés (`AUTH_USER_DISABLED`, jeton hors connexion retiré, outbox conservée), au moins un rôle actif pour se connecter, dernier administrateur protégé, step-up pour toute modification.
- Tests : 8 tests d'intégration, 5 tests de domaine, scénario Playwright `mfa.spec.ts` complété (création à l'écran, première connexion, désactivation).
- Reste de la capacité « Utilisateurs » de `docs/modules/core.md` : signature scannée (stockage de fichiers), affectation des rôles par site ou service (colonnes prêtes dans `user_role`), réinitialisation par lien courriel ou SMS (NOTIF).

S5, configuration versionnée (même jour) :
- Migration `0004_s5_configuration` (`config_entry`, index partiels, trigger d'immuabilité des versions publiées), registre `packages/domain/src/core/config-schemas.ts`, service et routes `/api/v1/config/*`, écran `/app/parametres/synchronisation`. Valeurs publiées appliquées : durée du jeton hors connexion, verrouillage automatique et essais de PIN sur les postes (remis avec les jetons), fenêtre de step-up.
- Constat : le test du worker échouait quand toutes les suites tournent ensemble, car ses deux ticks réels dépassaient le délai par défaut de 5 s de Vitest ; délai du test porté à 60 s.
- Tests : 5 tests d'intégration, 1 test de domaine, isolation (83 tests). `pnpm test` (88 tests) vert.

S5, appareils et jetons (même jour) :
- Migration `0003_s5_devices` (colonnes de retrait), jetons JWS Ed25519 (`packages/sync/src/tokens.ts`), règles de licence (`packages/domain/src/core/license.ts`), émission serveur (`platform/tokens.ts`), écran `/app/parametres/appareils`, effacement à distance côté client, bandeaux de licence et d'expiration, écran de verrouillage « accès hors connexion expiré ».
- CI : une paire de clés de signature jetable est générée à chaque exécution (`pnpm keys:generate`), aucune clé n'est stockée dans le dépôt.
- Tests : 3 tests de jetons, 3 tests de licence, 4 tests d'intégration du cycle de vie d'un appareil, scénario Playwright d'effacement à distance. `pnpm test` (92 tests), `pnpm db:test-isolation` (79), `pnpm test:props`, typecheck, lint verts.

Seconde partie de S4 (même jour) :
- Migration `0002_s4_organization` : table `department` (RLS forcée automatiquement, fabrique d'isolation ajoutée), colonnes `session.mfa_verified_at` et `session.rotated_from`.
- Règles partagées `packages/domain/src/core/organization.ts` et `sign-in-risk.ts`.
- Service et routes d'organisation (`/api/v1/organization`, `/sites`, `/departments`), journal de sécurité de la structure (`/api/v1/security/events`), step-up (`/api/v1/auth/step-up`).
- Écrans `/app/parametres`, `/app/parametres/organisation`, `/app/parametres/securite` ; boîte « Confirmez votre identité » réutilisable (`useStepUp`) ; composants `NativeSelect` et `Textarea`.
- Services fictifs ajoutés à la structure de démonstration par `pnpm db:seed`.

Constat : sur ce poste, le build de production prend maintenant de 3 à 6 minutes et les suites lourdes lancées en parallèle (Playwright et `pnpm test`) se ralentissent mutuellement jusqu'à l'échec ; délai de démarrage du serveur Playwright porté à 10 minutes. Lancer ces suites l'une après l'autre.

Tests passés (seconde partie) : `pnpm typecheck`, `pnpm lint`, `pnpm test` (81 tests), `pnpm db:test-isolation` (79 tests), `pnpm test:props`, Playwright `mfa.spec.ts` (2FA, organisation, step-up).

Tests passés (première partie) : `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm db:test-isolation` (75 tests), tests de `apps/web` (18 tests dont la 2FA de bout en bout sur PostgreSQL), Playwright `public.spec.ts` et `mfa.spec.ts` (configuration imposée de la 2FA à l'écran, code faux refusé, bon code accepté, activation du poste, « Mon compte » en thème sombre, CSP à nonce neuf).


### 29/10/2026 (suite)

Travail réalisé :
- Banc Playwright à deux navigateurs réels (poste Accueil et poste Infirmier), connexion et activation par les écrans, coupures réseau, réponses perdues, vérification directe de la base serveur sous RLS.
- Point d'accroche de test `window.__medhubTest`, compilé uniquement quand `NEXT_PUBLIC_MEDHUB_E2E=1` ; le banc tourne sur un build de production séparé (`.next-e2e`) car le serveur de développement recompile sous charge et rendait le banc instable.
- Job `e2e` ajouté à la CI.

Constats :
- Le verrouillage automatique après 5 minutes d'inactivité ferme bien la session pendant un long traitement sans interaction ; le banc simule l'activité clavier et redemande le PIN si besoin (compté dans le résumé).
- **Risque de performance** : un nouveau poste télécharge toute la structure (périmètre complet tant que `sync_scope_rule` n'existe pas). Sur la structure de démonstration, qui grossissait de 200 patients à chaque passe, le banc est passé de 5 à plus de 10 minutes. Le banc utilise désormais une structure neuve par passe (`TST-BNC-NNNN`, créée par `pnpm db:seed --tenant`), et le périmètre de synchronisation de `docs/02-offline-sync.md` section 8 (patients du jour, des 7 jours, du service, favoris) devient prioritaire en S6.
- **Point ouvert** : une fois sur une dizaine de passes, une requête de connexion est restée 20 s sans réponse du serveur de production (abandonnée par le délai du client, aucune erreur dans les journaux serveur). Non reproduit sur 12 connexions consécutives mesurées entre 0,06 et 0,28 s. Le banc réessaie une fois et l'affiche ; à instrumenter en S4 (durée des requêtes, attente du pool et des verrous consultatifs d'audit).
- Le point d'accroche de test attend le verrou Web Locks de la boucle de synchronisation, sinon un cycle demandé pendant un cycle automatique rendait la main sans rien faire.

Tests passés : sur les trois dernières passes complètes de la suite Playwright (4 scénarios, structure neuve à chaque fois), deux sont entièrement vertes ; la troisième a échoué à la connexion initiale (point ouvert ci-dessus), avant toute opération. `pnpm typecheck`, `pnpm lint`, `pnpm test`.

### 29/10/2026

Travail réalisé :
- Monorepo pnpm et Turborepo (`apps/web`, `apps/worker`, `packages/shared`, `domain`, `sync`, `local-db`, `db`, `conventions`, `forms`, `config`), TypeScript strict avec `noUncheckedIndexedAccess`, ESLint avec règles de frontières, Prettier, Vitest, fast-check.
- `packages/shared` : UUID v7, horloge injectable, HLC, argent en entiers avec conversion à taux décimal, codes d'erreur, manifeste des modules, catalogue des permissions et rôles modèles.
- `packages/domain` : commandes `patient.register`, `patient.update`, `vital_sign.record`, `stock_movement.record`, recherche normalisée et clé phonétique, plausibilité des constantes, solde de stock, numérotation hors connexion, âge.
- `packages/sync` : protocole, signature Ed25519, moteur serveur idempotent (stratégies `field_merge` avec conflit sur champ sensible, `append_only` avec correction, `movements` avec alerte de stock négatif, dépendances), pull avec fenêtre de rattrapage, moteur client avec outbox.
- `packages/db` : schéma Drizzle, première migration, RLS forcée sur 16 tables, triggers d'ajout seul, journal d'audit chaîné et vérification, `withTenant`, `withPlatformScope`, file de jobs, seed de la structure fictive `HOP-DEM-0001`.
- `packages/local-db` : IndexedDB chiffrée (PIN, code de récupération, clés dérivées), index de recherche haché, politique d'échecs de PIN qui ne perd jamais une opération non envoyée.
- `apps/web` : page publique, connexion, activation du poste, shell `/app` avec indicateur de synchronisation, tableau de bord, patients, fiche patient avec constantes, diagnostic ; API `/api/health`, `/api/v1/auth/*`, `/api/v1/devices/register`, `/api/v1/sync/*` ; service worker.
- `apps/worker` : tick cron avec verrou consultatif, reprises, lettres mortes, planification, vérification quotidienne des chaînes d'audit.
- Infrastructure : scripts cPanel (déploiement, migration avec sauvegarde, retour arrière, sauvegarde chiffrée, cron, `.htaccess`), Docker de développement, CI GitHub Actions, `pnpm release`.

Tests passés : `pnpm typecheck`, `pnpm lint`, `pnpm test` (41 tests), `pnpm db:test-isolation` (71 tests), `pnpm test:props`, `pnpm build`. Parcours vérifié dans le navigateur : connexion `accueil`, activation, enregistrement d'un patient, synchronisation, refus correct de l'enregistrement de constantes pour le rôle Accueil.

Prochaines étapes :
1. Liste de contrôle cPanel sur l'hébergement retenu et premier déploiement « bonjour ».
2. S4 : 2FA TOTP, limitation de débit en base, règles d'IP, `requirePermission` généralisé par route, en-têtes CSP avec nonces.
3. S5 : jeton hors connexion et jeton de licence (JWS Ed25519), révocation d'appareil, configuration versionnée.
