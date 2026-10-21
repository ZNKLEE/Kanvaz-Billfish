/* Test only this fork's installer in its own project-owned destination. */
const fs = require('fs'); const path = require('path'); const { spawnSync } = require('child_process'); const assert = require('assert');
const root = path.resolve(__dirname, '..'); const folder = path.join(root, '.tools', 'installed-test'); const output = path.join(root, '.tools', 'test-results');
assert(folder.startsWith(root + path.sep), 'Test install stays inside this project');
function defaults() {
  const script = "@('.kanvaz','.png','.jpg') | ForEach-Object { $key = Get-Item -LiteralPath ('HKCU:\\Software\\Classes\\' + $_) -ErrorAction SilentlyContinue; $value = $null; if ($key) { $value = $key.GetValue('') }; [pscustomobject]@{ext=$_;value=$value} } | ConvertTo-Json -Compress";
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0); return JSON.parse(r.stdout);
}
function run(exe, args) { const result = spawnSync(exe, args, { cwd: root, windowsHide: true, timeout: 180000 }); assert.equal(result.status, 0, result.error ? result.error.message : String(result.stderr)); }
const before = defaults();
const installer = path.join(root, 'dist', 'Kanvaz-Billfish-ZhCN-9.8.2-Setup.exe');
if (process.argv.includes('--uninstall')) {
  const name = fs.readdirSync(folder).find(name => /^Uninstall.*\.exe$/i.test(name)); assert(name, 'Dedicated uninstaller found');
  run(path.join(folder, name), ['/S']); const after = defaults(); assert.deepEqual(after, before, 'Uninstall preserves original default handlers');
  fs.writeFileSync(path.join(output, 'uninstall-result.json'), JSON.stringify({ before, after, folder }, null, 2)); console.log('PASS: fork uninstaller preserves original file defaults.');
} else {
  run(installer, ['/S', '/D=' + folder]); assert(fs.existsSync(path.join(folder, 'Kanvaz-Billfish.exe')));
  const after = defaults(); assert.deepEqual(after, before, 'Install preserves original default handlers');
  const reg = spawnSync('reg.exe', ['query', 'HKCU\\Software\\Classes\\KanvazBillfishZh.Board\\shell\\open\\command', '/ve'], { encoding: 'utf8', windowsHide: true });
  assert.equal(reg.status, 0); assert(reg.stdout.includes('Kanvaz-Billfish.exe'));
  fs.writeFileSync(path.join(output, 'installer-result.json'), JSON.stringify({ before, after, folder, openWith: reg.stdout.trim() }, null, 2)); console.log('PASS: NSIS silent installation and independent OpenWith registration, existing defaults unchanged.');
}
