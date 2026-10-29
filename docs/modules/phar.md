# Module PHAR : pharmacie et stock

- **Phase** : MVP (S12)
- **Dépend de** : CORE (et DPI pour la dispensation sur ordonnance, FACT pour la vente)

## Capacités

1. **Catalogue produits** : DCI, code ATC, forme, dosage, unité de dispensation, conditionnement, fournisseurs, prix d'achat, prix de vente par devise ou règle de marge, catégorie, stupéfiant oui/non, lien `drug_id`.
2. **Lots et péremptions** : numéro de lot, date de péremption, règle **premier périmé premier sorti** (proposition automatique du lot), alertes à 90, 60 et 30 jours (job quotidien).
3. **Multi-magasins** : magasin central, pharmacies de service, armoires de salle, laboratoire ; transferts avec envoi, réception et accusé (écart signalé si quantité reçue différente).
4. **Dispensation** :
   - sur ordonnance électronique interne (file de la pharmacie) : sélection des lignes, quantités, lots, substitution générique si autorisée ;
   - vente libre au comptoir (patient connu ou anonyme) ;
   - dans le cadre d'un forfait de convention (vérification de couverture et du plafond via CONV).
   La dispensation crée les mouvements de stock et les lignes de facture (pas de double saisie).
5. **Achats** : commandes fournisseurs, réceptions avec contrôle (quantité, lot, péremption, prix), retours fournisseurs, avoirs.
6. **Destructions** tracées avec motif (périmé, cassé, rappel) et validation.
7. **Inventaires** tournants et complets : feuille de comptage (impression ou tablette), saisie, écarts valorisés, justification, validation quatre yeux au-delà du seuil, mouvements de correction.
8. **Seuils** minimum et maximum, consommation moyenne mensuelle (CMM, job), suggestion de réapprovisionnement (`max - stock - commandes en cours`).
9. **Stupéfiants** (produits sous contrôle) : registre dédié (`controlled_substance_log`), double signature à chaque mouvement, solde après mouvement.
10. **Tarification** : marge par catégorie, arrondis, prix différenciés par type de patient ou convention.

## Règles de gestion

- **Stock géré uniquement par mouvements.** Le solde est la somme des mouvements ; `stock_balance` n'est qu'un cache recalculable.
- Stock négatif possible suite à une synchronisation tardive : l'opération est acceptée (le produit a été remis), alerte `PHAR_NEGATIVE_STOCK` et proposition de régularisation (réception oubliée ou inventaire).
- Hors connexion, une dispensation supérieure au stock local connu affiche un avertissement mais n'est pas bloquée (configurable : `block_dispense_without_stock`).
- Un produit périmé n'est jamais proposé ; sa dispensation exige une confirmation explicite et est tracée (configurable : interdiction totale).
- Ajustement au-delà du seuil : quatre yeux.

## Configurable

Magasins, catégories, unités, seuils, délais d'alerte de péremption, marges, arrondis, blocage sans stock, modèle d'étiquette, rôles autorisés par magasin.

## Commandes de synchronisation

`dispensation.create`, `dispensation.void` (mouvement inverse), `otc_sale.create`, `stock_movement.record` (`movements`), `stock_transfer.send`, `stock_transfer.receive`, `stock_count.start`, `stock_count.record_line`, `stock_count.validate` (approbation selon seuil), `goods_receipt.record`, `destruction.record`, `controlled_substance.cosign`. Commandes fournisseurs et catalogue : en ligne.

## API

`/api/v1/products`, `/product-lots`, `/warehouses`, `/stock` (soldes, mouvements), `/dispensations`, `/stock-transfers`, `/stock-counts`, `/suppliers`, `/purchase-orders`, `/goods-receipts`, `/controlled-substances/register`, `/reports/stock/*`.

## Écrans

File des ordonnances, dispensation, comptoir (vente libre), état du stock par magasin, fiche produit (mouvements, lots), réceptions, transferts, inventaires, alertes (seuils, péremptions, négatifs), registre des stupéfiants.

## Indicateurs

Ruptures, jours de couverture, valeur du stock, produits proches de la péremption, écarts d'inventaire, CMM.

## Critères d'acceptation

- Scénario P8.
- Jeux d'essai stock de `docs/10-tests-qualite.md`.
- Solde = somme des mouvements pour tous les produits après le banc de synchronisation.

## Points d'accroche

Consommables du bloc et armoires de salle (HOSP), stocks de vaccins et chaîne du froid (VAC), commandes groupées de réseau (phase 2), lecture de codes-barres (via caméra, phase 2).
