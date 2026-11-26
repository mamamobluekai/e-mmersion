const otp = require('../services/loginOtp.service');
const { completeLogin, loginAccessBlock } = require('./user.controller');
const { completeAdminLogin } = require('./adminContollers/auth.controller');
const { sendLoginError } = require('../utils/loginErrors');

function endpoint(operation) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.cookies?.csrfToken) return res.status(403).json({ error: 'Allow cookies and return to sign in.' });
    try {
      return await operation(req, res);
    } catch (error) {
      console.error('Sign-in verification failed:', error.code || error.name);
      return res.status(503).json({ error: 'Could not complete sign-in verification. Try again.' });
    }
  };
}

const verifyLoginOtp = endpoint(async (req, res) => {
  const result = await otp.verify(req, res, loginAccessBlock);
  res.locals.loginFailureRecorded = !result.session;
  if (result.blocked) return sendLoginError(res, result.blocked.code, result.blocked.context, result.blocked.extra);
  if (!result.session) return otp.sendLoginStep(res, result);
  return result.user.role === 'admin' ? completeAdminLogin(req, res, result.user, result.session) : completeLogin(req, res, result.user, result.session);
});

const resendLoginOtp = endpoint(async (req, res) => otp.sendLoginStep(res, await otp.resend(req)));

module.exports = { verifyLoginOtp, resendLoginOtp };
