# Desktop (Electron) — état de la vérification, 18 novembre 2026

## Résultat : **NOT_RUN** (bloqué par l'environnement, pas par le code)

Le plan d'intégration exige une vérification du **shell Desktop réel** sur l'UI
actuelle. Tentative réelle effectuée ce jour, résultat honnête ci-dessous.

## Ce qui a été réellement exécuté

```sh
DSH_E2E_DESKTOP=1 \
DSH_E2E_DESKTOP_ARGS='--ozone-platform=headless --no-sandbox' \
DSH_E2E_REUSE_CREDENTIALS=0 \
DSH_E2E_PLAYWRIGHT=/mnt/Stockage/App/twake-qualification/wt/drive/node_modules/playwright \
node tests/e2e/real-dsh.mjs --json=/tmp/desktop-headless.json
```

- `HOME`, `DSH_HOME` et les quatre `XDG_*` **jetables** : aucun profil personnel
  n'est touché, aucune fenêtre ne s'ouvre sur le bureau de l'utilisateur.
- **PASS** — `boot the real DSH Desktop shell` : Electron démarre sous
  `--ozone-platform=headless` et publie un port **CDP 39237**. C'est la première
  fois que le shell démarre sans display interactif sur cette machine.
- **FAIL** — `the shell initializes its own desktop profile` : le répertoire
  `profiles/` ne contient que `e2e` (profil Web créé par la même exécution), pas
  `desktop`. Sans profil `desktop`, la phase 2 du harness (installation du bundle
  comme le ferait un utilisateur) ne peut pas s'exécuter, et le reste de la
  vérification Desktop est `NOT_RUN`.

## Cause identifiée

Le shell Electron crée son profil `desktop` au terme de sa **fenêtre de premier
démarrage**, qui demande une interaction. En ozone headless cette fenêtre est
créée mais jamais pilotée : le profil n'apparaît donc pas dans les 6 s observées.
Ce n'est ni un défaut du plugin, ni une preuve de bon fonctionnement : c'est une
limite de la méthode headless.

## Pourquoi pas de display virtuel

- `Xvfb` / `xvfb-run` **ne sont pas installés** (`/usr/bin/Xvfb` absent).
- Les installer demande `root` : `sudo -n true` échoue (`interactive
  authentication is required`) et `id -u` vaut `1000`.
- Utiliser le display de l'utilisateur (`DISPLAY=:0`) ouvrirait une fenêtre sur
  son bureau : **interdit** par la mission.

## Ce qu'il reste à faire (une seule commande, côté propriétaire)

Sur une session graphique normale, avec le dépôt à jour :

```sh
DSH_E2E_DESKTOP=1 \
DSH_E2E_PLAYWRIGHT=<chemin vers playwright> \
node tests/e2e/real-dsh.mjs --json=/tmp/desktop.json
```

La fenêtre du shell s'ouvrira une fois dans un `HOME` jetable, créera son profil,
et le harness installera le bundle, ouvrira le panneau, éditera, sauvegardera et
capturera le workbench. Aucun profil personnel n'est utilisé.

Alternative sans interaction, si un administrateur peut installer `xvfb` :

```sh
sudo apt-get install -y xvfb
DSH_E2E_DESKTOP=1 xvfb-run -a node tests/e2e/real-dsh.mjs --json=/tmp/desktop.json
```

## Ce que cela change pour le verdict

Rien de favorable : **le Desktop reste hors du périmètre certifié**. Conformément
au plan, le verdict **NO-GO Production Ready** est maintenu et la matrice de
livraison doit mentionner ce `NOT_RUN` avec sa cause exacte.

## Ajout au harness

`DSH_E2E_DESKTOP_ARGS` permet de passer des drapeaux Electron supplémentaires,
**opt-in uniquement** : aucun drapeau ne devient un défaut implicite, et le
message d'échec nomme désormais la fenêtre de premier démarrage non pilotée
au lieu d'afficher une simple liste de répertoires.
