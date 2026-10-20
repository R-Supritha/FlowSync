const mammoth = require('mammoth');
const JSZip = require('jszip');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');

// Shared extraction engine for FR11 (AI project bootstrap) and FR12 (OCR).
// One code path for every input type so both features stay in sync.

const MAX_PDF_PAGES = 15;
const OCR_TIMEOUT_MS = 90 * 1000;
// Below roughly this many characters per page we assume the PDF is a scan and OCR it.
const MIN_CHARS_PER_PAGE_FOR_TEXT = 10;

const EXTRACTABLE_MIME = {
  'application/pdf': 'pdf',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/jpg': 'image',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

class ExtractionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ExtractionError';
    this.status = status;
  }
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new ExtractionError(message, 504)), ms);
    }),
  ]);
}

async function ocrImageBuffer(buffer) {
  try {
    const result = await withTimeout(
      Tesseract.recognize(buffer, 'eng', {
        // Logs are noisy during batch OCR; keep the server output clean.
        logger: () => {},
      }),
      OCR_TIMEOUT_MS,
      'OCR took too long and was cancelled'
    );
    return normalizeText(result.data && result.data.text);
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    // Most often: the OCR language data could not be downloaded (offline server).
    throw new ExtractionError(
      'The OCR engine could not process this image. If this persists, the server may be unable to download OCR language data.',
      422
    );
  }
}

// Renders PDF pages to PNG buffers via pdf-to-img (pdf.js + @napi-rs/canvas).
async function renderPdfPages(buffer, maxPages) {
  let pdf;
  try {
    ({ pdf } = await import('pdf-to-img'));
  } catch (error) {
    throw new ExtractionError('PDF page rendering is unavailable on this server.', 500);
  }
  const document = await pdf(buffer, { scale: 2, password: '' });
  const pages = [];
  for await (const page of document) {
    if (pages.length >= maxPages) break;
    pages.push(Buffer.from(page));
  }
  return pages;
}

function hasEnoughEmbeddedText(text, pageCount) {
  const chars = text.replace(/\s/g, '').length;
  const pagesUsed = Math.min(Math.max(pageCount, 1), MAX_PDF_PAGES);
  // OCR only when the PDF is essentially text-less (a scan). Real-but-short
  // embedded text always wins over a lossy OCR pass.
  return chars >= MIN_CHARS_PER_PAGE_FOR_TEXT * pagesUsed;
}

// Maps a raw pdf-parse / pdf.js failure onto a message that reflects the real
// reason, instead of blaming corruption for every parse error.
function describePdfParseFailure(error) {
  const message = String((error && error.message) || '').toLowerCase();
  if (/password|encrypt/.test(message)) {
    return 'This PDF is password-protected. Please upload an unlocked copy.';
  }
  if (/bad xref|xref|xref entry|invalid pdf|no pdf header|unexpected end|eof/.test(message)) {
    return 'This PDF appears to be damaged or incomplete. Try re-exporting or re-downloading it.';
  }
  return 'This PDF could not be read. It may be corrupted or password-protected.';
}

// Renders and OCRs every page. Used both for scanned PDFs and as a fallback when
// pdf-parse cannot read the file at all (pdf-to-img's newer pdf.js often can).
async function ocrPdfPages(buffer, warnings) {
  const rendered = await renderPdfPages(buffer, MAX_PDF_PAGES);
  const pageTexts = [];
  for (const pageBuffer of rendered) {
    pageTexts.push(await ocrImageBuffer(pageBuffer));
  }
  const text = pageTexts.join('\n\n');
  if (!text) return null;
  if ((rendered.length || 0) >= MAX_PDF_PAGES) {
    warnings.push(`Only the first ${MAX_PDF_PAGES} pages were processed.`);
  }
  return { text, method: 'pdf-ocr', pages: rendered.length, warnings };
}

