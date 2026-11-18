# Plan d'intégration — de l'alpha expérimentale à un outil utilisable

**Date :** 18 novembre 2026 · **Branche :** `dev` · **Base :** `e369a2d`
**Auteur :** orchestrateur · **Statut :** plan d'exécution, pas une décision de release.

## 1. Décision de périmètre

DSH Design Studio ne cherche pas à égaler Figma ou Penpot. Ces produits reposent
sur un moteur de rendu, un modèle de composants et une synchronisation
distribuée qui représentent des années d'ingénierie. Vouloir les rattraper dans un
plugin embarqué produirait des fonctionnalités à moitié faites — exactement ce que
la mission interdit.

Le périmètre de release retenu est donc :

> **Un éditeur manuel SVG / HTML / CSS local, sans IA, qui ne perd jamais un octet,
> qui fait bien les gestes quotidiens d'un designer, et dont chaque fonction
> annoncée est vérifiée dans le vrai DSH.**

### Dans le périmètre (engagé)

| # | Capacité | État actuel |
|---|---|---|
| 1 | Créer, ouvrir, éditer, sauvegarder, renommer, supprimer des documents natifs | livré |
| 2 | Formes SVG, plume, nœuds Bézier, texte et typographie | livré |
| 3 | Calques : hiérarchie, groupe, visibilité, verrou, renommage, ordre par glisser, alignement, distribution | livré |
| 4 | Transformations : déplacement, rotation/échelle à pivot réel, matrices imbriquées | livré |
| 5 | Apparence SVG : remplissage, opacité, **dégradés (arrêts)**, **contours** | dégradés en cours · contours à faire |
| 6 | HTML visuel : sélection dans l'aperçu, texte, attributs, classes, presets Flex/Grid, aperçu responsive borné | livré |
| 7 | CSS : règles, sélecteurs, variables, **une déclaration dans un `@media` simple** | livré |
| 8 | Sécurité des aperçus (iframe inerte, CSP, sandbox) | livré, mesuré en navigateur |
| 9 | Sauvegarde sans perte : patches exacts, révisions, conflits refusés, Undo/Redo exact | livré |
| 10 | Intégration DSH : vue de conversation + panneau barre latérale, thème de l'hôte | livré côté Web |
| 11 | Vérification réelle : Web, **Desktop**, accessibilité réelle, plateformes | Web livré · Desktop/AT à faire |
| 12 | Fonctionnalités agentiques optionnelles sur les mêmes primitives | non implémenté |

### Hors périmètre (explicitement annoncé comme absent)

- Collaboration temps réel, commentaires, historique de versions partagé.
- Composants/symboles et styles d'objet réutilisables ; variables de design.
- Opérations booléennes, moteur de filtres, masques complexes.
- Import Figma/Sketch/AI/PSD ; export PNG/PDF/React/Tailwind.
- Prototypage (liens entre écrans), planches multiples, onglets multiples.
- Cascade CSS calculée, `@container`, breakpoints éditables, CSS de frameworks.

Ces éléments ne seront **jamais** annoncés comme disponibles ; toute mention
future devra passer par une nouvelle décision et ses propres preuves.

## 2. Vagues d'exécution

Chaque vague est une suite de tranches livrables séparément, avec revue
indépendante, gates niveau 1/2, puis commit atomique sur `dev`.

### Vague 1 — Finir l'apparence SVG (priorité P0 du périmètre)

| Tranche | Contenu | Dépendances | Preuve exigée |
|---|---|---|---|
| 1.1 | **Arrêts de dégradé** — livré : couleur et opacité d'un arrêt existant ; `offset` supporté par module/Host mais non exposé ; refus explicites (hérité par `href`, `style=`, feuille de style du document, id encodé, entités, hors bornes, `none`) | — | module + route + specs navigateur ; octets exacts, 1 écriture, Undo exact |
| 1.2 | **Contours** : `stroke`, `stroke-width`, `stroke-opacity`, `stroke-linecap`, `stroke-linejoin`, `stroke-dasharray` borné ; panneau « Contour » réellement actif ou refusé avec raison | 1.1 | idem |
| 1.3 | **Opacité de remplissage** distincte de l'opacité globale (`fill-opacity`) | 1.2 | idem |
| 1.4 | **Arrêts ajoutés/supprimés** (structure du `<defs>`) — seulement si 1.1 est stable | 1.1 | patch réversible, refus si le `<defs>` n'est pas structurable |

Sortie de vague : tout dessin SVG importé peut être retouché (couleur, contour,
dégradé) sans jamais réécrire les octets voisins.

### Vague 2 — Vérification réelle (bloque toute revendication)

