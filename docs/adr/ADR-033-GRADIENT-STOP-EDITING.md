# ADR-033 — Éditer les arrêts d'un dégradé SVG en réécrivant une seule valeur d'attribut

**Statut :** accepté · **Date :** 18 novembre 2026 · **Branche :** `dev` ·
**HEAD observé :** `ae58f03` (base des tranches 1.1 et 1.4 ; travail non commité
dans cette session) ·
**Tranches :** 1.1 (édition des attributs d'un arrêt) et 1.4 (structure : ajout
et suppression d'un arrêt) ·
**Concerne :** `src/svg-gradient.mjs`, `src/plugin-host.mjs`, `client.js`,
`tests/svg-gradient.test.mjs`, `tests/host-editor-routes.test.mjs`,
`tests/browser/specs/gradient.mjs`, `tests/browser/specs/index.mjs`,
`package.json`, `docs/roadmap/INTEGRATION-PLAN-2026-11-18.md`

## Contexte

Une forme qui utilise `fill="url(#sky)"` est dessinée par un
`<linearGradient>`/`<radialGradient>` défini ailleurs dans le document. Jusqu'ici
l'inspecteur affichait honnêtement « Dégradé ou valeur non hexadécimale : édition
couleur indisponible » : aucune valeur du dégradé n'était modifiable, il fallait
passer par l'éditeur de source et réécrire à la main une partie du document que
la forme référence.

La tranche 1.1 est bornée : **modifier les attributs d'un `<stop>` existant**
d'un dégradé identifié par son `id`, pas créer un dégradé, pas ajouter ou
supprimer un arrêt, pas changer un `gradientTransform`. La tranche 1.4 (section
« Structure » ci-dessous) lève la borne sur la structure des arrêts — un span
inséré ou retiré, toujours un seul patch — sans changer ce contrat d'édition.

Le risque n'est pas la taille du patch (une valeur d'attribut) : c'est la
**provenance de la valeur**. Un `<stop>` peut hériter d'un autre dégradé par
`href`/`xlink:href`, porter un `style=` qui écrase les attributs de présentation,
ou encoder ses attributs en XML. Dans tous ces cas, les octets que l'on
modifierait ne sont pas la source de vérité, et l'éditeur ne sait pas la
reconstituer. La règle du projet est de refuser typé plutôt que de deviner.

## Décision

### 1. Un module pur, une valeur d'attribut, un inverse exact

Nouveau module `src/svg-gradient.mjs`, sans disque, sans DOM, sans réseau :

