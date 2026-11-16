# DSH Design Studio — alpha.13 : concurrence des sauvegardes et validation de chemins

**Date :** 2026-11-16. **Statut :** branche de développement expérimentale, PR #8 en brouillon. Aucune publication.

## Preuve vérifiée

- SHA du code testé : `deb959be98d1807ef2ea0741a42d7c5356d48b54`.
- [GitHub Actions — run 43973328639](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43973328639).
- Commande exécutée : `npm run check`, avec Node.js 22 et `node --test tests/*.test.mjs`.
- Sortie observée : **195 tests / 195 PASS / 0 FAIL / 0 SKIP**. Tests exécutés dans le job GitHub, pas dans une installation DSH réelle.

## Évolutions du stockage

### Verrouillage interprocessus coopératif

- `src/native-write-lock.mjs` : verrou par création atomique d'un répertoire caché `.<nom-du-fichier>.dsh-native.lock` dans le même dossier que le document.
- `src/native-file-store.mjs` : toute mutation passe par le verrou interprocessus **en plus** du verrou Promise local. Après acquisition, le chemin est revérifié, puis l'édition conserve la précondition SHA-256 et le contrôle final du contenu avant remplacement atomique du fichier.
- Le répertoire de verrou est supprimé à la sortie, même si un patch échoue. Un concurrent patiente brièvement (3,5 s par défaut), puis échoue sans écrire s'il ne peut pas prendre le verrou.
- Le routeur expose **HTTP 423** et l'erreur `file-busy` pour cette situation. Une anomalie de nettoyage de verrou renvoie **HTTP 500**, car l'état de l'opération peut nécessiter relecture.
- Les tests utilisent **deux processus Node indépendants** : un seul enregistrement d'une révision donnée aboutit, l'autre reçoit `stale-revision`. Ils vérifient aussi le maintien d'un verrou déjà pris et sa libération après erreur.
- Le verrou est **coopératif** : il ne protège pas contre un autre éditeur, un outil de synchronisation ou un processus qui n'utilise pas ce protocole. Il n'offre donc **pas** un véritable compare-and-swap atomique universel du système de fichiers.

### Récupération après incident

En cas d'arrêt brutal du processus détenteur, un répertoire `.<nom>.dsh-native.lock` peut subsister. **Ne jamais le supprimer sans s'assurer qu'aucun processus DSH Design Studio ne travaille encore sur ce fichier.**

Procédure de récupération manuelle pour un workspace de développement :

1. Fermer **toutes les instances** de DSH Design Studio susceptibles d'écrire le document concerné.
2. Vérifier que le répertoire de verrou caché ne contient aucun fichier légitime ; ne pas supprimer d'autres dossiers du workspace.
3. Supprimer **uniquement** `.<nom-du-fichier>.dsh-native.lock`, puis rouvrir le document et comparer son contenu à l'état attendu.
4. Si un conflit de révision apparaît, privilégier le rechargement et la résolution explicite plutôt que de forcer l'enregistrement.

Aucun mécanisme d'expiration ou de « vol » de verrou n'est utilisé : cela pourrait autoriser deux écritures simultanées.

### Validation portable des chemins

Les composants de chemins rejetés incluent maintenant les noms réservés Windows (CON, AUX, COM1, etc.), les deux-points utilisables pour les flux alternatifs NTFS, les caractères de contrôle et les composants se terminant par un point ou une espace. L'objectif est d'éviter deux chemins logiques vers le même objet sur différents systèmes.

## Gates toujours bloquants

- **NOT_RUN :** installation DSH Desktop/Web réelle, chargement du panneau, gestes souris/touch/pen, UI adaptative et accessibilité.
- **NOT_RUN :** tests multi-OS des verrous (notamment Windows), crash réel pendant la transaction, coupure d'alimentation, contention sur réseau/NFS, audit des races entre vérification de répertoire et `rename`.
- **NOT_RUN :** résistance à un éditeur externe non coopératif modifiant le document entre le dernier hash et le remplacement.
- **NOT_IMPLEMENTED :** véritable CAS atomique portable face aux éditeurs externes ; verrouillage fiable sur toutes les forges et workspaces distants.
- **NOT_IMPLEMENTED :** édition HTML/CSS visuelle, gestion complète des tangentes/groupes/transforms, historique persistant et validation UX professionnelle.

**Décision :** conserver la PR #8 en brouillon vers `dev`. Aucun merge, tag ou release tant que les gates réels de sécurité et d'intégration ne sont pas satisfaits.
