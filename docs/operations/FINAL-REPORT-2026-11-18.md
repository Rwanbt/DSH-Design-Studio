# Rapport final de session — 18 novembre 2026

**Départ :** `67870f79ef6e2f8f89e64cc3c01e497a1214291a` (`dev` = `main` à l'ouverture)
**Fin :** `94e0c3c6a47029d46f6eca644c8ce764c5e4f1a1` (`dev`), `main` **inchangée** à `67870f7`
**Commits sur `dev` :** 52 · **ADRs ajoutés :** 029, 030, 031, 032, 033, 034, 035

## 1. Résultats exacts

| Niveau | Commande | Résultat au dernier commit mesuré |
|---|---|---|
| 1 | `npm run check` | **613 PASS / 0 FAIL / 0 SKIP**, code 0, Linux x64, Node v24.19.0 |
| 2 | `npm run test:browser` | **226 PASS / 0 FAIL / 0 NOT_RUN** — 113 specs × Chromium 145.0.7632.6 + Firefox 146.0.1 |
| 2 bis | `npm run benchmark` | exécuté, rapport `docs/operations/benchmarks/2026-11-18-engine.json`, aussi en CI |
| 3 | `npm run test:dsh` (Web, sans IA) | **30 PASS / 0 FAIL / 6 NOT_RUN**, code 0, profil jetable |
| 3 | Desktop (Electron) | **NOT_RUN** — voir §5 |

CI : chaque commit poussé a été vérifié vert (Ubuntu core, Windows core, navigateurs,
benchmark). Windows : 2 `SKIP` documentés (pas de fsync de répertoire).

## 2. Ce qui a été livré

### Vague 1 — apparence SVG
- **Arrêts de dégradé** : couleur et opacité par arrêt, **ajout et suppression** d'un arrêt (un span, un Undo), un seul patch, refus typés
  (`document-styles`, `encoded-id`, `none`, `inherited-gradient`, `ambiguous-style`,
  `no-stops`, `index-out-of-range`, `unchanged`).
- **Contours** : `stroke`, `stroke-width`, `stroke-opacity`, `stroke-linecap`,
  `stroke-linejoin`, `stroke-dasharray` borné — insertion réversible si l'attribut
  manque, refus des valeurs que le navigateur interpréterait mal.
- **`fill-opacity`** indépendante de l'opacité globale.

### Vague 2 — vérification réelle
- **Arbre d'accessibilité réel** (CDP Chromium) + noms accname (Firefox) : aucun
  contrôle interactif anonyme.
- **Tactile émulé** : sélection et glissement par événements `pointer` de type touch.
- **Plateformes** : macOS/NFS/SMB explicitement retirés du périmètre certifié.
- **Desktop** : tentative réelle, bloquée, cause exacte documentée.

### Vague 3 — confort
- **Onglets de documents** (8 max), état non enregistré préservé, sauvegarde
  strictement sur le fichier de l'onglet actif.
- **Planche redimensionnable** avec mode « contenu » explicite (un seul batch).
- **Export PNG** 1×/2× depuis la source affichée, zéro écriture, zéro requête.
- **Journal de récupération** local des modifications non enregistrées, avec
  récupération explicite, aucune écriture automatique.

### Corrigé en route (trouvé par revue ou par test)
- Rollback destructif du renommage (pouvait supprimer une destination externe).
- `fsync` de répertoire silencieusement ignoré après rename/delete.
- Double panne action + libération du verrou masquée ; erreurs gelées.
- Collage SVG : ids encodés, `url(#…)` non suivis, contexte ancestral perdu.
- Menu contextuel : focus perdu après suppression, Tab sans fermeture.
- Renommage d'id : cassait silencieusement des références CSS/ARIA/SMIL/entités XML.
- Glisser-déposer : dépôt perdu quand la liste défile ; Échap dépendant du focus.
- Menu Fichier ouvert **avalant les clics** sur Renommer/Supprimer.
- Bande d'onglets faisant passer les boutons de l'aperçu HTML dessous (non cliquables).

## 3. Preuves conservées

`docs/operations/` : `BASELINE-2026-11-18.md`, `REAL-WEB-2026-11-18.md`,
`DESKTOP-VERIFICATION-2026-11-18.md`, `ACCESSIBILITY-2026-11-18.md`,
`PLATFORM-MATRIX-2026-11-18.md`, `PERFORMANCE-BUDGETS-2026-11-18.md`,
`evidence/2026-11-18-*` (rapports JSON, journaux, captures).

## 4. Compatibilité réellement vérifiée

Linux x64 · Chromium 145 · Firefox 146 · DSH Web réel (bundle installé, désinstallé
proprement) · Node v24.19.0 · Windows x64 fonctionnel en CI (2 `SKIP`).

## 5. NOT_RUN — et pourquoi

| Élément | Cause |
|---|---|
| **DSH Desktop (Electron)** | le shell démarre en `--ozone-platform=headless` (CDP publié) mais sa fenêtre de premier démarrage n'est pas pilotable ; `Xvfb` absent, installation root refusée, `DISPLAY=:0` interdit (fenêtre chez l'utilisateur) |
| **Lecteur d'écran (Orca)** | Orca installé mais exige un display interactif ; mêmes contraintes |
| **Tactile matériel**, pincement, taille des poignées au doigt | aucun appareil |
| **macOS, NFS/SMB** | aucune machine / aucun montage ; retirés du périmètre certifié |
| **Windows côté navigateur et DSH réel** | CI fonctionnelle seulement |
| **Tour assistant réel sans credentials** | aucun fournisseur configuré dans le profil jetable |

