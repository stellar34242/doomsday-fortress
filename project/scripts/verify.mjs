import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function run(label, entry, args = []) {
  console.log(`\n== ${label} ==`)
  const result = spawnSync(process.execPath, [resolve(projectDir, entry), ...args], {
    cwd: projectDir,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('TypeScript 类型检查', 'node_modules/typescript/bin/tsc', ['--noEmit', '-p', 'tsconfig.app.json'])
run('模拟回归', 'scripts/run-sim.mjs')
run('TypeScript 项目构建', 'node_modules/typescript/bin/tsc', ['-b'])
run('Vite 生产构建', 'node_modules/vite/bin/vite.js', ['build'])
run('同步 public 素材', 'scripts/copy-public.mjs')

console.log('\n✓ VERIFY PASSED')
