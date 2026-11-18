# ADR-028 — Menu contextuel et copier/coller natif

**Statut :** accepté · **Date :** 18 novembre 2026 · **Branche :** `dev`

## Contexte

Deux frictions restaient pour un usage quotidien :

1. **Toutes les actions sur un calque passaient par l'inspecteur.** Dupliquer,
   supprimer, masquer, verrouiller, grouper exigeaient de quitter le regard du
   canevas pour aller cliquer dans la colonne de droite. Un éditeur graphique
   sans menu contextuel se manipule avec une main dans le dos.
2. **Rien ne pouvait être copié.** `Ctrl+D` duplique le calque *sélectionné*,
   mais on ne pouvait pas copier un élément puis coller sa copie ailleurs, ni
   dans un autre document — le cas d'usage le plus courant d'un espace de
   travail de design.

## Décision

### 1. Le menu contextuel est un second point d'entrée, pas une seconde implémentation

Clic droit sur une forme du canevas ou sur une ligne de calque → un menu
`role="menu"` propose : `Dupliquer`, `Copier`, `Coller`, `Supprimer`, `Grouper`,
`Dégrouper`, `Masquer`/`Afficher`, `Verrouiller`/`Déverrouiller`. Chaque entrée
appelle **exactement** le même genre de patch que le bouton correspondant de
l'inspecteur (`svg-layer`, `svg-grouping`, `svg-visibility`, `svg-lock`) : aucun
chemin d'écriture parallèle, aucune sémantique divergente.

L'action cible **la ligne cliquée**, pas la sélection précédente : cliquer à
droite sur un autre calque le sélectionne d'abord. Le menu nomme le calque, est
borné au viewport, se ferme par `Échap`, par le fond cliquable ou par toute
action, et n'écrit jamais à l'ouverture.

### 2. Le presse-papiers contient une tranche de source, pas un objet

`Ctrl+C` mémorise la tranche exacte `source[start..end]` du calque sélectionné
(les nœuds exposent déjà leur `span`). `Ctrl+V` l'envoie au Host comme
`svg-paste`, qui la **revalide** :

- le fragment est re-parsé par le même scanner que tout document, dans un
  wrapper jetable ;
- **seule la tranche de l'unique élément effectivement parsé** est copiée :
  tout ce qui est autour (deuxième racine, balise fermante, déclaration,
  commentaire) est ignoré, donc le contrebande de balisage est structurellement
  impossible ;
- les balises autorisées sont celles que l'éditeur sait manipuler
  (`rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path`, `text`,
  `g`) ; `script`, `foreignObject`, `image` et les attributs `on*` sont refusés
  par le scanner ;
- les éléments portant une **référence non suivie** (`href`, `xlink:href`,
  `src`) sont refusés : l'éditeur ne réécrit pas les références, donc dupliquer
  une `<use>` produirait silencieusement une copie qui pointe ailleurs ;
- chaque `id` est réécrit : conservé s'il est libre dans la cible, sinon
  `<id>-copy`, `<id>-copy-2`, … jusqu'à trouver un id libre ;
- l'insertion se fait **après le dernier enfant de la racine `<svg>`**, jamais
  en dehors.

Le collage vers un autre document fonctionne donc naturellement, et le document
source n'est jamais modifié par un `Ctrl+C`.

### 3. Ce que le presse-papiers n'est pas

Ce n'est pas le presse-papiers système : rien n'est lu ni écrit dans
`navigator.clipboard`, aucune donnée ne sort du renderer avant le collage. Le
presse-papiers est en mémoire et disparaît avec la vue — c'est un choix assumé,
documenté et sans permission supplémentaire.

## Alternatives rejetées

| Alternative | Pourquoi non |
|---|---|
| `navigator.clipboard.writeText` / lecture système | Demande une permission supplémentaire, expose les documents au presse-papiers de l'OS et casse le modèle « la source native est canonique ». |
| Coller en réutilisant `duplicate` sur l'id copié | Ne fonctionne que dans le même document, et paste alors « le calque sélectionné » au lieu de « l'élément copié » : deux comportements différents pour la même touche. |
| Faire confiance au fragment parce qu'il vient du renderer | Le renderer est une frontière : le Host revalide tout ce qu'il écrit, sans exception (même principe que le HTML iframe). |
| Réécrire les `href` pour supporter le collage de `<use>` | Demande une résolution de références (cible, portée, ordre) que l'éditeur ne possède pas encore ; mieux vaut refuser explicitement que produire une copie fausse. |
| Coller en fin de document sans passer par le scanner | Insère du balisage non validé : exactement la classe de bug que le reste du store élimine. |

## Garanties

- le menu n'écrit jamais à l'ouverture, seulement sur action ;
- chaque action du menu produit le même patch exact qu'un contrôle visible ;
- une cible de collage refusée laisse le fichier **octet pour octet** inchangé ;
- un collage réussi n'introduit aucun id en double ;
- le collage ne sort jamais de la racine `<svg>` ;
- `Ctrl+C` n'écrit rien, ni dans le document, ni sur le disque.

## Non-garanties

- pas de presse-papiers système, donc pas de copie entre DSH et un autre
  logiciel, ni après un rechargement de la vue ;
- pas de copie de `image`, `use`, `symbol`, `defs` ni de dégradés référencés ;
- pas de coupe (`Ctrl+X`), pas d'ordre de plan (premier plan / arrière-plan),
  pas de collage à la position du pointeur : l'élément collé arrive en fin
  d'ordre du document, comme une duplication ;
- pas de glisser-déposer entre documents.

## Preuves

| Niveau | Commande | Résultat |
|---|---|---|
| 1 | `npm run check` | **478/478 PASS** (dont `tests/svg-paste.test.mjs` : 8 tests module + 2 tests de route réelle) |
| 2 | `npm run test:browser` | **60 specs × Chromium 145 + Firefox 146 = 120 PASS / 0 FAIL**, dont `menu: right-clicking a shape…`, `menu: a row action targets…`, `menu: copying a layer…` et `menu: the paste entry stays disabled…` |
| — | Refus vérifiés | balisage autour de l'élément, deux éléments, `script`, `foreignObject`, `onclick`, `href`/`xlink:href`, fragment vide, fragment > 1 MiB, cible sans enfant |
