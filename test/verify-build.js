/* Verify that the packaged app contains the reviewed source and original codecs. */
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const root = path.resolve(__dirname,'..');
const pnpm = path.join(root,'node_modules','.pnpm');
const asarFolder = fs.readdirSync(pnpm).find(name=>name.startsWith('@electron+asar@'));
const asar = require(path.join(pnpm,asarFolder,'node_modules','@electron','asar'));
const archive = path.join(root,'dist','win-unpacked','resources','app.asar');
const hash = data=>crypto.createHash('sha256').update(data).digest('hex');
let checked=0;
for (const name of fs.readdirSync(path.join(root,'src'))) {
  if (!/\.(js|css|html)$/.test(name)) continue;
  assert.equal(hash(asar.extractFile(archive,'src/'+name)),hash(fs.readFileSync(path.join(root,'src',name))),name+' matches reviewed source'); checked++;
}
assert.equal(JSON.parse(asar.extractFile(archive,'package.json').toString()).version,'9.9.1');
const originalBin=path.join(root,'.tools','ffmpeg-n8.1-lgpl','ffmpeg-n8.1-latest-win64-lgpl-shared-8.1','bin');
for (const name of fs.readdirSync(originalBin).filter(name=>/\.(exe|dll)$/.test(name))) assert.equal(hash(fs.readFileSync(path.join(originalBin,name))),hash(fs.readFileSync(path.join(root,'dist','win-unpacked','resources','ffmpeg',name))),name+' matches supplied decoder');
console.log('PASS: '+checked+' packaged source/style/HTML files match reviewed files; version is 9.9.1; all FFmpeg executables and DLLs match the supplied runtime.');
