# For every PR in the calibration sample: hand-written lines via gh api --paginate vs git show --numstat.
import json, re, subprocess, sys
sizes = json.load(open(sys.argv[1])); sample = [l.split()[0] for l in open(sys.argv[2]) if l.startswith('SHY-')]
EXCL = re.compile(r'(^\.project/)|(\.md$)|(\.mdx$)|(package-lock\.json$)|(yarn\.lock$)|(Podfile\.lock$)|(\.lock$)|(\.snap$)|(__snapshots__/)|(-snapshots/)|(\.png$)|(\.jpg$)|(generated)|(\.min\.)|(board-items\.json$)|(roadmap-data)|(/values-[a-z]{2}(-r?[A-Z]{2})?/strings\.xml$)')
merged = {re.search(r'\(#(\d+)\)$', l).group(1): l.split('|')[0] for l in open(sys.argv[3]) if re.search(r'\(#(\d+)\)$', l.strip())}
prs = sorted({p for s in sample for p in sizes[s]['prs']}, key=int); diff = []
for pr in prs:
    api = json.loads(subprocess.run(['gh', 'api', '--paginate', '--slurp', f'repos/shyden-labs/ShyTalk/pulls/{pr}/files'], capture_output=True, text=True, check=True).stdout)
    files = [f for page in api for f in page]
    a = sum(f['additions'] + f['deletions'] for f in files if not EXCL.search(f['filename']))
    g = 0
    for line in subprocess.run(['git', 'show', '--numstat', '--format=', merged[pr]], capture_output=True, text=True, check=True).stdout.splitlines():
        x, y, path = line.split('\t', 2)
        if x != '-' and not EXCL.search(path): g += int(x) + int(y)
    if a != g: diff.append((pr, len(files), a, g))
print(f'PRs read through gh api --paginate: {len(prs)}; totals that differ from git numstat: {diff}')
