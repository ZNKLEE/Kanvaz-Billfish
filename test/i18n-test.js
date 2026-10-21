const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert');
const dictionary = require('../src/i18n-zh-cn');
const context = { KanvazZhCN: dictionary, KanvazBridge: { initialLanguage: () => 'zh-CN' }, document: { addEventListener() {}, documentElement: {}, body: null }, console };
vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n.js'), 'utf8'), context);
const t = context.KanvazI18n.t;
const core = ['New Board', 'Save Board', 'Save Board As…', 'Open Board…', 'Settings', 'Layers', 'Properties', 'Undo', 'Redo', 'Fit all cards', 'Delete', 'Bring to Front', 'Send to Back', 'Rotation', 'Import', 'Plugin Manager', 'Show minimap', 'Files & Search', 'Canvas & Input', 'Language', 'Billfish Library', 'Add to board', 'Relink material', 'Default board save folder', 'Board could not be saved.', 'Check disk space and file permissions, then try Save As to a different location.'];
for (const text of core) assert(/[\u3400-\u9fff]/.test(t(text)), 'Chinese translation: ' + text);
const manifest = require('../assets/templates/manifest.json'); for (const entry of manifest) { assert(dictionary[entry.name]); assert(dictionary[entry.description]); }
assert.equal(t('Image · 4096 × 3072'), '图片 · 4096 × 3072'); assert.equal(t('Good morning, My Profile'), '早上好，我的配置');
assert.equal(t('user-file-unchanged.png'), 'user-file-unchanged.png');
assert.equal(t('Billfish.Plugin.IBaseModulePlugin/1.0'), 'Billfish.Plugin.IBaseModulePlugin/1.0');
context.KanvazI18n.setLanguage('en'); assert.equal(t('Billfish Library'), 'Billfish Library'); assert.equal(t('素材已丢失'), 'Material missing');
assert.equal(fs.readFileSync(path.join(__dirname, '..', 'LICENSE'), 'utf8').includes('Atharva Patil'), true);
console.log('PASS: ' + Object.keys(dictionary).length + ' centralized Chinese entries, all core UI samples, all built-in template names/descriptions, dynamic counters, English switching, protocol/file strings unchanged.');
