# ADR-032 — Renommer un calque SVG en réécrivant uniquement son `id`

**Statut :** accepté · **Date :** 18 novembre 2026 · **Branche :** `dev` ·
**Concerne :** `src/svg-rename.mjs` (nouveau), `src/plugin-host.mjs`, `client.js`,
`tests/svg-rename.test.mjs`, `tests/host-editor-routes.test.mjs`,
`tests/browser/specs/rename.mjs`

## Contexte

L'explorateur de calques affiche `tag #id` depuis la première version du
workbench, mais rien ne permettait de changer cet `id` : il fallait passer par
l'éditeur de source, donc réécrire à la main une adresse que le document
utilise peut-être ailleurs. Dans un outil de design, renommer un calque est un
geste quotidien ; son absence était une friction, pas un manque théorique.

Le risque de cette tranche n'est pas la réécriture d'un attribut : c'est
l'**adresse**. Un `id` est une cible pour `url(#…)`, `href="#…"`, les sélecteurs
CSS, les listes ARIA, les temps SMIL et, plus tard, les scripts. Renommer sans
suivre les références casserait silencieusement le document.

## Décision

### 1. Une opération Host explicite, un seul patch

Nouveau genre `svg-rename {id, next}` dans `POST /apply`, implémenté par
`svgRenamePatch()` dans `src/svg-rename.mjs` (module pur, testable sans disque).
Le patch couvre **uniquement le span de valeur** de l'attribut `id` :

```
{start: valueStart, end: valueEnd, before: ancienId, after: nouvelId}
```

`applyNativePatches` construit donc un inverse exact : un renommage = une
écriture = un pas d'Undo, qui restaure le fichier octet pour octet, guillemets
d'origine compris. La route renvoie `createdId = next`, ce que le client utilise
déjà pour re-sélectionner le calque après rechargement.

### 2. Le refus est la réponse par défaut

Refus typés, sans patch et sans écriture :

- id cible vide / non conforme, calque inexistant, `id` absent ;
- nouvel id vide, > 128 caractères, hors famille `[A-Za-z_][\w.:-]*` ;
- nouvel id **identique** à l'actuel (`unchanged` : aucune réécriture cosmétique) ;
- **collision** avec un id existant, y compris un id XML encodé qui se décode
  vers le nouvel id (`c&#97;rd` → `card`) ;
- une entité XML **inconnue ou malformée** dans une valeur d'attribut ou un
  contenu `<style>` (`ambiguous-entities`) : la valeur décodée pourrait cacher
  une référence, donc le renommage est refusé plutôt que deviné ;
- ancien id **référencé** par :
  - `url(#id)` (attribut, `style="…"` et contenu `<style>`, y compris via une
    entité encodée comme `url(&#35;id)`) ;
  - `href="#id"` et **tout attribut de nom local `href`** (`xlink:href`,
    `x:href`, autre préfixe), y compris `href="&#35;id"` et `href="#c&#97;rd"` ;
  - les listes ARIA `aria-labelledby`, `aria-describedby`, `aria-controls`,
    `aria-owns`, `aria-activedescendant` (jetons séparés par des espaces) ;
  - les temps SMIL `begin` / `end` de la forme `id.evenement` (y compris dans
    une liste `0s; id.click`, avec un offset `+`/`-`) ;
  - un sélecteur CSS `#id` dans un bloc `<style>` : `#id`, `#id:hover`,
    `#id.active`, `#id::before`, `#id[attr]` ;
  - un sélecteur d'attribut `[id="id"]`, `[id='id']` ou `[id=id]` dans un bloc
    `<style>` (l'option `i`/`s` est tolérée) ;
  - la forme `#id2`, `#id-2`, `#id_2` n'est **pas** une référence : seul un
    caractère alphanumérique, `_` ou `-` après `#id` désigne un id différent ;
- ancien id nécessitant un **échappement CSS** (caractère hors
  `[A-Za-z0-9_-]`) alors que le document contient du CSS (`<style>` ou `url(`) :
  refus `id-not-renamable` (voir §5) ;
- calque **verrouillé** (lui-même ou un ancêtre `data-locked="true"`) ;
- contenu **en lecture seule** (`<defs>`, `<symbol>`, dégradés, `clipPath`, …) ;
- racine `<svg>` : elle n'est pas un calque et son id est le plus susceptible
  d'être référencé ; refus conservateur ;
- révision / identité de document non conforme (428), périmée (409) ;
- document non-SVG (`unsupported-format`).

Aucune référence n'est réécrite dans cette tranche : refuser explicitement vaut
mieux que produire un document qui pointe dans le vide.

### 3. Deux points d'entrée, une seule écriture, deux familles de refus

- **Double-clic** sur une ligne de calque, ou entrée **« Renommer le calque »**
  du menu contextuel : les deux ouvrent le même éditeur inline.
- Le champ est prérempli avec l'id actuel et sélectionné ; **Entrée** valide,
  **Échap** annule, **perte de focus** (testée avec `Tab`) annule. Une
  annulation n'émet aucune requête et ne touche aucun octet.
- Avant d'ouvrir le champ, l'interface vérifie l'état du document (occupé,
  incertain, brouillon de source ou de texte) et du calque (verrouillé, lecture
  seule, racine, sans id) : elle affiche alors un message explicite au lieu
  d'ouvrir un champ mort. Une entrée de menu n'est jamais un bouton qui ne fait
  rien.
