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
`role="menu"` propose : `Dupliquer`, `Copier`, `Coller`, `Avancer`/`Reculer d'un plan`,
`Premier plan`/`Arrière-plan`, `Supprimer`, `Grouper`, `Dégrouper`,
`Masquer`/`Afficher`, `Verrouiller`/`Déverrouiller`. Chaque entrée
appelle **exactement** le même genre de patch que le bouton correspondant de
l'inspecteur (`svg-layer`, `svg-grouping`, `svg-visibility`, `svg-lock`,
`svg-order`) : aucun chemin d'écriture parallèle, aucune sémantique divergente.

### 1 bis. L'ordre de plan est un déplacement de source

En SVG, l'ordre du document **est** l'ordre de peinture : il n'y a pas de
`z-index`. `svg-order` déplace donc la tranche exacte du calque parmi ses
frères, en un seul remplacement contigu (`Ctrl+]` / `Ctrl+[`, `Ctrl+Maj+]` /
`Ctrl+Maj+[`) ; l'Undo restaure les octets d'origine. Les refus sont explicites :
déjà au premier/dernier plan, sans frère, racine, contenu référencé, calque
verrouillé.

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
- pas de coupe (`Ctrl+X`), pas de collage à la position du pointeur : l'élément
  collé arrive en fin d'ordre du document, comme une duplication ;
- l'ordre de plan ne s'applique qu'entre frères d'un même parent, pas entre
  calques de profondeurs différentes ;
- pas de glisser-déposer entre documents.

## Durcissement du 18 novembre 2026 — limites explicites

La revue indépendante a reproduit des collisions d'IDs encodés XML et des
références internes non suivies. Le collage refuse désormais :

- les IDs contenant des entités dans le fragment **ou la destination** ;
- chaque descendant hors de la liste de formes supportées ou en lecture seule,
  pas seulement la racine du fragment ;
- les attributs avec références `url/var/env/attr`, encodages XML, échappements ou
  commentaires CSS ambigus, plutôt que prétendre résoudre leur sémantique.

Le refus est volontairement conservateur, y compris pour des attributs encodés
inoffensifs. Le texte simple reste copiable ; `tspan` et le texte structuré ou
multiligne sont temporairement refusés au collage, sans modifier le texte source.

L'éligibilité de copie est calculée côté Host depuis le scanner complet : un
élément imbriqué ne peut pas être extrait sans son contexte ancestral ; copier
le groupe parent complet est proposé. Racine portant une présentation héritée
ou document portant des styles : refus explicite. Le client exige une métadonnée
positive ; un Host ancien sans cette métadonnée ne déclenche pas de copie
optimiste. Un refus conserve le presse-papiers précédent.

Ce contrôle concerne le contexte **source**, pas une fidélité générale au rendu :
le document destination peut appliquer ses propres styles. Aucune promesse de
copie de style calculé ou de résolution de cascade n'est faite. La détection des
processing instructions `xml-stylesheet` est également fail-closed : même un
marqueur dans un commentaire est refusé par précaution. Une déclaration XML seule
reste admise. Ce choix conservateur est couvert par une régression Host.

## Navigation clavier du menu — 18 novembre 2026

Le menu reçoit le focus sur le premier bouton activable. Haut/Bas circulent en
ignorant les contrôles désactivés ; Home/End vont aux extrémités. Entrée/Espace
conservent l'activation native. ContextMenu et Shift+F10 ouvrent le menu depuis
une ligne de calque. Les événements du menu ne déclenchent pas les raccourcis
canevas.

Escape restitue le déclencheur ; Tab/Shift+Tab ferment puis laissent continuer
la navigation native, sans piéger le focus. Si une suppression asynchrone retire
le déclencheur, un contrôle canevas survivant récupère le focus seulement quand
celui-ci est perdu sur body ; un déplacement volontaire du focus ne doit pas
être remplacé par le repli.

Preuves ciblées : régressions Tab et suppression observées rouges dans les deux
moteurs, puis **10 PASS / 0 FAIL / 0 NOT_RUN**, 61 assertions par moteur Chromium
145.0.7632.6 et Firefox146.0.1, code0. Revue indépendante favorable après correction
des deux constats. Commit `c5f284c78b1b1ed12bbf52dc3b39c6e7218b1e23`.
Pas de typeahead, roving tabindex, lecteur d'écran ni conformité WCAG globale
revendiqués.

## Preuves historiques (avant ce durcissement)

| Niveau | Commande | Résultat |
|---|---|---|
| 1 | `npm run check` | **485/485 PASS** (dont `tests/svg-paste.test.mjs` : 8 tests module + 2 tests de route réelle, et `tests/svg-order.test.mjs` : 5 tests module + 2 tests de route réelle) |
| 2 | `npm run test:browser` | **61 specs × Chromium 145 + Firefox 146 = 122 PASS / 0 FAIL**, dont `menu: right-clicking a shape…`, `menu: a row action targets…`, `menu: copying a layer…`, `menu: the paste entry stays disabled…` et `menu: paint order changes…` |
| — | Refus vérifiés | balisage autour de l'élément, deux éléments, `script`, `foreignObject`, `onclick`, `href`/`xlink:href`, fragment vide, fragment > 1 MiB, cible sans enfant |