## 6. Risques résiduels

1. **Fenêtre TOCTOU externe** : un écrivain non coopérant entre la dernière
   validation et le remplacement n'est pas arrêté. Documenté, borné, non résolu.
2. **Pas de CAS universel** : la garantie repose sur verrou coopératif + revalidation.
3. **Journal de récupération non chiffré** : contenu en clair dans `localStorage`.
4. **Pas de corbeille** : une suppression confirmée est définitive.
5. **Renommage d'id** : refuse les références connues ; les feuilles CSS externes
   ne sont pas scannées.
6. **Dégradés** : pas de création, pas d'ajout/suppression d'arrêt, `offset` non
   exposé dans l'inspecteur.
7. **Desktop et accessibilité réelle non prouvés** — c'est le blocage principal.

## 7. État des branches

- `dev` : 48 commits au-dessus de `main`, toutes preuves ci-dessus.
- `main` : `67870f7`, **non modifiée**.
- Aucun tag, aucune publication, aucune release.

## 8. Verdict

**NO-GO Production Ready.**

Motifs, dans l'ordre des critères de sortie du plan :

1. l'installation réelle n'est vérifiée que pour le **Web** ; le **Desktop** reste
   `NOT_RUN` pour l'UI actuelle ;
2. l'accessibilité réelle n'est pas vérifiée avec un **lecteur d'écran** ;
3. le tactile n'est vérifié qu'en **émulation** ;
4. macOS et systèmes de fichiers réseau sont **hors périmètre certifié**.

Ce qui est réellement démontré, en revanche, est substantiel : un éditeur SVG/HTML/CSS
manuel qui ne perd pas d'octets, avec des refus explicites plutôt que des
approximations, et des preuves reproductibles à chaque niveau exécutable ici.

## 9. Comment tester toi-même

```sh
# 1. le noyau (aucune dépendance à installer)
npm run check

# 2. les navigateurs réels (nécessite npm install + navigateurs Playwright)
npm run test:browser -- --json=tests/browser/__reports__/browser-report.json

# 3. le vrai DSH Web, sans IA, dans un profil jetable
DSH_E2E_DESKTOP=0 DSH_E2E_REUSE_CREDENTIALS=0 node tests/e2e/real-dsh.mjs

# 4. le Desktop, sur une session graphique (le seul test que je ne peux pas lancer)
DSH_E2E_DESKTOP=1 node tests/e2e/real-dsh.mjs --json=/tmp/desktop.json
```

Puis, manuellement dans DSH : ouvrir la barre latérale → Design Studio → ouvrir un
SVG → dessiner, déplacer, styler, annuler, enregistrer, rouvrir.