- **Refus pré-vérifiés côté client, zéro `POST` :** motif et longueur du nom,
  nom identique, collision avec les ids visibles de l'arbre, `url(#id)`,
  `href="#id"` / `xlink:href="#id"` bruts. Ces refus n'émettent aucune requête.
- **Refus Host, exactement un `POST` et zéro écriture :** sélecteurs CSS
  (`#id:hover`, `[id="id"]`, …), entités XML encodées (`&#35;`, `&#97;`),
  préfixe `href` arbitraire, listes ARIA, temps SMIL, `ambiguous-entities` et
  `id-not-renamable`. Le client ne duplique pas ces analyses : le Host reste
  seul juge et seul écrivain, et re-valide de toute façon chaque règle.
- **Sur un refus Host, le champ reste ouvert avec la valeur tapée et reprend le
  focus** ; il ne se ferme qu'après un succès confirmé. Avant correction, le
  champ se fermait avant `save()` et la valeur était perdue.
- La pré-vérification client est volontairement conservatrice : un `url(#id)`
  ou un `href="#id"` présent dans un commentaire bloque le renommage côté UI
  alors que le Host, qui ignore les commentaires, l'autoriserait. Aucune
  écriture fausse n'en résulte.

### 4. Sélection, arbre et historique restent cohérents

- Après succès, le calque est re-sélectionné **sous son nouveau nom**
  (`createdId`), l'ancien id n'apparaît plus dans la liste ni dans les poignées ;
