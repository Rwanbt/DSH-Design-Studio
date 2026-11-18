# ADR-035 — Journal local de récupération des modifications non enregistrées

**Statut :** accepté · **Date :** 18 novembre 2026 · **Branche :** `dev` ·
**Concerne :** `client.js` (journal, bandeau, case « Options », `save()`,
`load()`), `tests/client-recovery.test.mjs` (niveau 1),
`tests/browser/specs/recovery.mjs` et `tests/browser/harness/host-server.mjs`
(niveau 2). Découle d'ADR-0001 (les fichiers natifs restent la vérité),
ADR-0002 (aucune écriture implicite, préconditions de révision) et
ADR-034 (plusieurs documents ouverts, chacun avec des modifications non
enregistrées).

## Contexte

Le workbench garde la source éditée, la sélection, Undo/Redo et le brouillon de
texte **en mémoire du renderer**. Si DSH se ferme brutalement — plantage,
fermeture de la fenêtre, `page.reload()` — tout ce qui n'a pas été enregistré
disparaît sans trace. ADR-034 protège déjà le travail au changement d'onglet,
mais uniquement tant que la page vit : ce n'est « pas une persistance » et le
document le dit explicitement.

Un éditeur qui perd un dessin sur un rechargement n'est pas utilisable au
quotidien. La réponse ne peut pas être « enregistrer automatiquement » : ce
serait une écriture implicite, interdite par ADR-0002 et impossible à annuler si
l'utilisateur ne voulait pas enregistrer. Il faut donc une **offre de
récupération**, jamais une écriture.

## Décision

### 1. Ce qui est journalisé, et rien d'autre

Pour chaque onglet **ouvert et modifié** (`source !== doc.source`), le journal
copie :

- la **source exacte** de l'éditeur (pas un diff, pas un patch) ;
- le **chemin relatif** du document dans l'espace de travail (nécessaire pour le
  nommer et le rouvrir), son format, sa révision de base (`hash`, `identity`) ;
- l'horodatage de la dernière copie.

Rien d'autre : aucun chemin absolu ou de profil, aucun jeton, aucune
préférence, aucune configuration de l'hôte, aucun autre fichier de l'espace de
travail. L'onglet **actif** est lu dans l'état vivant, les onglets en
arrière-plan dans leur état capturé (ADR-034) : un plantage ne perd ni l'un ni
les autres.

### 2. Une clé qui nomme le plugin, la version et l'espace de travail

