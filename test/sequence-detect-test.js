const assert = require('assert');
const detect = require('../src/sequence-detect').detect;
function records(names) { return names.map(path => ({ path })); }
let groups = detect(records(['shot_0001.png', 'shot_0002.png', 'shot_0004.png', 'other_01.jpg']));
assert.equal(groups.length, 1); assert.deepEqual(groups[0].frames.map(f => f.number), [1, 2, 4]); assert.deepEqual(groups[0].missing, [3]);
groups = detect(records(['A_10.exr', 'A_2.exr', 'A_1.exr', 'B-0001.dpx', 'B-0002.dpx']));
assert.equal(groups.length, 2); assert.deepEqual(groups[0].frames.map(f => f.number), [1, 2, 10]);
groups = detect(records(['x01.png', 'x1.png', 'x02.png'])); assert.equal(groups.length, 1); assert.deepEqual(groups[0].duplicates, [1]); assert.equal(groups[0].frames.length, 1);
for (const ext of ['png','jpg','jpeg','webp','tif','tiff','exr','dpx']) assert.equal(detect(records(['f_1.' + ext, 'f_2.' + ext])).length, 1, ext);
assert.equal(detect(records(['one1.png'])).length, 0);
console.log('PASS: sequence detection, numeric sorting, missing/duplicate numbering, multi-group files, and PNG/JPEG/WebP/TIFF/EXR/DPX extensions.');
