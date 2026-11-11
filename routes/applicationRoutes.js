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

// Status and Payment updates
router.patch('/:id/status', updateStatus);
router.patch('/:id/payment', updatePayment);

// Document Folder operations
router.post('/:id/documents', upload.single('file'), uploadDocument);
router.patch('/:id/documents/:docId/status', updateDocumentStatus);
router.delete('/:id/documents/:docId', deleteDocument);

// Final Certificate Upload and Management
router.post('/:id/certificate', upload.single('file'), uploadCertificate);
router.delete('/:id/certificate', authorize('admin'), deleteCertificate);

module.exports = router;
