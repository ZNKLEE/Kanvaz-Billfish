/* Billfish browser and linked canvas cards. Original files are never edited. */
var KanvazBillfish = (function() {
  var library = null; var panel = null; var items = []; var selection = {}; var anchor = -1; var offset = 0; var total = 0; var generation = 0; var folder = ''; var relinkCard = null; var expanded = {};
  var pending = []; var active = 0;
  function t(text) { return KanvazI18n.t(text); }
  function call(action, arg) { return KanvazBridge.billfish(action, arg).then(function(r) { if (r && r.error) throw new Error(r.error); return r; }); }
  function warn(e) { KanvazUI.toast(t(e.message || String(e)), 'error'); }
  function node(tag, cls, text) { var el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = t(text); return el; }
  function button(text, action, cls) { var el = node('button', 'btn ' + (cls || ''), text); el.type = 'button'; el.addEventListener('click', action); return el; }
  function reference(file) { return { libraryUuid: file.libraryUuid, materialId: String(file.id), originalPath: file.path, name: file.name, md5: file.md5 || '', size: file.size || '' }; }
  function queue(arg) { return new Promise(function(resolve, reject) { pending.push({ arg: arg, resolve: resolve, reject: reject }); pump(); }); }
  function pump() {
    while (active < 4 && pending.length) {
      (function(job) { active++; call('image', job.arg).then(job.resolve, job.reject).finally(function() { active--; pump(); }); })(pending.shift());
    }
  }
  function close() { generation++; if (panel) panel.remove(); panel = null; items = []; selection = {}; }
  function missing(card, el, img, unavailable) {
    img.style.display = 'none'; var skeleton = el.querySelector('.card-skeleton'); if (skeleton) skeleton.remove();
    if (el.querySelector('.bf-missing')) return;
    var message = node('div', 'bf-missing'); message.appendChild(node('strong', '', unavailable ? 'Preview unavailable' : 'Material missing'));
    message.appendChild(button('Relink material', function(e) { e.stopPropagation(); relinkCard = card; open(); }));
    message.addEventListener('pointerdown', function(e) { e.stopPropagation(); }); el.appendChild(message);
  }
  function hydrate(card, el, img) {
    var loading = false; var quality = ''; var observed = null; var visible = false;
    img.onerror = function() { if (el.isConnected && visible) missing(card, el, img, true); };
    function load(level) {
      if (loading || quality === level || !el.isConnected || !visible) return;
      loading = true;
      queue({ reference: card.billfishSource, quality: level, refresh: quality === '' }).then(function(r) {
        if (!el.isConnected || !visible) return;
        if (r.missing) { missing(card, el, img); return; }
        card.path = r.file.path; card.billfishSource.originalPath = r.file.path; card.billfishSource.name = r.file.name;
        card.dataUrl = r.image; img.style.display = 'block'; img.src = r.image; quality = level;
        var error = el.querySelector('.bf-missing'); if (error) error.remove();
      }).catch(function(e) { if (el.isConnected) missing(card, el, img, /格式|解码|500 MB|路径超出/.test(e.message)); }).finally(function() { loading = false; });
    }
    observed = new IntersectionObserver(function(entries) {
      visible = entries[0].isIntersecting;
      if (visible) load('small');
      else { img.removeAttribute('src'); card.dataUrl = null; quality = ''; }
    }, { rootMargin: '150px' }); observed.observe(el);
    el.billfishReload = function() { quality = ''; card.dataUrl = null; img.removeAttribute('src'); if (visible) load('small'); };
    var timer = setInterval(function() {
      if (!el.isConnected) { observed.disconnect(); clearInterval(timer); return; }
      var rect = el.getBoundingClientRect();
      if (rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth && Math.max(rect.width, rect.height) > 600) load('hd');
    }, 1500);
  }
  function add(files, sequencesResolved) {
    if (!files.length) return Promise.resolve([]);
    if (!sequencesResolved && typeof KanvazSequences !== 'undefined' && files.length > 1) {
      var frameTarget = KanvazFrames.importTarget(1);
      return new Promise(function(resolve) {
        KanvazSequences.resolveGroups(files, function(individuals, accepted) {
          frameTarget.count = Math.max(1, accepted.length);
          for (var gi = 0; gi < accepted.length; gi++) {
            var item = accepted[gi]; var group = item.group;
            var references = group.frames.map(function(frame) { return { path: frame.path, number: frame.number, fieldFromRight: frame.fieldFromRight, billfishSource: reference(frame.file), name: frame.file.name }; });
            KanvazCards.createSequenceFromPaths(references, group.name, item.fps, { frameTarget: frameTarget, frameIndex: gi }, group.missing);
            if (group.missing.length) KanvazUI.toast('序列缺帧已跳过：' + group.missing.join(', '), 'warning');
          }
          if (!individuals.length) { KanvazCards.setMultiSelection([]); KanvazApp.markDirty(); KanvazBoards.doAutosave(); resolve([]); }
          else add(individuals, true).then(resolve, function(e) { warn(e); resolve([]); });
        });
      });
    }
    if (document.getElementById('startup-screen')) { KanvazBoards.toggleHomeScreen(); KanvazBoards.newBoard(true); }
    var viewport = KanvazCanvas.getViewport();
    var start = KanvazCanvas.screenToWorld(innerWidth / 2, innerHeight / 2);
    var all = KanvazCards.getAll(); var bounds = Object.keys(all).map(function(id) { return all[id]; });
    var x = start.x; var y = start.y; var width = 280; var gap = 24; var cols = Math.max(1, Math.min(5, Math.floor(viewport.width / viewport.scale / (width + gap))));
    function occupied(px, py) { return bounds.some(function(c) { return px < c.x + c.w + gap && px + width + gap > c.x && py < c.y + c.h + gap && py + width + gap > c.y; }); }
    var tries = 0; while (occupied(x, y) && tries++ < 1000) { x += width + gap; if (tries % cols === 0) { x = start.x; y += width + gap; } }
    var ids = []; var chain = Promise.resolve();
    files.map(function(file, index) {
      chain = chain.then(function() {
        if (['mp4','webm','mov','mkv','avi'].indexOf(file.ext) >= 0) {
          return KanvazMedia.loadFromFile({ path: file.path, name: file.name }, function(result, err) {
            if (err || !result) { warn(err || '视频读取失败'); return; }
            var px = x + (index % cols) * (width + gap); var py = y + Math.floor(index / cols) * (width + gap);
            var card = KanvazCards.createFromMedia(result, { x: px, y: py }); ids.push(card.id); bounds.push(card);
          });
        }
        return Promise.resolve({ width: file.width || 0, height: file.height || 0 }).then(function(r) {
          var height = r.width && r.height ? Math.min(280, width * r.height / r.width) : 200;
          var px = x + (index % cols) * (width + gap); var py = y + Math.floor(index / cols) * (width + gap);
          while (occupied(px, py)) py += width + gap;
          var card = KanvazCards.createFromMedia({ type: 'image', dataUrl: null, name: file.name, originalPath: file.path, billfishSource: reference(file), displayW: width, displayH: height, naturalW: r.width || width, naturalH: r.height || height }, { x: px, y: py });
          ids.push(card.id); bounds.push(card);
        });
      });
    });
    return chain.then(function() { KanvazCards.setMultiSelection(ids); KanvazApp.markDirty(); KanvazBoards.doAutosave(); return ids; });
  }
  function chosen() { return items.filter(function(file) { return selection[file.id]; }); }
  function confirmSelection() {
    var files = chosen(); if (!files.length) return;
    if (relinkCard) {
      var card = relinkCard; relinkCard = null; var file = files[0];
      KanvazCards.updateCardData(card.id, { billfishSource: reference(file), name: file.name, path: file.path, dataUrl: null });
      close(); KanvazApp.markDirty(); return;
    }
    close(); add(files).catch(warn);
  }
  function updateSelection() {
    if (!panel) return;
    var tiles = panel.querySelectorAll('.bf-tile');
    for (var i = 0; i < tiles.length; i++) tiles[i].classList.toggle('selected', !!selection[tiles[i].dataset.id]);
    panel.querySelector('#bf-add').disabled = chosen().length === 0;
    panel.querySelector('#bf-count').textContent = total + t(' materials') + ' · ' + chosen().length + t(' selected');
  }
  function preview(file) {
    queue({ reference: reference(file), quality: 'hd', refresh: true }).then(function(r) {
      if (r.missing) throw new Error('Material missing');
      var overlay = node('div', 'bf-overlay bf-preview'); var box = node('section', 'bf-box');
      box.appendChild(button('Close', function() { overlay.remove(); })); var img = node('img'); img.src = r.image; img.alt = file.name; box.appendChild(img); box.appendChild(node('p', 'bf-user-text', file.name)); overlay.appendChild(box); document.body.appendChild(overlay);
    }).catch(warn);
  }
  function renderRows(result, token) {
    if (!panel || token !== generation) return;
    items = result.items; total = result.total; selection = {}; anchor = -1;
    var grid = panel.querySelector('#bf-grid'); grid.replaceChildren();
    items.map(function(file, index) {
      var tile = node('button', 'bf-tile'); tile.dataset.id = file.id; tile.type = 'button';
      var img = node('img'); img.loading = 'lazy'; img.alt = ''; tile.appendChild(img); var name = node('span', 'bf-user-text', file.name); name.title = file.name; tile.appendChild(name);
      tile.addEventListener('click', function(e) {
        if (e.shiftKey && anchor >= 0) { if (!e.ctrlKey) selection = {}; for (var n = Math.min(anchor, index); n <= Math.max(anchor, index); n++) selection[items[n].id] = true; }
        else { if (!e.ctrlKey && !e.metaKey) selection = {}; selection[file.id] = !selection[file.id]; anchor = index; }
        updateSelection();
      });
      tile.addEventListener('dblclick', function() { preview(file); });
      tile.addEventListener('contextmenu', function(e) {
        e.preventDefault(); if (!selection[file.id]) { selection = {}; selection[file.id] = true; updateSelection(); }
        var menu = node('div', 'bf-context'); menu.style.left = Math.min(e.clientX, innerWidth - 200) + 'px'; menu.style.top = Math.min(e.clientY, innerHeight - 60) + 'px';
        menu.appendChild(button('Add to board', function() { menu.remove(); confirmSelection(); })); panel.appendChild(menu);
        setTimeout(function() { document.addEventListener('click', function dismiss() { menu.remove(); document.removeEventListener('click', dismiss); }, { once: true }); }, 0);
      });
      grid.appendChild(tile);
      queue({ reference: reference(file), quality: 'small' }).then(function(r) { if (tile.isConnected && token === generation && r.image) img.src = r.image; }).catch(function() { tile.classList.add('unavailable'); });
    });
    panel.querySelector('#bf-prev').disabled = offset === 0; panel.querySelector('#bf-next').disabled = offset + items.length >= total;
    updateSelection();
  }
  function reload() {
    if (!panel || !library) return;
    var token = ++generation;
    call('list', { uuid: library.uuid, folderId: folder, search: panel.querySelector('#bf-search').value, ext: panel.querySelector('#bf-format').value, kind: panel.querySelector('#bf-kind').value, offset: offset, limit: 80 }).then(function(result) { renderRows(result, token); }).catch(warn);
  }
  function renderTree() {
    var tree = panel.querySelector('#bf-tree'); tree.replaceChildren();
    tree.appendChild(button('All materials', function() { folder = ''; offset = 0; reload(); }));
    var folders = library.folders || []; var children = {};
    folders.map(function(f) { (children[f.pid] || (children[f.pid] = [])).push(f); });
    Object.keys(children).map(function(pid) { children[pid].sort(function(a, b) { return a.name.localeCompare(b.name); }); });
    var actions = node('div', 'bf-tree-actions');
    actions.appendChild(button('Expand all', function() { folders.map(function(f) { expanded[f.id] = true; }); saveTreeState(); renderTree(); }));
    actions.appendChild(button('Collapse all', function() { expanded = {}; saveTreeState(); renderTree(); })); tree.appendChild(actions);
    function branch(pid, depth, seen) {
      if (depth > 40) return;
      (children[pid] || []).map(function(f) {
        if (seen[f.id]) return; var next = Object.assign({}, seen); next[f.id] = true;
        var row = node('div', 'bf-tree-row'); row.style.paddingLeft = (depth * 16) + 'px';
        var hasChildren = !!children[f.id]; var twist = button(hasChildren ? (expanded[f.id] ? '▾' : '▸') : '·', function(e) { e.stopPropagation(); if (!hasChildren) return; expanded[f.id] = !expanded[f.id]; saveTreeState(); renderTree(); }, 'bf-tree-toggle'); twist.setAttribute('aria-label', hasChildren ? (expanded[f.id] ? t('Collapse folder') : t('Expand folder')) : t('Empty folder')); row.appendChild(twist);
        var btn = button(f.name, function() { folder = f.id; offset = 0; reload(); }, 'bf-user-text bf-tree-name'); btn.title = f.name; row.appendChild(btn); tree.appendChild(row);
        if (hasChildren && expanded[f.id]) branch(f.id, depth + 1, next);
      });
    }
    branch('0', 0, {});
  }
  function saveTreeState() {
    if (!library) return;
    var saved = treeStates; saved[library.uuid] = Object.keys(expanded).filter(function(id) { return !!expanded[id]; });
    call('settings', { patch: { treeStates: saved } }).catch(warn);
  }
  var treeStates = {};
  function useLibrary(lib) {
    if (!panel) return;
    library = lib; folder = ''; offset = 0; expanded = {};
    (treeStates[lib.uuid] || []).map(function(id) { expanded[String(id)] = true; });
    var select = panel.querySelector('#bf-library');
    if (!Array.prototype.some.call(select.options, function(opt) { return opt.value === lib.path; })) { var opt = node('option', 'bf-user-text', lib.name); opt.value = lib.path; opt.dataset.uuid = lib.uuid; select.appendChild(opt); }
    select.value = lib.path;
    panel.querySelector('#bf-library-path').textContent = lib.path + ' · ' + t('Read only'); renderTree(); reload();
    var cards = KanvazCards.getAll(); Object.keys(cards).map(function(id) { if (cards[id].billfishSource && cards[id].billfishSource.libraryUuid === lib.uuid) { var el = document.getElementById(id); if (el && el.billfishReload) el.billfishReload(); } });
  }
  function open() {
    if (panel) return;
    panel = node('div', 'bf-overlay'); panel.id = 'bf-browser'; var box = node('section', 'bf-box'); panel.appendChild(box);
    var header = node('header', 'bf-header'); header.appendChild(node('h2', '', 'Billfish Library'));
    header.appendChild(button('Connect library', function() { call('connect').then(function(lib) { if (!lib.canceled) useLibrary(lib); }).catch(warn); }));
    var select = node('select'); select.id = 'bf-library'; header.appendChild(select);
    select.addEventListener('change', function() { call('connect', { path: select.value }).then(useLibrary).catch(warn); });
    header.appendChild(button('Refresh', function() { if (library) call('refresh', { uuid: library.uuid }).then(useLibrary).catch(warn); }));
    header.appendChild(button('Choose library folder', function() { var opt = select.options[select.selectedIndex]; call('connect', { uuid: opt ? opt.dataset.uuid : undefined }).then(function(lib) { if (!lib.canceled && panel) useLibrary(lib); }).catch(warn); }));
    header.appendChild(button('Close', function() { relinkCard = null; close(); })); box.appendChild(header);
    var status = node('div', 'bf-path bf-user-text'); status.id = 'bf-library-path'; box.appendChild(status);
    var tools = node('div', 'bf-tools'); var search = node('input'); search.id = 'bf-search'; search.placeholder = t('Search file name'); search.type = 'search'; tools.appendChild(search);
    var delay; search.addEventListener('input', function() { clearTimeout(delay); delay = setTimeout(function() { offset = 0; reload(); }, 180); });
    var kind = node('select'); kind.id = 'bf-kind'; [['image', 'Images'], ['video', 'Videos']].map(function(entry) { var option = node('option', '', entry[1]); option.value = entry[0]; kind.appendChild(option); }); kind.addEventListener('change', function() { offset = 0; reload(); }); tools.appendChild(kind);
    var formats = node('select'); formats.id = 'bf-format'; ['', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'svg', 'mp4', 'webm', 'mov', 'mkv', 'avi'].map(function(ext) { var option = node('option', '', ext ? ext.toUpperCase() : 'All formats'); option.value = ext; formats.appendChild(option); }); formats.addEventListener('change', function() { offset = 0; reload(); }); tools.appendChild(formats);
    tools.appendChild(button('Select current results', function() { items.map(function(file) { selection[file.id] = true; }); updateSelection(); }));
    var addButton = button(relinkCard ? 'Relink material' : 'Add to board', confirmSelection, 'primary'); addButton.id = 'bf-add'; addButton.disabled = true; tools.appendChild(addButton); box.appendChild(tools);
    var content = node('div', 'bf-content'); var tree = node('aside'); tree.id = 'bf-tree'; content.appendChild(tree); var grid = node('div'); grid.id = 'bf-grid'; content.appendChild(grid); box.appendChild(content);
    var footer = node('footer', 'bf-tools'); var count = node('span'); count.id = 'bf-count'; footer.appendChild(count);
    var prev = button('Previous page', function() { offset = Math.max(0, offset - 80); reload(); }); prev.id = 'bf-prev'; footer.appendChild(prev);
    var next = button('Next page', function() { offset += 80; reload(); }); next.id = 'bf-next'; footer.appendChild(next); box.appendChild(footer);
    panel.addEventListener('keydown', function(e) { if (e.key === 'Escape') { relinkCard = null; close(); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && e.target.tagName !== 'INPUT') { e.preventDefault(); items.map(function(f) { selection[f.id] = true; }); updateSelection(); } e.stopPropagation(); });
    document.body.appendChild(panel); search.focus();
    call('libraries').then(function(libs) {
      if (!panel) return; libs.map(function(lib) { var opt = node('option', 'bf-user-text', lib.name); opt.value = lib.path; opt.dataset.uuid = lib.uuid; select.appendChild(opt); });
      if (library) useLibrary(library);
      else if (libs.length) call('connect', { path: libs[0].path }).then(useLibrary).catch(warn);
      else call('connect').then(function(lib) { if (!lib.canceled && panel) useLibrary(lib); }).catch(warn);
    }).catch(warn);
  }
  function settings() {
    call('settings').then(function(config) {
      var overlay = node('div', 'bf-overlay'); var box = node('section', 'bf-box bf-settings'); overlay.appendChild(box); box.appendChild(node('h2', '', 'Billfish and board settings'));
      var label = node('label', '', 'Language'); var select = node('select'); ['zh-CN', 'en'].map(function(lang) { var opt = node('option', '', lang === 'en' ? 'English' : '简体中文'); opt.value = lang; select.appendChild(opt); }); select.value = config.language; label.appendChild(select); box.appendChild(label);
      select.addEventListener('change', function() { call('settings', { patch: { language: select.value } }).then(function() { KanvazI18n.setLanguage(select.value); }).catch(warn); });
      box.appendChild(node('label', '', 'Default board save folder')); var save = node('p', 'bf-path bf-user-text', config.defaultSaveDirectory || t('Choose when saving')); box.appendChild(save);
      box.appendChild(button('Choose folder', function() { call('save-directory').then(function(r) { if (!r.canceled) save.textContent = r.defaultSaveDirectory; }).catch(warn); }));
      box.appendChild(node('label', '', '独立缓存目录'));
      var cachePath = node('p', 'bf-path bf-user-text', '正在读取缓存目录…'); cachePath.id = 'cache-directory-path'; box.appendChild(cachePath);
      var cacheStatus = node('p', 'bf-user-text', ''); cacheStatus.id = 'cache-directory-status'; box.appendChild(cacheStatus);
      function showCache(result) {
        if (!result.ok) throw new Error(result.error); if (result.canceled) return;
        cachePath.textContent = result.directory;
        cacheStatus.textContent = result.warning || (result.restartRequired ? '已保存，重启软件后生效。原缓存保留，按需清理。' : '媒体预览和浏览器缓存使用此设置；帧笔记、附件和项目不受影响。');
      }
      KanvazBridge.cacheLocation().then(showCache).catch(warn);
      var chooseCache = button('选择缓存文件夹', function() { KanvazBridge.cacheLocation('choose').then(showCache).catch(warn); }); chooseCache.id = 'btn-choose-cache-directory'; box.appendChild(chooseCache);
      box.appendChild(button('恢复默认缓存目录', function() { KanvazBridge.cacheLocation('reset').then(showCache).catch(warn); }));
      box.appendChild(node('label', '', 'Default Billfish library')); var libPath = node('p', 'bf-path bf-user-text', config.defaultLibrary); box.appendChild(libPath);
      box.appendChild(button('Connect library', function() { call('connect').then(function(r) { if (!r.canceled) { library = r; libPath.textContent = r.path; } }).catch(warn); }));
      box.appendChild(button('Export active board', function() { exportBoard(true); }));
      box.appendChild(button('Export complete package', function() { exportBoard(false); }));
      box.appendChild(node('p', '', 'Linked saves store references. Complete packages embed originals.'));
      box.appendChild(button('Close', function() { overlay.remove(); })); document.body.appendChild(overlay);
    }).catch(warn);
  }
  function exportBoard(activeOnly) {
    var obj = KanvazBoards.serialise();
    if (activeOnly) {
      obj.boards = [obj.boards[obj.activeIdx]]; obj.activeIdx = 0;
      var used = {}; (obj.boards[0].cards || []).map(function(c) { if (c.sharedId) used[c.sharedId] = true; });
      Object.keys(obj.sharedCards || {}).map(function(key) { if (!used[key]) delete obj.sharedCards[key]; });
    }
    call('export', { data: JSON.stringify(obj), linked: !!activeOnly }).then(function(r) { if (r.ok) KanvazUI.toast(t('Exported'), 'success'); }).catch(warn);
  }
  function init() {
    var original = document.getElementById('btn-import');
    if (original) {
      var browse = button('Billfish Library', open, 'toolbar-btn bf-entry'); browse.id = 'btn-billfish'; original.parentNode.insertBefore(browse, original.nextSibling);
      var prefs = button('Board settings', settings, 'toolbar-btn bf-entry'); prefs.id = 'btn-billfish-settings'; browse.parentNode.insertBefore(prefs, browse.nextSibling);
      var info = button('Image info: on', function() { var current = KanvazUI_Extended.getSettings().showImageInfo !== false; KanvazUI_Extended.updateSettings({ showImageInfo: !current }); info.textContent = t('Image info') + ': ' + t(!current ? 'On' : 'Off'); info.setAttribute('aria-pressed', String(!current)); });
      info.id = 'btn-image-info'; info.title = t('Toggle image name and size'); browse.parentNode.insertBefore(info, prefs.nextSibling);
      var videoInfo = button('Video info: on', function() { var current = KanvazUI_Extended.getSettings().showVideoInfo !== false; KanvazUI_Extended.updateSettings({ showVideoInfo: !current }); videoInfo.textContent = t('Video info') + ': ' + t(!current ? 'On' : 'Off'); videoInfo.setAttribute('aria-pressed', String(!current)); });
      videoInfo.id = 'btn-video-info'; videoInfo.title = t('Toggle video name and duration'); browse.parentNode.insertBefore(videoInfo, info.nextSibling);
      var cache = button('Clear media cache', function() { KanvazUI.showDialog('Clear media cache?', 'Unused video and sequence previews will be removed. Active media remains available.', [{ label: 'Cancel' }, { label: 'Clear', cls: 'danger', action: function() { KanvazBridge.clearMediaCache().then(function(r) { KanvazUI.toast(r.ok ? 'Unused media cache cleared' : 'Could not clear media cache', r.ok ? 'success' : 'error'); }).catch(warn); } }]); }, 'toolbar-btn bf-entry'); cache.id = 'btn-clear-media-cache'; browse.parentNode.insertBefore(cache, videoInfo.nextSibling);
    }
    call('settings').then(function(config) {
      treeStates = config.treeStates || {}; KanvazI18n.setLanguage(config.language);
      var uiSettings = KanvazUI_Extended.getSettings(); var info = document.getElementById('btn-image-info'); var videoInfo = document.getElementById('btn-video-info');
      if (info) { info.textContent = t('Image info') + ': ' + t(uiSettings.showImageInfo === false ? 'Off' : 'On'); info.setAttribute('aria-pressed', String(uiSettings.showImageInfo !== false)); }
      if (videoInfo) { videoInfo.textContent = t('Video info') + ': ' + t(uiSettings.showVideoInfo === false ? 'Off' : 'On'); videoInfo.setAttribute('aria-pressed', String(uiSettings.showVideoInfo !== false)); }
      return call('libraries');
    }).then(function(libs) { if (!libs.length) open(); }).catch(warn);
  }
  document.addEventListener('DOMContentLoaded', init);
  return { open: open, settings: settings, add: add, hydrate: hydrate, reference: reference, exportBoard: exportBoard };
})();
