# ADR-029 — Éditer une déclaration dans un `@media` simple, sans ambiguïté

**Statut :** accepté · **Date :** 18 novembre 2026 · **Branche :** `dev` ·
**Concerne :** `src/css-visual.mjs`, `src/plugin-host.mjs`, `client.js`

## Contexte

L'éditeur CSS natif savait modifier une règle de premier niveau, mais **refusait
toute déclaration sous `@media`** avec `inside-at-rule`. C'est le cas le plus
courant d'une feuille réelle : une couleur ou une largeur change d'abord dans un
breakpoint. Refuser en bloc laissait l'utilisateur éditer la source à la main,
c'est-à-dire sortir de l'inspecteur dès qu'il touchait au responsive.

Le risque est double et c'est le vrai sujet de cette décision :

1. **Ambiguité de cible.** Deux blocs `@media (max-width: 600px) { .card { … } }`
   peuvent être strictement identiques. Un sélecteur, une condition, ou même le
   couple des deux ne désignent alors pas *un* emplacement.
2. **Aplatissement silencieux.** Si une règle conditionnelle devenait
   simplement `editable: true`, la projection d'aperçu HTML
   (`html-responsive-preview.mjs`), dont le seul garde est ce drapeau,
   l'appliquerait **sans sa condition**. L'aperçu mentirait.

## Décision

### 1. La cible est une position exacte, revalidée

`cssMediaDeclarationPatch(source, { start, condition, property, value })` adresse
la règle par son **offset `start`** — unique par construction du scanner — puis
**revalide la condition normalisée** et l'éligibilité avant de calculer le patch.
Le client ne fournit jamais le `before` : le Host le recalcule depuis les octets
courants, donc une référence périmée ou falsifiée est refusée
(`stale-reference`, `unknown-node`) au lieu d'écrire dans un autre bloc.

La révision reste vérifiée deux fois, comme partout : `baseHash` +
`baseIdentity` (409), puis CAS du store et précondition exacte du patch.

### 2. Périmètre volontairement étroit

Accepté : **un seul** ancêtre `@media`, dont la condition est exactement une
fonction de largeur `(min-width: Npx)` ou `(max-width: Npx)`, sur une règle à
sélecteur déjà supporté, avec un bloc de déclarations plat et sans doublon.

Refusés, avec un code typé : `screen and (…)`, listes séparées par virgule,
syntaxe de plage `(width <= 600px)`, autres fonctionnalités (`max-height`,
`resolution`…), unités non `px`, `@supports`/`@layer`/double `@media`, imbrication
dans une règle (CSS nesting), blocs vides ou dupliqués. Aucun de ces cas n'est
« approximé ».

### 3. Deux surfaces distinctes, jamais confondues

- `listCssVisualRules` / `rule.editable` restent **inchangés** : une règle
  conditionnelle n'y apparaît pas, donc jamais `editable: true`.
- Les règles conditionnelles sont exposées séparément (`cssMedia` dans la
  réponse `/document`) avec la clé **`conditionalEditable`**. Le nom est
  délibéré : `editable` est le garde unique de la projection d'aperçu, et
  réutiliser ce nom rouvrirait le piège d'aplatissement.
- L'interface affiche la condition réelle (`@media (max-width: 600px)`), la
  position et, si besoin, l'ordinal du bloc pour que deux blocs identiques aient
  des noms accessibles distincts.
- Sélection conditionnelle et sélection inconditionnelle sont **mutuellement
  exclusives** : un seul inspecteur actif, jamais deux cibles d'écriture.

### 4. L'aperçu HTML ne projette toujours rien de conditionnel

La projection partielle conserve son exclusion explicite et une régression
vérifie la non-vacuité : la règle conditionnelle doit réellement exister dans le
modèle, porter sa déclaration, rester `editable: false`, et son contenu ne doit
apparaître ni dans le CSS projeté ni via un `@media` émis.

## Ce que cette décision ne fait pas

- **Aucune cascade, aucune spécificité, aucune valeur calculée.** L'inspecteur
  affiche la déclaration écrite dans le fichier, pas le style effectif.
- Aucune **création** de breakpoint, aucune édition de la condition, aucun
  déplacement de règle entre blocs, aucune création de `@media`.
- Aucune évaluation média : l'aperçu ne simule pas le rendu à 390/768/1280 px
  pour ces règles.
- Aucune fusion multi-fichiers : une écriture = un fichier, une déclaration.
- La sélection est retenue par offset brut ; après une modification externe qui
  décale les octets, la cible est revalidée par le Host et l'inspecteur affiche
  la cible recalculée, mais avec deux blocs identiques le changement de cible
  peut être visuellement discret. Recharger avant une édition de masse.

## Alternatives rejetées

| Alternative | Pourquoi non |
|---|---|
| Rendre les règles conditionnelles `editable: true` | La projection d'aperçu les appliquerait sans condition : l'aperçu mentirait sur le rendu. |
| Adresser par sélecteur + condition | Deux blocs identiques restent indistinguables : on écrirait dans un bloc que l'utilisateur n'a pas visé. |
| Vérifier l'identité puis supprimer/réécrire tout le bloc | Réécriture destructive de bytes non concernés ; contraire à l'invariant de patch ciblé. |
| Interpréter des conditions complexes (`and`, virgules, plages) | Sans moteur CSS, une interprétation partielle donnerait une fausse impression de support. |
| Éditer aussi la condition (`max-width` → `min-width`) | Change la sémantique de la feuille entière ; mérite sa propre décision et ses propres preuves. |

## Preuves

| Niveau | Commande | Résultat |
|---|---|---|
| 1 | `npm run check` | **531 PASS / 0 FAIL / 0 SKIP**, code 0, Linux Node v24.19.0 |
| 1 | `node --test tests/css-media-edit.test.mjs` | 8 PASS : conditions refusées, deux blocs identiques, refus `stale-reference`/`unknown-node`/`inside-at-rule`/`duplicate-property`, non-vacuité de la projection, route Host 200 + inverse exact, 400/428/409/`unsupported-format`, octets inchangés après refus |
| 2 | `npm run test:browser` | **126 PASS / 0 FAIL / 0 NOT_RUN** (Chromium 145.0.7632.6 + Firefox 146.0.1), dont `css: a conditional declaration is edited at its exact offset…`, `css: a conditional and an unconditional rule never both stay the edit target`, `css: deleting an open stylesheet with a conditional rule selected…` |
| — | Régression du crash | Rouvert sans le correctif `closeDocument` : **FAIL** (« the conditional editor must be gone with the deleted document »), puis **PASS** avec le correctif — le test n'est pas vacuous |
| 3 | `npm run test:dsh` | **NOT_RUN** pour cette tranche : le parcours réel HTML/CSS existant ne couvre pas encore l'édition `@media` |

Revue indépendante : deux passes. La première a trouvé le crash après suppression
du CSS ouvert et la sélection croisée ; la seconde a trouvé la ligne de calque
restée sur l'ancien drapeau. Les trois défauts sont corrigés et couverts.

**Gate G2 : PARTIAL maintenu** (cascade, computed styles, `@container`,
breakpoints multiples et CSS de frameworks restent hors périmètre).
