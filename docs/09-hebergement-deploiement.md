# 09. Hébergement cPanel et déploiement

## 1. Ce que cPanel permet et impose

| Sujet | Situation | Décision |
| --- | --- | --- |
| Node.js | « Setup Node.js App » (Passenger). Mémoire, processus et durée de requête limités. | Next.js `output: 'standalone'`, fichier de démarrage `server.js`. Build hors serveur. |
| PostgreSQL | Via « PostgreSQL Databases » chez certains hébergeurs. Version, extensions, droits variables. | Vérifier version 14+, `pg_trgm`, `unaccent`, `FORCE RLS`. Repli applicatif pour la recherche floue. |
| WebSocket, connexions longues | Peu fiables derrière Passenger. | Interdits. Synchronisation par requêtes courtes et interrogation périodique. |
| Processus permanents | Non autorisés en général. | Worker lancé par cron. |
| Cron | Disponible, granularité 1 minute. | `worker tick` chaque minute. |
| Sauvegardes | Outils de l'hébergeur, peu maîtrisés. | `pg_dump` chiffré planifié + copie hors serveur. |
| Sécurité | Mutualisation, isolation par compte. | Chiffrement applicatif, clés hors base, TLS, en-têtes durcis. |
| Ressources | Plafonds CPU, mémoire, processus, connexions. | Pool 5 à 10, requêtes efficaces, travaux lourds en jobs découpés. |
| DICOM | Impossible. | Phase 2 : serveur d'imagerie sur VPS séparé. |
| Service worker | HTTPS et en-têtes corrects requis. | Contrôle dès le premier jour (certificat, en-têtes de cache, portée `/app`). |

Recommandation : offre cPanel **sur VPS ou serveur dédié** (accès root, ressources garanties) plutôt qu'un hébergement mutualisé classique, pour des données de santé.

## 2. Liste de contrôle du premier jour (S1)

