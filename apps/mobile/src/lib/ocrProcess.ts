/**
 * Native OCR: uses Google ML Kit on-device text recognition.
 * This file is loaded by Metro on iOS/Android builds.
 * The web build loads ocrProcess.web.ts instead (platform extension).
 */
import TextRecognition from '@react-native-ml-kit/text-recognition';
import type { RawLine } from '@splitmate/types';

export async function recognizeText(imageUri: string): Promise<RawLine[]> {
  const result = await TextRecognition.recognize(imageUri);

  return result.blocks
    .flatMap((block) => block.lines)
    .map((line, position) => ({
      text: line.text,
      position,
      boundingBox: line.frame
        ? {
            x: line.frame.left,
            y: line.frame.top,
            width: line.frame.width,
            height: line.frame.height,
          }
        : undefined,
    }));
}
