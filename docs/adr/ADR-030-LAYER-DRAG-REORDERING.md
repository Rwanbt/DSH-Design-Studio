# ADR-030 — Réordonner les calques par glisser-déposer, sans nouveau pouvoir

**Statut :** accepté · **Date :** 18 novembre 2026 · **Branche :** `dev` ·
**Concerne :** `client.js` (geste), `src/svg-order.mjs` (inchangé)

## Contexte

En SVG, l'ordre du document **est** l'ordre de peinture. Le workbench savait déjà
le changer par le menu contextuel et par `Ctrl+]` / `Ctrl+[`, mais pas au
glisser-déposer : dans un outil de design, réordonner se fait d'abord à la
souris. L'absence de ce geste était une friction quotidienne, pas un manque
théorique.

Le risque de cette tranche n'est pas d'écrire : c'est d'ajouter un **chemin
d'écriture parallèle**. Un geste de souris qui composerait ses propres patches
contournerait la révision, l'inverse exact et l'Undo.

## Décision

### 1. Le geste ne possède aucune écriture

Un dépôt appelle **exactement** `reorderLayer(direction, id)`, donc
`save({kind:'svg-order', …})` — la même route, le même patch, la même
précondition de révision et le même Undo que le menu et le clavier. Aucun
`before`/`after` n'est calculé côté client. La conséquence heureuse : **un dépôt
= un patch atomique = un seul pas d'Undo**.

### 2. La ligne est sa propre poignée

Pas de DnD HTML5 ni de `dataTransfer` (peu déterministe et non testable de façon
fiable dans les deux moteurs). Gestes pointeur réels : seuil de 4 px pour
distinguer un clic d'un glissement, capture du pointeur, ligne sous le curseur
résolue par `elementFromPoint`. Un glyphe discret `⠿` (`aria-hidden`) signale
l'affordance au survol et au focus, sans ajouter d'arrêt de tabulation.

### 3. Seul un frère **adjacent** est surligné comme cible

`svg-order` n'expose que « un plan en avant », « un plan en arrière » et les deux
extrémités : il n'y a pas d'« insérer à l'index N ». Seul un **frère voisin** est
donc surligné comme cible, parce que c'est la destination réelle.

