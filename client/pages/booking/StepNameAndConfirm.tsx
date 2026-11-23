import { Alert, Button, Group, Stack, Text, TextInput } from '@mantine/core';
import type { Booking, ErrorCode, Slot } from '@app/api/types';
import { createBookingMutation } from '@app/api/react-query';
import { zCreateBookingRequest } from '@app/api/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { errorCode, isSlotConflict, type SlotConflictCode } from '../../lib/api-errors';
import { dayLabel, timeRangeLabel } from '../../lib/datetime';

type StepNameAndConfirmProps = {
  meetingTypeId: string;
  meetingTypeName: string;
  // The picked slot; without it there is nothing to confirm.
  selectedSlot: Slot | null;
  // The name outlives a step change: a conflict returns here with it filled in.
  guestName: string;
  onGuestNameChange: (guestName: string) => void;
  // Hands the created booking up to the wizard for the success screen.
  onBooked: (booking: Booking) => void;
  // Returns to step «Дата и время» — the way out of a taken slot.
  onBackToDateTime: () => void;
  // A 409 means the picked slot is unusable: the wizard clears it and goes back.
  onSlotConflict: (code: SlotConflictCode) => void;
};

// Non-conflict contract errors that stay on this step: a 409 is handled by
// `isSlotConflict` above, so its texts live only in `slotConflictMessages`.
type HandledErrorCode = Extract<ErrorCode, 'validation_failed' | 'meeting_type_not_found'>;

const apiErrorMessages: Record<HandledErrorCode, string> = {
  validation_failed: 'Проверьте правильность заполнения формы.',
  meeting_type_not_found: 'Тип встречи не найден.',
};

const genericApiMessage = 'Не удалось создать бронирование. Попробуйте ещё раз.';

function isHandledErrorCode(code: string): code is HandledErrorCode {
  return Object.hasOwn(apiErrorMessages, code);
}

// The submit button sits next to «Назад» in the wizard navigation, outside the
// form element — the id ties it back to the form so validation and Enter work.
const formId = 'booking-confirm-form';

export function StepNameAndConfirm({
  meetingTypeId,
  meetingTypeName,
  selectedSlot,
  guestName,
  onGuestNameChange,
  onBooked,
  onBackToDateTime,
  onSlotConflict,
}: StepNameAndConfirmProps) {
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [apiMessage, setApiMessage] = useState<string | null>(null);

  const createBooking = useMutation({
    ...createBookingMutation(),
    onSuccess: (booking) => onBooked(booking),
    onError: (error) => {
      // All three 409 codes take the same way out: back to the slot list with
      // the conflict explained there. Other contract errors stay on this step.
      if (isSlotConflict(error)) {
        onSlotConflict(error.code);
        return;
      }
      const code = errorCode(error);
      setApiMessage(
        code !== null && isHandledErrorCode(code) ? apiErrorMessages[code] : genericApiMessage,
      );
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedSlot) {
      return;
    }
    // The picked slot's moment carries +03:00, while the generated Zod check
    // for `start` accepts only the Z form: normalize the same instant — the
    // server reads any offset as the instant and answers in +03:00.
    const start = new Date(Date.parse(selectedSlot.start)).toISOString();
    const parsed = zCreateBookingRequest.safeParse({ meetingTypeId, start, guestName });
    if (!parsed.success) {
      setFieldError('Имя обязательно: от 1 до 100 символов, без пробелов по краям');
      return;
    }
    setFieldError(null);
    setApiMessage(null);
    createBooking.mutate({ body: parsed.data });
  };

  if (!selectedSlot) {
    return (
      <>
        <Text c="dimmed">Сначала выберите дату и время.</Text>
        <Group gap="sm">
          <Button variant="default" onClick={onBackToDateTime}>
            Назад
          </Button>
        </Group>
      </>
    );
  }

  // Moments carry the +03:00 offset (ADR 0002) — the summary labels come from
  // the shared substring helpers (client/lib/datetime.ts).
  const slotDay = dayLabel(selectedSlot.start);
  const slotTime = timeRangeLabel(selectedSlot.start, selectedSlot.end);

  return (
    <>
      <form id={formId} onSubmit={handleSubmit}>
        <Stack gap="sm" w="fit-content" maw="100%">
          {apiMessage && <Alert color="red">{apiMessage}</Alert>}
          <Text size="sm" c="dimmed">
            {meetingTypeName}, {slotDay}, {slotTime} (UTC+3)
          </Text>
          <TextInput
            label="Имя"
            placeholder="Как к вам обращаться"
            value={guestName}
            onChange={(event) => onGuestNameChange(event.currentTarget.value)}
            error={fieldError}
          />
        </Stack>
      </form>
      <Group gap="sm">
        <Button variant="default" onClick={onBackToDateTime}>
          Назад
        </Button>
        <Button type="submit" form={formId} loading={createBooking.isPending}>
          Подтвердить
        </Button>
      </Group>
    </>
  );
}
