#!/usr/bin/env bash
# sync-start-commit.sh — where a push sync of the story board starts (SHY-0691).
#
# The sync workflow queues its runs (`queue: max`), and GitHub still cancels a
# run that finds the queue full. So a push never syncs from its own `before`:
# it syncs from the last commit a sync COMPLETED on develop, and a run lost for
# any reason is covered by the next one.
#
# The last completed sync is the head of the newest successful push or
# scheduled run of this workflow on develop. Dispatches never count (dry runs
# and rebuilds). The run asking is still in progress, so it never counts
# itself.
#
# Usage: scripts/sync-start-commit.sh <head-sha>
#   Needs GITHUB_REPOSITORY and a token gh can use (GH_TOKEN) with
#   actions: read and contents: read.
#
# Prints exactly one line on stdout:
#   range <sha>     sync --changed <sha> <head-sha>
#   covered         a newer sync already covered <head-sha>: sync nothing
#   full <reason>   sync --all
# and on stderr where the start came from.
#
# Exit codes:
#   0  one of the lines above
#   1  a gh call failed or answered something unreadable (::error:: names it)
#   2  usage: <head-sha> is not a full SHA, or GITHUB_REPOSITORY is unset
set -euo pipefail

WORKFLOW_FILE="sync-stories-to-issues.yml"
SHA_RE='^[0-9a-f]{40}$'

die() {
  printf '::error::sync-start-commit: %s\n' "$1" >&2
  exit "${2:-1}"
}

head_sha="${1:-}"
[[ "$head_sha" =~ $SHA_RE ]] || die "usage: sync-start-commit.sh <head-sha> (a full 40-hex SHA), got '${head_sha}'" 2
[ -n "${GITHUB_REPOSITORY:-}" ] || die "GITHUB_REPOSITORY is not set" 2

runs_call="repos/${GITHUB_REPOSITORY}/actions/workflows/${WORKFLOW_FILE}/runs?branch=develop&status=success&per_page=50"
runs_json="$(gh api "$runs_call")" || die "the runs call failed: gh api ${runs_call}"

# Newest first: the first match is the last completed sync. The query already
# asks for successful develop runs; the filter checks each again, so a run in
# progress (this one) or on another branch can never be taken.
last="$(jq -r '
  [ .workflow_runs[]
    | select((.event == "push" or .event == "schedule")
             and .head_branch == "develop"
             and .status == "completed"
             and .conclusion == "success") ]
  | .[0] // empty
  | "\(.head_sha) \(.id) \(.event)"
' <<<"$runs_json")" || die "the runs call answered something unreadable: gh api ${runs_call}"

if [ -z "$last" ]; then
  echo "sync-start-commit: no completed push or schedule sync among the newest 50 successful runs" >&2
  echo "full no completed sync found"
  exit 0
fi

read -r start_sha run_id run_event <<<"$last"
[[ "$start_sha" =~ $SHA_RE ]] \
  || die "the runs call answered a head_sha that is not a full SHA: '${start_sha}' (gh api ${runs_call})"
echo "sync-start-commit: last completed sync is ${start_sha} (run ${run_id}, ${run_event})" >&2

compare_call="repos/${GITHUB_REPOSITORY}/compare/${start_sha}...${head_sha}"
compare_json="$(gh api "$compare_call")" || die "the compare call failed: gh api ${compare_call}"
status="$(jq -r '.status // empty' <<<"$compare_json")" \
  || die "the compare call answered something unreadable: gh api ${compare_call}"

case "$status" in
  ahead)
    echo "range ${start_sha}"
    ;;
  identical | behind)
    echo "sync-start-commit: compare says ${status}: the last completed sync already contains ${head_sha}" >&2
    echo "covered"
    ;;
  diverged)
    echo "full ${start_sha} is not an ancestor of ${head_sha}"
    ;;
  *)
    die "the compare call answered an unknown status '${status}': gh api ${compare_call}"
    ;;
esac
