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
    return cb(Object.assign(new Error('Only image files (png, jpg, webp, gif) are allowed.'), { status: 400, code: 'INVALID_FILE' }));
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

// multer trusts the client's Content-Type. After the upload, check that the stored bytes really start like a png / jpg / gif / webp;
// anything else (text, empty, a script renamed .png) is deleted and refused.
function looksLikeImage(b) {
  if (b.length < 12) return false;
  const png = b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG';
  const jpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const gif = b.toString('latin1', 0, 4) === 'GIF8';
  const webp = b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
  return png || jpg || gif || webp;
}
function imageContentCheck(req, res, next) {
  if (!req.file) return next();
  let ok = false;
  try {
    const fd = fs.openSync(req.file.path, 'r');
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    ok = looksLikeImage(buf);
  } catch (e) { ok = false; }
  if (ok) return next();
  fs.unlink(req.file.path, () => {});
  return res.status(400).json({ error: 'The file is not a valid image', code: 'INVALID_FILE' });
}

module.exports = { uploadImage, UPLOAD_DIR, kycUpload, KYC_DIR, imageContentCheck };
