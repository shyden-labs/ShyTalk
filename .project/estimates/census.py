import os, re, json, sys, collections
root = sys.argv[1]
d = os.path.join(root, '.project/stories')
rows = []
for f in sorted(os.listdir(d)):
    if not f.endswith('.md'): continue
    t = open(os.path.join(d, f), encoding='utf-8').read()
    m = re.match(r'^---\n(.*?)\n---\n', t, re.S)
    if not m:
        rows.append({'file': f, 'error': 'no frontmatter'}); continue
    fm = {}
    for line in m.group(1).splitlines():
        mm = re.match(r'^([A-Za-z_]+):\s*(.*)$', line)
        if mm: fm[mm.group(1)] = mm.group(2).strip()
    body = t[m.end():]
    title = next((l[2:].strip() for l in body.splitlines() if l.startswith('# ')), '')
    ac = re.search(r'^## Acceptance Criteria\s*$(.*?)(?=^## )', body, re.S | re.M)
    acs = ac.group(1) if ac else ''
    rows.append({'file': f, 'id': fm.get('id'), 'status': fm.get('status'), 'mvp': fm.get('mvp'),
                 'effort': fm.get('effort'), 'estimate': fm.get('estimate'), 'priority': fm.get('priority'),
                 'type': fm.get('type'), 'title': title,
                 'ac_boxes': len(re.findall(r'^\s*- \[[ xX]\]', acs, re.M)),
                 'ac_chars': len(acs), 'has_ac': bool(ac), 'chars': len(t)})
json.dump(rows, open(sys.argv[2], 'w'), indent=1)
OPEN = {'Draft', 'In Progress', 'In Review'}
c = collections.Counter((r.get('status'), r.get('estimate') is not None) for r in rows)
print('by (status, scored):', sorted(c.items(), key=str))
op = [r for r in rows if r.get('status') in OPEN]
print('open', len(op), 'scored', sum(1 for r in op if r.get('estimate')), 'unscored', sum(1 for r in op if not r.get('estimate')))
un = [r for r in op if not r.get('estimate')]
print('unscored by prefix', collections.Counter(r['file'][:4] for r in un))
print('unscored no AC section', sum(1 for r in un if not r['has_ac']), ' zero boxes', sum(1 for r in un if r['ac_boxes'] == 0))
print('unscored by effort', collections.Counter(r.get('effort') for r in un))
print('unscored by mvp', collections.Counter(r.get('mvp') for r in un))
print('other statuses', collections.Counter(r.get('status') for r in rows if r.get('status') not in OPEN))
