/**
 * App bootstrap and container context.
 *
 * Owns the one piece of genuinely tricky UI state: the database may not open.
 * Rather than crash or silently recreate it, the app surfaces the failure and
 * offers retry — a corrupt database may hold years of relationship history
 * (docs/ARCHITECTURE.md §6, `prepareDatabase`).
 *
 * Screens read use cases from here and construct nothing themselves.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Localization from 'expo-localization';
import { createContainer, type Container } from '../container';
import { ExpoSqlDriver } from '../adapters/persistence/ExpoSqlDriver';
import { prepareDatabase, type DatabaseStatus } from '../adapters/persistence/prepareDatabase';
import { ExpoContactProvider } from '../adapters/contacts/ExpoContactProvider';
import { ExpoNotificationScheduler } from '../adapters/notifications/ExpoNotificationScheduler';
import { WebContactProvider } from '../adapters/contacts/WebContactProvider';
import { WebNotificationScheduler } from '../adapters/notifications/WebNotificationScheduler';
import { LinkingCommunicationLauncher } from '../adapters/communication/LinkingCommunicationLauncher';
import { SystemClock } from '../adapters/system/SystemClock';
import { CryptoRandom } from '../adapters/system/CryptoRandom';
import type { StartupOutcome } from '../app/startup/StartupReconciliation';

/**
 * Only the non-ready variants can accompany a failure. Narrowing the type here
 * rather than guarding at the use site makes "failed but ready" unrepresentable.
 */
export type DatabaseFailure = Exclude<DatabaseStatus, { kind: 'ready' }>;

export type BootState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'failed'; readonly status: DatabaseFailure }
  | {
      readonly phase: 'ready';
      readonly container: Container;
      readonly startup: StartupOutcome;
    };

interface AppContextValue {
  readonly boot: BootState;
  /** Re-run bootstrap. Offered when the database could not be opened. */
  readonly retry: () => void;
  /** Re-run startup reconciliation, e.g. when the app returns to foreground. */
  readonly refresh: () => Promise<void>;
}

const AppContext = createContext<AppContextValue>({
  boot: { phase: 'loading' },
  retry: () => {},
  refresh: async () => {},
});

/**
 * Region for normalising national-format phone numbers. Derived from device
 * locale; without it a national number cannot be normalised and is rejected
 * rather than guessed (src/domain/contact/phone.ts).
 */
function deviceCallingCode(): string | undefined {
  const region = Localization.getLocales()[0]?.regionCode ?? undefined;
  if (!region) return undefined;
  // A small table rather than a dependency. Unlisted regions fall back to
  // requiring international-format numbers, which is safe.
  const codes: Record<string, string> = {
    GB: '44', US: '1', CA: '1', PK: '92', IN: '91', AE: '971', SA: '966',
    AU: '61', NZ: '64', IE: '353', DE: '49', FR: '33', ES: '34', IT: '39',
    NL: '31', SE: '46', NO: '47', DK: '45', ZA: '27', NG: '234', KE: '254',
    EG: '20', TR: '90', BD: '880', LK: '94', MY: '60', SG: '65', ID: '62',
    PH: '63', JP: '81', KR: '82', CN: '86', BR: '55', MX: '52',
  };
  return codes[region];
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [boot, setBoot] = useState<BootState>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setBoot({ phase: 'loading' });
      try {
        const db = await ExpoSqlDriver.open();
        const status = await prepareDatabase(db);
        if (cancelled) return;

        if (status.kind !== 'ready') {
          setBoot({ phase: 'failed', status });
          return;
        }

        // Web has no address-book API and no scheduled-notification API, so it
        // gets adapters that say so rather than ones that pretend
        // (WebContactProvider, WebNotificationScheduler).
        const isWeb = Platform.OS === 'web';

        const container = createContainer({
          clock: new SystemClock(),
          random: new CryptoRandom(),
          contacts: isWeb
            ? new WebContactProvider()
            : new ExpoContactProvider(deviceCallingCode()),
          notifications: isWeb
            ? new WebNotificationScheduler()
            : new ExpoNotificationScheduler(),
          communication: new LinkingCommunicationLauncher(),
          db,
        });

        // Generates any cycles missed while the app was closed, and repairs
        // notification drift. Isolated steps: a failure here does not block
        // the app from opening.
        const startup = await container.startup.run();
        if (cancelled) return;

        setBoot({ phase: 'ready', container, startup });
      } catch (error) {
        if (cancelled) return;
        setBoot({
          phase: 'failed',
          status: {
            kind: 'unavailable',
            detail: error instanceof Error ? error.message : String(error),
          },
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const refresh = useCallback(async () => {
    if (boot.phase !== 'ready') return;
    const startup = await boot.container.startup.run();
    setBoot({ phase: 'ready', container: boot.container, startup });
  }, [boot]);

  return (
    <AppContext.Provider value={{ boot, retry, refresh }}>{children}</AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  return useContext(AppContext);
}

/**
 * Container accessor for screens that only render once boot succeeded.
 * Throws rather than returning null so a screen cannot silently no-op.
 */
export function useContainer(): Container {
  const { boot } = useApp();
  if (boot.phase !== 'ready') {
    throw new Error('useContainer called before the app finished loading');
  }
  return boot.container;
}
