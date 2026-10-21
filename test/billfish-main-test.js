/* Exercise production IPC handlers with native dialogs directed at test-only paths. */
const fs = require('fs'); const path = require('path'); const assert = require('assert'); const Module = require('module'); const crypto = require('crypto');
const root = path.join(__dirname, '..', '.tools', 'billfish-fixtures'); const { BillfishStore } = require('../src/billfish-store');
const store = new BillfishStore(path.join(root, 'ipc-profile')); const lib = store.connect(path.join(root, 'library-B')); const file = store.list(lib.uuid).items[0];
const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex');
const handlers = {}; let target = path.join(root, 'independent.kanvaz');
const fakeElectron = { ipcMain: { handle(name, handler) { handlers[name] = handler; } }, dialog: { showSaveDialog: async () => ({ canceled: false, filePath: target }), showOpenDialog: async () => ({ canceled: false, filePaths: [root] }) } };
const originalLoad = Module._load; Module._load = function(name, parent, isMain) { return name === 'electron' ? fakeElectron : originalLoad.call(this, name, parent, isMain); };
const { install } = require('../src/billfish-main'); Module._load = originalLoad; install(store, () => null);
const data = { version: '9.8.2', activeIdx: 0, boards: [{ id: 'one', name: '独立板', cards: [{ id: 'card', type: 'image', billfishSource: { libraryUuid: lib.uuid, materialId: file.id }, dataUrl: null, x: 10, y: 20, w: 200, h: 150, rotation: 42 }] }] };
async function run() {
  const linked = await handlers['billfish-export']({}, { data: JSON.stringify(data), linked: true }); assert(linked.ok);
  const container = require('../src/board-container'); const standalone = JSON.parse(await container.unpackBoard(fs.readFileSync(target))); assert(standalone.boards[0].cards[0].billfishSource); assert(!standalone.boards[0].cards[0].dataUrl);
  target = path.join(root, 'portable-package.kanvaz'); const packed = await handlers['billfish-export']({}, { data: JSON.stringify(data) }); assert(packed.ok);
  const moved = JSON.parse(await container.unpackBoard(fs.readFileSync(target))); assert(!moved.boards[0].cards[0].billfishSource); assert(moved.boards[0].cards[0].dataUrl.startsWith('data:image/png;base64,')); assert.equal(moved.boards[0].cards[0].rotation, 42);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex'), sourceHash);
  target = path.join(lib.path, 'forbidden.kanvaz'); const blocked = await handlers['billfish-export']({}, { data: JSON.stringify(data) }); assert(blocked.error); assert(!fs.existsSync(target));
  const setting = await handlers['billfish-save-directory']({}, {}); assert.equal(setting.defaultSaveDirectory, root);
  console.log('PASS: production IPC independent linked save, complete package export embedding originals, safe destination guard, save directory selection, source hashes unchanged.'); store.close();
}
run().catch(e => { console.error(e.stack); store.close(); process.exitCode = 1; });
