const express = require('express');
const multer = require('multer');
const { requireImmersion } = require('../middleware/studentJourneyAccess');
const authenticate = require('../middleware/verifyToken');
const authorize = require('../middleware/authorizeRole');
const { uploadLimiter } = require('../middleware/rateLimiters');
const { uploadGuard } = require('../middleware/uploadGuard');
const {
  uploadFile,
  getMyFiles,
  getAllFiles,
  getFileById,
  deleteFile,
} = require('../controllers/fileController');

const router = express.Router();
// 20 MB hard cap enforced by multer before the buffer is read any further.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

router.use(authenticate);

// Rate-limited, then multer parses the multipart body, then the guard validates
// extension + MIME + magic bytes before the controller sees the file (#9).
router.post(
  '/upload',
  authorize('student'), requireImmersion,
  uploadLimiter,
  upload.single('file'),
  uploadGuard(['document', 'image', 'spreadsheet']),
  uploadFile
);
router.get('/my-files', authorize('student'), requireImmersion, getMyFiles);
router.get('/all', authorize('teacher', 'coordinator', 'admin'), getAllFiles);
router.get('/:id', authorize('student', 'teacher', 'coordinator', 'admin'), requireImmersion, getFileById);
router.delete('/:id', authorize('student'), requireImmersion, deleteFile);

module.exports = router;
