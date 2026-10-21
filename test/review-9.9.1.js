/* Real Windows Electron regression checks with synthetic, disposable media. */
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { spawn, execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.tools', 'review-9.9.1');
const exe = process.env.TEST_EXE || path.resolve(root, '..', '..', 'build-tools', 'runtime-base', 'electron.exe');
const ffmpeg = path.join(root, '.tools', 'ffmpeg-n8.1-lgpl', 'ffmpeg-n8.1-latest-win64-lgpl-shared-8.1', 'bin', 'ffmpeg.exe');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { checks: [], timings: {} };
function pass(message) { report.checks.push(message); console.log('PASS: ' + message); }
async function launch(profile, board) {
  fs.mkdirSync(profile,{recursive:true}); fs.writeFileSync(path.join(profile,'first-run-done'),'1');
  const port = 9421;
  const fixture = path.join(output, 'test-app'); fs.mkdirSync(fixture, { recursive: true });
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'kanvaz-test', version: '9.9.1', main: path.join(root, 'test', 'fixture-launch.js') }));
  const args = process.env.TEST_EXE ? [] : [fixture]; args.push('--remote-debugging-port=' + port); if (board) args.push(board);
  const log = fs.openSync(path.join(output, 'electron.log'), 'a');
  const child = process.env.TEST_ATTACH ? { exitCode: 0, kill() {} } : spawn(exe, args, { windowsHide: true, env: { ...process.env, KANVAZ_BILLFISH_DATA_DIR: profile, TEST_CACHE_PARENT: path.join(output, 'custom') }, stdio: ['ignore', log, log] });
  let endpoint;
  for (let i = 0; i < 600; i++) { try { endpoint = (await fetch('http://127.0.0.1:' + port + '/json/version').then(r => r.json())).webSocketDebuggerUrl; break; } catch (_) {} if (!process.env.TEST_ATTACH && child.exitCode !== null && child.exitCode !== 0) throw new Error(fs.readFileSync(path.join(output, 'electron.log'), 'utf8')); await sleep(200); }
  assert(endpoint, 'Electron started');
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null });
  const page = (await browser.pages()).find(p => p.url().includes('index.html')) || (await browser.pages())[0];
  await page.waitForFunction(() => typeof KanvazFrames !== 'undefined' && document.getElementById('btn-billfish-settings'));
  await sleep(700);
  const libraryClose = await page.$('#bf-browser .bf-header button:last-child'); if (libraryClose) await libraryClose.click();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  return { browser, page, child, errors, log };
}
async function close(session) { await session.page.evaluate(() => KanvazBridge.forceClose()); session.browser.disconnect(); for (let i=0;i<50 && session.child.exitCode===null;i++) await sleep(100); if (session.child.exitCode===null) session.child.kill(); fs.closeSync(session.log); }
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const framesDir = path.join(output, 'sequence-2048x872'); fs.mkdirSync(framesDir, { recursive: true });
  if (!fs.existsSync(path.join(framesDir, 'f0048.png'))) execFileSync(ffmpeg, ['-v','error','-f','lavfi','-i','testsrc2=size=2048x872:rate=24:duration=2','-frames:v','48','-threads','1',path.join(framesDir,'f%04d.png')], { windowsHide: true });
  const mov = path.join(output, 'sample.mov');
  if (!fs.existsSync(mov) || fs.statSync(mov).size < 1000) {
    const mp4 = path.join(root,'test','fixtures','frame-step.mp4');
    assert(fs.existsSync(mp4),'test/fixtures/frame-step.mp4 is required for the MOV stepping fixture');
    execFileSync(ffmpeg, ['-v','error','-i',mp4,'-c','copy','-y',mov], { windowsHide: true });
  }
  const profile = process.env.TEST_PROFILE || path.join(output, (process.env.TEST_EXE ? 'packaged-profile-' : 'profile-') + Date.now());
  const board = path.join(output, 'board.kanvaz');
  const frames = fs.readdirSync(framesDir).filter(f=>f.endsWith('.png')).sort().map(f=>path.join(framesDir,f));
  let session;
  try {
    session = await launch(profile);
    const page = session.page;
    await page.evaluate(() => { if (KanvazBoards.hideHomeScreen) KanvazBoards.hideHomeScreen(); const startup = document.getElementById('startup-screen'); if (startup) startup.style.display = 'none'; });
    const id = await page.evaluate(paths => KanvazCards.createSequenceFromPaths(paths, '序列回归测试', 24, { x: 10, y: 10 }).id, frames);
    await page.evaluate(async id => { await KanvazFrames.get(id).ready; }, id);
    assert.equal(await page.evaluate(id=>KanvazFrames.get(id).info.count,id),48);
    assert(await page.evaluate(id=>KanvazFrames.get(id).info.frames.every(f=>f.previewUrl && !KanvazCards.getCard(id).sequenceFrames.some(x=>x.previewUrl)),id));
    pass('48 PNG frames use direct decoding; temporary preview URLs are excluded from saved frame manifests');
    await page.evaluate(id=>{ KanvazCards.selectCard(id); document.activeElement.blur(); },id);
    await page.keyboard.press('f'); await page.evaluate(id=>KanvazFrames.get(id).pending,id);
    assert.equal(await page.evaluate(id=>KanvazFrames.get(id).index,id),1);
    await page.keyboard.press('d'); await page.evaluate(id=>KanvazFrames.get(id).pending,id);
    assert.equal(await page.evaluate(id=>KanvazFrames.get(id).index,id),0); pass('Selected sequence: F advances one frame and D steps back exactly');
    async function benchmark(label) {
      await page.evaluate(async id => { const p=KanvazFrames.get(id); await KanvazFrames.seek(id,0); p.testTimes=[]; const ctx=p.canvas.getContext('2d'); p.originalDraw=ctx.drawImage; ctx.drawImage=function(){ p.testTimes.push(performance.now()); return p.originalDraw.apply(this,arguments); }; p.play.click(); },id);
      await sleep(1550);
      const result = await page.evaluate(id=>{ const p=KanvazFrames.get(id); p.play.click(); const times=p.testTimes.slice(); p.canvas.getContext('2d').drawImage=p.originalDraw; return { presented:times.length, index:p.index, maxGap:times.length>1?Math.max(...times.slice(1).map((v,i)=>v-times[i])):null, images:p.images.size }; },id);
      report.timings[label]=result; assert(result.presented>=20, label+' presents at least 20 frames in 1.55s: '+JSON.stringify(result)); assert(result.images<=10); return result;
    }
    await benchmark('firstPlayback'); pass('First sequence playback advances without a per-frame FFmpeg process and stays within the decoded-frame window');
    await page.evaluate(async id=>{ await KanvazFrames.seek(id,10); await KanvazFrames.addNote(id); },id);
    await page.type('.fp-note-text','中文帧笔记，可直接选择和删除');
    await page.evaluate(()=>KanvazFrames.flush());
    const assetId=await page.evaluate(id=>KanvazCards.getCard(id).frameAssetId,id);
    const notePath=path.join(profile,'frame-notes','assets',assetId+'.json');
    assert.equal(JSON.parse(fs.readFileSync(notePath,'utf8')).notes[0].text,'中文帧笔记，可直接选择和删除');
    await page.evaluate(id=>KanvazFrames.openNotes(id),id);
    await page.click('.fp-note-card > div');
    assert.equal(await page.$$eval('.fp-note-card.active',els=>els.length),1);
    await page.focus('.fp-note-text'); const before=await page.evaluate(id=>KanvazFrames.get(id).index,id); await page.keyboard.type('df');
    assert.equal(await page.evaluate(id=>KanvazFrames.get(id).index,id),before); pass('Clicking note content selects the entire note; typing D/F inside the editor does not step frames');
    await page.evaluate(()=>document.activeElement.blur());
    await benchmark('withNotesPanel'); pass('Sequence playback remains active while the notes panel is open');
    await page.screenshot({ path:path.join(output,'notes-panel.png') });
    await page.click('.fp-delete-note'); await page.evaluate(()=>KanvazFrames.flush());
    assert.equal(JSON.parse(fs.readFileSync(notePath,'utf8')).notes.length,0);
    assert.equal(await page.$$eval('.fp-note-card',els=>els.length),0); pass('Delete entire note is visible in the list and persists the deletion');
    await page.evaluate(async id=>{ await KanvazFrames.addNote(id); },id);
    await page.type('.fp-note-text','重启和缓存迁移后保留'); await page.evaluate(()=>KanvazFrames.flush());
    await page.evaluate(id=>{ const saved=KanvazFrames.snapshot(); window.testNotesSaved=saved; const crowded=JSON.parse(JSON.stringify(saved)), data=crowded[KanvazCards.getCard(id).frameAssetId], template=data.notes[0]; for(let i=0;i<150;i++) data.notes.push({...template,id:'n_load_'+i,text:'压力测试笔记 '+i,anchor:{...template.anchor,frameIndex:i%48}}); KanvazFrames.restore(crowded); KanvazFrames.openNotes(id); },id);
    await benchmark('with151Notes');
    await page.evaluate(id=>{ KanvazFrames.restore(window.testNotesSaved); delete window.testNotesSaved; KanvazFrames.openNotes(id); },id);
    pass('Playback remains active with 151 frame notes in the panel');
    const videoId = await page.evaluate(file=>new Promise((resolve,reject)=>KanvazMedia.loadFromPath(file,(media,error)=>{if(error)reject(new Error(String(error)));else resolve(KanvazCards.createFromMedia(media,{x:1100,y:10}).id);})),mov);
    await page.evaluate(async id=>{ await KanvazFrames.get(id).ready; KanvazCards.selectCard(id); document.activeElement.blur(); },videoId);
    await page.keyboard.press('f'); await page.evaluate(id=>KanvazFrames.get(id).pending,videoId);
    assert.equal(await page.evaluate(id=>KanvazFrames.get(id).index,videoId),1);
    await page.keyboard.press('d'); await page.evaluate(id=>KanvazFrames.get(id).pending,videoId);
    assert.equal(await page.evaluate(id=>KanvazFrames.get(id).index,videoId),0); pass('Selected MOV video uses exact indexed D/F stepping');
    await page.evaluate(id=>{ KanvazFrames.openNotes(id); KanvazFrames.get(id).play.click(); },videoId);
    await page.waitForFunction(id=>{ const p=KanvazFrames.get(id); return !p.video.paused && !p.video.seeking && p.video.readyState>=2 && p.index>1; },{timeout:15000},videoId);
    const nativeStartIndex=await page.evaluate(id=>KanvazFrames.get(id).index,videoId); await sleep(1250);
    const native=await page.evaluate(id=>{ const p=KanvazFrames.get(id), result={index:p.index,time:p.video.currentTime,timeline:Number(p.slider.value),paused:p.video.paused}; p.play.click(); return result; },videoId);
    assert(native.index-nativeStartIndex>=15 && native.timeline===native.index && !native.paused,JSON.stringify(native)); report.timings.movWithNotes={...native,advanced:native.index-nativeStartIndex}; pass('Native MOV playback and timeline continue to advance with frame notes open');
    if (!process.env.TEST_EXE) {
      await page.click('#btn-billfish-settings'); await page.waitForSelector('#btn-choose-cache-directory'); await page.click('#btn-choose-cache-directory');
      await page.waitForFunction(()=>document.getElementById('cache-directory-status').textContent.includes('重启'));
      const setting=await page.evaluate(()=>KanvazBridge.cacheLocation()); assert(setting.restartRequired); assert(setting.directory.endsWith('Kanvaz-Cache'));
      assert(fs.existsSync(notePath)); pass('Settings folder picker saves a dedicated cache directory and leaves notes in the original data directory');
      fs.writeFileSync(board,await page.evaluate(()=>JSON.stringify(KanvazBoards.serialise())));
      assert.deepEqual(session.errors,[]); await close(session); session=null;
      session=await launch(profile,board);
      const reopened=session.page;
      await reopened.waitForFunction(id=>KanvazFrames.get(id) && KanvazFrames.get(id).info,{},id);
      const setting2=await reopened.evaluate(()=>KanvazBridge.cacheLocation()); assert(!setting2.restartRequired); assert.equal(setting2.activeDirectory,setting.directory);
      assert(fs.existsSync(path.join(setting.directory,'browser-cache')));
      await reopened.evaluate(id=>KanvazFrames.openNotes(id),id); await reopened.waitForSelector('.fp-note-card');
      assert((await reopened.$eval('.fp-note-list',el=>el.textContent)).includes('重启和缓存迁移后保留'));
      await reopened.evaluate(async id=>{ await KanvazFrames.get(id).ready; await KanvazFrames.seek(id,12); },videoId);
      assert(fs.existsSync(path.join(setting.directory,'media-cache','exact-frames'))); pass('After restart, browser/media caches use the custom folder and existing frame notes reopen correctly');
    }
    assert.deepEqual(session.errors,[]); pass('No uncaught renderer errors');
    fs.writeFileSync(path.join(output,process.env.TEST_EXE?'packaged-results.json':'results.json'),JSON.stringify(report,null,2));
  } catch (error) {
    if (session) { await session.page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{}); console.error(await session.page.evaluate(()=>({ notes:document.querySelector('#frame-notes-panel')?.innerHTML, center:document.elementsFromPoint(innerWidth-150,250).map(el=>el.className) })).catch(()=>({}))); }
    throw error;
  } finally { if(session) await close(session).catch(()=>session.child.kill()); }
}
main().catch(error=>{console.error(error.stack); process.exitCode=1;});
