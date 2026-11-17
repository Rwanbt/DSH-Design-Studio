# ADR-018 — Correspondance HTML ↔ CSS local sans simulation trompeuse de cascade

**Date :** 17 novembre 2026 · **Statut :** décision expérimentale acceptée pour l'alpha.18, **pas validée en navigateur réel** · **Issue :** #11.

## Contexte

L'alpha.17 propose une sélection HTML directe à partir d'un identifiant source unique. L'alpha.16 peut éditer une règle CSS simple dans un fichier `.css` ouvert. Le lien entre ces deux opérations manquait. Une véritable cascade CSS exige le DOM rendu, l'ordre des feuilles, l'héritage, les règles conditionnelles, la spécificité, les variables et le moteur CSS du navigateur. **Un parseur limité ne doit jamais inventer le « style calculé ».**

## Décision

Implémenter une association **en lecture seule et explicitement indicative**, sans déduire la valeur CSS finale.

1. Sur `GET /design-studio-native/document` d'un document HTML/HTM, le Host lit les balises statiques `<link rel="stylesheet" href="...">` à l'aide du scanner HTML conservateur ; il saute les commentaires, scripts, `template` et autres zones non exécutables. Les liens à valeur non quotée, conditionnels (`media` sauf `all`), désactivés ou à `type` incompatible sont signalés comme non pris en charge.
2. **Autorité d'accès** : seules les références `.css` à chemin relatif strict dans le workspace sont acceptées. Pas d'URL Internet, d'URI `data:`, de caractères encodés, d'absolu, de `..`, de chemins cachés ni de symlink. Le chemin est validé par le stockage natif (`createNativeFileStore.read`), sans lecture arbitraire ni requête réseau. Limites : **8 liens, 512 KiB par feuille** analysée et 200 règles listées par feuille.
3. Le Host extrait uniquement les règles simples `#id` et `.classe` de premier niveau connues du parseur `css-visual`. Il les associe aux éléments HTML portant un `id` unique et des classes littérales valides. Les sélecteurs complexes et at-rules n'entrent pas dans la liste de candidats.
4. Le client affiche la provenance **fichier / sélecteur**, les déclarations présentes et une **spécificité indicative** (100 pour ID, 10 pour classe). Les collisions et styles conditionnels ne sont **pas** résolus. Les feuilles ignorées et erreurs de lecture apparaissent comme informations, sans supposer que leurs styles n'existent pas.
5. Un clic sur une règle candidate **ouvre son fichier CSS natif** dans l'inspecteur déjà en place ; ce n'est pas une édition multi-fichier transactionnelle. **La valeur affichée est rechargée depuis la révision CSS actuelle**, pas celle lue à l'ouverture du HTML. Une règle disparue est refusée explicitement.
6. Les changements réels sont effectués uniquement par le routeur `css-rule` avec les préconditions obligatoires `baseHash` et `baseIdentity`, le verrou interprocessus et Undo/Redo existants. La page HTML ne change pas lors d'un commit CSS. Un bouton retourne au HTML source et à sa sélection antérieure.
7. Aucun CSS externe n'est injecté dans la prévisualisation HTML de cette alpha : **le rendu n'est pas garanti fidèle à un navigateur de production**. Cette limite est présentée dans l'inspecteur.

## Alternatives non retenues pour ce jalon

- Injecter automatiquement la feuille CSS entière dans le `srcDoc` HTML : dangereux sans analyse de la surface CSS (`url()`, imports, politiques CSP) et trompeur si la cascade n'est pas résolue.
- Modifier simultanément HTML et CSS dans une seule transaction : la couche actuelle n'offre qu'une sauvegarde révisionnée par fichier, pas de transaction atomique inter-fichiers.
- Promettre le `getComputedStyle` navigateur dans le serveur : sans DOM navigateur réel cela serait une simulation inexacte.

## Risques explicitement ouverts

- Les règles `@media`, `@supports`, sélecteurs combinés, `:hover`, héritage, `!important`, custom properties, pseudo-éléments et CSS de frameworks peuvent modifier la valeur réellement appliquée. La liste de « correspondances possibles » **n'est pas exhaustive**.
- Une feuille peut changer entre l'inspection HTML et l'ouverture du CSS ; une nouvelle lecture doit donc toujours être faite avant l'édition.
- Les fichiers CSS liés peuvent être absents ou remplacés par un lien symbolique ; ils sont indiqués comme indisponibles, sans lecture hors workspace.
- Le scanner HTML source est volontairement limité et n'est **pas** un parseur HTML5 exhaustif. Les documents ambigus restent à éditer en source.
- **NOT_RUN :** vrai navigateur Chromium/Firefox, DSH Web/Desktop, lecture effective de la cascade, interaction souris/tactile et audit de sécurité contre HTML/CSS hostile.

## Prochaine décision

Définir un **inspecteur de cascade réel** dans le navigateur, avec lien explicite entre `CSSStyleDeclaration`, le fichier d'origine et une modification de source fiable. Ne pas écrire dans la feuille à partir d'une valeur calculée sans preuve de provenance et validation de révision.

**G2 : PARTIAL ; G0 : NOT_RUN. PR #8 : DRAFT. Aucune release.**
