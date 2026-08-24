/**
 * Phone number normalisation to E.164.
 *
 * This matters more than it looks. `phone_e164` is the durable identity anchor
 * for a person (docs/DATABASE.md §2.1) and the input to WhatsApp deep links,
 * where a malformed number is the primary cause of failure
 * (docs/PLATFORM.md §5.2). Getting it wrong means either duplicate people or
 * a dead "Message" button.
 *
 * Deliberately NOT a libphonenumber replacement. It does not validate that a
 * number is assignable, know per-country lengths, or parse extensions. It
 * performs the specific normalisation this product needs, and reports failure
 * rather than guessing.
 *
 * Pure: no clock, no I/O, no platform.
 */

/** A country calling code without the leading '+', e.g. '44', '1', '92'. */
export type CallingCode = string;

export type PhoneNormalisationError =
  | 'EMPTY'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'NO_COUNTRY_CODE'
  | 'NOT_A_NUMBER';

export type PhoneNormalisationResult =
  | { readonly ok: true; readonly e164: string }
  | { readonly ok: false; readonly reason: PhoneNormalisationError };

/**
 * E.164 allows at most 15 digits including the country code. The lower bound is
 * deliberately permissive — short national numbers exist — we only reject
 * lengths that cannot be a real international number.
 */
const MAX_E164_DIGITS = 15;
const MIN_E164_DIGITS = 7;

/**
 * Normalise a raw phone number to E.164.
 *
 * @param raw               The number as stored on the device.
 * @param defaultCallingCode Calling code to assume for a national-format
 *                           number, derived from device region. Without it, a
 *                           national number cannot be normalised and is
 *                           rejected rather than guessed.
 */
export function normaliseToE164(
  raw: string,
  defaultCallingCode?: CallingCode
): PhoneNormalisationResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'NOT_A_NUMBER' };

  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'EMPTY' };

  // Reject letters outright. Vanity numbers ("0800-FLOWERS") and labels stored
  // in a phone field are not numbers we can dial reliably.
  if (/[a-z]/i.test(trimmed)) return { ok: false, reason: 'NOT_A_NUMBER' };

  // Keep the digits and note whether the number was written in international
  // form. Extracting digits rather than stripping a blacklist of separators
  // means every formatting quirk a contacts app might produce — spaces,
  // hyphens, typographic dashes, non-breaking spaces, brackets, slashes,
  // dots — is handled without enumerating them.
  const isInternational = trimmed.startsWith('+');
  const allDigits = trimmed.replace(/\D/g, '');
  if (allDigits.length === 0) return { ok: false, reason: 'EMPTY' };

  let digits: string;

  if (isInternational) {
    digits = allDigits;
  } else if (allDigits.startsWith('00')) {
    // Common international access prefix; '00' plays the role of '+'.
    digits = allDigits.slice(2);
  } else if (allDigits.startsWith('0')) {
    // National format with a trunk prefix. The leading zero is a domestic
    // dialling artefact and is never part of the E.164 number.
    const code = normaliseCallingCode(defaultCallingCode);
    if (!code) return { ok: false, reason: 'NO_COUNTRY_CODE' };
    digits = code + allDigits.replace(/^0+/, '');
  } else {
    // No prefix at all. Could already include a country code, or be a bare
    // national number — indistinguishable without region context, so require
    // an explicit default and prepend it.
    const code = normaliseCallingCode(defaultCallingCode);
    if (!code) return { ok: false, reason: 'NO_COUNTRY_CODE' };
    digits = allDigits.startsWith(code) ? allDigits : code + allDigits;
  }

  if (digits.length === 0) return { ok: false, reason: 'EMPTY' };
  if (digits.length < MIN_E164_DIGITS) return { ok: false, reason: 'TOO_SHORT' };
  if (digits.length > MAX_E164_DIGITS) return { ok: false, reason: 'TOO_LONG' };

  return { ok: true, e164: `+${digits}` };
}

function normaliseCallingCode(code?: CallingCode): string | null {
  if (!code) return null;
  const digits = code.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

/**
 * Digits only, no leading '+'. This is the exact form https://wa.me/ requires
 * (docs/PLATFORM.md §5.2).
 */
export function toWaMeDigits(e164: string): string {
  return e164.replace(/\D/g, '');
}

/** Whether a string is already in canonical E.164 form. */
export function isE164(value: string): boolean {
  return /^\+\d{7,15}$/.test(value);
}

/**
 * Pick the best number for a person from the device's list.
 *
 * Preference order: the first entry that normalises successfully. Device
 * ordering already reflects the user's own primary-number choice, so we do not
 * second-guess it by label — labels are inconsistent and localised.
 */
export function selectPrimaryNumber(
  candidates: readonly { readonly raw: string }[],
  defaultCallingCode?: CallingCode
): string | null {
  for (const candidate of candidates) {
    const result = normaliseToE164(candidate.raw, defaultCallingCode);
    if (result.ok) return result.e164;
  }
  return null;
}
