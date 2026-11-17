# ADR-022 — Frontière de sécurité de l'aperçu HTML, revérifiée en navigateur réel

**Statut :** accepté (remplace partiellement les hypothèses d'ADR-017) · **Date :** 17 novembre 2026 · **Contexte :** gate G2.

## Contexte

ADR-017 a choisi un iframe `srcDoc` avec `sandbox="allow-same-origin"`, **sans `allow-scripts`**, sous CSP restrictive, et a explicitement laissé les tests de sécurité réels en `NOT_RUN`. Tant qu'aucun navigateur n'évalue la frontière, cette décision reste une hypothèse.

## Ce qui a été mesuré

Une fixture hostile a été chargée dans l'aperçu réel (Chromium 145 et Firefox 146) : `<script>`, handlers `on*` inline, `javascript:`, `<img>`, `<iframe>` et `<object>` distants, `<form action>` distant, `@import` et `url()` dans une feuille liée, `<meta http-equiv="refresh">`, `<base href>`, `dns-prefetch` et `prefetch`.

Résultats observés, avant et après durcissement :

| Vecteur | Résultat mesuré | Garantie |
|---|---|---|
| `<script>` du document | n'exécute pas (`window.__pwned` reste `undefined`, frame et parent) | CSP `script-src 'none'` + absence de `allow-scripts` |
| `onclick`/`onload` inline | n'exécutent pas | idem |
| `javascript:` sur un lien | aucun effet même après clic | handler parent `preventDefault` + pas de scripts |
| `<img>`, `<object>`, `<iframe>`, `<link>`, `<form>` distants | **aucune réponse** reçue ; requêtes bloquées avant le réseau (Firefox) ou tentative bloquée (Chromium) | `default-src 'none'`, `img-src data:`, `connect-src 'none'`, `frame-src 'none'`, `form-action 'none'` |
| `@import`/`url()` dans le CSS local lié | jamais projetés dans l'aperçu | projection bornée côté Host (ADR-018) |
| lien externe cliqué | la page DSH ne navigue pas | `frame-src 'none'`, `form-action 'none'`, handler parent |
| **`<meta http-equiv="refresh">`** | **neutralisé dans les deux moteurs** par `sandbox="allow-same-origin"` seul (mesuré isolément : sans sandbox, la navigation aboutit ; avec notre sandbox, non) | sandbox + neutralisation de la projection |
| `<base href>` | sans effet (résolution d'URL non détournée) | CSP `base-uri 'none'` + neutralisation de la projection |

## Décision

1. **Conserver** l'architecture d'ADR-017 : `sandbox="allow-same-origin"` sans `allow-scripts`, CSP stricte, aperçu SVG en `sandbox=""`.
2. **Ajouter une seconde couche** : la projection de l'aperçu supprime `<meta http-equiv="refresh">` et `<base>` par expression régulière. L'aperçu est une projection, jamais le fichier : cette suppression ne modifie aucun octet du document et ne retire aucun contenu visuel.
3. **Ne pas dépendre d'un seul comportement de navigateur** pour une frontière de sécurité : le sandbox neutralise déjà la navigation, la projection le garantit indépendamment.
4. **Conserver le harnais de test** comme preuve permanente : la fixture hostile et les assertions (aucune réponse d'origine non fiable, aucun script exécuté, frame toujours `about:srcdoc`, aucun `meta refresh`/`base` dans le `srcDoc`) font partie du gate navigateur, exécuté sur les deux moteurs.

## Limites assumées

- Le test mesure ce que font **ces versions** de Chromium et Firefox ; il ne prouve pas l'absence de faille future dans un moteur.
- Le handler de sélection du parent lit le DOM inerte : toute nouvelle capacité (scripts, `postMessage`, ressources externes) exigerait une nouvelle revue et un nouvel ADR.
- Aucun audit de sécurité indépendant par un tiers n'a été réalisé.
