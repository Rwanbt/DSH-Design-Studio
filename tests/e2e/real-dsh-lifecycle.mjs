/** Bounded shutdown seam; no DSH process is started by importing this module. */
export async function stopServer(server, { timeout = 5000 } = {}) {
  if (!server) return
  // `exitCode` alone is not close: inherited pipes can still be open.
  await new Promise((resolve, reject) => {
    let timer
    let escalation
    const done = () => {
      clearTimeout(timer)
      clearTimeout(escalation)
      server.removeListener('close', done)
      resolve()
    }
    server.once('close', done)
    // The caller installs this marker immediately after spawn.
    if (server.dshE2eClosed) return done()
    escalation = setTimeout(() => {
      if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL')
    }, timeout)
    timer = setTimeout(() => {
      server.removeListener('close', done)
      reject(new Error('DSH server close not observed after SIGTERM/SIGKILL; disposable directory retained'))
    }, timeout * 2)
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM')
  })
}
