'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

// Uploads live under api/uploads and are served statically at /uploads.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const ALLOWED = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

const uploadImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    return cb(new Error('Only image files (png, jpg, webp, gif) are allowed.'));
  },
});

// KYC documents: a private folder inside the uploads volume that app.js never serves
// statically. The extension comes from the checked MIME type, not the client's name.
const KYC_DIR = path.join(UPLOAD_DIR, '_private', 'kyc');
fs.mkdirSync(KYC_DIR, { recursive: true });
const KYC_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/webp': '.webp' };
const kycUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, KYC_DIR),
    filename: (req, file, cb) => cb(null, `${crypto.randomBytes(16).toString('hex')}${KYC_EXT[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (KYC_EXT[file.mimetype] ? cb(null, true) : cb(new Error('Upload a photo (png, jpg or webp).'))),
});

module.exports = { uploadImage, UPLOAD_DIR, kycUpload, KYC_DIR };
