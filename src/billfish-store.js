/* Billfish read-only connector. IDs cross IPC as decimal strings. */
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var DatabaseSync = require('node:sqlite').DatabaseSync;
var pathGuard = require('./path-guard');
var IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'svg'];
var VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv', 'avi'];

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  var tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  var fd = fs.openSync(tmp, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch (_) {} throw e; }
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function canonical(folder) {
  if (!pathGuard.isLocalAbsolutePath(folder)) throw new Error('请选择本机的 Billfish 资源库目录');
  return fs.realpathSync(folder);
}
function query(db, sql, args) {
  var stmt = db.prepare(sql);
  stmt.setReadBigInts(true);
  return stmt.all.apply(stmt, args || []);
}
function columns(db, table) {
  var rows = query(db, 'PRAGMA table_info("' + table + '")');
  return rows.map(function(row) { return row.name; });
}
function BillfishStore(dataDir) {
  this.file = path.join(dataDir, 'billfish', 'settings.json');
  this.settings = readJson(this.file, { language: 'zh-CN', defaultLibrary: 'D:\\本地资源库', defaultSaveDirectory: '', libraries: [] });
  this.settings.libraries = this.settings.libraries || [];
  this.settings.treeStates = this.settings.treeStates || {};
  this.settings.language = this.settings.language === 'en' ? 'en' : 'zh-CN';
  this.settings.defaultLibrary = this.settings.defaultLibrary || 'D:\\本地资源库';
  this.connections = {};
}
BillfishStore.prototype.saveSettings = function(patch) {
  if (patch.treeStates && typeof patch.treeStates === 'object') {
    var states = {};
    var uuids = Object.keys(patch.treeStates).slice(0, 100);
    for (var ti = 0; ti < uuids.length; ti++) states[String(uuids[ti])] = (patch.treeStates[uuids[ti]] || []).map(String).slice(0, 50000);
    this.settings.treeStates = states;
  }
  if (patch.language) this.settings.language = patch.language === 'en' ? 'en' : 'zh-CN';
  if (patch.defaultSaveDirectory !== undefined) {
    var dest = patch.defaultSaveDirectory;
    if (dest && (!pathGuard.isLocalAbsolutePath(dest) || !fs.statSync(dest).isDirectory())) throw new Error('请选择有效的本机保存目录');
    if (dest && this.isLibraryPath(dest)) throw new Error('素材板应保存到 Billfish 资源库以外的目录');
    this.settings.defaultSaveDirectory = dest;
  }
  atomicJson(this.file, this.settings);
  return this.settings;
};
BillfishStore.prototype.isLibraryPath = function(file) {
  var resolved = path.resolve(file).toLowerCase(); var probe = path.resolve(file); var suffix = [];
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) { suffix.unshift(path.basename(probe)); probe = path.dirname(probe); }
  try { resolved = path.join.apply(path, [fs.realpathSync(probe)].concat(suffix)).toLowerCase(); } catch (_) {}
  if (resolved.split(path.sep).indexOf('.bf') >= 0) return true;
  var libs = this.settings.libraries.concat([{ path: this.settings.defaultLibrary }]);
  for (var i = 0; i < libs.length; i++) {
    var root = path.resolve(libs[i].path).toLowerCase();
    if (resolved === root || resolved.indexOf(root + path.sep) === 0) return true;
  }
  return false;
};
BillfishStore.prototype.connect = function(folder, knownUuid) {
  var root = canonical(folder);
  var dbPath = path.join(root, '.bf', 'billfish.db');
  if (!fs.statSync(dbPath).isFile()) throw new Error('所选文件夹不是 Billfish 资源库');
  var entry = null;
  var stat = fs.statSync(root, { bigint: true });
  var identity = String(stat.dev) + ':' + String(stat.ino);
  for (var i = 0; i < this.settings.libraries.length; i++) {
    var item = this.settings.libraries[i];
    if ((knownUuid && item.uuid === knownUuid) || (item.path.toLowerCase() === root.toLowerCase() && (!item.identity || item.identity === identity)) || (stat.ino !== 0n && item.identity === identity)) { entry = item; break; }
  }
  if (!entry) entry = { uuid: crypto.randomUUID(), path: root, identity: identity };
  var db = new DatabaseSync(dbPath, { readOnly: true, enableExtensions: false });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=3000;');
    var fileCols = columns(db, 'bf_file');
    var folderCols = columns(db, 'bf_folder');
    if (['id', 'name', 'pid'].some(function(c) { return fileCols.indexOf(c) === -1; }) || ['id', 'name', 'pid'].some(function(c) { return folderCols.indexOf(c) === -1; })) throw new Error('此 Billfish 数据库缺少必要字段，未执行任何修改');
    if (this.connections[entry.uuid]) this.connections[entry.uuid].db.close();
    entry.path = root; entry.identity = identity; entry.name = path.basename(root);
    if (this.settings.libraries.indexOf(entry) === -1) this.settings.libraries.push(entry);
    this.settings.defaultLibrary = root;
    this.connections[entry.uuid] = { db: db, entry: entry, fileCols: fileCols, folderCols: folderCols, folders: {}, rows: [], byId: {} };
    this.refresh(entry.uuid);
    atomicJson(this.file, this.settings);
    return this.describe(entry.uuid);
  } catch (e) { db.close(); delete this.connections[entry.uuid]; throw e; }
};
BillfishStore.prototype.get = function(uuid) {
  var entry = this.settings.libraries.find(function(item) { return item.uuid === uuid; });
  if (!entry) throw new Error('素材库尚未关联，请重新关联素材');
  var stat = fs.statSync(entry.path, { bigint: true });
  if (entry.identity && stat.ino !== 0n && entry.identity !== String(stat.dev) + ':' + String(stat.ino)) throw new Error('素材库目录身份已改变，请重新关联素材');
  if (this.connections[uuid]) return this.connections[uuid];
  this.connect(entry.path, uuid);
  return this.connections[uuid];
};
BillfishStore.prototype.refresh = function(uuid) {
  var conn = this.connections[uuid] || this.get(uuid);
  var folders = query(conn.db, 'SELECT id,pid,name' + (conn.folderCols.indexOf('is_recycle') >= 0 ? ',is_recycle' : '') + ' FROM bf_folder');
  conn.folders = {};
  for (var f = 0; f < folders.length; f++) {
    var folder = folders[f];
    conn.folders[String(folder.id)] = { id: String(folder.id), pid: String(folder.pid), name: folder.name, recycled: !!folder.is_recycle };
  }
  var fields = ['id', 'pid', 'name'];
  for (var j = 0; j < ['md5', 'file_size', 'mtime', 'is_link'].length; j++) {
    var col = ['md5', 'file_size', 'mtime', 'is_link'][j];
    if (conn.fileCols.indexOf(col) >= 0) fields.push(col);
  }
  var rows = query(conn.db, 'SELECT ' + fields.join(',') + ' FROM bf_file');
  var dimensions = {}; var materialCols = columns(conn.db, 'bf_material_v2');
  if (['file_id', 'w', 'h'].every(function(c) { return materialCols.indexOf(c) >= 0; })) {
    query(conn.db, 'SELECT file_id,w,h FROM bf_material_v2').map(function(m) { dimensions[String(m.file_id)] = { width: Number(m.w) || 0, height: Number(m.h) || 0 }; });
  }
  conn.rows = []; conn.byId = {};
  for (var k = 0; k < rows.length; k++) {
    var row = rows[k]; var id = String(row.id); var pid = String(row.pid);
    var ext = path.extname(row.name || '').slice(1).toLowerCase();
    if (IMAGE_EXTS.indexOf(ext) === -1 && VIDEO_EXTS.indexOf(ext) === -1 || row.pid < 0n) continue;
    var parts = []; var current = pid; var seen = {}; var recycled = false;
    while (conn.folders[current]) {
      if (seen[current]) { recycled = true; break; }
      seen[current] = true;
      var parent = conn.folders[current];
      if (parent.recycled || parent.pid === '-1') { recycled = true; break; }
      parts.unshift(parent.name); current = parent.pid;
    }
    if (recycled || current !== '0') continue;
    var full = path.resolve.apply(path, [conn.entry.path].concat(parts, [row.name]));
    var relative = path.relative(conn.entry.path, full);
    if (relative.indexOf('..' + path.sep) === 0 || path.isAbsolute(relative)) continue;
    var file = { id: id, folderId: pid, libraryUuid: uuid, name: row.name, ext: ext, path: full, relativePath: relative, md5: row.md5 || '', size: row.file_size !== undefined ? String(row.file_size) : '', mtime: row.mtime !== undefined ? String(row.mtime) : '' };
    file.width = dimensions[id] ? dimensions[id].width : 0; file.height = dimensions[id] ? dimensions[id].height : 0;
    conn.rows.push(file); conn.byId[id] = file;
  }
  conn.lastRefresh = Date.now();
  return this.describe(uuid);
};
BillfishStore.prototype.describe = function(uuid) {
  var conn = this.connections[uuid];
  if (!conn) throw new Error('素材库未连接');
  return { uuid: uuid, path: conn.entry.path, name: conn.entry.name, count: conn.rows.length, readOnly: true, folders: Object.keys(conn.folders).map(function(id) { return conn.folders[id]; }).filter(function(folder) { return !folder.recycled && folder.pid !== '-1'; }) };
};
BillfishStore.prototype.list = function(uuid, options) {
  options = options || {}; var conn = this.get(uuid); var search = String(options.search || '').toLowerCase();
  var rows = conn.rows.filter(function(file) { var video = VIDEO_EXTS.indexOf(file.ext) >= 0; return (!options.kind || options.kind === 'all' || (options.kind === 'video' ? video : !video)) && (!options.folderId || options.folderId === '0' || file.folderId === String(options.folderId)) && (!options.ext || file.ext === options.ext) && (!search || file.name.toLowerCase().indexOf(search) >= 0); });
  var offset = Math.max(0, Number(options.offset) || 0); var limit = Math.min(120, Math.max(1, Number(options.limit) || 80));
  return { total: rows.length, offset: offset, items: rows.slice(offset, offset + limit) };
};
BillfishStore.prototype.resolve = function(reference, refresh) {
  var conn = this.get(reference.libraryUuid);
  if (refresh && Date.now() - (conn.lastRefresh || 0) > 1500) this.refresh(reference.libraryUuid);
  var file = conn.byId[String(reference.materialId || reference.id)];
  if (!file || !fs.existsSync(file.path)) return { missing: true, reference: reference };
  return { missing: false, file: file };
};
BillfishStore.prototype.imagePath = function(file, quality) {
  var conn = this.get(file.libraryUuid);
  var shard = (BigInt(file.id) & 255n).toString(16).padStart(2, '0');
  var names = quality === 'original' ? [] : quality === 'hd' ? ['hd', 'small'] : ['small'];
  for (var i = 0; i < names.length; i++) {
    var candidate = path.join(conn.entry.path, '.bf', '.preview', shard, file.id + '.' + names[i] + '.webp');
    if (fs.existsSync(candidate)) return candidate;
  }
  return file.path;
};
BillfishStore.prototype.findPath = function(input) {
  var full = path.resolve(input).toLowerCase();
  for (var j = 0; j < this.settings.libraries.length; j++) {
    var entry = this.settings.libraries[j];
    if (!this.connections[entry.uuid] && full.indexOf(path.resolve(entry.path).toLowerCase() + path.sep) === 0) { try { this.get(entry.uuid); } catch (_) {} }
  }
  for (var uuid in this.connections) {
    var rows = this.connections[uuid].rows;
    for (var i = 0; i < rows.length; i++) if (rows[i].path.toLowerCase() === full) return rows[i];
  }
  return null;
};
BillfishStore.prototype.close = function() { for (var uuid in this.connections) { this.connections[uuid].db.close(); } this.connections = {}; };
module.exports = { BillfishStore: BillfishStore, IMAGE_EXTS: IMAGE_EXTS, VIDEO_EXTS: VIDEO_EXTS, atomicJson: atomicJson, readJson: readJson };
