# ADR-037 — Contrôles professionnels : ordre des arrêts et sauvegarde clavier

**Statut : implémenté sur `dev`, validation réelle DSH Desktop NOT_RUN**  
**Date : 19 novembre 2026**

## Décision

L'inspecteur de dégradés SVG dispose maintenant de boutons « Monter » et
« Descendre » un arrêt d'une position. Une opération
`svg-gradient-stop-move` est une **seule transaction Host** composée de
deux patches non chevauchants sur les éléments `<stop>` concernés.
Leur balisage XML original et les autres octets du document sont préservés ;
l'Undo inverse les deux patches. Les déplacements hors limites sont désactivés
en UI et refusés dans le moteur.

Les commentaires, éléments inconnus ou textes intermédiaires entre les
deux arrêts provoquent un refus typé `ambiguous-content`, afin de ne pas
dissocier silencieusement un commentaire de son arrêt. Les dégradés hérités,
avec feuilles de style ou ambiguïtés structurelles conservent leurs refus.

Le panneau affiche un avertissement si le dégradé est directement référencé par
plusieurs éléments nommés, puisque toute modification partagée affecte les
formes qui utilisent ce dégradé. Cette liste ne résout pas toutes les
références SVG indirectes et ne doit pas être présentée comme exhaustive.

`Ctrl+S` / `Cmd+S` depuis le workbench (y compris dans la zone source)
appelle **la sauvegarde transactionnelle existante** du document actif,
jamais une écriture directe. Il ne sauvegarde pas silencieusement un autre
onglet. Les états `busy` et `reloadRequired` restent bloquants.

Un correctif de récupération annule un timer de journal en attente lors
de la réussite d'une sauvegarde, et met à jour la référence du document
courant pour éviter une résurrection du brouillon au rechargement. Les
brouillons réellement divergents pendant l'opération restent conservés
par le chemin de sauvegarde distinct.

## Vérification

Tests unitaires : `tests/svg-gradient.test.mjs`.
Tests navigateur : `tests/browser/specs/gradient.mjs`,
`tests/browser/specs/tabs.mjs` et `tests/browser/specs/recovery.mjs`.

Le statut CI doit être contrôlé sur le SHA exact de la branche `dev` ;
une ancienne CI verte ou un test interrompu ne suffit pas. Pour cette
nouvelle tranche, installation et essai dans le vrai DSH Desktop
**NOT_RUN** tant qu'ils n'ont pas été réexécutés.

## Limitations

Cette tranche ne fournit ni un éditeur de dégradé interactif sur le
canevas, ni les masques/filtres/opérations booléennes d'un éditeur
vectoriel complet. La parité Figma, Penpot ou Affinity Designer n'est
pas revendiquée.
