/**
 * Reproducible engine-level benchmark for DSH Design Studio.
 *
 * This measures the pure document pipeline that every open, selection and save
 * goes through: structure scan, editable-node projection, geometry, path model,
 * attribute patch and order patch. It does NOT measure pixels, layout, paint or
 * frame rate: those are browser budgets and live in the browser gate.
 *
 * Usage: node scripts/benchmark.mjs [--json=path]
 */
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { scanSvgDocument } from '../src/svg-document.mjs'
import { listEditableSvgNodes } from '../src/svg-attributes.mjs'
import { svgGeometry } from '../src/svg-geometry.mjs'
import { listSvgPathModels } from '../src/svg-paths.mjs'
import { svgAttributePatch } from '../src/svg-attributes.mjs'
import { svgOrderPatch } from '../src/svg-order.mjs'
import { listCssVisualRuleDetails } from '../src/css-visual.mjs'
import { createNativeFileStore } from '../src/native-file-store.mjs'

const SIZES = [100, 1500, 5000, 10000]
const jsonArg = process.argv.slice(2).find((value) => value.startsWith('--json='))

function svgDocument(count) {
  const rows = []
  for (let index = 0; index < count; index += 1) {
    rows.push('  <rect id="n' + index + '" x="' + (index % 80) * 8 + '" y="' + Math.floor(index / 80) * 8 +
      '" width="7" height="7" fill="#bda991"/>')
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">\n' +
    rows.join('\n') + '\n</svg>\n'
}

function cssDocument(count) {
  const rules = []
  for (let index = 0; index < count; index += 1) {
    rules.push('.c' + index + ' { color: #101010; margin: ' + (index % 20) + 'px; }')
  }
  return rules.join('\n') + '\n'
}

/** Median of `runs` timings, in milliseconds. */
function time(runs, operation) {
  const samples = []
  let value
  for (let index = 0; index < runs; index += 1) {
    const started = process.hrtime.bigint()
    value = operation()
    samples.push(Number(process.hrtime.bigint() - started) / 1e6)
  }
  samples.sort((left, right) => left - right)
  return { median: Number(samples[Math.floor(samples.length / 2)].toFixed(2)), value }
}

const results = []
const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-bench-'))
try {
  for (const size of SIZES) {
    const source = svgDocument(size)
    const runs = size <= 1500 ? 7 : 3
    const scan = time(runs, () => scanSvgDocument(source))
    const nodes = time(runs, () => listEditableSvgNodes(source))
    const geometry = time(runs, () => svgGeometry(source, { transforms: true }))
    const paths = time(runs, () => listSvgPathModels(source))
    const first = nodes.value[0]
    const attribute = time(runs, () => svgAttributePatch(source, { id: first.id, attribute: 'x', value: '11' }))
    const order = time(runs, () => svgOrderPatch(source, { id: first.id, direction: 'forward' }))
    // End-to-end store write on a real file, the same path a save takes.
    await writeFile(path.join(root, 'bench.svg'), source)
    const store = createNativeFileStore(root)
    const opened = await store.read('bench.svg')
    const started = process.hrtime.bigint()
    const patch = attribute.value
    await store.apply('bench.svg', {
      baseHash: opened.hash, baseIdentity: opened.identity,
      patches: [{ ...patch, after: '12' }],
    })
    const saveMs = Number(process.hrtime.bigint() - started) / 1e6
    results.push({
      format: 'svg', elements: size, bytes: source.length,
      scanMs: scan.median, editableNodesMs: nodes.median, geometryMs: geometry.median,
      pathModelsMs: paths.median, attributePatchMs: attribute.median, orderPatchMs: order.median,
      saveMs: Number(saveMs.toFixed(2)), runs,
    })
    console.log('svg ' + size + ' elements: scan ' + scan.median + ' ms, nodes ' + nodes.median +
      ' ms, geometry ' + geometry.median + ' ms, save ' + saveMs.toFixed(2) + ' ms')
  }

  for (const size of [100, 1500, 5000]) {
    const source = cssDocument(size)
    const runs = size <= 1500 ? 7 : 3
    const rules = time(runs, () => listCssVisualRuleDetails(source))
    results.push({
      format: 'css', rules: size, bytes: source.length,
      scanRulesMs: rules.median, runs,
    })
    console.log('css ' + size + ' rules: scan ' + rules.median + ' ms')
  }

  // Caps differ by format and are enforced by the real modules: 8 MiB for the
  // native SVG store and scanner, 512 KiB for the CSS/HTML visual mapping.
  const overSvgCap = results.filter((entry) => entry.format === 'svg' && entry.bytes > 8 * 1024 * 1024)
  const overCssCap = results.filter((entry) => entry.format === 'css' && entry.bytes > 512 * 1024)
  for (const entry of overCssCap) {
    console.log('note: css ' + entry.rules + ' rules exceed the 512 KiB visual-mapping cap: measured only, not listed in the editor')
  }
  if (jsonArg) {
    const target = path.resolve(jsonArg.slice('--json='.length))
    await writeFile(target, JSON.stringify({
      measuredAt: new Date().toISOString(), node: process.version, platform: process.platform,
      arch: process.arch, scope: 'engine-level (no pixels, no frame rate)', results,
    }, null, 2) + '\n')
    console.log('report: ' + target)
  }
  process.exitCode = overSvgCap.length ? 2 : 0
  if (overSvgCap.length) console.log('FAIL: ' + overSvgCap.length + ' SVG sizes exceed the 8 MiB store cap')
} finally {
  await rm(root, { recursive: true, force: true })
}
