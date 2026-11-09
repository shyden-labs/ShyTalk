/**
 * The real test mailbox the phones' closed-testing journey reads
 * (shyden-labs/ShyTalk#150; Shyden chose a dedicated mailbox 2026-11-10).
 * Each run applies with its own plus-address, so the server's resend window
 * never hides a send, and cPanel files that mail in its own folder,
 * `INBOX.<tag>` (measured 2026-11-10 on shyden-labs/ShyTalk#162). The phone
 * run reads the password from the Keychain into `TEST_MAILBOX_PASSWORD`
 * (tests/phones/run.ts); CI never reads this mailbox.
 */
import { ImapFlow } from 'imapflow';

const USER = 'shytalk-tests';
const DOMAIN = 'shyden.co.uk';
const HOST = 'mail.shyden.co.uk';
const LOOK_EVERY_MS = 5_000;
const CEILING_MS = 120_000;
const CONFIRM_LINK = /https:\/\/\S+\/closed-testing\/confirm\?t=\S+/;

export interface Mail {
  subject: string;
  text: string;
}

/** One open connection: the newest mail in a folder, or null while the folder is missing or empty. */
export interface MailboxReader {
  latest(folder: string): Promise<Mail | null>;
  close(): Promise<void>;
}

export interface WaitDeps {
  password: string;
  open?: (password: string) => Promise<MailboxReader>;
  now?: () => number;
  pause?: (ms: number) => Promise<void>;
}

/** The test mailbox with `tag` after a plus; a tag cPanel could not use as one folder name is refused. */
export function plusAddress(tag: string): string {
  if (!/^[a-z0-9-]+$/.test(tag)) throw new Error(`the tag ${JSON.stringify(tag)} must be lower-case letters, digits and dashes`);
  return `${USER}+${tag}@${DOMAIN}`;
}

/** Waits for the mail sent to `plusAddress(tag)`, looking every 5 s and failing at 120 s. */
export async function waitForMail(tag: string, deps: WaitDeps): Promise<Mail & { confirmLink: string }> {
  if (deps.password === '')
    throw new Error('TEST_MAILBOX_PASSWORD is unset: the phone run reads it from the Keychain (service shytalk-test-mailbox)');
  const now = deps.now ?? Date.now;
  const pause = deps.pause ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const folder = `INBOX.${tag}`;
  const box = await (deps.open ?? openImap)(deps.password);
  try {
    const started = now();
    for (;;) {
      const mail = await box.latest(folder);
      if (mail !== null) {
        const confirmLink = CONFIRM_LINK.exec(mail.text)?.[0];
        if (confirmLink === undefined) throw new Error(`the mail in ${folder} (${JSON.stringify(mail.subject)}) holds no confirm link`);
        return { ...mail, confirmLink };
      }
      if (now() - started + LOOK_EVERY_MS > CEILING_MS) throw new Error(`no mail reached ${folder} within ${String(CEILING_MS / 1000)} s`);
      await pause(LOOK_EVERY_MS);
    }
  } finally {
    await box.close();
  }
}

async function openImap(password: string): Promise<MailboxReader> {
  const client = new ImapFlow({ host: HOST, port: 993, secure: true, auth: { user: `${USER}@${DOMAIN}`, pass: password }, logger: false });
  await client.connect();
  return {
    async latest(folder) {
      const folders = await client.list();
      if (!folders.some(({ path }) => path === folder)) return null;
      const opened = await client.mailboxOpen(folder, { readOnly: true });
      if (opened.exists === 0) return null;
      const head = await client.fetchOne('*', { envelope: true });
      const body = await client.download('*', '1');
      if (head === false || body.content === undefined) return null;
      const chunks: Buffer[] = [];
      for await (const chunk of body.content) chunks.push(chunk as Buffer);
      return { subject: head.envelope?.subject ?? '', text: Buffer.concat(chunks).toString('utf8') };
    },
    close: () => client.logout(),
  };
}
