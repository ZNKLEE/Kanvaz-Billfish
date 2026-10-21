/* Restart semantics and data separation for the independent cache setting. */
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { create } = require('../src/cache-location');
const root = fs.mkdtempSync(path.join(require('os').tmpdir(),'kanvaz-cache-test-'));
const data = path.join(root,'profile'), parent = path.join(root,'chosen');
fs.mkdirSync(data,{recursive:true}); fs.writeFileSync(path.join(data,'notes-sentinel'),'keep');
function app() { return { paths:{userData:data},getPath(name){return this.paths[name];},setPath(name,value){this.paths[name]=value;} }; }
const first=create(app()); assert(!first.status().restartRequired);
const choice=first.set(parent); assert(choice.restartRequired); assert.equal(first.media(),path.join(data,'media-cache'));
const secondApp=app(), second=create(secondApp); assert(!second.status().restartRequired); assert.equal(secondApp.paths.sessionData,path.join(parent,'Kanvaz-Cache','browser-cache'));
assert.equal(second.media(),path.join(parent,'Kanvaz-Cache','media-cache'));
assert.equal(second.set(path.join(parent,'Kanvaz-Cache')).directory,path.join(parent,'Kanvaz-Cache'));
assert.equal(fs.readFileSync(path.join(data,'notes-sentinel'),'utf8'),'keep');
assert.throws(()=>second.set('relative'),/本地/);
const conflict=path.join(root,'file-parent'); fs.writeFileSync(conflict,'x'); assert.throws(()=>second.set(conflict));
assert.equal(second.status().directory,path.join(parent,'Kanvaz-Cache'));
second.set(null); const resetApp=app(), reset=create(resetApp); assert(!reset.status().restartRequired); assert(!resetApp.paths.sessionData); assert.equal(reset.media(),path.join(data,'media-cache'));
fs.writeFileSync(path.join(data,'cache-location.json'),'{broken'); const broken=create(app()); assert(broken.status().warning); assert.equal(broken.media(),path.join(data,'media-cache'));
console.log('PASS: cache selection, restart, existing folder, rejected paths, failed writes, default reset and malformed-config fallback; data remains untouched.');
