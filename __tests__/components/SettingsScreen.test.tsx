/**
 * Component tests for the Settings screen.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import SettingsScreen from '../../app/settings/index';

jest.mock('../../src/context/DatabaseContext', () => ({
  useDatabase: () => ({
    db: {
      runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 0, changes: 0 }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      getAllAsync: jest.fn().mockResolvedValue([]),
      execAsync: jest.fn().mockResolvedValue(undefined),
      withTransactionAsync: jest.fn().mockImplementation(async (fn: () => Promise<void>) => fn()),
      closeAsync: jest.fn().mockResolvedValue(undefined),
    },
    isReady: true,
    error: null,
  }),
}));

jest.mock('../../src/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      notificationPrivacy: 'private',
      onboardingCompleted: true,
      contactsPermissionExplained: true,
    },
    isLoading: false,
    setNotificationPrivacy: jest.fn(),
    setOnboardingCompleted: jest.fn(),
    setContactsPermissionExplained: jest.fn(),
    refresh: jest.fn(),
  }),
}));

describe('SettingsScreen', () => {
  it('renders key UI elements', () => {
    render(<SettingsScreen />);
    expect(screen.getByTestId('notification-privacy-switch')).toBeTruthy();
    expect(screen.getByTestId('export-backup-button')).toBeTruthy();
    expect(screen.getByTestId('delete-all-data-button')).toBeTruthy();
  });

  it('switch reflects private notification privacy (off)', () => {
    render(<SettingsScreen />);
    const toggle = screen.getByTestId('notification-privacy-switch');
    // notificationPrivacy is 'private', so switch should be off (false)
    expect(toggle.props.value).toBe(false);
  });

  it('shows export backup button', () => {
    render(<SettingsScreen />);
    expect(screen.getByText('Export Backup')).toBeTruthy();
  });

  it('shows delete all data button', () => {
    render(<SettingsScreen />);
    expect(screen.getByText('Delete All My Data')).toBeTruthy();
  });

  it('shows privacy description', () => {
    render(<SettingsScreen />);
    expect(screen.getByText(/locally on this device/i)).toBeTruthy();
  });
});
