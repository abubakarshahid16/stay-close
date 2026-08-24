/**
 * E.164 normalisation tests.
 *
 * Worth being thorough: phone_e164 is the durable identity key, so a
 * normalisation bug means either duplicate people or a WhatsApp link that
 * silently fails (docs/PLATFORM.md §5.2).
 */
import {
  normaliseToE164,
  toWaMeDigits,
  isE164,
  selectPrimaryNumber,
} from '../../src/domain/contact/phone';

describe('normaliseToE164 — already international', () => {
  it.each([
    ['+447700900123', '+447700900123'],
    ['+44 7700 900123', '+447700900123'],
    ['+1 (555) 123-4567', '+15551234567'],
    ['+92-300-1234567', '+923001234567'],
    ['  +447700900123  ', '+447700900123'],
    ['+44.7700.900123', '+447700900123'],
  ])('normalises %p to %p', (raw, expected) => {
    const result = normaliseToE164(raw);
    expect(result).toEqual({ ok: true, e164: expected });
  });

  it('treats a 00 prefix as an international prefix', () => {
    expect(normaliseToE164('00447700900123')).toEqual({ ok: true, e164: '+447700900123' });
    expect(normaliseToE164('00 44 7700 900123')).toEqual({ ok: true, e164: '+447700900123' });
  });
});

describe('normaliseToE164 — national format', () => {
  // The leading zero is a domestic dialling artefact and never part of E.164.
  it('drops the trunk prefix and prepends the calling code', () => {
    expect(normaliseToE164('07700 900123', '44')).toEqual({ ok: true, e164: '+447700900123' });
    expect(normaliseToE164('0300-1234567', '92')).toEqual({ ok: true, e164: '+923001234567' });
  });

  it('accepts a calling code written with a plus', () => {
    expect(normaliseToE164('07700900123', '+44')).toEqual({ ok: true, e164: '+447700900123' });
  });

  it('prepends the calling code to a bare national number', () => {
    expect(normaliseToE164('7700900123', '44')).toEqual({ ok: true, e164: '+447700900123' });
  });

  it('does not double the calling code when it is already present', () => {
    expect(normaliseToE164('447700900123', '44')).toEqual({ ok: true, e164: '+447700900123' });
  });

  it('strips multiple leading zeros in national format', () => {
    expect(normaliseToE164('007700900123', '44').ok).toBe(true);
  });

  // Guessing a region would create duplicate people for the same human.
  it('refuses to guess a region when none is supplied', () => {
    expect(normaliseToE164('07700900123')).toEqual({ ok: false, reason: 'NO_COUNTRY_CODE' });
    expect(normaliseToE164('7700900123')).toEqual({ ok: false, reason: 'NO_COUNTRY_CODE' });
  });

  it('treats a blank calling code as absent', () => {
    expect(normaliseToE164('07700900123', '   ')).toEqual({
      ok: false,
      reason: 'NO_COUNTRY_CODE',
    });
  });
});

describe('normaliseToE164 — rejections', () => {
  it.each([
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    ['---', 'EMPTY'],
    ['+44 123', 'TOO_SHORT'],
    ['+4412345678901234567', 'TOO_LONG'],
    ['0800-FLOWERS', 'NOT_A_NUMBER'],
    ['not a phone', 'NOT_A_NUMBER'],
    ['Mum mobile', 'NOT_A_NUMBER'],
  ])('rejects %p with %s', (raw, reason) => {
    expect(normaliseToE164(raw, '44')).toEqual({ ok: false, reason });
  });

  it('rejects a non-string input without throwing', () => {
    // Device data is not guaranteed to be well-typed at runtime.
    expect(normaliseToE164(null as unknown as string)).toEqual({
      ok: false,
      reason: 'NOT_A_NUMBER',
    });
    expect(normaliseToE164(undefined as unknown as string)).toEqual({
      ok: false,
      reason: 'NOT_A_NUMBER',
    });
  });

  it('enforces the 15-digit E.164 ceiling exactly', () => {
    expect(normaliseToE164(`+${'1'.repeat(15)}`).ok).toBe(true);
    expect(normaliseToE164(`+${'1'.repeat(16)}`)).toEqual({ ok: false, reason: 'TOO_LONG' });
  });
});

describe('normaliseToE164 — stability', () => {
  // Idempotence is what stops re-syncing a contact from creating a duplicate.
  it('is idempotent', () => {
    const once = normaliseToE164('+44 7700 900123');
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    expect(normaliseToE164(once.e164)).toEqual(once);
  });

  it('maps every formatting of the same number to one key', () => {
    const forms = [
      '+447700900123',
      '+44 7700 900123',
      '+44-7700-900123',
      '+44 (7700) 900123',
      '00447700900123',
      '07700 900123',
      '447700900123',
    ];
    const results = forms.map((f) => normaliseToE164(f, '44'));
    expect(results.every((r) => r.ok)).toBe(true);
    const unique = new Set(results.map((r) => (r.ok ? r.e164 : 'FAIL')));
    expect([...unique]).toEqual(['+447700900123']);
  });
});

describe('toWaMeDigits', () => {
  it('strips the plus, as wa.me requires', () => {
    expect(toWaMeDigits('+447700900123')).toBe('447700900123');
    expect(toWaMeDigits('+15551234567')).toBe('15551234567');
  });
});

describe('isE164', () => {
  it.each([
    ['+447700900123', true],
    ['+1234567', true],
    ['447700900123', false],
    ['+44 7700 900123', false],
    ['+123456', false],
    ['+1234567890123456', false],
    ['', false],
  ])('isE164(%p) === %p', (value, expected) => {
    expect(isE164(value)).toBe(expected);
  });
});

describe('selectPrimaryNumber', () => {
  it('takes the first number that normalises', () => {
    expect(
      selectPrimaryNumber([{ raw: 'Home phone' }, { raw: '+447700900123' }], '44')
    ).toBe('+447700900123');
  });

  it('respects device ordering rather than second-guessing by label', () => {
    expect(
      selectPrimaryNumber([{ raw: '+447700900111' }, { raw: '+447700900222' }], '44')
    ).toBe('+447700900111');
  });

  it('returns null when nothing usable exists', () => {
    expect(selectPrimaryNumber([], '44')).toBeNull();
    expect(selectPrimaryNumber([{ raw: 'n/a' }, { raw: '' }], '44')).toBeNull();
  });
});
