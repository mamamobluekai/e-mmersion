const pool = require('../db');
const mailer = require('../utils/mailer');
const { hashPassword } = require('../utils/hashPassword');
const { generateTemporaryPassword } = require('../utils/generatePassword');

const TEMPORARY_PASSWORD_TTL_HOURS = 72;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function createTemporaryCredential() {
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  return { temporaryPassword, passwordHash };
}

async function sendTemporaryPasswordEmail(user, temporaryPassword) {
  const to = String(user?.email || '').trim();
  if (!EMAIL_REGEX.test(to)) {
    const reason = `The account email address "${to}" is missing or invalid. Correct it on the account profile, then resend.`;
    return { emailSent: false, emailError: reason };
  }

  const configError = mailer.mailConfigError();
  if (configError) return { emailSent: false, emailError: configError };

  const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
  const roleLabel = user.role === 'supervisor' ? 'Workplace Supervisor' : 'Student';
  const possessiveRole = user.role === 'supervisor' ? 'supervisor' : 'student';
  const safeName = mailer.escapeHtml(name);
  const safeEmail = mailer.escapeHtml(to);
  const safePassword = mailer.escapeHtml(temporaryPassword);
  const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');
  const loginUrl = `${clientUrl}/login/${possessiveRole}`;
  let result;
  try {
    result = await mailer.sendMail({
      to,
      subject: `Your Work Immersion ${possessiveRole} login credentials`,
      html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2a5298;">Your ${roleLabel} Account Is Ready</h2>
        <p>Hello${safeName ? ` <strong>${safeName}</strong>` : ''},</p>
        <p>Use these credentials to sign in to the Work Immersion Monitoring System:</p>
        <p><strong>Email:</strong> ${safeEmail}<br />
           <strong>Temporary password:</strong> ${safePassword}</p>
        <p>Your temporary password is valid for ${TEMPORARY_PASSWORD_TTL_HOURS} hours. After signing in,
           accept the Terms and Agreement, then create a permanent password to activate your account.</p>
        <p><a href="${mailer.escapeHtml(loginUrl)}">Open Work Immersion</a></p>
        <p style="color: #666; font-size: 12px;">Marinduque National High School - Work Immersion Office</p>
      </div>
      `,
      text: [
        `Your ${roleLabel} Account Is Ready`,
        '',
        name ? `Hello ${name},` : 'Hello,',
        '',
        'Use these credentials to sign in to the Work Immersion Monitoring System:',
        `Email: ${to}`,
        `Temporary password: ${temporaryPassword}`,
        '',
        `Your temporary password is valid for ${TEMPORARY_PASSWORD_TTL_HOURS} hours. After signing in, accept the Terms and Agreement, then create a permanent password to activate your account.`,
        loginUrl,
        '',
        'Marinduque National High School - Work Immersion Office',
      ].join('\n'),
    });
  } catch (err) {
    console.error(`Account activation email send failed for ${to}:`, err);
    return {
      emailSent: false,
      emailError: `The mail service failed: ${err.message || 'unknown sending error'}`,
    };
  }

  if (result.sent) console.log(`Account activation email sent to ${to}`);
  return {
    emailSent: result.sent,
    emailError: result.reason || (result.sent ? null : 'The mail provider did not accept the message.'),
  };
}

async function resendTemporaryPassword(user, role = 'student') {
  if (!['student', 'supervisor'].includes(role)) {
    throw new Error('Temporary credential resend is not supported for this account role.');
  }

  const credential = await createTemporaryCredential();
  const result = await pool.query(
    `UPDATE users
     SET password = $1,
         temporary_password_expires_at = CURRENT_TIMESTAMP + make_interval(hours => $2),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $3 AND role = $4 AND status = 'pending_activation'
     RETURNING email`,
    [credential.passwordHash, TEMPORARY_PASSWORD_TTL_HOURS, user.id, role],
  );

  if (result.rows.length === 0) return { eligible: false };

  return {
    eligible: true,
    ...(await sendTemporaryPasswordEmail(
      { ...user, email: result.rows[0].email, role },
      credential.temporaryPassword,
    )),
  };
}

module.exports = {
  TEMPORARY_PASSWORD_TTL_HOURS,
  createTemporaryCredential,
  sendTemporaryPasswordEmail,
  resendTemporaryPassword,
};
