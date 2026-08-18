/**
 * Component tests for the Create Circle screen.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import CreateCircleScreen from '../../app/circles/create';

// Mock DatabaseContext
jest.mock('../../src/context/DatabaseContext', () => ({
  useDatabase: () => ({
    db: {
      runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
      getFirstAsync: jest.fn().mockResolvedValue({
        id: 1,
        name: 'Family',
        reminder_frequency: 'weekly',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      }),
      getAllAsync: jest.fn().mockResolvedValue([]),
      execAsync: jest.fn().mockResolvedValue(undefined),
      withTransactionAsync: jest.fn().mockImplementation(async (fn: () => Promise<void>) => fn()),
      closeAsync: jest.fn().mockResolvedValue(undefined),
    },
    isReady: true,
    error: null,
  }),
}));

describe('CreateCircleScreen', () => {
  it('renders name input and frequency options', () => {
    render(<CreateCircleScreen />);
    expect(screen.getByTestId('circle-name-input')).toBeTruthy();
    expect(screen.getByTestId('frequency-picker')).toBeTruthy();
    expect(screen.getByTestId('create-circle-button')).toBeTruthy();
  });

  it('shows validation error for empty name', async () => {
    render(<CreateCircleScreen />);
    const button = screen.getByTestId('create-circle-button');
    fireEvent.press(button);
    await waitFor(() => {
      expect(screen.getByText('Circle name is required')).toBeTruthy();
    });
  });

  it('shows validation error for name > 100 chars', async () => {
    render(<CreateCircleScreen />);
    const input = screen.getByTestId('circle-name-input');
    fireEvent.changeText(input, 'A'.repeat(101));
    const button = screen.getByTestId('create-circle-button');
    fireEvent.press(button);
    await waitFor(() => {
      expect(screen.getByText('Name must be 100 characters or fewer')).toBeTruthy();
    });
  });

  it('allows selecting different frequencies', () => {
    render(<CreateCircleScreen />);
    const monthlyOption = screen.getByTestId('freq-option-monthly');
    fireEvent.press(monthlyOption);
    expect(monthlyOption.props.accessibilityState?.selected).toBe(true);
  });

  it('shows all frequency options', () => {
    render(<CreateCircleScreen />);
    const frequencies = ['daily', 'every_3_days', 'weekly', 'every_2_weeks', 'monthly'];
    frequencies.forEach((freq) => {
      expect(screen.getByTestId(`freq-option-${freq}`)).toBeTruthy();
    });
  });
});
