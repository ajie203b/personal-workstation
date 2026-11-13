import fs from 'node:fs'
import path from 'node:path'

const assetsDir = path.resolve(process.cwd(), 'android/app/src/main/assets/public')

if (fs.existsSync(assetsDir)) {
  for (const name of fs.readdirSync(assetsDir)) {
    if (name === 'sw.js' || name === 'registerSW.js' || /^workbox-[^/\\]+\.js$/.test(name)) {
      fs.rmSync(path.join(assetsDir, name), { force: true })
    }
  }
}
