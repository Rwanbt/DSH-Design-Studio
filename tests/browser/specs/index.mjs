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
import { dshThemeSpec } from './dsh-theme.mjs'
import { svgEditSpec, svgNavigationSpec, svgLayersSpec } from './edit-svg.mjs'
import { htmlSelectSpec, htmlClickInvalidationSpec, htmlLayoutSpec, layoutPresetExtrasSpec, cssRuleSpec, cssMediaEditSpec, cssMediaExclusiveSpec, cssMediaDeleteSpec } from './edit-web.mjs'
import { externalConflictSpec, refusedWriteSpec, unsavedSourceGuardSpec } from './conflict.mjs'
import { htmlSecuritySpec, svgSecuritySpec, svgRemoteAssetSpec, cssInjectionSpec } from './security.mjs'
import { keyboardSpec, panelsAccessibilitySpec, reducedMotionSpec } from './a11y.mjs'
import { responsiveSpec, performanceSpec } from './responsive-perf.mjs'
import { handleGeometrySpec, zoomGeometrySpec } from './geometry.mjs'
import { hierarchySpec, lockSpec, groupSpec, ungroupSpec, transformSpec, groupDragSpec, nestedPivotSpec, alignmentSpec, alignmentRefusalSpec, alignLockedAncestorSpec, distributeSpec, distributeVerticalSpec, distributeRefusalSpec, distributeNoopSpec, distributeTextSpec } from './structure.mjs'
import { htmlTextSpec, htmlAttributeSpec, htmlTextRefusalSpec } from './edit-html-text.mjs'
import { landingSpec, landingEmptySpec } from './landing.mjs'
import { createSpec, createCssSpec, createFeedbackSpec, createRefusalSpec } from './create.mjs'
import { panelSpec, panelUnavailableSpec, panelEmptySpec } from './panel.mjs'
import { renameFileSpec, deleteFileSpec, cancelDeleteSpec } from './file-admin.mjs'
import { layerMenuSpec, layerMenuRowSpec, copyPasteSpec, pasteMenuSpec, reorderSpec, layerDragSpec } from './layer-menu.mjs'
import { renameLayerSpec, renameMenuSpec, renameRefusalSpec, renameHostRefusalSpec, renameUndoSelectionSpec } from './rename.mjs'
import { geometryInspectorSpec, fillInspectorSpec } from './inspector.mjs'
import { artboardWidthSpec, artboardContentSpec, artboardNoViewBoxSpec, artboardRefusalSpec } from './artboard.mjs'
import { strokeCreateSpec, strokeRefusalSpec } from './stroke.mjs'
import { touchSelectSpec, accessibleTreeSpec } from './touch-a11y.mjs'
import { gradientStopEditSpec, gradientInheritedReadOnlySpec, gradientNotReferencedSpec } from './gradient.mjs'
import { graphiteReferenceSpec, graphiteWelcomeSpec } from './graphite-reference.mjs'
import { graphiteEllipseSpec, graphiteExampleSpec } from './graphite-interactions.mjs'
import { graphiteCreationToolSpec, graphiteDraftSpec, graphiteExportSpec, graphiteOpacitySpec } from './graphite-workflow.mjs'

export const specs = [
  mountSpec,
  graphiteReferenceSpec,
  graphiteWelcomeSpec,
  graphiteEllipseSpec,
  graphiteExampleSpec,
  graphiteCreationToolSpec,
  graphiteDraftSpec,
  graphiteExportSpec,
  graphiteOpacitySpec,
  landingSpec,
  landingEmptySpec,
  createSpec,
  createCssSpec,
  createFeedbackSpec,
  createRefusalSpec,
  panelSpec,
  renameFileSpec,
  layerMenuSpec,
  layerMenuRowSpec,
  copyPasteSpec,
  pasteMenuSpec,
  reorderSpec,
  layerDragSpec,
  renameLayerSpec,
  renameMenuSpec,
  renameRefusalSpec,
  renameHostRefusalSpec,
  renameUndoSelectionSpec,
  deleteFileSpec,
  cancelDeleteSpec,
  panelUnavailableSpec,
  panelEmptySpec,
  geometryInspectorSpec,
  artboardWidthSpec,
  artboardContentSpec,
  artboardNoViewBoxSpec,
  artboardRefusalSpec,
  strokeCreateSpec,
  strokeRefusalSpec,
  touchSelectSpec,
  accessibleTreeSpec,
  fillInspectorSpec,
  gradientStopEditSpec,
  gradientInheritedReadOnlySpec,
  gradientNotReferencedSpec,
  dshThemeSpec,
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
  alignmentSpec,
  alignmentRefusalSpec,
  alignLockedAncestorSpec,
  distributeSpec,
  distributeVerticalSpec,
  distributeRefusalSpec,
  distributeNoopSpec,
  distributeTextSpec,
  htmlTextSpec,
  htmlAttributeSpec,
  htmlTextRefusalSpec,
  htmlSelectSpec,
  htmlClickInvalidationSpec,
  htmlLayoutSpec,
  layoutPresetExtrasSpec,
  cssRuleSpec,
  cssMediaEditSpec,
  cssMediaExclusiveSpec,
  cssMediaDeleteSpec,
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
