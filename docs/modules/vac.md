# Module VAC : vaccination

- **Phase** : 2
- **Dépend de** : DPI, PHAR

## Capacités

1. **Calendrier vaccinal** configurable (Programme élargi de vaccination de la RDC à importer, `TODO(medhub-decision)` sur la source officielle) : antigène, dose, âge recommandé, intervalle minimal, âge limite de rattrapage.
2. **Carnet de vaccination** du patient : doses reçues (date, lot, site d'injection, vaccinateur, structure), doses à venir et en retard, calcul automatique à partir de la date de naissance.
3. **Saisie rapide** en séance de vaccination (liste des enfants attendus, cochage), y compris en stratégie avancée hors connexion.
4. **Stocks de vaccins** (PHAR) : lots, flacons ouverts, politique des flacons entamés, perte, température de la chaîne du froid (relevés manuels bi-quotidiens, alerte hors plage).
5. **Rappels** SMS aux parents (sans contenu médical), liste des perdus de vue vaccinaux.
6. **Manifestations post-vaccinales indésirables** (MAPI) : déclaration, notification EPID.
7. **Impression** du carnet ou d'une attestation.

## Commandes

`vaccination.record`, `vaccination.correct`, `cold_chain.record_reading`, `aefi.report`.

## Indicateurs

Couverture par antigène et cohorte, taux d'abandon (Penta1 à Penta3), pertes de vaccin, export vers EPID et DHIS-2.
