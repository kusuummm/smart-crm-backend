const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  ALLOWED_FILE_TYPES,
  validateFileSignature,
  scanBufferForMalware,
  sanitizeFilename,
} = require('../utils/fileSecurity');

// Ensure base upload directories exist
const uploadBase = path.join(__dirname, '..', 'uploads');
const docsDir = path.join(uploadBase, 'documents');
const certsDir = path.join(uploadBase, 'certificates');

[uploadBase, docsDir, certsDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // If uploading certificate, store in certificates folder, otherwise documents folder
    if (req.originalUrl && req.originalUrl.includes('certificate')) {
      cb(null, certsDir);
    } else {
      cb(null, docsDir);
    }
  },
  filename: (req, file, cb) => {
    const sanitizeResult = sanitizeFilename(file.originalname);
    if (!sanitizeResult.isSafe) {
      return cb(new Error(sanitizeResult.reason));
    }
    file.sanitizedOriginalName = sanitizeResult.sanitizedOriginalName;
    file.safeStorageFilename = sanitizeResult.safeStorageFilename;
    cb(null, sanitizeResult.safeStorageFilename);
  },
});

const fileFilter = (req, file, cb) => {
  const sanitizeResult = sanitizeFilename(file.originalname);
  if (!sanitizeResult.isSafe) {
    return cb(new Error(sanitizeResult.reason));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB strict limit
  fileFilter,
});

/**
 * Middleware that validates file magic bytes signature and scans for malware/webshells
 */
const validateUploadedFile = (req, res, next) => {
  const targetFile = req.file || (req.files && (req.files[0] || req.files.file?.[0] || req.files.document?.[0]));

  if (!targetFile) {
    return next();
  }

  req.file = targetFile;

  // 1. Validate file size (> 0 and <= 10MB)
  if (!targetFile.size || targetFile.size === 0) {
    if (fs.existsSync(targetFile.path)) fs.unlinkSync(targetFile.path);
    return res.status(400).json({
      success: false,
      message: 'Upload validation failed: File is empty (0 bytes).',
    });
  }

  if (targetFile.size > 10 * 1024 * 1024) {
    if (fs.existsSync(targetFile.path)) fs.unlinkSync(targetFile.path);
    return res.status(400).json({
      success: false,
      message: 'Upload validation failed: File exceeds maximum permitted size of 10 MB.',
    });
  }

  // 2. Read header buffer to verify magic numbers
  let buffer;
  try {
    buffer = fs.readFileSync(targetFile.path);
  } catch (readErr) {
    return res.status(500).json({
      success: false,
      message: 'Failed to read uploaded file for security validation.',
    });
  }

  const ext = path.extname(targetFile.originalname).toLowerCase();

  // 3. File signature / Magic bytes verification
  const sigCheck = validateFileSignature(buffer, ext);
  if (!sigCheck.isValid) {
    if (fs.existsSync(targetFile.path)) fs.unlinkSync(targetFile.path);
    return res.status(400).json({
      success: false,
      message: `File signature validation failed: ${sigCheck.reason}`,
    });
  }

  // 4. Malware and webshell scanning
  const malwareCheck = scanBufferForMalware(buffer, ext);
  if (!malwareCheck.isSafe) {
    if (fs.existsSync(targetFile.path)) fs.unlinkSync(targetFile.path);
    return res.status(400).json({
      success: false,
      message: `File security alert: ${malwareCheck.reason}`,
    });
  }

  // Overwrite declared MIME with verified MIME
  req.file.mimetype = sigCheck.mime;
  next();
};

/**
 * Wrapper for single file uploads supporting multiple field names ('file', 'document')
 */
const uploadSingleFile = (preferredField = 'file') => {
  return (req, res, next) => {
    upload.any()(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: `Upload error: ${err.message}`,
        });
      }

      if (req.files && req.files.length > 0) {
        req.file = req.files.find((f) => f.fieldname === preferredField) || req.files[0];
      }

      validateUploadedFile(req, res, next);
    });
  };
};

module.exports = upload;
module.exports.upload = upload;
module.exports.validateUploadedFile = validateUploadedFile;
module.exports.uploadSingleFile = uploadSingleFile;
