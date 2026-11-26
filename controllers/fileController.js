/**
 * Secure File Controller
 * Enforces:
 * - JWT Authentication
 * - Object-Level Access Control (IDOR prevention on KYC documents and certificates)
 * - Path traversal containment
 * - Defensive download headers (nosniff, attachment disposition, anti-caching)
 * - Prohibition of directory listing
 */

const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { verifyAccessToken } = require('../utils/jwtSecurity');
const Application = require('../models/Application');
const Customer = require('../models/Customer');
const { resolveSafeFilePath, ALLOWED_FILE_TYPES } = require('../utils/fileSecurity');

const uploadBase = path.resolve(__dirname, '..', 'uploads');
const docsDir = path.join(uploadBase, 'documents');
const certsDir = path.join(uploadBase, 'certificates');

const isAdminOrOwner = (user) => {
  const r = (user?.role || '').toLowerCase();
  return r === 'admin' || r === 'owner';
};

/**
 * Serves an uploaded file with strict authentication, object-level authorization, and security headers
 */
const serveSecureUpload = async (req, res) => {
  const { category, filename } = req.params;

  // 1. Validate category
  if (category !== 'documents' && category !== 'certificates') {
    return res.status(400).json({
      success: false,
      message: 'Invalid upload category. Permitted: documents, certificates',
    });
  }

  // 2. Validate path containment against directory traversal
  const categoryDir = category === 'certificates' ? certsDir : docsDir;
  const safeFilePath = resolveSafeFilePath(categoryDir, filename);

  if (!safeFilePath) {
    return res.status(400).json({
      success: false,
      message: 'Access denied: Invalid filename or path traversal detected',
    });
  }

  // 3. Authenticate User
  let token = null;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access denied: Authentication required to view or download documents.',
    });
  }

  let user;
  try {
    user = verifyAccessToken(token, {
      issuer: process.env.NODE_ENV === 'test' ? false : undefined,
      audience: process.env.NODE_ENV === 'test' ? false : undefined,
    });
    req.user = user;
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Access denied: Invalid or expired access token.',
    });
  }

  // 4. Verify file existence on disk
  if (!fs.existsSync(safeFilePath)) {
    return res.status(404).json({
      success: false,
      message: 'Requested document or certificate was not found on server.',
    });
  }

  // 5. Object-Level Access Control (IDOR Prevention)
  if (!isAdminOrOwner(user)) {
    const targetUrl = `/uploads/${category}/${filename}`;

    // Find application referencing this document or certificate
    const application = await Application.findOne({
      $or: [
        { 'documents.fileUrl': targetUrl },
        { 'finalCertificate.fileUrl': targetUrl },
      ],
    }).populate('customerId');

    const currentUserId = String(user.id || user._id || user.sub || '');

    if (application) {
      let isAuthorized = false;

      // A. If user is the applicant / customer
      const custId = String(application.customerId?._id || application.customerId || '');
      if (custId && (custId === currentUserId || (user.customerId && custId === String(user.customerId)))) {
        isAuthorized = true;
      }

      // B. If user is the assigned telecaller / staff member
      if (!isAuthorized) {
        const customer = application.customerId;
        if (customer) {
          const isAssigned =
            (customer.telecallerId && String(customer.telecallerId) === currentUserId) ||
            (user.name && customer.assignedTelecaller === user.name);
          if (isAssigned) {
            isAuthorized = true;
          }
        }
      }

      if (!isAuthorized) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You do not have permission to view or download this document.',
        });
      }
    } else {
      // If file exists on disk but is not linked to any user's application, only admin can view it
      return res.status(403).json({
        success: false,
        message: 'Access denied: Unassociated document requires administrator authorization.',
      });
    }
  }

  // 6. Set Defensive Security Headers
  const ext = path.extname(filename).toLowerCase();
  const mimeType = ALLOWED_FILE_TYPES[ext]?.mime || 'application/octet-stream';

  res.setHeader('Content-Type', mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Enforce attachment disposition for documents, or inline with nosniff if previewing
  const isPreview = req.query.preview === 'true';
  const dispositionType = isPreview && (ext === '.pdf' || ext === '.png' || ext === '.jpg' || ext === '.jpeg') ? 'inline' : 'attachment';
  const safeDownloadName = filename.replace(/[^\w.-]/g, '_');
  res.setHeader('Content-Disposition', `${dispositionType}; filename="${safeDownloadName}"`);

  // 7. Deliver file
  res.sendFile(safeFilePath);
};

module.exports = {
  serveSecureUpload,
};
