# Accessibilité et tactile — ce qui est vérifié, ce qui ne l'est pas (18 novembre 2026)

## Résumé

| Sujet | État | Preuve |
|---|---|---|
| Arbre d'accessibilité réel (Chromium) | **PASS** | CDP `Accessibility.getFullAXTree`, 9 vérifications |
| Noms accessibles calculés depuis le DOM (Firefox) | **PASS** | ordre accname, 5 vérifications |
| Aucun contrôle interactif sans nom | **PASS** | 0 contrôle anonyme dans les deux moteurs |
| Navigation clavier (Tab déplace le focus) | **PASS** | mesure du `document.activeElement` après Tab |
| Tactile (sélection + glissement) | **PASS — émulé** | contexte `hasTouch`, API `touchscreen` |
| Lecteur d'écran réel (Orca) | **NOT_RUN** | voir ci-dessous |

## Ce qui a réellement été exécuté

```sh
DSH_E2E_PLAYWRIGHT=<playwright> node tests/browser/run.mjs '--grep=touch:' --browsers=chromium,firefox
# chromium 145.0.7632.6 PASS — 2 checks
# firefox  146.0.1      PASS — 2 checks

DSH_E2E_PLAYWRIGHT=<playwright> node tests/browser/run.mjs '--grep=a11y: the command' --browsers=chromium,firefox
# chromium PASS — 9 checks (arbre AX réel via CDP)
# firefox  PASS — 5 checks (noms calculés depuis le DOM)
```

Ces deux specs font partie du gate navigateur complet et tournent donc à chaque
exécution, sur une vraie page, contre le vrai handler Host.

## Pourquoi le lecteur d'écran reste `NOT_RUN`

`orca` et `speech-dispatcher` sont **installés** sur cette machine, mais Orca est
un client AT-SPI qui exige une session graphique interactive. Deux options
existaient :

- utiliser `DISPLAY=:0` : cela ouvrirait des fenêtres sur le bureau de
  l'utilisateur, **interdit** par la mission ;
- installer `Xvfb` : `apt-get` demande `root`, `sudo -n` échoue
  (« interactive authentication is required »), et le compte courant est `uid 1000`.

Le harness Electron a par ailleurs montré qu'un shell en ozone headless démarre
mais ne franchit pas sa fenêtre de premier démarrage — la même limite
s'appliquerait à Orca.

**Ce que les specs prouvent donc** : ce que le navigateur **expose** à la
technologie d'assistance (rôles, noms, présence des champs éditables, absence de
bouton anonyme). **Ce qu'elles ne prouvent pas** : qu'un lecteur d'écran réel
annonce ces éléments correctement, dans l'ordre, avec une navigation cohérente.

## Ce qu'il reste à faire (côté propriétaire, ou avec un display virtuel)

```sh
# Sur une session graphique, avec le plugin installé dans un profil jetable :
orca --replace &
# puis parcourir : barre latérale → panneau Design Studio → ouvrir un SVG →
# sélectionner un calque → modifier une propriété → sauvegarder → annuler.
```

Ou, si un administrateur peut installer `xvfb` :

```sh
sudo apt-get install -y xvfb
xvfb-run -a orca --replace &
xvfb-run -a node tests/e2e/real-dsh.mjs --json=/tmp/dsh-orca.json
```

## Tactile : ce que « émulé » veut dire

Le contexte navigateur active `hasTouch` et les gestes passent par l'API
`touchscreen` de Playwright, donc par de vrais événements pointeur de type
`touch`. Cela prouve que l'éditeur ne dépend pas d'un dispositif souris pour
sélectionner ou glisser. Cela **ne prouve pas** : la taille réelle des poignées
au doigt, le défilement inertiel, le pincement pour zoomer, ni le comportement
d'un appareil physique.

## Conséquence sur le verdict

La vague 2 exige un lecteur d'écran réel et un Desktop réel. Aucun des deux n'est
fait : **le verdict reste NO-GO Production Ready**, et la matrice de livraison
distingue explicitement :

- « arbre d'accessibilité et noms vérifiés en navigateur » — `PASS` ;
- « lecteur d'écran réel » — `NOT_RUN` ;
- « tactile matériel » — `NOT_RUN` (émulation `PASS`).
