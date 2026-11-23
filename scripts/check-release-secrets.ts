/** Stub until its tests are seen red (shyden-labs/ShyTalk#330). */
export const RELEASE_SECRETS_FILE = '.github/release-secrets.json';

export function main(
  ...args: [string[], Record<string, string | undefined>, (path: string) => string, (line: string) => void]
): Promise<number> {
  return Promise.reject(new Error(`not written yet (${String(args.length)} arguments)`));
}
