const assert = require('node:assert/strict');
const { test } = require('node:test');
const mailer = require('../utils/mailer');

test('Gmail sends the sign-in code as a plain-text message with a visible body', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'test-token', expires_in: 3600 });
    }
    assert.equal(url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    const mime = Buffer.from(JSON.parse(options.body).raw, 'base64url').toString('utf8');
    messages.push(mime);
    return Response.json({ id: 'test-message' });
  });

  const messages = [];
  const sender = {
    GMAIL_CLIENT_ID: 'test-client',
    GMAIL_CLIENT_SECRET: 'test-secret',
    GMAIL_REFRESH_TOKEN: 'test-refresh-token',
    GMAIL_FROM: 'sender@example.test',
  };
  for (const [name, value] of Object.entries(sender)) {
    const original = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    });
  }

  const to = 'recipient@example.test';
  const otp = await mailer.sendMail({
    to,
    subject: 'Your e-MMERSION sign-in code',
    text: 'Your sign-in code is 012345. It expires in 5 minutes.\n\nKeep this code private.',
  });
  assert.equal(otp.sent, true);
  assert.match(messages[0], /^Content-Type: text\/plain\b/im);
  assert.doesNotMatch(messages[0], /multipart\/alternative|Content-Type: text\/html/i);
  assert.match(messages[0], /\r\n\r\nYour sign-in code is 012345\. It expires in 5 minutes\.\r\n\r\nKeep this code private\./);

  const approval = await mailer.sendMail({ to, subject: 'Account approved', text: 'Account approved.', html: '<p>Account approved.</p>' });
  assert.equal(approval.sent, true);
  assert.match(messages[1], /^Content-Type: multipart\/alternative\b/im);
  assert.match(messages[1], /^Content-Type: text\/plain\b/im);
  assert.match(messages[1], /^Content-Type: text\/html\b/im);
  assert.match(messages[1], /<p>Account approved\.<\/p>/);
});
