import type { Booking, ListAvailableSlotsResponse, Slot } from '@app/api/types';
import { listAvailableSlotsQueryKey } from '@app/api/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { SlotConflictCode } from '../../lib/api-errors';

// The wizard steps are numbered for the navigation buttons, but only the named
// constants compare and move between them: no arithmetic and no cast.
export const wizardSteps = {
  type: 1,
  dateAndTime: 2,
  confirm: 3,
} as const;

export type WizardStep = (typeof wizardSteps)[keyof typeof wizardSteps];

function nextStep(step: WizardStep): WizardStep {
  return step === wizardSteps.type ? wizardSteps.dateAndTime : wizardSteps.confirm;
}

function previousStep(step: WizardStep): WizardStep {
  return step === wizardSteps.confirm ? wizardSteps.dateAndTime : wizardSteps.type;
}

type UseBookingWizardInput = {
  meetingTypeId: string;
  // Picking a card in the list opens the wizard at step «Тип»; a direct link
  // already carries the chosen type, so that step counts as passed.
  fromList: boolean;
};

// The wizard state outlives a step change: the picked day, slot and name must
// survive a conflict that sends the guest back to the slot list. The meeting
// type query stays in the page — this hook owns only state and handlers.
export function useBookingWizard({ meetingTypeId, fromList }: UseBookingWizardInput) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<WizardStep>(
    fromList ? wizardSteps.type : wizardSteps.dateAndTime,
  );
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

  const onSelectDay = (day: string): void => {
    setSelectedDay(day);
    setSelectedSlot(null);
  };

  const onSelectSlot = (slot: Slot): void => {
    setSelectedSlot(slot);
  };

  // Any 409 means the picked slot is unusable: clear it, keep the day and the
  // name, go back to the slot list and refetch it — the taken slot must be gone.
  const onSlotConflict = (code: SlotConflictCode): void => {
    const queryKey = listAvailableSlotsQueryKey({ path: { id: meetingTypeId } });
    // The cached list keeps rendering until the refetch lands, so the submitted
    // slot is dropped from it right away: a fast guest must not send it again.
    // The refetch stays the source of truth and restores the slot if it is free.
    if (selectedSlot) {
      const submittedStart = selectedSlot.start;
      queryClient.setQueryData<ListAvailableSlotsResponse>(queryKey, (days) =>
        days?.map((day) => ({
          ...day,
          slots: day.slots.filter((slot) => slot.start !== submittedStart),
        })),
      );
    }
    setConflictCode(code);
    setSelectedSlot(null);
    setStep(wizardSteps.dateAndTime);
    void queryClient.invalidateQueries({ queryKey });
  };

  // The conflict notice belongs to step «Дата и время», not to a slot button:
  // it explains why the wizard jumped back, so picking another day or slot
  // keeps it and only leaving the step drops it. A reset tied to slot selection
  // would miss «Назад» → «Продолжить», where the guest leaves and returns
  // without picking anything and the stale alert would reappear. Every exit
  // from the step goes through onNext/onPrevious, so this guard covers it.
  const clearConflictOnLeave = (): void => {
    if (step === wizardSteps.dateAndTime) {
      setConflictCode(null);
    }
  };

  const onNext = (): void => {
    clearConflictOnLeave();
    setStep(nextStep);
  };

  const onPrevious = (): void => {
    clearConflictOnLeave();
    setStep(previousStep);
  };

  return {
    step,
    selectedDay,
    selectedSlot,
    guestName,
    conflictCode,
    createdBooking,
    onSelectDay,
    onSelectSlot,
    onGuestNameChange: setGuestName,
    onBooked: setCreatedBooking,
    onSlotConflict,
    onNext,
    onPrevious,
    onBackToDateTime: () => setStep(wizardSteps.dateAndTime),
  };
}
