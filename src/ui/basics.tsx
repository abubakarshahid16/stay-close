/**
 * Minimal building blocks for Phase A screens.
 *
 * docs/PRODUCT.md §37 permits basic lists, buttons, forms and text — enough to
 * exercise the functionality. This file is deliberately plain: no colour system,
 * no typography scale, no animation. That work is Phase B
 * (docs/UI_UX_ROADMAP.md), and doing it now would mean polishing a design that
 * device verification might still invalidate.
 *
 * The one thing taken seriously here is accessibility, because retrofitting it
 * is what makes it expensive.
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Screen({
  children,
  scroll = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
}) {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={styles.content}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Heading({ children }: { children: React.ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.heading}>
      {children}
    </Text>
  );
}

export function Subheading({ children }: { children: React.ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.subheading}>
      {children}
    </Text>
  );
}

export function Body({ children, dim = false }: { children: React.ReactNode; dim?: boolean }) {
  return <Text style={[styles.body, dim && styles.dim]}>{children}</Text>;
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  // accessibilityLiveRegion so a screen reader announces a validation failure
  // rather than leaving it silently on screen.
  return (
    <Text accessibilityLiveRegion="polite" style={styles.error}>
      {children}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  variant = 'default',
  disabled = false,
  accessibilityHint,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: 'default' | 'primary' | 'quiet';
  disabled?: boolean;
  accessibilityHint?: string;
  /**
   * Spoken name, when the visible label is not one on its own.
   *
   * The time and day pickers render bare numbers — "07", "15", "45" — which a
   * screen reader announces without any sense of what they select. Defaults to
   * the label, so existing buttons are unaffected.
   */
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      // 44pt minimum touch target, per platform guidance.
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'quiet' && styles.buttonQuiet,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          variant === 'primary' && styles.buttonLabelPrimary,
          variant === 'quiet' && styles.buttonLabelQuiet,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function ListRow({
  title,
  subtitle,
  onPress,
  accessibilityHint,
}: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  accessibilityHint?: string;
}) {
  const content = (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>{title}</Text>
      {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // Announce both lines, so the row is not read as a bare name.
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [pressed && styles.rowPressed]}
    >
      {content}
    </Pressable>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator accessibilityLabel={label} />
      <Text style={styles.dim}>{label}</Text>
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Spacer({ size = 16 }: { size?: number }) {
  return <View style={{ height: size }} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, gap: 8, flexGrow: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  heading: { fontSize: 24, fontWeight: '600', marginBottom: 4 },
  subheading: { fontSize: 17, fontWeight: '600', marginTop: 12 },
  body: { fontSize: 15, lineHeight: 21 },
  dim: { color: '#666' },
  error: { fontSize: 14, color: '#8a1c1c', marginTop: 4 },
  button: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#bbb',
    borderRadius: 6,
  },
  buttonPrimary: { backgroundColor: '#1c1c1c', borderColor: '#1c1c1c' },
  buttonQuiet: { borderColor: 'transparent' },
  buttonPressed: { opacity: 0.6 },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { fontSize: 16, textAlign: 'center' },
  buttonLabelPrimary: { color: '#fff', fontWeight: '600' },
  buttonLabelQuiet: { color: '#444' },
  card: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 16, gap: 8 },
  row: { paddingVertical: 12, gap: 2 },
  rowPressed: { opacity: 0.6 },
  rowTitle: { fontSize: 16 },
  rowSubtitle: { fontSize: 13, color: '#666' },
  divider: { height: 1, backgroundColor: '#eee' },
});
