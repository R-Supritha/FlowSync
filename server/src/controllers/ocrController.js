const { extractTextFromUpload, ExtractionError, EXTRACTABLE_MIME } = require('../utils/textExtraction');

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

// POST /api/ocr/extract (multipart, field "file")
// Accepts images (OCR), PDFs (embedded text + OCR fallback), DOCX and PPTX.
// The file lives only in memory for the duration of this request - nothing is stored.
async function extractDocumentText(req, res) {
  try {
    if (!req.file) {
      return fail(res, 400, 'No file was uploaded (field name must be "file")');
    }
    if (!EXTRACTABLE_MIME[req.file.mimetype]) {
      return fail(res, 400, 'Unsupported file type. Allowed: PDF, DOCX, PPTX, PNG, JPEG.');
    }

    const { text, method, pages, warnings } = await extractTextFromUpload({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
    });

    res.json({
      success: true,
      text,
      source: {
        name: req.file.originalname,
        size: req.file.size,
        method,
        pages,
      },
      warnings,
    });
  } catch (error) {
    if (error instanceof ExtractionError) {
      return fail(res, error.status || 400, error.message);
    }
    // Never leak stack traces or internal paths.
    console.error('OCR extraction failed:', error.message);
    fail(res, 500, 'Failed to extract text from the document');
  }
}

module.exports = { extractDocumentText };
