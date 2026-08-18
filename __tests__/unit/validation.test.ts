import {
  validateCircleName,
  validateReminderFrequency,
  validateDisplayName,
  sanitizeInput,
  isValidISODate,
} from '../../src/utils/validation';

describe('validateCircleName', () => {
  it('accepts a valid name', () => {
    expect(validateCircleName('Family')).toBeNull();
  });

  it('accepts name at max length', () => {
    expect(validateCircleName('A'.repeat(100))).toBeNull();
  });

  it('rejects empty string', () => {
    expect(validateCircleName('')).not.toBeNull();
  });

  it('rejects whitespace-only string', () => {
    expect(validateCircleName('   ')).not.toBeNull();
  });

  it('rejects name exceeding 100 characters', () => {
    expect(validateCircleName('A'.repeat(101))).not.toBeNull();
  });

  it('accepts Unicode name', () => {
    expect(validateCircleName('عائلة')).toBeNull();
  });

  it('accepts emoji in name', () => {
    expect(validateCircleName('Family 💙')).toBeNull();
  });

  it('trims whitespace before checking', () => {
    expect(validateCircleName('  ')).not.toBeNull();
  });
});

describe('validateReminderFrequency', () => {
  const valid = ['daily', 'every_3_days', 'weekly', 'every_2_weeks', 'monthly'] as const;

  valid.forEach((freq) => {
    it(`accepts: ${freq}`, () => {
      expect(validateReminderFrequency(freq)).toBe(true);
    });
  });

  it('rejects unknown frequency', () => {
    expect(validateReminderFrequency('hourly')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateReminderFrequency('')).toBe(false);
  });

  it('rejects SQL injection attempt', () => {
    expect(validateReminderFrequency("weekly'; DROP TABLE circles; --")).toBe(false);
  });
});

describe('validateDisplayName', () => {
  it('accepts a valid name', () => {
    expect(validateDisplayName('Alex Example')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(validateDisplayName('')).not.toBeNull();
  });

  it('rejects whitespace-only', () => {
    expect(validateDisplayName('   ')).not.toBeNull();
  });
});

describe('sanitizeInput', () => {
  it('trims whitespace', () => {
    expect(sanitizeInput('  hello  ')).toBe('hello');
  });

  it('truncates at maxLength', () => {
    expect(sanitizeInput('abcde', 3)).toBe('abc');
  });

  it('does not modify safe input', () => {
    expect(sanitizeInput('normal text')).toBe('normal text');
  });
});

describe('isValidISODate', () => {
  it('accepts a valid ISO date', () => {
    expect(isValidISODate('2024-06-01T09:00:00.000Z')).toBe(true);
  });

  it('rejects invalid string', () => {
    expect(isValidISODate('not-a-date')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidISODate('')).toBe(false);
  });
});
