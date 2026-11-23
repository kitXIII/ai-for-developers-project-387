import { expect, test, type Page } from '@playwright/test';
import dayjs from 'dayjs';
import 'dayjs/locale/ru.js';
import { createMeetingTypeViaUi } from './helpers.js';

// The mobile and desktop projects run in parallel against the same dev server,
// so Date.now() alone can collide within a millisecond — add a random suffix.
// This spec creates two types per run (one per browser context).
const uniqueName = (prefix: string) =>
  `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Day cells are labelled by Mantine in the calendar locale (Calendar gets
// locale="ru"), so the test mirrors the same dayjs format for its targets.
const calendarLabel = (iso: string) => dayjs(iso).locale('ru').format('D MMMM YYYY');
// The slots block on step «Дата и время» names its day with `D MMMM`.
const slotsDayLabel = (iso: string) => dayjs(iso).locale('ru').format('D MMMM');

// «Сегодня» in the UTC+3 calendar — the server's frame (ADR 0002).
function todayUtc3(): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// The next bookable weekdays: the window starts tomorrow, weekends give no
// slots (the server omits them, the calendar disables them).
function nextWeekdays(count: number): string[] {
  const days: string[] = [];
  let date = Date.parse(`${todayUtc3()}T12:00:00Z`);
  while (days.length < count) {
    date += 24 * 60 * 60 * 1000;
    const iso = new Date(date).toISOString().slice(0, 10);
    const weekday = new Date(`${iso}T12:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      days.push(iso);
    }
  }
  return days;
}

// Clicks a day cell, paging forward if the day is in a later month.
async function openDayCell(page: Page, iso: string): Promise<void> {
  const cell = page.getByRole('button', { name: calendarLabel(iso) });
  const nextMonth = page.getByRole('button', { name: 'Следующий месяц' });
  // The step shows a loader while the slots load — wait for the calendar grid
  // before paging, otherwise a blind click lands in the wrong month.
  await page.locator('table button').first().waitFor({ state: 'visible' });
  for (let attempt = 0; attempt < 3 && !(await cell.isVisible()); attempt += 1) {
    await nextMonth.click();
  }
  await cell.click();
}

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
  // The third bookable weekday: the other booking specs use the first and the
  // second, so only this spec and its two projects take slots here.
  const day = nextWeekdays(3)[2];

  // The two projects of this spec take their own pair of adjacent slots: the
  // taken one and a replacement that stays free.
  const firstSlotIndex = test.info().project.name === 'desktop' ? 6 : 0;

  // Guest A: reaches the confirmation step and fills the name, but keeps the
  // filled form open while guest B books the same wall-clock time.
  await openWizardDateAndTime(page, typeA);
  await openDayCell(page, day);
  const slotButtons = page.locator('button[aria-pressed]');
  const takenSlotLabel = (await slotButtons.nth(firstSlotIndex).textContent())?.trim() ?? '';
  const replacementSlotLabel =
    (await slotButtons.nth(firstSlotIndex + 1).textContent())?.trim() ?? '';
  await slotButtons.nth(firstSlotIndex).click();
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
