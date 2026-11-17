/**
 * Browser gate spec registry.
 *
 * Every spec receives { page, context, browser, harness, assert, shell } and must
 * only assert behaviour it actually observed in the browser. Each spec runs in a
 * fresh browser context against a fresh temporary workspace.
 *
 * Spec metadata:
 *  - `viewport`        optional viewport override (default 1280x820)
 *  - `contextOptions`  extra Playwright context options (e.g. reducedMotion)
 *  - `allowConsoleErrors` set true when the spec deliberately provokes blocked
 *    untrusted resources and asserts the outcome instead of silencing it
 */
import { mountSpec } from './mount.mjs'
import { svgEditSpec, svgNavigationSpec, svgLayersSpec } from './edit-svg.mjs'
import { htmlSelectSpec, htmlClickInvalidationSpec, htmlLayoutSpec, layoutPresetExtrasSpec, cssRuleSpec } from './edit-web.mjs'
import { externalConflictSpec, refusedWriteSpec, unsavedSourceGuardSpec } from './conflict.mjs'
import { htmlSecuritySpec, svgSecuritySpec, svgRemoteAssetSpec, cssInjectionSpec } from './security.mjs'
import { keyboardSpec, panelsAccessibilitySpec, reducedMotionSpec } from './a11y.mjs'
import { responsiveSpec, performanceSpec } from './responsive-perf.mjs'
import { handleGeometrySpec, zoomGeometrySpec } from './geometry.mjs'
import { hierarchySpec, lockSpec, groupSpec, ungroupSpec, transformSpec, groupDragSpec, nestedPivotSpec } from './structure.mjs'
import { htmlTextSpec, htmlAttributeSpec, htmlTextRefusalSpec } from './edit-html-text.mjs'

export const specs = [
  mountSpec,
  svgEditSpec,
  svgNavigationSpec,
  svgLayersSpec,
  handleGeometrySpec,
  zoomGeometrySpec,
  hierarchySpec,
  lockSpec,
  groupSpec,
  ungroupSpec,
  transformSpec,
  groupDragSpec,
  nestedPivotSpec,
  htmlTextSpec,
  htmlAttributeSpec,
  htmlTextRefusalSpec,
  htmlSelectSpec,
  htmlClickInvalidationSpec,
  htmlLayoutSpec,
  layoutPresetExtrasSpec,
  cssRuleSpec,
  externalConflictSpec,
  refusedWriteSpec,
  unsavedSourceGuardSpec,
  htmlSecuritySpec,
  svgSecuritySpec,
  svgRemoteAssetSpec,
  cssInjectionSpec,
  keyboardSpec,
  panelsAccessibilitySpec,
  reducedMotionSpec,
  responsiveSpec,
  performanceSpec,
]
