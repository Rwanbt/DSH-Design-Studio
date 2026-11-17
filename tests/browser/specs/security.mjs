/**
 * Hostile-document security audit in a REAL browser (ADR-017 boundary).
 *
 * The preview must render untrusted HTML/CSS without executing its scripts and
 * without letting it reach the network, the parent document or a navigation.
 * These are the guarantees that a jsdom-style simulation cannot prove.
 */
import { openWorkspaceFile } from './helpers.mjs'

const HOSTILE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Hostile fixture</title>
<link rel="stylesheet" href="https://evil.invalid/sheet.css">
<style>@import url("https://evil.invalid/import.css");
body { background-image: url("https://evil.invalid/bg.png") }</style>
</head>
<body>
  <h1 id="headline">Hostile fixture</h1>
  <p id="lead" class="lead">Paragraph to select.</p>
  <script>window.__pwned = 'script-ran'; fetch('https://evil.invalid/pwned')</script>
  <img id="tracker" src="https://evil.invalid/pixel.png" alt="tracker">
  <a id="js-link" href="javascript:window.__pwned='js-url'">javascript link</a>
  <a id="external" href="https://evil.invalid/navigate">external link</a>
  <svg id="inline-svg" onload="window.__pwned='svg-onload'" width="20" height="20"><circle cx="10" cy="10" r="8"/></svg>
  <iframe id="nested" src="https://evil.invalid/frame" title="nested"></iframe>
  <object id="obj" data="https://evil.invalid/obj"></object>
  <form id="form" action="https://evil.invalid/post" method="post"><input name="a"><button id="submit" type="submit">send</button></form>
  <div id="handler" onclick="window.__pwned='inline-handler'">inline handler</div>
</body>
</html>
`

const SCRIPT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" onload="window.__pwned='svg-root'">
  <script>window.__pwned='svg-script'</script>
  <rect id="box" x="10" y="10" width="80" height="60" fill="#bda991"/>
</svg>
`

const REMOTE_ASSET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="120">
  <image href="https://evil.invalid/asset.png" xlink:href="https://evil.invalid/asset-xlink.png" width="10" height="10"/>
  <rect id="box" x="10" y="10" width="80" height="60" fill="#bda991"/>
