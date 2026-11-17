/**
 * Spawnable cooperating writer used by the storage multi-process tests.
 * Runs in its own Node process (NOT worker_threads) and receives one JSON job
 * on argv[2]. It prints `READY`, then a single `RESULT {json}` line.
 *
 * Modes:
 *   - apply: createNativeFileStore(job.root, { io, lock }).apply(...)
 *   - hold-lock: take withNativeWriteLock and hold it until SIGKILLed
 *
 * Pause hooks intentionally wrap only the real fs functions: they let the
 * parent deterministicially interleave an external actor inside the critical
 * section without changing any production behaviour.
 */
import * as nodeFs from 'node:fs/promises'
import { existsSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { createNativeFileStore } from '../../src/native-file-store.mjs'
import { withNativeWriteLock } from '../../src/native-write-lock.mjs'

const job = JSON.parse(process.argv[2] || 'null')
if (!job || typeof job !== 'object') process.exit(2)

function report(payload) {
  process.stdout.write('RESULT ' + JSON.stringify(payload) + '\n')
}

async function waitForMarker(file) {
  while (!existsSync(file)) await sleep(5)
}

const hooks = {}
if (job.pauseOn === 'temp-open') {
  hooks.open = async (...args) => {
    const handle = await nodeFs.open(...args)
    if (args[1] === 'wx') {
      if (job.pauseMarker) writeFileSync(job.pauseMarker, 'paused\n')
      if (job.releaseMarker) await waitForMarker(job.releaseMarker)
    }
    return handle
  }
}
if (job.pauseOn === 'rename') {
  hooks.rename = async () => {
    if (job.pauseMarker) writeFileSync(job.pauseMarker, 'paused\n')
    if (job.releaseMarker) await waitForMarker(job.releaseMarker)
    // Crash tests never release this pause: stay alive until the parent sends
    // SIGKILL, exactly as a process would block inside rename().
    else await sleep(60000)
    const e = new Error('rename pause released without crashing the worker')
    e.code = 'harness-rename-pause'
    throw e
  }
}

process.stdout.write('READY\n')

if (job.mode === 'hold-lock') {
  try {
    await withNativeWriteLock(job.absolute, async () => {
      writeFileSync(job.holdMarker, String(process.pid) + '\n')
      await sleep(job.holdMs ?? 60000)
    }, job.lock)
    report({ ok: true })
  } catch (e) {
    report({ ok: false, code: e.code || 'unknown', message: e.message })
  }
} else if (job.mode === 'apply') {
  try {
    if (job.gate) await waitForMarker(job.gate)
    const options = { lock: job.lock }
    if (job.pauseOn) options.io = hooks
    const store = createNativeFileStore(job.root, options)
    const result = await store.apply(job.file, {
      baseHash: job.baseHash,
      baseIdentity: job.baseIdentity,
      patches: job.patches || [],
    })
    report({ ok: true, hash: result.hash, identity: result.identity, changed: result.changed })
  } catch (e) {
    report({ ok: false, code: e.code || 'unknown', message: e.message })
  }
} else {
  process.exit(2)
}
