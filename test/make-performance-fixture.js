const fs = require('fs'); const path = require('path'); const { DatabaseSync } = require('node:sqlite');
const root = path.join(__dirname, '..', '.tools', 'performance-fixture'); const library = path.join(root, 'library');
fs.mkdirSync(path.join(library, '.bf'), { recursive: true }); fs.mkdirSync(path.join(library, '图片'), { recursive: true });
if (!fs.existsSync(path.join(root, 'base.png'))) {
  const width = 4096, height = 3072, raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) raw.fill(y % 255, y * (width * 3 + 1) + 1, (y + 1) * (width * 3 + 1));
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const n of b) c = table[(c ^ n) & 255] ^ c >>> 8; return (c ^ 0xffffffff) >>> 0; };
  const chunk = (name, bytes) => { const body = Buffer.concat([Buffer.from(name), bytes]); const head = Buffer.alloc(4), tail = Buffer.alloc(4); head.writeUInt32BE(bytes.length); tail.writeUInt32BE(crc(body)); return Buffer.concat([head, body, tail]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  fs.writeFileSync(path.join(root, 'base.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', require('zlib').deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const db = new DatabaseSync(path.join(library, '.bf', 'billfish.db'));
db.exec("DROP TABLE IF EXISTS bf_file; DROP TABLE IF EXISTS bf_folder; DROP TABLE IF EXISTS bf_material_v2; CREATE TABLE bf_file(id INTEGER PRIMARY KEY,pid INTEGER,name TEXT); CREATE TABLE bf_folder(id INTEGER PRIMARY KEY,pid INTEGER,name TEXT); CREATE TABLE bf_material_v2(file_id INTEGER PRIMARY KEY,w INTEGER,h INTEGER); INSERT INTO bf_folder VALUES(1,0,'图片');");
for (const old of fs.readdirSync(path.join(library, '图片'))) if (/^高分辨率测试-.*\.png$/i.test(old)) fs.unlinkSync(path.join(library, '图片', old));
for (let n = 1; n <= 30; n++) { let value = n, suffix = ''; while (value) { value--; suffix = String.fromCharCode(65 + value % 26) + suffix; value = Math.floor(value / 26); } const name = '高分辨率测试-样本-' + suffix + '.png'; fs.copyFileSync(path.join(root, 'base.png'), path.join(library, '图片', name)); db.prepare('INSERT INTO bf_file VALUES(?,?,?)').run(n, 1, name); db.prepare('INSERT INTO bf_material_v2 VALUES(?,?,?)').run(n, 4096, 3072); }
db.close(); console.log('Created isolated 30-image 4096×3072 performance library (no preview cache).');
