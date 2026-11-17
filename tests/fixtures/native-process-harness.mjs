/**
 * Test harness for the real multi-process storage tests.
 *
 * Every "process" is a genuine OS process spawned through node:child_process;
 * synchronisation happens through files in the fixture directory. No
 * worker_threads and no shared JS memory are involved.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const WORKER = fileURLToPath(new URL('./native-process-worker.mjs', import.meta.url))
const EXTERNAL = fileURLToPath(new URL('./native-external-writer.mjs', import.meta.url))

export async function withTempRoot(run, prefix = 'dsh-native-multiprocess-') {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  try {
    return await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

export function spawnWorker(job) {
  const child = spawn(process.execPath, [WORKER, JSON.stringify(job)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stdout = ''
  let stderr = ''
  let readyDone = false
  let resolveReady
  let rejectReady
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  // Keep an owned rejection handler: some tests intentionally kill workers and
  // never await READY/RESULT, and an unhandled rejection would poison the run.
  ready.catch(() => {})

  function settleReady(err) {
    if (readyDone) return
    readyDone = true
    if (err) rejectReady(err)
    else resolveReady()
  }

  child.stdout.on('data', (chunk) => {
    stdout += String(chunk)
    if (!readyDone && stdout.includes('READY\n')) settleReady()
  })
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  child.on('error', (err) => { settleReady(err) })

  const exit = new Promise((resolve) => {
    child.on('close', (code, signal) => {
      if (!readyDone) {
        settleReady(new Error('worker exited before READY (' + JSON.stringify({ code, signal }) + '): ' + stderr))
      }
      resolve({ code, signal })
    })
  })

  async function result() {
    const info = await exit
    if (info.code !== 0) {
      throw new Error('worker failed ' + JSON.stringify(info) + ': ' + stderr)
    }
    const line = stdout.split(/\r?\n/).filter((entry) => entry.startsWith('RESULT ')).at(-1)
    if (!line) throw new Error('worker produced no RESULT line: ' + stdout + ' ' + stderr)
    return JSON.parse(line.slice('RESULT '.length))
  }

  function kill(signal = 'SIGKILL') {
    try { child.kill(signal) } catch { /* already gone */ }
  }

  return {
    child,
    ready,
    exit,
    result,
    kill,
    get stdout() { return stdout },
    get stderr() { return stderr },
  }
}

/** Run the deliberately non-cooperating writer (plain fs.writeFileSync). */
export async function runExternalWriter(file, content, doneMarker) {
  const child = spawn(process.execPath, [EXTERNAL, file, content, doneMarker], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  const info = await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code, signal) => resolve({ code, signal }))
  })
  if (info.code !== 0) throw new Error('external writer failed ' + JSON.stringify(info) + ': ' + stderr)
  await waitForPath(doneMarker)
}

export async function waitForPath(target, { timeoutMs = 15000, intervalMs = 5 } = {}) {
  const started = Date.now()
  while (!existsSync(target)) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for ' + target)
    await sleep(intervalMs)
  }
}

export async function listTempFiles(root) {
  const entries = await readdir(root, { recursive: true })
  return entries.map(String).filter((entry) => entry.endsWith('.tmp'))
}

export function killAll(jobs) {
  for (const job of jobs) job.kill('SIGKILL')
}
