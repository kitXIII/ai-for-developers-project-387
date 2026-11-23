import { Anchor, Badge, Button, Center, Group, Loader, Stack, Text, Title } from '@mantine/core';
import type { Booking, Slot } from '@app/api/types';
import { getMeetingTypeOptions, listAvailableSlotsQueryKey } from '@app/api/react-query';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { isMeetingTypeNotFound, type SlotConflictCode } from '../../lib/api-errors';
import { dayLabel, timeRangeLabel } from '../../lib/datetime';
import { StepDateAndTime } from './StepDateAndTime';
import { StepNameAndConfirm } from './StepNameAndConfirm';

type WizardStep = 1 | 2 | 3;

type WizardLocationState = {
  fromList?: boolean;
};

// The route component: a changed meeting type remounts the wizard (new key), so
// the picked day and slot never leak from one type into another.
export function BookingWizardPage() {
  const { meetingTypeId } = useParams<{ meetingTypeId: string }>();
  const { state } = useLocation();
  // Picking a card in the list opens the wizard at step «Тип»; a direct link
  // already carries the chosen type, so that step counts as passed.
  const fromList = (state as WizardLocationState | null)?.fromList === true;

  return (
    <BookingWizard key={meetingTypeId} meetingTypeId={meetingTypeId ?? ''} fromList={fromList} />
  );
}

function BookingWizard({ meetingTypeId, fromList }: { meetingTypeId: string; fromList: boolean }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<WizardStep>(fromList ? 1 : 2);
  // The picked day and slot live here so step «Имя и подтверждение» (#14) can
  // book them; picking another day always invalidates the picked slot.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  // The name lives above the step: a conflict returns to the slot list, and the
  // guest should not retype what they already entered.
  const [guestName, setGuestName] = useState('');
  // The last 409 conflict, explained on step «Дата и время»; null hides it.
  const [conflictCode, setConflictCode] = useState<SlotConflictCode | null>(null);
  // The created booking switches the wizard to the success screen.
  const [createdBooking, setCreatedBooking] = useState<Booking | null>(null);

  const handleSelectDay = (day: string): void => {
    setSelectedDay(day);
    setSelectedSlot(null);
    setConflictCode(null);
  };

  const handleSelectSlot = (slot: Slot): void => {
    setSelectedSlot(slot);
    setConflictCode(null);
  };

  // Any 409 means the picked slot is unusable: clear it, keep the day and the
  // name, go back to the slot list and refetch it — the taken slot must be gone.
  const handleSlotConflict = (code: SlotConflictCode): void => {
    setConflictCode(code);
    setSelectedSlot(null);
    setStep(2);
    void queryClient.invalidateQueries({
      queryKey: listAvailableSlotsQueryKey({ path: { id: meetingTypeId } }),
    });
  };

  const {
    data: meetingType,
    isPending,
    isError,
    error,
  } = useQuery({
    ...getMeetingTypeOptions({ path: { id: meetingTypeId } }),
    // A missing type is a final 404, not something worth retrying.
    retry: false,
  });

  if (isPending) {
    return (
      <Center>
        <Loader aria-label="Загрузка типа встречи" />
      </Center>
    );
  }

  if (isError) {
    const notFound = isMeetingTypeNotFound(error);
    return (
      <Stack gap="sm">
        <Anchor component={Link} to="/booking">
          К выбору типа
        </Anchor>
        <Text c="dimmed">
          {notFound ? 'Тип встречи не найден.' : 'Не удалось загрузить тип встречи.'}
        </Text>
      </Stack>
    );
  }

  // The success screen replaces the whole wizard: the booking is done, there is
  // nothing to go back to. The summary comes from the server's response.
  if (createdBooking) {
    return (
      <Stack gap="md">
        <Title order={2}>Бронирование подтверждено</Title>
        <Stack gap="xs">
          <Text>Тип встречи: {createdBooking.meetingTypeName}</Text>
          <Text>День: {dayLabel(createdBooking.start)}</Text>
          <Text>Время: {timeRangeLabel(createdBooking.start, createdBooking.end)} (UTC+3)</Text>
          <Text>Гость: {createdBooking.guestName}</Text>
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Anchor component={Link} to="/booking">
        К выбору типа
      </Anchor>
      <Title order={1}>{meetingType.name}</Title>
      {step === 1 && (
        <Stack gap="xs">
          <Badge variant="light" color="teal" w="fit-content">
            {meetingType.durationMinutes} мин
          </Badge>
          {meetingType.description && <Text>{meetingType.description}</Text>}
        </Stack>
      )}
      {step === 2 && (
        <StepDateAndTime
          meetingTypeId={meetingTypeId}
          selectedDay={selectedDay}
          onSelectDay={handleSelectDay}
          selectedSlot={selectedSlot}
          onSelectSlot={handleSelectSlot}
          conflictCode={conflictCode}
        />
      )}
      {step === 3 && (
        <StepNameAndConfirm
          meetingTypeId={meetingTypeId}
          meetingTypeName={meetingType.name}
          selectedSlot={selectedSlot}
          guestName={guestName}
          onGuestNameChange={setGuestName}
          onBooked={setCreatedBooking}
          onBackToDateTime={() => setStep(2)}
          onSlotConflict={handleSlotConflict}
        />
      )}
      {step < 3 && (
        <Group gap="sm">
          {step > 1 && (
            <Button
              variant="default"
              onClick={() => setStep((current) => (current - 1) as WizardStep)}
            >
              Назад
            </Button>
          )}
          <Button
            onClick={() => setStep((current) => (current + 1) as WizardStep)}
            // Without a slot the confirmation step has nothing to show.
            disabled={step === 2 && !selectedSlot}
          >
            Продолжить
          </Button>
        </Group>
      )}
    </Stack>
  );
}
