# MedHub

Système d'information de santé web, multi-structures et local-first : chaque poste continue de travailler sans connexion et se synchronise quand le réseau revient. Marché initial : République démocratique du Congo, en français et en anglais, USD et CDF.

- Installer, lancer, tester, déployer : [guide.md](guide.md)
- Règles du projet : `CLAUDE.md` (copie versionnée : [AGENTS.md](AGENTS.md))
- Spécifications : [docs/](docs)
- Avancement : [docs/avancement.md](docs/avancement.md)

Démarrage rapide :

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```
