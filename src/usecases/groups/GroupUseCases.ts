/**
 * Group and membership use cases (issues 013 / #24, 014 / #25, 015 / #26).
 *
 * The deletion and removal paths are the delicate ones. docs/DOMAIN.md §3 and
 * §8.4 require that removing a group or a member:
 *   - cancels FUTURE scheduling and unresolved reminders,
 *   - preserves all history,
 *   - never touches the native phone contact,
 *   - never affects the person's other groups.
 *
 * Cancellation must happen BEFORE the delete, because once the group row is
 * gone its reminders have group_id = NULL and can no longer be found by group.
 * Both steps run in one transaction so a partial cancel cannot be observed.
 */
import type { Clock } from '../../ports/Clock';
import type { UnitOfWork } from '../../ports/repositories';
import type { Group, Membership } from '../../domain/entities';
import { validateGroupName } from '../../domain/group/validation';
import { domainError, err, ok, type Result } from '../../domain/shared/Result';
import {
  nativeContactId,
  type ContactReferenceId,
  type GroupId,
  type MembershipId,
} from '../../domain/shared/ids';

export const CANCEL_REASON_GROUP_DELETED = 'group_deleted';
export const CANCEL_REASON_MEMBERSHIP_REMOVED = 'membership_removed';

export interface DeleteGroupOutcome {
  readonly cancelledReminders: number;
}

export interface RemoveMemberOutcome {
  readonly cancelledReminders: number;
}

export class GroupUseCases {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock
  ) {}

  async create(name: string): Promise<Result<Group>> {
    const validated = validateGroupName(name);
    if (!validated.ok) return validated;
    const group = await this.uow.repositories.groups.create(validated.value, this.clock.now());
    return ok(group);
  }

  async rename(id: GroupId, name: string): Promise<Result<Group>> {
    const validated = validateGroupName(name);
    if (!validated.ok) return validated;

    const existing = await this.uow.repositories.groups.findById(id);
    if (!existing) return err(domainError('NOT_FOUND', `Group ${id} does not exist.`));

    await this.uow.repositories.groups.rename(id, validated.value, this.clock.now());
    return ok((await this.uow.repositories.groups.findById(id)) as Group);
  }

  async list(): Promise<Group[]> {
    return this.uow.repositories.groups.findAll();
  }

  async get(id: GroupId): Promise<Group | null> {
    return this.uow.repositories.groups.findById(id);
  }

  /**
   * Delete a group. Cancels its unresolved reminders first, then deletes,
   * cascading memberships and schedules. History and contacts survive.
   */
  async delete(id: GroupId): Promise<Result<DeleteGroupOutcome>> {
    const existing = await this.uow.repositories.groups.findById(id);
    if (!existing) return err(domainError('NOT_FOUND', `Group ${id} does not exist.`));

    const now = this.clock.now();
    const cancelled = await this.uow.transaction(async (repos) => {
      // Order matters: after the delete, group_id is NULL on these rows.
      const count = await repos.reminders.cancelPendingForGroup(
        id,
        CANCEL_REASON_GROUP_DELETED,
        now
      );
      await repos.groups.delete(id);
      return count;
    });

    return ok({ cancelledReminders: cancelled });
  }

  /**
   * Add a person to a group by phone number.
   *
   * The contact reference is upserted on the normalised number, so adding
   * someone who is already in another group reuses the same person rather than
   * creating a duplicate (docs/DOMAIN.md §2 rule 6).
   */
  async addMember(
    groupId: GroupId,
    input: { phoneE164: string; displayName: string; nativeId: string | null }
  ): Promise<Result<Membership>> {
    const group = await this.uow.repositories.groups.findById(groupId);
    if (!group) return err(domainError('NOT_FOUND', `Group ${groupId} does not exist.`));

    const displayName = input.displayName.trim();
    if (displayName.length === 0) {
      return err(domainError('INVALID_PHONE_NUMBER', 'A person needs a display name.'));
    }

    const now = this.clock.now();
    const membership = await this.uow.transaction(async (repos) => {
      const contact = await repos.contacts.ensure(
        {
          nativeId: input.nativeId === null ? null : nativeContactId(input.nativeId),
          phoneE164: input.phoneE164,
          displayNameCache: displayName,
        },
        now
      );
      return repos.memberships.add(groupId, contact.id, now);
    });

    return ok(membership);
  }

  async listMembers(groupId: GroupId, activeOnly = false): Promise<Membership[]> {
    return this.uow.repositories.memberships.findByGroup(groupId, activeOnly);
  }

  async memberCount(groupId: GroupId, activeOnly = false): Promise<number> {
    return this.uow.repositories.memberships.countByGroup(groupId, activeOnly);
  }

  /**
   * Remove one person from one group.
   *
   * Cancels only that person's unresolved reminders in that group. Their
   * memberships elsewhere, their history, and the native contact are untouched.
   */
  async removeMember(
    groupId: GroupId,
    contactReferenceId: ContactReferenceId
  ): Promise<Result<RemoveMemberOutcome>> {
    const membership = await this.uow.repositories.memberships.find(groupId, contactReferenceId);
    if (!membership) {
      return err(
        domainError('MEMBERSHIP_NOT_FOUND', 'That person is not a member of this group.')
      );
    }

    const now = this.clock.now();
    const cancelled = await this.uow.transaction(async (repos) => {
      const count = await repos.reminders.cancelPendingForMembership(
        groupId,
        contactReferenceId,
        CANCEL_REASON_MEMBERSHIP_REMOVED,
        now
      );
      await repos.memberships.remove(membership.id);
      return count;
    });

    return ok({ cancelledReminders: cancelled });
  }

  /**
   * Deactivate rather than remove. Keeps the membership row for reference while
   * excluding the person from future selection.
   */
  async setMemberActive(id: MembershipId, active: boolean): Promise<void> {
    await this.uow.repositories.memberships.setActive(id, active, this.clock.now());
  }

  /** Every group a person belongs to. */
  async groupsForContact(contactReferenceId: ContactReferenceId): Promise<Group[]> {
    const memberships =
      await this.uow.repositories.memberships.findByContact(contactReferenceId);
    const groups: Group[] = [];
    for (const membership of memberships) {
      const group = await this.uow.repositories.groups.findById(membership.groupId);
      if (group) groups.push(group);
    }
    return groups;
  }
}
