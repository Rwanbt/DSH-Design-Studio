# ADR-027 — Renommer et supprimer un fichier natif

**Statut :** accepté · **Date :** 17 novembre 2026 · **Branche :** `dev`

## Contexte

Le plugin savait créer, lire et éditer des documents SVG/HTML/CSS natifs, mais
**jamais renommer ni supprimer**. Un utilisateur réel a créé un fichier par
erreur en essayant l'interface et n'a eu aucun moyen de le retirer depuis
l'éditeur : il a dû demander un nettoyage manuel du dépôt.

Une création sans suppression possible est une capacité incomplète, pas une
précaution : elle laisse des fichiers fantômes dans l'espace de travail et
oblige à sortir de DSH pour nettoyer. La capacité inverse — supprimer — est en
revanche la seule opération **non annulable** de l'éditeur, puisque le Host ne
conserve aucune historique pour elle.

## Décision

### 1. Deux routes Host explicites, jamais implicites

`POST /design-studio-native/rename` et `POST /design-studio-native/delete`.
Toutes deux exigent `baseHash` + `baseIdentity` (la révision réellement ouverte
dans le client) et répondent `428 missing-revision` avant de toucher au disque
si elles manquent. Aucune opération de fichiers n'est déclenchée par un simple
clic dans une liste.

### 2. Renommer ne remplace jamais un nom

Le commit est `link()` puis `unlink()` : `link()` échoue en `EEXIST` au lieu de
remplacer une cible, contrairement à `rename()`. La destination est vérifiée
absente **dans** la section critique. **Révision sécurité du 18 novembre 2026 :**
si le `unlink()` de l'ancien nom échoue, aucun rollback destructif n'est tenté.
Le Host signale `commit-failed` et un renommage partiel : les deux noms peuvent
subsister et doivent être inspectés avant toute reprise. Une vérification
identité suivie d'un `unlink()` ne serait pas atomique et pourrait supprimer un
fichier externe ayant remplacé le nouveau nom. La conservation des données prime
sur le nettoyage automatique ; les hardlinks restants sont refusés par le store. Sur un système de fichiers sans lien matériel, le
renommage est **refusé** (`rename-unsupported`) plutôt que dégradé en
`rename()` qui pourrait écraser un fichier concurrent.

