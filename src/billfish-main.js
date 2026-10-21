/* IPC boundary for the read-only library browser. No renderer-selected raw SQL. */
var fs = require('fs');
var path = require('path');
var electron = require('electron');
var storeLib = require('./billfish-store');
var container = require('./board-container');
var saveGuard = require('./save-guard');
function install(store, getWindow) {
  var cache = new Map(); var bytes = 0; var budget = 32 * 1024 * 1024; var imageRequests = 0; var originalReads = 0;
  function safe(name, handler) {
    electron.ipcMain.handle('billfish-' + name, function(event, arg) {
      return Promise.resolve().then(function() { return handler(arg || {}); }).catch(function(e) { return { error: e.message }; });
    });
  }
  function choose(title) {
    return electron.dialog.showOpenDialog(getWindow(), { title: title, properties: ['openDirectory'] }).then(function(r) { return r.canceled ? null : r.filePaths[0]; });
  }
  function image(arg) {
    imageRequests++;
    var resolved = store.resolve(arg.reference, !!arg.refresh);
    if (resolved.missing) return resolved;
    var file = store.imagePath(resolved.file, arg.quality);
    var root = store.get(resolved.file.libraryUuid).entry.path;
    var actual = fs.realpathSync(file);
    var relative = path.relative(root, actual);
    if (relative === '..' || relative.indexOf('..' + path.sep) === 0 || path.isAbsolute(relative)) throw new Error('素材路径超出所选资源库');
    var stat = fs.statSync(actual);
    if (stat.size > 500 * 1024 * 1024) throw new Error('图片超过 500 MB，无法预览');
    var key = actual + ':' + stat.mtimeMs + ':' + (arg.quality || 'small');
    if (cache.has(key)) { var hit = cache.get(key); cache.delete(key); cache.set(key, hit); return { file: resolved.file, image: hit.image, width: hit.width, height: hit.height }; }
    if (file === resolved.file.path) originalReads++;
    var extension = path.extname(actual).toLowerCase();
    var size; var data;
    if (storeLib.VIDEO_EXTS.indexOf(extension.slice(1)) >= 0) {
      var ffmpeg = require('path').resolve(__dirname, '..', '.tools', 'ffmpeg-n8.1-lgpl', 'ffmpeg-n8.1-latest-win64-lgpl-shared-8.1', 'bin', 'ffmpeg.exe');
      if (require('fs').existsSync(require('path').join(process.resourcesPath || '', 'ffmpeg', 'ffmpeg.exe'))) ffmpeg = require('path').join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
      var jpeg = require('child_process').execFileSync(ffmpeg, ['-hide_banner','-loglevel','error','-ss','1','-i',actual,'-frames:v','1','-vf','scale=512:-2','-f','image2pipe','-vcodec','mjpeg','pipe:1'], { windowsHide: true, timeout: 12000, maxBuffer: 8 * 1024 * 1024 });
      data = 'data:image/jpeg;base64,' + jpeg.toString('base64'); size = { width: resolved.file.width || 512, height: resolved.file.height || 288 };
    }
    var bitmap = data ? null : electron.nativeImage.createFromPath(actual);
    if (data) { /* generated video thumbnail */ }
    else if (bitmap.isEmpty() && path.extname(actual).toLowerCase() === '.webp' && stat.size <= 8 * 1024 * 1024) {
      var webp = fs.readFileSync(actual); var kind = webp.toString('ascii', 12, 16); size = { width: 512, height: 512 };
      if (kind === 'VP8X' && webp.length >= 30) size = { width: webp.readUIntLE(24, 3) + 1, height: webp.readUIntLE(27, 3) + 1 };
      else if (kind === 'VP8 ' && webp.length >= 30) size = { width: webp.readUInt16LE(26) & 16383, height: webp.readUInt16LE(28) & 16383 };
      else if (kind === 'VP8L' && webp.length >= 25) { var bits = webp.readUInt32LE(21); size = { width: (bits & 16383) + 1, height: ((bits >>> 14) & 16383) + 1 }; }
      data = 'data:image/webp;base64,' + webp.toString('base64');
    } else if (bitmap.isEmpty() && ['.gif', '.svg', '.avif'].indexOf(extension) >= 0 && stat.size <= 8 * 1024 * 1024) {
      var mimeType = { '.gif': 'image/gif', '.svg': 'image/svg+xml', '.avif': 'image/avif' }[extension];
      data = 'data:' + mimeType + ';base64,' + fs.readFileSync(actual).toString('base64'); size = { width: 512, height: 512 };
    } else if (!data) {
      if (bitmap.isEmpty()) throw new Error('当前图片格式无法解码');
      size = bitmap.getSize(); var max = arg.quality === 'small' ? 512 : arg.quality === 'original' ? 4096 : 2048;
      if (size.width > max || size.height > max) bitmap = bitmap.resize(size.width >= size.height ? { width: max } : { height: max });
      data = bitmap.toDataURL();
    }
    size.width = resolved.file.width || size.width; size.height = resolved.file.height || size.height;
    var entry = { image: data, width: size.width, height: size.height, bytes: data.length * 2 };
    while (bytes + entry.bytes > budget && cache.size) { var oldest = cache.keys().next().value; bytes -= cache.get(oldest).bytes; cache.delete(oldest); }
    if (entry.bytes <= budget) { cache.set(key, entry); bytes += entry.bytes; }
    return { file: resolved.file, image: data, width: size.width, height: size.height };
  }
  safe('settings', function(arg) {
    if (arg.patch) store.saveSettings(arg.patch);
    return store.settings;
  });
  safe('connect', function(arg) {
    return (arg.path ? Promise.resolve(arg.path) : choose('选择 Billfish 资源库')).then(function(folder) { return folder ? store.connect(folder, arg.uuid) : { canceled: true }; });
  });
  safe('libraries', function() { return store.settings.libraries.map(function(lib) { try { return store.describe(lib.uuid); } catch (_) { return { uuid: lib.uuid, path: lib.path, name: lib.name, offline: true }; } }); });
  safe('list', function(arg) { return store.list(arg.uuid, arg); });
  safe('refresh', function(arg) { cache.clear(); bytes = 0; return store.refresh(arg.uuid); });
  safe('image', image);
  safe('stats', function() { return { bytes: bytes, budget: budget, count: cache.size, imageRequests: imageRequests, originalReads: originalReads }; });
  safe('match', function(arg) { return (arg.paths || []).map(function(file) { return store.findPath(file); }); });
  safe('save-directory', function() { return choose('选择默认素材板保存目录').then(function(folder) { return folder ? store.saveSettings({ defaultSaveDirectory: folder }) : { canceled: true }; }); });
  safe('export', function(arg) {
    var data;
    try { data = JSON.parse(arg.data); } catch (_) { throw new Error('素材板数据无效'); }
    function embed(record) {
      if (!record || typeof record !== 'object') return;
      if (record.billfishSource) {
        var result = store.resolve(record.billfishSource, true);
        if (result.missing) throw new Error('无法打包丢失的素材：' + (record.name || record.billfishSource.materialId));
        var file = fs.realpathSync(result.file.path); var rel = path.relative(store.get(result.file.libraryUuid).entry.path, file);
        if (rel === '..' || rel.indexOf('..' + path.sep) === 0 || path.isAbsolute(rel)) throw new Error('素材路径超出所选资源库');
        if (fs.statSync(file).size > 500 * 1024 * 1024) throw new Error('素材超过打包大小限制');
        var ext = path.extname(file).slice(1).toLowerCase();
        var mime = { jpg: 'jpeg', svg: 'svg+xml', tif: 'tiff' }[ext] || ext;
        record.dataUrl = 'data:image/' + mime + ';base64,' + fs.readFileSync(file).toString('base64');
        delete record.billfishSource; record.path = '';
      }
      Object.keys(record).map(function(key) { if (record[key] && typeof record[key] === 'object') embed(record[key]); });
    }
    if (!arg.linked) embed(data);
    return electron.dialog.showSaveDialog(getWindow(), { title: arg.linked ? '单独保存当前素材板' : '打包导出完整素材板', defaultPath: path.join(store.settings.defaultSaveDirectory || '', arg.linked ? '素材板.kanvaz' : '素材板-完整包.kanvaz'), filters: [{ name: 'Kanvaz 素材板', extensions: ['kanvaz'] }] }).then(function(r) {
      if (r.canceled) return { canceled: true };
      var target = /\.kanvaz$/i.test(r.filePath) ? r.filePath : r.filePath + '.kanvaz';
      if (store.isLibraryPath(target)) throw new Error('请将素材板保存到 Billfish 资源库以外');
      return container.packBoard(JSON.stringify(data)).then(function(buf) { return saveGuard.guardedWrite(target, buf, { force: true }); });
    });
  });
  return { image: image, cacheStats: function() { return { bytes: bytes, budget: budget, count: cache.size }; } };
}
module.exports = { install: install };
