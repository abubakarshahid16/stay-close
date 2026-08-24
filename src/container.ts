/**
 * Composition root (docs/ARCHITECTURE.md §9).
 *
 * The only place in the codebase that names concrete adapters. Screens receive
 * use cases through React context and never construct anything themselves —
 * that is what keeps the lint rule in §2.1 satisfiable and the use cases
 * testable with fakes.
 */
import type { Clock } from './ports/Clock';
import type { Random } from './ports/Random';
import type { ContactProvider } from './ports/ContactProvider';
import type { NotificationScheduler } from './ports/NotificationScheduler';
import type { CommunicationLauncher } from './ports/CommunicationLauncher';
import type { SqlDriver } from './ports/SqlDriver';
import type { UnitOfWork } from './ports/repositories';

import { SqlUnitOfWork } from './adapters/persistence/SqlRepositories';
import { GroupUseCases } from './app/groups/GroupUseCases';
import { ScheduleUseCases } from './app/schedules/ScheduleUseCases';
import { RunScheduler } from './app/scheduler/RunScheduler';
import { ReminderUseCases } from './app/reminders/ReminderUseCases';
import { ReconcileNotifications } from './app/notifications/ReconcileNotifications';
import { SyncContactReferences } from './app/contacts/SyncContactReferences';
import { StartupReconciliation } from './app/startup/StartupReconciliation';
import { HistoryQueries } from './app/history/HistoryQueries';

export interface Adapters {
  readonly clock: Clock;
  readonly random: Random;
  readonly contacts: ContactProvider;
  readonly notifications: NotificationScheduler;
  readonly communication: CommunicationLauncher;
  readonly db: SqlDriver;
}

export interface Container {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly contactsProvider: ContactProvider;
  readonly communication: CommunicationLauncher;
  readonly groups: GroupUseCases;
  readonly schedules: ScheduleUseCases;
  readonly scheduler: RunScheduler;
  readonly reminders: ReminderUseCases;
  readonly notifications: ReconcileNotifications;
  readonly sync: SyncContactReferences;
  readonly startup: StartupReconciliation;
  readonly history: HistoryQueries;
}

export function createContainer(adapters: Adapters): Container {
  const uow = new SqlUnitOfWork(adapters.db);

  const sync = new SyncContactReferences(uow, adapters.contacts, adapters.clock);
  const scheduler = new RunScheduler(uow, adapters.clock, adapters.random);
  const notifications = new ReconcileNotifications(
    uow,
    adapters.notifications,
    adapters.clock
  );

  return {
    uow,
    clock: adapters.clock,
    contactsProvider: adapters.contacts,
    communication: adapters.communication,
    groups: new GroupUseCases(uow, adapters.clock),
    schedules: new ScheduleUseCases(uow, adapters.clock),
    scheduler,
    reminders: new ReminderUseCases(uow, adapters.clock),
    notifications,
    sync,
    startup: new StartupReconciliation(uow, sync, scheduler, notifications),
    history: new HistoryQueries(uow, adapters.clock),
  };
}
