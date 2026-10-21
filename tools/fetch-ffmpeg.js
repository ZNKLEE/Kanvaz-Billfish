/* Fetch the fixed FFmpeg LGPL shared build; verify before extracting. */
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var https = require('https');
var cp = require('child_process');
var root = path.resolve(__dirname, '..');
var rel = '.tools/ffmpeg-n8.1-lgpl';
var name = 'ffmpeg-n8.1-latest-win64-lgpl-shared-8.1';
var archive = path.join(root, '.tools', 'ffmpeg-n8.1-lgpl-shared.zip');
var out = path.join(root, rel, name);
var url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/' + name + '.zip';
var expected = '10FA2FDCBBD4554C480A8E81AF681F07C060B717921EA3E70EE78BD8C3B6CD7C';
function download(target, redirects) {
  return new Promise(function(resolve, reject) {
    https.get(url, function(response) {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 5) {
        response.resume(); url = response.headers.location; download(target, redirects + 1).then(resolve, reject); return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error('FFmpeg download failed: HTTP ' + response.statusCode)); return; }
      var stream = fs.createWriteStream(target); response.pipe(stream); stream.on('finish', function() { stream.close(resolve); }); stream.on('error', reject);
    }).on('error', reject);
  });
}
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase(); }
function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('The bundled FFmpeg runtime is for Windows x64 builds.');
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  var bin = path.join(out, 'bin');
  var ready = fs.existsSync(path.join(bin, 'ffmpeg.exe')) && fs.existsSync(path.join(bin, 'ffprobe.exe')) && fs.existsSync(path.join(out, 'LICENSE.txt'));
  var archiveVerified = fs.existsSync(archive) && sha(archive) === expected;
  var obtain = ready && archiveVerified ? Promise.resolve() : download(archive, 0);
  obtain.then(function() {
    var actual = sha(archive);
    if (actual !== expected) throw new Error('FFmpeg SHA-256 mismatch; refusing to extract. Expected ' + expected + ', got ' + actual);
    if (ready) { console.log('Verified bundled FFmpeg 8.1 LGPL build, SHA-256 ' + actual); return; }
    var ps = 'Expand-Archive -LiteralPath ' + "'" + archive.replace(/'/g, "''") + "'" + ' -DestinationPath ' + "'" + rel.replace(/'/g, "''") + "'" + ' -Force';
    var result = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { cwd: root, windowsHide: true, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || 'Could not extract FFmpeg archive');
    if (!fs.existsSync(path.join(bin, 'ffmpeg.exe')) || !fs.existsSync(path.join(out, 'LICENSE.txt'))) throw new Error('Verified FFmpeg archive is missing its executable or license.');
    console.log('Downloaded and verified FFmpeg 8.1 LGPL build, SHA-256 ' + actual);
  }).catch(function(error) { console.error(error.message); process.exitCode = 1; });
}
main();
