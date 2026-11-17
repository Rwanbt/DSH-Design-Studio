# ADR-023 — Plugin interne à DeepSeek Harness : contrat d'intégration

**Statut :** accepté · **Date :** 17 novembre 2026 · **Contexte :** gate G0, cadre produit.

## Décision de cadrage

DSH Design Studio **n'est pas une application externe**. C'est un **bundle de plugin interne à DeepSeek Harness** :

- aucune application autonome, aucun processus Electron séparé, aucune fenêtre propre, aucun port à gérer ;
- aucune étape de build : le paquet publie son source, DSH charge le Host et le client ;
- l'installation se fait **dans un profil DSH** (`dsh plugin --profile <nom> add …`), pas par un installateur système ;
- l'interface vit dans une vue DSH (`conversation.view`), à côté de la conversation, et hérite de son thème, de sa langue et de son espace de travail.

Toute formulation antérieure parlant de « build Desktop » ou d'« application à packager » était un abus de langage : elle est corrigée dans `docs/operations/`.

## Points d'intégration réellement utilisés

| Point | Contrat | Où |
|---|---|---|
| Bundle | `package.json` → `dsh.bundle.patch` → `cordis.patch.yml` insère `{id, name}` dans l'arbre Cordis | `package.json`, `cordis.patch.yml` |
| Entrée Host | `apply(ctx)` + `export const inject = ['webServer','agents','workingDirectory']` | `src/plugin-host.mjs` |
| Routes HTTP | `ctx.webServer.register({kind:'prefix', path:'/design-studio-native', handler})`, libéré via `ctx.effect` | `src/plugin-host.mjs` |
| Session/workspace | `ctx.agents.get(sessionId)` puis `ctx.workingDirectory.ensure(session)` — jamais un chemin fourni par le client | `src/plugin-host.mjs` |
| Entrée client | `window.__ModuleLoader__.load({id, factory(require)})`, `require('react')` fourni par DSH | `client.js` |
| Manifeste client | `dsh.client = {platform:'web', immediately:true, inject:['slots']}` et **`exports['./client.js']`** (DSH demande `<paquet>/client.js`) | `package.json` |
| Slot | `ctx.slots.inject('conversation.view', …)` + `slots.register({name, id, order, label}, Studio)` | `client.js` |
| Props | la vue reçoit `sessionId` du shell DSH ; tout appel Host l'exige | `client.js` |
| Profil Desktop | le profil `desktop` est **créé et possédé par l'application Electron** ; la CLI refuse de le créer et exige un premier démarrage complet avant `dsh plugin --profile desktop add` | vérifié, `tests/e2e/desktop-shell.mjs` |
| Livraison Desktop | l'application Desktop ne charge pas l'origine HTTP : elle rend `dsh-app://app/` et sert les bundles par son protocole, en URLs groupées `plugins/??<id>/client.js&rev=<hash>` | vérifié (HTTP 200, 106 855 octets) |
| Runtime Desktop | le shell démarre son propre runtime et publie `dsh web: http://127.0.0.1:<port>/?token=…` ; les routes du plugin y répondent (401 sans authentification, 200 avec le token du shell) | vérifié |

## Contrat de thème

L'interface doit être peinte par le thème de l'hôte. Constat de la session : l'alpha référençait `--dsw-alias-surface-1`, `--dsw-alias-surface-2`, `--dsw-alias-content-primary` et `--dsw-alias-border`, **qui n'existent pas** dans `@deepseek-ai/dsh-client-ui-theme` (450 tokens vérifiés sur DSH 0.2.2-rc.3). Les valeurs de repli gagnaient donc toujours : le workbench **ne suivait pas** le thème DSH, contrairement aux apparences.

