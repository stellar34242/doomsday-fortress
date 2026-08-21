import { cpSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = resolve(projectDir, 'public')
const distDir = resolve(projectDir, 'dist')

if (!existsSync(distDir)) throw new Error('dist 不存在，请先运行 Vite 构建')
if (existsSync(publicDir)) cpSync(publicDir, distDir, { recursive: true })

console.log('✓ public 素材已同步到 dist')
