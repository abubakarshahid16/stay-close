/**
 * Group name validation. Pure.
 *
 * Mirrors the CHECK constraint in migration 001 so the user gets a useful
 * message instead of an opaque SQLite error.
 */
import { domainError, err, ok, type Result } from '../shared/Result';

export const MAX_GROUP_NAME_LENGTH = 100;

export function validateGroupName(name: string): Result<string> {
  if (typeof name !== 'string') {
    return err(domainError('INVALID_GROUP_NAME', 'Group name must be text.'));
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return err(domainError('INVALID_GROUP_NAME', 'Group name cannot be empty.'));
  }
  if (trimmed.length > MAX_GROUP_NAME_LENGTH) {
    return err(
      domainError(
        'INVALID_GROUP_NAME',
        `Group name cannot exceed ${MAX_GROUP_NAME_LENGTH} characters.`
      )
    );
  }
  return ok(trimmed);
}