Résultats consignés dans `infra/cpanel/checklist-resultats.md`.
- Node.js : versions disponibles (22 ou 20 souhaitée), choix de version, accès SSH, `npm`/`pnpm` utilisables.
- Limites : mémoire par processus, nombre de processus, durée maximale de requête, connexions sortantes (SMS, paiement, SMTP), réception de webhooks.
- PostgreSQL : version, `pg_trgm`, `unaccent`, possibilité de `FORCE ROW LEVEL SECURITY`, connexions max, accès à `pg_dump`, droit de créer des extensions.
- Cron : fréquence minimale, durée maximale, lancement d'un script Node.
- Stockage : quota disque, quota d'inodes, répertoire hors `public_html`.
- HTTPS : certificat automatique (AutoSSL ou Let's Encrypt), HTTP/2, compression Brotli ou gzip, en-têtes personnalisables (`.htaccess`).
- Performance : test de charge k6 simulant 20 utilisateurs (`infra/k6/pilot.js`), temps de réponse et mémoire.
- Sauvegarde et restauration : test complet sur un autre environnement.
- Support de l'hébergeur : délai de réponse, maintenance, localisation du centre de données.

Si un point bloque (pas de PostgreSQL, Node trop ancien, pas de cron) : arrêt et rapport au porteur du projet avec options (autre hébergeur cPanel, VPS).

## 3. Arborescence sur le serveur

```
/home/<compte>/medhub/
├── releases/
│   ├── 2026-11-02_1.0.0/      contenu de l'archive (standalone, static, public, worker, migrations)
│   └── ...
├── current -> releases/2026-11-02_1.0.0
├── shared/
│   ├── storage/               fichiers chiffrés (MEDHUB_STORAGE_DIR)
│   ├── logs/
│   └── backups/               sauvegardes locales temporaires avant copie externe
└── scripts/                   deploy.sh, migrate.sh, backup.sh, rollback.sh
```

L'application Node cPanel pointe sur `current/web` avec le fichier de démarrage `server.js`. Le domaine public sert l'application via Passenger.

## 4. Construction et déploiement

1. CI (GitHub Actions) ou local : `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm release`.
2. `pnpm release` produit `medhub-<version>.tar.gz` contenant : `web/` (sortie standalone avec `.next/static` et `public/` copiés au bon endroit), `worker/index.js`, `migrations/`, `scripts/`, `VERSION`.
3. Envoi par `rsync` ou `scp` via SSH dans `releases/<date>_<version>`.
4. `scripts/migrate.sh` : sauvegarde `pg_dump` préalable, puis application des migrations (script Node utilisant le migrateur Drizzle), arrêt en cas d'erreur.
5. Bascule du lien `current`, redémarrage de l'application (fichier `tmp/restart.txt` de Passenger ou interface cPanel).
6. Vérification `GET /api/health` ; en cas d'échec : `scripts/rollback.sh` (lien vers la version précédente, redémarrage). Les migrations sont écrites pour être compatibles avec la version précédente du code pendant une version (ajouts de colonnes nullables, pas de suppression immédiate).
7. Versionnement sémantique, `CHANGELOG.md`, drapeaux de fonctionnalités pour activer progressivement par structure.

## 5. Variables d'environnement

Saisies dans l'interface cPanel, jamais dans le dépôt. Fichier `.env.example` documenté dans le dépôt.

| Variable | Rôle |
| --- | --- |
| `NODE_ENV` | `production` |
| `MEDHUB_BASE_URL` | Adresse publique (ex. `https://app.exemple.cd`) |
| `DATABASE_URL` | Connexion PostgreSQL |
| `DATABASE_POOL_MAX` | 5 à 10 |
| `MEDHUB_SESSION_SECRET` | Secret de dérivation des cookies |
| `MEDHUB_FIELD_MASTER_KEY` | Clé maîtresse du chiffrement des champs sensibles (base64, 32 octets) |
| `MEDHUB_FILE_MASTER_KEY` | Clé maîtresse du chiffrement des fichiers |
| `MEDHUB_SIGNING_PRIVATE_KEY`, `MEDHUB_SIGNING_KID` | Clé Ed25519 de signature des licences et jetons hors connexion |
| `MEDHUB_STORAGE_DIR` | Répertoire des fichiers (hors `public_html`) |
| `MEDHUB_BACKUP_ENCRYPTION_KEY` | Clé de chiffrement des sauvegardes (ou clé publique age) |
| `MEDHUB_BACKUP_REMOTE_*` | Destination externe (S3 compatible ou SFTP) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Courriel |
| `MEDHUB_SMS_PROVIDER` et paramètres | Adaptateur SMS |
| `MEDHUB_PAYMENT_PROVIDER` et paramètres | Adaptateur de paiement |
| `MEDHUB_TELEMETRY_ADAPTER` | `internal` ou `batela` |
| `MEDHUB_LOG_DIR`, `LOG_LEVEL` | Journaux |

## 6. Tâches cron

```
* * * * *   /usr/bin/node /home/<compte>/medhub/current/worker/index.js tick >> /home/<compte>/medhub/shared/logs/worker.log 2>&1
15 2 * * *  /home/<compte>/medhub/current/scripts/backup.sh daily
30 3 * * 0  /home/<compte>/medhub/current/scripts/backup.sh weekly
```

Le chemin exact de `node` est celui de l'environnement Node choisi dans cPanel (à relever en S1).

## 7. Sauvegardes et restauration

- Quotidienne complète (`pg_dump -Fc`), chiffrée (age ou OpenSSL AES-256), copiée hors du serveur (stockage compatible S3 ou second hébergeur), plus les fichiers chiffrés (rsync incrémental).
- Sauvegardes intermédiaires toutes les 6 heures si l'hébergement le permet.
- Rétention : 7 quotidiennes, 4 hebdomadaires, 12 mensuelles.
- Contrôle d'intégrité (somme SHA-256) à chaque sauvegarde, enregistré dans `backup_artifact`.
- **Test de restauration automatisé mensuel** sur une base temporaire, avec rapport dans le portail super-admin.
- Restauration globale ou **par structure** (export logique filtré par `tenant_id`, réimport dans une base de travail), double validation.
- Objectifs : perte maximale 24 heures au départ, 1 heure à terme ; reprise en 4 heures.

## 8. Environnements

| Environnement | Usage |
| --- | --- |
| Développement | Poste du développeur, PostgreSQL en Docker (`infra/docker/docker-compose.yml`, version alignée sur celle de l'hébergeur) |
| Recette | Sous-domaine ou second compte cPanel, données fictives |
| Production | cPanel du pilote |
| Formation | Structures `is_training` dans la production (pas d'environnement séparé) |

## 9. Migration vers un VPS

Déclenchée dès qu'un seuil est atteint :
- plus de 5 structures actives ou plus de 40 utilisateurs simultanés, ou limitations de ressources répétées ;
- base de plus de 5 Go ou exigence de performance non tenue ;
- besoin de temps réel, d'imagerie DICOM, de sous-domaines par structure ou d'isolation renforcée exigée par un client ;
- premier client hospitalier public ou réseau multi-sites en production.

Cible : Docker Compose (application Next.js, worker permanent, PostgreSQL géré ou local, reverse proxy Caddy ou Nginx avec certificats génériques pour les sous-domaines), stockage objet S3, sauvegardes identiques. Procédure dans `infra/docker/MIGRATION.md` (à rédiger avant la phase 2). Le code ne change pas, seule la configuration change.
