# DSH Design Studio — alpha.15 : identité obligatoire + premier inspecteur HTML natif

**Statut :** prototype expérimental, PR #8 en brouillon vers `dev`. Aucun tag, aucune release, aucune fusion.

## Preuves exécutées

- SHA testé : **`2f079676eaa0af4cc5bcbdc1eb89d678f11b1238`**.
- [GitHub Actions, run 43978912726](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43978912726).
- Commande : **`npm run check`**, Node.js 22, vérification syntaxique et `node --test tests/*.test.mjs`.
- Sortie du job : **215 tests, 215 PASS, 0 FAIL, 0 SKIP**.
- Tests du client en React simulé ; tests d'intégration par véritable routeur Host et fichiers temporaires. Installation et gestes en DSH réel **NOT_RUN** : le tunnel du poste utilisateur était déconnecté.

## P0 : migration stricte des révisions

- Les écritures vers `POST /design-studio-native/apply` exigent désormais **`baseHash`** ET **`baseIdentity`** (jeton SHA-256 opaque de 64 caractères hexadécimaux).
- Si le jeton d'identité est absent ou mal formé : **HTTP 428 / `missing-revision`**, avant tout accès au fichier.
- Jeton présent mais périmé : **HTTP 409 / `stale-revision`**. Le stockage impose également ce jeton lors des mutations internes et vérifie l'identité du fichier en section critique.
- **Changement de contrat API :** les anciens clients qui n'envoient que `baseHash` doivent être mis à jour et rouvrir leurs documents. Le client de la branche transmet déjà les deux valeurs et les opérations Annuler/Rétablir sont couvertes.
- Si un répertoire parent disparaît durant l'acquisition du verrou, l'erreur est normalisée en `stale-revision`, sans tentative d'écriture.
- La CI a mis en évidence des assertions temporelles fragiles dans les tests de l'outil Plume. Les tests concernés attendent désormais l'enregistrement natif et l'état prêt de l'interface, plutôt qu'un délai fixe.

## P1 : premier inspecteur HTML

- `src/html-visual.mjs` extrait **jusqu'à 200 éléments HTML** de documents **de 512 KiB maximum**, avec des identifiants `id` explicites et uniques, sans exécuter le document ni le traiter via un navigateur.
- Les faux éléments situés dans les commentaires, scripts, styles, templates et textarea ne sont pas pris pour des calques éditables.
- Édition de la présentation **inline uniquement** : `htmlVisualStylePatch` modifie exclusivement la plage de l'attribut `style`, ou y insère une propriété si aucun attribut `style` n'existait. Les autres caractères HTML restent inchangés. Les patches inverses permettent l'Undo/Redo exact.
- Champs CSS autorisés : `color`, `background-color`, `display`, `width`, `height`, `padding`, `margin`, `gap`, `font-size`, `border-radius`, `font-weight`, `text-align`, `flex-direction`, `justify-content`, `align-items`, `opacity`.
- Valeurs simples strictement validées ; refus de `url(...)`, expressions, caractères suspects, injections d'attributs et déclarations ambiguës ou dupliquées. Les styles complexes restent à éditer dans le code source.
- `GET /design-studio-native/document` renvoie les `htmlElements` reconnus ; `POST /apply` accepte `kind: 'html-style'` avec toutes les protections natives SHA + identité.
- UI V3 Graphite : liste des éléments HTML identifiés, sélection, surlignage non persistant du nœud dans l'aperçu iframe sans script, champs de propriété CSS, bouton **Appliquer au HTML · sans IA**.
- Un brouillon non sauvegardé dans l'éditeur source bloque le bouton visuel.

## Tests et limites observables

- Analyseur HTML : balises simples, `id` dupliqués, commentaires/faux nœuds, style en quotes simples ou doubles, refus des valeurs dangereuses, Undo exact.
- Host + fichiers temporaires : mise à jour d'une couleur, sauvegarde ciblée, Undo, refus de jetons d'identité obsolètes et d'injections CSS.
- UI + Host + fichiers temporaires : sélection de l'élément, surlignage isolé, modification, sauvegarde, Undo, garde en présence d'un brouillon non enregistré.

### Non couvert à ce stade

- **NOT_IMPLEMENTED :** sélection d'éléments par clic direct dans le rendu HTML, DOM mapping complet, éditeur responsive Flexbox/Grid par poignées, inline CSS complexe, édition visuelle des règles des feuilles `.css` externes, CSS selectors/classes/cascade, édition HTML structurelle, design system et composants.
- **NOT_RUN :** véritable installation DSH Desktop/Web, rendu navigateur réel, gestes souris/tactile, mobile, WCAG/accessibilité, cross-OS.
- **NOT_RUN :** compare-and-swap atomique universel vis-à-vis des éditeurs externes, attaques de renommage entre la dernière vérification et `rename`, crash/power loss, stockage NFS/SMB.

**Décision :** PR #8 reste **DRAFT** vers `dev`. La CI ne justifie ni fusion `main`, ni tag, ni release. L'étape suivante est l'édition visuelle de règles CSS et la sélection HTML par clic dans une iframe isolée, après définition d'un protocole d'interaction sûr.
