# Revue indépendante — onglets, journal de récupération, export PNG

**Date :** 18 novembre 2026 · **Base :** `94e0c3c` (code de `f82e22f`)
**Nature :** lecture seule, statique. Aucun test relancé par le réviseur.

## Verdict global

Les trois tranches sont jugées sérieuses : le changement d'onglet ne perd pas la
source, l'export PNG est réellement local et inerte dans les deux moteurs, le
journal ne se partage pas entre espaces de travail **via l'interface**. Mais
plusieurs garanties annoncées ne sont pas tenues.

| # | Gravité | Défaut | Traitement |
|---|---|---|---|
| D1 | **Bloquant (données)** | Une frappe dans la source pendant un `/apply` en vol est remplacée silencieusement par la source disque, et l'entrée de journal est effacée juste avant | corrigé |
| D2 | Gênant | Fermer un onglet pendant un save : pas de garde `busy`, bouton de confirmation actif → onglet actif et document vivant désynchronisés | corrigé |
| D3 | Gênant | Après une récupération, `baseHash` est réécrit avec la révision courante : l'avertissement de divergence disparaît au rechargement suivant | corrigé |
| D4 | Gênant | Récupération sur un onglet déjà ouvert : aucun `/document` relu, divergence non signalée | corrigé |
| D5 | Gênant | Message contradictoire (« fichier inchangé » puis « fichier a changé ») | corrigé |
| D6 | Gênant/doc | « Fermer sans enregistrer » ne supprime pas l'entrée de journal | corrigé |
| — | Doc | Journal en clair, actif par défaut, sans TTL, survivant à la désinstallation | documenté |

## Détail de D1 (le défaut à corriger en premier)

1. Ouvrir `a.svg`, révéler la source, taper `X`, cliquer **Save source** (le POST
   part avec `S1`).
2. Le `<textarea>` n'est pas désactivé par `busy` : taper `Y` avant la réponse.
3. La réponse déclenche `recoveryClear()` puis `load(true, doc.file)`, qui remet
   `source` à la source disque `S1`.
4. `Y` a disparu sans confirmation ; l'entrée de journal qui l'aurait sauvé vient
   d'être supprimée.

C'est une violation directe de la règle « ne jamais écraser silencieusement une
modification concurrente » : le concurrent est ici l'utilisateur lui-même.

## Ce que la revue confirme comme correct

- Changement d'onglet : capture de l'état quitté avant d'appliquer le nouveau,
  capture/restauration symétriques, brouillon et Undo/Redo préservés.
- `save()` vise le fichier de l'onglet actif dans le flux normal ; les tests
  navigateur vérifient le corps du POST.
- Export PNG : aucun `fetch`, aucun `/apply`, aucun script exécuté ; la regex de
  refus couvre casse, espaces, préfixe QName, commentaires (faux positif
  conservateur) ; `scriptx` non confondu.
- Le journal ne fuit pas entre scopes **via l'UI** (filtre par préfixe).

## Limites de la revue

Aucune exécution : les conclusions sont statiques, appuyées sur le code et les
tests lus. Les corrections et leurs régressions sont vérifiées séparément dans la
matrice de livraison.
