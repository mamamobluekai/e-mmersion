const isStudentRequirementImage = (file) => {
  if (!file || !Buffer.isBuffer(file.buffer)) return false;
  const filename = String(file.originalname || '').toLowerCase();
  const mimeType = String(file.mimetype || '').toLowerCase();
  const hasSignature = (bytes) =>
    file.buffer.length >= bytes.length &&
    bytes.every((byte, index) => file.buffer[index] === byte);
  const isPng =
    filename.endsWith('.png') &&
    mimeType === 'image/png' &&
    hasSignature([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const isJpeg =
    /\.(jpg|jpeg)$/.test(filename) &&
    mimeType === 'image/jpeg' &&
    hasSignature([0xff, 0xd8, 0xff]);
  return isPng || isJpeg;
};

module.exports = { isStudentRequirementImage };
