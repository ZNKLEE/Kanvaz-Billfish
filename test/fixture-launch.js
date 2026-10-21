/* Test-only dialog fixture; never included in the application package. */
var electron = require('electron');
var originalOpen = electron.dialog.showOpenDialog;
electron.dialog.showOpenDialog = function(options) {
  if (options.title === '选择缓存存放目录' && process.env.TEST_CACHE_PARENT) return Promise.resolve({ canceled: false, filePaths: [process.env.TEST_CACHE_PARENT] });
  return originalOpen.apply(electron.dialog, arguments);
};
require('../src/main');
