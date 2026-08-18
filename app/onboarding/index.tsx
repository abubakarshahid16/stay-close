/**
 * Onboarding screen — shown once on first launch.
 * Explains what the app does and requests contacts permission.
 */
import React, { useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSettings } from '../../src/hooks/useSettings';
import { ContactService } from '../../src/services/ContactService';

type Step = 'welcome' | 'privacy' | 'contacts';

export default function OnboardingScreen() {
  const { setOnboardingCompleted, setContactsPermissionExplained } = useSettings();
  const [step, setStep] = useState<Step>('welcome');
  const [isBusy, setIsBusy] = useState(false);

  const handleContactsRequest = async () => {
    setIsBusy(true);
    await setContactsPermissionExplained(true);
    const service = new ContactService();
    await service.requestPermission();
    await setOnboardingCompleted(true);
    setIsBusy(false);
    router.replace('/(tabs)');
  };

  const handleSkipContacts = async () => {
    await setContactsPermissionExplained(true);
    await setOnboardingCompleted(true);
    router.replace('/(tabs)');
  };

  if (step === 'welcome') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.content} testID="onboarding-welcome">
          <Text style={styles.title} accessibilityRole="header">
            Stay Close
          </Text>
          <Text style={styles.subtitle}>
            A private reminder to reconnect with the people you care about.
          </Text>

          <View style={styles.features}>
            <Feature text="One gentle reminder at a time" />
            <Feature text="Your circles, your rhythm" />
            <Feature text="All data stays on your device" />
            <Feature text="No account, no cloud, no ads" />
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => setStep('privacy')}
            accessibilityRole="button"
            accessibilityLabel="Get started"
            testID="welcome-continue"
          >
            <Text style={styles.primaryButtonText}>Get Started</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'privacy') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} testID="onboarding-privacy">
          <Text style={styles.title} accessibilityRole="header">
            Your Privacy
          </Text>
          <Text style={styles.bodyText}>
            Stay Close is built on a simple promise:
          </Text>
          <View style={styles.promises}>
            <Promise text="Contacts are never uploaded. They stay on your phone." />
            <Promise text="No analytics. We don't track what you do." />
            <Promise text="No internet required. Core features work offline." />
            <Promise text="No account needed. Nothing to sign up for." />
            <Promise text="Delete everything anytime from Settings." />
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => setStep('contacts')}
            accessibilityRole="button"
            accessibilityLabel="Continue"
            testID="privacy-continue"
          >
            <Text style={styles.primaryButtonText}>Continue</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // step === 'contacts'
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content} testID="onboarding-contacts">
        <Text style={styles.title} accessibilityRole="header">
          Add Your Contacts
        </Text>
        <Text style={styles.bodyText}>
          Stay Close reads your contacts so you can add people to circles.
          This happens on your device only — nothing is sent anywhere.
        </Text>
        <Text style={[styles.bodyText, styles.bodySpacer]}>
          You'll see a permission prompt from your phone. You can decline and
          add people manually later.
        </Text>

        <TouchableOpacity
          style={[styles.primaryButton, isBusy && styles.buttonDisabled]}
          onPress={handleContactsRequest}
          disabled={isBusy}
          accessibilityRole="button"
          accessibilityLabel="Allow contacts access"
          testID="allow-contacts-button"
        >
          <Text style={styles.primaryButtonText}>
            {isBusy ? 'Setting up…' : 'Allow Contacts'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipButton}
          onPress={handleSkipContacts}
          accessibilityRole="button"
          accessibilityLabel="Skip for now"
          testID="skip-contacts-button"
        >
          <Text style={styles.skipButtonText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function Feature({ text }: { text: string }) {
  return (
    <View style={styles.featureRow}>
      <Text style={styles.featureBullet}>•</Text>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

function Promise({ text }: { text: string }) {
  return (
    <View style={styles.promiseRow}>
      <Text style={styles.promiseMark}>✓</Text>
      <Text style={styles.promiseText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F9F9F9',
  },
  content: {
    flex: 1,
    padding: 32,
    paddingTop: 64,
    justifyContent: 'center',
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 14,
  },
  subtitle: {
    fontSize: 18,
    color: '#444',
    lineHeight: 26,
    marginBottom: 36,
  },
  bodyText: {
    fontSize: 16,
    color: '#444',
    lineHeight: 24,
    marginBottom: 16,
  },
  bodySpacer: {
    marginBottom: 36,
  },
  features: {
    gap: 12,
    marginBottom: 48,
  },
  featureRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  featureBullet: {
    fontSize: 18,
    color: '#4A90E2',
    marginTop: 1,
  },
  featureText: {
    fontSize: 16,
    color: '#333',
    flex: 1,
    lineHeight: 22,
  },
  promises: {
    gap: 12,
    marginBottom: 40,
  },
  promiseRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  promiseMark: {
    fontSize: 16,
    color: '#34C759',
    fontWeight: '700',
    marginTop: 2,
  },
  promiseText: {
    fontSize: 15,
    color: '#333',
    flex: 1,
    lineHeight: 22,
  },
  primaryButton: {
    backgroundColor: '#4A90E2',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 14,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  skipButtonText: {
    color: '#8E8E93',
    fontSize: 15,
  },
});
