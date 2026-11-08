/**
 * The CI smoke's stand-in for Oracle Email Delivery (shyden-labs/ShyTalk#55
 * AC7): the Worker under `wrangler dev` posts here (MAIL_ENDPOINT), and the
 * journey reads back what it would have sent, by address. CI only.
 *
 *   node tests/smoke/mail-stand-in.ts <port>
 */
import { createServer } from 'node:http';

interface SubmitEmail {
  recipients: { to: { email: string }[] };
  subject: string;
  bodyText: string;
}

const port = Number(process.argv[2]);
const latest = new Map<string, SubmitEmail>();

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://stand-in');
  const answer = (status: number, body: unknown): void => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };

  if (request.method === 'GET' && url.pathname === '/health') {
    answer(200, { ok: true });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/mail') {
    const mail = latest.get(url.searchParams.get('to') ?? '');
    if (mail === undefined) answer(404, { error: 'no mail for that address' });
    else answer(200, mail);
    return;
  }
  if (request.method !== 'POST') {
    answer(405, { error: 'POST or the GETs only' });
    return;
  }

  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    const mail = JSON.parse(Buffer.concat(chunks).toString('utf8')) as SubmitEmail;
    for (const { email } of mail.recipients.to) latest.set(email, mail);
    answer(200, { messageId: 'stand-in', envelopeId: 'stand-in', suppressedRecipients: [] });
  });
}).listen(port, '127.0.0.1');
