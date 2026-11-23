import type { Slot } from '@app/api/types';
import { listAvailableSlotsOptions } from '@app/api/react-query';
import { Alert, Button, Center, Loader, Text } from '@mantine/core';
import { Calendar } from '@mantine/dates';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { slotConflictMessages, type SlotConflictCode } from '../../lib/api-errors';
import { dayLabel, timeRangeLabel } from '../../lib/datetime';
import classes from './StepDateAndTime.module.css';

type StepDateAndTimeProps = {
  meetingTypeId: string;
  selectedDay: string | null;
  // Picking another day always invalidates the picked slot.
  onSelectDay: (day: string) => void;
  selectedSlot: Slot | null;
  onSelectSlot: (slot: Slot) => void;
  // The 409 conflict that brought the guest back here; null means no alert.
  conflictCode: SlotConflictCode | null;
};

// The server returns only the days with free slots (the whole window in one
// response), so every other day of the visible month — today, weekends, days
// outside the booking window — is disabled in the calendar.
export function StepDateAndTime({
  meetingTypeId,
  selectedDay,
  onSelectDay,
  selectedSlot,
  onSelectSlot,
  conflictCode,
}: StepDateAndTimeProps) {
  // After a conflict the wizard remounts this step; opening the calendar on the
  // preserved day keeps it visible even when the first free day is another month.
  const [viewedMonth, setViewedMonth] = useState<string | null>(selectedDay);
  const {
    data: slotsDays,
    isPending,
    isError,
  } = useQuery(listAvailableSlotsOptions({ path: { id: meetingTypeId } }));

  if (isPending) {
    return (
      <Center>
        <Loader aria-label="Загрузка слотов" />
      </Center>
    );
  }

  if (isError) {
    return <Text c="dimmed">Не удалось загрузить слоты. Попробуйте ещё раз.</Text>;
  }

  const availableDays = new Set(slotsDays.map((day) => day.date));
  const daySlots = slotsDays.find((day) => day.date === selectedDay)?.slots ?? [];

  return (
    <>
      {conflictCode && <Alert color="red">{slotConflictMessages[conflictCode]}</Alert>}
      <div className={`${classes.layout} ${selectedDay ? classes.layoutWithSlots : ''}`}>
        <Calendar
          locale="ru"
          ariaLabels={{ nextMonth: 'Следующий месяц', previousMonth: 'Предыдущий месяц' }}
          // The first day with slots opens the calendar; the guest can page further.
          date={viewedMonth ?? slotsDays[0]?.date}
          onDateChange={setViewedMonth}
          excludeDate={(date) => !availableDays.has(date)}
          getDayProps={(date) => ({
            selected: date === selectedDay,
            onClick: () => onSelectDay(date),
          })}
        />
        {selectedDay && (
          <div className={classes.slots}>
            <Text size="sm" c="dimmed">
              Свободное время {dayLabel(selectedDay)}:
            </Text>
            <div className={classes.slotList}>
              {daySlots.map((slot) => (
                <Button
                  key={slot.start}
                  variant={slot.start === selectedSlot?.start ? 'filled' : 'default'}
                  aria-pressed={slot.start === selectedSlot?.start}
                  onClick={() => onSelectSlot(slot)}
                >
                  {timeRangeLabel(slot.start, slot.end)}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
