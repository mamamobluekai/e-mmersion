const express = require('express');
const multer = require('multer');

const authenticate = require('../middleware/verifyToken');
const authorize = require('../middleware/authorizeRole');
const { writeLimiter, uploadLimiter } = require('../middleware/rateLimiters');
const { uploadGuard } = require('../middleware/uploadGuard');

const {
  createSupportReport,
  listSupportReports,
  getSupportReport,
  updateSupportReport,
  addSupportReportReply,
  getSupportReportStats,
} = require('../controllers/supportReport.controller');

const router = express.Router();

// Public endpoint - no authentication required (submitted from login pages).
// Rate-limited and CSRF-protected via the global middleware chain.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

router.post(
  '/reports',
  writeLimiter,
  upload.single('attachment'),
  uploadGuard(['image']),
  createSupportReport
);

// Admin-only management endpoints.
const adminOnly = [authenticate, authorize('admin')];

router.get('/reports', adminOnly, listSupportReports);
router.get('/reports/stats', adminOnly, getSupportReportStats);
router.get('/reports/:id', adminOnly, getSupportReport);
router.patch('/reports/:id', adminOnly, writeLimiter, updateSupportReport);
router.post(
  '/reports/:id/replies',
  adminOnly,
  writeLimiter,
  addSupportReportReply
);

module.exports = router;
