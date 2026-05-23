import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import type { BillType, Country, ParsedBillDraft, RawLine } from '@splitmate/types';
import { parseReceipt } from '@splitmate/ocr-parser';

/**
 * Five-state machine for receipt OCR scanning.
 *
 *   idle → picking → processing → done | failed
 *
 * Two entry points:
 *   pickFromGallery() — open photo library, pick a saved receipt image
 *   captureFromCamera() — launch camera to photograph a physical receipt
 *
 * Both paths feed the image URI into ML Kit → parser → ParsedBillDraft.
 *
 * Web guard:
 *   ML Kit is native-only. On web both methods immediately return 'failed'
 *   with a clear message. The web bundle never crashes.
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
   * Shared OCR pipeline: takes an image URI, runs ML Kit + parser.
   * Called by both gallery and camera paths after an image is obtained.
   */
  const processImage = useCallback(
    async (imageUri: string) => {
      setState({ status: 'processing' });

      try {
        const mlkitResult = await TextRecognition.recognize(imageUri);

        const rawLines: RawLine[] = mlkitResult.blocks
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
   * Best for: saved screenshots, emailed receipts, downloaded images.
   */
  const pickFromGallery = useCallback(async () => {
    if (Platform.OS === 'web') {
      setState({
        status: 'failed',
        reason: 'OCR is unavailable on web. Please use iOS or Android.',
      });
      return;
    }

    setState({ status: 'picking' });

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setState({ status: 'failed', reason: 'Photo library permission denied.' });
        return;
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
   * Best for: photographing a physical paper receipt at a restaurant.
   */
  const captureFromCamera = useCallback(async () => {
    if (Platform.OS === 'web') {
      setState({
        status: 'failed',
        reason: 'Camera capture is unavailable on web. Please use iOS or Android.',
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

  // Legacy alias: `scan` maps to gallery pick for backward compatibility
  // with bill-entry.tsx which calls `scan()`.
  const scan = pickFromGallery;

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { state, scan, pickFromGallery, captureFromCamera, reset };
}
