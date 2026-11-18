# ADR-034 — Onglets de documents dans le workbench

**Statut :** accepté · **Date :** 18 novembre 2026 · **Branche :** `dev` ·
**Concerne :** `client.js` (état par onglet, bande d'onglets, `load()`,
`manageFile()`), `tests/client-tabs.test.mjs`,
`tests/browser/specs/tabs.mjs`

## Contexte

Le workbench n'ouvrait qu'**un seul document à la fois**. `load()` refusait même
un second fichier dès que la source ou un brouillon de texte était modifié
(`Unsaved source changes: save or discard them before opening another file`) :
la seule façon de passer d'un fichier à l'autre était d'enregistrer ou de jeter
son travail. Un éditeur qui oblige à abandonner un brouillon pour consulter un
autre fichier n'est pas utilisable au quotidien, et ce n'était pas un défaut de
bouton mais l'absence d'un modèle d'état : `doc`, `source`, `nodes`, la
sélection, l'historique Undo/Redo et le brouillon de texte vivaient dans un
unique jeu de variables React.

## Décision

### 1. Un onglet possède explicitement tout l'état du document

`captureTabState()` énumère **tout** ce qui appartient à un document : `doc`
(source chargée), `source` éditée, `nodes`, `gradients`, les surfaces
d'inspecteur (`htmlElements`, `htmlActive`, `htmlStylesheets`, `cssRules`,
`cssMedia`, `cssActive`, `htmlActive`, `textNodes`, `pathNodes`, `geometry`,
`artboardMeta`, …), la sélection (`active`, `extraSelection`, `renaming`), le
brouillon (`editingText`, `textDraft`), la caméra, `undoStack`, `redoStack`,
`reloadRequired`, `warning` et la plume en cours. `emptyTabState()` fournit le
même ensemble à l'état neutre ; `applyTabState()` l'installe.

Une omission dans cette liste ferait fuiter l'inspecteur d'un document dans un
autre : c'est pourquoi la liste est exhaustive et non « les champs qui semblent
importants ». Les préférences globales (grille, magnétisme, mode aperçu,
presse-papiers, panneau mobile) restent **hors** de l'onglet, ainsi que l'état
transitoire d'un geste (poignée, plume non validée, drag) qui est **abandonné**
au changement d'onglet — un geste ne doit jamais survivre avec la révision d'un
autre fichier.

### 2. L'onglet actif EST l'état React vivant

Aucune duplication de `doc`/`source` : pendant qu'un onglet est actif, les
variables React existantes en sont l'unique copie. Le bundle de l'onglet n'est
écrit que **lorsqu'on le quitte** (`activateTab`, `openInTab`) et son indicateur
« modifié » est calculé en direct pour l'onglet actif. Conséquence : aucune
fenêtre où deux copies de la source pourraient diverger, et aucun besoin de
relire un état asynchrone après un `await`.

Changer d'onglet est une opération **de rendu pure** : aucun `/document`,
aucun `/apply`.

### 3. Ouvrir un fichier ouvre un onglet, jamais un écrasement

`openInTab(file)` active l'onglet qui montre déjà ce chemin, sinon crée un
onglet et lit le document (`/document` seulement). Le refus historique
d'ouverture avec modifications non enregistrées disparaît : il n'a plus de
raison d'être puisque l'état quitté est conservé. La limite est **8 onglets**,
refusée avant toute lecture (ou avant toute écriture pour une création) avec un
message qui nomme la limite, plutôt qu'une croissance mémoire non bornée.

### 4. Aucune écriture implicite

Changer d'onglet, fermer un onglet, ouvrir un fichier dans un onglet : aucune
requête `/apply`. Seule une action explicite (`Save source`, inspecteur, outil
du canevas, Undo/Redo) enregistre, et elle vise **toujours** `doc.file` de
l'onglet actif — la révision ouverte, avec les contrôles existants (`busy`,
`reloadRequired`, révision périmée, conflit externe).

### 5. Fermer un onglet modifié est une question

