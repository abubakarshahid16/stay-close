/**
 * Component tests for the Add People screen.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import * as ExpoContacts from 'expo-contacts';

// A single stable db object — a fresh object per render would retrigger
// db-dependent effects forever and the screen would never leave loading.
const mockDb = {
  runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 5, changes: 1 }),
  getFirstAsync: jest.fn().mockResolvedValue({
    id: 5,
    circle_id: 1,
    contact_identifier: 'manual-x',
    display_name: 'Ammi',
    phone_number: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    last_suggested_at: null,
    suggestion_count: 0,
  }),
  getAllAsync: jest.fn().mockResolvedValue([]),
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

import AddPeopleScreen from '../../app/circles/[id]/select';

const mockUseLocalSearchParams = useLocalSearchParams as jest.MockedFunction<
  typeof useLocalSearchParams
>;
const mockGetContacts = ExpoContacts.getContactsAsync as jest.MockedFunction<
  typeof ExpoContacts.getContactsAsync
>;

describe('AddPeopleScreen', () => {
  beforeEach(() => {
    mockUseLocalSearchParams.mockReturnValue({ id: '1' });
  });

  it('renders search input and manual add section when permission granted', async () => {
    render(<AddPeopleScreen />);
    await waitFor(() => {
      expect(screen.getByTestId('contact-search-input')).toBeTruthy();
    });
    expect(screen.getByTestId('manual-add-section')).toBeTruthy();
    expect(screen.getByTestId('manual-name-input')).toBeTruthy();
    expect(screen.getByTestId('manual-add-button')).toBeTruthy();
  });

  it('shows empty message when device has no contacts', async () => {
    render(<AddPeopleScreen />);
    await waitFor(() => {
      expect(screen.getByTestId('no-contacts')).toBeTruthy();
    });
  });

  it('lists device contacts and toggles selection', async () => {
    mockGetContacts.mockResolvedValueOnce({
      data: [
        {
          id: 'c1',
          name: 'Taylor Example',
          phoneNumbers: [{ number: '+1 555 0100', label: 'mobile' }],
        },
        { id: 'c2', name: 'Jordan Example', phoneNumbers: [] },
      ],
      hasNextPage: false,
      hasPreviousPage: false,
    } as Awaited<ReturnType<typeof ExpoContacts.getContactsAsync>>);

    render(<AddPeopleScreen />);
    await waitFor(() => {
      expect(screen.getByTestId('contact-row-c1')).toBeTruthy();
    });
    expect(screen.getByTestId('contact-row-c2')).toBeTruthy();

    const row = screen.getByTestId('contact-row-c1');
    expect(row.props.accessibilityState?.checked).toBe(false);
    fireEvent.press(row);
    expect(screen.getByTestId('contact-row-c1').props.accessibilityState?.checked).toBe(true);
  });

  it('shows validation error when adding a manual person without a name', async () => {
    render(<AddPeopleScreen />);
    await waitFor(() => {
      expect(screen.getByTestId('manual-add-button')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('manual-add-button'));
    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeTruthy();
    });
  });

  it('adds a manual person and shows the added note', async () => {
    render(<AddPeopleScreen />);
    await waitFor(() => {
      expect(screen.getByTestId('manual-name-input')).toBeTruthy();
    });
    fireEvent.changeText(screen.getByTestId('manual-name-input'), 'Ammi');
    fireEvent.press(screen.getByTestId('manual-add-button'));
    await waitFor(() => {
      expect(screen.getByTestId('manual-added-note')).toBeTruthy();
    });
  });
});
