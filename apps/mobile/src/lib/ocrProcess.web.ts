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
  const { data } = await Tesseract.recognize(imageUri, 'eng', {
    logger: () => {}, // suppress progress logs
  });

  // Tesseract.js v7 structure: Page.blocks[].paragraphs[].lines[]
  const rawLines: RawLine[] = [];
  let position = 0;

  if (data.blocks) {
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

  return rawLines;
}