`closeTab()` ne ferme jamais un onglet dont la source diffère du disque ou dont
un brouillon de texte existe : il affiche une confirmation (`role="alertdialog"`)
qui nomme le chemin exact, avec `Fermer sans enregistrer` et `Annuler`.
Refuser laisse l'onglet, son état et les octets intacts. Fermer est également
une opération sans écriture.

### 6. Un fichier renommé/supprimé garde ses onglets cohérents

`manageFile()` raisonne désormais sur l'onglet qui possède le fichier, pas
seulement sur le document actif :

- un onglet (actif **ou** en arrière-plan) avec des modifications non
  enregistrées refuse le renommage/suppression avec le chemin concerné ;
- renommer l'onglet actif recharge le nouveau chemin ; renommer un onglet en
  arrière-plan met à jour son chemin et le marque `stale`, pour qu'à
  l'activation sa révision (`hash`/`identity`) soit relue avant toute édition ;
- supprimer le fichier de l'onglet actif active son voisin ; supprimer le
  fichier d'un onglet en arrière-plan ferme uniquement cet onglet.

Le renommage lui-même reste `link()`+`unlink()` (ADR-027) : rien n'est réécrit
et aucune destination occupée n'est remplacée.

### 7. Accessibilité de la bande d'onglets

`role="tablist"` nommé « Documents ouverts », `role="tab"` par document avec
`aria-selected` réel, `aria-controls` vers le panneau unique
(`role="tabpanel"`), `aria-label` explicite (chemin + « modifications non
enregistrées »), point de modification `aria-hidden`, bouton de fermeture nommé
`Fermer <chemin>`, tabindex mobile (`0` pour l'onglet actif, `-1` sinon),
flèches ←/→, `Home`/`End` pour déplacer le focus, `Entrée`/`Espace` pour
activer. Les flèches sont **stoppées** dans la bande : elles ne peuvent pas
déclencher le déplacement du calque sélectionné par le raccourci global.

## Preuves exécutées

| Niveau | Preuve | Résultat |
|---|---|---|
| 1 — `npm run check` | suite complète, dont `tests/client-tabs.test.mjs` (7 tests) et `tests/client-file-picker.test.mjs` mis à jour | **591/591 PASS / 0 FAIL** |
| 2 — navigateur réel | `--grep=tab:` : 4 specs × Chromium 145.0.7632.6 + Firefox 146.0.1 | **8 PASS / 0 FAIL**, 48 vérifications par moteur |
| 2 — non-régression ciblée | 43 des 93 specs : `tab:` 8 PASS, `html:` 14, `css:` 8, `geometry:` 4, `graphite:` 16, `responsive:` 2, `performance:` 2, `a11y:` 8, `landing:` 4, `create:` 8, `files:` 6, `conflict:` 4, `safety:` 2 (tous × 2 moteurs) | **86 PASS / 0 FAIL** (325 vérifications par moteur) |
| 3 — DSH réel / Desktop | non ré-exécuté pour cette tranche | **NOT_RUN** |

La suite navigateur **complète** (93 specs) n'a pas été réexécutée pour cette
tranche : seules les portées ci-dessus l'ont été (43 specs). Un `NOT_RUN` n'est
pas un succès, et le niveau 2 ne remplace pas le niveau 3.

La spec `responsive:` a trouvé une **régression réelle** introduite par la bande
de 34 px (les boutons de largeur d'aperçu HTML glissaient sous l'en-tête de
scène et devenaient inaccessibles au pointeur) ; l'aperçu HTML est désormais
ancré en haut et défilable, et la spec repasse. C'est le seul défaut détecté par
cette campagne ciblée.

## Garanties

- changer d'onglet, en ouvrir un, en fermer un n'envoie aucun `/apply` ;
- la source éditée, la sélection, le brouillon de texte et Undo/Redo d'un onglet
  survivent à un aller-retour vers un autre onglet ;
- `save()` écrit **le fichier de l'onglet actif uniquement** (test dédié à deux
  onglets : l'autre fichier reste byte-identique) ;
- fermer un onglet modifié exige une confirmation nommant le fichier ; refuser
  ne change ni l'onglet ni les octets ;
- 8 onglets maximum, refus explicite au-delà, sans lecture ni écriture ;
- les préconditions de sauvegarde existantes sont inchangées (révision
  périmée, conflit externe, `busy`, `reloadRequired`) ;
- un fichier renommé/supprimé pendant que son onglet est en arrière-plan laisse
  un état cohérent (relecture de révision à l'activation, ou fermeture de
  l'onglet supprimé).

## Non-garanties (documentées, pas dissimulées)

- **La borne est un nombre d'onglets, pas un budget mémoire.** Chaque fichier
  peut peser jusqu'à 8 Mio (limite du store) et chaque entrée d'historique
  jusqu'à 2 Mio × 30 par onglet : le pire cas théorique reste de l'ordre de
  plusieurs centaines de Mio. Un budget octets par onglet n'existe pas encore.
- **Les onglets ne survivent pas** à un rechargement de page, à un changement
  d'espace de travail ni à un redémarrage : c'est un état de session en mémoire,
  pas une persistance (tranche 3.4 « journal de session » non faite).
- **Le dédoublonnage se fait sur le chemin exact** rendu par le Host : ouvrir
  `./a.svg` après `a.svg` peut créer un second onglet sur le même fichier (la
  révision périmée empêchera l'écrasement silencieux, mais c'est une friction).
- **Fermer un onglet modifié ne propose pas « Enregistrer »** dans la
  confirmation : il faut annuler, enregistrer, puis fermer.
- Pas de raccourci `Ctrl+Tab`, pas de réordonnancement d'onglets, pas de
  « tout enregistrer », pas de restauration après plantage.
- Le brouillon de texte est conservé et l'éditeur inline est restauré avec son
  onglet ; son `autoFocus` reprend le focus à l'activation, ce qui peut
  surprendre après un changement d'onglet.
- La bande occupe **34 px** de hauteur de canevas. L'aperçu HTML a été ancré en
  haut et rendu défilable pour ne pas glisser sous l'en-tête de scène : c'est une
  régression réelle trouvée par la spec `responsive:` (boutons de largeur
  d'aperçu devenus inaccessibles) et corrigée, pas un ajustement de test.
- En disposition compacte (≤ 750 px), la bande vit dans la colonne canevas :
  elle n'est pas visible quand le dock mobile affiche « Calques » ou
  « Propriétés ». Ce n'est pas une barre d'onglets globale.
- La confirmation de fermeture n'est pas un dialogue modal natif : c'est un
  bandeau `alertdialog` dans le flux, sans piège de focus ni restitution automatique du focus dans la bande après fermeture.
- Niveau 3 (`npm run test:dsh`, Desktop) : `NOT_RUN`.

## Alternatives rejetées

| Alternative | Pourquoi non |
|---|---|
| Refuser d'ouvrir un second fichier (comportement précédent) | Jette ou bloque le travail en cours : exactement le défaut à corriger. |
| Enregistrer automatiquement avant de changer d'onglet | Écriture implicite : interdit par la règle du produit, et impossible à annuler si l'utilisateur ne voulait pas enregistrer. |
| Garder les onglets dans `localStorage` | Le chemin, la révision et les brouillons seraient restaurés sans vérification d'identité ; rouvrir un onglet sur des octets différents est un conflit silencieux. La persistance exige un journal côté Host. |
| Un onglet sans borne | Gonfle la mémoire du renderer sans limite ; une borne explicite et annoncée est plus honnête. |
| Éditer plusieurs documents dans le même état React (un seul `source`, N `doc`) | Rend chaque garde (`source!==doc.source`) ambiguë et permet exactement l'écriture dans le mauvais fichier que la présente décision interdit. |
| Fermer sans confirmation avec un « annuler » après coup | Un onglet fermé a perdu sa source non enregistrée : une annulation ne la restaure pas, ce serait un mensonge d'interface (même raisonnement qu'ADR-027). |