| Tranche | Contenu | Preuve exigée |
|---|---|---|
| 2.1 | **Desktop Electron** sur l'UI actuelle : installation, panneau, édition, sauvegarde dans un profil jetable | **Tentative faite, `NOT_RUN`** : le shell démarre réellement en ozone headless (CDP publié) mais sa fenêtre de premier démarrage n'est pas pilotable sans display interactif ; `Xvfb` absent et son installation exige root. Commande propriétaire et cause exacte dans [DESKTOP-VERIFICATION-2026-11-18.md](../operations/DESKTOP-VERIFICATION-2026-11-18.md) |
| 2.2 | **Lecteur d'écran réel** sur le parcours de commande (navigation, sélection, édition, sauvegarde) | session enregistrée avec un lecteur disponible, limites documentées |
| 2.3 | **Tactile réel** ou émulation documentée : glisser, pincer, poignées | mesure sur appareil ou émulation explicite, jamais présentée comme tactile matériel |
| 2.4 | **Plateformes** : macOS, NFS/SMB — ou retrait explicite du périmètre certifié | `NOT_RUN` assumé si l'environnement manque |

Sortie de vague : le mot « production ready » devient discutable ; tant que 2.1
et 2.2 ne sont pas faits, le verdict reste **NO-GO**.

### Vague 3 — Confort professionnel (après 1 et 2)

| Tranche | Contenu |
|---|---|
| 3.1 | Onglets de documents (plusieurs fichiers ouverts, sans perdre les brouillons) |
| 3.2 | Planche redimensionnable depuis l'UI (`viewBox`/`width`/`height` explicites) |
| 3.3 | Export PNG du document courant, sans réécrire la source |
| 3.4 | Historique local de session (journal de patches) pour la récupération après crash |

Sortie de vague : usage quotidien sans friction, sans élargir le périmètre
fonctionnel.

### Vague 4 — Optionnel, hors périmètre de release

Outils agentiques (mêmes primitives, diff visible, approbation), puis seulement
ensuite booléens/composants s'ils sont explicitement demandés.

## 3. Règles d'exécution (inchangées)

1. Une tranche = tests écrits **avant** la correction quand il s'agit d'un défaut.
2. Toute écriture passe par un patch ciblé et une précondition de révision.
3. Un refus est explicite et ne modifie aucun octet ; jamais d'approximation
   silencieuse.
4. Chaque tranche : niveau 1, niveau 2 (Chromium + Firefox), **revue indépendante**,
   correction des constats, puis commit atomique et push sur `dev`.
5. La documentation (ADR, matrice de livraison, README, décision de release) est
   mise à jour dans le même commit ou juste après, avec les SHA réels.
6. `main`, les tags et toute publication restent interdits sans accord explicite
   du propriétaire.
7. Un `NOT_RUN` reste un `NOT_RUN` : jamais promu en succès.

## 4. Risques identifiés

| Risque | Mitigation |
|---|---|
| Le Desktop ne se laisse pas piloter sans fenêtre visible sur le profil personnel | profil et `HOME`/`XDG` jetables, `DSH_E2E_DESKTOP=0` par défaut, preuve par captures |
| L'accessibilité réelle révèle des défauts structurels (focus, ordre, noms) | traiter avant la vague 3 ; ne jamais déclarer WCAG sur la seule présence d'attributs |
| Les dégradés/contours touchent des documents réels | refus par défaut sur les constructions ambiguës ; patchs sur la seule valeur d'attribut |
| La dette de `client.js` (≈3 600 lignes) ralentit les tranches | extraction progressive par domaine, tests préservés, jamais de réécriture globale |
| Une tranche « presque finie » est annoncée comme finie | rapport honnête par tranche, `PARTIAL`/`NOT_RUN` explicites |

## 5. Critères de sortie (rappel)

Aucune release tant que :

- [ ] la vague 1 est livrée et vérifiée en navigateur réel ;
- [ ] la vague 2.1 (Desktop) et 2.2 (lecteur d'écran) sont exécutées ou
      explicitement retirées du périmètre certifié ;
- [ ] chaque contrôle visible fait ce qu'il annonce, ou est désactivé avec raison ;
- [ ] la matrice de livraison et la décision de release citent les SHA et les
      commandes réellement exécutées ;
- [ ] le propriétaire approuve explicitement la publication.

## 6. État au moment d'écrire ce plan

- `npm run check` : **553 PASS / 0 FAIL / 0 SKIP**.
- `npm run test:browser` : **156 PASS / 0 FAIL / 0 NOT_RUN** (78 specs × 2 moteurs).
- `npm run test:dsh` (Web, sans IA) sur `e369a2d` : **30 PASS / 0 FAIL / 6 NOT_RUN**,
  preuves dans `docs/operations/evidence/2026-11-18-e369a2d/`.
- Desktop, lecteur d'écran, tactile, macOS/NFS : `NOT_RUN`.
- Verdict : **NO-GO** Production Ready, aucune release, `main` intacte à `67870f7`.