Décision :
1. seuls des **tokens sémantiques réels** sont utilisés : `--dsw-alias-bg-base`, `-bg-layer-1/2`, `-border-l1/l2`, `-label-primary/secondary/tertiary`, `-state-error-primary`, `-state-warn-primary`, `--dsw-font-family` ;
2. chaque usage garde une **valeur de repli hexadécimale**, pour que le plugin se rende aussi hors DSH (harnais, tests unitaires) ;
3. l'**accent Graphite** (`#bda991`, états sélectionnés `#51483d`/`#574939`/`#494034`) reste une décision de design assumée (ADR : direction V3 Graphite) et n'est pas remplacé par `--dsw-alias-brand-primary` ;
4. deux garde-fous automatiques : `tests/dsh-theme-tokens.test.mjs` échoue si un nom de token inconnu apparaît, et la spec navigateur `dsh-theme` injecte une palette claire et vérifie que les surfaces/textes suivent réellement.

## Ce qui reste à intégrer (assumé, non fait)

- **Raccourcis DSH** : Ctrl+Z/Ctrl+D sont gérés localement par le workbench ; les enregistrer via le service de raccourcis de DSH demanderait l'injection de ce service et une revue de conflits clavier.
- **i18n** : l'interface mélange français et anglais ; DSH expose un paquet de locale qui n'est pas encore consommé.
- **Carte de réglages / palette de commandes** : aucun point d'entrée DSH au-delà de la vue.
- **Entrée dans la barre latérale** : décidée et cadrée dans [ADR-024](ADR-024-SIDEBAR-PANEL-INTEGRATION.md) — un panneau `main` + `sidebar.panellist`, donc une surface Host cadrée par espace de travail (un panneau `main` ne reçoit aucune session). Non encore implémenté.
- **Tour réel dans le Desktop** : la vue est rendue dans le shell, mais un tour assistant y reste non exécuté (profil `desktop` jetable sans adaptateur pour le fournisseur testé → `NO_ADAPTER`).
- **Connexion au compte** : la fenêtre « bienvenue » et l'assistant de premier démarrage sont traversés par script dans les tests, pas validés manuellement.
- **Cycle d'ouverture** : le renderer Electron est désormais prouvé (voir § « Desktop » ci-dessous) ; ce qui n'est pas fait relève des points ci-dessus, pas du rendu.

## Desktop (Electron) — ce qui a réellement changé le diagnostic

Piloter le shell a révélé **un second chemin de livraison** que les tests Web ne peuvent pas voir : la même vue est servie depuis `dsh-app://app/` par le protocole de l'application, en URLs groupées. Un bundle qui ne fonctionnerait que sur l'origine HTTP aurait passé toutes les preuves Web et cassé chez l'utilisateur Desktop.

Conséquences pour tout futur point d'intégration :
1. ne jamais supposer que l'origine est HTTP : les chemins relatifs doivent rester relatifs, jamais construits sur `location.origin` ;
2. le profil `desktop` ne se crée pas par la CLI : l'installation utilisateur passe par un premier démarrage, puis `dsh plugin --profile desktop add` ;
3. les routes Host du runtime desktop exigent le token du shell ; un test qui les appelle anonymement doit attendre un 401, pas contourner l'authentification ;
4. le thème doit être lu à l'exécution (le Desktop de cette machine est en thème clair) : une valeur codée en dur reste invisible en test et fausse en production ;
5. les URLs du client restent **relatives** : `new URL('/' + api + endpoint, document.baseURI)` fonctionne depuis `dsh-app://app/` parce que l'application transmet ces chemins au runtime — vérifié fonctionnellement en listant un fichier sonde depuis le panneau, pas seulement en rendant la vue.

## Conséquences

- La « release » d'un plugin interne est une **version de paquet installable dans un profil**, pas un installateur : la checklist de release est reformulée en conséquence.
- Les tests d'intégration doivent viser les contrats ci-dessus : le harnais simulateur reproduit uniquement le shell client, et `tests/e2e/real-dsh.mjs` vérifie le reste dans le vrai produit.
- Toute nouvelle dépendance à un service DSH doit être ajoutée à `inject` **et** prouvée par le test d'installation réel, sinon le bundle est silencieusement ignoré (c'est exactement le défaut corrigé en début de session).
