import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { UiDocument } from '../../packages/ui-document/index.ts';

/**
 * Every translated line of the app's UI document was read back into English
 * by Google before it was committed (global rule; plan 6.1 Task 2): each
 * language's table in manifests/read-back/ holds a row for every key, with
 * this very English and this very line.
 */
const manifest = JSON.parse(readFileSync('manifests/ui.json', 'utf8')) as UiDocument;

/** The table's rows by key: the English it was read against and the line that was read. */
function table(locale: string): Map<string, { english: string; mine: string }> {
  const rows = new Map<string, { english: string; mine: string }>();
  for (const line of readFileSync(`manifests/read-back/${locale}.md`, 'utf8').split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 6 || cells[1] === 'Key' || cells[1]?.startsWith('---')) continue;
    rows.set(cells[1] ?? '', { english: cells[2] ?? '', mine: cells[3] ?? '' });
  }
  return rows;
}

describe.each(['id', 'th', 'vi', 'zh'] as const)('the %s lines of the UI document', (locale) => {
  it('were each read back by Google, as they stand and against this English', () => {
    const rows = table(locale);
    const unread = Object.entries(manifest.copy[locale]).filter(([key, line]) => {
      const row = rows.get(key);
      return row?.mine !== line || row.english !== manifest.copy.en[key];
    });
    expect(unread.map(([key]) => key)).toEqual([]);
  });
});
