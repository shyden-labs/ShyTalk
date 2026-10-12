# Spearman rank correlation: points vs hand-written lines, over the most recent stories with merged code.
import json, sys
sizes = json.load(open(sys.argv[1])); census = {r['id']: r for r in json.load(open(sys.argv[2])) if r.get('id')}
mine = {l.split('\t')[0]: int(l.split('\t')[1]) for l in open(sys.argv[3]) if l.strip()}
N = int(sys.argv[4])
rows = []
for sid, v in sorted(sizes.items(), key=lambda kv: kv[1]['latest'], reverse=True):
    if v['lines'] == 0: continue
    c = census.get(sid, {})
    if c.get('status') == 'Draft': print('skip (Draft, partial code):', sid); continue
    pts = int(c['estimate']) if c.get('estimate') else mine.get(sid)
    src = 'prior' if c.get('estimate') else 'this pass'
    if pts is None: print('skip (no score; closed story):', sid, c.get('status')); continue
    rows.append((sid, pts, v['lines'], src))
    if len(rows) == N: break
def ranks(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i]); r = [0.0] * len(xs); i = 0
    while i < len(xs):
        j = i
        while j + 1 < len(xs) and xs[order[j + 1]] == xs[order[i]]: j += 1
        for k in range(i, j + 1): r[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return r
a, b = ranks([r[1] for r in rows]), ranks([r[2] for r in rows])
ma, mb = sum(a) / len(a), sum(b) / len(b)
cov = sum((x - ma) * (y - mb) for x, y in zip(a, b)); sa = sum((x - ma) ** 2 for x in a) ** .5; sb = sum((y - mb) ** 2 for y in b) ** .5
print(f'n={len(rows)} spearman={cov / (sa * sb):.3f}')
FIB = [1, 2, 3, 5, 8, 13]
# lines -> implied step by sample quantile of lines, compare with points step
ls = sorted(r[2] for r in rows)
for sid, p, l, src in rows:
    q = sum(1 for x in ls if x < l) / len(ls); implied = FIB[min(5, int(q * 5.999))]
    flag = ' <-- >1 step' if abs(FIB.index(p) - FIB.index(implied)) > 1 else ''
    print(f'{sid} pts={p:>2} lines={l:>5} implied~{implied:>2} {src}{flag}')
