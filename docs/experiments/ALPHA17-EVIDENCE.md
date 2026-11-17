# DSH Design Studio — alpha.17 : sélection HTML par clic dans l'aperçu

**Date :** 17 novembre 2026. **Statut :** prototype expérimental sur `feat/native-file-persistence`. PR #8 toujours **DRAFT** vers `dev`; aucune release/tag/fusion.

## Preuves automatisées exécutées

- **SHA du code validé :** `eb29a9660ee5a4f33a4064994af645b227cfd884`.
- **GitHub Actions :** [run 43986355036](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43986355036).
- **Commande exécutée :** `npm run check`, Node.js 22 (vérification syntaxique + `node --test tests/*.test.mjs`).
- **Sortie vérifiée : 236 tests / 236 PASS / 0 FAIL / 0 SKIP**.
- Les nouveaux tests sont des **simulations d'événements DOM / React**, et les opérations d'édition existantes utilisent des fichiers temporaires et le vrai routeur Host. **Aucun navigateur réel ni installation DSH réelle validés.**

## Réalisation

La prévisualisation HTML/HTM (créée avec `srcDoc`) permet désormais **la sélection directe d'un élément en cliquant dessus**, sans appel à l'IA. Le parent React connecte un gestionnaire `click` au DOM chargé dans l'iframe, puis appelle la même sélection que celle de la liste latérale.

- Uniquement les éléments HTML ayant un **ID explicitement unique, mappé et éditable** dans le code source, à balise reconnue. Les doublons dans le DOM, IDs inconnus ou structures non mappées ne sont pas sélectionnés.
- Le parent compare le **document/fichier, l'identité de révision et la session**, et refuse le clic lorsque l'éditeur est occupé, en rechargement forcé ou lorsque le code source comporte un brouillon non enregistré.
- Les liens et contrôles ne réalisent pas leurs actions par défaut pendant l'inspection ; la sélection du DOM ne déclenche **aucune écriture**. Le vrai enregistrement passe toujours par `POST /design-studio-native/apply` et les préconditions de révision/identité.
- Un iframe navigué hors `about:srcdoc`, inaccessible ou qui ne permet plus un DOM fiable n'a pas de gestionnaire de sélection. Les anciens écouteurs sont retirés au rechargement du document / de la prévisualisation.
- L'aperçu affiche un contour sur le nœud sélectionné sans injecter cet effet dans le fichier HTML sauvegardé.
- Accessibilité alternative : les éléments restent sélectionnables depuis la **liste de gauche**, même en l'absence de gestion directe des clics.

## Modèle de sécurité expérimental (ADR-017)

- Le HTML utilise `sandbox="allow-same-origin"` **sans `allow-scripts`**, `allow-forms`, `allow-popups` ni navigation top-level.
- La CSP ajoute explicitement `script-src 'none'`, `object-src 'none'`, `connect-src 'none'`, `frame-src 'none'`, `form-action 'none'` et `base-uri 'none'`. Aucune requête LLM ; aucune insertion de scripts-ponts dans le contenu utilisateur.
- Le **parent DSH de confiance** lit le DOM rendu ; l'iframe ne peut pas exécuter le JavaScript du document utilisateur. Ce modèle évite un pont `postMessage` injecté, mais abandonne l'isolation d'origine opaque et **requiert une revue navigateur/sécurité indépendante avant acceptation de production**.
- **Interdiction critique :** ne jamais combiner `allow-same-origin` et `allow-scripts` sans nouvelle décision de sécurité et tests réels.
- ADR de détail : `docs/adr/ADR-017-HTML-PREVIEW-CLICK-SELECTION.md`. Le plan G2 a été ajusté en conséquence.

## Couverture et limites

### Tests exécutés

- Sélection d'un nœud enfant (remontée au parent à ID reconnu), conservation de la source et zéro POST.
- Refus d'ID inconnu, ID dupliqué dans le DOM, correspondance de balise incorrecte, document inaccessible/navigué, source locale non sauvegardée.
- Événements synthétiques `isTrusted=false`, accès DOM défaillant, et événements arrivant depuis une ancienne identité après une sauvegarde.
- Contrôle du CSP et du `sandbox` fournis au rendu client simulé.
- Régressions SVG, Plume, CSS externe, écriture native, Undo/Redo et concurrence interprocessus.

### Toujours non réalisés

- **NOT_RUN :** installation réelle DSH Desktop/Web, clic avec vrai pointeur dans Chromium/Firefox, tactile/mobile, clavier dans le contenu, tests d'iframe et CSP effectifs avec document hostile, validation visuelle.
- **NOT_IMPLEMENTED :** sélection d'éléments sans ID ou par sélecteurs complexes, mapping complet DOM↔source, éléments générés par JavaScript, shadow DOM, sélection multiéléments, édition de texte HTML et vraie liaison aux règles CSS du workspace.
- **SECURITY PARTIAL :** `allow-same-origin` peut rendre l'origine du contenu égale à celle de DSH ; le maintien du blocage de scripts est critique. Un audit XSS, frames, navigation, meta refresh, URLs et politique CSP est nécessaire.
- **P0 ouvert :** pas de CAS universel entre éditeurs non coopératifs ; la sécurité des fichiers et le test DSH réel restent à valider.

**Décision :** issue #10 partiellement satisfaite, G2 **PARTIAL** et G0 **NOT_RUN**. Aucune promotion production-ready. PR #8 reste DRAFT vers `dev`.
