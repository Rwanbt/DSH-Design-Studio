# Budgets de performance — 18 novembre 2026

**Portée réelle : niveau moteur.** Ces mesures couvrent le pipeline pur traversé
par chaque ouverture, sélection et sauvegarde : scan de structure, projection
des nœuds éditables, géométrie, modèles de chemins, patch d'attribut, patch
d'ordre et écriture réelle du store. **Elles ne mesurent ni pixels, ni layout, ni
images par seconde** : ces budgets-là appartiennent au gate navigateur.

Rejouable : `npm run benchmark` (Node seul, aucune dépendance, aucun réseau).
Rapport machine conservé : [2026-11-18-engine.json](benchmarks/2026-11-18-engine.json).

## Environnement

Linux x64, Node `v24.19.0`. Médiane de 7 exécutions jusqu'à 1 500 éléments, 3
au-delà, plus une écriture réelle sur fichier temporaire pour la colonne « save ».

## Mesures

| Éléments | Octets | Scan | Nœuds éditables | Géométrie | Patch attribut | Patch ordre | Écriture store |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 7 Kio | 0,57 ms | 0,79 ms | 1,51 ms | 0,78 ms | 0,18 ms | 2,07 ms |
| 1 500 | 104 Kio | 3,98 ms | 5,84 ms | 12,45 ms | 8,19 ms | 2,04 ms | 2,22 ms |
| 5 000 | 353 Kio | 7,91 ms | 23,07 ms | 41,21 ms | 28,39 ms | 6,92 ms | 4,06 ms |
| 10 000 | 709 Kio | 15,83 ms | 39,20 ms | 89,90 ms | 64,46 ms | 15,33 ms | 6,92 ms |

CSS (règles simples) : 100 → 0,29 ms · 1 500 → 1,37 ms · 5 000 → 2,85 ms.

Un patch d'attribut coûte environ la moitié d'une projection de nœuds, un patch
d'ordre un quart : réordonner reste l'opération la moins chère du lot.

## Ce que ces chiffres disent

- Le coût dominant est la **géométrie** (matrices et poignées), pas l'écriture :
  à 10 000 éléments elle prend ~90 ms alors que l'écriture du fichier reste sous
  7 ms. Un document de 10 000 éléments reste ouvrable, mais la sélection et le
  survol sont les endroits à surveiller.
- La croissance est cohérente avec du linéaire entre 100 et 10 000 : la
  régression quadratique corrigée plus tôt (un scan par calque) ne revient pas.
- Les fichiers dépassant **8 Mio** sont refusés par le store et le scanner : ce
  n'est pas un budget de performance mais une limite dure, testée séparément.
  Au-delà de **512 Kio**, l'inspection visuelle CSS/HTML est désactivée avec un
  avertissement explicite ; l'édition de source reste possible.

## Ce que ces chiffres ne disent pas

- Aucune image par seconde, aucune latence perçue, aucune consommation mémoire.
  Le gate navigateur mesure l'ouverture et la sauvegarde sur 1 500 nœuds avec un
  budget asserté ; il ne mesure ni 5 000 ni 10 000 éléments dans un navigateur.
- Aucune mesure sur appareil mobile, sur Desktop, ni sur macOS/Windows pour ces
  tailles (seule la CI Windows couvre la suite fonctionnelle).
- Aucun profil mémoire, aucune fuite mesurée sur une session longue.

Ces trois absences sont des `NOT_RUN`, pas des budgets atteints.
