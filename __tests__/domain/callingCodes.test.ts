/**
 * Region -> calling code lookup.
 *
 * This is reference data, so the tests worth having are the ones that catch a
 * transcription slip or a regression in coverage — not a restatement of every
 * row.
 *
 * The coverage assertion matters more than it looks. The mapping this replaced
 * listed 34 regions, and a missing region is not a soft failure: the calling
 * code is what allows a nationally-formatted number to be normalised, and a
 * contact whose number cannot be normalised is dropped from the picker. On a
 * phone that reads as "the app cannot see my contacts".
 */
import { callingCodeForRegion, KNOWN_REGION_COUNT } from '../../src/domain/contact/callingCodes';
import { normaliseToE164 } from '../../src/domain/contact/phone';

describe('callingCodeForRegion', () => {
  it.each([
    ['GB', '44'],
    ['US', '1'],
    ['PK', '92'],
    ['IN', '91'],
    ['NG', '234'],
    ['BR', '55'],
    ['JP', '81'],
    ['ZA', '27'],
  ])('maps %s to +%s', (region, code) => {
    expect(callingCodeForRegion(region)).toBe(code);
  });

  it('accepts lower case and surrounding space, as locale strings vary', () => {
    expect(callingCodeForRegion('gb')).toBe('44');
    expect(callingCodeForRegion(' pk ')).toBe('92');
  });

  it('returns undefined rather than guessing for an unknown region', () => {
    expect(callingCodeForRegion('ZZ')).toBeUndefined();
    expect(callingCodeForRegion('')).toBeUndefined();
    expect(callingCodeForRegion(null)).toBeUndefined();
    expect(callingCodeForRegion(undefined)).toBeUndefined();
  });

  // The regions the old inline table covered must all still resolve.
  it.each([
    'GB', 'US', 'CA', 'PK', 'IN', 'AE', 'SA', 'AU', 'NZ', 'IE', 'DE', 'FR',
    'ES', 'IT', 'NL', 'SE', 'NO', 'DK', 'ZA', 'NG', 'KE', 'EG', 'TR', 'BD',
    'LK', 'MY', 'SG', 'ID', 'PH', 'JP', 'KR', 'CN', 'BR', 'MX',
  ])('still covers %s, which the previous table listed', (region) => {
    expect(callingCodeForRegion(region)).toBeDefined();
  });

  it('covers essentially every ISO 3166-1 region, not a handful', () => {
    expect(KNOWN_REGION_COUNT).toBeGreaterThan(190);
  });

  it('contains only digit-strings without a leading plus', () => {
    for (const region of ['GB', 'US', 'PK', 'XK', 'ZW']) {
      expect(callingCodeForRegion(region)).toMatch(/^[0-9]{1,4}$/);
    }
  });
});

describe('the lookup is what makes national numbers usable', () => {
  // The end-to-end point of the table: without a calling code, a national
  // number is rejected and the contact disappears from the picker.
  it('normalises a national number once the region is known', () => {
    const code = callingCodeForRegion('PK');
    expect(normaliseToE164('0300 1234567', code)).toEqual({
      ok: true,
      e164: '+923001234567',
    });
  });

  it('rejects the same number when the region is unknown', () => {
    const result = normaliseToE164('0300 1234567', callingCodeForRegion('ZZ'));
    expect(result.ok).toBe(false);
  });

  it('leaves an international number alone either way', () => {
    expect(normaliseToE164('+92 300 1234567', undefined)).toEqual({
      ok: true,
      e164: '+923001234567',
    });
  });
});
