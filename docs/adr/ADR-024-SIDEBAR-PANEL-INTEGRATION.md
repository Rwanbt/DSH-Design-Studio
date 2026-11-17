# ADR-024 — Entrée dans la barre latérale : Design Studio devient un panneau DSH

**Statut :** accepté · **Date :** 17 novembre 2026 · **Concerne :** `client.js`, `src/plugin-host.mjs`

## Décision

Design Studio doit être atteignable là où l'utilisateur cherche un plugin : la **barre latérale**, comme `dsh-taskboard` et `dsh-agent-board`. Cela impose de devenir un **panneau DSH** en plus de la vue de conversation, et donc d'ajouter une surface Host **cadrée par espace de travail**.

La vue de conversation (`conversation.view`) reste : elle est la bonne place pour éditer « le fichier de cette conversation ». Le panneau est la bonne place pour « ouvrir l'éditeur sans être dans une conversation ».

## Ce que DSH impose (vérifié sur l'instance réelle, DSH 0.2.2-rc.3)

| Contrat | Observation |
|---|---|
| Bouton de barre latérale | slot `sidebar.panellist` (liste, `replaceRisk: none`), props `{ size, active }` ; **« Each list id addresses the matching main panel »** |
| Contenu du panneau | slot `main` (keyed) — occupants existants : `conversation`, `plugins`, `schedules`, `dsh-taskboard`, `dsh-agent-board` |
| Session dans un panneau | **« The reserved `conversation` key hosts the Conversation ; other keys receive no Session binding. »** — un panneau `main` **n'a pas de `sessionId`** |
| Sélection du panneau | service client `layout.selectPanel(panelId)` |
| Résolution d'un chemin | `ctx.workspaceRegistry.get(id)` → `Workspace` (seul résolveur validé : le client envoie un **id**, jamais un chemin) |

Conséquence : le panneau ne peut pas réutiliser nos routes actuelles, qui exigent `sessionId` (`ctx.agents.get(sessionId)` puis `ctx.workingDirectory.ensure(session)`). C'est un choix de sécurité assumé (aucun chemin fourni par le client), et non un détail d'implémentation.

## Pourquoi ne pas détourner la vue de conversation

La sélection de vue est un état **interne** du panneau conversation : `selectView` appelle `activateView(sessionId, view)` dans son store, et `openView(view, focus)` n'est fourni qu'aux occupants de `conversation.view`. Aucun service client n'expose cette sélection. Faire cliquer un bouton de barre latérale sur « l'onglet Design Studio » demanderait de contourner ce contrat (état du store, événement synthétique) : refusé.

Deux options écartées, pour mémoire :

- **Remplacer `sidebar` (`single`, `replaceRisk: shadows-shipped-ui`)** — cela masquerait toute la navigation DSH. Inacceptable.
- **`sidebar.footer.action`** (à côté de Réglages) — additif, mais il ne reçoit que `{ wide }` et ne peut pas changer de vue : au mieux un raccourci vers le panneau, donc redondant avec `sidebar.panellist`.

## Surface Host à ajouter (tranche suivante)

Un resolver **par espace de travail**, à côté du resolver par session existant :

1. `workspaceId` → `ctx.workspaceRegistry.get(id)` ; un id inconnu est refusé (`unknown-workspace`), jamais converti en chemin.
2. Le chemin obtenu passe par **exactement** la même validation que la voie session (dans l'espace de travail, pas de lien symbolique, pas de parent remplacé, verrou coopératif, `baseHash` + `baseIdentity`, refus de révision périmée).
3. Aucun nouveau pouvoir : mêmes opérations (`files`, `document`, `apply`), même moteur de patch. Seule la **résolution de la racine** change, et elle est validée côté Host.
4. Les routes session existantes restent intactes et continuent d'être prouvées telles quelles.

## Tranches de livraison (chacune livrable et testable seule)

1. **ADR-024** (ce document) — la décision et les contrats.
2. **Host** : resolver `workspaceId` + routes `files`/`document`/`apply` cadrées espace de travail, avec tests unitaires (id inconnu, id d'un autre espace, échappement de chemin, verrou, révision périmée) et sans toucher aux tests session existants.
3. **Client** : enregistrement `sidebar.panellist` (id `design-studio`) + `main` (clé `design-studio`), panneau réutilisant le composant Studio avec un transport espace de travail ; état vide honnête quand aucun espace de travail n'existe ; `layout.selectPanel` pour l'ouverture.
4. **Preuve** : gate DSH réelle — la ligne de barre latérale existe et le panneau liste un fichier réel de l'espace de travail, dans l'app Web **et** dans l'app Desktop.

## Ce qui ne change pas

- Aucun chemin fourni par le client ; aucun accès hors de l'espace de travail enregistré.
- La vue de conversation reste la seule voie d'édition depuis une conversation, et continue d'exiger `sessionId`.
- `NOT_RUN` reste `NOT_RUN` : la ligne de barre latérale ne sera annoncée comme livrée qu'une fois vue dans l'app réelle, pas parce qu'un slot la déclare.
