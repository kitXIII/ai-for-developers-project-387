import type { ErrorCode } from '@app/api/types';

// 409 codes mean the picked slot is gone or unusable — the fix is another slot,
// so the wizard sends the guest back to step «Дата и время» for all of them.
export type SlotConflictCode = Extract<
  ErrorCode,
  'slot_taken' | 'outside_window' | 'outside_schedule'
>;

export const slotConflictMessages: Record<SlotConflictCode, string> = {
  slot_taken: 'Это время только что заняли. Выберите другой слот.',
  outside_window: 'Это время вне окна записи: бронировать можно на 14 дней вперёд.',
  outside_schedule: 'Это время вне графика работы: брони доступны в будни с 09:00 до 18:00.',
};

// React Query surfaces a contract failure as an `Error` carrying the machine
// `code` from the unified `{ code, message }` body. One guard reads it, so the
// callers share the same shape check.
export function errorCode(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return null;
}

// This guard answers whether the guest has to pick another slot, whichever of
// the three 409 codes came: the message map is the single list of them.
export function isSlotConflict(error: unknown): error is { code: SlotConflictCode } {
  const code = errorCode(error);
  return code !== null && Object.hasOwn(slotConflictMessages, code);
}

// A missing meeting type is the final 404 (the queries set `retry: false`) and
// renders its own text.
export function isMeetingTypeNotFound(error: unknown): boolean {
  return errorCode(error) === 'meeting_type_not_found';
}
