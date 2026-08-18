import type { ReminderFrequency } from '../types/circle';
import { REMINDER_FREQUENCIES } from '../types/circle';

export const MAX_CIRCLE_NAME_LENGTH = 100;
export const MAX_BACKUP_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export function validateCircleName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length === 0) {
    return 'Circle name cannot be empty';
  }
  if (trimmed.length > MAX_CIRCLE_NAME_LENGTH) {
    return `Circle name cannot exceed ${MAX_CIRCLE_NAME_LENGTH} characters`;
  }
  return null;
}

export function validateReminderFrequency(value: string): value is ReminderFrequency {
  return (REMINDER_FREQUENCIES as readonly string[]).includes(value);
}

export function validateDisplayName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length === 0) {
    return 'Display name cannot be empty';
  }
  return null;
}

export function sanitizeInput(input: string, maxLength: number = 500): string {
  return input.trim().slice(0, maxLength);
}

export function isValidISODate(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}
