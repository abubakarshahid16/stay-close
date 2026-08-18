export type ReminderFrequency =
  | 'daily'
  | 'every_3_days'
  | 'weekly'
  | 'every_2_weeks'
  | 'monthly';

export const REMINDER_FREQUENCY_LABELS: Record<ReminderFrequency, string> = {
  daily: 'Every day',
  every_3_days: 'Every 3 days',
  weekly: 'Weekly',
  every_2_weeks: 'Every 2 weeks',
  monthly: 'Monthly',
};

export const REMINDER_FREQUENCY_DAYS: Record<ReminderFrequency, number> = {
  daily: 1,
  every_3_days: 3,
  weekly: 7,
  every_2_weeks: 14,
  monthly: 30,
};

export const REMINDER_FREQUENCIES: ReminderFrequency[] = [
  'daily',
  'every_3_days',
  'weekly',
  'every_2_weeks',
  'monthly',
];

export interface Circle {
  id: number;
  name: string;
  reminderFrequency: ReminderFrequency;
  createdAt: string;
  updatedAt: string;
}

export interface CirclePerson {
  id: number;
  circleId: number;
  contactIdentifier: string;
  displayName: string;
  phoneNumber: string | null;
  createdAt: string;
  updatedAt: string;
  lastSuggestedAt: string | null;
  suggestionCount: number;
}

export interface CreateCircleInput {
  name: string;
  reminderFrequency: ReminderFrequency;
}

export interface UpdateCircleInput {
  name?: string;
  reminderFrequency?: ReminderFrequency;
}

export interface AddPersonInput {
  circleId: number;
  contactIdentifier: string;
  displayName: string;
  phoneNumber: string | null;
}

export interface CircleWithPeople extends Circle {
  people: CirclePerson[];
}
