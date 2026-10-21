/* Native OS dialogs share the same UI dictionary. Paths are never translated. */
var dictionary = require('./i18n-zh-cn');
function install(dialog, store) {
  var reverse = {}; Object.keys(dictionary).map(function(key) { reverse[dictionary[key]] = key; });
  function translate(value) {
    if (typeof value !== 'string') return value;
    if (store.settings.language === 'en') return reverse[value] || value;
    if (dictionary[value]) return dictionary[value];
    var base = value.replace(/…|\.\.\.$/g, '');
    if (dictionary[base]) return dictionary[base] + (base === value ? '' : '…');
    return value;
  }
  ['showOpenDialog', 'showSaveDialog', 'showMessageBox', 'showMessageBoxSync'].map(function(method) {
    var original = dialog[method];
    dialog[method] = function() {
      var args = Array.prototype.slice.call(arguments); var index = args.length === 1 ? 0 : 1; var options = Object.assign({}, args[index]);
      ['title', 'message', 'detail', 'checkboxLabel'].map(function(key) { if (options[key]) options[key] = translate(options[key]); });
      if (options.buttons) options.buttons = options.buttons.map(translate);
      if (options.filters) options.filters = options.filters.map(function(filter) { return Object.assign({}, filter, { name: translate(filter.name) }); });
      args[index] = options; return original.apply(dialog, args);
    };
  });
  var errorBox = dialog.showErrorBox;
  dialog.showErrorBox = function(title, content) { return errorBox.call(dialog, translate(title), translate(content)); };
}
module.exports = { install: install };
