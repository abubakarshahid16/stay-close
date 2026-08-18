export type ReminderAction = 'shown' | 'completed' | 'skipped' | 'replaced';

export interface ReminderHistory {
  id: number;
  circleId: number;
  circlePersonId: number;
  suggestedAt: string;
  action: ReminderAction;
  completedAt: string | null;
}

export interface RecordReminderInput {
  circleId: number;
  circlePersonId: number;
  action: ReminderAction;
}

export interface ReminderSuggestion {
  circleId: number;
  circleName: string;
  person: {
    id: number;
    displayName: string;
    phoneNumber: string | null;
  };
  historyId?: number;
}
