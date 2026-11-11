const multer = require('multer');
const path = require('path');
const fs = require('fs');

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
    if (req.originalUrl.includes('certificate')) {
      cb(null, certsDir);
    } else {
      cb(null, docsDir);
    }
  },
  filename: (req, file, cb) => {
    // Sanitize original filename
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext);
    cb(null, `${base}-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${ext}. Allowed types: PDF, JPG, PNG, WEBP, DOC, DOCX`));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB limit
  fileFilter,
});

module.exports = upload;
