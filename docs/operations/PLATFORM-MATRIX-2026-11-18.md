# Plateformes certifiées — 18 novembre 2026

## Objet

La vague 2.4 du plan d'intégration demande soit une vérification macOS/NFS/SMB,
soit un **retrait explicite** de ces plateformes du périmètre certifié. Ce
document fait le second choix, et le rend vérifiable : il liste ce qui a été
réellement exécuté, sur quoi, et ce qui ne doit jamais être annoncé.

## Matrice

| Plateforme | Navigateur / moteur | État | Preuve |
|---|---|---|---|
| Linux x64 | Chromium 145 (Playwright) | **PASS** | gate navigateur complet |
| Linux x64 | Firefox 146 (Playwright) | **PASS** | gate navigateur complet |
| Linux x64 | DSH Web réel, profil jetable | **PASS** | `npm run test:dsh`, 31 étapes |
| Linux x64 | DSH Desktop (Electron) | **NOT_RUN** | shell démarre en ozone headless mais sa fenêtre de premier démarrage n'est pas pilotable — [détail](DESKTOP-VERIFICATION-2026-11-18.md) |
| Windows x64 | CI `core` | **PASS** (fonctionnel) | 2 tests `SKIP` : fsync de répertoire non supporté |
| Windows | navigateur / DSH réel | **NOT_RUN** | aucune exécution réelle |
| macOS (APFS) | tout | **NOT_RUN** | aucune machine |
| NFS / SMB | tout | **NOT_RUN** | aucun montage disponible |
| Appareil tactile physique | — | **NOT_RUN** | émulation seulement |
| Lecteur d'écran (Orca) | — | **NOT_RUN** | display interactif requis |

## Ce que le périmètre certifié couvre exactement

**Certifié** : Linux x64, Chromium et Firefox, DSH Web réel, documents SVG, HTML
et CSS locaux sur un système de fichiers POSIX local.

**Hors périmètre certifié** (jamais annoncé comme fonctionnel) :

- **macOS** : non exécuté, donc non certifié. Aucune affirmation de
  compatibilité n'est faite, même si le code n'utilise que des primitives
  portables.
- **Systèmes de fichiers réseau (NFS, SMB, CIFS)** : non exécutés. La garantie de
  non-écrasement repose sur des verrous coopératifs et une revalidation avant
  remplacement ; sur un montage réseau, la propagation des verrous et la
  sémantique de `link()` varient, et la fenêtre TOCTOU déjà documentée peut
  s'élargir. **Ne pas éditer un document critique sur un montage réseau sans
  sauvegarde préalable.**
- **Systèmes sans lien matériel** (exFAT, FAT32) : le renommage est **refusé**
  (`rename-unsupported`) au lieu d'être dégradé en `rename()` qui pourrait
  écraser un fichier concurrent. C'est un comportement volontaire, testé par
  injection.
- **Windows en navigateur / DSH réel** : seule la suite fonctionnelle Node est
  vérifiée en CI. Deux tests sont explicitement `SKIP` parce que la
  synchronisation de répertoire n'existe pas sur cette plateforme : la durabilité
  après crash n'y est donc **pas** prouvée.

## Ce que le code fait quand la plateforme est inconnue

Le stockage échoue **fermé** plutôt que d'approximer :

| Situation | Comportement |
|---|---|
| `link()` indisponible | `rename-unsupported`, rien n'est modifié |
| `fsync` de répertoire indisponible (Windows) | ignoré explicitement, documenté comme non prouvé |
| `fsync` en erreur sur POSIX | `commit-failed` avec message de rechargement, jamais un succès optimiste |
| Verrou non libérable | `lock-release-failed` exposé sur l'erreur principale |
| Fichier hardlinké | refusé (`invalid-file`) : deux noms ne doivent pas perdre leurs octets |
| Chemin hors espace de travail, lien symbolique, parent remplacé | refusés avant toute écriture |

## Comment obtenir une certification supplémentaire

Pour macOS : exécuter, sur la machine cible, `npm run check`, `npm run
test:browser` et `npm run test:dsh` (Web). Pour NFS/SMB : monter un partage
jetable, y créer un espace de travail dédié et exécuter les mêmes commandes ;
`rename-unsupported` est un résultat **attendu** sur les montages sans lien
matériel, pas un échec.

Tant que ces exécutions n'ont pas eu lieu, la phrase autorisée est :

> « Vérifié sur Linux x64 avec Chromium et Firefox, dans DSH Web. macOS, NFS/SMB,
> Windows côté navigateur, Desktop Electron, appareil tactile et lecteur d'écran
> ne sont pas vérifiés. »

## Conséquence sur le verdict

Ce retrait explicite ne débloque pas la release : les critères de sortie exigent
l'installation réelle et les parcours annoncés. Le Desktop et le lecteur d'écran
restent donc bloquants, et le verdict demeure **NO-GO Production Ready**.
