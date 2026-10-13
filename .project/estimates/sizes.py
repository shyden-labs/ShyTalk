# Hand-written lines changed per story, summed over every squash-merged PR on develop naming it.
import re, subprocess, sys, json, collections
merged = [l.rstrip('\n').split('|', 2) for l in open(sys.argv[1]) if l.strip()]
EXCL = re.compile(r'(^\.project/)|(\.md$)|(\.mdx$)|(package-lock\.json$)|(yarn\.lock$)|(Podfile\.lock$)|(\.lock$)|(\.snap$)|(__snapshots__/)|(-snapshots/)|(\.png$)|(\.jpg$)|(generated)|(\.min\.)|(board-items\.json$)|(roadmap-data)|(/values-[a-z]{2}(-r?[A-Z]{2})?/strings\.xml$)')
per = collections.defaultdict(lambda: {'lines': 0, 'prs': [], 'latest': ''})
for sha, date, subj in merged:
    ids = sorted(set(re.findall(r'SHY-\d{4}', subj)))
    if not ids: continue
    out = subprocess.run(['git', 'show', '--numstat', '--format=', sha], capture_output=True, text=True, check=True).stdout
    n = 0
    for line in out.splitlines():
        a, b, path = line.split('\t', 2)
        if a == '-' or EXCL.search(path): continue
        n += int(a) + int(b)
    pr = re.search(r'\(#(\d+)\)$', subj).group(1)
    for i in ids:
        per[i]['lines'] += n; per[i]['prs'].append(pr); per[i]['latest'] = max(per[i]['latest'], date)
json.dump(per, open(sys.argv[2], 'w'), indent=1)
rows = sorted(per.items(), key=lambda kv: kv[1]['latest'], reverse=True)
print('stories named', len(rows), 'with code', sum(1 for _, v in rows if v['lines'] > 0))
for k, v in [r for r in rows if r[1]['lines'] > 0][:30]:
    print(k, v['latest'], v['lines'], ','.join(v['prs']))