Déposer sur une ligne plus lointaine **n'est plus refusé** : le calque avance ou
recule d'**un seul plan, vers cette ligne**. Le refus précédent perdait un geste
parfaitement lisible et devenait fragile dès que la liste défilait pendant le
glisser (le relâchement ne tombait plus sur la ligne voisine). Le statut dit ce
qui se passe (« avancer d'un plan »), et un dépôt reste un patch atomique, donc
un seul Undo.

### 4. Les refus sont explicites et n'écrivent rien

Sont refusés, sans aucune requête : dépôt sur soi-même (simple accusé), frère non
adjacent, parents différents (le patch ne déplace qu'entre frères réels), parent
anonyme non identifiable, racine `<svg>`, contenu `readOnly`, calque verrouillé ou
dont un ancêtre est verrouillé, document occupé (`busy`), état incertain
(`reloadRequired`), brouillon de source ou brouillon de texte.

Un `<svg>` **imbriqué** (par exemple `<svg id="icone">` dans un groupe) n'est pas
la racine : il reste un frère ordinaire et se réordonne. Seul `depth === 0` est
la racine.

### 5. Aucune perte de focus ni de sélection

Le clic synthétique qui suit un dépôt est neutralisé : la sélection reste sur la
ligne **déplacée**, jamais sur la cible. Ce drapeau n'est armé que si un vrai
glissement a eu lieu, et il est remis à zéro sur `pointerdown` suivant, `blur` de
la fenêtre et `visibilitychange` — un geste interrompu hors fenêtre ne laisse ni
aperçu collé ni clic avalé.

### 5 bis. Durcissement après revue (18 novembre 2026)

Le geste est désormais porté par des écouteurs `window` plutôt que par la capture
du pointeur sur la ligne : sélectionner la ligne au premier mouvement la re-rend,
et une capture perdue faisait échouer le dépôt de façon intermittente. Ces
écouteurs sont retirés sur `pointerup`, `pointercancel`, `Échap`, perte de focus,
changement de visibilité et démontage du composant. Un relâchement sans mouvement
intermédiaire est jugé sur la distance réelle (un geste rapide reste un geste), et
la sélection suit la ligne déplacée dans ce cas aussi.

### 5 ter. Cible de dépôt : dernier frère survolé, pas la ligne sous le relâchement

Sélectionner la ligne déplacée peut faire défiler la liste, donc la ligne sous le
curseur au moment du relâchement n'est pas forcément celle que l'utilisateur
visait. Un run complet l'a montré de façon reproductible : le dépôt était refusé
(« Déposez sur le calque voisin ») alors que le geste était correct.

Le dépôt essaie donc **la ligne sous le relâchement, puis la dernière ligne
réellement survolée**, et retient le premier plan valide. Si aucun ne l'est, le
motif affiché reste celui de la ligne sous le relâchement : le refus n'est pas
atténué, il est seulement cherché au bon endroit.

### 6. Le clavier reste le chemin de référence

`Ctrl+]`, `Ctrl+[`, `Ctrl+Maj+]`, `Ctrl+Maj+[` et les entrées du menu restent
actifs et testés. Le glisser-déposer est un confort, pas une condition d'accès.

## Ce que cette décision ne fait pas

- Aucun déplacement **entre parents** (pas de re-parentage) : ni par geste, ni
  par menu, ni par raccourci.
- Aucun dépôt à une position arbitraire ; les sauts de plusieurs plans restent
  explicites (répétition de `Ctrl+]` ou entrées « premier/arrière-plan »).
- Aucun réordonnancement des éléments non-`id`, des nœuds de `defs` ou du contenu
  référencé en lecture seule.
- Le formatage induit par `svg-order` lors d'un déplacement vers l'extrémité
  (ré-indentation du bloc déplacé) reste inchangé : l'ordre et les octets du
  calque sont exacts, l'Undo restaure tout.
- Tactile réel, lecteur d'écran et Desktop : **NOT_RUN**.

## Alternatives rejetées

| Alternative | Pourquoi non |
|---|---|
| DnD HTML5 (`draggable`, `dataTransfer`, `dragover`) | Comportement divergent entre moteurs, drop zones fantômes, impossible à rendre déterministe dans le gate navigateur. |
| Calculer le patch côté client pour « aller à la position N » | Second chemin d'écriture, hors précondition de révision et hors inverse exact : exactement ce que l'architecture interdit. |
| Boucler plusieurs `save` pour simuler un saut | N écritures non atomiques et N pas d'Undo pour un seul geste. |
| Autoriser n'importe quel frère comme cible | L'aperçu aurait désigné une position que `svg-order` ne sait pas atteindre. |
| Faire du glisser-déposer l'unique moyen de réordonner | Exclut le clavier et les technologies d'assistance. |

## Preuves

| Niveau | Commande | Résultat |
|---|---|---|
| 1 | `npm run check` | **531 PASS / 0 FAIL / 0 SKIP**, code 0 |
| 2 | `npm run test:browser -- --json=tests/browser/__reports__/browser-report.json` | **130 PASS / 0 FAIL / 0 NOT_RUN** (65 specs × Chromium 145.0.7632.6 + Firefox 146.0.1), rapport versionné |
| 2 | spec `drag:` ciblé | **51 assertions par moteur** : ordre réel des octets après dépôt, tranches intactes, **0 POST** au survol et pendant le geste, exactement 1 écriture au dépôt, Undo octet-exact, dépôt sur soi-même sans écriture, frère non adjacent refusé, `Échap` sans écriture, parents différents refusés, verrouillé et racine refusés, déplacement **backward** réel, sélection conservée sur la ligne déplacée, clavier non régressé, brouillon de texte préservé |
| 3 | `npm run test:dsh` | **NOT_RUN** pour ce geste : le parcours DSH réel ne couvre pas encore le glisser-déposer |

CI du commit `221fbe1` : [run 44310764932](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/44310764932)
**entièrement vert** (Ubuntu, navigateurs, Windows).

Revue indépendante : un passage, un défaut modéré (tout `<svg>` refusé comme
racine alors que seul `depth === 0` l'est), deux défauts faibles (drapeau de clic
armé sans glissement réel, aucun nettoyage sur perte de focus) et une promesse
d'affordance trop large (cible lointaine). Les quatre sont corrigés ; les tests
couvrent désormais le sens backward, `Échap`, le frère non adjacent et la
sélection après dépôt.

**Gate G4 : PARTIAL.** Le geste est prouvé au pointeur réel dans deux moteurs,
pas au doigt sur appareil, ni avec un lecteur d'écran, ni dans DSH Desktop.
