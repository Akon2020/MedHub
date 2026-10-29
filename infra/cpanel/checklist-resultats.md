# Liste de contrôle cPanel du premier jour : résultats

À remplir par le porteur du projet sur l'hébergement retenu (`docs/09-hebergement-deploiement.md` section 2). Si un point bloque, s'arrêter et choisir une autre offre (cPanel sur VPS recommandé).

| Point | Attendu | Résultat constaté |
| --- | --- | --- |
| Versions Node.js disponibles | 22 (20 en repli) | |
| Accès SSH | Oui | |
| `npm` ou `pnpm` utilisables | Oui | |
| Chemin exact de `node` pour le cron | Relevé | |
| Mémoire par processus | 1 Go ou plus | |
| Nombre de processus | Noté | |
| Durée maximale d'une requête | 30 s ou plus | |
| Connexions sortantes (SMTP, SMS, paiement) | Autorisées | |
| PostgreSQL : version | 14 ou plus | |
| Extension `pg_trgm` | Disponible | |
| Extension `unaccent` | Disponible | |
| `FORCE ROW LEVEL SECURITY` possible | Oui | |
| Connexions PostgreSQL maximales | 20 ou plus | |
| `pg_dump` accessible | Oui | |
| Cron : fréquence minimale | 1 minute | |
| Cron : lancement d'un script Node | Oui | |
| Quota disque et inodes | Notés | |
| Répertoire hors `public_html` | Oui | |
| HTTPS automatique (AutoSSL ou Let's Encrypt) | Oui | |
| En-têtes personnalisables (`.htaccess`) | Oui | |
| Compression Brotli ou gzip | Oui | |
| Test de charge k6 (20 utilisateurs) | Temps de réponse noté | |
| Sauvegarde et restauration testées | Oui | |
| Support de l'hébergeur et centre de données | Notés | |
