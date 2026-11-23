import { expect, test, type Page } from '@playwright/test';
import {
  createMeetingTypeViaUi,
  nextWeekdays,
  openDayCell,
  slotsDayLabel,
  uniqueName,
} from './helpers.js';

// The booking window is D+1…D+14 and holds ten weekdays. The last two are the
// far end of the window: no other booking spec books there, so the two projects
// of this spec get a day each without depending on another spec's slot order.
const bookingWindowWeekdays = nextWeekdays(10);

// Opens the wizard of a freshly created type on step «Дата и время».
async function openWizardDateAndTime(page: Page, name: string): Promise<void> {
  await createMeetingTypeViaUi(page, name);
  await page.goto('/booking');
  await page.getByRole('link', { name }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.locator('table button').first()).toBeVisible();
}

// Books the given day and time label as a different guest in another browser
// context. Bookings block across meeting types, so the slot is gone for guest A
// even though B's type differs.
async function bookSameSlotAsOtherGuest(
  page: Page,
  name: string,
  day: string,
  slotLabel: string,
): Promise<void> {
  await openWizardDateAndTime(page, name);
  await openDayCell(page, day);
  await page.getByRole('button', { name: slotLabel }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByLabel('Имя').fill(uniqueName('Соперник'));
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('heading', { name: 'Бронирование подтверждено' })).toBeVisible();
}

// Acceptance criteria of ticket #65: a guest who loses the race for a slot
// comes back to step «Дата и время», keeps the day and the name, sees the
// refreshed list without the taken slot and books another time without
// reloading. The two browser contexts make the race real, not simulated.
test('гость, проигравший слот, возвращается на шаг времени и бронирует другое время', async ({
  browser,
  page,
}) => {
  const typeA = uniqueName('Гонка');
  const guestName = uniqueName('Ольга');
  // Each project takes its own of the last two weekdays of the window.
  const day =
    bookingWindowWeekdays[
      bookingWindowWeekdays.length - (test.info().project.name === 'desktop' ? 1 : 2)
    ];

  // Guest A: reaches the confirmation step and fills the name, but keeps the
  // filled form open while guest B books the same wall-clock time.
  await openWizardDateAndTime(page, typeA);
  await openDayCell(page, day);
  const slotButtons = page.locator('button[aria-pressed]');
  const takenSlot = slotButtons.first();
  const replacementSlot = slotButtons.nth(1);
  const takenSlotLabel = (await takenSlot.textContent())?.trim() ?? '';
  const replacementSlotLabel = (await replacementSlot.textContent())?.trim() ?? '';
  await takenSlot.click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByLabel('Имя').fill(guestName);

  // Guest B, a separate browser context: books the same slot under a different
  // meeting type.
  const guestBContext = await browser.newContext();
  try {
    await bookSameSlotAsOtherGuest(
      await guestBContext.newPage(),
      uniqueName('Соперник'),
      day,
      takenSlotLabel,
    );
  } finally {
    await guestBContext.close();
  }

  // Guest A submits the stale slot and lands back on step «Дата и время».
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByText('Это время только что заняли. Выберите другой слот.')).toBeVisible();
  await expect(page.getByLabel('Имя')).toHaveCount(0);
  await expect(page.locator('table button').first()).toBeVisible();

  // The chosen day survives the conflict: its slot list is still shown, and no
  // slot is selected, so «Продолжить» is blocked.
  await expect(page.getByText(`Свободное время ${slotsDayLabel(day)}:`)).toBeVisible();
  await expect(page.locator('[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Продолжить' })).toBeDisabled();

  // The list is refetched, not reused: the taken slot is gone from it.
  await expect(page.getByRole('button', { name: takenSlotLabel })).toHaveCount(0);

  // Another slot can be booked without reloading, and the entered name is still
  // there — the confirmation step never shows the old time.
  await page.getByRole('button', { name: replacementSlotLabel }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByLabel('Имя')).toHaveValue(guestName);
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('heading', { name: 'Бронирование подтверждено' })).toBeVisible();
  await expect(page.getByText(`Время: ${replacementSlotLabel} (UTC+3)`)).toBeVisible();
  await expect(page.getByText(`Гость: ${guestName}`)).toBeVisible();
});

