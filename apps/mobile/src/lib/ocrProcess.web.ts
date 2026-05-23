/**
 * Web OCR: uses Tesseract.js (WebAssembly-based, runs in browser).
 * This file is loaded by Metro on web builds via the .web.ts extension.
 * Native builds load ocrProcess.ts (ML Kit) instead.
 *
 * Tesseract.js downloads the trained language data (~15MB) on first use
 * and caches it in the browser. Subsequent calls are fast.
 */
import Tesseract from 'tesseract.js';
import type { RawLine } from '@splitmate/types';

export async function recognizeText(imageUri: string): Promise<RawLine[]> {
  // Tesseract.js needs a fetchable source. expo-image-picker on web returns
  // a blob: URL. If it's a blob URL, convert to a proper Blob first so
  // Tesseract can read it reliably across browsers.
  let imageSource: string | Blob = imageUri;

  if (imageUri.startsWith('blob:') || imageUri.startsWith('data:')) {
    try {
      const response = await fetch(imageUri);
      imageSource = await response.blob();
    } catch {
      // If fetch fails, try passing the URI directly as a fallback
      imageSource = imageUri;
    }
  }

  // eslint-disable-next-line no-console
  console.log('[OCR web] Starting Tesseract.js recognition...');

  const { data } = await Tesseract.recognize(imageSource, 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        // eslint-disable-next-line no-console
        console.log(`[OCR web] Progress: ${Math.round(m.progress * 100)}%`);
      }
    },
  });

  // eslint-disable-next-line no-console
  console.log('[OCR web] Raw text length:', data.text.length, 'Blocks:', data.blocks?.length ?? 'null');

  // Primary: use block → paragraph → line hierarchy for bounding boxes.
  const rawLines: RawLine[] = [];
  let position = 0;

  if (data.blocks && data.blocks.length > 0) {
    for (const block of data.blocks) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          const text = line.text.trim();
          if (text) {
            rawLines.push({
              text,
              position,
              boundingBox: line.bbox
                ? {
                    x: line.bbox.x0,
                    y: line.bbox.y0,
                    width: line.bbox.x1 - line.bbox.x0,
                    height: line.bbox.y1 - line.bbox.y0,
                  }
                : undefined,
            });
            position++;
          }
        }
      }
    }
  }

  // Fallback: if blocks are empty/null but raw text exists, split by newlines.
  // This happens in some Tesseract.js versions where blocks aren't populated
  // unless explicitly requested.
  if (rawLines.length === 0 && data.text.trim().length > 0) {
    // eslint-disable-next-line no-console
    console.log('[OCR web] Blocks empty, falling back to text split');
    const lines = data.text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        rawLines.push({ text: trimmed, position });
        position++;
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log('[OCR web] Extracted', rawLines.length, 'lines');

  return rawLines;
}
