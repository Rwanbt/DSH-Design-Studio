# ADR-017 — Sélection HTML directe sans exécuter le JavaScript du document

**Date :** 2026-11-17 · **Statut :** expérimental (acceptation de principe pour alpha.17 ; contrôle navigateur réel encore NOT_RUN) · **Issue :** #10.

## Problème

L'alpha.16 ne permettait de sélectionner les éléments HTML que depuis la liste des identifiants. Cliquer sur le rendu devait sélectionner un élément vérifié **sans** exposer le document non fiable au DOM de DSH ni importer un moteur de navigateur externe.

La prévisualisation existante utilise un `iframe srcDoc`, un CSP interdisant réseau/scripts et une source HTML conservée byte-pour-byte pour les éditions natives.

## Décision retenue pour le prototype

1. La prévisualisation HTML/HTM conserve **`srcDoc`** et définit `sandbox="allow-same-origin"`, **sans `allow-scripts`**, `allow-top-navigation`, `allow-forms` ou `allow-popups`. SVG reste en sandbox opaque `sandbox=""`.
2. Le CSP explicite **`script-src 'none'`**, `object-src 'none'`, `connect-src 'none'`, `frame-src 'none'`, `form-action 'none'`, `base-uri 'none'`. Images et fontes sont limitées aux URL `data:`; styles inline uniquement.
3. Le code JavaScript **de confiance dans le parent DSH** inspecte `frame.contentDocument` pendant `onLoad` et n'attache un écouteur `click` en phase capture que si `document.URL==='about:srcdoc'`. **Aucun script ni pont `postMessage` n'est injecté dans le HTML utilisateur.**
4. La sélection est acceptée seulement si l'ID DOM est valide, apparaît exactement une fois dans le **modèle HTML issu du fichier**, appartient à une balise autorisée, est **éditable**, correspond exactement à la balise DOM et apparaît **une seule fois** dans le DOM réellement rendu.
5. L'écouteur vérifie la session, le chemin du document, le jeton d'identité, l'absence de brouillon source, et l'état non-bloqué. Les événements synthétiques déclarés `isTrusted=false` sont ignorés ; les clics dans la prévisualisation sont neutralisés (`preventDefault`) pour ne pas suivre des liens ou activer des contrôles.
6. L'écouteur est retiré au rechargement du document et avant le branchement d'un autre iframe. Un iframe navigué, inaccessible, d'identité obsolète ou ambigu est **non sélectionnable**.
7. La sélection ne sauvegarde rien. Les actions de propriété utilisent **le même Host natif** avec `baseHash`, `baseIdentity`, contrôle des valeurs CSS et Undo/Redo.

## Justification et alternatives

L'iframe initialement en sandbox opaque était très isolé, mais le parent ne pouvait pas lire les éléments sur lesquels l'utilisateur cliquait. Les autres options étaient :

- **Pont de messages injecté dans un iframe opaque** : demanderait `allow-scripts` et une politique CSP à nonce, une procédure de sanitisation du document et la validation de chaque message/nonce/origine/source/revision. Cela ajoute une nouvelle surface d'exécution dans un contexte non fiable. **Différé** pour une comparaison indépendante.
- **Reconstituer un DOM HTML entièrement côté parent** : lourd, erreurs de rendu/sélecteurs/layout possibles, code supplémentaire important.
- **`allow-same-origin` sans scripts** : permet au parent de lire le DOM, sans lancer les scripts utilisateur. Choix expérimental, avec les validations listées ci-dessus.

Référence sur le comportement des navigateurs : https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe (MDN précise que le parent same-origin peut accéder au DOM même si `allow-scripts` est absent ; l'activation simultanée `allow-scripts` + `allow-same-origin` est déconseillée).

## Menaces / limites de cette décision

- **NE JAMAIS ajouter `allow-scripts` à cet iframe** sans nouvelle ADR et revue de sécurité : combiné avec `allow-same-origin`, cela peut annuler les protections de la sandbox.
- `allow-same-origin` retire la protection d'origine opaque. Le maintien d'un aperçu inerte dépend donc de l'absence de scripts et du CSP ; un audit avec Firefox/Chromium réel et le futur DSH Host est obligatoire.
- Le contenu HTML est injecté dans `srcDoc` sans sanitisation DOM complète ; des cas de parsing, métadonnées HTML, redirections, navigation et sélecteurs malveillants doivent être soumis à des tests navigateur et à une revue de sécurité.
- `isTrusted` et les contrôles d'ID constituent des barrières supplémentaires, **pas** un mécanisme de sécurité suffisant à eux seuls.
- La sélection ne gère pas les éléments sans ID, IDs dupliqués, nœuds générés par JS, shadow DOM, pseudo-éléments, SVG embarqué, composants de frameworks ou source HTML non directement adressable.
- Les tests React DOM sont simulés : aucun résultat CI de cette étape ne démontre le comportement d'iframe dans un navigateur.

## Conditions d'acceptation définitives

- Tests **réels** dans Firefox et Chromium avec scripts injectés, liens `javascript:`, meta refresh, formulaires, frames imbriquées, shadow DOM, ID dupliqués et attr rebinding.
- Démonstration que les scripts du document utilisateur ne peuvent pas accéder à DSH ou à ses sessions ; aucune requête réseau involontaire.
- Vérification souri/tactile/clavier, sélection imbriquée, navigation, changement de fichier, Undo et état source non enregistré.
- Étude contradictoire avec une isolation opaque + pont strict, et validation de la décision G2 dans `docs/roadmap/DELIVERY-GATES-2026-11-17.md`.

**Gate G2 : PARTIAL. Gate G0 DSH réel : NOT_RUN. Pas de release ni promotion de sécurité.**