</svg>
`

/** Track every attempt to reach the untrusted origin, and whether it ever completed. */
function trackUntrusted(page) {
  const attempts = []
  const completed = []
  const failures = []
  page.on('request', (request) => {
    if (/evil\.invalid/.test(request.url())) attempts.push(request.url())
  })
  page.on('response', (response) => {
    if (/evil\.invalid/.test(response.url())) completed.push({ url: response.url(), status: response.status() })
  })
  page.on('requestfailed', (request) => {
    if (/evil\.invalid/.test(request.url())) {
      failures.push({ url: request.url(), error: request.failure()?.errorText || 'failed' })
    }
  })
  return { attempts, completed, failures }
}

export const htmlSecuritySpec = {
  name: 'security: untrusted HTML stays inert and offline inside the preview frame',
  allowConsoleErrors: true,
  async run({ page, harness, assert }) {
    await harness.write('hostile.html', HOSTILE_HTML)
    const untrusted = trackUntrusted(page)
    const navigations = []
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) navigations.push(frame.url())
    })

    await openWorkspaceFile(page, 'hostile.html', { expect: 'html' })
    await page.waitForTimeout(900)

    const preview = page.locator('iframe[title="Isolated design preview"]')
    const sandbox = await preview.getAttribute('sandbox')
    assert.equal(sandbox, 'allow-same-origin', 'the HTML preview must be sandboxed without allow-scripts')
    assert.ok(!/allow-scripts/.test(sandbox || ''), 'allow-scripts must never be granted to untrusted HTML')

    const srcDoc = await preview.getAttribute('srcdoc')
    assert.match(srcDoc, /Content-Security-Policy/, 'the preview document must carry a CSP meta element')
    assert.match(srcDoc, /script-src 'none'/, 'CSP must forbid script execution')
    assert.match(srcDoc, /connect-src 'none'/, 'CSP must forbid network connections')
    assert.match(srcDoc, /default-src 'none'/, 'CSP must default-deny every resource type')
    assert.match(srcDoc, /frame-src 'none'/, 'CSP must forbid nested frames')

    const frame = page.frames().find((candidate) => candidate !== page.mainFrame() && candidate.url() === 'about:srcdoc')
    assert.ok(frame, 'the preview frame must be an inert about:srcdoc document')

    // 1. No document script may have run, in the frame or in the trusted parent.
    assert.equal(await frame.evaluate(() => window.__pwned), undefined, 'document scripts must not execute in the preview')
    assert.equal(await page.evaluate(() => window.__pwned), undefined, 'untrusted code must never reach the parent origin')

    // 2. The preview still rendered: a blocked document is not a broken preview.
    assert.equal(await frame.locator('#headline').innerText(), 'Hostile fixture', 'preview renders inert content')
    assert.equal(await frame.locator('#lead').count(), 1, 'preview keeps the editable paragraph')

    // 3. Nothing may EVER be received from the untrusted origin. Requests may be
    // attempted; every single one must be blocked before a response exists.
    assert.deepEqual(untrusted.completed, [],
      'no response may ever arrive from an untrusted origin: ' + JSON.stringify(untrusted.completed))
    // The fixture must genuinely reference the untrusted origin, otherwise this
    // test would prove nothing. Browsers differ in how early they drop the
    // request (Chromium reports an attempt, Firefox blocks before dispatch), so
    // the invariant asserted here is that NOTHING ever completes.
    assert.ok(srcDoc.includes('evil.invalid'),
      'the fixture must reference the untrusted origin for this test to be meaningful')
    for (const attempt of untrusted.attempts) {
      assert.ok(!untrusted.completed.some((entry) => entry.url === attempt),
        `request ${attempt} must not complete`)
    }
    assert.deepEqual(navigations.filter((url) => /evil\.invalid/.test(url)), [],
      'the preview must never navigate to an untrusted origin')

    // 4. Interacting with the inert document must not navigate the host page.
    const frameLocator = page.frameLocator('iframe[title="Isolated design preview"]')
    const urlBefore = page.url()
    await frameLocator.locator('#external').click()
    await page.waitForTimeout(300)
    assert.equal(page.url(), urlBefore, 'clicking a link in the preview must not navigate the DSH page')
    assert.equal(await page.evaluate(() => window.__pwned), undefined,
      'an external link click must not execute anything in the parent origin')

    // 5. Selection by click still works while scripts are disabled (ADR-017).
    await frameLocator.locator('#lead').click()
    await page.waitForTimeout(300)
    const inspector = await page.locator('#root').innerText()
    assert.match(inspector, /p #lead/, 'clicking a unique source id selects it in the inspector')
  },
}

export const svgSecuritySpec = {
  name: 'security: an SVG carrying script is refused, never previewed with scripts enabled',
  allowConsoleErrors: true,
  async run({ page, harness, assert }) {
    await harness.write('script.svg', SCRIPT_SVG)
    const untrusted = trackUntrusted(page)
    await openWorkspaceFile(page, 'script.svg', { expect: undefined })
    await page.waitForTimeout(800)

    assert.equal(await page.evaluate(() => window.__pwned), undefined,
      'an SVG onload/script must never execute in the parent origin')
    const previews = page.frames().filter((frame) => frame !== page.mainFrame())
    for (const frame of previews) {
      assert.equal(await frame.evaluate(() => window.__pwned).catch(() => undefined), undefined,
        'no preview frame may execute script from the document')
    }
    const previewIframe = page.locator('iframe[title="Isolated SVG preview"]')
    if (await previewIframe.count()) {
      assert.equal(await previewIframe.getAttribute('sandbox'), '',
        'any SVG preview that is shown must use the empty sandbox')
    }
    assert.deepEqual(untrusted.completed, [], 'an untrusted SVG must not fetch anything')
  },
}

export const svgRemoteAssetSpec = {
  name: 'security: an SVG referencing remote assets previews with an inert empty sandbox',
  allowConsoleErrors: true,
  async run({ page, harness, assert }) {
    await harness.write('remote.svg', REMOTE_ASSET_SVG)
    const untrusted = trackUntrusted(page)
    await openWorkspaceFile(page, 'remote.svg', { expect: 'svg' })
    await page.waitForTimeout(800)
    const previewIframe = page.locator('iframe[title="Isolated SVG preview"]')
    assert.equal(await previewIframe.getAttribute('sandbox'), '',
      'the SVG preview must use the empty sandbox (no same-origin, no scripts)')
    assert.deepEqual(untrusted.completed, [],
      'a remote image referenced by the SVG must never be downloaded: ' + JSON.stringify(untrusted.completed))
  },
}

export const cssInjectionSpec = {
  name: 'security: linked CSS projection keeps validated rules and drops @import/url() resources',
  allowConsoleErrors: true,
  async run({ page, harness, assert }) {
    await harness.write('page.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>linked</title>
<link rel="stylesheet" href="ok.css">
<link rel="stylesheet" href="evil.css"></head>
<body><h1 id="title">Linked styles</h1></body></html>
`)
    // The projection only supports simple #id/.class rules (ADR-018): use one.
    await harness.write('ok.css', '#title {\n  color: #bda991;\n  font-size: 40px;\n}\n')
    await harness.write('evil.css', `@import url("https://evil.invalid/import.css");
@font-face { font-family: Evil; src: url("https://evil.invalid/font.woff2") }
#title { background-image: url("https://evil.invalid/bg.png") }
`)
    const untrusted = trackUntrusted(page)
    await openWorkspaceFile(page, 'page.html', { expect: 'html' })
    await page.waitForTimeout(900)
    const srcDoc = await page.locator('iframe[title="Isolated design preview"]').getAttribute('srcdoc')
    assert.ok(!/@import/i.test(srcDoc), 'the projected preview must not contain @import')
    assert.ok(!/url\(/i.test(srcDoc), 'the projected preview must not contain url() resources')
    assert.ok(!/evil\.invalid/.test(srcDoc), 'no untrusted origin may be projected into the preview')
    assert.match(srcDoc, /#bda991/, 'validated declarations from a safe local sheet are still projected')
    assert.deepEqual(untrusted.completed, [],
      'no resource from an untrusted stylesheet may be fetched: ' + JSON.stringify(untrusted.completed))
  },
}
