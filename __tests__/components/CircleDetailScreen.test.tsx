/**
 * Component tests for the Circle detail screen.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

// A single stable db object — a fresh object per render would retrigger
// db-dependent effects forever and the screen would never leave loading.
const mockDb = {
  runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
  getFirstAsync: jest.fn().mockResolvedValue({
    id: 1,
    name: 'Family',
    reminder_frequency: 'weekly',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  }),
  getAllAsync: jest.fn().mockResolvedValue([
    {
      id: 10,
      circle_id: 1,
      contact_identifier: 'manual-1',
      display_name: 'Ammi',
      phone_number: '+92 300 1234567',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      last_suggested_at: null,
      suggestion_count: 0,
    },
    {
      id: 11,
      circle_id: 1,
      contact_identifier: 'manual-2',
      display_name: 'Hamza',
      phone_number: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      last_suggested_at: null,
      suggestion_count: 0,
    },
  ]),
  execAsync: jest.fn().mockResolvedValue(undefined),
  withTransactionAsync: jest.fn().mockImplementation(async (fn: () => Promise<void>) => fn()),
  closeAsync: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../src/context/DatabaseContext', () => ({
  useDatabase: () => ({
    db: mockDb,
    isReady: true,
    error: null,
  }),
}));

import CircleDetailScreen from '../../app/circles/[id]/index';

const mockUseLocalSearchParams = useLocalSearchParams as jest.MockedFunction<
  typeof useLocalSearchParams
>;

describe('CircleDetailScreen', () => {
  beforeEach(() => {
    mockUseLocalSearchParams.mockReturnValue({ id: '1' });
  });

  it('renders name input, frequency picker, and people list', async () => {
    render(<CircleDetailScreen />);
    await waitFor(() => {
      expect(screen.getByTestId('circle-name-input')).toBeTruthy();
    });
    expect(screen.getByTestId('frequency-picker')).toBeTruthy();
    expect(screen.getByTestId('add-people-button')).toBeTruthy();
    expect(screen.getByTestId('delete-circle-button')).toBeTruthy();
  });

  it('shows every person in the circle', async () => {
    render(<CircleDetailScreen />);
    await waitFor(() => {
      expect(screen.getByText('Ammi')).toBeTruthy();
    });
    expect(screen.getByText('Hamza')).toBeTruthy();
    expect(screen.getByText('+92 300 1234567')).toBeTruthy();
    expect(screen.getByTestId('remove-person-10')).toBeTruthy();
    expect(screen.getByTestId('remove-person-11')).toBeTruthy();
  });

  it('marks the circle frequency as selected', async () => {
    render(<CircleDetailScreen />);
    await waitFor(() => {
      expect(screen.getByTestId('freq-option-weekly')).toBeTruthy();
    });
    expect(
      screen.getByTestId('freq-option-weekly').props.accessibilityState?.selected
    ).toBe(true);
    expect(
      screen.getByTestId('freq-option-daily').props.accessibilityState?.selected
    ).toBe(false);
  });

  it('shows all frequency options', async () => {
    render(<CircleDetailScreen />);
    await waitFor(() => {
      expect(screen.getByTestId('frequency-picker')).toBeTruthy();
    });
    ['daily', 'every_3_days', 'weekly', 'every_2_weeks', 'monthly'].forEach((freq) => {
      expect(screen.getByTestId(`freq-option-${freq}`)).toBeTruthy();
    });
  });
});
