import { expect, test, type Page } from '@playwright/test';
import {
  calendarDayLabel,
  createMeetingTypeViaUi,
  nextWeekdays,
  openDayCell,
  todayUtc3,
  uniqueName,
} from './helpers.js';

// The desktop layout starts at 576px, the same breakpoint the rest of the UI
// uses; below it the wizard keeps the stacked mobile layout.
const isMobileViewport = (viewport: { width: number } | null) => (viewport?.width ?? 1280) < 576;

async function openWizardStepDateAndTime(page: Page, name: string): Promise<void> {
  await createMeetingTypeViaUi(page, name);
  await page.goto('/booking');
  await page.getByRole('link', { name }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  // Step «Дата и время» is recognised by the calendar grid.
  await expect(page.locator('table button').first()).toBeVisible();
}

test('шаг «Дата и время» показывает календарь с задизейбленными днями без слотов', async ({
  page,
}) => {
  const name = uniqueName('Консультация');
  await openWizardStepDateAndTime(page, name);

  // Сегодня не бронируется никогда, и день вне окна записи тоже не даёт слотов.
  await expect(page.locator('button[data-today]')).toBeDisabled();
  const yesterday = new Date(Date.parse(`${todayUtc3()}T12:00:00Z`) - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  await expect(page.getByRole('button', { name: calendarDayLabel(yesterday) })).toBeDisabled();
});

test('выбранный день показывает слоты; смена дня сбрасывает выбранный слот', async ({ page }) => {
  const name = uniqueName('Созвон');
  await openWizardStepDateAndTime(page, name);

  // Тип создан с длительностью 30 минут: сетка от 09:00, первый слот 09:00–09:30.
  const [firstDay, secondDay] = nextWeekdays(2);

  await openDayCell(page, firstDay);
  const slot = page.getByRole('button', { name: '09:00–09:30' });
  await expect(slot).toBeVisible();
  await slot.click();
  await expect(slot, 'выбранный слот помечается').toHaveAttribute('aria-pressed', 'true');

  await openDayCell(page, secondDay);
  await expect(page.getByRole('button', { name: '09:00–09:30' })).toBeVisible();
  await expect(page.locator('[aria-pressed="true"]')).toHaveCount(0);
});

// Вторая половина AC тикета #13: смена типа тоже сбрасывает выбранный слот.
// Слот только помечается выбором и не бронируется, поэтому тест не спорит за
// слоты со спеками, которые бронируют (booking-confirm — 2-й и 3-й слоты
// первого дня, admin-bookings — второй будний день).
test('смена типа сбрасывает выбранный слот — выбор не переживает возврат к типу', async ({
  page,
}) => {
  const firstName = uniqueName('Созвон');
  const secondName = uniqueName('Консультация');
  await createMeetingTypeViaUi(page, firstName);
  await createMeetingTypeViaUi(page, secondName);

  const firstDay = nextWeekdays(2)[0];

  // Тип 1: выбран день и первый слот 09:00–09:30 (первый слот свободен у всех
  // спек: booking-confirm берёт 2-й и 3-й слоты этого дня).
  await page.goto('/booking');
  await page.getByRole('link', { name: firstName }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.locator('table button').first()).toBeVisible();
  await openDayCell(page, firstDay);
  const slot = page.getByRole('button', { name: '09:00–09:30' });
  await expect(slot).toBeVisible();
  await slot.click();
  await expect(slot, 'выбранный слот помечается').toHaveAttribute('aria-pressed', 'true');

  // Другой тип: мастер открывается чистым — ни день, ни слот не переносятся.
  await page.getByRole('link', { name: 'К выбору типа' }).click();
  await page.getByRole('link', { name: secondName }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  // Ждём сетку календаря (данные слотов пришли), прежде чем искать выбранный
  // слот: пока грузится, утверждение «нет выбранного» проходит досрочно.
  await page.locator('table button').first().waitFor({ state: 'visible' });
  await expect(page.locator('[aria-pressed="true"]')).toHaveCount(0);
  await openDayCell(page, firstDay);
  await expect(page.locator('[aria-pressed="true"]')).toHaveCount(0);

  // И возврат к первому типу: выбор слота не «пережил» смену типа.
  await page.getByRole('link', { name: 'К выбору типа' }).click();
  await page.getByRole('link', { name: firstName }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.locator('table button').first().waitFor({ state: 'visible' });
  await expect(page.locator('[aria-pressed="true"]')).toHaveCount(0);
  await openDayCell(page, firstDay);
  await expect(page.locator('[aria-pressed="true"]')).toHaveCount(0);
});

// Тикет #34: на десктопе слоты стоят справа от календаря одной прокручиваемой
// колонкой, а на мобильном остаются под календарём.
test('на десктопе слоты стоят справа от календаря в колонке с внутренней прокруткой', async ({
  page,
  viewport,
}) => {
  test.skip(isMobileViewport(viewport), 'только десктопный проект');

  const name = uniqueName('Раскладка');
  await openWizardStepDateAndTime(page, name);
  const firstDay = nextWeekdays(1)[0];
  await openDayCell(page, firstDay);

  const calendar = page.locator('table');
  const firstSlot = page.getByRole('button', { name: '09:00–09:30' });
  await expect(firstSlot).toBeVisible();

  const [calendarBox, firstBox] = await Promise.all([
    calendar.boundingBox(),
    firstSlot.boundingBox(),
  ]);
  if (!calendarBox || !firstBox) {
    throw new Error('не удалось измерить календарь и слоты');
  }

  expect(firstBox.x, 'слоты справа от календаря').toBeGreaterThanOrEqual(
    calendarBox.x + calendarBox.width,
  );

  // Прямой родитель кнопок — колонка слотов: она ограничена высотой
  // календаря, поэтому при переполнении прокручивается внутри себя.
  const slotList = firstSlot.locator('..');
  const slotListBox = await slotList.boundingBox();
  expect(slotListBox).not.toBeNull();
  expect(slotListBox!.x + slotListBox!.width, 'колонка не выходит за окно').toBeLessThanOrEqual(
    viewport?.width ?? 1280,
  );

  const scroll = await slotList.evaluate((element) => {
    const style = element.ownerDocument.defaultView!.getComputedStyle(element);
    return {
      overflowY: style.overflowY,
      flexDirection: style.flexDirection,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    };
  });
  expect(scroll.overflowY).toBe('auto');
  expect(scroll.flexDirection, 'слоты выстроены в один столбец').toBe('column');
  expect(await slotList.locator('button').count(), 'в колонке несколько слотов').toBeGreaterThan(1);
  expect(scroll.scrollHeight, 'слоты прокручиваются внутри колонки').toBeGreaterThan(
    scroll.clientHeight,
  );
});

test('на мобильном слоты остаются под календарём', async ({ page, viewport }) => {
  test.skip(!isMobileViewport(viewport), 'только мобильный проект');

  const name = uniqueName('Раскладка');
  await openWizardStepDateAndTime(page, name);
  const firstDay = nextWeekdays(1)[0];
  await openDayCell(page, firstDay);

  const firstSlot = page.getByRole('button', { name: '09:00–09:30' });
  await expect(firstSlot).toBeVisible();

  const [calendarBox, slotBox] = await Promise.all([
    page.locator('table').boundingBox(),
    firstSlot.boundingBox(),
  ]);
  if (!calendarBox || !slotBox) {
    throw new Error('не удалось измерить календарь и слоты');
  }

  expect(slotBox.y, 'слоты под календарём').toBeGreaterThanOrEqual(
    calendarBox.y + calendarBox.height,
  );
});

test('на ширине 576 px слоты уже справа от календаря и блок вписывается в окно', async ({
  page,
  viewport,
}) => {
  test.skip(isMobileViewport(viewport), 'только десктопный проект');
  await page.setViewportSize({ width: 576, height: 720 });

  const name = uniqueName('Раскладка');
  await openWizardStepDateAndTime(page, name);
  const firstDay = nextWeekdays(1)[0];
  await openDayCell(page, firstDay);

  const firstSlot = page.getByRole('button', { name: '09:00–09:30' });
  await expect(firstSlot).toBeVisible();

  const [calendarBox, slotBox] = await Promise.all([
    page.locator('table').boundingBox(),
    firstSlot.boundingBox(),
  ]);
  if (!calendarBox || !slotBox) {
    throw new Error('не удалось измерить календарь и слоты');
  }

  expect(slotBox.x, 'слоты справа от календаря').toBeGreaterThanOrEqual(
    calendarBox.x + calendarBox.width,
  );
  expect(slotBox.x + slotBox.width, 'слоты не выходят за окно').toBeLessThanOrEqual(576);

  const horizontalOverflow = await page.evaluate(
    'document.documentElement.scrollWidth > document.documentElement.clientWidth',
  );
  expect(horizontalOverflow, 'страница не прокручивается по горизонтали').toBe(false);
});
