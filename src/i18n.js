/* Central UI translation layer. Protocol fields and user text remain unchanged. */
var KanvazI18n = (function() {
  var language = typeof KanvazBridge !== 'undefined' ? KanvazBridge.initialLanguage() : 'zh-CN';
  var dictionary = KanvazZhCN; var reverse = {}; var folded = {}; var originals = new WeakMap(); var scheduled = false;
  Object.keys(dictionary).map(function(key) { reverse[dictionary[key]] = key; folded[key.toLowerCase()] = dictionary[key]; });
  function translate(text) {
    if (typeof text !== 'string') return text;
    if (language === 'en') return reverse[text] || text;
    var value = text.trim(); var translated = dictionary[value] || folded[value.toLowerCase()];
    if (translated) return text.replace(value, translated);
    var m = value.match(/^(Cards|Zoom|Pos|Image|Resolution|Format|Opacity|Rotation|Width|Height|Selected|Layer|Board|Autosave|Search|Name|Type|Size|Version)(\s*[:·]\s*)(.*)$/);
    if (m) return translate(m[1]) + m[2] + m[3];
    m = value.match(/^(\d+) (cards?|selected|connections?|references?|boards?|files?|results?|materials?)(.*)$/i);
    if (m) return m[1] + ' ' + translate(m[2]) + m[3];
    m = value.match(/^(Outgoing|Incoming|Align) \((.*)\)$/); if (m) return translate(m[1]) + '（' + translate(m[2]) + '）';
    m = value.match(/^(New|Open|Save|Import|Export|Delete|Rename|Copy) (.+)$/); if (m && dictionary[m[2]]) return translate(m[1]) + translate(m[2]);
    m = value.match(/^(.*)(…|\.\.\.)$/); if (m && (dictionary[m[1]] || folded[m[1].toLowerCase()])) return translate(m[1]) + '…';
    m = value.match(/^Good (morning|afternoon|evening), (.*)$/); if (m) return ({ morning: '早上好', afternoon: '下午好', evening: '晚上好' })[m[1]] + '，' + translate(m[2]);
    m = value.match(/^Browse all \((\d+)\) →$/); if (m) return '浏览全部（' + m[1] + '）→';
    m = value.match(/^Board (\d+)$/); if (m) return '素材板 ' + m[1];
    m = value.match(/^Image fit: (Contain|Cover) \(click to switch\)$/); if (m) return '图片适配：' + translate(m[1]) + '（点击切换）';
    m = value.match(/^(Could not [^:]+|Settings|Audio|Video|GIF|Board)([:·]\s*)(.*)$/); if (m && (dictionary[m[1]] || folded[m[1].toLowerCase()])) return translate(m[1]) + m[2] + m[3];
    m = value.match(/^Kanvaz found an unsaved board from (.+) — (\d+) boards?, (\d+) cards? total\. Restore it\?$/); if (m) return '发现' + translate(m[1]) + '的未保存素材板，共 ' + m[2] + ' 个素材板、' + m[3] + ' 张卡片。是否恢复？';
    m = value.match(/^Remove "(.+)" from the canvas\?$/); if (m) return '从画布移除「' + m[1] + '」？';
    m = value.match(/^(Add subtask|Part of a group) \((.*)\)$/); if (m) return translate(m[1]) + '（' + m[2] + '）';
    m = value.match(/^(\d+) (seconds?|minutes?|hours?|days?) ago$/); if (m) return m[1] + ({ second: '秒', seconds: '秒', minute: '分钟', minutes: '分钟', hour: '小时', hours: '小时', day: '天', days: '天' })[m[2]] + '前';
    m = value.match(/^(\d+) (sec|min|hr|d) ago$/); if (m) return m[1] + ({ sec: '秒', min: '分钟', hr: '小时', d: '天' })[m[2]] + '前';
    var prefixKeys = ['Boot error', 'Save failed', 'Preview failed', 'Reset failed', 'Could not load template', 'Could not load that image', 'Could not open file picker', 'Could not export profile', 'Could not import profile', 'Could not save profile picture', 'Could not save template', 'Grid style', 'Theme', 'Exported as', 'Started board from', 'Saved Smart Folder', 'Shared to', 'Loaded', 'Imported', 'Exported', 'Saved', 'Copied'];
    for (var k = 0; k < prefixKeys.length; k++) { var prefix = prefixKeys[k]; if (value.indexOf(prefix + ':') === 0 || value.indexOf(prefix + ' "') === 0 || value.indexOf(prefix + ' —') === 0) return translate(prefix) + value.slice(prefix.length); }
    m = value.match(/^(\d{4}-\d{2}-\d{2}) — (.*)$/); if (m && dictionary[m[2]]) return m[1] + ' — ' + dictionary[m[2]];
    return text;
  }
  function excluded(el) {
    return !el || !!el.closest('script,style,textarea,[contenteditable="true"],[data-i18n-ignore],.bf-user-text,.card-bar-title,.card-name,.note-content,.text-content,[data-layer-name-for],.board-name,.tag-chip,.property-value,.profile-name,#dialog-input');
  }
  function update(el) {
    if (!el || excluded(el)) return;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var textNode;
    while ((textNode = walker.nextNode())) {
      if (excluded(textNode.parentElement)) continue;
      var record = originals.get(textNode); var current = textNode.nodeValue;
      if (!record || current !== record.rendered) record = { source: reverse[current] || current, rendered: current };
      var next = translate(record.source); record.rendered = next; originals.set(textNode, record); if (next !== current) textNode.nodeValue = next;
    }
    var elements = [el].concat(Array.prototype.slice.call(el.querySelectorAll('[title],[placeholder],[aria-label],[data-tooltip]')));
    elements.map(function(item) {
      if (excluded(item)) return;
      ['title', 'placeholder', 'aria-label', 'data-tooltip'].map(function(attr) {
        if (!item.hasAttribute(attr)) return;
        var key = 'data-i18n-' + attr; var current = item.getAttribute(attr); var source = item.getAttribute(key);
        if (!source || (current !== translate(source) && current !== source)) { source = reverse[current] || current; item.setAttribute(key, source); }
        var next = translate(source); if (current !== next) item.setAttribute(attr, next);
      });
    });
  }
  var pendingRoots = new Set();
  function scan() { scheduled = false; pendingRoots.clear(); update(document.body); }
  function scanChanged() {
    scheduled = false; var roots = Array.from(pendingRoots); pendingRoots.clear();
    roots.filter(function(root) { return root.isConnected && !roots.some(function(other) { return other !== root && other.contains(root); }); }).map(update);
  }
  function setLanguage(value) { language = value === 'en' ? 'en' : 'zh-CN'; document.documentElement.lang = language; if (document.body) scan(); }
  document.addEventListener('DOMContentLoaded', function() {
    scan();
    new MutationObserver(function(records) {
      records.map(function(record) {
        var root = record.target.nodeType === 3 ? record.target.parentElement : record.target;
        if (!excluded(root)) pendingRoots.add(root);
      });
      if (pendingRoots.size && !scheduled) { scheduled = true; setTimeout(scanChanged, 30); }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label', 'data-tooltip'] });
  });
  return { t: translate, setLanguage: setLanguage, getLanguage: function() { return language; }, update: update, dictionary: dictionary };
})();
