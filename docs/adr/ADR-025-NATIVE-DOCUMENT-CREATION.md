# ADR-025 — Créer un document natif depuis le workbench

**Statut :** accepté · **Date :** 17 novembre 2026 · **Concerne :** `src/native-file-store.mjs`, `src/plugin-host.mjs`, `client.js`

## Décision

La création d'un document est une **capacité Host de premier rang**, au même niveau que la lecture et l'édition : `store.create(file, { source })` + `POST /design-studio-native/create`, et une rangée « Nouveau » dans l'état d'accueil du workbench (SVG, HTML, CSS).

Règle non négociable : **une création ne remplace jamais un fichier existant**. Un chemin déjà occupé est un refus typé (`already-exists`, HTTP 409), pas un écrasement silencieux.

## Pourquoi

Le store n'exposait que `read` et `apply` (`apply` exige un `baseHash` + `baseIdentity`, donc un fichier déjà ouvert). Conséquence mesurée dans l'usage réel : un onglet où l'on ne pouvait **que** choisir un fichier existant, donc l'obligation de quitter l'éditeur pour commencer un design. Le défaut n'était pas l'absence d'un bouton mais l'absence d'un chemin d'écriture sans révision de base.

## Protocole (dans `create`)

1. Le chemin relatif est validé exactement comme pour `apply` (`validateRelativePath`) : pas d'absolu, pas de `\`, pas de segment `.`/`..`, pas de nom réservé Windows, pas d'ADS NTFS, extension dans `{svg, html, htm, css}`.
2. Chaque **parent existant** est résolu : `lstat` (donc pas de lien symbolique), répertoire obligatoire, `realpath` confiné à la racine de l'espace de travail. Un parent manquant est `missing-directory` : **aucun `mkdir` implicite**, aucune création de répertoire par l'éditeur.
3. Le verrou coopératif (`.NAME.dsh-native.lock`) est pris, puis l'absence du chemin est **re-vérifiée à l'intérieur** de la section critique (`already-exists` sinon).
4. Les octets vont dans un fichier temporaire du même répertoire, `chmod 0644` (soumis à l'umask), `fsync` du fichier.
5. Commit **sans écrasement** : `link()` — qui échoue en `EEXIST` au lieu de remplacer, contrairement à `rename()`. Sur les systèmes de fichiers sans lien matériel (exFAT/FAT32, certains montages réseau), repli sur une création exclusive `open(..., 'wx')`, qui est également non-écrasante.
6. `fsync` du répertoire, puis relecture du fichier commité et comparaison du SHA-256 avec les octets fournis. Une divergence est `stale-revision`, jamais un succès optimiste.

## Garanties et non-garanties

**Garanties (processus coopératifs, même machine, même système de fichiers) :**

- un chemin existant n'est jamais remplacé, ni par `link`, ni par le repli `wx` ;
- deux créations concurrentes du même chemin produisent **un** fichier et **un** `already-exists` (prouvé par test) ;
- un échec (disque plein, temporaire impossible, verrou en échec) ne laisse ni fichier partiel ni temporaire résiduel (prouvé par injection de panne) ;
- un `create` réussi renvoie un `hash` + `identity` immédiatement utilisables par `apply` (prouvé : création puis édition puis Undo exact) ;
- une édition externe qui arrive entre la création et la première sauvegarde est détectée comme `stale-revision`.

**Non-garanties (documentées, pas dissimulées) :**

- la création est exclusive par **nom**, pas par intention : elle ne peut pas deviner qu'un fichier a été créé entre-temps par une autre application sous un autre nom ;
- `link()` peut être indisponible selon le système de fichiers ; le repli `wx` est alors non atomique en écriture (les lecteurs peuvent voir un fichier partiel pendant quelques instants), mais reste **non-écrasant** ;
- aucun répertoire n'est créé ; aucune fenêtre de dialogue de fichiers n'est ouverte ;
- le contenu n'est pas validé sémantiquement par le Host : un document créé peut être du SVG syntaxiquement invalide si l'appelant en envoie. C'est le même contrat que `replace-source` ; les modèles de l'interface sont, eux, valides et testés (ils montent un canevas réel et sont éditables immédiatement).

## Interface

État d'accueil (`doc === null`) : champ « Nouveau : `nom` » + boutons `+ SVG`, `+ HTML`, `+ CSS`. Le nom saisi est réutilisable comme chemin relatif (`pages/accueil` → `pages/accueil.svg`, dossier devant exister). L'extension finale est imposée par le bouton cliqué, une extension supportée saisie par l'utilisateur est remplacée. Après création : liste de l'espace de travail rafraîchie, document ouvert dans le canevas.

Les trois modèles sont du source natif que les inspecteurs existants savent déjà éditer : le SVG porte un `viewBox` réel et des `id` de calques, le HTML des `id` ciblables par le mappeur visuel, le CSS un sélecteur `body` listable par l'inspecteur de règles.

## Preuves exécutées

| Niveau | Preuve | Résultat |
|---|---|---|
| 1 — `npm run check` | `tests/native-create.test.mjs` (14 tests) + 4 tests de route dans `tests/plugin-host.test.mjs` | **428/428 PASS** |
| 2 — `npm run test:browser` | `tests/browser/specs/create.mjs` : création SVG réelle + ouverture du canevas + octets disque, création CSS + édition de règle, refus d'un chemin occupé sans altération des octets | **84 PASS / 0 FAIL** (42 specs × Chromium + Firefox) |
| 3 — `npm run test:dsh` | non ré-exécuté après ce changement | **NOT_RUN** |

Le niveau 3 reste `NOT_RUN` : le harnais DSH réel ouvre une fenêtre, ce qui est incompatible avec la session en cours. Il doit être ré-exécuté avant toute release candidate, et il ne peut pas être remplacé par les niveaux 1–2.

## Alternatives écartées

- **`rename()` du temporaire vers la cible** : atomique mais *remplaçant*. Inacceptable pour une création.
- **`open(target, 'wx')` seul** : correct pour le non-écrasement, mais expose un fichier partiellement écrit. Utilisé uniquement en repli.
- **`mkdir` implicite des parents** : élargit inutilement la surface d'écriture du plugin et brouille la propriété du dossier ; un parent manquant est une erreur explicite.
- **Modèles générés côté Host** : aurait dupliqué du contenu d'interface dans le protocole. Les modèles sont du contenu client, la validité est prouvée par le niveau 2.
