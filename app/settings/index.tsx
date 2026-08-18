/**
 * Settings screen — notification privacy, backup/restore, delete all data.
 */
import React, { useState } from 'react';
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useDatabase } from '../../src/context/DatabaseContext';
import { useSettings } from '../../src/hooks/useSettings';
import { BackupService } from '../../src/services/BackupService';
import { SettingsRepository } from '../../src/db/repositories/SettingsRepository';
import { LoadingView } from '../../src/components/LoadingView';

export default function SettingsScreen() {
  const { db } = useDatabase();
  const { settings, isLoading, setNotificationPrivacy } = useSettings();
  const [isBusy, setIsBusy] = useState(false);

  const handleExportBackup = async () => {
    if (!db) return;
    setIsBusy(true);
    try {
      const service = new BackupService(db);
      const filePath = await service.export();
      await service.share(filePath);
    } catch (err) {
      Alert.alert('Backup Failed', err instanceof Error ? err.message : 'Could not export backup.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteAllData = () => {
    Alert.alert(
      'Delete All Data',
      'This will permanently delete all circles, people, and history. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Everything',
          style: 'destructive',
          onPress: async () => {
            if (!db) return;
            setIsBusy(true);
            try {
              // Delete in dependency order (FK cascade handles child rows)
              await db.runAsync('DELETE FROM circles', []);
              await new SettingsRepository(db).deleteAll();
              router.replace('/(tabs)');
            } catch (err) {
              Alert.alert('Error', 'Could not delete all data.');
            } finally {
              setIsBusy(false);
            }
          },
        },
      ]
    );
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
                Show the person's name in notification previews
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
              {isBusy ? 'Exporting…' : 'Export Backup'}
            </Text>
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
    backgroundColor: '#F9F9F9',
  },
  content: {
    padding: 20,
    paddingTop: 12,
    gap: 0,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
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
    color: '#1A1A1A',
    marginBottom: 2,
  },
  settingDesc: {
    fontSize: 13,
    color: '#8E8E93',
    lineHeight: 18,
  },
  backupDesc: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 14,
  },
  privacyDesc: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  button: {
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  backupButton: {
    backgroundColor: '#4A90E2',
  },
  backupButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#FF3B30',
  },
  deleteButtonText: {
    color: '#FF3B30',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  versionText: {
    textAlign: 'center',
    color: '#C7C7CC',
    fontSize: 12,
    marginTop: 40,
    marginBottom: 16,
  },
});
