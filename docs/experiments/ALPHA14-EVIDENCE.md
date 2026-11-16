# DSH Design Studio — alpha.14 : identité des fichiers et contrôle des remplacements

**Date :** 16 novembre 2026. **État :** PR #8 en brouillon vers `dev`, non distribuée.

## Preuves réellement exécutées

- Code testé au SHA **`733e7573f1a303aec621e706df63705840cda8f6`**.
- [GitHub Actions — run 43975858834](https://github.com/Rwanbt/DSH-Design-Studio/actions/runs/43975858834), `npm run check` sous Node.js 22.
- Résultat observé dans les logs : **199 tests exécutés, 199 PASS, 0 FAIL, 0 SKIP**.
- Le parcours d'intégration est simulé pour React et l'hôte DSH, mais les tests de fichiers utilisent le vrai système de fichiers Linux de GitHub Actions. **Le plugin n'a pas été installé dans l'application DSH réelle (NOT_RUN).**

## Modifications dans le code

### Nouveau jeton de révision `identity`

- `readChecked` lit désormais les métadonnées d'identité du fichier par des descripteurs ouverts avec `stat({bigint:true})` : périphérique, inode, taille, `ctimeNs` et `mtimeNs`.
- La lecture contrôle à nouveau les métadonnées à la fin, afin de refuser un fichier modifié pendant la lecture.
- Un jeton opaque SHA-256 `identity` est calculé à partir de ces métadonnées **et** du SHA-256 du contenu. Il est renvoyé avec `document.hash`, sans divulguer l'inode ni les chemins du système.
- Le client envoie désormais **`baseIdentity` avec `baseHash`** lors des écritures natives et de l'Annuler/Rétablir. Le routeur puis le stockage refusent `409 stale-revision` si le contenu ou l'identité ont changé.
- Pour ne pas casser brutalement les tests et clients plus anciens, `baseIdentity` reste **optionnel à l'API** à cette étape : la nouvelle protection de remplacement entre deux requêtes n'est garantie que pour les clients qui la transmettent. Le client alpha.14 le fait ; une obligation stricte côté serveur nécessite une migration API versionnée.

### Validation de la chaîne de répertoires

- `ensureSafeFile` conserve un instantané périphérique/inode pour la racine, les répertoires parents et le fichier ciblé.
- À l'entrée de la section critique, puis avant de remplacer le fichier, le stockage vérifie que **tous les composants du chemin** ont conservé leur identité. Un parent échangé pendant l'attente d'un verrou est refusé.
- Le fichier ouvert est confronté à son identité de répertoire ; le fichier temporaire est également vérifié avant `rename`.
- Après `rename` et `fsync` du dossier, le stockage relit le fichier final, contrôle son SHA et son identité, et renvoie la nouvelle identité.
- Les nouveaux contrôles ne remplacent **pas** un `renameat2` ou un `openat2` sécurisé sur descripteurs de répertoires : des permutations malveillantes entre la dernière vérification et le `rename` restent possibles avec les APIs de chemins Node.js. Ce point demeure **BLOCKED pour une certification complète de sécurité**.

## Scénarios nouveaux vérifiés

1. Un document est ouvert ; un autre fichier est renommé à sa place **avec exactement le même contenu**. Le SHA du contenu reste identique, mais le nouveau jeton d'identité force `409` et empêche d'écraser la nouvelle entrée.
2. Le remplacement du fichier avec les mêmes octets est également refusé pour une opération sans changement (patch vide) quand le jeton initial est fourni.
3. Un répertoire parent est remplacé pendant qu'un appel attend le verrou d'écriture : l'identité de la chaîne de chemin diffère, le nouvel emplacement reste inchangé et le write est rejeté.
4. Une vraie requête Host transmettant l'ancien `baseIdentity` renvoie `409`, puis une requête avec un jeton rafraîchi peut aboutir.
5. L'interface Plume transmet le jeton d'identité sur toutes les sauvegardes et les opérations Annuler, confirmé par un test Client → Host → fichiers temporaires.
6. La suite préexistante couvre les verrous interprocessus, les conflits, les opérations SVG, les textes, l'édition manuelle source et les tests du canevas.

## Risques et jalons ouverts

- **NOT_RUN :** chargement réel de DSH Desktop/Web. Le tunnel de connexion au poste utilisateur était indisponible durant cette session.
- **NOT_RUN :** Windows/macOS, réseau/NFS, coupure de courant, alias de répertoires, snapshots, sauvegarde pendant renommage hostile ultrarapide, tests réels souris/mobile et audit sécurité externe.
- **LIMITATION :** les clients API anciens ne transmettant pas `baseIdentity` gardent seulement la protection par hash de contenu ; rendre ce champ obligatoire exige une transition API.
- **LIMITATION :** des modifications externes intervenant après la dernière validation et avant le renommage peuvent encore échapper aux contrôles ; le verrou créé à l'alpha.13 ne s'applique qu'aux processus coopérants.
- **NOT_IMPLEMENTED :** édition visuelle HTML/CSS complète, mode Bézier lissé/symétrique, groupes vectoriels, historique persistant, finition UX.
- Aucune exécution ne justifie de promouvoir l'éditeur comme production-ready.

**Décision :** PR #8 reste **DRAFT vers `dev`**. Aucune fusion `main`, aucun tag, aucune release.