Les octets ne sont pas réécrits : le contenu reste identique au bit près, seul
le nom change (le `hash` reste donc le même, l'`identity` change).

### 3. Supprimer reste volontairement étroit

Seul un fichier **régulier, non hardlinké**, d'extension SVG/HTML/CSS, à
l'intérieur de l'espace de travail, peut être supprimé. Sont refusés : les
dossiers, les liens symboliques, les hardlinks (`invalid-file`), les chemins qui
sortent de l'espace (`invalid-path`), une révision périmée (`stale-revision`).
Après le `unlink`, l'absence réelle du chemin est vérifiée ; si un autre
écrivain l'a recréé entre-temps, la réponse le dit au lieu de prétendre à une
suppression propre.

**La suppression est définitive : il n'y a pas de corbeille.** L'interface le
dit explicitement avant de confirmer, et n'affiche jamais de bouton de
suppression à un seul clic.

### 4. L'interface nomme le chemin exact

- `Renommer` ouvre un champ prérempli avec le chemin courant ; rien n'est écrit
  avant `Confirmer le renommage`.
- `Supprimer` ouvre une confirmation qui affiche `Supprimer définitivement
  <chemin> ? Le fichier ne sera pas mis à la corbeille.`
- Un document ouvert ne peut être renommé ou supprimé s'il a des modifications
  non enregistrées ou un brouillon de texte : l'utilisateur doit d'abord les
  traiter, comme partout ailleurs dans l'éditeur.
- Après un renommage, l'éditeur suit le fichier (chemin, canevas, calques) ;
  après la suppression du document ouvert, il revient à l'état d'accueil au lieu
  d'afficher un canevas mort.
- Le chemin réellement traité est annoncé dans un `role="status"`
  (`Fichier renommé : …` / `Fichier supprimé : …`).

## Alternatives rejetées

| Alternative | Pourquoi non |
|---|---|
| `rename()` directement sur la destination | Remplace silencieusement un fichier si la destination apparaît entre la vérification et l'appel ; exactement le mode d'échec que le reste du store refuse. |
| Suppression en un clic avec « annuler » côté client | Une annulation côté client ne restaure pas un fichier supprimé : elle ne serait qu'un mensonge d'interface. |
| Corbeille / `.trash` interne | Déplace le problème (rétention, nettoyage, chemins cachés) et crée une seconde sémantique de fichiers dans l'espace de travail de l'utilisateur. |
| Suppression de dossiers | Un dossier contient des fichiers que l'éditeur n'a peut-être jamais lus ; la suppression récursive sort du périmètre « un document = un fichier ». |
| Routes sans contrôle de révision | Agirait sur des octets que l'utilisateur n'a pas vus, alors que tout le store est fondé sur la révision ouverte. |

## Garanties

- une révision périmée est refusée (`stale-revision`) et rien ne bouge ;
- une destination occupée est refusée (`already-exists`) et les deux fichiers
  gardent leurs octets ;
- un renommage réussi laisse un seul nom et des octets identiques ;
- aucune trace de temporaire ni de verrou après un succès nominal ; une panne de
  nettoyage du verrou est signalée aux appelants du store, et une erreur primaire
  conserve le diagnostic via `releaseError` (non sérialisé au client actuellement) ;
- après une suppression réussie, le chemin est réellement absent.

## Non-garanties

- **Fenêtre TOCTOU** identique au chemin d'écriture : Node n'offre pas de
  primitive de suppression conditionnelle atomique. Un écrivain non coopérant
  qui écrit entre la dernière vérification et l'`unlink` n'est pas arrêté ; la
  fenêtre est bornée et documentée, ce n'est pas un CAS universel.
- **Pas de corbeille** : une suppression confirmée est irréversible côté plugin.
- **Systèmes sans lien matériel** (exFAT/FAT32, certains montages réseau) : le
  renommage est refusé, jamais dégradé.
- **Windows** : fsync de répertoire ignoré, comme pour l'écriture ; non exécuté
  par ce module, seul CI le couvre.
- Pas de déplacement de dossier, pas de création de dossier, pas de corbeille,
  pas de renommage en masse.

## Récupération d'un renommage partiel

Ne pas relancer aveuglément et ne supprimer aucun fichier automatiquement.
Inspecter les deux chemins indiqués par l'action. Ils peuvent être deux liens
vers les mêmes octets, ou la destination peut appartenir à un autre écrivain.
Conserver une copie de secours avant toute intervention manuelle ; si l'identité
ou le contenu est ambigu, ne retirer aucun nom. Le plugin ne propose pas encore
d'assistant de récupération des hardlinks et refuse de les éditer.

Sur POSIX, un échec du fsync de répertoire après rename/delete est désormais
`commit-failed` : le changement peut déjà être effectif mais sa durabilité n'est
pas confirmée. Recharger et inspecter avant toute nouvelle action ; aucun rollback
n'est tenté après commit. Le comportement Windows (pas de fsync répertoire) ne
constitue pas une preuve de durabilité POSIX.

## Preuves historiques (avant correction P0 du 18 novembre)

| Niveau | Commande | Résultat |
|---|---|---|
| 1 | `npm run check` | **468/468 PASS** (dont `tests/native-admin.test.mjs` 9 tests et `tests/native-admin-routes.test.mjs` 8 tests) |
| 2 | `npm run test:browser` | **56 specs × Chromium 145 + Firefox 146 = 112 PASS / 0 FAIL**, dont `files: renaming…`, `files: deleting…`, `files: cancelling…` |
| — | Refus vérifiés | destination occupée (409), révision périmée (409), révision absente (428), sortie d'espace de travail (400), lien symbolique (400), hardlink (`invalid-file`), annulation de suppression (aucune écriture) |
