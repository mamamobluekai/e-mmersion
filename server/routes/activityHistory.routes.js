const express = require('express');
const authenticate = require('../middleware/verifyToken');
const authorize = require('../middleware/authorizeRole');
const { roles, types, areas, pageActivity, recordActivity, listActivity, reportActivityError } = require('../services/activityHistory.service');

const router = express.Router();
router.use(authenticate, authorize(...roles));

router.get('/', async (req, res) => {
  const { type = null, area = null, before = null } = req.query;
  if ((type !== null && (typeof type !== 'string' || !Object.hasOwn(types, type))) ||
      (area !== null && (typeof area !== 'string' || !Object.hasOwn(areas, area))) ||
      (before !== null && (typeof before !== 'string' || !/^[1-9]\d{0,18}$/.test(before) || BigInt(before) > 9223372036854775807n))) {
    return res.status(400).json({ error: 'Choose a valid activity filter.' });
  }
  try {
    res.set('Cache-Control', 'private, no-store');
    return res.json(await listActivity(req.user.id, type, area, before));
  } catch (error) {
    reportActivityError(error);
    return res.status(503).json({ error: 'Could not load activity history. Try again.' });
  }
});

router.post('/events', async (req, res) => {
  const { pathname, preference } = req.body || {};
  const page = pageActivity(req.user.role, pathname);
  const event = page ? ['page', page[0], `Opened ${page[1]}`]
    : preference === 'theme' && pathname === undefined ? ['update', 'account', 'Changed display theme'] : null;
  if (!event) return res.status(204).end();

  try {
    await recordActivity(req.user, ...event);
    return res.status(204).end();
  } catch (error) {
    reportActivityError(error);
    return res.status(503).json({ error: 'Could not save activity.' });
  }
});

module.exports = router;
