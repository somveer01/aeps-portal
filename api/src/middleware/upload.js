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

module.exports = { uploadImage, UPLOAD_DIR };
