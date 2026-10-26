import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runJlcCli } from './jlc3d.js'

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runJlcCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
