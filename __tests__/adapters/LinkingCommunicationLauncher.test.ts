/**
 * Communication launcher tests (issues 038 / #49, 039 / #50).
 *
 * The important assertions are about what is NOT done:
 *   - `canOpenURL` is never called, because it throws on iOS for undeclared
 *     schemes and silently lies on Android (docs/PLATFORM.md §5.3)
 *   - the custom `whatsapp://` scheme is never used; `https://wa.me/` is, so no
 *     Info.plist or <queries> declaration is needed (§5.2)
 *   - launching returns no signal about whether contact happened, because none
 *     exists (docs/DOMAIN.md §9)
 */
const mockOpenURL = jest.fn<Promise<void>, [string]>();
const mockCanOpenURL = jest.fn<Promise<boolean>, [string]>();

jest.mock('react-native', () => ({
  Linking: {
    openURL: (url: string) => mockOpenURL(url),
    canOpenURL: (url: string) => mockCanOpenURL(url),
  },
  Platform: { OS: 'ios' },
}));

import { LinkingCommunicationLauncher } from '../../src/adapters/communication/LinkingCommunicationLauncher';

const launcher = new LinkingCommunicationLauncher();

beforeEach(() => {
  mockOpenURL.mockReset();
  mockCanOpenURL.mockReset();
  mockOpenURL.mockResolvedValue(undefined);
});

describe('call', () => {
  it('opens a tel: link for a valid number', async () => {
    const result = await launcher.call('+447700900123');
    expect(result.outcome).toBe('launched');
    expect(mockOpenURL).toHaveBeenCalledWith('tel:+447700900123');
  });

  it.each(['447700900123', '+44 7700 900123', '07700900123', '', 'not a number'])(
    'rejects %p without calling the platform',
    async (input) => {
      const result = await launcher.call(input);
      expect(result.outcome).toBe('invalid-number');
      expect(mockOpenURL).not.toHaveBeenCalled();
    }
  );

  // On iOS a cancelled confirmation dialog rejects identically to a hard
  // failure, so this genuinely cannot be disambiguated — the outcome says so.
  it('reports cancelled-or-failed when the platform rejects', async () => {
    mockOpenURL.mockRejectedValue(new Error('no handler'));
    const result = await launcher.call('+447700900123');
    expect(result.outcome).toBe('cancelled-or-failed');
    expect(result.detail).toContain('no handler');
  });

  it('does not throw when the platform rejects', async () => {
    mockOpenURL.mockRejectedValue(new Error('boom'));
    await expect(launcher.call('+447700900123')).resolves.toBeDefined();
  });
});

describe('whatsApp', () => {
  // §5.2 — the https link needs no scheme declaration and degrades gracefully.
  it('uses https://wa.me with digits only', async () => {
    const result = await launcher.whatsApp('+447700900123');
    expect(result.outcome).toBe('launched');
    expect(mockOpenURL).toHaveBeenCalledWith('https://wa.me/447700900123');
  });

  it('never uses the whatsapp:// custom scheme', async () => {
    await launcher.whatsApp('+447700900123');
    const url = mockOpenURL.mock.calls[0][0];
    expect(url).not.toContain('whatsapp://');
    expect(url.startsWith('https://')).toBe(true);
  });

  it.each(['447700900123', '+44 7700 900123', '', 'nope'])(
    'rejects %p without calling the platform',
    async (input) => {
      const result = await launcher.whatsApp(input);
      expect(result.outcome).toBe('invalid-number');
      expect(mockOpenURL).not.toHaveBeenCalled();
    }
  );

  it('reports failure gracefully when no browser or app can handle it', async () => {
    mockOpenURL.mockRejectedValue(new Error('nothing to open with'));
    const result = await launcher.whatsApp('+447700900123');
    expect(result.outcome).toBe('cancelled-or-failed');
  });
});

describe('platform trap avoidance', () => {
  // The single most commonly mishandled detail in this area.
  it('never calls canOpenURL', async () => {
    await launcher.call('+447700900123');
    await launcher.whatsApp('+447700900123');
    expect(mockCanOpenURL).not.toHaveBeenCalled();
  });
});

describe('completion is never inferred', () => {
  // docs/DOMAIN.md §9 — the app cannot know whether a call connected or a
  // message was sent, and must not pretend to.
  it('returns no indication that contact occurred', async () => {
    const call = await launcher.call('+447700900123');
    const whats = await launcher.whatsApp('+447700900123');
    for (const result of [call, whats]) {
      expect(Object.keys(result).sort()).toEqual(['outcome']);
      expect(result).not.toHaveProperty('contacted');
      expect(result).not.toHaveProperty('completed');
    }
  });
});
