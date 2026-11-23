import { Anchor, Badge, Button, Center, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { getMeetingTypeOptions } from '@app/api/react-query';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router';
import { isMeetingTypeNotFound } from '../../lib/api-errors';
import { dayLabel, timeRangeLabel } from '../../lib/datetime';
import { StepDateAndTime } from './StepDateAndTime';
import { StepNameAndConfirm } from './StepNameAndConfirm';
import { useBookingWizard, wizardSteps } from './useBookingWizard';

type WizardLocationState = {
  fromList?: boolean;
};

// The route component: a changed meeting type remounts the wizard (new key), so
// the picked day and slot never leak from one type into another.
export function BookingWizardPage() {
  const { meetingTypeId } = useParams<{ meetingTypeId: string }>();
  const { state } = useLocation();
  const fromList = (state as WizardLocationState | null)?.fromList === true;

  return (
    <BookingWizard key={meetingTypeId} meetingTypeId={meetingTypeId ?? ''} fromList={fromList} />
  );
}

function BookingWizard({ meetingTypeId, fromList }: { meetingTypeId: string; fromList: boolean }) {
  const wizard = useBookingWizard({ meetingTypeId, fromList });

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
  if (wizard.createdBooking) {
    return (
      <Stack gap="md">
        <Title order={2}>Бронирование подтверждено</Title>
        <Stack gap="xs">
          <Text>Тип встречи: {wizard.createdBooking.meetingTypeName}</Text>
          <Text>День: {dayLabel(wizard.createdBooking.start)}</Text>
          <Text>
            Время: {timeRangeLabel(wizard.createdBooking.start, wizard.createdBooking.end)} (UTC+3)
          </Text>
          <Text>Гость: {wizard.createdBooking.guestName}</Text>
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
      {wizard.step === wizardSteps.type && (
        <Stack gap="xs">
          <Badge variant="light" color="teal" w="fit-content">
            {meetingType.durationMinutes} мин
          </Badge>
          {meetingType.description && <Text>{meetingType.description}</Text>}
        </Stack>
      )}
      {wizard.step === wizardSteps.dateAndTime && (
        <StepDateAndTime
          meetingTypeId={meetingTypeId}
          selectedDay={wizard.selectedDay}
          onSelectDay={wizard.onSelectDay}
          selectedSlot={wizard.selectedSlot}
          onSelectSlot={wizard.onSelectSlot}
          conflictCode={wizard.conflictCode}
        />
      )}
      {wizard.step === wizardSteps.confirm && (
        <StepNameAndConfirm
          meetingTypeId={meetingTypeId}
          meetingTypeName={meetingType.name}
          selectedSlot={wizard.selectedSlot}
          guestName={wizard.guestName}
          onGuestNameChange={wizard.onGuestNameChange}
          onBooked={wizard.onBooked}
          onBackToDateTime={wizard.onBackToDateTime}
          onSlotConflict={wizard.onSlotConflict}
        />
      )}
      {wizard.step < wizardSteps.confirm && (
        <Group gap="sm">
          {wizard.step > wizardSteps.type && (
            <Button variant="default" onClick={wizard.onPrevious}>
              Назад
            </Button>
          )}
          <Button
            onClick={wizard.onNext}
            // Without a slot the confirmation step has nothing to show.
            disabled={wizard.step === wizardSteps.dateAndTime && !wizard.selectedSlot}
          >
            Продолжить
          </Button>
        </Group>
      )}
    </Stack>
  );
}
