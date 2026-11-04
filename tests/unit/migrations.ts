/**
 * The D1 migration names (plan 4 Task 2, shyden-labs/ShyTalk#75). Wrangler
 * applies `migrations/` in file-name order, so each file is `NNNN_words.sql`
 * (lower-case words joined by `_`) and each number is used once. `.gitkeep`
 * keeps the folder before its first migration.
 */

const NAME = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

/** One line per misnamed file or shared number, naming the files. */
export function migrationProblems(files: string[]): string[] {
  const problems: string[] = [];
  const byNumber = new Map<string, string>();
  for (const file of [...files].sort()) {
    if (file === '.gitkeep') continue;
    const number = NAME.exec(file)?.[1];
    if (number === undefined) {
      problems.push(`${file} is not named NNNN_words.sql`);
      continue;
    }
    const earlier = byNumber.get(number);
    if (earlier === undefined) byNumber.set(number, file);
    else problems.push(`${earlier} and ${file} share the number ${number}`);
  }
  return problems;
}
