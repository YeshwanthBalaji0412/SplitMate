import { useState, useCallback } from 'react';
import * as ImagePicker from 'expo-image-picker';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { parseReceipt } from '@split-smart/ocr-parser';
import type { ParsedBillDraft, Country, BillType } from '@split-smart/ocr-parser';

export type OcrScanState =
  | { status: 'idle' }
  | { status: 'picking' }
  | { status: 'processing' }
  | { status: 'done'; draft: ParsedBillDraft; imageUri: string }
  | { status: 'failed'; reason: string };

export function useOcrScanner(country: Country, billType: BillType) {
  const [state, setState] = useState<OcrScanState>({ status: 'idle' });

  const scan = useCallback(async () => {
    setState({ status: 'picking' });

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setState({ status: 'failed', reason: 'Camera roll permission denied' });
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

    const imageUri = result.assets[0].uri;
    setState({ status: 'processing' });

    try {
      const mlkitResult = await TextRecognition.recognize(imageUri);

      // ML Kit returns blocks → lines → elements. Flatten to RawLine[].
      const rawLines = mlkitResult.blocks
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
        setState({ status: 'failed', reason: 'No text detected in image' });
        return;
      }

      const draft = parseReceipt({ lines: rawLines, country, billType });
      setState({ status: 'done', draft, imageUri });
    } catch (err) {
      setState({
        status: 'failed',
        reason: err instanceof Error ? err.message : 'OCR failed',
      });
    }
  }, [country, billType]);

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { state, scan, reset };
}
