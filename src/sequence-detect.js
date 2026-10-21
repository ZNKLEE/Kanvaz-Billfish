/* Shared filename-based image sequence detection (no source files are changed). */
(function() {
  'use strict';
  var EXT = { png: 1, jpg: 1, jpeg: 1, bmp: 1, tga: 1, webp: 1, tif: 1, tiff: 1, exr: 1, dpx: 1 };
  function detect(files, fieldFromRight) {
    if (fieldFromRight === undefined) {
      var candidates = [], claimed = {}, slots = 0;
      for (var si = 0; si < files.length; si++) {
        var parts = String(files[si] && files[si].path || '').split(/[\\/]/).pop().replace(/\.[^.]*$/, '').match(/\d+/g);
        slots = Math.max(slots, Math.min(20, parts ? parts.length : 0));
      }
      for (var field = 0; field < slots; field++) {
        detect(files, field).map(function(group) {
          if (group.files.some(function(f) { return claimed[f.path.toLowerCase()]; })) return;
          candidates.push(group); group.files.map(function(f) { claimed[f.path.toLowerCase()] = true; });
        });
      }
      return candidates;
    }
    var groups = {};
    for (var fileIndex = 0; fileIndex < files.length; fileIndex++) {
      var file = files[fileIndex];
      var p = file && file.path; if (!p) continue;
      var base = p.split(/[\\/]/).pop(); var dot = base.lastIndexOf('.'); if (dot < 1) continue;
      var ext = base.slice(dot + 1).toLowerCase(); if (!EXT[ext]) continue;
      var stem = base.slice(0, dot), matches = Array.from(stem.matchAll(/\d+/g));
      var selected = matches[matches.length - 1 - (fieldFromRight || 0)]; if (!selected) continue;
      var m = [stem, stem.slice(0, selected.index), selected[0], stem.slice(selected.index + selected[0].length)];
      if (!Number.isSafeInteger(Number(m[2]))) continue;
      var dir = p.slice(0, p.length - base.length).toLowerCase();
      var key = dir + '\0' + ext + '\0' + m[1].toLowerCase() + '\0' + m[3].toLowerCase();
      if (!groups[key]) groups[key] = { name: m[1] + m[3], files: [], pad: m[2].length, framesByNum: {} };
      var g = groups[key]; var number = Number(m[2]); var record = { path: p, file: file, number: number, label: m[2], fieldFromRight: fieldFromRight || 0 };
      g.files.push(file);
      if (g.framesByNum[number]) g.framesByNum[number].push(record); else g.framesByNum[number] = [record];
    }
    return Object.keys(groups).map(function(key) {
      var g = groups[key]; if (g.files.length < 2) return null;
      var numbers = Object.keys(g.framesByNum).map(Number).sort(function(a, b) { return a - b; });
      var duplicates = numbers.filter(function(n) { return g.framesByNum[n].length > 1; });
      var frames = numbers.filter(function(n) { return g.framesByNum[n].length === 1; }).map(function(n) { return g.framesByNum[n][0]; });
      var missing = [], missingCount = 0;
      for (var ni = 1; ni < numbers.length; ni++) {
        var gap = numbers[ni] - numbers[ni - 1] - 1; missingCount += gap;
        for (var n = numbers[ni - 1] + 1; n < numbers[ni] && missing.length < 5000; n++) missing.push(n);
      }
      return { name: g.name, files: g.files, frames: frames, missing: missing, missingCount: missingCount, duplicates: duplicates,
        range: numbers[0] + '–' + numbers[numbers.length - 1] };
    }).filter(Boolean);
  }
  function resolveGroups(files, complete, fieldFromRight) {
    var groups = detect(files, fieldFromRight); var used = {}; var accepted = []; var index = 0;
    function next() {
      if (index >= groups.length) { complete(files.filter(function(file) { return !used[file.path.toLowerCase()]; }), accepted); return; }
      var group = groups[index++];
      var message = '检测到图片序列「' + group.name + '」：' + group.frames.length + ' 帧（' + group.range + '）' +
        (group.missingCount ? '，缺失 ' + group.missingCount + ' 帧：' + group.missing.slice(0, 40).join(', ') + (group.missingCount > 40 ? '…' : '') + '（确认后按已有文件连续播放）' : '') +
        '\n帧号字段：从右起第 ' + ((group.frames[0] && group.frames[0].fieldFromRight || 0) + 1) + ' 组数字。首帧：' + (group.frames[0] && group.frames[0].path.split(/[\\/]/).pop() || '重复编号') +
        (group.duplicates.length ? '，重复编号 ' + group.duplicates.join(', ') + '，此组不能创建序列。' : '');
      if (group.duplicates.length) {
        KanvazUI.showDialog('识别到图片序列', message, [{ label: '按独立图片导入', cls: 'primary', action: next }]); return;
      }
      KanvazUI.showDialog('识别到图片序列', message, [
        { label: '取消导入', action: function() { complete([], []); } },
        { label: '按独立图片导入', action: next },
        { label: '修改帧号字段', action: function() { KanvazUI.showPrompt('帧号字段', '从右起第几组数字？例如 S03_C1700_v004_1001 默认填 1', String((fieldFromRight || 0) + 1), function(value) { var field = Number(value); if (!Number.isInteger(field) || field < 1 || field > 20) field = 1; resolveGroups(files, complete, field - 1); }); } },
        { label: '作为序列', cls: 'primary', action: function() { var last = '24'; try { last = localStorage.getItem('kanvaz-sequence-fps') || last; } catch (_) {} KanvazUI.showPrompt('设置序列帧率', '1–120 fps；常用 12、24、25、30、48、50、60；支持 24000/1001', last, function(value) {
          var rate = KanvazFrames.parseRate(value);
          if (!rate) { KanvazUI.toast('帧率无效，此组未导入', 'error'); next(); return; }
          try { localStorage.setItem('kanvaz-sequence-fps', value); } catch (_) {}
          for (var fi = 0; fi < group.files.length; fi++) used[group.files[fi].path.toLowerCase()] = true;
          accepted.push({ group: group, fps: rate.num / rate.den }); next();
        }, next); } }
      ]);
    }
    if (groups.length) next(); else complete(files, accepted);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { detect: detect };
  if (typeof window !== 'undefined') window.KanvazSequences = { detect: detect, resolveGroups: resolveGroups };
}());
