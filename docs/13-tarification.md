# 13. Tarification et modèle financier

**Toutes les valeurs de ce document sont des hypothèses à valider sur le terrain.** Elles sont chargées comme données initiales (`packages/db/seeds/platform/plans.json`) et entièrement modifiables dans le portail super-admin. Aucune n'est codée en dur.

## 1. Positionnement

Open Clinic GA est gratuit en licence, mais son déploiement coûte de 3 500 USD (centre de santé) à 200 000 USD (hôpital de référence) selon la présentation GIZ, matériel, réseau, énergie et formation compris. L'argument de MedHub : **aucun investissement initial, une charge mensuelle prévisible, un démarrage en quelques jours**.

## 2. Plans

| Code | Palier | Profil | Prix de base mensuel (USD) | Inclus |
| --- | --- | --- | --- | --- |
| `essential` | Essentiel | Pharmacie, dispensaire, cabinet | 20 (fourchette 15 à 25) | 1 à 3 utilisateurs, 1 site, noyau et module principal du type de structure |
| `clinic` | Clinique | Petite clinique | 80 (fourchette 60 à 100) | Jusqu'à 10 utilisateurs, environ 10 lits, 1 site |
| `clinic_plus` | Clinique+ | Clinique moyenne, petit hôpital | 180 (fourchette 150 à 250) | Jusqu'à 30 utilisateurs, environ 30 lits, 2 sites |
| `hospital` | Hôpital | Hôpital ou réseau multi-sites | Sur devis, à partir de 400 | Selon contrat, support renforcé |

## 3. Modules additionnels et options

- Modules facturables : forfait de 5 à 40 USD par mois chacun (valeurs initiales : laboratoire 25, pharmacie avancée 25, conventions et assurances 30, hospitalisation 30, maternité 20, imagerie 40, portail patient 20, multi-sites 25).
- Dépassements : utilisateur supplémentaire, site supplémentaire, stockage (par tranche de 5 Go), SMS (au coût plus marge configurable).
- Frais de mise en service uniques : 50 à 500 USD selon la taille (configuration, import, formation).
- Remise annuelle : 2 mois offerts (paiement annuel = 10 mois).
- Offre pilote : trois premiers clients avec 40 à 50 % de remise contre retours et témoignage (coupon `PIONNIER`).
- Facturation en USD avec équivalent CDF au taux du jour ; mobile money accepté.
- Forfait de formation séparé et contrat de support renforcé (lignes de catalogue `service`).

## 4. Exemple de la structure pilote

| Ligne | USD par mois |
| --- | --- |
| Plan Clinique+ (hypothèse médiane) | 180 |
| Module laboratoire | 25 |
| Module pharmacie avancée | 25 |
| Module conventions et assurances | 30 |
| Total au tarif public | 260 |
| Remise pilote de 45 % | -117 |
| Total pilote | 143 |

## 5. Essais gratuits

30 jours par défaut, limités par volume (100 dossiers patients) plutôt que par fonctionnalité, une seule période d'essai par entité (téléphone, courriel, numéro d'identification, nom légal), conversion en un clic sans perte de données.

## 6. Cycle d'impayé (valeurs par défaut)

| État | Déclencheur | Effet |
| --- | --- | --- |
| Échu | J+0 | Plein accès, bannière d'information, rappels J+3 et J+7 |
| Grâce | J+15 | Plein accès, avertissement, pas de création de module ni d'utilisateur |
| Lecture seule | J+30 | Consultation, impression, export, saisies d'urgence tracées ; pas de nouveaux dossiers ni de facturation courante |
| Suspendu | J+60 | Connexion limitée à l'export et à la régularisation |

Toujours possible : accès d'urgence, export. Aucune suppression automatique. Dérogation datée possible par le super-admin.

## 7. Scénarios financiers (illustration, pour le tableau de bord super-admin)

| Scénario | Structures | Revenu moyen | Revenu mensuel | Revenu annuel |
| --- | --- | --- | --- | --- |
| Prudent | 10 | 80 | 800 | 9 600 |
| Médian | 30 | 120 | 3 600 | 43 200 |
| Ambitieux | 80 | 160 | 12 800 | 153 600 |

Le principal coût réel est le temps de support et d'accompagnement. Le tableau de bord super-admin suit dès le départ : revenu récurrent mensuel, désabonnement, coût d'acquisition (saisi), temps de support par client (issu des tickets), créances par ancienneté.
