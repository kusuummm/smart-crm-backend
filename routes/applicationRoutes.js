const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const { protect, authorize } = require('../middleware/auth');
const {
  getStats,
  getApplications,
  getApplicationById,
  createApplication,
  updateStatus,
  updatePayment,
  uploadDocument,
  updateDocumentStatus,
  deleteDocument,
  uploadCertificate,
  deleteCertificate,
} = require('../controllers/applicationController');

// All application routes are protected
router.use(protect);

// Statistics for Admin & Manager Dashboard
router.get('/stats', getStats);

// Application CRUD & Search
router.route('/')
  .get(getApplications)
  .post(createApplication);

router.get('/:id', getApplicationById);

// Status and Payment updates (Requires manager/admin governance)
router.patch('/:id/status', authorize('manager'), updateStatus);
router.patch('/:id/payment', authorize('manager'), updatePayment);

// Document Folder operations
router.post('/:id/documents', upload.single('file'), uploadDocument);
router.patch('/:id/documents/:docId/status', authorize('manager'), updateDocumentStatus);
router.delete('/:id/documents/:docId', authorize('manager'), deleteDocument);

// Final Certificate Upload and Management
router.post('/:id/certificate', authorize('manager'), upload.single('file'), uploadCertificate);
router.delete('/:id/certificate', authorize('admin'), deleteCertificate);

module.exports = router;
