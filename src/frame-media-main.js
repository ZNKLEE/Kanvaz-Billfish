/* Local frame decoding and durable frame-note storage. */
'use strict';
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var spawn = require('child_process').spawn;
var JSZip = require('jszip');
var IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'tga', 'tif', 'tiff', 'exr', 'dpx'];
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function rational(value) {
  var text = String(value || '24');
  if (Math.abs(Number(value) - 24000 / 1001) < 0.000001) return { num: 24000, den: 1001 };
  if (Math.abs(Number(value) - 30000 / 1001) < 0.000001) return { num: 30000, den: 1001 };
  if (Math.abs(Number(value) - 60000 / 1001) < 0.000001) return { num: 60000, den: 1001 };
  if (text === '23.976') return { num: 24000, den: 1001 };
  if (text === '29.97') return { num: 30000, den: 1001 };
  if (text === '59.94') return { num: 60000, den: 1001 };
  var pair = text.split('/'); var num = Number(pair[0]), den = pair.length === 2 ? Number(pair[1]) : 1;
  if (pair.length === 1 && !Number.isInteger(num)) { den = 1000000; num = Math.round(num * den); }
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den < 1 || num / den < 1 || num / den > 120) throw new Error('帧率必须在 1–120 fps 之间');
  function gcd(a, b) { return b ? gcd(b, a % b) : a; }
  var d = gcd(num, den); return { num: num / d, den: den / d };
}
function install(options) {
  var app = options.app, ipc = options.ipcMain, dialog = options.dialog;
  var root = path.join(app.getPath('userData'), 'frame-notes');
  var cache = path.join(options.cacheDirectory ? options.cacheDirectory() : path.join(app.getPath('userData'), 'media-cache'), 'exact-frames');
  var trimTimer = null;
  function scheduleTrim(file) {
    if (trimTimer) return;
    trimTimer = setTimeout(function() { trimTimer = null; options.trimMediaCache(512 * 1024 * 1024, file); }, 15000);
    if (trimTimer.unref) trimTimer.unref();
  }
  var sources = new Map(), jobs = new Map(), writes = new Map(), memory = new Map(), memoryBytes = 0;
  var running = 0, queue = [], decoderVersion = '尚未检测';
  var devBin = path.resolve(__dirname, '..', '.tools', 'ffmpeg-n8.1-lgpl', 'ffmpeg-n8.1-latest-win64-lgpl-shared-8.1', 'bin');
  var bin = fs.existsSync(path.join(process.resourcesPath || '', 'ffmpeg', 'ffmpeg.exe')) ? path.join(process.resourcesPath, 'ffmpeg') : devBin;
  function local(p) {
    if (typeof p !== 'string' || !path.isAbsolute(p) || /^\\\\|^\/\//.test(p) || p.indexOf('\0') !== -1) throw new Error('请选择本地媒体文件');
    return path.resolve(p);
  }
  function safeId(id) { if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id || '')) throw new Error('素材 ID 无效'); return id; }
  function task(event, id) {
    var key = event.sender.id + ':' + id;
    var old = jobs.get(key); if (old) { old.cancelled = true; old.procs.map(function(p) { p.kill(); }); }
    var job = { key: key, cancelled: false, procs: [] }; jobs.set(key, job); return job;
  }
  function check(job) { if (job && job.cancelled) throw new Error('操作已取消'); }
  function drain() { while (running < 3 && queue.length) { running++; queue.shift()(); } }
  function run(exe, args, job, onLine, maxBytes) {
    return new Promise(function(resolve, reject) {
      queue.push(function() {
        var proc, parts = [], bytes = 0, errors = '', rest = '', expired = false;
        try { check(job); proc = spawn(path.join(bin, exe + '.exe'), args, { windowsHide: true }); } catch (e) { running--; drain(); reject(e); return; }
        if (job) job.procs.push(proc);
        var timer = setTimeout(function() { expired = true; proc.kill(); }, 10 * 60 * 1000);
        proc.stdout.on('data', function(data) {
          bytes += data.length;
          if (bytes > (maxBytes || 64 * 1024 * 1024)) { expired = true; proc.kill(); return; }
          if (onLine) {
            var lines = (rest + data.toString('utf8')).split(/\r?\n/); rest = lines.pop();
            for (var li = 0; li < lines.length; li++) onLine(lines[li]);
          } else parts.push(data);
        });
        proc.stderr.on('data', function(data) { errors = (errors + data.toString('utf8')).slice(-12000); });
        proc.once('error', function(e) { errors = e.message; });
        proc.once('close', function(code) {
          clearTimeout(timer); running--; drain();
          if (job) job.procs = job.procs.filter(function(p) { return p !== proc; });
          try {
            check(job);
            if (expired) throw new Error('解码超时或超过安全内存上限');
            if (code !== 0) throw new Error(errors || '解码器退出码：' + code);
            if (onLine && rest) onLine(rest);
            resolve(Buffer.concat(parts));
          } catch (e) { e.details = errors; e.exitCode = code; reject(e); }
        });
      }); drain();
    });
  }
  function parseJSON(buf) { try { return JSON.parse(buf.toString('utf8')); } catch (_) { throw new Error('媒体元数据无效'); } }
  function stat(p) { return fs.promises.stat(local(p)).then(function(s) { if (!s.isFile()) throw new Error('源文件无效：' + path.basename(p)); return { size: s.size, mtime: s.mtimeMs }; }); }
  function digestFile(p, job) {
    return new Promise(function(resolve, reject) {
      var digest = crypto.createHash('sha256'), stream = fs.createReadStream(p);
      stream.on('data', function(chunk) { if (job.cancelled) stream.destroy(new Error('操作已取消')); else digest.update(chunk); });
      stream.on('error', reject); stream.on('end', function() { resolve(digest.digest('hex')); });
    });
  }
  function framePath(frame) {
    if (frame.billfishSource) {
      var linked = options.billfishStore.resolve(frame.billfishSource, true);
      if (linked.missing) throw new Error('源媒体未找到：' + (frame.name || frame.billfishSource.materialId));
      return local(linked.file.path);
    }
    return local(frame.path);
  }
  function probe(p, job, still) {
    var args = ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json'];
    if (still) args.push('-read_intervals', '%+#1', '-show_frames');
    args.push('-i', p);
    return singlePage(p).then(function() { return run('ffprobe', args, job); }).then(function(buf) {
      var data = parseJSON(buf), stream = data.streams && data.streams[0];
      if (!stream || !stream.width || !stream.height || (still && (!data.frames || !data.frames.length))) throw new Error('源图片解码失败：' + path.basename(p));
      return stream;
    }).catch(function(e) {
      if (e.message.indexOf('取消') !== -1 || /多页|BigTIFF/.test(e.message)) throw e;
      e.details = e.details || e.message; e.message = (still ? '源图片解码失败：' : '视频探测失败：') + path.basename(p); throw e;
    });
  }
  function singlePage(p) {
    if (!/\.tiff?$/i.test(p)) return Promise.resolve();
    return fs.promises.open(p, 'r').then(function(file) {
      var head = Buffer.alloc(8);
      return file.read(head, 0, 8, 0).then(function() {
        var little = head.toString('ascii', 0, 2) === 'II';
        function u16(b, at) { return little ? b.readUInt16LE(at) : b.readUInt16BE(at); }
        function u32(b, at) { return little ? b.readUInt32LE(at) : b.readUInt32BE(at); }
        if (u16(head, 2) === 43) throw new Error('本轮暂不支持 BigTIFF 序列帧');
        if (u16(head, 2) !== 42) return;
        var offset = u32(head, 4), count = Buffer.alloc(2);
        return file.read(count, 0, 2, offset).then(function() {
          var next = Buffer.alloc(4); return file.read(next, 0, 4, offset + 2 + u16(count, 0) * 12).then(function() { if (u32(next, 0)) throw new Error('本轮暂不支持多页 TIFF，请先拆分成单页图片'); });
        });
      }).finally(function() { return file.close(); });
    });
  }
  function progress(event, job, current, total, stage) { if (!event.sender.isDestroyed()) event.sender.send('frame-media-progress', { id: job.key.split(':').slice(1).join(':'), current: current, total: total, stage: stage }); }
  function publicSource(source) {
    return { token: source.token, assetId: source.assetId, sourceRevisionId: source.revision, count: source.frames.length,
      fps: source.fps, vfr: !!source.vfr, fpsUnknown: !!source.fpsUnknown, width: source.width, height: source.height, pixFmt: source.pixFmt, bitDepth: source.bitDepth,
      alpha: source.alpha, timeBase: source.timeBase, directoryState: source.directoryState || null, frames: source.sequence ? source.frames.map(function(frame) { var copy = Object.assign({}, frame); if (frame.directPreview) copy.previewUrl = options.issueMediaUrl(frame.path, frame.sourceStamp); return copy; }) : source.frames, changed: source.changed, url: source.sequence ? null : options.issueMediaUrl(source.path), mode: source.sequence ? 'stills' : 'video' };
  }
  function prepare(event, arg, job) {
    if (arg.dataUrl && !arg.embeddedIdentity && /^data:video\/[^;]+;base64,/.test(arg.dataUrl)) {
      var embeddedMatch = /^data:(video\/[^;]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(arg.dataUrl);
      if (!embeddedMatch || embeddedMatch[2].length > 700 * 1024 * 1024) throw new Error('内嵌视频数据无效或过大');
      var embedded = Buffer.from(embeddedMatch[2], 'base64'), embeddedKey = hash(embedded);
      var extension = embeddedMatch[1] === 'video/webm' ? 'webm' : embeddedMatch[1] === 'video/quicktime' ? 'mov' : embeddedMatch[1] === 'video/x-matroska' ? 'mkv' : embeddedMatch[1] === 'video/x-msvideo' ? 'avi' : 'mp4';
      var embeddedPath = path.join(cache, 'embedded-' + embeddedKey + '.' + extension);
      var next = Object.assign({}, arg, { path: embeddedPath, dataUrl: null, embeddedIdentity: embeddedKey });
      return atomic(embeddedPath, embedded).then(function() { return prepare(event, next, job); });
    }
    var sequence = Array.isArray(arg.frames) && arg.frames.length > 0;
    if (sequence && arg.frames.length > 20000) throw new Error('单组序列最多支持 20000 帧');
    var entries = sequence ? arg.frames : [{ path: arg.path }];
    var records = [], seenNumbers = {}, dimensions = null, fps = rational(arg.fps || 24), sourcePath, pixelFormat, bitDepth, alpha = false;
    return entries.reduce(function(chain, item, index) {
      return chain.then(function() {
        check(job); item = typeof item === 'string' ? { path: item } : item;
        var p = framePath(item); sourcePath = p;
        var ext = path.extname(p).slice(1).toLowerCase();
        if (sequence && IMAGE_EXTS.indexOf(ext) === -1) throw new Error('序列格式不支持：' + path.basename(p));
        return stat(p).then(function(st) {
          if (!arg.allowChanged && item.sourceStamp && (item.sourceStamp.size !== st.size || item.sourceStamp.mtime !== st.mtime)) throw new Error('源序列已变化，请重新扫描并核对旧笔记：' + path.basename(p));
          return probe(p, job, sequence).then(function(stream) {
            if (sequence && dimensions && (dimensions.width !== stream.width || dimensions.height !== stream.height)) throw new Error('序列尺寸不一致：' + path.basename(p) + '（' + stream.width + '×' + stream.height + '），请拆分后导入');
            if (sequence && stream.nb_frames && Number(stream.nb_frames) > 1) throw new Error('暂不支持多页或动态序列帧：' + path.basename(p));
            dimensions = stream; pixelFormat = stream.pix_fmt;
            var depthMatch = /(?:p|gray|ya)(9|10|12|14|16)(?:le|be|$)/.exec(pixelFormat);
            var frameDepth = Number(stream.bits_per_raw_sample) || (/f32|128/.test(pixelFormat) ? 32 : /(?:rgb|bgr)48|(?:rgba|bgra)64/.test(pixelFormat) ? 16 : depthMatch ? Number(depthMatch[1]) : 8);
            bitDepth = Math.max(bitDepth || 0, frameDepth);
            alpha = alpha || /rgba|bgra|argb|abgr|yuva|gbrap|ya\d|pal8/.test(pixelFormat);
            job.context = { sourceFile: path.basename(p), sourceSize: [stream.width, stream.height], pixFmt: pixelFormat, bitDepth: bitDepth, alpha: alpha, preview: '逐帧 PNG RGBA 8 位，保留源文件' };
            var number = item.number;
            if (number === undefined) { var m = /^(.*?)(\d+)(\D*)\.[^.]+$/.exec(path.basename(p)); number = m ? Number(m[2]) : index; }
            if (sequence && seenNumbers[number]) throw new Error('重复源编号：' + number + '，请拆分序列或选择正确文件');
            seenNumbers[number] = true;
            return digestFile(p, job).then(function(digest) {
              if (!arg.allowChanged && item.contentHash && item.contentHash !== digest) throw new Error('源序列内容已变化，请重新扫描并核对旧笔记：' + path.basename(p));
              records.push({ id: item.id || hash(p.toLowerCase() + '\0' + number).slice(0, 32), path: p, number: number, name: path.basename(p), fieldFromRight: item.fieldFromRight || 0, sourceStamp: st, contentHash: digest, width: stream.width, height: stream.height, pixFmt: stream.pix_fmt, directPreview: frameDepth <= 8 && ['png', 'jpg', 'jpeg', 'webp', 'bmp'].indexOf(ext) !== -1, billfishSource: item.billfishSource || null });
              progress(event, job, index + 1, entries.length, sequence ? '正在检查源帧' : '帧索引中');
            });
          });
        }).catch(function(e) { e.sourceFile = path.basename(p); throw e; });
      });
    }, Promise.resolve()).then(function() {
      var identity = arg.embeddedIdentity || (sequence ? records.map(function(f) { return f.path.toLowerCase(); }) : sourcePath.toLowerCase());
      var assetId = arg.assetId ? safeId(arg.assetId) : hash(JSON.stringify(identity));
      var revision = hash(JSON.stringify(records.map(function(f) { return [sequence ? f.number : 0, f.contentHash, f.width, f.height]; })));
      var source = { sequence: sequence, assetId: assetId, revision: revision, changed: !!arg.sourceRevisionId && revision !== arg.sourceRevisionId,
        token: crypto.randomBytes(20).toString('hex'), width: dimensions.width, height: dimensions.height, pixFmt: pixelFormat,
        bitDepth: bitDepth, alpha: alpha, fps: fps, frames: records, path: sourcePath, sourceStamp: records[0].sourceStamp, timeBase: dimensions.time_base || '1/1' };
      function done() {
        check(job); sources.set(source.token, source);
        if (sources.size > 200) sources.delete(sources.keys().next().value);
        return publicSource(source);
      }
      if (sequence) {
        if (records.length < 2 || records[0].billfishSource) return done();
        var first = records[0];
        return fs.promises.readdir(path.dirname(first.path), { withFileTypes: true }).then(function(entries) {
          var files = entries.filter(function(entry) { return entry.isFile(); }).map(function(entry) { return { path: path.join(path.dirname(first.path), entry.name) }; });
          var group = require('./sequence-detect').detect(files, first.fieldFromRight).find(function(g) { return g.files.some(function(f) { return f.path.toLowerCase() === first.path.toLowerCase(); }); });
          source.directoryState = hash(JSON.stringify((group ? group.files.map(function(f) { return path.basename(f.path).toLowerCase(); }) : records.map(function(f) { return f.name.toLowerCase(); })).sort()));
          if (arg.directoryState && arg.directoryState !== source.directoryState && !arg.allowChanged) throw new Error('源序列目录已变化，请点击重新扫描，确认新清单并核对旧笔记');
          return done();
        });
      }
      source.frames = [];
      return run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=media_type,pts,pts_time:frame_side_data=', '-of', 'compact=p=0:nk=0', '-i', sourcePath], job, function(line) {
        if (!line.trim() || line.indexOf('=') === -1) return;
        var fields = {};
        line.trim().split('|').map(function(field) { var pos = field.indexOf('='); fields[field.slice(0, pos)] = field.slice(pos + 1); });
        if (fields.media_type !== 'video') return;
        var pts = Number(fields.pts), seconds = Number(fields.pts_time);
        source.frames.push({ pts: pts, seconds: seconds });
        if (source.frames.length % 2000 === 0) progress(event, job, source.frames.length, 0, '帧索引中');
      }, 96 * 1024 * 1024).then(function() {
        if (!source.frames.length) throw new Error('未找到可解码的视频帧');
        if (Number(dimensions.nb_frames) > 0 && Number(dimensions.nb_frames) !== source.frames.length) throw new Error('视频索引数量与容器记录不一致，可能存在损坏帧，请检查源视频');
        var timestampBase = source.timeBase.split('/').map(Number);
        if (!Number.isSafeInteger(timestampBase[0]) || !Number.isSafeInteger(timestampBase[1]) || timestampBase[0] < 1 || timestampBase[1] < 1) throw new Error('视频缺少有效时间基，无法建立准确帧索引');
        for (var fi = 0; fi < source.frames.length; fi++) {
          var frame = source.frames[fi];
          if (!Number.isSafeInteger(frame.pts) || (fi && frame.pts <= source.frames[fi - 1].pts)) throw new Error('视频时间戳缺失、重复或不递增，无法建立准确帧索引');
          frame.seconds = frame.pts * (timestampBase[0] / timestampBase[1]);
        }
        var interval = source.frames.length > 1 ? source.frames[1].pts - source.frames[0].pts : 0;
        source.vfr = source.frames.some(function(f, i) { return i > 1 && Math.abs(f.pts - source.frames[i - 1].pts - interval) > 1; });
        var rate = String(dimensions.avg_frame_rate || '0/0').split('/');
        var num = Number(rate[0]), den = Number(rate[1]);
        if (Number.isSafeInteger(num) && Number.isSafeInteger(den) && num > 0 && den > 0) source.fps = { num: num, den: den };
        else { source.fps = { num: 1, den: 1 }; source.fpsUnknown = true; }
        if (source.vfr && source.frames.length > 1) {
          var base = source.timeBase.split('/').map(Number);
          var averageNum = (source.frames.length - 1) * base[1];
          var averageDen = (source.frames[source.frames.length - 1].pts - source.frames[0].pts) * base[0];
          if (Number.isSafeInteger(averageNum) && Number.isSafeInteger(averageDen) && averageNum > 0 && averageDen > 0) { source.fps = { num: averageNum, den: averageDen }; source.fpsUnknown = false; }
          else source.fpsUnknown = true;
        }
        return done();
      });
    });
  }
  function remember(key, data) {
    if (memory.has(key)) memoryBytes -= memory.get(key).length;
    memory.delete(key); memory.set(key, data); memoryBytes += data.length;
    while (memoryBytes > 64 * 1024 * 1024 && memory.size) { var first = memory.keys().next().value; memoryBytes -= memory.get(first).length; memory.delete(first); }
  }
  function decode(arg, job) {
    var source = sources.get(arg.token), index = Number(arg.index);
    if (!source || !Number.isInteger(index) || index < 0 || index >= source.frames.length) throw new Error('帧号超出范围或媒体尚未就绪');
    var entry = source.sequence ? source.frames[index] : { path: source.path, sourceStamp: source.sourceStamp };
    var key = hash(source.revision + ':' + index);
    return stat(entry.path).then(function(st) {
      check(job); if (st.size !== entry.sourceStamp.size || st.mtime !== entry.sourceStamp.mtime) throw new Error('源媒体已变化，请重新导入并核对帧笔记');
      if (memory.has(key)) { var hit = memory.get(key); remember(key, hit); return hit; }
      var file = path.join(cache, key + '.png');
      return fs.promises.readFile(file).catch(function() {
        var args = ['-v', 'error', '-xerror', '-i', entry.path, '-map', '0:v:0'];
        if (!source.sequence) args.push('-vf', 'select=eq(n\\,' + index + '),format=rgba');
        args.push('-frames:v', '1', '-fps_mode', 'passthrough', '-pix_fmt', 'rgba', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1');
        return run('ffmpeg', args, job).then(function(buf) {
          if (buf.length < 8 || buf.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('目标帧解码失败');
          return atomic(file, buf).then(function() {
            scheduleTrim(file); return buf;
          });
        });
      }).then(function(buf) { remember(key, buf); return buf; });
    }).then(function(buf) { check(job); return { dataUrl: 'data:image/png;base64,' + buf.toString('base64'), index: index, sourceRevisionId: source.revision }; });
  }
  function atomic(file, data) {
    return fs.promises.mkdir(path.dirname(file), { recursive: true }).then(function() {
      var tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
      return fs.promises.writeFile(tmp, data).then(function() { return fs.promises.rename(tmp, file); }).catch(function(e) { fs.promises.unlink(tmp).catch(function() {}); throw e; });
    });
  }
  function assetFile(id) { return path.join(root, 'assets', safeId(id) + '.json'); }
  function readNotes(id) {
    var file = assetFile(id), pending = writes.get(file) || Promise.resolve();
    return pending.then(function() { return fs.promises.readFile(file, 'utf8'); }).then(function(text) { return parseJSON(Buffer.from(text)); }).catch(function(e) { if (e.code === 'ENOENT') return null; throw e; });
  }
  function validateNotes(data) {
    safeId(data.assetId);
    if (!Array.isArray(data.notes) || data.notes.length > 20000) throw new Error('笔记数据无效');
    if (!data.attachments || typeof data.attachments !== 'object') throw new Error('附件数据无效');
    for (var ni = 0; ni < data.notes.length; ni++) {
      var note = data.notes[ni]; safeId(note.id);
      if (!note.anchor || !Number.isInteger(note.anchor.frameIndex) || note.anchor.frameIndex < 0 || typeof note.text !== 'string') throw new Error('笔记帧锚点无效');
    }
    return data;
  }
  function persistNotes(data) {
    validateNotes(data); var copy = JSON.parse(JSON.stringify(data));
    var file = assetFile(data.assetId), pending = writes.get(file) || Promise.resolve();
    var next = pending.catch(function() {}).then(function() {
      var ids = Object.keys(copy.attachments);
      return ids.reduce(function(chain, id) {
        return chain.then(function() {
          safeId(id); var attachment = copy.attachments[id];
          var m = /^data:image\/(png|jpeg|webp|gif|bmp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(attachment.dataUrl || '');
          if (!m) throw new Error('附件不是已嵌入的本地图片');
          var bytes = Buffer.from(m[2], 'base64'); if (bytes.length > 32 * 1024 * 1024) throw new Error('单张附件不能超过 32 MB');
          var rel = 'attachments/' + hash(bytes) + '.' + m[1]; attachment.relativePath = rel;
          var attachmentFile = path.join(root, rel);
          return fs.promises.access(attachmentFile).catch(function() { return atomic(attachmentFile, bytes); });
        });
      }, Promise.resolve()).then(function() { return atomic(file, JSON.stringify(copy)); }).then(function() { return { savedAt: new Date().toISOString() }; });
    });
    writes.set(file, next); next.finally(function() { if (writes.get(file) === next) writes.delete(file); }).catch(function() {}); return next;
  }
  function exportNotes(event, arg) {
    var data = validateNotes(arg.data), selected = arg.selectedIds;
    return dialog.showSaveDialog({ title: '导出帧笔记', defaultPath: (arg.name || '帧笔记').replace(/[<>:"/\\|?*]/g, '_') + '-帧笔记.zip', filters: [{ name: '笔记包', extensions: ['zip'] }] }).then(function(result) {
      if (result.canceled || !result.filePath) return { cancelled: true };
      var zip = new JSZip(), copy = JSON.parse(JSON.stringify(data));
      if (selected && selected.length) copy.notes = copy.notes.filter(function(n) { return selected.indexOf(n.id) !== -1; });
      var markdown = ['# ' + (arg.name || '帧笔记'), '']; var used = {};
      copy.notes.sort(function(a, b) { return a.anchor.frameIndex - b.anchor.frameIndex || a.createdAt.localeCompare(b.createdAt); });
      copy.notes.map(function(note) {
        markdown.push('## 第 ' + (note.anchor.frameIndex + 1) + ' 帧' + (note.anchor.sourceFrameNumber !== null && note.anchor.sourceFrameNumber !== undefined ? ' · 源帧 ' + note.anchor.sourceFrameNumber : ''), '', note.text, '');
        (note.attachmentIds || []).concat(note.thumbnailId || []).map(function(id) { used[id] = true; });
        (note.attachmentIds || []).map(function(id) { var a = copy.attachments[id]; if (a) markdown.push('![' + (a.name || '图片').replace(/[\[\]]/g, '') + '](attachments/' + id + '.png)', ''); });
      });
      Object.keys(copy.attachments).map(function(id) {
        if (!used[id]) { delete copy.attachments[id]; return; }
        var a = copy.attachments[id], m = /^data:image\/[^;]+;base64,(.+)$/.exec(a.dataUrl);
        if (!m) throw new Error('附件数据无效');
        var ext = /image\/jpeg/.test(a.dataUrl) ? 'jpg' : /image\/webp/.test(a.dataUrl) ? 'webp' : /image\/gif/.test(a.dataUrl) ? 'gif' : /image\/bmp/.test(a.dataUrl) ? 'bmp' : 'png';
        a.relativePath = 'attachments/' + id + '.' + ext;
        markdown = markdown.map(function(line) { return line.replace('attachments/' + id + '.png', a.relativePath); });
        zip.file(a.relativePath, Buffer.from(m[1], 'base64')); delete a.dataUrl;
      });
      zip.file('notes.json', JSON.stringify(copy, null, 2)); zip.file('notes.md', markdown.join('\n'));
      return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }).then(function(buf) { return atomic(result.filePath, buf); }).then(function() { return { path: result.filePath }; });
    });
  }
  function importNotes() {
    return dialog.showOpenDialog({ title: '导入帧笔记包', properties: ['openFile'], filters: [{ name: '笔记包', extensions: ['zip'] }] }).then(function(result) {
      if (result.canceled || !result.filePaths.length) return { cancelled: true };
      return fs.promises.stat(result.filePaths[0]).then(function(st) { if (st.size > 256 * 1024 * 1024) throw new Error('笔记包超过 256 MB'); return fs.promises.readFile(result.filePaths[0]); }).then(function(buf) { return JSZip.loadAsync(buf); }).then(function(zip) {
        var names = Object.keys(zip.files), total = 0;
        if (names.length > 20000) throw new Error('笔记包条目过多');
        names.map(function(name) { var entry = zip.files[name]; if (/^[\\/]|^[A-Za-z]:|(^|[\\/])\.\.([\\/]|$)/.test(name)) throw new Error('笔记包包含不安全路径'); total += entry._data && entry._data.uncompressedSize || 0; });
        if (total > 512 * 1024 * 1024 || !zip.file('notes.json')) throw new Error('笔记包无效或解压数据过大');
        return zip.file('notes.json').async('nodebuffer').then(function(buf) {
          var data = validateNotes(parseJSON(buf));
          return Object.keys(data.attachments).reduce(function(chain, id) {
            return chain.then(function() {
              safeId(id); var attachment = data.attachments[id], rel = attachment.relativePath;
              if (!/^attachments\/[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp|gif|bmp)$/.test(rel || '') || !zip.file(rel)) throw new Error('附件引用无效');
              return zip.file(rel).async('nodebuffer').then(function(bytes) { if (bytes.length > 32 * 1024 * 1024) throw new Error('附件过大'); var ext = path.extname(rel).slice(1); attachment.dataUrl = 'data:image/' + (ext === 'jpg' ? 'jpeg' : ext) + ';base64,' + bytes.toString('base64'); });
            });
          }, Promise.resolve()).then(function() { return { data: data }; });
        });
      });
    });
  }
  function action(event, name, arg) {
    arg = arg || {};
    if (name === 'cancel') { var active = jobs.get(event.sender.id + ':' + arg.id); if (active) { active.cancelled = true; active.procs.map(function(p) { p.kill(); }); } return Promise.resolve({ cancelled: true }); }
    if (name === 'release') { sources.delete(arg.token); return Promise.resolve({}); }
    if (name === 'notes-load') return readNotes(arg.assetId).then(function(data) { return { data: data }; });
    if (name === 'notes-save') return persistNotes(arg.data);
    if (name === 'notes-export') return exportNotes(event, arg);
    if (name === 'notes-import') return importNotes();
    if (name === 'choose-images') return dialog.showOpenDialog({ title: '添加笔记图片', properties: ['openFile', 'multiSelections'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }] }).then(function(r) { return { paths: r.canceled ? [] : r.filePaths }; });
    if (name === 'choose-source') return dialog.showOpenDialog({ title: '重新关联源媒体或序列首帧', properties: ['openFile'] }).then(function(r) { return { path: r.canceled ? null : r.filePaths[0] }; });
    if (name === 'scan-siblings') {
      var p = local(arg.path), dir = path.dirname(p);
      return fs.promises.readdir(dir, { withFileTypes: true }).then(function(entries) { return { files: entries.filter(function(e) { return e.isFile() && IMAGE_EXTS.indexOf(path.extname(e.name).slice(1).toLowerCase()) !== -1; }).map(function(e) { return { path: path.join(dir, e.name), name: e.name }; }) }; });
    }
    if (name === 'attachment-read') {
      var p = local(arg.path);
      return stat(p).then(function(st) { if (st.size > 32 * 1024 * 1024) throw new Error('单张图片不能超过 32 MB'); return fs.promises.readFile(p); }).then(function(buf) {
        var ext = path.extname(p).slice(1).toLowerCase(); if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].indexOf(ext) === -1) throw new Error('附件仅支持 PNG/JPG/WebP/BMP/GIF 静态预览');
        return { dataUrl: 'data:image/' + (ext === 'jpg' ? 'jpeg' : ext) + ';base64,' + buf.toString('base64'), name: path.basename(p) };
      });
    }
    var job = task(event, arg.id || crypto.randomBytes(8).toString('hex'));
    var work;
    try {
      if (name === 'prepare') work = prepare(event, arg, job);
      else if (name === 'decode') work = decode(arg, job);
      else throw new Error('未知帧媒体操作');
    } catch (e) { work = Promise.reject(e); }
    return work.catch(function(e) { e.context = job.context || {}; throw e; }).finally(function() { if (jobs.get(job.key) === job) jobs.delete(job.key); });
  }
  ipc.handle('frame-media', function(event, name, arg) {
    return Promise.resolve().then(function() { return action(event, name, arg); }).then(function(data) { return Object.assign({ ok: true }, data); }).catch(function(e) {
      return { ok: false, error: e.message, stage: name === 'prepare' ? '源帧检查 / 帧索引' : name === 'decode' ? '目标帧解码' : '笔记存储', sourceFile: e.sourceFile || null, media: e.context || null, decoderVersion: decoderVersion, details: e.details || '', exitCode: e.exitCode === undefined ? null : e.exitCode };
    });
  });
  run('ffmpeg', ['-version'], null).then(function(buf) { decoderVersion = buf.toString('utf8').split(/\r?\n/)[0]; }).catch(function(e) { decoderVersion = '无法启动随包 FFmpeg：' + e.message; });
  app.on('before-quit', function() { Array.from(jobs.values()).map(function(job) { job.cancelled = true; job.procs.map(function(p) { p.kill(); }); }); });
  return { rational: rational };
}
module.exports = { install: install, rational: rational };
