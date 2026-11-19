# Session d'implémentation — Design workflows SVG

**Date : 19 novembre 2026**  
**Branche : `dev` ; `main` non modifiée**  
**SHA de code candidat au moment de la rédaction : `48f4b7b7544b9effa93c51e6e1f63a1a8f2a3550`**

## Modifications réellement poussées

- Correction du cycle de vie du journal de récupération lors d'une sauvegarde
  réussie : annulation des timers en attente et synchronisation de la référence
  documentaire pour limiter la réapparition d'un brouillon sauvegardé.
- Raccourci `Ctrl+S`/`Cmd+S` pour sauver exclusivement le document actif via
  le Host, même si l'éditeur de source possède le focus.
- Déplacement d'arrêts de dégradé adjacents par patches XML natifs exacts,
  avec limites et refus typés, Undo transactionnel.
- Avertissement visible lorsqu'un dégradé est référencé directement par plusieurs
  formes. Les références indirectes ne sont pas complètement analysées.
- Lissage et symétrisation des tangentes à une jonction de deux commandes
  cubiques explicites `C`, par patch des coordonnées de la poignée sortante.
- Copie/application des attributs d'apparence SVG explicites entre deux
  formes du même document/workspace : remplissage, contour, opacités, etc.
  Refus des styles/CSS ambigus, groupes verrouillés, références inconnues.
  Correction de l'espacement natif lors d'insertion d'attributs.
- Rotation relative à angle numérique précis et mise à l'échelle uniforme en
  pourcentage, au pivot réel de la forme, via le moteur matriciel existant.
- Tests module et navigateur pour les nouveaux workflows ; registre de specs
  mis à jour.

## Contrats et limitations

Voir :
- [ADR-036](../adr/ADR-036-NATIVE-GRADIENT-CREATION.md)
- [ADR-037](../adr/ADR-037-GRADIENT-STOP-ORDER-AND-KEYBOARD-SAVE.md)
- [ADR-038](../adr/ADR-038-CUBIC-TANGENT-EDITING.md)
- [ADR-039](../adr/ADR-039-NATIVE-APPEARANCE-TRANSFER.md)

Aucun outil n'est présenté comme équivalent à l'intégralité de Figma,
Penpot, HyCanva ou Affinity Designer. Les fonctionnalités au-delà de la
grammaire SVG explicitement prise en charge sont refusées plutôt que
converties destructivement.

## Preuves CI — provenance stricte

Sur le SHA `48f4b7b7544b9effa93c51e6e1f63a1a8f2a3550` :
- Core Ubuntu : PASS observé dans le workflow GitHub Actions
  [44427145400](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/44427145400).
- Core Windows : PASS observé dans ce même workflow.
- Navigateur Chromium/Firefox : **IN_PROGRESS au dernier contrôle**, pas
  encore de PASS attesté pour l'ensemble des derniers changements.
- Intégration dans le DSH Web/Desktop réel sur ce SHA : **NOT_RUN**.
- Le défaut précédent `tests/svg-appearance.test.mjs` (espace natif inséré
  en double) a motivé `6fc49fa` ; aucune réussite sur le dernier SHA n'était
  attestée pour le gate navigateur au moment de rédiger cette note.

Ne pas convertir une CI intermédiaire verte, un NOT_RUN ou un run annulé
en preuve pour le SHA final.

## Travaux majeurs toujours ouverts

1. Repasser le gate navigateur complet sur le SHA final, résoudre tous les FAIL.
2. Réexécuter dans un profil DSH Web et Desktop réellement isolé et capturer
   les preuves de chargement, édition, sauvegarde, Undo, fermeture/réouverture.
3. Réaliser une revue UI/UX Graphite approfondie dans la vraie fenêtre DSH,
   notamment densité de l'inspecteur, taille des contrôles, tactile et clavier.
4. Renforcer la couverture SVG : tangentes interactives à la souris, chemins
   relatifs, masques, filtres, opérations booléennes, géométrie de dégradé
   directement sur canevas, partage/détachement des styles et composants.
5. Renforcer HTML/CSS : cascade, styles calculés, héritage, règles et media
   queries complexes, flux responsive et composants web réels.
6. Développer des outils agentiques contrôlés et des propositions de patches
   avec validation utilisateur et provenance.
7. Mesurer performances réelles, accessibilité (lecteurs d'écran), packaging
   et rollback, avec revue indépendante.

**Décision : NO-GO production tant que les gates restent ouverts.**
Aucun merge `main`, tag, publication ou release n'a été réalisé.
