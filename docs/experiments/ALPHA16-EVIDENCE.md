# DSH Design Studio — alpha.16 : éditeur visuel de règles CSS externes

**Date :** 17 novembre 2026. **État :** expérimental sur `feat/native-file-persistence` ; PR #8 toujours **DRAFT vers `dev`**. Aucun tag, release ni fusion.

## Preuve de CI

- **Source vérifiée :** commit `29fd25d881069574cea56154f135a20e5da7a0c5`.
- **GitHub Actions :** [run 43982069590](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43982069590).
- **Commande réellement exécutée :** `npm run check` sous Node.js 22, vérification de syntaxe et `node --test tests/*.test.mjs`.
- **Sortie vérifiée : 230 tests / 230 PASS / 0 FAIL / 0 SKIP.**
- Les tests incluent un routeur Host utilisé contre de vrais fichiers temporaires, avec un React client **simulé**. Les gestes dans un navigateur et l'installation réelle dans DSH restent **NOT_RUN**.

## Implémenté

- `src/css-visual.mjs` : inspection de règles simples et **uniques** `#id` ou `.classe` d'une feuille CSS réelle ouverte dans le workspace.
- Grammaire volontairement limitée : règles de premier niveau, blocs plats, déclarations simples. Les commentaires peuvent être ignorés, les doubles déclarations sont visibles en lecture seule, les valeurs complexes, sélecteurs multiples, `@media` et règles imbriquées ne sont pas éditables depuis cet inspecteur.
- `listCssVisualRules(source)` renvoie les sélecteurs, leurs déclarations simples et le caractère éditable. Limites : **512 KiB** de CSS analysé et **200 règles** affichées.
- `cssVisualRulePatch` remplace uniquement la plage source de **la valeur ciblée**, ou insère une déclaration unique à la fin du bloc. Les autres caractères du CSS conservent leur position et leur contenu. Annuler/Rétablir inverse exactement l'opération.
- Propriétés et valeurs limitées à l'allowlist existante de l'inspecteur HTML (dimensions, couleurs simples, display, flex-direction, alignments, espacement, typographie, opacité).
- API : `GET /design-studio-native/document` renvoie `cssRules` pour `.css` ; `POST /apply` accepte `kind: 'css-rule'` avec `selector`, `property`, `value` et les préconditions **obligatoires** `baseHash`/`baseIdentity`. Les mêmes verrous et protections que pour SVG/HTML s'appliquent.
- UI graphite : sidebar **Règles CSS**, aperçu lisible des déclarations, inspecteur propriété/valeur, bouton **Appliquer à la règle · sans IA** et historique Annuler/Rétablir.
- Aucune requête LLM, aucun runtime de navigateur externe, aucune réécriture du stylesheet au-delà du patch.

## Scénarios validés

- CSS uniligne et multiligne ; changement ciblé, insertion de déclaration, no-op et inversion exacte.
- Prévention des doublons de sélecteur, des déclarations dupliquées, commentaires de tête, syntaxe imbriquée/ambiguë et valeurs injectées.
- Host : ouverture du fichier .css, édition, commit, reload, Undo, refus 409 sur jeton périmé.
- Client simulé → API Host → disque : sélection de la règle, édition, Undo, refus quand un brouillon source non enregistré existe.
- La première exécution (227/230) a révélé trois défauts de scanner/test/vue CSS ; ils ont été corrigés avant de revérifier **230/230** dans la run citée.

## Ce que l'alpha.16 ne prétend pas faire

- Le fichier CSS est actuellement **ouvert séparément** : l'éditeur ne relie pas encore une sélection HTML à sa règle CSS externe, et n'affiche pas sa cascade ni ses priorités.
- **NOT_IMPLEMENTED :** `@media`, `@supports`, sélecteurs composites, règles multiples, spécificité, `!important`, variables custom CSS, styles de frameworks et mapping du CSS vers l'aperçu HTML.
- **NOT_RUN :** DSH Desktop/Web réel, rendu/pointeur dans navigateur, mobile, clavier/focus, Windows/macOS, tests de perte de courant, sécurité CAS/TOCTOU vis-à-vis de logiciels non coopérants.
- Les défauts signalés dans les alphas 13–15 restent pertinents, notamment le manque d'une isolation filesystem universelle.

## Backlog et critères d'arrêt

- Nouvelle matrice : [`docs/roadmap/DELIVERY-GATES-2026-11-17.md`](../roadmap/DELIVERY-GATES-2026-11-17.md).
- Tickets des chantiers prioritaires : **#9** stockage, **#10** sélection HTML, **#11** liaison CSS + responsive, **#12** SVG avancé, **#13** UX mobile, **#14** IA + packaging.
- **G0 (installation DSH réelle) reste BLOCKED/NOT_RUN** : ne pas qualifier l'éditeur de MVP stable.
- Ne pas fusionner sur `main`, publier, tagger ou déclarer l'outil « production ready » à partir de ces seuls tests.
