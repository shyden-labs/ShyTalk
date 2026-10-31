import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withoutYamlComments } from './source-text.ts';

/**
 * Every project files a ticket the same way (issue shyden-labs/repo-template#20; Shyden 2026-10-16:
 * "the whole procedure"): one form whose boxes are all required, in one order,
 * under a note that gives the filing steps. `scripts/file-story.ts` follows
 * the same steps.
 */

const form = () => withoutYamlComments(readFileSync('.github/ISSUE_TEMPLATE/story.yml', 'utf8'));

/** The text of the block that starts at `- type: … id: <id>`. */
function block(id: string): string {
  const parts = form().split(/\n\s*- type: /);
  const found = parts.find((p) => new RegExp(`\\n\\s*id: ${id}\\n`).test(p));
  if (found === undefined) throw new Error(`no block with id ${id}`);
  return found;
}

const BOXES = ['story', 'context', 'acceptance-criteria', 'announce', 'definition-of-done'];

describe('the story form', () => {
  it('fails closed on a block the form does not have', () => {
    expect(() => block('no-such-block')).toThrow('no block with id no-such-block');
  });

  it('holds the filing steps, then each box, in this order', () => {
    expect([...form().matchAll(/^\s+id: (\S+)$/gm)].map((m) => m[1])).toEqual(['filing-steps', ...BOXES]);
  });

  it.each(BOXES)('requires %s', (id) => {
    expect(block(id)).toMatch(/\n\s*required: true(\n|$)/);
  });

  it('asks for the story line as who, what and why', () => {
    expect(block('story')).toContain('description: As a <who>, I can <what>, so that <why>.');
  });

  it('asks what this lets us tell people once it closes, or nothing and why', () => {
    expect(block('announce')).toContain(
      'What this lets us tell people once it closes (on the site, the roadmap or the release notes), or "nothing" and why.',
    );
  });

  it.each([
    ['search the open board first', '1. **Search the open board first.**'],
    ['add it to the board, checking the title', '2. **Add the issue to the board**, checking the board’s title before you write.'],
    ['score it in Fibonacci points', '3. Set the board’s **Estimate** field: 1, 2, 3, 5, 8 or 13 story points.'],
    ['score from the criteria', 'scored from the acceptance criteria against similar closed stories, never from felt hours.'],
    ['send anything larger to an epic', 'Anything larger is an epic: split it into stories.'],
    ['set the Priority', '4. Set its **Priority** too: P0 (now) to P5 (someday), as docs/project-board.md defines them.'],
    ['raise a blocker', 'A blocker takes at least the level of what waits on it.'],
    ['link each blocker', '5. Add a **Blocked by** link for each issue it waits on: a “Depends on” section is context, not the record.'],
    ['set the parent', '6. Set its epic as its **parent**.'],
    // The note is a block scalar, so its "#N" is text, not a comment (shyden-labs/repo-template#54).
    [
      'never close by keyword',
      '7. Write `Refs #N` in commits and pull requests, never a closing keyword; close it by hand once every criterion is verified.',
    ],
    ['name the filer', '`node scripts/file-story.ts` does steps 1 to 6.'],
  ])('tells the filer to %s', (_step, text) => {
    expect(block('filing-steps')).toContain(text);
  });
});
