import { mkdirSync, copyFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')

mkdirSync(path.join(ROOT, 'public'), { recursive: true })
copyFileSync(path.join(ROOT, 'src/web/index.html'), path.join(ROOT, 'public/index.html'))

console.log('Building web...')
const build = Bun.spawnSync(
  ['bun', 'build', 'src/web/main.tsx', '--outdir', 'public', '--target', 'browser'],
  { cwd: ROOT, stdio: ['inherit', 'inherit', 'inherit'] }
)
if (build.exitCode !== 0) process.exit(1)

const web = Bun.spawn(
  ['bun', 'build', 'src/web/main.tsx', '--outdir', 'public', '--target', 'browser', '--watch'],
  { cwd: ROOT, stdio: ['inherit', 'inherit', 'inherit'] }
)

const server = Bun.spawn(
  ['bun', '--watch', 'src/api/server.ts'],
  { cwd: ROOT, stdio: ['inherit', 'inherit', 'inherit'] }
)

process.on('SIGINT', () => { web.kill(); server.kill(); process.exit(0) })
await Promise.all([web.exited, server.exited])
