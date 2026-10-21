/* Cache location is independent of profiles, projects and frame-note storage. */
'use strict';
var fs = require('fs');
var path = require('path');
function create(app) {
  var data = app.getPath('userData'), file = path.join(data, 'cache-location.json');
  var configured = null, warning = '';
  try { configured = JSON.parse(fs.readFileSync(file, 'utf8')).directory || null; } catch (e) { if (e.code !== 'ENOENT') warning = '缓存目录配置无法读取，已使用默认目录'; }
  function validate(directory) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || /^\\\\|^\/\//.test(directory) || directory.indexOf('\0') !== -1) throw new Error('请选择本地缓存文件夹');
    var resolved = path.resolve(directory);
    if (path.basename(resolved) !== 'Kanvaz-Cache') throw new Error('缓存必须使用专用的 Kanvaz-Cache 子目录');
    fs.mkdirSync(resolved, { recursive: true });
    var probe = path.join(resolved, '.write-test-' + require('crypto').randomBytes(8).toString('hex'));
    fs.writeFileSync(probe, ''); fs.unlinkSync(probe); return resolved;
  }
  var active = null;
  if (configured) { try { active = validate(configured); var session = path.join(active, 'browser-cache'); fs.mkdirSync(session, { recursive: true }); app.setPath('sessionData', session); } catch (e) { active = null; warning = '自定义缓存目录不可用，已使用默认目录：' + e.message; } }
  function status() { return { ok: true, directory: configured || path.join(data, 'media-cache'), activeDirectory: active || path.join(data, 'media-cache'), custom: !!configured, restartRequired: configured !== active, warning: warning }; }
  function set(directory) {
    var next = directory ? validate(path.basename(path.resolve(directory)) === 'Kanvaz-Cache' ? directory : path.join(directory, 'Kanvaz-Cache')) : null;
    fs.mkdirSync(data, { recursive: true });
    var temp = file + '.tmp'; fs.writeFileSync(temp, JSON.stringify({ directory: next })); fs.renameSync(temp, file);
    configured = next; warning = ''; return status();
  }
  return { status: status, set: set, media: function() { return active ? path.join(active, 'media-cache') : path.join(data, 'media-cache'); }, temporary: function() { return path.join(active || path.join(data, 'media-cache'), 'temporary'); } };
}
module.exports = { create: create };
