# Story-point estimates: how the backlog was scored

SHY-0536 (open MVP stories) and SHY-0537 (every other open story) give each open
story an `estimate:` on the Fibonacci scale 1, 2, 3, 5, 8, 13. The board's
`Estimate` field is synced from it, and the "by effort" progress line sums it.

## Files

| File | What it is |
| --- | --- |
| `scores-mvp.tsv` | Every MVP story scored by SHY-0536: id, points, status, and the reason or merged story it was compared with |
| `census.py` | Reads every story's frontmatter and criteria size into JSON |
| `sizes.py` | Hand-written lines changed per story, summed over every squash-merged PR naming it |
| `calib.py` | Spearman rank correlation of points against those lines, with every disagreement over one step flagged |
| `calibration.txt` | `calib.py`'s output for the sample below |
| `apicheck.py` | Reads every sample PR through `gh api …/files --paginate` and compares its total with `git show --numstat` |
| `merged-prs.txt` | The input to `sizes.py`: `git log origin/develop --first-parent --since=2026-07-01 --format='%h\|%cs\|%s'`, kept to `(#N)` subjects, no Dependabot |

Re-run from the repository root: `python3 -I .project/estimates/sizes.py .project/estimates/merged-prs.txt sizes.json`,
`python3 -I .project/estimates/census.py . census.json` (run it on the tree BEFORE the scores were applied, or
every sample story reads as previously scored), then
`python3 -I .project/estimates/calib.py sizes.json census.json <id-points-reason.tsv> 25`.

## Method

- Each score comes from the story's acceptance criteria, compared with merged
  stories of the same shape, never from guessed hours. The filing-time `effort:`
  was a prior, not the answer: every story already scored before this pass
  mapped XS→1, S→2–3, M→3–5, L→8, XL→13.
- A story larger than 13 is not given a number. One was found, SHY-0062 (94
  roadmap entries); Shyden chose to split it into eight batch stories,
  SHY-0575 to SHY-0582, and SHY-0062 is Cancelled.
- Lines changed were read with `git show --numstat` on each squash commit, which
  has no file cap, rather than `gh api …/pulls/<n>/files` (one squash commit per
  PR, so the file list is the same). Lock files, generated files, snapshots,
  images, translated string tables, `.project/**` and Markdown are left out.
- Cross-check: all 43 PRs behind the calibration sample were also read through
  `gh api repos/shyden-labs/ShyTalk/pulls/<n>/files --paginate`. 42 totals match
  `git show --numstat` exactly. #2086 (SHY-0491) does not: the API lists 448
  lines including `SignOutCoordinator` files that belong to SHY-0494, because
  #2086 was stacked on that story's branch; its squash commit landed 90. The
  squash commit is what merged, so 90 is used.

## Calibration (2026-10-12)

- Sample: the 25 most recent stories with code merged into `develop`, from
  SHY-0535 (2026-10-13) back to SHY-0490 (2026-08-28). One Draft story with
  partial code (SHY-0495) was left out.
- **Spearman rank correlation 0.765.**
- Six sample scores were set before this pass (SHY-0535, 0565, 0568, 0572, 0544,
  0545). The other 19 were set in this pass **after** their line counts had been
  seen, so 0.765 is optimistic and is quoted as such.
- Three stories disagree with their size by more than one step, all re-read and
  kept: SHY-0289 (40,505 lines deleted retiring locales), SHY-0448 (a formatter
  rewrite, 5,859 added and 4,007 deleted), SHY-0470 (833 lines of a dead API
  deleted). Deletions and formatter runs are cheap per line.

## Spread re-read

After the first pass, 15 open MVP stories were re-read with their whole
acceptance criteria: five each scored 1–2, 3–5 and 8–13.

| Band | Stories |
| --- | --- |
| 1–2 | SHY-0047, 0390, 0043, 0353, 0502 |
| 3–5 | SHY-0364, 0391, 0009, 0336, 0017 |
| 8–13 | SHY-0337, 0405, 0024, 0212, 0218 |

**Four were corrected, all upward by one step:** SHY-0047 1→2, SHY-0391 3→5,
SHY-0009 3→5, SHY-0336 5→8. The first pass read only the first 700 characters
of each story's criteria and under-read long error and edge sections. Read the
remaining total as a floor rather than a point estimate: a quarter of the
re-read sample moved up and none moved down.

SHY-0212 and SHY-0218 sit at the 13 ceiling and should be split at pickup if
they grow. SHY-0017 waits on the open No-Stubs harness decision its own
criteria name.