`dsh-design-studio:recovery:v1:<scope>:<fichier>` où `<scope>` vaut
`w:<workspaceId>` (panneau latéral, ADR-024) ou `s:<sessionId>` (vue de
conversation, qui n'a pas d'identifiant d'espace de travail). Le scope est
encodé, comme le chemin. Deux projets ne partagent donc jamais une entrée, et
la préférence vit sous une clé distincte
(`dsh-design-studio:pref:v1:recovery-enabled`).

### 3. Une copie bornée, jamais tronquée

- **256 Kio** UTF-8 maximum par entrée (mesurés sur la charge utile JSON
  réellement stockée ; le texte source seul est donc un peu plus petit) ;
- **8 entrées** maximum par scope ;
- pas d'éviction, pas de troncature : une 9e entrée ou un document trop gros
  n'est **pas** journalisé et un message le dit. Remplacer silencieusement une
  entrée existante détruirait le travail d'un autre fichier.

### 4. Écriture différée, vidage sur fermeture

La copie est faite après un délai de **250 ms** pour ne pas mettre
`localStorage` sur le chemin de la frappe. Un `pagehide`, un `beforeunload` et
le démontage du composant **vident l'entrée en attente**, donc un crash ne
dépend pas d'un minuteur qui aurait eu le temps de tirer.

### 5. Effacement aux seuls moments prévus

Une entrée disparaît quand :

1. une **sauvegarde réussit** pour ce fichier (`/apply` accepté) **et que la
   source vivante est identique à la source envoyée** — le disque contient
   désormais ces octets ;
2. l'utilisateur clique **« Ignorer »** — c'est le seul jet explicite ;
3. l'utilisateur **ferme l'onglet modifié en confirmant « Fermer sans
   enregistrer »** — il vient de renoncer explicitement à cette source ;
4. la source redevient **identique aux octets sur disque** (annulation de
   l'édition) : l'entrée est prouvablement inutile.

Aucun autre chemin n'efface une entrée, et surtout pas l'ouverture du fichier :
ouvrir un document ne doit pas détruire l'offre de récupération. En particulier,
si l'utilisateur tape dans la source pendant qu'un `save()` est en vol, la
réponse **ne recharge pas** le document et **n'efface pas** l'entrée : la source
vivante est conservée, seules les métadonnées de révision (`hash`, `identity`)
sont adoptées, le tampon reste marqué comme modifié non enregistré, et la
journalisation reprend la nouvelle source.

### 5 bis. La base d'une entrée ne se réécrit qu'après une sauvegarde réussie

Une entrée journalisée conserve sa `baseHash` d'origine tant qu'aucune
sauvegarde n'a réussi pour ce fichier. La révision chargée (`doc.hash`) est la
révision **courante du disque**, pas la base de l'édition journalisée : après
une récupération, réécrire `baseHash` avec `doc.hash` ferait disparaître
l'avertissement de divergence au rechargement suivant, et un enregistrement
explicite pourrait alors remplacer une version disque plus récente sans
avertissement. Une sauvegarde réellement acceptée est le seul événement qui
rebase légitimement l'entrée (la source vivante devient alors la nouvelle base).

### 6. Récupérer = charger dans l'éditeur, jamais écrire

« Récupérer les modifications » :

1. ouvre le fichier en **lecture seule** (`/document`) s'il n'est pas déjà
   ouvert — aucune écriture ;
2. **relit la révision courante (`GET /document`) même quand l'onglet est déjà
   ouvert et propre** : la révision chargée à l'ouverture de l'onglet peut être
   périmée, et comparer cette valeur masquerait une divergence que le save
   suivant révélerait par un 409 trompeur ;
3. compare la révision ainsi relue à la révision de base journalisée ;
4. installe la source journalisée comme **modification non enregistrée**
   ordinaire (`source` ≠ `doc.source`).

Aucun `/apply` n'est envoyé, aucun octet du fichier ne change. Si le fichier a
changé entre-temps, le bandeau de résultat le dit explicitement, **sans jamais
prétendre dans la même phrase que le disque est inchangé** : la récupération
n'a rien écrit, et le fichier a changé parce qu'un autre écrivain l'a modifié.
La source journalisée est proposée **pour comparaison**, et un enregistrement
explicite resterait un enregistrement normal (préconditions de révision
existantes, avertissement visible). La récupération ne fusionne rien et ne
décide rien.

### 7. Le bandeau propose, il n'agit pas

Au montage, pour le scope courant, s'il existe au moins une entrée, un bandeau
`role="alert"` nomme le fichier et l'âge de la modification (« il y a 4 min »)
et dit que rien n'a été écrit sur le disque. Il porte « Récupérer les
modifications » et « Ignorer ». **Aucune action automatique** : rien n'est
ouvert, appliqué ni enregistré par le seul affichage. S'il y a plusieurs
entrées, la plus récente est proposée et le nombre d'autres est annoncé ; chaque
action traite une entrée, puis la suivante devient disponible.

### 8. Échec de stockage : silencieux dans la fonction, visible une fois

`localStorage` absent, désactivé, plein ou refusant l'écriture est traité
comme une **non-journalisation**, jamais comme une erreur de l'éditeur : les
fonctions du journal ne lèvent pas, elles renvoient un statut. Le workbench
affiche un avertissement **une fois par raison** (`role="status"`,
`data-recovery-warning`), sans bloquer l'édition ni l'enregistrement. Un échec
d'écriture n'est jamais une troncature : soit l'entrée est écrite entière, soit
rien n'est écrit.

### 9. Désactivable, et la préférence est conservée

Une case **« Journal de récupération »** dans *Options* active/désactive les
nouvelles copies, préférence enregistrée. Désactiver n'efface pas les entrées
existantes : elles restent proposées jusqu'à « Récupérer » ou « Ignorer », ce qui
est dit dans le panneau. La valeur par défaut est activée.

### 10. Corrections issues de la revue indépendante (18 novembre 2026)

La revue `docs/operations/REVIEW-2026-11-18-CLIENT-TRANCHES.md` a relevé six
défauts dans les tranches onglets + journal. Ils sont corrigés sans changer le
contrat HTTP, sans écriture automatique et sans nouvelle dépendance :

| Défaut | Correction |
|---|---|
| **D1** — une frappe pendant un `/apply` en vol était remplacée par la source disque, après effacement de l'entrée de journal | au retour du save, si la source vivante diffère de la source **envoyée**, aucun rechargement : seules `hash`/`identity` de la réponse sont adoptées, le tampon reste modifié non enregistré et l'entrée de journal est conservée puis réécrite avec la source vivante |
| **D2** — fermer un onglet pendant un save n'était pas bloqué | `closeTab()` refuse pendant `busy` avec un message explicite (les appels internes qui possèdent déjà `busy`, comme la suppression de fichier, passent `force`) et « Fermer sans enregistrer » est désactivé pendant le save |
| **D3** — `baseHash` était réécrit avec la révision disque courante après une récupération | une entrée conserve sa base d'origine tant qu'aucune sauvegarde n'a réussi pour ce fichier ; un save accepté est le seul rebasage légitime |
| **D4** — récupération sur un onglet déjà ouvert et propre sans relecture du disque | `GET /document` est relu avant la comparaison, même pour un onglet déjà ouvert |
| **D5** — message de divergence contradictoire (« fichier inchangé » puis « a changé ») | le texte sépare les deux faits : la récupération n'a rien écrit, et le fichier a changé parce qu'un autre écrivain l'a modifié |
| **D6** — « Fermer sans enregistrer » laissait l'entrée, reproposée après rechargement | fermer en abandonnant supprime l'entrée de ce fichier pour ce scope |

## Preuves exécutées

| Niveau | Preuve | Résultat |
|---|---|---|
| 1 — `npm run check` | suite complète, dont `tests/client-recovery.test.mjs` (7 tests) | **598/598 PASS / 0 FAIL** (591 avant cette tranche) |
| 2 — navigateur réel | `--grep=recovery:` : 7 specs × Chromium 145.0.7632.6 + Firefox 146.0.1 | **14 PASS / 0 FAIL**, **47 vérifications par moteur** (94 au total) |
| 2 — non-régression ciblée | `--grep=tab:` (8 PASS), `conflict:` (4), `panel:` (6), `a11y:` (8), `png:` (12) × 2 moteurs | **38 PASS / 0 FAIL** |
| 1 — corrections D1–D6 | `node --test tests/client-recovery.test.mjs tests/client-tabs.test.mjs` | **19/19 PASS / 0 FAIL** (11 tests journal, 8 tests onglets, dont 5 nouveaux) |
| 1 — non-régression save/load | `client-save-recovery`, `client-css-integration`, `client-html-integration`, `client-pen-integration`, `client-file-picker` | **36/36 PASS / 0 FAIL** |
| 2 — corrections D1/D3/D4/D6 | `--grep=recovery:` : 11 specs × Chromium 145.0.7632.6 + Firefox 146.0.1 | **22 PASS / 0 FAIL / 0 NOT_RUN**, **67 vérifications par moteur** (134 au total) |
| 3 — DSH réel / Desktop | non exécuté pour cette tranche (consigne : pas de vrai DSH, pas d'Electron) | **NOT_RUN** |

Le niveau 2 simule le crash par un **rechargement de page** (`page.reload()`),
qui détruit l'état du renderer exactement comme un plantage, mais pas un
processus tué : un vrai crash du navigateur ou de l'application n'a pas été
exécuté. Un `NOT_RUN` n'est pas un succès, et le niveau 2 ne remplace pas le
niveau 3.

Détail des vérifications navigateur (par moteur) :

- édition SVG non enregistrée → entrée locale (0 `/apply`, octets disque
  intacts) → rechargement → bandeau nommant `accueil.svg` et son âge, aucune
  lecture de document automatique → clic « Récupérer » → la source est dans
  l'éditeur, **0 `/apply`**, fichier disque byte-identique, bandeau retiré,
  résultat annonçant « Aucune écriture » ;
- « Ignorer » supprime l'entrée, un nouveau rechargement n'affiche plus rien ;
- une sauvegarde réussie vide l'entrée ; un rechargement n'offre plus rien ;
- deux espaces de travail avec **deux dossiers réels distincts** : l'entrée de
  `ws-atelier-a` porte `w:ws-atelier-a` et n'apparaît jamais pour
  `ws-atelier-b` ; revenir sur A repropose la source exacte, et la récupération
  ne modifie aucun des deux fichiers ;
- `Storage.prototype.setItem` patché pour lever `QuotaExceededError` sur les clés
  du journal : avertissement affiché **une fois**, aucune entrée stockée, le
  texte édité reste dans l'éditeur, la seconde frappe ne répète pas le message,
  aucune erreur de page, et « Save source » écrit normalement le fichier ;
- la case « Journal de récupération » de *Options* désactive réellement les
  copies, la préférence (`'0'`) survit à un rechargement, aucune entrée n'est
  écrite tant qu'elle est décochée, et la réactivation journalise de nouveau
  sans rechargement ;
- un fichier remplacé sur le disque entre la journalisation et la récupération
  est **signalé** (« le fichier a changé sur le disque »), la source journalisée
  est chargée pour comparaison, et les octets arrivés entre-temps restent
  intacts (0 `/apply`) ;
- frappe pendant un save en vol (POST retenu par `page.route`) : la source
  conservée dans l'éditeur est la **seconde frappe**, le disque contient
  exactement la **source envoyée**, un seul `/apply` a été émis, l'onglet reste
  marqué « modifications non enregistrées » et l'entrée de journal existe
  toujours avec la source vivante ;
- base conservée : entrée journalisée sur une révision H1, fichier remplacé par
  H2, récupération → divergence signalée **sans phrase contradictoire**,
  `baseHash` toujours H1 après la réécriture différée, et une **seconde**
  récupération signale encore la divergence ;
- onglet déjà ouvert : l'utilisateur rouvre le fichier proprement, un tiers le
  remplace ensuite, puis « Récupérer » → exactement **un `/document` de plus**
  est relu, la divergence est signalée, le fichier du tiers reste intact ;
- « Fermer sans enregistrer » : l'entrée du fichier est supprimée, aucun
  `/apply` n'est émis, et un rechargement n'offre plus rien ;
- niveau 1 (D2) : pendant un `/apply` retenu, le bouton × de l'onglet et
  « Fermer sans enregistrer » sont désactivés, l'appel direct du handler est
  refusé avec « Enregistrement en cours », puis la fermeture fonctionne après
  la réponse.

Les corrections ont été vérifiées par ces exécutions ciblées ; la **suite
complète** n'a pas été relancée dans cette passe (le lead la relance), et le
niveau 3 reste `NOT_RUN`. Non-régression des onglets en navigateur :
`--grep=tab:` → **8 PASS / 0 FAIL** (4 specs × Chromium + Firefox).

Le niveau 1 couvre en plus le plafond d'entrées : avec 8 entrées préexistantes,
la 9e modification n'est pas journalisée, **aucune entrée existante n'est
remplacée**, le message le dit, et le texte édité reste dans l'éditeur.

## Garanties

- aucune écriture disque n'est déclenchée par la journalisation, l'affichage du
  bandeau ou la récupération : seuls les chemins de sauvegarde existants
  écrivent ;
- la récupération est une action explicite, et une entrée n'est effacée que par
  une sauvegarde réussie (source inchangée), « Ignorer », la fermeture explicite
  d'un onglet modifié sans enregistrer, ou un retour prouvé aux octets du
  disque ;
- une frappe effectuée pendant un `/apply` en vol n'est **jamais** remplacée par
  la source disque : le document n'est pas rechargé, seules les métadonnées de
  révision de la réponse sont adoptées, le tampon reste modifié non enregistré
  et l'entrée de journal est conservée puis réécrite avec la source vivante ;
- une entrée conserve sa révision de base d'origine tant qu'aucune sauvegarde
  n'a réussi pour ce fichier ; une sauvegarde acceptée est le seul rebasage
  autorisé ;
- la clé inclut le scope : aucun partage d'entrée entre deux espaces de
  travail (ni entre deux conversations) ;
- bornes annoncées : 256 Kio par entrée, 8 entrées par scope, refus explicite
  au-delà, jamais de troncature ni d'éviction silencieuse ;
- un `localStorage` indisponible ou plein ne casse ni l'édition ni
  l'enregistrement, et l'échec est signalé ;
- un document dont la source redevient identique au disque est effacé du
  journal au lieu de réapparaître après un crash ;
- la récupération **relit la révision courante (`GET /document`) même pour un
  onglet déjà ouvert**, puis compare et **signale** une divergence au lieu de
  l'ignorer ;
- le message de divergence ne se contredit pas : il distingue « la récupération
  n'a rien écrit » de « un autre écrivain a modifié le fichier » ;
- fermer un onglet pendant un save est refusé avec un message clair, et le
  bouton de confirmation est désactivé pendant l'écriture.

## Non-garanties (documentées, pas dissimulées)

- **Ce n'est pas une sauvegarde.** C'est une copie unique, locale, de la
  dernière source éditée, supprimée dès qu'elle devient inutile. Aucune
  version, aucune corbeille, aucun retour arrière après « Ignorer » ou après une
  sauvegarde.
- **Ne survit pas au nettoyage du navigateur** : « Effacer les données de site »,
  navigation privée, changement de profil de navigateur, autre navigateur,
  autre machine ou autre `DSH_HOME` ne retrouvent rien. Aucun test ne couvre ces
  suppressions, par construction.
- **Ne chiffre rien.** Le contenu est stocké en clair dans `localStorage` ; il
  est lisible par tout script de la même origine et par quiconque accède au
  profil du navigateur. C'est une raison de plus pour ne jamais journaliser autre
  chose que le document édité.
- **Ne journalise pas les brouillons de texte inline** : un `textDraft` non
  validé (édition de texte SVG) vit dans l'état du renderer et n'est pas dans
  `source` ; il est perdu par un crash. Le journal ne couvre que la source.
- **Ne restaure pas la session** : onglets, sélection, caméra, Undo/Redo et
  inspecteurs ne sont pas persistés (ADR-034) ; seule la source des documents
  modifiés l'est.
- **Pas de fusion de révisions.** Si le fichier a changé sur le disque, la
  récupération charge la source journalisée pour comparaison et le dit ; un
  enregistrement explicite reste un enregistrement normal et remplacerait la
  version courante. Aucun diff à trois voies n'est calculé.
- **Une entrée par fichier et par scope, écrasée par le dernier onglet.** Deux
  onglets du même navigateur éditant le même fichier partagent la même clé : la
  dernière copie gagne, l'autre n'est pas conservée séparément.
- **La borne de 256 Kio est mesurée sur la charge utile JSON sérialisée**
  (source + métadonnées), pas sur le seul fichier : un document proche de la
  limite peut être refusé alors qu'il pèse un peu moins de 256 Kio sur disque.
- **Pas d'éviction** : une 9e modification simultanée n'est pas journalisée tant
  qu'une entrée n'est pas récupérée ou ignorée ; le message le dit.
- **Le quota est partagé avec le reste de l'origine** (les autres données de DSH
  Web) : le journal peut échouer alors que son propre budget est respecté ; il
  le signale une fois.
- **L'âge affiché est celui de la dernière copie**, pas de la première
  modification : il se rafraîchit pendant la frappe.
- **En vue de conversation**, la clé utilise `s:<sessionId>` (la vue n'a pas
  d'identifiant d'espace de travail) : l'isolation est par session, pas par
  dossier. Deux sessions pointant le même dossier ne partagent pas d'entrée.
- **Un fichier supprimé sur le disque ne peut pas être rouvert** : la
  récupération échoue avec un message et l'entrée reste disponible (elle n'est
  pas silencieusement perdue, mais elle n'est pas transformée en fichier non
  plus).
- **Niveau 3** (`npm run test:dsh`, Desktop/Electron) : `NOT_RUN`.

## Alternatives rejetées

| Alternative | Pourquoi non |
|---|---|
| Enregistrer automatiquement avant la fermeture (`beforeunload` + `/apply`) | Écriture implicite, interdite par ADR-0002 ; non annulable et surprenante si l'utilisateur ne voulait pas enregistrer. |
| Garder un journal des patches (`/apply` différés) | Rejouer des patches sur une révision périmée est un conflit silencieux : il faudrait une fusion, donc une décision produit qui n'existe pas. La source exacte est plus simple et plus honnête. |
| Stocker le journal dans un fichier de l'espace de travail | Écrit dans le projet de l'utilisateur (bruit, conflits de synchronisation, dépôt Git), et `localStorage` est le seul stockage local borné déjà disponible sans nouvelle route Host. |
| Une seule entrée « dernière modification » | Perd le travail des autres onglets modifiés, alors qu'ADR-034 en autorise 8. |
| Évincer l'entrée la plus ancienne au-delà de 8 | Détruit silencieusement le travail d'un autre fichier ; un refus explicite est plus sûr. |
| Journaliser les diffs pour économiser l'espace | Un diff n'est récupérable que sur la révision exacte d'origine ; la source entière reste récupérable même si le fichier a changé. |
| Restaurer automatiquement au montage | L'utilisateur ne saurait pas si le fichier sur disque a été remplacé par une copie locale ; le bandeau explicite est le seul comportement acceptable. |
| Chiffrer le journal dans le navigateur | Fausse sécurité : la clé devrait être stockée à côté, et le besoin réel est de ne rien journaliser d'autre que le document. |
