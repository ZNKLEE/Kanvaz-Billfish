/* One frame state for still sequences, indexed videos and frame notes. */
var KanvazFrames = (function() {
  'use strict';
  var players = {}, assets = {}, saves = {}, saveStates = {}, operations = [], panel = null, editor = null, activePlayer = null, selectedNote = null;
  function track(work) { operations.push(work); work.finally(function() { operations = operations.filter(function(p) { return p !== work; }); }).catch(function() {}); return work; }
  function call(name, arg) { return KanvazBridge.frameMedia(name, arg).then(function(r) { if (!r.ok) { var e = new Error(r.error); e.diagnostic = r; throw e; } return r; }); }
  function uid() { return 'n_' + crypto.randomUUID().replace(/-/g, ''); }
  function element(tag, cls, text) { var el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; }
  function button(label, fn, parent) { var b = element('button', 'fp-button', label); b.type = 'button'; b.addEventListener('click', function(e) { e.stopPropagation(); Promise.resolve().then(fn).catch(fail); }); if (parent) parent.appendChild(b); return b; }
  function fail(e) { KanvazUI.toast(e.message || String(e), 'error'); }
  function dirty() { if (typeof KanvazApp !== 'undefined') KanvazApp.markDirty(); }
  function dataFor(card) {
    var id = card.frameAssetId;
    if (!id) return null;
    if (!assets[id]) assets[id] = { schemaVersion: 1, assetId: id, sourceRevisionId: card.sourceRevisionId, notes: [], attachments: {}, deletedNoteIds: {} };
    return assets[id];
  }
  function savedStatus(text, assetId) { if (assetId) saveStates[assetId] = text; if (assetId && activePlayer && activePlayer.card.frameAssetId !== assetId) return; var el = panel && panel.querySelector('.fp-save-status'); if (el) el.textContent = text; }
  function save(data) {
    if (pendingEdits && pendingEdits[data.assetId]) { clearTimeout(pendingEdits[data.assetId].timer); delete pendingEdits[data.assetId]; }
    dirty(); savedStatus('保存中', data.assetId);
    var generation = (data._generation || 0) + 1; data._generation = generation;
    var payload = JSON.parse(JSON.stringify(data)); delete payload._generation;
    var pending = call('notes-save', { data: payload }).then(function() {
      if (data._generation === generation) savedStatus('已保存', data.assetId);
    }).catch(function(e) { savedStatus('保存失败，请重试', data.assetId); throw e; });
    saves[data.assetId] = pending; pending.catch(function() {}); return pending;
  }
  var pendingEdits = {};
  function scheduleSave(data) {
    dirty(); savedStatus('待保存', data.assetId);
    if (pendingEdits[data.assetId]) clearTimeout(pendingEdits[data.assetId].timer);
    pendingEdits[data.assetId] = { data: data, timer: setTimeout(function() { delete pendingEdits[data.assetId]; save(data).catch(function() {}); }, 350) };
  }
  function flush() {
    Object.keys(pendingEdits).map(function(id) { var edit = pendingEdits[id]; clearTimeout(edit.timer); delete pendingEdits[id]; save(edit.data); });
    return Promise.all(operations.slice().concat(Object.keys(saves).map(function(id) { return saves[id]; })));
  }
  function snapshot() {
    var copy = JSON.parse(JSON.stringify(assets)); Object.keys(copy).map(function(id) { delete copy[id]._generation; }); return copy;
  }
  function restore(data) { flush().catch(fail); if (panel) panel.remove(); var locations = document.getElementById('frame-import-locations'); if (locations) locations.remove(); panel = null; activePlayer = null; selectedNote = null; assets = data || {}; }
  function mergeNotes(local, incoming) {
    if (!local) return incoming;
    var notes = {};
    local.notes.concat(incoming.notes || []).map(function(n) { if (!notes[n.id] || n.updatedAt > notes[n.id].updatedAt) notes[n.id] = n; });
    local.deletedNoteIds = Object.assign({}, incoming.deletedNoteIds || {}, local.deletedNoteIds || {});
    local.notes = Object.keys(notes).filter(function(id) { return !local.deletedNoteIds[id]; }).map(function(id) { return notes[id]; });
    Object.keys(incoming.attachments || {}).map(function(id) { if (!local.attachments[id]) local.attachments[id] = incoming.attachments[id]; }); return local;
  }
  function viewport() {
    var canvas = document.getElementById('canvas-container'), r = canvas.getBoundingClientRect();
    var left = Math.max(0, r.left), top = Math.max(0, r.top), right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
    ['#side-panel', '#sidepanel', '#properties-panel', '#frame-notes-panel'].map(function(selector) {
      var side = document.querySelector(selector); if (!side) return;
      var s = side.getBoundingClientRect();
      if (s.width > 30 && s.height > (bottom - top) / 2 && getComputedStyle(side).display !== 'none' && s.left > left + (right - left) / 2 && s.left < right) right = s.left;
    });
    return { left: left, top: top, width: Math.max(160, right - left), height: Math.max(120, bottom - top) };
  }
  function importTarget(count) {
    var r = viewport(), v = KanvazCanvas.getViewport(), center = KanvazCanvas.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
    return { center: center, width: r.width * 0.78 / v.scale, height: r.height * 0.78 / v.scale, scale: v.scale, count: count || 1 };
  }
  function placement(target, index, naturalW, naturalH) {
    target = target || importTarget(1); index = index || 0;
    var cols = Math.ceil(Math.sqrt(target.count)), rows = Math.ceil(target.count / cols), gap = 20 / target.scale;
    var cellW = target.width / cols, cellH = target.height / rows;
    var controlsH = 136 / target.scale + 52;
    var factor = Math.min((cellW - gap) / naturalW, (cellH - gap - controlsH) / naturalH);
    factor = Math.max(0.01, factor);
    var w = Math.max(180, naturalW * factor), h = Math.max(220, naturalH * factor + controlsH);
    return { x: target.center.x - target.width / 2 + cellW * (index % cols + 0.5) - w / 2,
      y: target.center.y - target.height / 2 + cellH * (Math.floor(index / cols) + 0.5) - h / 2, w: w, h: h };
  }
  function positionNew(card, width, height) {
    if (!card._frameImportTarget) return;
    var p = placement(card._frameImportTarget, card._frameImportIndex, width, height);
    card.naturalW = width; card.naturalH = height;
    KanvazCards.setTransform(card.id, p); delete card._frameImportTarget; delete card._frameImportIndex; dirty();
    var locations = document.getElementById('frame-import-locations');
    if (!locations) { locations = element('div', 'fp-import-locations'); locations.id = 'frame-import-locations'; document.body.appendChild(locations); }
    var notice = element('div', 'fp-row'); locations.appendChild(notice);
    button('已导入：' + card.name + ' · 定位素材', function() { focus(card); notice.remove(); }, notice);
    button('×', function() { notice.remove(); }, notice);
  }
  function focus(card) {
    KanvazCards.selectCard(card.id); var r = viewport(), canvas = document.getElementById('canvas-container').getBoundingClientRect();
    var scale = Math.min((r.width - 40) / card.w, (r.height - 40) / card.h, 4); scale = Math.max(0.05, scale);
    KanvazCanvas.setViewport(r.left - canvas.left + r.width / 2 - (card.x + card.w / 2) * scale, r.top - canvas.top + r.height / 2 - (card.y + card.h / 2) * scale, scale);
  }
  function sourceLabel(p, index) {
    var f = p.info && p.info.frames[index];
    return p.sequence && f ? ' · 源帧 ' + f.number + ' · ' + f.name : '';
  }
  function stamp(p, index) {
    if (p.sequence) return index * p.info.fps.den / p.info.fps.num;
    return p.info.frames[index].seconds - p.info.frames[0].seconds;
  }
  function nativeStart(p) {
    return p.card.mediaSource && p.card.mediaSource.proxy ? Number(p.card.mediaSource.proxyStart || 0) : p.info.frames[0].seconds;
  }
  function nativeTime(p, index) {
    var gap = index + 1 < p.info.count ? stamp(p, index + 1) - stamp(p, index) : index > 0 ? stamp(p, index) - stamp(p, index - 1) : 1;
    return stamp(p, index) + nativeStart(p) + Math.min(0.0001, gap / 8);
  }
  function frameAtTime(p, seconds) {
    var lo = 0, hi = p.info.count - 1;
    while (lo < hi) { var mid = Math.ceil((lo + hi) / 2); if (stamp(p, mid) <= seconds + 0.000001) lo = mid; else hi = mid - 1; }
    if (lo + 1 < p.info.count && Math.abs(stamp(p, lo + 1) - seconds) < Math.abs(stamp(p, lo) - seconds)) lo++;
    return lo;
  }
  function update(p) {
    if (!p.info) return;
    var count = p.info.count, index = p.index, fps = p.info.fps.num / p.info.fps.den;
    p.label.textContent = '第 ' + (index + 1) + ' / ' + count + ' 帧 | ' + (p.info.fpsUnknown ? '帧率未知' : (p.info.vfr ? '平均 ' : '') + Number(fps.toFixed(6)) + ' fps' + (p.info.vfr ? '（VFR）' : ''));
    p.source.textContent = sourceLabel(p, index).replace(/^ · /, '') || stamp(p, index).toFixed(3) + ' 秒';
    p.input.max = String(count); p.input.value = String(index + 1); p.input.title = '播放帧号：1–' + count;
    p.slider.max = String(Math.max(0, count - 1)); p.slider.value = String(index);
    p.play.textContent = p.playing || p.wantPlay || (p.video && !p.video.paused) ? '暂停' : '播放';
    p.card.frameIndex = index;
  }
  function paint(p, img, request, index) {
    if (request !== p.request || !p.el.isConnected) return false;
    if (p.canvas.width !== img.naturalWidth || p.canvas.height !== img.naturalHeight) { p.canvas.width = img.naturalWidth; p.canvas.height = img.naturalHeight; }
    var ctx = p.canvas.getContext('2d'); ctx.clearRect(0, 0, p.canvas.width, p.canvas.height); ctx.drawImage(img, 0, 0);
    p.canvas.hidden = false; p.presentedDataUrl = null; p.index = index; update(p); p.status.textContent = ''; return true;
  }
  function captureFrame(p) { return p.presentedDataUrl || p.canvas.toDataURL('image/png'); }
  function draw(p, dataUrl, request, index) {
    return new Promise(function(resolve, reject) {
      var img = new Image();
      img.onload = function() {
        if (request !== p.request || !p.el.isConnected) { resolve(false); return; }
        var ok = paint(p, img, request, index); if (ok) p.presentedDataUrl = dataUrl; resolve(ok);
      }; img.onerror = function() { reject(new Error('目标帧图片无法显示')); }; img.src = dataUrl;
    });
  }
  /* Keep a small decoded look-ahead window; never retain the whole sequence. */
  function sequenceImage(p, index) {
    if (!p.images) p.images = new Map();
    if (p.images.has(index)) return p.images.get(index);
    var frame = p.info.frames[index];
    var image = new Promise(function(resolve, reject) {
      function load(url) { var img = new Image(); img.decoding = 'async'; img.crossOrigin = 'anonymous'; img.onload = function() { resolve(img); }; img.onerror = function() { reject(new Error('序列预览无法解码，请重新扫描源媒体')); }; img.src = url; }
      if (frame.previewUrl) load(frame.previewUrl);
      else call('decode', { id: 'prefetch-' + p.card.id + '-' + index, token: p.info.token, index: index }).then(function(r) { load(r.dataUrl); }, reject);
    });
    p.images.set(index, image); image.catch(function() { if (p.images && p.images.get(index) === image) p.images.delete(index); }); return image;
  }
  function prefetch(p, index) {
    if (!p.sequence || !p.info || !p.el.isConnected) return;
    var count = Math.max(1, Math.min(10, Math.floor(64 * 1024 * 1024 / (p.info.width * p.info.height * 4))));
    var wanted = {};
    for (var i = 0; i < count; i++) { var at = index + i; if (p.card.sequenceLoop) at %= p.info.count; if (at >= p.info.count) break; wanted[at] = true; }
    p.images = p.images || new Map();
    Array.from(p.images.keys()).map(function(key) { if (!wanted[key]) p.images.delete(key); });
    /* Two in flight at most, including formats decoded by the fallback service. */
    p.prefetching = p.prefetching || 0;
    Object.keys(wanted).some(function(key) {
      var at = Number(key); if (p.images.has(at)) return false;
      if (p.prefetching >= 2) return true;
      p.prefetching++;
      sequenceImage(p, at).catch(function() {}).finally(function() { p.prefetching--; }); return false;
    });
  }
  function seek(p, index, keepPlaying) {
    if (!p.info) return Promise.reject(new Error('帧索引尚未完成'));
    index = Number(index); if (!Number.isInteger(index) || index < 0 || index >= p.info.count) return Promise.reject(new Error('请输入 1–' + p.info.count + ' 的播放帧号'));
    if (!keepPlaying) pause(p);
    var request = ++p.request; p.target = index; p.status.textContent = '正在定位帧';
    if (p.sequence) {
      var sequencePending = sequenceImage(p, index).then(function(img) { var ok = paint(p, img, request, index); if (ok) prefetch(p, index); return ok; }).catch(function(e) { if (request !== p.request) return false; p.status.textContent = e.message; throw e; });
      p.pending = sequencePending; sequencePending.catch(function() {}); return sequencePending;
    }
    var pending = call('decode', { id: 'decode-' + p.card.id, token: p.info.token, index: index }).then(function(result) {
      if (request !== p.request) return false;
      if (p.video) { p.video._frameSeek = true; p.video.currentTime = nativeTime(p, index); }
      return draw(p, result.dataUrl, request, index);
    }).catch(function(e) { if (request !== p.request) return false; p.status.textContent = e.message; p.error = e; throw e; });
    p.pending = pending; pending.catch(function() {}); return pending;
  }
  function pause(p) { p.playing = false; p.wantPlay = false; clearTimeout(p.timer); ++p.request; p.target = p.index; call('cancel', { id: 'decode-' + p.card.id }); if (p.video) { p.internalPause = true; p.video.pause(); } if (p.info) update(p); }
  function play(p) {
    if (!p.info) return;
    if (p.playing || p.wantPlay || (p.video && !p.video.paused)) { pause(p); if (p.video) seek(p, p.index).catch(fail); return; }
    if (p.video) {
      if (p.video.readyState < 2 || p.video.error) { p.wantPlay = true; p.status.textContent = '正在准备播放'; update(p); return; }
      p.video.currentTime = nativeTime(p, p.target === undefined ? p.index : p.target);
      p.video.play().catch(function(e) { p.canvas.hidden = false; fail(e); }); return;
    }
    p.playing = true; prefetch(p, p.index); update(p);
    var startTime = performance.now(), firstIndex = p.index, duration = 1000 * p.info.fps.den / p.info.fps.num / (p.card.playbackRate || 1);
    function tick() {
      if (!p.playing || !p.el.isConnected) return;
      var elapsed = Math.max(1, Math.floor((performance.now() - startTime) / duration));
      var absolute = firstIndex + elapsed, ended = !p.card.sequenceLoop && absolute >= p.info.count;
      var next = ended ? p.info.count - 1 : absolute % p.info.count;
      seek(p, next, true).then(function() {
        if (ended) { pause(p); return; }
        if (p.playing) p.timer = setTimeout(tick, Math.max(1, startTime + (Math.floor((performance.now() - startTime) / duration) + 1) * duration - performance.now()));
      }).catch(function(e) { pause(p); fail(e); });
    }
    p.timer = setTimeout(tick, duration);
  }
  function markers(p) {
    p.markers.replaceChildren(); var data = dataFor(p.card); if (!data || !p.info) return;
    var grouped = {};
    data.notes.map(function(n) { var i = n.anchor.frameIndex; if (!grouped[i]) grouped[i] = []; grouped[i].push(n); });
    Object.keys(grouped).map(function(i) {
      var notes = grouped[i];
      var b = button(String(notes.length), function() { return seek(p, Number(i)).then(function(ok) { if (ok) openNotes(p, notes[0].id); }); }, p.markers);
      b.style.left = Math.min(98, Number(i) / Math.max(1, p.info.count - 1) * 98) + '%';
      b.title = '第 ' + (Number(i) + 1) + ' 帧：' + notes.map(function(n) { return n.text.slice(0, 80); }).join(' / ');
    });
  }
  function refreshMarkers(id) { Object.keys(players).map(function(key) { if (players[key].card.frameAssetId === id) markers(players[key]); }); }
  function controls(p) {
    var box = element('div', 'frame-controls'); p.el.appendChild(box);
    box.setAttribute('data-i18n-ignore', '');
    box.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    box.addEventListener('keydown', function(e) { if (e.target.matches('input,textarea,select')) e.stopPropagation(); });
    box.addEventListener('dblclick', function(e) { e.stopPropagation(); });
    var row = element('div', 'fp-row'); box.appendChild(row);
    button('首帧', function() { return seek(p, 0); }, row);
    button('◀', function() { return seek(p, Math.max(0, (p.target === undefined ? p.index : p.target) - 1)); }, row).title = '上一帧';
    p.play = button('播放', function() { play(p); }, row);
    button('▶', function() { return seek(p, Math.min(p.info.count - 1, (p.target === undefined ? p.index : p.target) + 1)); }, row).title = '下一帧';
    button('末帧', function() { return seek(p, p.info.count - 1); }, row);
    p.input = element('input', 'fp-frame-input'); p.input.type = 'number'; p.input.min = '1'; p.input.value = '1'; p.input.setAttribute('aria-label', '播放帧号'); row.appendChild(p.input);
    p.input.addEventListener('keydown', function(e) { e.stopPropagation(); if (e.key === 'Enter') seek(p, Number(p.input.value) - 1).catch(fail); });
    button('帧笔记', function() { openNotes(p); }, row);
    button('＋笔记', function() { return addNote(p); }, row);
    var loop = button('循环', function() { p.card.sequenceLoop = !p.card.sequenceLoop; if (p.video) p.video.loop = p.card.sequenceLoop; loop.classList.toggle('active', p.card.sequenceLoop); dirty(); }, row);
    if (p.card.sequenceLoop === undefined || p.card.sequenceLoop === null) p.card.sequenceLoop = true;
    loop.classList.toggle('active', p.card.sequenceLoop);
    var speed = element('select'); speed.title = '播放速度';
    [0.25, 0.5, 1, 2, 4].map(function(value) { var o = element('option', '', value + '×'); o.value = String(value); speed.appendChild(o); });
    speed.value = String(p.card.playbackRate || 1); row.appendChild(speed);
    speed.addEventListener('change', function() { var wasPlaying = p.playing; if (wasPlaying) pause(p); p.card.playbackRate = Number(speed.value); if (p.video) p.video.playbackRate = p.card.playbackRate; if (wasPlaying) play(p); dirty(); });
    if (p.video) {
      var mute = button(p.video.muted ? '静音' : '有声', function() { p.video.muted = !p.video.muted; p.card.muted = p.video.muted; mute.textContent = p.video.muted ? '静音' : '有声'; dirty(); }, row);
      var volume = element('input', 'fp-volume'); volume.type = 'range'; volume.min = '0'; volume.max = '1'; volume.step = '0.01'; volume.value = String(p.video.volume); volume.title = '音量'; row.appendChild(volume);
      volume.addEventListener('input', function() { p.video.volume = Number(volume.value); p.card.volume = p.video.volume; dirty(); });
    }
    button('全屏', function() { p.stage.tabIndex = 0; return p.stage.requestFullscreen().then(function() { p.stage.focus(); }); }, row);
    if (p.sequence) {
      button((p.card.frameRate || 24) + ' fps', function() {
        KanvazUI.showPrompt('设置序列帧率', '1–120 fps；支持 24000/1001、23.976', String(p.card.frameRate || 24), function(value) {
          var rate = parseRate(value); if (!rate) { fail(new Error('帧率无效')); return; }
          pause(p); p.card.frameRate = rate.num / rate.den; p.card.frameRateRational = rate; if (p.info) p.info.fps = rate;
          try { localStorage.setItem('kanvaz-sequence-fps', value); } catch (_) {}
          dirty(); update(p); p.fpsButton.textContent = Number((rate.num / rate.den).toFixed(6)) + ' fps';
        });
      }, row); p.fpsButton = row.lastChild; p.fpsButton.textContent = Number(Number(p.card.frameRate || 24).toFixed(6)) + ' fps';
      button('源帧', function() { KanvazUI.showPrompt('按源编号查找', '输入原文件中的源帧编号', '', function(value) { var index = p.info.frames.findIndex(function(f) { return f.number === Number(value); }); if (index < 0) fail(new Error('源编号不存在：' + value)); else seek(p, index).catch(fail); }); }, row);
    }
    var bg = element('select', 'fp-background');
    ['棋盘格', '黑底', '白底'].map(function(label, i) { var o = element('option', '', label); o.value = String(i); bg.appendChild(o); }); row.appendChild(bg);
    bg.value = String(p.card.frameBackground || 0); p.stage.dataset.background = bg.value;
    bg.addEventListener('change', function() { p.card.frameBackground = Number(bg.value); p.stage.dataset.background = bg.value; dirty(); });
    button('定位素材', function() { focus(p.card); }, row);
    button('100%', function() { var v = KanvazCanvas.getViewport(); var sc = p.card.naturalW ? p.card.naturalW / p.card.w : 1; KanvazCanvas.setViewport(v.width / 2 - (p.card.x + p.card.w / 2) * sc, v.height / 2 - (p.card.y + p.card.h / 2) * sc, sc); }, row);
    button('重置预览', function() { p.canvas.style.objectFit = 'contain'; p.canvas.style.objectPosition = 'center'; }, row);
    p.label = element('div', 'fp-label', '帧索引中'); p.source = element('div', 'fp-source'); box.appendChild(p.label); box.appendChild(p.source);
    p.slider = element('input', 'fp-timeline'); p.slider.type = 'range'; p.slider.min = '0'; p.slider.max = '0'; p.slider.value = '0'; p.slider.step = '1'; p.slider.setAttribute('aria-label', '帧时间轴'); box.appendChild(p.slider);
    p.slider.addEventListener('input', function() {
      p.scrubTarget = Number(p.slider.value); if (p.scrubTimer) return;
      p.scrubTimer = setTimeout(function() { p.scrubTimer = null; seek(p, p.scrubTarget).catch(fail); }, 45);
    });
    p.slider.addEventListener('change', function() { clearTimeout(p.scrubTimer); p.scrubTimer = null; seek(p, Number(p.slider.value)).catch(fail); });
    p.markers = element('div', 'fp-markers'); box.appendChild(p.markers);
    p.status = element('div', 'fp-status', '正在检查源帧'); box.appendChild(p.status);
    button('取消', function() { pause(p); KanvazBridge.cancelVideoProxy(p.card.id); return call('cancel', { id: 'prepare-' + p.card.id }).then(function() { return call('cancel', { id: 'decode-' + p.card.id }); }); }, box);
    button('重试', function() { return initialise(p); }, box);
    button('重新扫描', function() {
      if (p.sequence && p.card.sequenceFrames[0] && !p.card.sequenceFrames[0].billfishSource) return rescan(p);
      KanvazUI.showDialog('重新扫描源媒体', '重新检查已保存的帧清单。源版本变化后，旧笔记会标记为待核对；不会自动绑定到新画面。', [{ label: '取消' }, { label: '确认重新扫描', action: function() { initialise(p, true).catch(fail); } }]);
    }, box);
    button('重新关联', function() { return relink(p); }, box);
    button('复制诊断', function() { return navigator.clipboard.writeText(JSON.stringify(p.error && p.error.diagnostic || { stage: '播放器', message: p.status.textContent }, null, 2)); }, box);
    p.el.tabIndex = 0;
    p.el.addEventListener('keydown', function(e) {
      if (e.target.matches('input,textarea,select') || e.target.isContentEditable || !p.info) return;
      if (['ArrowLeft', 'ArrowRight', ' ', 'Home', 'End'].indexOf(e.key) === -1) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === ' ') play(p);
      else seek(p, e.key === 'Home' ? 0 : e.key === 'End' ? p.info.count - 1 : Math.max(0, Math.min(p.info.count - 1, p.index + (e.key === 'ArrowRight' ? 1 : -1)))).catch(fail);
    });
  }
  function parseRate(value) {
    var numeric = Number(value);
    if (Math.abs(numeric - 24000 / 1001) < 0.000001) return { num: 24000, den: 1001 };
    if (Math.abs(numeric - 30000 / 1001) < 0.000001) return { num: 30000, den: 1001 };
    if (Math.abs(numeric - 60000 / 1001) < 0.000001) return { num: 60000, den: 1001 };
    var text = String(value), aliases = { '23.976': [24000, 1001], '29.97': [30000, 1001], '59.94': [60000, 1001] }, pair = aliases[text] || text.split('/').map(Number);
    var num = pair[0], den = pair.length > 1 ? pair[1] : 1; if (pair.length > 2 || !isFinite(num / den) || num / den < 1 || num / den > 120) return null;
    if (!Number.isInteger(num)) { den *= 1000000; num = Math.round(num * 1000000); }
    return { num: num, den: den };
  }
  function initialise(p, allowChanged) {
    pause(p); p.images = new Map(); p.status.textContent = p.sequence ? '正在检查源帧' : '帧索引中';
    var revision = p.card.sourceRevisionId;
    return call('prepare', { id: 'prepare-' + p.card.id, frames: p.sequence ? p.card.sequenceFrames : null, path: p.card.path, dataUrl: p.sequence ? null : p.card.dataUrl,
      assetId: p.card.frameAssetId, sourceRevisionId: revision, directoryState: p.card.sequenceDirectoryState, allowChanged: !!allowChanged, fps: p.card.frameRateRational ? p.card.frameRateRational.num + '/' + p.card.frameRateRational.den : p.card.frameRate || 24 }).then(function(info) {
      if (!p.el.isConnected) { call('release', { token: info.token }); return; }
      p.info = info; p.card.frameAssetId = info.assetId; p.card.sourceRevisionId = info.sourceRevisionId;
      if (p.video && info.url && !p.card.dataUrl && (p.refreshSource || !p.video.getAttribute('src') || info.changed)) {
        p.refreshSource = false; p.video._proxyGeneration = (p.video._proxyGeneration || 0) + 1; KanvazBridge.cancelVideoProxy(p.card.id);
        p.card.mediaSource = { kind: 'external', url: info.url }; p.video._proxyTried = false; p.video.src = info.url;
      }
      if (p.sequence) { p.card.sequenceFrames = info.frames.map(function(f) { var copy = Object.assign({}, f); delete copy.previewUrl; return copy; }); p.card.sequenceDirectoryState = info.directoryState; p.card.frameRateRational = info.fps; p.card.frameRate = info.fps.num / info.fps.den; }
      p.card.naturalW = info.width; p.card.naturalH = info.height;
      positionNew(p.card, info.width, info.height);
      return call('notes-load', { assetId: info.assetId }).then(function(r) {
        var boardData = assets[info.assetId];
        if (!boardData) assets[info.assetId] = r.data || dataFor(p.card);
        else if (r.data) assets[info.assetId] = mergeNotes(boardData, r.data);
        assets[info.assetId].sourceRevisionId = info.sourceRevisionId;
        if (info.changed) { dataFor(p.card).notes.map(function(n) { n.needsReview = true; }); save(dataFor(p.card)).catch(fail); p.source.title = '源版本已变化，请核对旧笔记'; KanvazUI.toast(p.source.title, 'warning'); }
        if (info.bitDepth > 8) p.source.title = '8 位预览；原始 ' + info.bitDepth + ' 位源图保持不变';
        markers(p); return seek(p, Math.max(0, Math.min(info.count - 1, p.card.frameIndex || 0)));
      });
    }).catch(function(e) {
      p.error = e; p.status.textContent = e.message; p.label.textContent = '媒体未就绪';
      var loading = p.el.querySelectorAll('.card-skeleton,.card-spinner'); for (var i = 0; i < loading.length; i++) loading[i].remove();
      throw e;
    });
  }
  function mount(el, card, video) {
    if (players[card.id]) dispose(players[card.id]);
    el.style.setProperty('--fp-ui-scale', String(1 / KanvazCanvas.getViewport().scale));
    var stage = element('div', 'fp-stage'); stage.dataset.background = '0';
    var canvas = element('canvas', 'fp-canvas'); stage.appendChild(canvas); el.appendChild(stage);
    var p = { el: el, card: card, stage: stage, canvas: canvas, sequence: !!(card.sequenceFrames && card.sequenceFrames.length), video: video || null, refreshSource: !!(card.frameAssetId && card.mediaSource), index: card.frameIndex || 0, request: 0, playing: false };
    players[card.id] = p; controls(p);
    if (video) {
      stage.insertBefore(video, canvas); canvas.hidden = true;
      video.style.objectFit = 'contain'; video.style.objectPosition = 'center'; video.loop = card.sequenceLoop !== false;
      function presented(now, metadata) { if (!el.isConnected) return; if (p.info && !video.paused && !video.seeking) { p.canvas.hidden = true; p.index = frameAtTime(p, metadata.mediaTime - nativeStart(p)); p.target = p.index; update(p); } p.videoCallback = video.requestVideoFrameCallback(presented); }
      if (video.requestVideoFrameCallback) p.videoCallback = video.requestVideoFrameCallback(presented);
      video.addEventListener('loadeddata', function() {
        if (!p.info) return;
        var time = nativeTime(p, p.target === undefined ? p.index : p.target);
        if (video.paused && Math.abs(video.currentTime - time) > 0.00005) video.currentTime = time;
        if (p.wantPlay) { p.wantPlay = false; play(p); }
      });
      video.addEventListener('play', function() { p.internalPause = false; p.status.textContent = ''; ++p.request; call('cancel', { id: 'decode-' + card.id }); update(p); });
      video.addEventListener('pause', function() { if (p.info && !p.internalPause) seek(p, p.index).catch(fail); p.internalPause = false; });
    }
    p.ready = initialise(p); p.ready.catch(function() {}); return p;
  }
  function dispose(p) { pause(p); ++p.request; clearTimeout(p.scrubTimer); if (p.images) p.images.clear(); KanvazBridge.cancelVideoProxy(p.card.id); call('cancel', { id: 'prepare-' + p.card.id }); call('cancel', { id: 'decode-' + p.card.id }); if (p.info) call('release', { token: p.info.token }); if (p.video && p.videoCallback) p.video.cancelVideoFrameCallback(p.videoCallback); }
  setInterval(function() { Object.keys(players).map(function(id) { if (!players[id].el.isConnected) { dispose(players[id]); delete players[id]; } else players[id].el.style.setProperty('--fp-ui-scale', String(1 / KanvazCanvas.getViewport().scale)); }); }, 500);
  function relink(p) {
    return call('choose-source').then(function(r) {
      if (!r.path) return;
      if (!p.sequence) { p.card.path = r.path; if (p.video) { p.video.removeAttribute('src'); p.video.load(); } dirty(); return initialise(p); }
      var oldFirst = p.card.sequenceFrames[0].path, oldDir = oldFirst.slice(0, Math.max(oldFirst.lastIndexOf('/'), oldFirst.lastIndexOf('\\')) + 1);
      var newDir = r.path.slice(0, Math.max(r.path.lastIndexOf('/'), r.path.lastIndexOf('\\')) + 1);
      p.card.sequenceFrames = p.card.sequenceFrames.map(function(f) { var copy = Object.assign({}, f); if (f.path.indexOf(oldDir) === 0) copy.path = newDir + f.path.slice(oldDir.length); copy.billfishSource = null; return copy; });
      dirty(); return initialise(p);
    });
  }
  function rescan(p) {
    var old = p.card.sequenceFrames, first = old[0];
    return call('scan-siblings', { path: first.path }).then(function(r) {
      var group = KanvazSequences.detect(r.files, first.fieldFromRight || 0).find(function(g) { return g.files.some(function(f) { return f.path.toLowerCase() === first.path.toLowerCase(); }); });
      if (!group || group.duplicates.length) throw new Error(group ? '存在重复编号，请先整理源文件' : '没有找到可重新关联的序列');
      KanvazUI.showDialog('确认序列新清单', group.frames.length + ' 帧（' + group.range + '），缺失 ' + group.missingCount + ' 帧。确认后按已有文件连续播放，旧笔记标记为待核对。', [
        { label: '取消' }, { label: '确认重新扫描', action: function() {
          var previous = p.card.sequenceFrames;
          p.card.sequenceFrames = group.frames.map(function(f) { var found = old.find(function(o) { return o.path.toLowerCase() === f.path.toLowerCase(); }); return { path: f.path, number: f.number, fieldFromRight: f.fieldFromRight, id: found && found.id }; });
          initialise(p, true).then(function() { p.card.missingFrames = group.missing; dirty(); }).catch(function(e) { p.card.sequenceFrames = previous; fail(e); });
        } }
      ]);
    });
  }
  function thumbnail(url) {
    return new Promise(function(resolve, reject) { var img = new Image(); img.onload = function() { var c = document.createElement('canvas'); var scale = Math.min(1, 160 / img.width, 100 / img.height); c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale)); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); resolve(c.toDataURL('image/png')); }; img.onerror = function() { reject(new Error('附件图片无法解码')); }; img.src = url; });
  }
  function addAttachment(data, url, name, kind) {
    return thumbnail(url).then(function(small) { var id = uid(); data.attachments[id] = { id: id, name: name || '图片.png', kind: kind || 'reference', dataUrl: url, thumbnail: small }; return id; });
  }
  function addNote(p) {
    var wasPlaying = p.playing || (p.video && !p.video.paused), anchorTarget = wasPlaying ? p.index : p.target === undefined ? p.index : p.target;
    if (p.video) p.video._frameSeek = true;
    pause(p); if (!p.info) return Promise.reject(new Error('正在定位帧，请等待媒体就绪'));
    return track(seek(p, anchorTarget).then(function(ok) {
      if (!ok) throw new Error('正在定位帧，请等待最新目标帧呈现');
      var f = p.info.frames[p.index], data = dataFor(p.card), now = new Date().toISOString();
      var note = { id: uid(), assetId: p.info.assetId, sourceRevisionId: p.info.sourceRevisionId,
        anchor: { frameIndex: p.index, sourceFrameNumber: p.sequence ? f.number : null, sourceFrameId: p.sequence ? f.id : null, pts: p.sequence ? null : f.pts, timeBase: p.sequence ? null : p.info.timeBase },
        text: '', attachmentIds: [], createdAt: now, updatedAt: now };
      return thumbnail(captureFrame(p)).then(function(small) { return addAttachment(data, small, '帧缩略图.png', 'frame-thumbnail'); }).then(function(id) {
        note.thumbnailId = id; data.notes.push(note); openNotes(p, note.id); refreshMarkers(data.assetId); return save(data);
      });
    }));
  }
  function jump(p, note) {
    if (!p.info) return Promise.reject(new Error('源媒体未找到，请重新关联；已保存的文字与附件仍可查看'));
    if (note.sourceRevisionId !== p.info.sourceRevisionId || note.needsReview) return Promise.reject(new Error('源媒体版本变化，请先核对该笔记的源画面'));
    var index = note.anchor.frameIndex;
    if (p.sequence) { index = p.info.frames.findIndex(function(f) { return f.id === note.anchor.sourceFrameId; }); if (index < 0) return Promise.reject(new Error('原始序列帧未找到')); }
    focus(p.card); return seek(p, index).then(function(ok) { if (ok) openNotes(p, note.id); });
  }
  function openNotes(p, id) {
    activePlayer = p; selectedNote = id || null;
    if (!panel) {
      panel = element('aside', 'fp-notes-panel'); panel.id = 'frame-notes-panel'; panel.setAttribute('data-i18n-ignore', ''); document.body.appendChild(panel);
      ['mousedown', 'keydown', 'dblclick', 'wheel'].map(function(name) { panel.addEventListener(name, function(e) { e.stopPropagation(); }); });
      panel.addEventListener('paste', paste);
      panel.addEventListener('dragover', function(e) { e.preventDefault(); e.stopPropagation(); });
      panel.addEventListener('drop', function(e) { e.preventDefault(); e.stopPropagation(); var files = Array.from(e.dataTransfer.files || []); attachFiles(files).catch(fail); });
    }
    renderPanel();
  }
  function deleteNote(data, note) {
    data.notes = data.notes.filter(function(n) { return n.id !== note.id; });
    if (!data.deletedNoteIds) data.deletedNoteIds = {};
    data.deletedNoteIds[note.id] = new Date().toISOString();
    if (selectedNote === note.id) selectedNote = null;
    refreshMarkers(data.assetId); renderPanel(); return save(data);
  }
  function renderPanel() {
    if (!panel || !activePlayer) return;
    var p = activePlayer, data = dataFor(p.card), scroll = panel.scrollTop;
    var oldSearch = panel.querySelector('.fp-search'), oldFilter = panel.querySelector('.fp-filter'), oldList = panel.querySelector('.fp-note-list');
    var listScroll = oldList ? oldList.scrollTop : 0;
    var searchValue = oldSearch ? oldSearch.value : '', filterValue = oldFilter ? oldFilter.value : '0'; panel.replaceChildren();
    var head = element('div', 'fp-row'); panel.appendChild(head); head.appendChild(element('strong', '', '帧笔记 · ' + p.card.name));
    button('关闭', function() { return flush().then(function() { panel.remove(); panel = null; }); }, head);
    var status = element('span', 'fp-save-status', data ? saveStates[data.assetId] || (data.notes.length ? '已保存' : '') : ''); panel.appendChild(status);
    button('重试保存', function() { if (data) return save(data); }, panel);
    var actions = element('div', 'fp-row'); panel.appendChild(actions);
    button('添加帧笔记', function() { return addNote(p); }, actions);
    button('上一条', function() { return adjacent(-1); }, actions); button('下一条', function() { return adjacent(1); }, actions);
    button('导出全部', function() { if (data) return call('notes-export', { data: snapshot()[data.assetId], name: p.card.name }); }, actions);
    button('导出选中', function() { if (data && selectedNote) return call('notes-export', { data: snapshot()[data.assetId], name: p.card.name, selectedIds: [selectedNote] }); }, actions);
    button('导入', function() { return importPackage(p); }, actions);
    var search = element('input', 'fp-search'); search.placeholder = '搜索笔记'; panel.appendChild(search);
    search.value = searchValue;
    var filter = element('select', 'fp-filter'); ['全部笔记', '当前帧笔记', '含图片'].map(function(text, i) { var option = element('option', '', text); option.value = String(i); filter.appendChild(option); }); panel.appendChild(filter);
    var list = element('div', 'fp-note-list'); panel.appendChild(list);
    filter.value = filterValue;
    function listNotes() {
      list.replaceChildren(); if (!data) { list.textContent = '媒体未就绪'; return; }
      data.notes.slice().sort(function(a, b) { return a.anchor.frameIndex - b.anchor.frameIndex || a.createdAt.localeCompare(b.createdAt); }).filter(function(n) {
        return n.text.toLowerCase().indexOf(search.value.toLowerCase()) !== -1 && (filter.value !== '1' || n.anchor.frameIndex === p.index) && (filter.value !== '2' || n.attachmentIds.length > 0);
      }).map(function(n) {
        var item = element('div', 'fp-note-card'); item.dataset.noteId = n.id; item.tabIndex = 0; item.setAttribute('role', 'group'); item.setAttribute('aria-label', '第 ' + (n.anchor.frameIndex + 1) + ' 帧笔记'); item.classList.toggle('active', n.id === selectedNote); list.appendChild(item);
        item.addEventListener('click', function() { selectedNote = n.id; renderPanel(); var selected = panel.querySelector('.fp-note-card.active'); if (selected) selected.focus({ preventScroll: true }); });
        item.addEventListener('keydown', function(e) { if (e.target !== item) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectedNote = n.id; renderPanel(); } else if (e.key === 'Delete') { e.preventDefault(); deleteNote(data, n).catch(fail); } });
        if (data.attachments[n.thumbnailId]) { var img = element('img', 'fp-note-thumb'); img.src = data.attachments[n.thumbnailId].thumbnail; item.appendChild(img); }
        var label = '第 ' + (n.anchor.frameIndex + 1) + ' 帧' + (n.anchor.sourceFrameNumber !== null ? ' · 源帧 ' + n.anchor.sourceFrameNumber : '');
        if (n.needsReview || n.sourceRevisionId !== p.card.sourceRevisionId) label += ' · 待核对';
        button(label, function() { selectedNote = n.id; renderPanel(); return jump(p, n); }, item);
        button('编辑', function() { selectedNote = n.id; renderPanel(); if (editor) editor.focus(); }, item);
        button('删除整条', function() { return deleteNote(data, n); }, item).classList.add('fp-delete-note');
        item.appendChild(element('div', '', n.text.slice(0, 120) || '（空笔记）'));
        item.appendChild(element('small', '', n.attachmentIds.length + ' 张参考图 · ' + n.updatedAt));
      });
    }
    search.addEventListener('input', listNotes); filter.addEventListener('change', listNotes); listNotes(); list.scrollTop = listScroll;
    var note = data && data.notes.find(function(n) { return n.id === selectedNote; });
    panel.scrollTop = scroll; editor = null; if (!note) return;
    var edit = element('div', 'fp-note-editor'); panel.appendChild(edit);
    edit.appendChild(element('strong', '', '锁定：' + p.card.name + ' · 第 ' + (note.anchor.frameIndex + 1) + ' 帧' + (note.anchor.sourceFrameNumber !== null ? ' · 源帧 ' + note.anchor.sourceFrameNumber : '')));
    var text = element('textarea', 'fp-note-text'); text.rows = 6; text.value = note.text; text.placeholder = '输入文字；Ctrl+V 粘贴图片，或拖入图片'; edit.appendChild(text); editor = text;
    text.addEventListener('input', function() { note.text = text.value; note.updatedAt = new Date().toISOString(); scheduleSave(data); });
    var tools = element('div', 'fp-row'); edit.appendChild(tools);
    button('添加图片', function() { return call('choose-images').then(function(r) { return attachPaths(r.paths); }); }, tools);
    button('插入当前帧截图', function() {
      return seek(p, p.target === undefined ? p.index : p.target).then(function(ok) {
        if (!ok) throw new Error('正在定位帧');
        return addAttachment(data, captureFrame(p), '第' + (p.index + 1) + '帧.png', 'frame-capture').then(function(id) { note.attachmentIds.push(id); note.updatedAt = new Date().toISOString(); renderPanel(); return save(data); });
      });
    }, tools);
    button('跳到该帧', function() { return jump(p, note); }, tools);
    button('删除整条笔记', function() { return deleteNote(data, note); }, tools);
    if (note.needsReview || note.sourceRevisionId !== p.card.sourceRevisionId) button('已核对此帧', function() {
      if (!p.info) throw new Error('源媒体未就绪');
      KanvazUI.showDialog('重新绑定笔记', '将此笔记绑定到当前已呈现的第 ' + (p.index + 1) + ' 帧？请先核对画面。', [{ label: '取消' }, { label: '确认绑定', action: function() { var f = p.info.frames[p.index]; note.sourceRevisionId = p.card.sourceRevisionId; note.anchor = { frameIndex: p.index, sourceFrameNumber: p.sequence ? f.number : null, sourceFrameId: p.sequence ? f.id : null, pts: p.sequence ? null : f.pts, timeBase: p.sequence ? null : p.info.timeBase }; note.needsReview = false; note.updatedAt = new Date().toISOString(); save(data).catch(fail); refreshMarkers(data.assetId); renderPanel(); } }]);
    }, tools);
    var gallery = element('div', 'fp-attachments'); edit.appendChild(gallery);
    note.attachmentIds.map(function(id, index) {
      var a = data.attachments[id]; if (!a) return;
      var tile = element('div', 'fp-attachment'); gallery.appendChild(tile);
      var img = element('img'); img.src = a.thumbnail; img.alt = a.name; tile.appendChild(img);
      img.addEventListener('click', function() { var overlay = element('div', 'fp-image-overlay'); var large = element('img'); large.src = a.dataUrl; large.alt = a.name; overlay.appendChild(large); overlay.addEventListener('click', function() { overlay.remove(); }); document.body.appendChild(overlay); });
      button('←', function() { if (index > 0) { note.attachmentIds.splice(index, 1); note.attachmentIds.splice(index - 1, 0, id); note.updatedAt = new Date().toISOString(); renderPanel(); return save(data); } }, tile);
      button('→', function() { if (index < note.attachmentIds.length - 1) { note.attachmentIds.splice(index, 1); note.attachmentIds.splice(index + 1, 0, id); note.updatedAt = new Date().toISOString(); renderPanel(); return save(data); } }, tile);
      button('删除', function() { note.attachmentIds = note.attachmentIds.filter(function(x) { return x !== id; }); note.updatedAt = new Date().toISOString(); renderPanel(); return save(data); }, tile);
    });
  }
  function adjacent(dir) {
    var data = dataFor(activePlayer.card); if (!data) return;
    var notes = data.notes.slice().sort(function(a, b) { return a.anchor.frameIndex - b.anchor.frameIndex || a.createdAt.localeCompare(b.createdAt); });
    var at = notes.findIndex(function(n) { return n.id === selectedNote; }); var n = notes[Math.max(0, Math.min(notes.length - 1, at + dir))]; if (n) return jump(activePlayer, n);
  }
  function attachmentTarget() {
    var p = activePlayer, data = p && dataFor(p.card), note = data && data.notes.find(function(n) { return n.id === selectedNote; });
    return { data: data, note: note, player: p };
  }
  function attachUrl(url, name, target) {
    target = target || attachmentTarget(); var data = target.data, note = target.note;
    if (!note) return Promise.reject(new Error('请先添加或选择一条帧笔记'));
    return addAttachment(data, url, name).then(function(id) {
      note.attachmentIds.push(id); note.updatedAt = new Date().toISOString();
      if (activePlayer === target.player && selectedNote === note.id) { renderPanel(); if (editor) editor.focus(); }
      return save(data);
    });
  }
  function attachPaths(paths) { var target = attachmentTarget(); return track(paths.reduce(function(chain, p) { return chain.then(function() { return call('attachment-read', { path: p }).then(function(r) { return attachUrl(r.dataUrl, r.name, target); }); }); }, Promise.resolve())); }
  function attachFiles(files) {
    var target = attachmentTarget();
    return track(files.reduce(function(chain, file) { return chain.then(function() {
      if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) throw new Error('附件仅支持 PNG/JPG/WebP/BMP/GIF 静态预览');
      if (file.size > 32 * 1024 * 1024) throw new Error('单张图片不能超过 32 MB');
      return new Promise(function(resolve, reject) { var reader = new FileReader(); reader.onload = function() { attachUrl(reader.result, file.name, target).then(resolve, reject); }; reader.onerror = reject; reader.readAsDataURL(file); });
    }); }, Promise.resolve()));
  }
  function paste(e) {
    var files = Array.from(e.clipboardData && e.clipboardData.items || []).filter(function(item) { return item.kind === 'file' && item.type.indexOf('image/') === 0; }).map(function(item) { return item.getAsFile(); }).filter(Boolean);
    e.stopPropagation();
    if (files.length) { e.preventDefault(); attachFiles(files).catch(fail); }
    else if (e.clipboardData && /<img\b/i.test(e.clipboardData.getData('text/html'))) { e.preventDefault(); fail(new Error('剪贴板仅含图片链接，尚未嵌入；请复制图片本身或添加本地图片')); }
  }
  function importPackage(p) {
    return call('notes-import').then(function(r) {
      if (r.cancelled) return;
      var data = dataFor(p.card), incoming = r.data;
      if (!data || data.assetId !== incoming.assetId || data.sourceRevisionId !== incoming.sourceRevisionId) throw new Error('笔记包与当前素材或源版本不匹配，未导入');
      mergeNotes(data, incoming); refreshMarkers(data.assetId); renderPanel(); return save(data);
    });
  }
  KanvazBridge.on('frame-media-progress', function(progress) { Object.keys(players).map(function(id) { var p = players[id]; if (progress.id === 'prepare-' + id) p.status.textContent = progress.stage + ' ' + progress.current + (progress.total ? '/' + progress.total : ''); }); });
  return { mount: mount, step: function(id, dir) { var p = players[id]; if (p && p.info) { var target = p.target === undefined ? p.index : p.target; return seek(p, Math.max(0, Math.min(p.info.count - 1, target + dir))); } },
    get: function(id) { return players[id]; }, seek: function(id, index) { return seek(players[id], index); }, addNote: function(id) { return addNote(players[id]); },
    openNotes: function(id) { return openNotes(players[id]); }, snapshot: snapshot, restore: restore, flush: flush,
    importTarget: importTarget, placement: placement, parseRate: parseRate };
}());
