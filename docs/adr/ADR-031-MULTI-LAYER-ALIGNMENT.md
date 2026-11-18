# ADR-031 — Aligner plusieurs calques en une seule écriture

**Statut :** accepté · **Date :** 18 novembre 2026 · **Branche :** `dev` ·
**Concerne :** `client.js` (sélection multiple, plans d'alignement, contrôles)

## Contexte

La sélection multiple existe depuis longtemps (Ctrl-clic) et sert à grouper, mais
aucune commande ne l'utilisait pour **positionner** plusieurs calques les uns par
rapport aux autres. Aligner à gauche deux rectangles demandait de calculer mentalement
les écarts et de corriger chaque `x` un par un ; c'est une des opérations les plus
courantes d'un outil de design et son absence se sent immédiatement.

Le piège n'est pas le calcul, c'est le **nombre d'écritures** : six boutons qui
enverraient six patches produiraient six pas d'Undo pour un seul geste. Et sur un
calque transformé, écrire un `x` sans revenir en coordonnées locales déplacerait la
forme à côté.

## Décision

### 1. Une seule écriture, un seul Undo

Un alignement est un **unique** `save({kind:'svg-attributes', edits})`. Le Host
applique la liste en un `store.apply` atomique : même précondition de révision, même
inverse exact, **un** pas d'Undo. Aucune route nouvelle, aucun patch composé côté
client.

La borne de 16 éditions est celle du Host : au-delà, le bouton est désactivé avec
sa raison, et l'opération est refusée avant toute requête.

### 2. Les coordonnées viennent de la géométrie déjà utilisée par le glisser

Les bords manipulés sont les AABB en espace planche (`handle.x/y/width/height`), et
le retour aux coordonnées locales passe par l'inverse de la matrice parente
(`move.inverse`) — exactement la même source de vérité que le déplacement au
pointeur (ADR-030). Un alignement horizontal n'écrit **que** `x`, un vertical
**que** `y` : jamais `width`/`height`, jamais deux attributs à la fois.

Sur un groupe `translate(100,20) scale(2)`, amener le bord gauche visible à 30
écrit `x = -35` — vérifié octet par octet dans le gate navigateur.

### 3. Le refus est la réponse par défaut

Refusés **avant toute requête**, avec la raison visible sur le contrôle désactivé :

- sélection de moins de deux calques, ou de plus de seize ;
- document non-SVG, document occupé, état incertain, brouillon de source ou de texte ;
- calque verrouillé, y compris via un **ancêtre nommé** ;
- contenu référencé en lecture seule, calque sans `id` ;
- géométrie absente ou inverse non calculable ;
- `circle`/`ellipse` (position en `cx`/`cy` : aucune conversion de forme) ;
- rotation ou pivot rendant un déplacement mono-axe non horizontal/vertical ;
- texte : alignement vertical (ligne de base), ou `text-anchor` non explicite.

Une rotation de 90° garde une matrice inversible mais annule le facteur d'axe : ce
cas est classé comme « axe non représentable », **pas** comme « géométrie non
inversible » — le message doit nommer la vraie cause.

### 4. Rien à faire, rien à écrire

Les calques déjà sur la cible sont ignorés. Si aucun `edit` ne subsiste, aucune
requête n'est envoyée et l'interface dit « Déjà aligné ». Un succès reste visible :
la confirmation n'est jamais écrasée par les raisons des modes qui, eux, restent
indisponibles.

### 5. La sélection survit au geste

Le vidage de la sélection multiple n'a lieu qu'au **changement de document**, pas
après un enregistrement du même fichier : les six modes peuvent s'enchaîner sans
re-sélectionner.

### 6. Le geste de déplacement reste robuste

Le glisser-déposer (ADR-030) a été durci au passage : la gestuelle est portée par
des écouteurs `window` (une ligne de calque peut être re-rendue entre l'appui et le
premier mouvement, ce qui détruisait la capture), ces écouteurs sont retirés sur
`pointerup`, `pointercancel`, `Échap`, perte de focus, changement de visibilité **et
démontage**, et un relâchement sans mouvement intermédiaire est jugé sur la
distance réelle pour ne pas perdre un geste rapide. Un clic sans mouvement reste un
clic.

## Ce que cette décision ne fait pas

- **Aucune distribution** (espacement égal) : elle demande une répartition continue
  qui n'est pas la même primitive, et se décidera séparément.
- Aucune conversion de forme : un `circle` n'est pas réécrit en `rect` pour être
  alignable.
- Aucune coordonnée calculée à partir d'un style, d'une cascade ou d'une police :
  l'alignement du texte reste limité aux cas dont l'ancre est explicite.
- Aucune détection du verrou porté par un **groupe anonyme** : les métadonnées ne
  listent que les ancêtres nommés. Le Host refuse alors l'écriture (`locked`) sans
  toucher au fichier — l'interface peut donc proposer un bouton qui échouera
  proprement. Ce cas est marginal parce que l'interface ne crée que des groupes
  nommés.
- Aucun alignement sur un autre repère que la boîte englobante de la sélection
  (pas de « premier calque comme référence »).

## Alternatives rejetées

| Alternative | Pourquoi non |
|---|---|
| Six patches, un par calque | Six pas d'Undo pour un geste, et un état intermédiaire incohérent si le troisième échoue. |
| Écrire `x` sans repasser en coordonnées locales | Déplace la forme à côté dès qu'un ancêtre porte un `translate`/`scale`. |
| Convertir `circle`/`ellipse` en `rect` pour aligner | Conversion destructive de la géométrie, refusée par ADR-0001. |
| Aligner en réécrivant `transform` | Un attribut synthétique qui remplace la géométrie authored est plus difficile à relire et à annuler proprement. |
| Estimer la boîte du texte par la police | Mensonge silencieux : la ligne de base et les métriques de police ne sont pas disponibles ici. |

## Preuves

| Niveau | Commande | Résultat |
|---|---|---|
| 1 | `npm run check` | **531 PASS / 0 FAIL / 0 SKIP**, code 0 |
| 2 | `npm run test:browser` | **136 PASS / 0 FAIL / 0 NOT_RUN** (68 specs × Chromium 145.0.7632.6 + Firefox 146.0.1), exécuté **deux fois de suite**, rapport versionné |
| 2 | specs `align:` ciblées | 3 specs : succès/Undo (**57 assertions**), refus multiples (**80 assertions**), verrou d'ancêtre nommé (4 assertions) ; une seule requête par geste, zéro requête pour un refus ou un calque déjà aligné |
| 3 | `npm run test:dsh` | **NOT_RUN** pour l'alignement |

CI du commit `26b4989` : [run 44327336416](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/44327336416)
**entièrement vert** (Ubuntu, navigateurs, Windows, benchmark).

Revue indépendante : un passage, deux fuites d'écouteurs réelles (`Échap`, démontage),
une sélection incohérente sur geste rapide, un message de refus faux sur rotation
90°/270° et une confirmation de succès masquée par les raisons. Les cinq points sont
corrigés ; le verrou d'ancêtre anonyme et le `text-anchor` hérité restent documentés
comme limites.

**Gate G3/G4 : PARTIAL.** L'alignement est prouvé au pointeur et au clavier dans
deux moteurs sur une coquille DSH simulée ; pas encore dans le vrai DSH, ni au
tactile, ni avec un lecteur d'écran.
