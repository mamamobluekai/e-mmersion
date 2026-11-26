const { isIP } = require('node:net');

function testLoginEnabled() {
  return ['development', 'test'].includes(process.env.NODE_ENV) && Boolean(process.env.LOGIN_OTP_TEST_ACCOUNTS?.trim());
}

function isTestLoginAccount(email) {
  if (!email || !testLoginEnabled()) return false;
  const accounts = process.env.LOGIN_OTP_TEST_ACCOUNTS.toLowerCase().split(',');
  return accounts.some((account) => account.trim() === email.toLowerCase());
}

function isLocalRequest(req) {
  const address = req.socket?.remoteAddress || '';
  const ipv4 = address.replace(/^::ffff:/i, '');
  return address === '::1' || (isIP(ipv4) === 4 && ipv4.startsWith('127.'));
}

module.exports = { isTestLoginAccount, isLocalRequest, testLoginEnabled };
