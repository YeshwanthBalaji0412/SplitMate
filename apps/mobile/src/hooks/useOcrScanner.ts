import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { BillType, Country, ParsedBillDraft } from '@splitmate/types';
import { parseReceipt } from '@splitmate/ocr-parser';
import { recognizeText } from '@/lib/ocrProcess';

/**
 * Five-state machine for receipt OCR scanning.
 *
 *   idle → picking → processing → done | failed
 *
 * Two entry points:
 *   pickFromGallery()    — open photo library to pick a saved receipt image
 *   captureFromCamera()  — launch camera to photograph a physical receipt
 *
 * Platform-aware OCR:
 *   - Native (iOS/Android): ML Kit on-device via ocrProcess.ts
 *   - Web: Tesseract.js (WebAssembly) via ocrProcess.web.ts
 *   Metro resolves the right file automatically via the .web.ts extension.
 *
 * Both paths feed recognized text into the same parseReceipt() pipeline.
 */

export type OcrScanState =
  | { status: 'idle' }
  | { status: 'picking' }
  | { status: 'processing' }
  | { status: 'done'; draft: ParsedBillDraft; imageUri: string }
  | { status: 'failed'; reason: string };

export function useOcrScanner(country: Country, billType: BillType) {
  const [state, setState] = useState<OcrScanState>({ status: 'idle' });

  /**
   * Shared OCR pipeline: takes an image URI, runs platform-specific
   * text recognition, then feeds the raw lines into the parser.
   */
  const processImage = useCallback(
    async (imageUri: string) => {
      setState({ status: 'processing' });

      try {
        const rawLines = await recognizeText(imageUri);

        if (rawLines.length === 0) {
          setState({ status: 'failed', reason: 'No text detected in image.' });
          return;
        }

        const draft = parseReceipt({ lines: rawLines, country, billType });
        setState({ status: 'done', draft, imageUri });
      } catch (err) {
        setState({
          status: 'failed',
          reason: err instanceof Error ? err.message : 'OCR processing failed.',
        });
      }
    },
    [country, billType],
  );

  /**
   * Pick a receipt image from the photo library.
   * Works on all platforms (web uses <input type="file"> under the hood).
   */
  const pickFromGallery = useCallback(async () => {
    setState({ status: 'picking' });

    try {
      // On web, expo-image-picker uses <input type="file"> — no permission needed.
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setState({ status: 'failed', reason: 'Photo library permission denied.' });
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        allowsEditing: false,
      });

      if (result.canceled || result.assets.length === 0) {
        setState({ status: 'idle' });
        return;
      }

      await processImage(result.assets[0]!.uri);
    } catch (err) {
      setState({
        status: 'failed',
        reason: err instanceof Error ? err.message : 'Failed to pick image.',
      });
    }
  }, [processImage]);

  /**
   * Capture a receipt photo using the device camera.
   * Not available on web — shows a clear message.
   */
  const captureFromCamera = useCallback(async () => {
    if (Platform.OS === 'web') {
      setState({
        status: 'failed',
        reason: 'Camera capture is not available in the browser. Use "Upload receipt" to pick an image file instead.',
      });
      return;
    }

    setState({ status: 'picking' });

    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setState({ status: 'failed', reason: 'Camera permission denied.' });
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        allowsEditing: false,
      });

      if (result.canceled || result.assets.length === 0) {
        setState({ status: 'idle' });
        return;
      }

      await processImage(result.assets[0]!.uri);
    } catch (err) {
      setState({
        status: 'failed',
        reason: err instanceof Error ? err.message : 'Failed to capture image.',
      });
    }
  }, [processImage]);

  const scan = pickFromGallery;
  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { state, scan, pickFromGallery, captureFromCamera, reset };
}
