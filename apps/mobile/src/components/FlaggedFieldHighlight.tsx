import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Wraps a form field with an amber border + "Review" chip when `flagged`
 * is true. When the user edits the underlying field, the parent should
 * call `useFlaggedFields.confirm(field)` which flips `flagged` to false
 * and the amber treatment disappears.
 *
 * Renders children as-is when not flagged. No layout side effects.
 */
type Props = {
  flagged: boolean;
  label?: string;
  children: ReactNode;
};

export function FlaggedFieldHighlight({ flagged, label, children }: Props) {
  if (!flagged) return <>{children}</>;

  return (
    <View style={styles.wrapper}>
      <View style={styles.chipRow}>
        <View style={styles.chip}>
          <Text style={styles.chipText}>Review</Text>
        </View>
        {label ? <Text style={styles.chipLabel}>{label}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderWidth: 2,
    borderColor: '#f59e0b', // amber-500
    borderRadius: 12,
    padding: 8,
    gap: 6,
    backgroundColor: '#fffbeb', // amber-50
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    backgroundColor: '#f59e0b',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipLabel: {
    color: '#92400e', // amber-800
    fontSize: 12,
    fontWeight: '500',
  },
});
