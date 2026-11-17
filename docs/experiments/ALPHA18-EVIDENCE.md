# DSH Design Studio — Alpha 0.1.0.18 · Liaison HTML ↔ CSS externe

**Date :** 17 novembre 2026 · **Statut :** expérimental, PR #8 en brouillon vers `dev`.

## Preuves automatisées

- **Commit source effectivement testé :** `9e9e6f7310f7d83b016d6ec18a8d891becca628d`.
- **GitHub Actions :** [run 43988320991](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43988320991).
- **Commande :** `npm run check` sous Node.js 22 (vérification syntaxique et `node --test tests/*.test.mjs`).
- **Sortie vérifiée : 249 tests, 249 PASS, 0 FAIL, 0 SKIP.**
- Les tests d'interface se déroulent sous **React simulé**, les tests d'intégration du Host utilisent de vrais fichiers temporaires sur Linux. **DSH Desktop/Web réel, Chromium/Firefox réel et test mobile NOT_RUN**.

## Implémenté

### Correspondances HTML ↔ CSS (en lecture seule)

- Nouveau module `src/html-css-associations.mjs` : détection des balises statiques `<link rel="stylesheet" href="...">` à valeurs quotées et correspondance avec des éléments HTML portant un `id` unique et une liste de classes littérales simples.
- Accès **strictement local** aux chemins CSS relatifs au fichier HTML, via le magasin natif existant. Les URL externes, chemins absolus/traversée, caractères encodés, dossiers cachés, liens symboliques, doublons de liens, types incompatibles, feuilles désactivées ou conditionnelles sont refusés ou signalés sans exécution ni requête réseau.
- Limites : **8 références, 512 KiB par CSS et 200 règles simples par CSS**. Les feuilles ou chemins impossibles à ouvrir apparaissent comme indisponibles, sans empêcher l'ouverture du document HTML.
- Les seules correspondances présentées sont les règles simples `#id` et `.classe`, **non exhaustives** et pas nécessairement appliquées. Les détails du fichier, sélecteur, déclarations et spécificité indicative sont renvoyés dans `stylesheets` et `styleMatches` par `GET /design-studio-native/document`.

### Navigation sûre vers le vrai fichier CSS

- L'inspecteur HTML affiche un encart graphite « CSS externe · correspondances possibles » pour l'élément sélectionné au clic ou dans la liste.
- Chaque règle candidate propose d'**ouvrir le fichier CSS natif** dans l'inspecteur déjà existant. Le sélecteur est présélectionné et **sa valeur est rechargée depuis le fichier réel courant**, jamais recopiée depuis un ancien snapshot HTML.
- L'écriture de la feuille CSS, le verrou coopératif, `baseHash`, `baseIdentity`, le patch exact et Annuler/Rétablir restent identiques aux opérations CSS déjà validées.
- Un bouton « Retour à la page HTML » restaure le fichier HTML et la sélection précédente. Un brouillon HTML/CSS non sauvegardé bloque la navigation.
- **Aucune modification du HTML n'est provoquée par l'édition CSS**. Il n'y a pas de transaction multi-fichier ni d'injection de CSS externe dans l'aperçu HTML.

## Scénarios couverts par la CI

1. Résolution locale sûre des chemins `href`, interdiction des chemins externes, URI et traversal.
2. Association de règles `#id` et `.class` simples ; reconnaissance des classes multiples et provenance du fichier.
3. Signalement des liens absents, dupliqués, invalides, conditionnels, désactivés, typés non CSS, et refus des symlinks.
4. Absence de requête réseau et de lecture arbitraire en parcourant les références HTML.
5. Host → fichiers temporaires : lecture HTML, énumération, puis édition ciblée `.css`, SHA/identité et conservation du HTML original.
6. Client React simulé → Host : sélection HTML, navigation vers la règle externe, édition, Annuler, retour à HTML.
7. Modification externe du CSS entre les deux consultations : le sélecteur et la valeur proviennent **de la lecture fraîche** du fichier.
8. L'éditeur refuse les transitions lorsque le code source contient un brouillon non enregistré.

## Limites / critères encore ouverts

- **Ce n'est pas un moteur de cascade.** `@media`, héritage, sélecteurs combinés, `!important`, variables CSS, pseudo-états, priorités de cascade et framework CSS peuvent contredire les correspondances montrées.
- **L'aperçu HTML n'importe pas encore ces feuilles CSS.** Les changements de couleur ou de disposition effectués dans la feuille externe ne sont donc pas garantis visuellement dans cet aperçu.
- **NOT_IMPLEMENTED :** inspection `getComputedStyle`, liaison précise déclaration effective → fichier/règle, responsive Flex/Grid visuel et édition atomique de plusieurs fichiers.
- **NOT_RUN :** installation DSH réelle, navigateurs Chromium/Firefox, ergonomie mobile/tactile, sécurité active du modèle iframe (ADR-017), Windows/macOS, contention avec éditeur externe non coopératif.
- **P0 :** CAS universel et audits TOCTOU toujours ouverts ; aucun test ne justifie une release de production.

## Décision

- Architecture de ce jalon : [ADR-018](../adr/ADR-018-HTML-CSS-CANDIDATE-MAPPING.md).
- Feuille de route et critères d'arrêt : [DELIVERY-GATES-2026-11-17](../roadmap/DELIVERY-GATES-2026-11-17.md).
- Suivi : ticket **#11** demeure ouvert, **G2 PARTIAL**.
- **PR #8 DRAFT vers `dev` ; pas de fusion, tag ni release.**
