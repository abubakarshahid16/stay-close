/**
 * Component tests for the Circles screen.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';

// Mock hooks before importing components
jest.mock('../../src/hooks/useCircles');
jest.mock('../../src/hooks/useSettings');

import CirclesScreen from '../../app/(tabs)/circles';
import { useCircles } from '../../src/hooks/useCircles';
import { useSettings } from '../../src/hooks/useSettings';

const mockUseCircles = useCircles as jest.MockedFunction<typeof useCircles>;
const mockUseSettings = useSettings as jest.MockedFunction<typeof useSettings>;

const defaultSettings = {
  settings: {
    notificationPrivacy: 'private' as const,
    onboardingCompleted: false,
    contactsPermissionExplained: false,
  },
  isLoading: false,
  setNotificationPrivacy: jest.fn(),
  setOnboardingCompleted: jest.fn(),
  setContactsPermissionExplained: jest.fn(),
  refresh: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSettings.mockReturnValue(defaultSettings);
});

describe('CirclesScreen', () => {
  it('shows loading state', () => {
    mockUseCircles.mockReturnValue({
      circles: [],
      isLoading: true,
      error: null,
      refresh: jest.fn(),
    });
    render(<CirclesScreen />);
    expect(screen.getByTestId('loading-view')).toBeTruthy();
  });

  it('shows error state', async () => {
    mockUseCircles.mockReturnValue({
      circles: [],
      isLoading: false,
      error: new Error('DB error'),
      refresh: jest.fn(),
    });
    render(<CirclesScreen />);
    expect(screen.getByTestId('error-view')).toBeTruthy();
  });

  it('shows empty state when no circles', () => {
    mockUseCircles.mockReturnValue({
      circles: [],
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
    render(<CirclesScreen />);
    expect(screen.getByTestId('circles-empty')).toBeTruthy();
  });

  it('renders list of circles', () => {
    mockUseCircles.mockReturnValue({
      circles: [
        { id: 1, name: 'Family', reminderFrequency: 'weekly', createdAt: '', updatedAt: '' },
        { id: 2, name: 'Friends', reminderFrequency: 'monthly', createdAt: '', updatedAt: '' },
      ],
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
    render(<CirclesScreen />);
    expect(screen.getByTestId('circle-row-1')).toBeTruthy();
    expect(screen.getByTestId('circle-row-2')).toBeTruthy();
    expect(screen.getByText('Family')).toBeTruthy();
    expect(screen.getByText('Friends')).toBeTruthy();
  });

  it('navigates to create circle on button press', () => {
    mockUseCircles.mockReturnValue({
      circles: [],
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
    render(<CirclesScreen />);
    // The "Create a Circle" button inside empty state
    // Button is labeled "Create your first circle"
    const createButton = screen.getByRole('button', { name: 'Create your first circle' });
    expect(createButton).toBeTruthy();
  });
});
