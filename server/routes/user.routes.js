const express = require('express');
const multer = require('multer');
const { CSRF_COOKIE } = require('../middleware/csrfProtection');

const {
  registerStudent,
  login,
  refreshAccessToken,
  logout,
  getMe,
  setPassword,
  setActivationPassword,
} = require('../controllers/user.controller');
const { forgotPassword, resetPassword, verifyResetToken } = require('../controllers/passwordReset.controller');
const authenticate = require('../middleware/verifyToken');
const loginLimiter = require('../middleware/loginLimter');
const { authLimiter, credentialLimiter, writeLimiter, otpVerifyLimiter, otpResendLimiter } = require('../middleware/rateLimiters');
const { verifyLoginOtp, resendLoginOtp } = require('../controllers/loginOtp.controller');
const {
  registerValidation,
  loginValidation,
  forgotValidation,
  resetValidation,
  verifyTokenValidation,
  handleValidation,
} = require('../validators/auth.validator');
const {
  getMyProfile,
  updateMyProfile,
  changeMyPassword,
  uploadMyProfilePicture,
} = require('../controllers/userProfile.controller');
const { acceptTerms } = require('../controllers/terms.controller');
const deviceSecurityRoutes = require('./deviceSecurity.routes');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Public auth surface. Layered limiters: a per-IP cap (authLimiter) plus a
// per-IP+email cap (credentialLimiter) so both brute force (#2) and credential
// stuffing (#3) are throttled. The original loginLimiter is kept as a coarse
// backstop so existing behaviour is preserved.
// Returns the CSRF token for this browser session. The SPA calls this before its
// first mutating request (login) because the `csrfToken` cookie is scoped to the
// API origin and is therefore unreadable from a client on a different site, as
// in production where the app is on vercel.app and the API on onrender.com.
// The browser still sends the cookie automatically (SameSite=None; Secure), so
// the server's double-submit comparison keeps working - the client only needs
// the value to echo back in X-CSRF-Token.
router.get('/csrf-token', (req, res) => {
  const issued = res.locals.csrfToken;
  const existing = req.cookies?.[CSRF_COOKIE];
  res.set('Cache-Control', 'no-store').json({ csrfToken: existing || issued || null });
});

router.post('/register', writeLimiter, registerValidation, handleValidation, registerStudent);
const loginChecks = [authLimiter, credentialLimiter, loginLimiter, loginValidation, handleValidation];
router.post('/login', ...loginChecks, login);
router.post('/login/otp/verify', otpVerifyLimiter, verifyLoginOtp);
router.post('/login/otp/resend', otpResendLimiter, resendLoginOtp);
for (const role of ['student', 'teacher', 'coordinator', 'supervisor']) {
  router.post(`/login/${role}`, ...loginChecks, (req, res) => login(req, res, role));
}
router.post('/refresh', refreshAccessToken);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, getMe);
router.post('/set-password', authLimiter, setPassword);
router.post('/forgot-password', authLimiter, forgotValidation, handleValidation, forgotPassword);
router.post('/reset-password', authLimiter, resetValidation, handleValidation, resetPassword);
router.post('/verify-reset-token', authLimiter, verifyTokenValidation, handleValidation, verifyResetToken);

function sessionStatus(req, res) {
  const remainingMs = Math.max(0, new Date(res.locals.sessionDeadline).getTime() - Date.now());
  res.set('Cache-Control', 'no-store').json({ remainingMs });
}

router.get('/session', authenticate, sessionStatus);
router.post('/session/activity', writeLimiter, authenticate, sessionStatus);

router.use(authenticate);

router.use('/security', deviceSecurityRoutes);

router.post('/activation/set-password', writeLimiter, setActivationPassword);

// One-time acceptance of the Terms and Agreement. Available to every signed-in
// role, not just students, because every account has to agree once.
router.post('/terms/accept', acceptTerms);

router.get('/profile', getMyProfile);
router.put('/profile', updateMyProfile);
router.patch('/profile/password', changeMyPassword);
router.post('/profile/picture', upload.single('photo'), uploadMyProfilePicture);

module.exports = router;
