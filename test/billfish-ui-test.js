/* Real Electron renderer smoke/integration test, using an isolated user profile. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const assert = require('assert');
const puppeteer = require('puppeteer-core');
const root = path.join(__dirname, '..');
async function run() {
  const output = path.join(root, '.tools', 'test-results'); fs.mkdirSync(output, { recursive: true });
  const port = Number(process.env.TEST_DEBUG_PORT || 9337);
  const profile = process.env.TEST_PROFILE || path.join(root, '.tools', 'ui-test-profile');
  const boardFile = process.env.TEST_BOARD || path.join(output, 'linked-ui-board.kanvaz');
  if (!process.env.TEST_REOPEN) fs.writeFileSync(boardFile, JSON.stringify({ version: '9.8.2', activeIdx: 0, boards: [{ id: 'integration', name: '集成测试素材板', cards: [], canvasTx: 0, canvasTy: 0, canvasScale: 1 }] }));
  const exe = process.env.TEST_EXE || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const args = process.env.TEST_EXE ? [] : [root]; args.push('--remote-debugging-port=' + port);
  args.push(boardFile);
  if (process.env.TEST_DPI) args.push('--force-device-scale-factor=' + process.env.TEST_DPI);
  const log = fs.openSync(path.join(output, 'electron-' + port + '.log'), 'w');
  const child = spawn(exe, args, { cwd: root, windowsHide: true, env: { ...process.env, KANVAZ_BILLFISH_DATA_DIR: profile }, stdio: ['ignore', log, log] });
  let browser;
  try {
    let endpoint;
    for (let n = 0; n < 80; n++) {
      await new Promise(r => setTimeout(r, 250));
      try { const info = await fetch('http://127.0.0.1:' + port + '/json/version').then(r => r.json()); endpoint = info.webSocketDebuggerUrl; break; } catch (_) {}
      if (child.exitCode !== null && !(process.env.TEST_LAUNCHER && child.exitCode === 0)) throw new Error('Electron exited: ' + fs.readFileSync(path.join(output, 'electron-' + port + '.log'), 'utf8'));
    }
    assert(endpoint, 'Electron debugging endpoint available');
    browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null });
    let page;
    for (let n = 0; n < 40; n++) { page = (await browser.pages()).find(p => { try { return p.url().includes('index.html'); } catch (_) { return false; } }); if (page) break; await new Promise(r => setTimeout(r, 250)); }
    assert(page, 'Main renderer opened');
    const errors = []; page.on('pageerror', err => errors.push(err.message));
    await page.waitForFunction(() => typeof KanvazBillfish !== 'undefined' && document.querySelector('#btn-billfish'));
    await new Promise(r => setTimeout(r, 1200));
    const mediaInfoToggle = await page.evaluate(() => { var settings = KanvazUI_Extended.getSettings(), imageButton = document.querySelector('#btn-image-info'), videoButton = document.querySelector('#btn-video-info'); var before = { image: settings.showImageInfo !== false, video: settings.showVideoInfo !== false }; imageButton.click(); var imageToggled = KanvazUI_Extended.getSettings().showImageInfo !== false; var videoUnchanged = (KanvazUI_Extended.getSettings().showVideoInfo !== false) === before.video; videoButton.click(); var videoToggled = KanvazUI_Extended.getSettings().showVideoInfo !== false; imageButton.click(); videoButton.click(); return { before: before, imageToggled: imageToggled, videoUnchanged: videoUnchanged, videoToggled: videoToggled, restored: { image: KanvazUI_Extended.getSettings().showImageInfo !== false, video: KanvazUI_Extended.getSettings().showVideoInfo !== false } }; });
    assert.equal(mediaInfoToggle.imageToggled, !mediaInfoToggle.before.image); assert.equal(mediaInfoToggle.videoUnchanged, true); assert.equal(mediaInfoToggle.videoToggled, !mediaInfoToggle.before.video); assert.deepEqual(mediaInfoToggle.restored, mediaInfoToggle.before);
    const state = await page.evaluate(async () => ({ language: document.documentElement.lang, button: document.querySelector('#btn-billfish').textContent, settings: await KanvazBridge.billfish('settings'), globals: [typeof KanvazCanvas, typeof KanvazCards, typeof KanvazBoards] }));
    assert.equal(state.language, 'zh-CN'); assert.equal(state.button, 'Billfish 素材库');
    if (process.env.TEST_PERFORMANCE) {
      const performance = await page.evaluate(async libraryPath => {
        var lib = await KanvazBridge.billfish('connect', { path: libraryPath }); if (lib.error) throw new Error(lib.error);
        var files = await KanvazBridge.billfish('list', { uuid: lib.uuid, limit: 80 }); var before = await KanvazBridge.billfish('stats');
        var started = performance.now(); await KanvazBillfish.add(files.items); await new Promise(r => setTimeout(r, 1800));
        var partial = await KanvazBridge.billfish('stats'); var visible = document.querySelectorAll('.card img[src]').length;
        return { count: Object.keys(KanvazCards.getAll()).length, visible, before, partial, elapsedMs: performance.now() - started };
      }, path.join(root, '.tools', 'performance-fixture', 'library'));
      assert.equal(performance.count, 30); assert(performance.visible > 0 && performance.visible < 30, 'Only visible cards are initially decoded');
      assert(performance.partial.originalReads - performance.before.originalReads < 30); assert(performance.partial.bytes <= performance.partial.budget);
      await page.evaluate(() => KanvazCanvas.zoomFit()); await page.waitForFunction(() => document.querySelectorAll('.card img[src]').length === 30, { timeout: 60000 });
      const stats = await page.evaluate(() => KanvazBridge.billfish('stats')); assert(stats.bytes <= 32 * 1024 * 1024);
      await page.screenshot({ path: path.join(output, 'performance-30-images.png') });
      fs.writeFileSync(path.join(output, 'performance.json'), JSON.stringify({ performance, fittedCache: stats }, null, 2));
      console.log('PASS: 30×4096×3072 images, no preload of all originals, visible-only initial decoding, fit canvas, 32 MB cache bound.');
      if (process.env.TEST_SEQUENCE_DIR) {
        const framePaths = fs.readdirSync(process.env.TEST_SEQUENCE_DIR).filter(name => /^f\d+\.png$/i.test(name)).sort().map(name => path.join(process.env.TEST_SEQUENCE_DIR, name));
        const sequenceId = await page.evaluate(paths => KanvazCards.createSequenceFromPaths(paths, '24 fps 序列集成测试', 24, { x: 0, y: 0 }).id, framePaths);
        await page.waitForFunction(id => { const c = KanvazCards.getCard(id), v = document.getElementById(id) && document.getElementById(id).querySelector('video'); return c && v && v.readyState >= 1 && v.duration > 0; }, { timeout: 12000 }, sequenceId).catch(async error => { const debug = await page.evaluate(id => { var el=document.getElementById(id), v=el&&el.querySelector('video'); return { text: el&&el.innerText, src:v&&v.currentSrc, code:v&&v.error&&v.error.code, proxy: el&&el.querySelector('.card-error')&&el.querySelector('.card-error').innerText }; }, sequenceId); throw new Error(error.message + ' ' + JSON.stringify(debug)); });
        const sequence = await page.evaluate(id => { const c = KanvazCards.getCard(id), v = document.getElementById(id).querySelector('video'); return { type: c.type, fps: c.frameRate, frames: c.sequenceFrames.length, duration: v.duration, saved: KanvazBoards.serialise().boards[0].cards.find(x => x.id === id) }; }, sequenceId);
        assert.equal(sequence.type, 'video'); assert.equal(sequence.fps, 24); assert.equal(sequence.frames, 48); assert(Math.abs(sequence.duration - 2) < 0.03); assert.equal(sequence.saved.frameRate, 24); assert.equal(sequence.saved.sequenceFrames.length, 48);
        await page.evaluate(id => { Array.from(document.querySelectorAll('#' + id + ' button')).find(button => button.textContent.trim() === '24 fps').click(); }, sequenceId);
        await page.waitForSelector('#dialog-overlay.visible');
        assert.equal(await page.$eval('#dialog-title', el => el.textContent), '设置序列帧率');
        await page.click('#dialog-btns .btn');
        console.log('PASS: 48 source frames produce a paused, saved 24 fps sequence card with a 2-second timeline.');
      }
      if (process.env.TEST_VIDEO_PATH) {
        const videoId = await page.evaluate(async filePath => new Promise((resolve, reject) => KanvazMedia.loadFromPath(filePath, (media, error) => {
          if (error) return reject(new Error(String(error)));
          resolve(KanvazCards.createFromMedia(media, { x: 700, y: 0 }).id);
        })), process.env.TEST_VIDEO_PATH);
        await page.waitForFunction((id, requireProxy) => { const card = KanvazCards.getCard(id), v = document.getElementById(id) && document.getElementById(id).querySelector('video'); return v && v.readyState >= 1 && v.duration > 0 && (!requireProxy || card.mediaSource.proxy === true); }, { timeout: 30000 }, videoId, !!process.env.TEST_VIDEO_PROXY);
        const video = await page.evaluate(id => { const c = KanvazCards.getCard(id), v = document.getElementById(id).querySelector('video'); return { type: c.type, source: c.mediaSource, embedded: !!c.dataUrl, paused: v.paused, duration: v.duration, saved: KanvazBoards.serialise().boards[0].cards.find(x => x.id === id) }; }, videoId);
        assert.equal(video.type, 'video'); assert(video.source.url.startsWith('kanvaz-media:')); assert.equal(video.embedded, false); assert.equal(video.paused, true); assert(Math.abs(video.duration - 2) < 0.1); assert.equal(video.saved.dataUrl, null);
        if (process.env.TEST_VIDEO_PROXY) assert.equal(video.source.proxy, true, 'Unsupported source codec uses a generated playback proxy');
        console.log('PASS: video imports as a seekable local-file reference, remains paused, and saves without embedding media bytes.');
      }
      await page.evaluate(() => KanvazBridge.forceClose()); return;
    }
    if (process.env.TEST_REOPEN) {
      await page.waitForFunction(() => Object.keys(KanvazCards.getAll()).length >= 2);
      await new Promise(r => setTimeout(r, 1500));
      const reopened = await page.evaluate(() => ({ cards: Object.values(KanvazCards.getAll()).map(c => ({ reference: c.billfishSource, rotation: c.rotation, x: c.x, w: c.w, image: !!c.dataUrl })), viewport: KanvazCanvas.getViewport(), missing: document.querySelectorAll('.bf-missing').length }));
      assert.equal(reopened.cards[0].rotation, 35); assert.equal(reopened.cards[0].x, 420); assert.equal(reopened.cards[0].w, 330); assert.equal(reopened.viewport.scale, 0.75);
      assert(reopened.cards.every(c => c.reference)); assert.equal(reopened.missing, 0);
      if (process.env.TEST_EXTERNAL) {
        const paths = await page.evaluate(() => Object.values(KanvazCards.getAll()).slice(0, 2).map(c => c.path));
        const externalArgs = (process.env.TEST_EXE ? [] : [root]).concat(paths);
        const startAgain = () => new Promise((resolve, reject) => { const other = spawn(exe, externalArgs, { cwd: root, windowsHide: true, env: { ...process.env, KANVAZ_BILLFISH_DATA_DIR: profile }, stdio: 'ignore' }); other.once('error', reject); other.once('exit', resolve); });
        await startAgain(); await page.waitForFunction(() => Object.keys(KanvazCards.getAll()).length === 4); await startAgain(); await new Promise(r => setTimeout(r, 1000));
        assert.equal(await page.evaluate(() => Object.keys(KanvazCards.getAll()).length), 4, 'Identical second request is deduplicated');
        assert(await page.evaluate(() => Object.values(KanvazCards.getAll()).every(c => !!c.billfishSource)));
        assert.equal((await browser.pages()).length, 1, 'External launches reuse the original window');
        console.log('PASS: multi-file external launch, existing window reused, linked source preserved, repeated request deduplicated.');
      }
      await page.screenshot({ path: path.join(output, 'reopened-' + port + '.png') });
      fs.writeFileSync(path.join(output, 'reopened-' + port + '.json'), JSON.stringify(reopened, null, 2));
      console.log('PASS: saved linked .kanvaz reopened with references, rotation, size, position and viewport. EXE=' + exe);
      await page.evaluate(() => KanvazBridge.forceClose()); return;
    }
    fs.writeFileSync(path.join(output, 'initial-state.json'), JSON.stringify(state, null, 2));
    if (await page.$('#home-billfish')) await page.click('#home-billfish'); else await page.click('#btn-billfish');
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: path.join(output, 'browser-debug.png') });
    fs.writeFileSync(path.join(output, 'browser-debug.json'), JSON.stringify(await page.evaluate(async () => ({ text: document.body.innerText, libraries: await KanvazBridge.billfish('libraries'), errors: document.querySelector('#bf-grid') && document.querySelector('#bf-grid').innerHTML.slice(0, 2000) })), null, 2));
    await page.waitForSelector('.bf-tile img[src]', { timeout: 30000 });
    const browserState = await page.evaluate(() => ({ count: document.querySelectorAll('.bf-tile').length, names: Array.from(document.querySelectorAll('.bf-tile span')).slice(0, 3).map(n => n.textContent), colors: getComputedStyle(document.querySelector('.bf-box')).backgroundColor }));
    assert(browserState.count > 0); assert.notEqual(browserState.colors, 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: path.join(output, 'billfish-browser.png') });
    await page.click('.bf-tile'); await page.keyboard.down('Shift'); await page.click('.bf-tile:nth-child(3)'); await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.bf-tile.selected').length), 3, 'Shift selects a contiguous range');
    await page.type('#bf-search', 'logo'); await page.waitForFunction(() => Array.from(document.querySelectorAll('.bf-tile span')).length > 0 && Array.from(document.querySelectorAll('.bf-tile span')).every(n => n.textContent.toLowerCase().includes('logo')));
    await page.click('#bf-search'); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await new Promise(r => setTimeout(r, 400));
    await page.click('.bf-tile'); await page.keyboard.down('Control'); await page.click('.bf-tile:nth-child(2)'); await page.keyboard.up('Control');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.bf-tile.selected').length), 2);
    await page.click('#bf-add');
    await new Promise(r => setTimeout(r, 1500));
    fs.writeFileSync(path.join(output, 'add-debug.json'), JSON.stringify(await page.evaluate(() => ({ text: document.body.innerText, cards: Object.keys(KanvazCards.getAll()) })), null, 2));
    await page.waitForFunction(() => Object.keys(KanvazCards.getAll()).length >= 2);
    await new Promise(r => setTimeout(r, 1200));
    const board = await page.evaluate(() => ({ saved: KanvazBoards.serialise(), cards: Object.values(KanvazCards.getAll()).map(c => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h, reference: c.billfishSource, image: !!c.dataUrl })), viewport: KanvazCanvas.getViewport() }));
    assert.equal(board.cards.length, 2); assert(board.cards.every(c => c.reference && typeof c.reference.materialId === 'string')); assert(board.cards[0].x !== board.cards[1].x || board.cards[0].y !== board.cards[1].y);
    assert(!JSON.stringify(board.saved).includes('data:image/'), 'Linked boards contain no thumbnail or original bytes');
    const originalPositions = await page.evaluate(() => Object.values(KanvazCards.getAll()).map(c => ({ x: c.x, y: c.y })));
    const rect = await page.$eval('.card', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.move(rect.x, rect.y); await page.mouse.down(); await page.mouse.move(rect.x + 55, rect.y + 35, { steps: 8 }); await page.mouse.up();
    assert(await page.evaluate(before => Object.values(KanvazCards.getAll())[0].x !== before[0].x, originalPositions), 'Real mouse drag moves the image');
    await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
    assert.deepEqual(await page.evaluate(() => Object.values(KanvazCards.getAll()).map(c => ({ x: c.x, y: c.y }))), originalPositions, 'Undo restores the drag');
    await page.keyboard.down('Control'); await page.keyboard.press('y'); await page.keyboard.up('Control');
    assert(await page.evaluate(before => Object.values(KanvazCards.getAll())[0].x !== before[0].x, originalPositions), 'Redo restores movement');
    await page.mouse.move(600, 350); const worldBefore = await page.evaluate(() => KanvazCanvas.screenToWorld(600, 350)); await page.mouse.wheel({ deltaY: -120 }); await new Promise(r => setTimeout(r, 200));
    const worldAfter = await page.evaluate(() => KanvazCanvas.screenToWorld(600, 350)); assert(Math.abs(worldBefore.x - worldAfter.x) < 1 && Math.abs(worldBefore.y - worldAfter.y) < 1, 'Wheel zoom remains centered on the mouse');
    const originalPaths = await page.evaluate(() => Object.values(KanvazCards.getAll()).map(c => c.path));
    const hashes = originalPaths.map(p => require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
    await page.evaluate(() => { var ids = KanvazCards.getAllIds(); KanvazCards.setTransform(ids[0], { x: 420, y: 250, rotation: 35, w: 330, h: 220 }); KanvazCanvas.setZoom(0.75); });
    assert.equal(await page.evaluate(() => Object.values(KanvazCards.getAll())[0].rotation), 35);
    const saved = await page.evaluate(async p => { var data = JSON.stringify(KanvazBoards.serialise()); return KanvazBridge.writeFile(p, data); }, boardFile);
    assert(saved.ok, JSON.stringify(saved));
    const disk = await require('../src/board-container').unpackBoard(fs.readFileSync(boardFile)); assert(!disk.includes('data:image/'));
    await page.evaluate(() => { var first = Object.values(KanvazCards.getAll())[0]; KanvazCards.createFromMedia({ type: 'image', name: '缺失测试卡片', billfishSource: { libraryUuid: first.billfishSource.libraryUuid, materialId: '9223372036854775806' }, displayW: 250, displayH: 180 }, { x: 50, y: 50 }); });
    await page.waitForSelector('.bf-missing'); assert.equal(await page.$eval('.bf-missing strong', el => el.textContent), '素材已丢失');
    await page.click('.bf-missing button'); await page.waitForSelector('.bf-tile img[src]'); await page.click('.bf-tile'); await page.click('#bf-add');
    await page.waitForFunction(() => { var cards = Object.values(KanvazCards.getAll()); return cards[cards.length - 1].billfishSource.materialId !== '9223372036854775806' && !document.querySelector('.bf-missing'); });
    assert.equal(await page.evaluate(() => Object.keys(KanvazCards.getAll()).length), 3, 'Relinking retains the existing card');
    await page.evaluate(() => { var cards = Object.values(KanvazCards.getAll()); KanvazCards.deleteCard(cards[cards.length - 1].id); });
    for (let n = 0; n < originalPaths.length; n++) assert.equal(require('crypto').createHash('sha256').update(fs.readFileSync(originalPaths[n])).digest('hex'), hashes[n], 'Deleting a card never edits the source');
    await page.screenshot({ path: path.join(output, 'billfish-canvas.png') });
    await page.evaluate(() => KanvazI18n.setLanguage('en'));
    assert.equal(await page.$eval('#btn-billfish', el => el.textContent), 'Billfish Library');
    await page.evaluate(() => KanvazI18n.setLanguage('zh-CN'));
    fs.writeFileSync(path.join(output, 'ui-state.json'), JSON.stringify({ state, browserState, board, errors }, null, 2));
    assert.deepEqual(errors, []);
    console.log('PASS: Electron Chinese UI, read-only library browser, thumbnails, Ctrl multiselect, linked add, nonoverlap, transforms, language switch.');
    await page.evaluate(() => KanvazBridge.forceClose());
  } finally { if (browser) { if (process.env.TEST_LAUNCHER) await browser.close(); else browser.disconnect(); } if (child.exitCode === null) child.kill(); fs.closeSync(log); }
}
run().catch(e => { console.error(e.stack); process.exitCode = 1; });
