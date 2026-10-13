/**
 * check-orphaned-stories.test.js — SHY-0583.
 *
 * A story that says In Progress must have an open pull request or a remote
 * branch naming its id; otherwise it is an orphan and goes back to the backlog
 * (Shyden, 2026-10-13). These tests load the script in-process and call its pure
 * functions: no git, no network, no child process.
 */
const {
  inProgressStories,
  findOrphans,
  parseHeads,
} = require('../../../scripts/check-orphaned-stories.js');

const file = (id, status) => ({
  file: `.project/stories/${id}-x.md`,
  text: `---\nid: ${id}\nstatus: ${status}\nowner: claude\n---\n\n# ${id}: x\n`,
});

describe('inProgressStories', () => {
  test('keeps only In Progress stories, with their ids', () => {
    expect(
      inProgressStories([
        file('SHY-0113', 'In Progress'),
        file('SHY-0001', 'Draft'),
        file('SHY-0002', 'In Review'),
      ]),
    ).toEqual([{ id: 'SHY-0113', file: '.project/stories/SHY-0113-x.md' }]);
  });

  test('reads the status from the frontmatter only, not from the body', () => {
    const f = file('SHY-0003', 'Draft');
    f.text += '\nstatus: In Progress\n';
    expect(inProgressStories([f])).toEqual([]);
  });

  test('refuses a story file with no status field, naming it', () => {
    expect(() =>
      inProgressStories([
        { file: '.project/stories/SHY-0004-x.md', text: '---\nid: SHY-0004\n---\n' },
      ]),
    ).toThrow('.project/stories/SHY-0004-x.md has no status: field');
  });
});

describe('findOrphans', () => {
  const stories = [{ id: 'SHY-0113', file: '.project/stories/SHY-0113-x.md' }];

  test('a story nothing names is an orphan', () => {
    expect(findOrphans(stories, [], ['develop', 'main'], [])).toEqual(stories);
  });

  test('an open pull request whose title names the id claims it', () => {
    expect(
      findOrphans(
        stories,
        [{ title: 'SHY-0113: rooms on real services', headRefName: 'fix/rooms' }],
        [],
        [],
      ),
    ).toEqual([]);
  });

  test('an open pull request whose head branch names the id claims it', () => {
    expect(
      findOrphans(stories, [{ title: 'rooms', headRefName: 'story/SHY-0113-rooms' }], [], []),
    ).toEqual([]);
  });

  test('a remote branch naming the id claims it, in any case and without the hyphen', () => {
    expect(findOrphans(stories, [], ['chore/shy0113-slice'], [])).toEqual([]);
  });

  test('a longer number that contains the id does not claim it', () => {
    expect(
      findOrphans(
        stories,
        [{ title: 'SHY-01130 x', headRefName: 'story/SHY-01131-y' }],
        ['story/shy-101130'],
        [],
      ),
    ).toEqual(stories);
  });

  // Shyden 2026-10-13: "Branch counts until its PR closes".
  test('a remote branch whose pull request was closed does not claim it', () => {
    expect(findOrphans(stories, [], ['story/SHY-0113-rooms'], ['story/SHY-0113-rooms'])).toEqual(
      stories,
    );
  });

  test('an open pull request still claims it after an older branch had its pull request closed', () => {
    expect(
      findOrphans(
        stories,
        [{ title: 'rooms', headRefName: 'story/SHY-0113-rooms-2' }],
        ['story/SHY-0113-rooms'],
        ['story/SHY-0113-rooms'],
      ),
    ).toEqual([]);
  });
});

describe('parseHeads', () => {
  test('reads branch names from git ls-remote --heads output', () => {
    expect(parseHeads('abc\trefs/heads/develop\ndef\trefs/heads/story/SHY-0113-x\n')).toEqual([
      'develop',
      'story/SHY-0113-x',
    ]);
  });

  test('refuses output with no branches at all: a remote always has develop', () => {
    expect(() => parseHeads('')).toThrow(
      'git ls-remote listed no branches; refusing to judge orphans blind',
    );
  });
});
