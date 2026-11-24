const mailer = require('../utils/mailer');
const { createNotification } = require('./notification.service');

async function notifyNewLogin(user, session) {
  if (!session.newDevice) return;
  const { info, device, sid, alertsEnabled } = session;
  const actionUrl = `/dashboard/${user.role}/settings/security`;
  const date = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', dateStyle: 'long', timeStyle: 'short',
  }).format(new Date(device.last_login_at));
  const appUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');
  const notification = createNotification({ userId: user.id, title: 'New device signed in',
    message: `${info.name} signed in through ${info.browser}. Review your devices in Account Security.`,
    type: 'warning', category: 'security', priority: 'high', actionUrl, eventKey: `new-device-login:${sid}` });
  const email = alertsEnabled ? mailer.sendMail({
    to: user.email,
    subject: 'New Login Detected – Your Account Was Accessed',
    text: [
      `An unfamiliar device signed in to ${user.email}.`,
      '',
      `Device: ${info.name} (${info.type})`,
      `Browser and operating system: ${info.browser} · ${info.os}`,
      ...(info.location ? [`Approximate location: ${info.location}`] : []),
      ...(info.ip ? [`IP address: ${info.ip}`] : []),
      `Login time: ${date} (Philippine time)`,
      '',
      'If this wasn’t you, secure your account immediately.',
      `Review and revoke sessions in Account Security: ${appUrl}${actionUrl}`,
    ].join('\n'),
  }).then((result) => { if (!result.sent) throw new Error(result.reason || 'Email delivery failed'); }) : null;
  for (const result of await Promise.allSettled([notification, email])) {
    if (result.status === 'rejected') console.error('Could not send new-device alert:', result.reason.message);
  }
}

module.exports = { notifyNewLogin };
