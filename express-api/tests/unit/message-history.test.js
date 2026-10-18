const {
  decideEdit,
  decideRecall,
  historyLogFields,
  MAX_TEXT_LENGTH,
} = require('../../src/utils/message-history');

const NOW = 1_760_000_000_000;
const conv = (over = {}) => ({ participantIds: ['101', '102'], ...over });
const msg = (over = {}) => ({ senderId: '101', text: 'hello', type: 'TEXT', ...over });

describe('decideEdit', () => {
  test('writes the stored text as history and the new text on the message', () => {
    const v = decideEdit({
      conversation: conv(),
      message: msg(),
      callerId: 101,
      text: 'hello there',
      now: NOW,
    });
    expect(v).toEqual({
      ok: true,
      changed: true,
      editEntry: { previousText: 'hello', editedAt: NOW, editorId: '101', source: 'server' },
      messageUpdate: { text: 'hello there', isEdited: true, editedAt: NOW },
    });
  });
  test('refuses blank text with 400', () => {
    expect(
      decideEdit({ conversation: conv(), message: msg(), callerId: 101, text: '   ', now: NOW }),
    ).toEqual({ ok: false, status: 400, error: 'text required' });
  });
  test('refuses a non-string text with 400', () => {
    expect(
      decideEdit({ conversation: conv(), message: msg(), callerId: 101, text: 42, now: NOW })
        .status,
    ).toBe(400);
  });
  test('refuses a missing conversation with 404', () => {
    expect(
      decideEdit({ conversation: null, message: msg(), callerId: 101, text: 'x', now: NOW }).status,
    ).toBe(404);
  });
  test('refuses a missing message with 404', () => {
    expect(
      decideEdit({ conversation: conv(), message: null, callerId: 101, text: 'x', now: NOW })
        .status,
    ).toBe(404);
  });
  test('refuses a caller who is not a participant with 404', () => {
    expect(
      decideEdit({
        conversation: conv(),
        message: msg({ senderId: '103' }),
        callerId: 103,
        text: 'x',
        now: NOW,
      }).status,
    ).toBe(404);
  });
  test('refuses a flagged conversation with 404', () => {
    expect(
      decideEdit({
        conversation: conv({ crossCohortAtMigration: true }),
        message: msg(),
        callerId: 101,
        text: 'x',
        now: NOW,
      }).status,
    ).toBe(404);
  });
  test('refuses another participant with 403', () => {
    expect(
      decideEdit({ conversation: conv(), message: msg(), callerId: 102, text: 'x', now: NOW }),
    ).toEqual({ ok: false, status: 403, error: 'Only the sender can edit this message' });
  });
  test('matches a numeric stored senderId to the string caller', () => {
    expect(
      decideEdit({
        conversation: conv(),
        message: msg({ senderId: 101 }),
        callerId: '101',
        text: 'x',
        now: NOW,
      }).ok,
    ).toBe(true);
  });
  test('refuses a recalled message with 409', () => {
    expect(
      decideEdit({
        conversation: conv(),
        message: msg({ isRecalled: true }),
        callerId: 101,
        text: 'x',
        now: NOW,
      }).status,
    ).toBe(409);
  });
  test('refuses a non-text message with 422', () => {
    expect(
      decideEdit({
        conversation: conv(),
        message: msg({ type: 'IMAGE' }),
        callerId: 101,
        text: 'x',
        now: NOW,
      }).status,
    ).toBe(422);
  });
  test('treats a message with no type as TEXT', () => {
    expect(
      decideEdit({
        conversation: conv(),
        message: msg({ type: undefined }),
        callerId: 101,
        text: 'x',
        now: NOW,
      }).ok,
    ).toBe(true);
  });
  test('cuts text to MAX_TEXT_LENGTH', () => {
    const v = decideEdit({
      conversation: conv(),
      message: msg(),
      callerId: 101,
      text: 'a'.repeat(2005),
      now: NOW,
    });
    expect(MAX_TEXT_LENGTH).toBe(2000);
    expect(v.messageUpdate.text).toHaveLength(2000);
  });
  test('the same text is a no-op with no history entry', () => {
    expect(
      decideEdit({ conversation: conv(), message: msg(), callerId: 101, text: 'hello', now: NOW }),
    ).toEqual({ ok: true, changed: false });
  });
  test('a cut text equal to the stored text is a no-op', () => {
    const long = 'b'.repeat(2000);
    expect(
      decideEdit({
        conversation: conv(),
        message: msg({ text: long }),
        callerId: 101,
        text: `${long}xyz`,
        now: NOW,
      }),
    ).toEqual({ ok: true, changed: false });
  });
  test('a stored message with no text records an empty previousText', () => {
    expect(
      decideEdit({
        conversation: conv(),
        message: msg({ text: undefined }),
        callerId: 101,
        text: 'x',
        now: NOW,
      }).editEntry.previousText,
    ).toBe('');
  });
});

describe('decideRecall', () => {
  test('keeps the text in the record and blanks the message', () => {
    expect(decideRecall({ conversation: conv(), message: msg(), callerId: 101, now: NOW })).toEqual(
      {
        ok: true,
        record: {
          text: 'hello',
          type: 'TEXT',
          recalledAt: NOW,
          recalledBy: '101',
          source: 'server',
        },
        messageUpdate: { isRecalled: true, text: '' },
      },
    );
  });
  test('keeps image urls of an image message', () => {
    const v = decideRecall({
      conversation: conv(),
      message: msg({ type: 'IMAGE', text: '', imageUrls: ['u1'] }),
      callerId: 101,
      now: NOW,
    });
    expect(v.record.imageUrls).toEqual(['u1']);
    expect(v.record.type).toBe('IMAGE');
  });
  test('refuses a missing message with 404', () => {
    expect(
      decideRecall({ conversation: conv(), message: null, callerId: 101, now: NOW }).status,
    ).toBe(404);
  });
  test('refuses a flagged conversation with 404', () => {
    expect(
      decideRecall({
        conversation: conv({ crossCohortAtMigration: true }),
        message: msg(),
        callerId: 101,
        now: NOW,
      }).status,
    ).toBe(404);
  });
  test('refuses another participant with 403', () => {
    expect(
      decideRecall({ conversation: conv(), message: msg(), callerId: 102, now: NOW }).status,
    ).toBe(403);
  });
  test('refuses an already recalled message with 409', () => {
    expect(
      decideRecall({
        conversation: conv(),
        message: msg({ isRecalled: true }),
        callerId: 101,
        now: NOW,
      }).status,
    ).toBe(409);
  });
});

describe('historyLogFields', () => {
  test('names ids and caller only', () => {
    expect(
      historyLogFields({ conversationId: 'c', messageId: 'm', callerId: 101, changed: true }),
    ).toEqual({ conversationId: 'c', messageId: 'm', callerId: '101', changed: true });
  });
  test('carries no key that could hold text', () => {
    const keys = Object.keys(
      historyLogFields({ conversationId: 'c', messageId: 'm', callerId: 1 }),
    );
    expect(keys).toEqual(['conversationId', 'messageId', 'callerId']);
  });
});
