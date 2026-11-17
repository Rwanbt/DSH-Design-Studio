import { createNativeFileStore } from '../../src/native-file-store.mjs'
import { existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const [root, file, baseHash, baseIdentity, replacement, gate] = process.argv.slice(2)
if (!root || !file || !baseHash || !baseIdentity || !replacement || !gate) process.exit(2)
try {
  // Start only after every worker has loaded its module, to maximize overlap.
  process.stdout.write('READY\n')
  while (!existsSync(gate)) await sleep(5)
  const store = createNativeFileStore(root)
  const result = await store.apply(file, {
    baseHash,baseIdentity,
    patches: [{start:3,end:6,before:'old',after:replacement}],
  })
  process.stdout.write(JSON.stringify({ok:true,hash:result.hash})+'\n')
} catch (e) {
  process.stdout.write(JSON.stringify({ok:false,code:e.code||'unknown',message:e.message})+'\n')
}