- `listSvgGradients(source, {scan?})` retourne, pour chaque dégradé
  `linearGradient`/`radialGradient` **adressable** (id valide, unique, résolu par
  `scanSvgDocument`), un descripteur :
  `{id, type:'linear'|'radial', usable, reason, stops, referencedBy}`.
  Chaque arrêt expose ses valeurs brutes (`offset`, `color`, `opacity`, `null`
  si l'attribut est absent) et les spans exacts de ces valeurs
  (`offsetSpan`, `colorSpan`, `opacitySpan`) ; `referencedBy` liste les `id` des
  éléments dont un attribut contient `url(#id)`.
- `svgGradientStopPatch(source, {gradientId, index, attribute, value})` retourne
  **un seul** patch `{start, end, before, after}` sur le span de valeur de
  l'attribut existant. `applyNativePatches` en déduit l'inverse exact : un arrêt
  modifié = une écriture = un pas d'Undo, guillemets et octets voisins compris.
- `options.scan` permet au Host de réutiliser le scan déjà effectué pour la liste
  des calques : l'ouverture d'un SVG ne scanne pas deux fois le même texte.

### 2. Attributs modifiables : seulement ceux déjà présents

`stop-color`, `stop-opacity` et `offset` **uniquement**, et seulement si
l'attribut existe déjà sur l'arrêt ciblé. Cette tranche **n'insère aucun
attribut** : un arrêt sans `stop-opacity` n'a pas de champ actif et le Host
refuse `missing-attribute`. Un attribut absent n'est jamais inventé avec une
valeur par défaut.

### 3. Validations strictes, valeurs écrites telles quelles

- `stop-color` : `#rgb`, `#rrggbb` ou `none` (casse hexadécimale conservée) ;
- `stop-opacity` : nombre décimal fini dans `0..1` ;
- `offset` : nombre dans `0..1`, ou pourcentage dans `0%..100%` (l'unité est
  conservée : `50%` reste `50%`, aucune conversion silencieuse) ;
- une valeur vide, négative, hors bornes, `red`, `#12345` ou `1.5` est refusée
  avec `invalid-value` ; rien n'est écrit.

### 4. Le refus est la réponse par défaut

Refus typés, sans patch et sans écriture :

- **dégradé introuvable** (`unknown-gradient`) : id absent, id qui ne désigne
  pas un `linearGradient`/`radialGradient` ;
- **id ambigu** (`ambiguous-gradient`) : le document contient des ids dupliqués,
  donc aucun id n'est résolu sans risque ;
- **structure non scannable** (`structure-unavailable`) : le XML ne peut pas être
  structuré (balise non fermée, fragment toléré en lecture seule, etc.) ; la
  liste est vide et un avertissement visible est renvoyé par `/document` ;
- **dégradé hérité par `href`/`xlink:href`** (`inherited-gradient`) — y compris
  avec un préfixe d'espace de noms arbitraire `*:href` : ses arrêts ne sont pas
  définis localement, l'héritage de dégradé n'est pas résolu ici. Refus
  conservateur même si des `<stop>` locaux existent ;
- **`<stop>` avec `style=`** (`ambiguous-style`) : la valeur de présentation
  pourrait venir du style, source de vérité ambiguë ;
- **attribut ciblé encodé en XML** (`encoded-attribute`), par exemple
  `stop-color="&#35;ff0000"` : la valeur décodée ne serait pas comparable aux
  octets que l'on écrirait ;
- **dégradé sans arrêt** (`no-stops`) : rien n'est adressable ;
- **index hors bornes** (`index-out-of-range`) ;
- **attribut absent** (`missing-attribute`) : pas d'insertion dans cette tranche ;
- **valeur identique** (`unchanged`) : aucune réécriture cosmétique, aucun octet
  touché — et côté client, aucune requête n'est émise pour ce cas ;
- **cible invalide** (`invalid-target`) : id non conforme, index négatif ou non
  entier, attribut hors des trois autorisés ;
- **révision / identité** : 428 (révision absente) et 409 (révision périmée)
  restent ceux de `POST /apply`, sans exception ;
- **document non SVG** : `unsupported-format` (400).

### 5. Host : une opération, un patch, un Undo

Nouveau genre `svg-gradient-stop {gradientId, index, attribute, value}` dans
`POST /apply` :

- mêmes préconditions de révision et de CAS que les autres genres
  (`baseIdentity` 428, `baseHash`/`baseIdentity` 409) ;
- un seul patch, donc un seul inverse exact et un seul pas d'Undo/Redo ;
- `GET /document` expose `gradients` (`{id, type, usable, reason, stops,
  referencedBy}`) pour les SVG ; les documents HTML/CSS renvoient `[]` sans
  changer leur contrat.

### 6. Client : une section réelle, jamais un contrôle factice

Dans l'inspecteur, la section **« Dégradé »** n'apparaît que si :

1. la forme sélectionnée a un `fill` de la forme exacte `url(#id)` ;
2. la réponse `/document` contient un dégradé de cet `id`.

Pour chaque arrêt, un champ couleur et un champ opacité (activés seulement si
l'attribut existe) ; une modification = **un** `save()` = une écriture exacte =
un Undo. Le champ couleur se désactive pour une valeur non hexadécimale (`none`),
le champ texte accepte `none`/`#rgb`/`#rrggbb`. Une valeur invalide est refusée
côté client sans requête ; une valeur identique à celle du fichier n'émet rien.

Si le dégradé n'est pas modifiable, la section affiche la **raison traduite**
(`data-gradient-reason` typé) et les arrêts en lecture seule : **aucun champ
actif** n'est proposé. Si le `fill` est une couleur hexadécimale, ou un
`url(#…)` inconnu, ou absent, **aucune** section n'est ajoutée : le
Remplissage existant reste inchangé.

## Structure — ajouter et supprimer un arrêt (tranche 1.4)

**Périmètre ajouté :** deux gestes, `svgGradientStopInsertPatch` et
`svgGradientStopRemovePatch` (kinds Host `svg-gradient-stop-add` et
`svg-gradient-stop-remove`), chacun produisant **un seul patch** et donc **un
seul pas d'Undo**. Le module reste pur (aucun DOM, disque ou réseau) et ne
réécrit jamais l'arbre XML ; les refus de la tranche 1.1 restent la réponse par
défaut.

### 1. Ajout — un seul span, offset distinct, style du voisin

- `index` est la position du nouvel arrêt dans la liste **résultante** : `0`
  insère avant le premier arrêt, `stops.length` (ou un index omis) ajoute à la
  fin. Un index négatif ou non entier est `invalid-target` ; un index au-delà de
  la longueur est `index-out-of-range`.
- Le nouvel arrêt copie **la couleur et l'opacité de l'arrêt voisin** (le
  précédent ; pour `index: 0`, le premier), y compris l'**absence** d'attribut :
  une opacité absente n'est jamais inventée. Une valeur de voisin qui ne peut pas
  être recopiée sans risque est refusée `unsupported-style`, jamais échappée à
  l'aveugle.
- L'`offset` est calculé dans le gap voisin (son milieu), puis sur une grille
  déterministe de fractions (1/2, 1/4, 3/4, …) si cette valeur est déjà prise.
  La collision est comparée **numériquement** (`50%` ≡ `0.5`) et l'offset est
  écrit dans l'unité du voisin (`77.5%` reste un pourcentage, `0.275` reste un
  nombre) : aucun doublon exact n'est possible. Un offset explicite optionnel est
  validé par la même grammaire que l'édition (`invalid-value`) et refusé
  `offset-collision` s'il rejoint une position existante.
- L'insertion est **un seul span** `{start: end, before: '', after: '<stop …/>'}`
  placé après l'arrêt précédent (ou avant le premier). L'indentation observée
  est réutilisée : sur un contenu multi-ligne, la nouvelle ligne reprend
  l'indentation du voisin et le style de fin de ligne du document (`\n` ou
  `\r\n`) ; sur un contenu mono-ligne, le `<stop>` est inséré sur cette même
  ligne, sans introduire de saut de ligne.