async function extractFromPdf(buffer) {
  const warnings = [];
  let parsed = null;
  try {
    parsed = await pdfParse(buffer, { max: MAX_PDF_PAGES });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        'pdfParse failed:',
        error.message,
        '| bytes:', buffer.length,
        '| head:', JSON.stringify(buffer.slice(0, 16).toString('latin1'))
      );
    }
    // pdf-parse's bundled pdf.js is old and rejects some valid modern PDFs.
    // Fall through to pdf-to-img + OCR before reporting a failure.
    try {
      const ocrResult = await ocrPdfPages(buffer, warnings);
      if (ocrResult) return ocrResult;
    } catch {
      /* fall through to the parse error below */
    }
    throw new ExtractionError(describePdfParseFailure(error), 422);
  }

  const embedded = normalizeText(parsed.text);
  const pages = Math.min(parsed.numpages || 1, MAX_PDF_PAGES);
  if ((parsed.numpages || 0) > MAX_PDF_PAGES) {
    warnings.push(`Only the first ${MAX_PDF_PAGES} pages were processed.`);
  }

  if (hasEnoughEmbeddedText(embedded, pages)) {
    return { text: embedded, method: 'pdf-text', pages, warnings };
  }

  // Scanned (or near-empty) PDF: OCR each rendered page.
  let ocrResult;
  try {
    ocrResult = await ocrPdfPages(buffer, warnings);
  } catch (error) {
    if (embedded) {
      warnings.push('This looks like a scanned PDF and page scanning failed; only embedded text was returned.');
      return { text: embedded, method: 'pdf-text', pages, warnings };
    }
    throw error instanceof ExtractionError
      ? error
      : new ExtractionError('This scanned PDF could not be rendered for OCR.', 422);
  }

  if (!ocrResult) {
    if (embedded) return { text: embedded, method: 'pdf-text', pages, warnings };
    throw new ExtractionError('No readable text could be found in this PDF.', 422);
  }
  return ocrResult;
}

async function extractFromDocx(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = normalizeText(result.value);
    if (!text) throw new ExtractionError('No readable text was found in this document.', 422);
    return { text, method: 'docx', pages: null, warnings: [] };
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError('This DOCX file could not be read.', 422);
  }
}

async function extractFromPptx(buffer) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const na = Number(a.match(/(\d+)\.xml$/)[1]);
        const nb = Number(b.match(/(\d+)\.xml$/)[1]);
        return na - nb;
      });

    if (!slideFiles.length) throw new ExtractionError('No slides were found in this presentation.', 422);

    const slideTexts = [];
    for (const name of slideFiles) {
      const xml = await zip.files[name].async('string');
      // <a:t> holds the visible text runs in DrawingML.
      const runs = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) =>
        m[1]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
      );
      const slideText = normalizeText(runs.join(' '));
      if (slideText) slideTexts.push(slideText);
    }

    const text = slideTexts.join('\n\n');
    if (!text) throw new ExtractionError('No readable text was found in this presentation.', 422);
    return { text, method: 'pptx', pages: slideFiles.length, warnings: [] };
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError('This PPTX file could not be read.', 422);
  }
}

async function extractFromImage(buffer, mimetype) {
  if (mimetype === 'image/webp' || mimetype === 'image/gif') {
    throw new ExtractionError('This image format cannot be OCR-processed. Please use PNG or JPEG.', 400);
  }
  const text = await ocrImageBuffer(buffer);
  if (!text) throw new ExtractionError('No readable text could be found in this image.', 422);
  return { text, method: 'ocr', pages: 1, warnings: [] };
}

// Single entry point used by the OCR and AI-bootstrap endpoints.
// Returns { text, method, pages, warnings } or throws ExtractionError.
async function extractTextFromUpload({ buffer, mimetype }) {
  const kind = EXTRACTABLE_MIME[mimetype];
  if (!kind) {
    throw new ExtractionError(
      'Unsupported file type. Allowed for text extraction: PDF, DOCX, PPTX, PNG, JPEG.',
      400
    );
  }
  if (!buffer || !buffer.length) {
    throw new ExtractionError('The uploaded file is empty.', 400);
  }

  switch (kind) {
    case 'pdf':
      return extractFromPdf(buffer);
    case 'docx':
      return extractFromDocx(buffer);
    case 'pptx':
      return extractFromPptx(buffer);
    case 'image':
      return extractFromImage(buffer, mimetype);
    default:
      throw new ExtractionError('Unsupported file type.', 400);
  }
}

module.exports = {
  ExtractionError,
  EXTRACTABLE_MIME,
  MAX_PDF_PAGES,
  normalizeText,
  extractTextFromUpload,
  ocrImageBuffer,
};