- une sélection multiple est réécrite de l'ancien vers le nouvel id ;
- l'entrée d'historique mémorise `{from, to}` : Undo restaure l'ancien id **et**
  réécrit aussi `extraSelection` (du nouveau vers l'ancien) ; Redo fait de même
  dans l'autre sens. Rejouer uniquement l'id actif laisserait un id fantôme dans
  la sélection et bloquerait l'alignement suivant (« Un calque sélectionné
  n'existe plus ») ;
- un tracé Plume en cours suit le renommage : `penPathId` est réécrit vers le
  nouvel id (et inversement par Undo/Redo), donc le point suivant continue le
  même `<path>` au lieu d'échouer ;
- le focus revient sur la ligne (annulation) ou sur la ligne renommée (succès).

### 5. Ids nécessitant un échappement CSS : refus, pas de faux sentiment de sûreté

Un id qui contient un caractère hors `[A-Za-z0-9_-]` (par exemple `layer.1`)
doit être échappé pour être écrit dans un sélecteur CSS. Chercher seulement la
forme brute laisserait passer `#layer\.1` ou une forme hexadécimale
équivalente. La solution retenue est conservatrice et typée :

- si le document contient du CSS (`<style>` ou `url(`), le renommage est refusé
  avec `id-not-renamable` ;
- s'il n'y a **aucun** contexte CSS, aucune référence échappée ne peut exister :
  le renommage reste autorisé et les références brutes `href="#layer.1"` /
  `url(#layer.1)` sont comparées exactement.

## Alternatives rejetées

| Alternative | Pourquoi non |
|---|---|
| Réutiliser `svg-attribute` avec `attribute: 'id'` | `PROPS` exclut volontairement `id` : une édition d'attribut générique contournerait la validation du motif, la détection de collision et celle des références. |
| Réécrire automatiquement `url(#…)`, `href="#…"`, les sélecteurs et ARIA | Demande une résolution de références (portée, ordre, CSS, SMIL) que l'éditeur ne possède pas ; refuser est plus honnête. |
| Supprimer puis réinsérer l'élément avec un nouvel id | Perd la tranche exacte, l'ordre, les attributs inconnus et l'inverse exact ; c'est exactement ce que l'architecture interdit. |
| Renommer via `replace-source` | Réécrit tout le document, perd l'inverse exact et permet au renderer de composer des octets arbitraires. |
| Une boîte de dialogue `prompt()` | Hors modèle React/DOM du workbench, non testable de façon déterministe, et sans validation visible. |
| Autoriser le renommage d'un id référencé en le signalant seulement | Casser une référence est une corruption silencieuse ; la règle du projet est de refuser plutôt que de produire un document faux. |
| Chercher uniquement la forme CSS échappée « évidente » d'un id spécial | Les échappements CSS hexadécimaux ont plusieurs orthographes ; un matcher partiel donnerait une fausse garantie. Le refus typé est vérifiable. |

## Ce que cette décision ne fait pas

- **Aucune réécriture de référence**, quel que soit le type : `url`, `href`,
  `xlink:href`, sélecteurs CSS, `[id="…"]`, `aria-*`, `begin`/`end` SMIL.
- **Non détecté / non réécrit, explicitement :**
  - les sélecteurs CSS écrits avec un **échappement hexadécimal** pour un id
    par ailleurs simple (`#\63 ard` pour `card`) ; les échappements CSS ne sont
    pas non plus décodés à l'intérieur d'un fragment `url(#…)` ;
  - les références situées dans une **feuille de style externe** (le Host ne lit
    pas les fichiers CSS liés) ;
  - les références produites par un **script** : le scanner refuse déjà
    `<script>` et `foreignObject`, donc ces documents ne sont pas éditables ;
  - les identifiants encodés XML ne sont pas adressables : ils servent seulement
    à refuser une collision décodée ;
  - les documents non-SVG (HTML/CSS) n'ont pas ce geste.
- Un `#id` dans un bloc `<style>` peut être confondu avec un commentaire CSS ou
  une couleur hexadécimale portant le même texte (id `fff` et `#fff`) : refus
  conservateur, jamais une écriture fausse.
- Pas de renommage en lot ni de renommage d'un groupe avec ses descendants.
- Pas de renommage de la racine `<svg>` ni d'un calque sans `id` (non listé).
- Tactile réel, lecteur d'écran, DSH Desktop et DSH Web réel : **NOT_RUN** pour
  ce geste dans cette session.

## Preuves

| Niveau | Commande | Résultat |
|---|---|---|
| 1 | `npm run check` | **553 PASS / 0 FAIL / 0 SKIP**, code 0 (dont `tests/svg-rename.test.mjs` : **18 tests module** et **4 tests de route réelle** dédiés au renommage dans `tests/host-editor-routes.test.mjs`) |
| 2 | `DSH_E2E_PLAYWRIGHT=… DSH_E2E_REACT_DIR=… DSH_E2E_REACT_FALLBACKS=… node tests/browser/run.mjs '--grep=rename:' --browsers=chromium,firefox --json=/tmp/rename-hardening.json` | **10 PASS / 0 FAIL / 0 NOT_RUN** (5 specs × Chromium 145.0.7632.6 + Firefox 146.0.1), **66 assertions par moteur** |
| 3 | `npm run test:dsh` | **NOT_RUN** pour ce geste (le parcours DSH réel n'est pas ré-exécuté ici) |

Les specs `rename:` prouvent, sur les octets réels du disque : une seule région
modifiée (la valeur `id`), exactement **un** `POST /apply`, Undo octet-exact puis
Redo (une écriture chacun), re-sélection sous le nouveau nom, ancien id non
sélectionnable. Côté refus, elles distinguent désormais les deux familles :

- **zéro requête** pour collision, id référencé par `href`, nom invalide, nom
  identique, calque verrouillé et brouillon de texte non enregistré ;
- **exactement une requête, zéro écriture, champ ouvert avec sa valeur et focus
  restauré** pour une référence CSS que seul le Host peut voir (`#dot:hover`) ;
- **Échap et blur (`Tab`) sans écriture**, focus rendu à la ligne ;
- Undo d'un renommage en multi-sélection ne laisse **aucun id fantôme** et
  l'alignement suivant reste possible et écrit réellement.

Limite de preuve de la correction Undo/Redo : dans l'interface actuelle,
`startRename()` promeut la ligne éditée en sélection active et `select()` exclut
l'id actif de `extraSelection`. Un id fantôme n'a donc pas pu être reproduit de
façon déterministe par un parcours navigateur avant la correction. La spec
`rename: Undo of a multi-selection rename…` vérifie l'invariant observable
(aucun id inexistant, alignement possible et écriture réelle) ; la réécriture
`{from,to}` d'`extraSelection` par Undo/Redo est la correction défensive
demandée, couverte par cette spec et par la symétrie du code.

**Gate G3/G4 : PARTIAL.** Le renommage est prouvé au clavier et au pointeur réel
dans deux moteurs sur une coquille DSH simulée ; pas dans le vrai DSH, ni au
tactile, ni avec un lecteur d'écran. Aucune réécriture de références n'est
revendiquée.
