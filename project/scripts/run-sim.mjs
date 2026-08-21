import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = mkdtempSync(join(tmpdir(), 'doomsday-fortress-sim-'))
const outfile = join(tempDir, 'sim.mjs')

try {
  await build({
    entryPoints: [resolve(projectDir, 'scripts/sim.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
  })

  const result = spawnSync(process.execPath, [outfile], {
    cwd: projectDir,
    env: {
      ...process.env,
      TD_TOKEN_FILE: resolve(projectDir, '../handover_tools/td_sim_token.txt'),
    },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
