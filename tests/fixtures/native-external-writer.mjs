/**
 * A deliberately NON-cooperating external writer: a plain child process that
 * overwrites the target directly with writeFileSync, ignores the
 * `.dsh-native.lock` directory and performs no revision checks. This models an
 * external editor/script (sed -i, git checkout, IDE save) racing Design Studio.
 */
import { writeFileSync } from 'node:fs'

const [file, content, doneMarker] = process.argv.slice(2)
if (!file || typeof content !== 'string' || !doneMarker) process.exit(2)
writeFileSync(file, content, 'utf8')
writeFileSync(doneMarker, 'written\n')
