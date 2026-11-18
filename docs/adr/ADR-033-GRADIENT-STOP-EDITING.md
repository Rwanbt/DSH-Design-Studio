# ADR-033 — Éditer les arrêts d'un dégradé SVG en réécrivant une seule valeur d'attribut

**Statut :** accepté · **Date :** 18 novembre 2026 · **Branche :** `dev` ·
**HEAD observé :** `e369a2d` ·
**Concerne :** `src/svg-gradient.mjs` (nouveau), `src/plugin-host.mjs`, `client.js`,
`tests/svg-gradient.test.mjs` (nouveau), `tests/host-editor-routes.test.mjs`,
`tests/browser/specs/gradient.mjs` (nouveau), `tests/browser/specs/index.mjs`,
`package.json`, `docs/roadmap/DELIVERY-GATES-2026-11-17.md`

## Contexte

Une forme qui utilise `fill="url(#sky)"` est dessinée par un
`<linearGradient>`/`<radialGradient>` défini ailleurs dans le document. Jusqu'ici
l'inspecteur affichait honnêtement « Dégradé ou valeur non hexadécimale : édition
couleur indisponible » : aucune valeur du dégradé n'était modifiable, il fallait
passer par l'éditeur de source et réécrire à la main une partie du document que
la forme référence.

La tranche demandée est bornée : **modifier les attributs d'un `<stop>` existant**
d'un dégradé identifié par son `id`, pas créer un dégradé, pas ajouter ou
supprimer un arrêt, pas changer un `gradientTransform`.

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

## Alternatives rejetées

| Alternative | Pourquoi non |
|---|---|
| Réutiliser `svg-attribute` avec `attribute:'stop-color'` | `svgAttributePatch` ne connaît pas les arrêts, ne vérifie pas la propriété du `href`, le `style=`, les entités ni l'existence de l'attribut ; il autoriserait des écritures non sûres. |
| Insérer `stop-opacity` / `offset` quand l'attribut manque | L'utilisateur ne verrait plus la valeur réelle du fichier et la tranche glisserait vers la création d'attribut ; refus `missing-attribute` plus honnête. |
| Résoudre l'héritage `href` et éditer les attributs locaux | Les défauts, l'héritage par chaîne et les attributs partiellement redéfinis demandent un modèle de calcul SVG que l'éditeur n'a pas ; un refus typé est vérifiable. |
| Décoder les entités XML et comparer la valeur décodée | Une double entité (`&amp;#35;`) ou une entité inconnue rendrait la comparaison fausse ; refus `encoded-attribute`. |
| Réécrire tout le dégradé (`replace-source` sur la tranche) | Perd l'inverse exact, déplace les octets non concernés et permet au renderer de composer un document arbitraire. |
| Ajouter un arrêt depuis l'inspecteur | Hors périmètre : demande une insertion de nœud, des offsets calculés et une gestion de l'ordre ; non testé ici. |
| Afficher quand même des champs pour un dégradé hérité, en le signalant | Un champ qui ne peut pas écrire (ou qui écrit contre la source réelle) est exactement le contrôle factice interdit. |
| Accepter `rgba()`, `currentColor`, couleurs nommées | Élargit la validation sans preuve ; `none` + hex couvrent le besoin borné et sont testés. |

## Ce que cette décision ne fait pas

- **Aucune création** de dégradé, aucun ajout/suppression/réordonnancement
  d'arrêt, aucune édition de `gradientTransform`, `x1/y1/x2/y2`, `cx/cy/r`,
  `spreadMethod`, `gradientUnits`.
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
