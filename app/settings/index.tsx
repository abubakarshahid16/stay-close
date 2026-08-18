/**
 * Settings screen — notification privacy, backup/restore, delete all data.
 */
import React, { useState } from 'react';
import {
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useDatabase } from '../../src/context/DatabaseContext';
import { useSettings } from '../../src/hooks/useSettings';
import { BackupService } from '../../src/services/BackupService';
import { SettingsRepository } from '../../src/db/repositories/SettingsRepository';
import { notificationService } from '../../src/services/NotificationService';
import { LoadingView } from '../../src/components/LoadingView';
import { confirmAsync, showAlert } from '../../src/utils/dialogs';

export default function SettingsScreen() {
  const { db } = useDatabase();
  const { settings, isLoading, setNotificationPrivacy, refresh } = useSettings();
  const [isBusy, setIsBusy] = useState(false);

  const handleExportBackup = async () => {
    if (!db) return;
    setIsBusy(true);
    try {
      const service = new BackupService(db);
      const filePath = await service.export();
      await service.share(filePath);
    } catch (err) {
      showAlert('Backup Failed', err instanceof Error ? err.message : 'Could not export backup.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleRestoreBackup = async () => {
    if (!db) return;

    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];

    const confirmed = await confirmAsync(
      'Restore Backup',
      'Restoring replaces all current circles, people, and history with the backup contents. Continue?',
      { confirmLabel: 'Restore', destructive: true }
    );
    if (!confirmed) return;

    setIsBusy(true);
    try {
      const service = new BackupService(db);
      if (Platform.OS === 'web') {
        // On web the picked document is a File object — read it directly.
        const file = asset.file;
        if (!file) throw new Error('Could not read the selected file');
        await service.importFromString(await file.text());
      } else {
        await service.import(asset.uri);
      }
      await refresh();
      showAlert('Backup Restored', 'Your circles and history were restored.');
      router.replace('/(tabs)');
    } catch (err) {
      showAlert('Restore Failed', err instanceof Error ? err.message : 'Could not restore backup.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteAllData = async () => {
    const confirmed = await confirmAsync(
      'Delete All Data',
      'This will permanently delete all circles, people, and history. This cannot be undone.',
      { confirmLabel: 'Delete Everything', destructive: true }
    );
    if (!confirmed || !db) return;

    setIsBusy(true);
    try {
      // FK cascade removes circle_people and reminder_history rows
      await db.runAsync('DELETE FROM circles', []);
      await new SettingsRepository(db).deleteAll();
      await notificationService.cancelAll();
      router.replace('/(tabs)');
    } catch {
      showAlert('Error', 'Could not delete all data.');
    } finally {
      setIsBusy(false);
    }
  };

  if (isLoading) return <LoadingView />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>

        <SectionHeader title="Notifications" />
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingLabel}>
              <Text style={styles.settingTitle}>Detailed Notifications</Text>
              <Text style={styles.settingDesc}>
                Show the person&apos;s name in notification previews
              </Text>
            </View>
            <Switch
              value={settings.notificationPrivacy === 'detailed'}
              onValueChange={(v) =>
                setNotificationPrivacy(v ? 'detailed' : 'private')
              }
              accessibilityLabel="Detailed notifications"
              accessibilityHint="When on, the person's name appears in the notification preview"
              testID="notification-privacy-switch"
            />
          </View>
        </View>

        <SectionHeader title="Backup" />
        <View style={styles.card}>
          <Text style={styles.backupDesc}>
            Export your circles and history as a JSON file you can save or share.
            Nothing is uploaded — the file stays on your device.
          </Text>
          <TouchableOpacity
            style={[styles.button, styles.backupButton, isBusy && styles.buttonDisabled]}
            onPress={handleExportBackup}
            disabled={isBusy}
            accessibilityRole="button"
            accessibilityLabel="Export backup"
            testID="export-backup-button"
          >
            <Text style={styles.backupButtonText}>
              {isBusy ? 'Working…' : 'Export Backup'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.restoreButton, isBusy && styles.buttonDisabled]}
            onPress={handleRestoreBackup}
            disabled={isBusy}
            accessibilityRole="button"
            accessibilityLabel="Restore backup"
            testID="restore-backup-button"
          >
            <Text style={styles.restoreButtonText}>Restore Backup</Text>
          </TouchableOpacity>
        </View>

        <SectionHeader title="Privacy" />
        <View style={styles.card}>
          <Text style={styles.privacyDesc}>
            Stay Close stores all data locally on this device. No accounts,
            no cloud, no internet required. Your contacts are never uploaded.
          </Text>
        </View>

        <SectionHeader title="Danger Zone" />
        <TouchableOpacity
          style={[styles.button, styles.deleteButton, isBusy && styles.buttonDisabled]}
          onPress={handleDeleteAllData}
          disabled={isBusy}
          accessibilityRole="button"
          accessibilityLabel="Delete all data"
          testID="delete-all-data-button"
        >
          <Text style={styles.deleteButtonText}>Delete All My Data</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>Stay Close · Local-first relationship reminders</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F7F6FB',
  },
  content: {
    padding: 20,
    paddingTop: 12,
    gap: 0,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B6880',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 24,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingLabel: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1E1B2E',
    marginBottom: 2,
  },
  settingDesc: {
    fontSize: 13,
    color: '#6B6880',
    lineHeight: 18,
  },
  backupDesc: {
    fontSize: 14,
    color: '#6B6880',
    lineHeight: 20,
    marginBottom: 14,
  },
  privacyDesc: {
    fontSize: 14,
    color: '#6B6880',
    lineHeight: 20,
  },
  button: {
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  backupButton: {
    backgroundColor: '#7C3AED',
  },
  backupButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  restoreButton: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#7C3AED',
    marginTop: 10,
  },
  restoreButtonText: {
    color: '#7C3AED',
    fontSize: 15,
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#EF4444',
  },
  deleteButtonText: {
    color: '#EF4444',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  versionText: {
    textAlign: 'center',
    color: '#A8A5B8',
    fontSize: 12,
    marginTop: 40,
    marginBottom: 16,
  },
});