// Ticket #65, «три кода — один путь»: the client seam is checked for the two
// codes the race cannot produce. The server contract is covered by API tests,
// so the POST is answered here; the guest sees the same way out as slot_taken.
test('outside_window и outside_schedule ведут тем же путём, что и занятый слот', async ({
  page,
}) => {
  const typeName = uniqueName('Коды');
  const guestName = uniqueName('Гость');
  // The two weekdays before the race spec's: no other spec books on them.
  const day =
    bookingWindowWeekdays[
      bookingWindowWeekdays.length - (test.info().project.name === 'desktop' ? 3 : 4)
    ];
  const conflicts = [
    ['outside_window', 'Это время вне окна записи: бронировать можно на 14 дней вперёд.'],
    ['outside_schedule', 'Это время вне графика работы: брони доступны в будни с 09:00 до 18:00.'],
  ] as const;

  await openWizardDateAndTime(page, typeName);
  await openDayCell(page, day);
  const slot = page.locator('button[aria-pressed]').first();
  const slotLabel = (await slot.textContent())?.trim() ?? '';
  await slot.click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByLabel('Имя').fill(guestName);

  // One intercepted POST per code: the attempt picks the next conflict.
  let attempt = 0;
  await page.route('**/api/v1/bookings', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const [code] = conflicts[Math.min(attempt, conflicts.length - 1)];
    attempt += 1;
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ code, message: 'conflict' }),
    });
  });

  // The refetched slot list is held back below to prove the optimistic removal:
  // the assertion runs while the GET is still pending, so only the cached list
  // patched by the client can hide the submitted slot.
  let releaseSlots: () => void = () => {};
  const slotsHeld = new Promise<void>((resolve) => {
    releaseSlots = resolve;
  });
  await page.route('**/api/v1/meeting-types/*/slots', async (route) => {
    await slotsHeld;
    await route.continue();
  });

  for (const [code, message] of conflicts) {
    await expect(page.getByLabel('Имя'), 'имя сохранено после прошлого конфликта').toHaveValue(
      guestName,
    );
    await page.getByRole('button', { name: 'Подтвердить' }).click();

    // The same path as slot_taken: back on the day step with the code's text,
    // the slot cleared, the day and the name kept, «Продолжить» blocked.
    await expect(page.getByText(message), `текст для ${code}`).toBeVisible();
    await expect(page.getByLabel('Имя')).toHaveCount(0);
    await expect(page.getByText(`Свободное время ${slotsDayLabel(day)}:`)).toBeVisible();
    await expect(page.locator('[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Продолжить' })).toBeDisabled();

    // Ticket #65, «занятый слот не может быть отправлен повторно»: the cached
    // list is patched before the refetch lands, so the submitted slot is not
    // clickable for a second round-trip. One iteration is enough to prove it.
    if (code === conflicts[0][0]) {
      await expect(
        page.getByRole('button', { name: slotLabel }),
        'слот скрыт сразу, до перезапроса',
      ).toHaveCount(0);
      releaseSlots();
      await expect(page.getByRole('button', { name: slotLabel })).toBeVisible();

      // The conflict notice belongs to the day step: leaving it and coming back
      // without a new 409 must not show the old alert again.
      await page.getByRole('button', { name: 'Назад' }).click();
      await page.getByRole('button', { name: 'Продолжить' }).click();
      await expect(page.getByText(message), `текст для ${code} после возврата`).toHaveCount(0);
    }

    // The slot is still free (the request never reached the server), so the
    // guest can pick it again for the next code.
    await page.getByRole('button', { name: slotLabel }).click();
    await page.getByRole('button', { name: 'Продолжить' }).click();
  }
});