### 2. Suppression — le span exact, ou la ligne entière

- Refus `last-stop` si c'est le dernier arrêt restant : un dégradé sans arrêt n'a
  plus de sens ; refus `index-out-of-range` pour un index absent.
- Si l'arrêt occupe **sa ligne seule** (indentation, arrêt, fin de ligne), le
  span retiré inclut le saut de ligne et l'indentation de début de ligne : aucune
  ligne vide ni balise collée n'est laissée. Sinon, seul le span exact de
  l'élément est retiré et les espaces voisins restent intacts.
- Aucun autre arrêt n'est touché. Limite connue : le `id` propre à l'arrêt
  supprimé n'est pas vérifié comme référencé ailleurs ; seuls le nombre restant
  et la reparsabilité sont contrôlés.

### 3. Refus explicites et défense en profondeur

Les refus de la tranche 1.1 s'appliquent tels quels : `inherited-gradient`,
`ambiguous-style`, `encoded-attribute`, `no-stops`, `document-styles`,
`encoded-id`, `unknown-gradient`, `ambiguous-gradient`, `structure-unavailable`,
plus : `too-many-stops` (plafond **32** arrêts, vérifié avant l'insertion),
`unsupported-offset` (un offset existant n'est ni un nombre ni un pourcentage
dans `0..1`, donc aucun milieu sûr), `offset-collision`, `last-stop`,
`unsupported-style`, `invalid-result`.

**Défense en profondeur :** chaque patch d'insertion ou de retrait est appliqué
en mémoire puis **re-scanné** par `scanSvgDocument`. Si le document ne parse
plus, si le dégradé cible n'est plus résoluble, si le nombre d'arrêts n'a pas
bougé d'exactement ±1, ou si le nouvel arrêt n'est pas à la position demandée
avec l'offset et le style attendus, le Host refuse `invalid-result` : aucun octet
n'est écrit.

### 4. Client — deux contrôles réels, jamais factices

La section « Dégradé » expose **« Ajouter un arrêt »** (ajout en fin de liste) et
un bouton **« Supprimer l'arrêt N »** par arrêt, où **N est le numéro 1-based
affiché** dans le panneau (« Arrêt 1 » = `index: 0` dans la requête). Les deux
sont désactivés avec une raison visible quand `editable` est faux (sauvegarde en
cours, `reloadRequired`, brouillon de source, calque verrouillé) ; la suppression
est désactivée pour le dernier arrêt et l'ajout au plafond de 32, **sans aucune
requête**. Après succès, `/document` est relu : nombre, couleurs, offsets et
index des boutons se resynchronisent depuis le disque ; Undo restaure les octets.

### Preuves de la tranche 1.4

| Niveau | Commande | Résultat |
|---|---|---|
| 1 | `npm run check` | **613 PASS / 0 FAIL / 0 SKIP**, code 0 — dont **10 tests ajoutés** pour cette tranche (8 module `tests/svg-gradient.test.mjs`, 2 routes réelles `tests/host-editor-routes.test.mjs`) |
| 2 | `DSH_E2E_PLAYWRIGHT=/mnt/Stockage/App/twake-qualification/wt/drive/node_modules/playwright DSH_E2E_REACT_FALLBACKS=/mnt/Stockage/App/dsh-taskboard/node_modules node tests/browser/run.mjs '--grep=gradient:' --browsers=chromium,firefox --json=/tmp/gradient2.json` | **12 PASS / 0 FAIL / 0 NOT_RUN** (6 specs × Chromium 145.0.7632.6 + Firefox 146.0.1), **76 vérifications par moteur** : 26 édition 1.1, **20 ajout**, **14 suppression**, **6 dernier arrêt**, 6 hérité, 4 non référencé |
| 2 (régression ciblée) | même commande avec `--grep=inspector:` | **4 PASS / 0 FAIL / 0 NOT_RUN** (2 specs × 2 moteurs, 16 vérifications par moteur) |
| 3 | `npm run test:dsh` | **NOT_RUN** (aucun DSH réel exécuté dans cette session) |

Ce que les specs navigateur prouvent, sur les octets réels du disque :

- **ajout** : une seule ligne `<stop …/>` complète est insérée (une ligne de plus,
  toutes les lignes d'origine présentes dans le même ordre), avec
  `stop-color="#8090a0"` et `stop-opacity="0.8"` copiés du voisin, l'indentation
  de six espaces du fichier, un offset **distinct des trois existants** et
  **1 seul** `POST /apply` ; le panneau affiche « 4 arrêt(s) », le quatrième
  arrêt et son bouton « Supprimer l'arrêt 4 » ; Undo restaure les octets exacts
  (**2e** `POST`) et le panneau revient à « 3 arrêt(s) » ;
- **suppression** : la ligne `offset="0.55"` disparaît avec son indentation, les
  arrêts `0` et `100%` restent intacts, **1 seul** `POST`, le panneau se
  resynchronise à « 2 arrêt(s) », « Supprimer l'arrêt 3 » n'existe plus et
  « Supprimer l'arrêt 2 » vise le bon arrêt ; Undo restaure la ligne (**2e**
  `POST`) ;
- **dernier arrêt** : sur un dégradé à un seul arrêt, le bouton de suppression est
  `disabled`, sa raison « Dernier arrêt » est visible, l'ajout reste disponible,
  **0 `POST`** et le fichier est byte-identique.

### Limites de la tranche 1.4 (honnêtes)

- L'ajout place l'arrêt à la **position documentaire** demandée, pas à une
  position d'offset réordonnée : un ajout en fin de liste sur un dégradé
  `0, 0.55, 100%` reçoit `77.5%` (milieu des deux derniers) et n'est donc pas le
  plus grand offset. Aucun réordonnancement, aucune conversion d'unité.
- Pas de drag d'arrêt, pas d'édition de l'offset depuis l'interface, pas de
  dégradé conique, pas de création de dégradé.
- La suppression ne vérifie pas les références au `id` de l'arrêt retiré.
- Le niveau 2 utilise la coquille DSH simulée du harnais, pas l'application DSH
  réelle ; Desktop, tactile, lecteur d'écran et Electron restent **NOT_RUN**.

## Alternatives rejetées

| Alternative | Pourquoi non |
|---|---|
| Réutiliser `svg-attribute` avec `attribute:'stop-color'` | `svgAttributePatch` ne connaît pas les arrêts, ne vérifie pas la propriété du `href`, le `style=`, les entités ni l'existence de l'attribut ; il autoriserait des écritures non sûres. |
| Insérer `stop-opacity` / `offset` quand l'attribut manque | L'utilisateur ne verrait plus la valeur réelle du fichier et la tranche glisserait vers la création d'attribut ; refus `missing-attribute` plus honnête. |
| Résoudre l'héritage `href` et éditer les attributs locaux | Les défauts, l'héritage par chaîne et les attributs partiellement redéfinis demandent un modèle de calcul SVG que l'éditeur n'a pas ; un refus typé est vérifiable. |
| Décoder les entités XML et comparer la valeur décodée | Une double entité (`&amp;#35;`) ou une entité inconnue rendrait la comparaison fausse ; refus `encoded-attribute`. |
| Réécrire tout le dégradé (`replace-source` sur la tranche) | Perd l'inverse exact, déplace les octets non concernés et permet au renderer de composer un document arbitraire. |
| Réécrire tout le `<linearGradient>` pour ajouter ou supprimer un arrêt | Perd l'inverse exact et déplace les octets des autres arrêts ; la tranche 1.4 insère ou retire **un span unique** et re-scanne le résultat. |
| Afficher quand même des champs pour un dégradé hérité, en le signalant | Un champ qui ne peut pas écrire (ou qui écrit contre la source réelle) est exactement le contrôle factice interdit. |
| Accepter `rgba()`, `currentColor`, couleurs nommées | Élargit la validation sans preuve ; `none` + hex couvrent le besoin borné et sont testés. |

## Ce que cette décision ne fait pas

- **Aucune création** de dégradé, aucun réordonnancement d'arrêt (l'ajout et la
  suppression d'un arrêt sont la tranche 1.4, décrite ci-dessus), aucune édition
  de `gradientTransform`, `x1/y1/x2/y2`, `cx/cy/r`, `spreadMethod`,
  `gradientUnits`.
- **Aucune insertion d'attribut** sur un arrêt (même `stop-opacity="1"`), donc un
  arrêt sans `stop-opacity` reste sans opacité éditable.
- **Aucune résolution d'héritage** `href`/`xlink:href` : un dégradé qui en porte
  un est en lecture seule, même si ses arrêts locaux paraissent complets.
- **Aucune prise en charge de `style=`** sur un `<stop>` : la section est en
  lecture seule avec la raison.
- **Aucune référence CSS** : `referencedBy` ne compte que les `url(#id)` des
  valeurs d'attribut ; une référence dans un bloc `<style>` ou une feuille
  externe n'est pas listée.
- **Pas d'édition de l'`offset` depuis l'interface** : l'attribut est supporté par
  le module et le Host (validé, patch exact) mais l'interface de cette tranche
  n'affiche que couleur et opacité, conformément à la demande.
- **Non détecté / non réécrit, explicitement** : ids encodés XML (non
  adressables), dégradés sans id valide (non listés), pourcentages en notation
  exotique (`1e2%`), `stop-color` en notation `rgb()`, dégradés définis dans un
  `<style>` CSS.
- Tactile réel, lecteur d'écran, DSH Desktop et DSH Web réel : **NOT_RUN** pour
  ce geste dans cette session.

## Preuves

| Niveau | Commande | Résultat |
|---|---|---|
| 1 | `npm run check` | **563 PASS / 0 FAIL / 0 SKIP**, code 0 — dont **6 tests module** dédiés (`tests/svg-gradient.test.mjs`) et **4 tests de route réelle** (`tests/host-editor-routes.test.mjs`) pour ce geste |
| 2 | `DSH_E2E_PLAYWRIGHT=/mnt/Stockage/App/twake-qualification/wt/drive/node_modules/playwright DSH_E2E_REACT_FALLBACKS=/mnt/Stockage/App/dsh-taskboard/node_modules node tests/browser/run.mjs '--grep=gradient:' --browsers=chromium,firefox --json=/tmp/gradient.json` | **6 PASS / 0 FAIL / 0 NOT_RUN** (3 specs × Chromium 145.0.7632.6 + Firefox 146.0.1), **33 assertions par moteur** (23 + 6 + 4) |
| 2 (régression ciblée) | même commande avec `--grep=inspector:`, `menu:`, `rename:`, `align:`, `distribute:`, `drag:` | **42 PASS / 0 FAIL / 0 NOT_RUN** (remplissage hexadécimal, copier/coller, menu, renommage, alignement, distribution, glisser-déposer) |
| 3 | `npm run test:dsh` | **NOT_RUN** pour ce geste (aucun DSH réel exécuté ici) |

Les specs `gradient:` prouvent, sur les octets réels du disque :

- un changement de `stop-color` puis de `stop-opacity` : une seule région
  modifiée à chaque fois (le fichier est comparé à
  `source.replace(ancien, nouveau)`), exactement **un** `POST /apply` par
  modification, puis Undo octet-exact (une écriture par Undo, l'opacité d'abord,
  la couleur ensuite) ;
- un dégradé hérité par `href` : `data-gradient-usable="false"`,
  `data-gradient-reason="inherited-gradient"`, raison visible, **aucun champ
  actif**, **0 POST** ;
- un `fill` hexadécimal et un `url(#inconnu)` : aucune section « Dégradé »,
  **0 POST**, aucun octet modifié.

Limites de preuve : le module est prouvé au niveau 1 sur des documents réels en
mémoire via le moteur de patch réel ; le niveau 2 utilise la coquille DSH simulée
du harnais (React UMD + `ctx.slots`), pas l'application DSH. Le vrai parcours DSH,
le tactile, le lecteur d'écran et Electron restent non exécutés.

**Gate G3/G4 : PARTIAL** — geste prouvé dans deux moteurs réels sur une coquille
DSH simulée, pas dans le vrai DSH ; aucune création ni édition d'arrêt au-delà
des trois attributs existants.

## Corrections après revue indépendante (18 novembre 2026)

Trois défauts réels ont été trouvés et corrigés, chacun avec une régression :

1. **`stop-color="none"`** était accepté et écrit. Ce n'est pas une `<color>` : Chromium
   **et** Firefox rendent le noir. La valeur est désormais refusée (`invalid-value`)
   et retirée de la grammaire — un test le verrouille.
2. **Un `<style>` du document** (ou une instruction `xml-stylesheet`) peut redéfinir
   un arrêt : le panneau était actif et l'écriture n'avait aucun effet rendu. Tout
   dégradé devient maintenant non modifiable avec la raison `document-styles`.
3. **Un id encodé XML** (`id="sk&#121;"`) peut se décoder vers le même id qu'un
   dégradé littéral ; l'écriture tombait alors sur l'élément que le navigateur
   n'utilise pas. La présence d'un id encodé rend tous les dégradés non modifiables
   (`encoded-id`).

Deux limites d'affichage sont également explicites : une opacité non numérique
(`50%`, valide en SVG) est montrée **en lecture seule avec sa valeur réelle** au
lieu d'un champ actif vide, et l'infobulle de couleur ne promet plus `none`.

Les manques de preuve signalés (aucune requête pour une valeur identique,
resynchronisation après enregistrement et après Undo) sont traités dans les specs
navigateur.
