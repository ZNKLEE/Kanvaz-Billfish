/* Optional local runtime reuse; regular builds can still use npm run build:win. */
const fs = require('fs');
const path = require('path');
const { build, Platform, Arch } = require('electron-builder');
const root = path.resolve(__dirname, '..');
const config = { npmRebuild: false };
if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) process.env.npm_config_user_agent = 'pnpm/11.25.0';
const runtime = process.env.KANVAZ_ELECTRON_DIST || path.resolve(root, '..', '..', 'build-tools', 'runtime-base');
if (fs.existsSync(path.join(runtime, 'electron.exe'))) {
  const clean = path.resolve(root, '..', '..', 'build-tools', 'runtime-clean');
  fs.cpSync(runtime, clean, { recursive: true, filter: name => !name.startsWith(path.join(runtime, 'resources', 'ffmpeg')) && path.basename(name) !== 'Kanvaz-Billfish.exe' });
  config.electronDist = clean;
}
build({ projectDir: root, config, targets: Platform.WINDOWS.createTarget(['portable'], Arch.x64), publish: 'never' }).catch(error => { console.error(error); process.exitCode = 1; });
