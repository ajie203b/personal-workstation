import { readFileSync } from 'node:fs'

// Keep these minimum versions aligned with package.json and jsdom's Node support.
const [major, minor, patch] = process.versions.node.split('.').map(Number)
const supported = (major === 22 && (minor > 22 || (minor === 22 && patch >= 2)))
  || (major === 24 && minor >= 15)
  || major >= 26

if (!supported) {
  const { engines } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  console.error(`Tests require Node.js ${engines.node}. Found ${process.version}.`)
  process.exitCode = 1
}
