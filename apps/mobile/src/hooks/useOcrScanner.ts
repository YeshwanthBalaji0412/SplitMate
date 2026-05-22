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
 * Transitions:
 *   scan()  : idle → picking (launches image picker)
 *   success : picking → processing (ML Kit recognizing) → done (draft ready)
 *   error   : any → failed (with human-readable reason)
 *   reset() : any → idle
 *
 * Web guard:
 *   ML Kit (`@react-native-ml-kit/text-recognition`) is a native iOS/Android
 *   module. On web the import resolves (the JS wrapper loads fine from
 *   react-native-web) but the underlying NativeModule is undefined. The
 *   Platform.OS check returns 'failed' before any ML Kit call, so the
 *   web bundle never crashes.
 *
 * Expo dev client requirement:
 *   `@react-native-ml-kit/text-recognition` ships native code that is NOT
 *   included in stock Expo Go. You must build a custom dev client:
 *     cd apps/mobile
 *     npx expo prebuild            # generates ios/ and android/ folders
 *     npx expo run:ios             # builds + installs dev client on iOS sim
 *     npx expo run:android         # builds + installs dev client on Android emu
 *   After the first build, subsequent code changes hot-reload via Metro as
 *   usual — you only rebuild when native deps change.
 */

export type OcrScanState =
  | { status: 'idle' }
  | { status: 'picking' }
  | { status: 'processing' }
  | { status: 'done'; draft: ParsedBillDraft; imageUri: string }
  | { status: 'failed'; reason: string };

export function useOcrScanner(country: Country, billType: BillType) {
  const [state, setState] = useState<OcrScanState>({ status: 'idle' });

  const scan = useCallback(async () => {
    // ---- Web guard ----
    if (Platform.OS === 'web') {
      setState({
        status: 'failed',
        reason: 'OCR is unavailable on web. Please use iOS or Android.',
      });
      return;
    }

    setState({ status: 'picking' });

    try {
      // Request photo library permission
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setState({ status: 'failed', reason: 'Photo library permission denied.' });
        return;
      }

      // Launch picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        allowsEditing: false,
      });

      if (result.canceled || result.assets.length === 0) {
        setState({ status: 'idle' }); // user cancelled — back to idle, not failed
        return;
      }

      const imageUri = result.assets[0]!.uri;
      setState({ status: 'processing' });

      // Run ML Kit text recognition on-device
      const mlkitResult = await TextRecognition.recognize(imageUri);

      // Flatten ML Kit's block → line hierarchy into RawLine[]
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

      // Run through the parser pipeline (Phase 11)
      const draft = parseReceipt({ lines: rawLines, country, billType });

      setState({ status: 'done', draft, imageUri });
    } catch (err) {
      setState({
        status: 'failed',
        reason: err instanceof Error ? err.message : 'OCR scan failed.',
      });
    }
  }, [country, billType]);

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { state, scan, reset };
}
