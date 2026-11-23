import { expect, type APIRequestContext, type Page } from '@playwright/test';
import dayjs from 'dayjs';
import 'dayjs/locale/ru.js';

// The dev server keeps meeting types in memory across tests, so each scenario
// creates its own type through the admin UI and asserts on it only. The mobile
// and desktop projects run in parallel against the same server, so Date.now()
// alone can collide within a millisecond — the random suffix keeps names unique
// across projects and across parallel specs.
export const uniqueName = (prefix: string) =>
  `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const meetingTypeDescription = 'Короткий видеозвонок для знакомства';

// Day cells are labelled by Mantine in the calendar locale (Calendar gets
// locale="ru"), so the tests mirror the same dayjs format for their targets.
export const calendarDayLabel = (iso: string) => dayjs(iso).locale('ru').format('D MMMM YYYY');

// The slots block on step «Дата и время» names its day with `D MMMM`.
export const slotsDayLabel = (iso: string) => dayjs(iso).locale('ru').format('D MMMM');

// A calendar date shifted by whole days. Date-only strings are handled in UTC,
// so the runner's timezone never leaks into the result.
export function addDays(iso: string, delta: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + delta * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

// The server owns the booking calendar: `GET /slots` names the bookable days in
// its own frame (ADR 0002), so the tests read them instead of recomputing
// «today» with a hardcoded UTC offset. The runner's timezone and the server's
// D+1…D+14 window therefore never disagree.
export async function bookableDays(
  request: APIRequestContext,
  meetingTypeId: string,
): Promise<string[]> {
  const response = await request.get(`/api/v1/meeting-types/${meetingTypeId}/slots`);
  expect(response.ok(), 'GET слотов отвечает успехом').toBe(true);
  const days = (await response.json()) as { date: string }[];
  return days.map(({ date }) => date);
}

// Clicks a day cell, paging forward if the day is in a later month.
export async function openDayCell(page: Page, iso: string): Promise<void> {
  const cell = page.getByRole('button', { name: calendarDayLabel(iso), exact: true });
  const nextMonth = page.getByRole('button', { name: 'Следующий месяц' });
  // The step shows a loader while the slots load — wait for the calendar grid
  // before paging, otherwise a blind click lands in the wrong month.
  await page.locator('table button').first().waitFor({ state: 'visible' });
  for (let attempt = 0; attempt < 3 && !(await cell.isVisible()); attempt += 1) {
    await nextMonth.click();
  }
  await cell.click();
}

// Data is seeded through the UI only — no API fixtures (docs/test-plan.md).
export async function createMeetingTypeViaUi(page: Page, name: string): Promise<string> {
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Создать тип' }).click();
  await page.getByLabel('Название').fill(name);
  await page.getByLabel('Описание').fill(meetingTypeDescription);
  await page.getByLabel('Длительность (минуты)').fill('30');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/meeting-types\/[0-9a-f-]{36}$/);
  return page.url().split('/').pop()!;
}
