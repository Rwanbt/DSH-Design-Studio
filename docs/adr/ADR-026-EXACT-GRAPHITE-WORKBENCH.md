# ADR-026 — Intégrer la maquette Graphite, pas une approximation du formulaire existant

**Statut : accepté par demande utilisateur explicite, implémentation en cours.** 17 novembre 2026.

## Demande et défaut observé

L'utilisateur demande l'intégration **complète** et **exacte** de la maquette HTML fournie dans le plugin DSH. Les passes précédentes ne satisfaisaient pas cette demande : mêmes largeurs de colonnes, mais ancien formulaire de fichier et barres techniques toujours visibles, structure d'inspecteur différente, contenu vide sans document et icônes approximatives. Les tests d'édition natifs verts ne prouvaient pas la fidélité visuelle.

Référence canonique : [HTML Graphite V3](../design/DSH-Design-Studio-V3-Graphite-interactive.html), identique au fichier désigné dans le dossier Téléchargements de l'utilisateur lors de cette session. Ce fichier reste conservé, non réécrit pour faire correspondre les tests au plugin.

## Décision

- Intégrer sa structure et son vocabulaire visuel dans le composant React natif existant : barre supérieure, vraie bande d'outils à icônes SVG, rail, explorateur, scène, inspecteur contextuel, barre inférieure.
- Réutiliser les tracés SVG et les règles de la référence avec un **scoping explicite**. Pas de remplacement automatique par regex d'une feuille CSS ajoutée après une autre feuille contradictoire.
- Conserver cette coquille aussi sans document, avec ouverture/création dans la scène ; ne plus présenter une page d'administration à la place de l'éditeur.
- Relier les commandes aux opérations existantes du Host, leurs préconditions de révision, leur sauvegarde sur disque et Undo/Redo. Une capture de la maquette ou une iframe autonome de la maquette n'est **pas** une intégration.
- Garder les sections non prises en charge visuellement présentes mais leurs actions désactivées et expliquées. Ni faux effet appliqué, ni sauvegarde seulement en mémoire présentée comme un succès disque.
- Rendre l'illustration de référence accessible comme **document SVG natif** à créer explicitement. Aucun fichier utilisateur n'est écrit automatiquement ; un nom occupé reste refusé.

## Révision ciblée d'ADR-023 : palette locale

La demande explicite d'exactitude Graphite remplace l'obligation antérieure de faire suivre les surfaces internes de l'éditeur au thème clair/sombre de DSH. Le thème clair de l'hôte rendait auparavant l'éditeur blanc, contrairement à la référence fournie.

La palette Graphite est **strictement locale au workbench**. Elle ne doit modifier ni `:root`, ni `html`, ni `body`, ni les composants des autres plugins, ni les tokens de l'hôte sur le document racine. Les surfaces autour du workbench restent pilotées par DSH. Cette décision ne transforme pas le plugin en application indépendante : mêmes slots DSH, même React fourni par l'hôte, mêmes routes relatives et même stockage natif.

La spec thème doit maintenant prouver les deux sens de l'isolation : modifier les tokens de DSH ne blanchit pas l'éditeur Graphite ; monter l'éditeur ne recolore pas l'hôte.

## Preuves requises

1. Niveau 1 : tests source/Host/CAS existants conservés ; illustration extraite de la référence comparée octet-pour-octet après la seule conversion `data-id` → `id` nécessaire pour l'édition native.
2. Niveau 2 : tests d'édition existants et nouveaux parcours depuis la coquille. Comparaison **contre le HTML de référence chargé par le navigateur** à taille égale : régions, dimensions, vrais tracés SVG, sections d'inspecteur. Captures et relevés séparés, aucune affirmation d'égalité de pixels sur tout l'écran si elle n'est pas mesurée.
3. Niveau 3 : livraison dans DSH réelle vérifiée séparément. Ne jamais présenter le shell de test comme une preuve de ce que l'utilisateur voit dans sa fenêtre.

## Sécurité et limites non modifiées

Le HTML/SVG utilisateur reste dans l'aperçu inerte existant ; aucune autorisation de scripts ajoutée. Les gradients, filtres et attributs inconnus du document natif sont conservés, jamais remplacés par une couleur par défaut pour remplir un champ. La géométrie des ellipses doit présenter les limites X/Y/W/H annoncées, pas des centres/rayons déguisés.

## État de la preuve après implémentation

| Niveau | Preuve | Résultat |
|---|---|---|
| 1 | `npm run check` (dont `tests/graphite-reference.test.mjs`, `tests/shape-placement.test.mjs`, `tests/svg-appearance-defaults.test.mjs`) | **451/451 PASS** |
| 2 | `tests/browser/specs/graphite-reference.mjs` compare le DOM réel au HTML fourni chargé dans le même navigateur : hauteurs/largeurs de régions, teinte exacte de chaque surface, nombre de positions du rail, tracés SVG des outils, présence des sections | **PASS** sur Chromium et Firefox ; captures et relevés JSON dans `tests/browser/__reports__/graphite/` |
| 3 | `npm run test:dsh` | **NOT_RUN** dans cette session |

Ce qui reste explicitement non prouvé : l'égalité pixel à pixel de l'écran entier (seules les régions listées sont comparées), le rendu de cette coquille dans la fenêtre DSH réellement ouverte (niveau 3), et les interactions tactiles.

## Défauts trouvés par la revue et corrigés

- un brouillon de texte pouvait disparaître silencieusement lors d'une sauvegarde de propriété, d'un changement de calque ou d'une création ;
- une création pouvait écrire un fichier **avant** de refuser de l'ouvrir à cause d'un brouillon source ;
- un échec de listage des fichiers était présenté comme un espace de travail vide ;
- quatre contrôles partageaient un nom accessible (deux boutons identiques), ce qui casse l'accessibilité et rendait les tests ambigus ;
- l'opacité et la déclaration d'attributs typographiques absents sont désormais de vrais insertions réversibles, pas un affichage trompeur.

