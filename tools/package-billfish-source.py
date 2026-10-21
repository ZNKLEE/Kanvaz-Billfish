"""Create a source-only archive and traceable modification manifest."""
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent
GIT = r'C:\Users\AAA\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe'

def git(*args):
    return subprocess.check_output([GIT, *args], cwd=ROOT)

def digest(data):
    return hashlib.sha256(data).hexdigest()

baseline = git('rev-parse', 'HEAD').decode().strip()
files = sorted(set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').decode().split('\0')) - {''})
changes = []
for name in files:
    source = ROOT / name
    if not source.is_file() or name == 'MODIFICATION_MANIFEST.json':
        continue
    current = source.read_bytes()
    previous = subprocess.run([GIT, 'show', baseline + ':' + name], cwd=ROOT, capture_output=True)
    if previous.returncode != 0 or previous.stdout != current:
        changes.append({'file': name, 'baselineSha256': digest(previous.stdout) if previous.returncode == 0 else None, 'deliverySha256': digest(current)})
manifest = ROOT / 'MODIFICATION_MANIFEST.json'
manifest.write_text(json.dumps({'upstreamCommit': baseline, 'branch': git('branch', '--show-current').decode().strip(), 'scope': 'Independent Kanvaz fork; no Billfish installation or library files modified', 'files': changes}, ensure_ascii=False, indent=2), encoding='utf-8')
version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
archive = ROOT / 'dist' / ('Kanvaz-Billfish-ZhCN-' + version + '-Source.zip')
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
    for name in sorted(set(files + ['MODIFICATION_MANIFEST.json'])):
        source = ROOT / name
        if source.is_file():
            assert not any(part in ('.git', '.tools', 'node_modules', 'dist') for part in Path(name).parts)
            output.write(source, 'Kanvaz-Billfish/' + name)
with zipfile.ZipFile(archive, 'r') as check:
    assert check.testzip() is None
print('Source archive:', archive, 'files:', len(files) + 1, 'changed:', len(changes))
