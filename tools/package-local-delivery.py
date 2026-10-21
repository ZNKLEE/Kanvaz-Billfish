"""Package source and verification evidence without dependencies or user profiles."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import zipfile

root = Path(__file__).resolve().parents[1]
delivery = root.parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
prefix = f'Kanvaz-Billfish-ZhCN-{version}'
original = delivery / '4c9878385fbe1862079eddb73d54f381_4799451963459439183_m.zip'
evidence = root / '.tools' / 'review-9.9.1'
exe = root / 'dist' / f'{prefix}-Portable.exe'
assert exe.is_file() and exe.stat().st_size > 100_000_000, 'Portable EXE was not built successfully'
assert json.loads((evidence / 'packaged-results.json').read_text())['checks'], 'Packaged runtime checks are missing'
assert 'ALL CHECKS PASSED' in (evidence / 'validate.log').read_text(encoding='utf-8'), 'Validation did not pass'
results = json.loads((evidence / 'results.json').read_text())
packaged = json.loads((evidence / 'packaged-results.json').read_text())
record = delivery / f'{prefix}-验收记录.md'
record.write_text(
    '# Kanvaz Billfish 9.9.1 验收记录\n\n'
    '日期：2026-10-18。复用用户提供的 9.9.0 包内 Electron 44.4.3 和 FFmpeg，未更换解码器。\n\n'
    '实测使用合成 2048×872 PNG 序列（48 帧、24 fps），与用户报告的格式和尺寸相同；没有使用用户原始生产序列，不能据此保证所有压缩复杂度、帧率和磁盘条件下都达到相同速度。\n\n'
    '源码运行验证覆盖缓存目录真实选择对话框处理、重启生效、默认浏览器缓存改址、媒体解码文件生成于新目录，以及原帧笔记和附件保留。文件夹选择由测试专用启动器提供路径；成品测试运行实际 EXE，使用隔离配置和合成素材。\n\n'
    '完整 validate.js 已通过；可选 MCP 插件端到端测试因未安装该插件自身依赖而按原验证脚本跳过。新增缓存目录单元测试、Billfish 只读/IPC、序列检测与中文翻译测试均通过。\n\n'
    '## 源码运行测量\n\n```json\n' + json.dumps(results['timings'], ensure_ascii=False, indent=2) + '\n```\n\n'
    '## 成品 EXE 测量\n\n```json\n' + json.dumps(packaged['timings'], ensure_ascii=False, indent=2) + '\n```\n\n'
    '## 成品检查\n\n' + '\n'.join('- ' + item for item in packaged['checks']) + '\n\n'
    '完整日志、截图和 JSON 见 Verification.zip。旧 EXE 和原源码 ZIP 保留；更新说明见同目录“更新说明.md”。\n', encoding='utf-8')

def digest(data):
    return hashlib.sha256(data).hexdigest()

fixture = root / 'test' / 'fixtures' / 'frame-step.mp4'
fixture.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(delivery / 'Kanvaz-Billfish-ZhCN-9.9.0-Verification.zip') as old_evidence:
    fixture.write_bytes(old_evidence.read('samples/B-frames.mp4'))
excluded = {'node_modules', '.tools', 'dist', '.git', '__pycache__', 'work'}
files = []
for directory, directories, names in os.walk(root):
    directories[:] = [name for name in directories if name not in excluded]
    files.extend(Path(directory) / name for name in names if name != 'CHANGE_MANIFEST_9.9.1.json')
files.sort()
changes = []
with zipfile.ZipFile(original) as old:
    for p in files:
        rel = p.relative_to(root).as_posix()
        try:
            before = digest(old.read('Kanvaz-Billfish/' + rel))
        except KeyError:
            before = None
        after = digest(p.read_bytes())
        if before != after:
            changes.append({'path': rel, 'beforeSHA256': before, 'afterSHA256': after})
manifest = root / 'CHANGE_MANIFEST_9.9.1.json'
manifest.write_text(json.dumps({'version': version, 'baselineArchiveSHA256': digest(original.read_bytes()), 'changes': changes}, ensure_ascii=False, indent=2), encoding='utf-8')
if manifest not in files:
    files.append(manifest)
with zipfile.ZipFile(delivery / f'{prefix}-Source.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as out:
    for p in files:
        out.write(p, 'Kanvaz-Billfish/' + p.relative_to(root).as_posix())
with zipfile.ZipFile(delivery / f'{prefix}-Verification.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as out:
    out.write(record, record.name)
    for name in ['results.json', 'packaged-results.json', 'notes-panel.png', 'validate.log', 'electron.log']:
        p = evidence / name
        if p.exists():
            out.write(p, name)
    for p in [root / 'docs' / 'CHANGES_9.9.1.md', root / 'test' / 'review-9.9.1.js', root / 'test' / 'cache-location-test.js']:
        out.write(p, p.name)
shutil.copy2(exe, delivery / exe.name)
shutil.copy2(root / 'docs' / 'CHANGES_9.9.1.md', delivery / f'{prefix}-更新说明.md')
artifacts = [delivery / exe.name, delivery / f'{prefix}-Source.zip', delivery / f'{prefix}-Verification.zip']
(delivery / f'{prefix}-SHA256.txt').write_text('\n'.join(f'{digest(p.read_bytes())}  {p.name}' for p in artifacts) + '\n', encoding='utf-8')
for p in artifacts:
    print(f'{p.name}: {p.stat().st_size:,} bytes')
