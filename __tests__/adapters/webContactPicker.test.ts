/**
 * The Contact Picker API on web.
 *
 * A browser cannot read the address book — that part was always true, and is why
 * this provider reports `unavailable`. But it is not the whole truth: Chrome on
 * Android implements the Contact Picker API, where the BROWSER shows the contact
 * list and the page receives only the person chosen. No permission prompt, no
 * ongoing access, which is exactly why it is allowed to exist.
 *
 * Feature-detected rather than sniffed from the user agent, and tested here
 * because it cannot be tested in a real browser from this machine: Playwright's
 * Chromium does not expose the API even under an Android device profile, since
 * device emulation does not enable Android-only APIs. So the detection and the
 * mapping are verified against a stub of the documented shape, and the honest
 * limit is that a real Android phone is the only place the end-to-end path can
 * be confirmed.
 */
import { WebContactProvider } from '../../src/adapters/contacts/WebContactProvider';

type Selected = { name?: string[]; tel?: string[] };

/** Installs a stub Contact Picker API shaped like the real one. */
function withPicker(result: Selected[] | null | (() => never)) {
  const select = jest.fn(async () => {
    if (typeof result === 'function') result();
    return (result ?? []) as Selected[];
  });
  (globalThis as { navigator?: unknown }).navigator = { contacts: { select } };
  return select;
}

function withoutPicker() {
  (globalThis as { navigator?: unknown }).navigator = {};
}

const originalNavigator = (globalThis as { navigator?: unknown }).navigator;

afterEach(() => {
  (globalThis as { navigator?: unknown }).navigator = originalNavigator;
});

describe('detecting the picker', () => {
  it('reports no picker in a browser without the API', () => {
    withoutPicker();
    expect(new WebContactProvider().canPick()).toBe(false);
  });

  it('reports a picker when the API is present', () => {
    withPicker([]);
    expect(new WebContactProvider().canPick()).toBe(true);
  });

  it('does not offer a picker it cannot use', async () => {
    withoutPicker();
    // The button must not appear, and calling it anyway must not throw.
    await expect(new WebContactProvider().pickOne()).resolves.toBeNull();
  });
});

describe('reading the chosen contact', () => {
  it('asks only for a name and a number', async () => {
    const select = withPicker([{ name: ['Ahmed'], tel: ['+447700900123'] }]);
    await new WebContactProvider().pickOne();

    // Requesting more than is needed would be a privacy regression, and the
    // browser shows the user exactly what was requested.
    expect(select).toHaveBeenCalledWith(['name', 'tel'], { multiple: false });
  });

  it('returns the person, with the number normalised', async () => {
    withPicker([{ name: ['Ahmed'], tel: ['+44 7700 900123'] }]);
    const picked = await new WebContactProvider().pickOne();

    expect(picked?.displayName).toBe('Ahmed');
    expect(picked?.phones[0].e164).toBe('+447700900123');
    expect(picked?.phones[0].raw).toBe('+44 7700 900123');
  });

  // The same reason the native side needs a calling code: a nationally
  // formatted number cannot be normalised without knowing the country, and
  // guessing would create someone under the wrong number.
  it('normalises a national number using the device region', async () => {
    withPicker([{ name: ['Ahmed'], tel: ['0300 1234567'] }]);
    const picked = await new WebContactProvider('92').pickOne();
    expect(picked?.phones[0].e164).toBe('+923001234567');
  });

  it('keeps an unreadable number rather than dropping the person', async () => {
    withPicker([{ name: ['Ahmed'], tel: ['0300 1234567'] }]);
    const picked = await new WebContactProvider().pickOne();

    // No calling code, so it cannot be normalised — but the contact is still
    // returned so the screen can say why, instead of silently showing nothing.
    expect(picked?.displayName).toBe('Ahmed');
    expect(picked?.phones[0].e164).toBeNull();
    expect(picked?.phones[0].raw).toBe('0300 1234567');
  });

  it('falls back to the number when the contact has no name', async () => {
    withPicker([{ tel: ['+447700900123'] }]);
    expect((await new WebContactProvider().pickOne())?.displayName).toBe('+447700900123');
  });

  it('ignores blank names the browser may return', async () => {
    withPicker([{ name: ['', '  ', 'Ahmed'], tel: ['+447700900123'] }]);
    expect((await new WebContactProvider().pickOne())?.displayName).toBe('Ahmed');
  });
});

describe('when nothing is chosen', () => {
  it('returns null on cancellation', async () => {
    withPicker([]);
    expect(await new WebContactProvider().pickOne()).toBeNull();
  });

  it('returns null for a contact with neither name nor number', async () => {
    withPicker([{}]);
    expect(await new WebContactProvider().pickOne()).toBeNull();
  });

  // The API rejects when called outside a user gesture, among other cases. That
  // must degrade to manual entry, never surface as a crash.
  it('returns null when the browser refuses', async () => {
    withPicker(() => {
      throw new Error('must be handling a user gesture');
    });
    await expect(new WebContactProvider().pickOne()).resolves.toBeNull();
  });
});

describe('what has not changed', () => {
  it('still reports the address book as unavailable', async () => {
    withPicker([]);
    const provider = new WebContactProvider();

    // A picker is not address-book access. Reporting anything else would make
    // the screen offer a searchable list it cannot populate, and claim a
    // permission prompt that never happens.
    expect(await provider.permission()).toEqual({ state: 'unavailable', canAskAgain: false });
    expect(await provider.resolve('anything' as never)).toBeNull();
    expect(await provider.findByPhone('+447700900123')).toBeNull();
    expect(await provider.list()).toEqual([]);
  });
});
