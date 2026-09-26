'use strict';

// POST /api/uploads/image  (admin, multipart field "image")
// Generic image upload — returns the stored path for use in create/update JSON.
function uploadImage(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  return res.json({ path: `/uploads/${req.file.filename}` });
}

module.exports = { uploadImage };
