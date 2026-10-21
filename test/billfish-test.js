/* Independent sample libraries only; never writes the user's Billfish database. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { BillfishStore } = require('../src/billfish-store');
const boardContainer = require('../src/board-container');
const JSZip = require('jszip');
const root = path.join(__dirname, '..', '.tools', 'billfish-fixtures');
fs.mkdirSync(root, { recursive: true });
const id = '9007199254740993';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5kAAAAASUVORK5CYII=', 'base64');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(name) {
  const folder = path.join(root, name); fs.mkdirSync(path.join(folder, '.bf', '.preview', '01'), { recursive: true }); fs.mkdirSync(path.join(folder, '图片'), { recursive: true });
  const dbFile = path.join(folder, '.bf', 'billfish.db');
  const db = new DatabaseSync(dbFile); db.exec('DROP TABLE IF EXISTS bf_file; DROP TABLE IF EXISTS bf_folder; CREATE TABLE bf_file(id INTEGER PRIMARY KEY,name TEXT,pid INTEGER,md5 TEXT,file_size INTEGER); CREATE TABLE bf_folder(id INTEGER PRIMARY KEY,pid INTEGER,name TEXT,is_recycle INTEGER);');
  db.exec("INSERT INTO bf_folder VALUES(1,0,'图片',0),(2,0,'回收',1); INSERT INTO bf_file VALUES(" + id + ",'测试.png',1,'hash',68),(" + (BigInt(id) + 1n) + ",'第二张.png',1,'hash',68),(12,'丢弃.png',2,'hash',68);"); db.close();
  fs.writeFileSync(path.join(folder, '图片', '测试.png'), png); fs.writeFileSync(path.join(folder, '图片', '第二张.png'), png);
  // NativeImage identifies content independently of filename. A PNG cache fixture exercises shard lookup.
  fs.writeFileSync(path.join(folder, '.bf', '.preview', '01', id + '.small.webp'), png);
  return folder;
}
async function run() {
  const lib = fixture('library-A'); const second = fixture('library-B'); const dbFile = path.join(lib, '.bf', 'billfish.db'); const before = hash(dbFile); const original = path.join(lib, '图片', '测试.png'); const sourceHash = hash(original);
  const store = new BillfishStore(path.join(root, 'profile'));
  const a = store.connect(lib); const b = store.connect(second); assert.notEqual(a.uuid, b.uuid); assert.equal(a.count, 2);
  const files = store.list(a.uuid, { search: '测试', limit: 80 }); assert.equal(files.total, 1); assert.equal(files.items[0].id, id); assert.equal(files.items[0].path, original);
  assert(store.imagePath(files.items[0], 'small').endsWith(path.join('01', id + '.small.webp')));
  assert.equal(store.imagePath(files.items[0], 'original'), original);
  const db = store.get(a.uuid).db; assert.equal(db.prepare('PRAGMA query_only').get().query_only, 1);
  assert.throws(() => db.exec("UPDATE bf_file SET name='forbidden.png'"), /readonly|read-only/i);
  assert.equal(hash(dbFile), before); assert.equal(hash(original), sourceHash);
  const reference = { libraryUuid: a.uuid, materialId: id, originalPath: original, name: '测试.png' };
  const data = { version: '9.8.2', activeIdx: 0, boards: [{ id: 'board', name: '测试板', cards: [{ id: 'linked', type: 'image', dataUrl: null, billfishSource: reference, x: 10, y: 20, w: 280, h: 180, rotation: 35, z: 2 }] }] };
  const packed = await boardContainer.packBoard(JSON.stringify(data)); const zip = await JSZip.loadAsync(packed); assert(!Object.keys(zip.files).some(name => name.startsWith('assets/') && !zip.files[name].dir));
  const unpacked = JSON.parse(await boardContainer.unpackBoard(packed)); assert.deepEqual(unpacked.boards[0].cards[0].billfishSource, reference); assert.equal(unpacked.boards[0].cards[0].rotation, 35);
  store.close();
  const again = new BillfishStore(path.join(root, 'profile')); assert.equal(again.connect(lib).uuid, a.uuid); assert(!again.resolve(reference).missing);
  // Simulate Billfish moving a file in the TEST database, after closing the reader.
  again.close(); fs.renameSync(original, path.join(lib, '图片', '已移动.png'));
  const writer = new DatabaseSync(dbFile); writer.exec("UPDATE bf_file SET name='已移动.png' WHERE id=" + id); writer.close();
  const moved = new BillfishStore(path.join(root, 'profile')); moved.connect(lib); assert.equal(moved.resolve(reference).file.name, '已移动.png');
  fs.unlinkSync(path.join(lib, '图片', '已移动.png')); assert(moved.resolve(reference).missing); assert.equal(data.boards[0].cards.length, 1, 'Missing references remain serialized');
  assert(moved.isLibraryPath(path.join(lib, 'board.kanvaz'))); assert(moved.isLibraryPath('D:\\本地资源库\\.bf\\test.kanvaz'));
  assert.throws(() => moved.saveSettings({ defaultSaveDirectory: lib }), /以外/);
  moved.saveSettings({ defaultSaveDirectory: root, language: 'en' }); assert.equal(moved.settings.language, 'en'); moved.close();
  console.log('PASS: read-only/query_only, original hashes unchanged, 64-bit IDs, shard paths, recycled exclusion, per-library UUIDs, linked ZIP roundtrip without assets, persistent registry, move-by-ID, missing retention, protected save directories.');
  fs.writeFileSync(path.join(root, 'fixture-info.json'), JSON.stringify({ library: lib, uuid: a.uuid, id }, null, 2));
}
run().catch(e => { console.error(e.stack); process.exitCode = 1; });
