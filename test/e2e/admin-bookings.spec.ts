import { expect, test } from '@playwright/test';
import {
  createMeetingTypeViaUi,
  nextWeekdays,
  openDayCell,
  slotsDayLabel,
  uniqueName,
} from './helpers.js';

// README scenario end to end (С1+С2+С3), everything through the UI: the owner
// creates a meeting type, a guest books a free slot, the owner finds the
// booking in the «Бронирования» tab and checks the guest name and the time.
test('бронь гостя видна во вкладке «Бронирования» — владелец сверяет имя и время', async ({
  page,
}) => {
  // С1: владелец создаёт тип встречи в «Администрировании».
  const typeName = uniqueName('Знакомство');
  await createMeetingTypeViaUi(page, typeName);

  // С2: гость проходит мастер и бронирует свободный слот. Второй будний день
  // окна: первый день у booking-confirm.spec (его 2-й и 3-й слоты), этот день
  // бронирует только данная спека — коллизий между проектами нет.
  await page.goto('/booking');
  await page.getByRole('link', { name: typeName }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.locator('table button').first()).toBeVisible();

  await openDayCell(page, nextWeekdays(2)[1]);

  // Два проекта этой спеки берут соседние слоты дня: какой бы ни успел первым,
  // второй сдвигается на более позднее время и не пересекается с первым.
  const slotIndex = test.info().project.name === 'desktop' ? 4 : 3;
  const targetSlot = page.locator('button[aria-pressed]').nth(slotIndex);
  const slotLabel = (await targetSlot.textContent())?.trim() ?? '';
  await targetSlot.click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByLabel('Имя')).toBeVisible();

  const guestName = uniqueName('Игорь');
  await page.getByLabel('Имя').fill(guestName);
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('heading', { name: 'Бронирование подтверждено' })).toBeVisible();

  // С3: владелец открывает вкладку «Бронирования» и сверяет время и имя гостя.
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Бронирования' }).click();
  const whenLabel = `${slotsDayLabel(nextWeekdays(2)[1])}, ${slotLabel}`;
  const row = page.getByRole('row').filter({ hasText: guestName });
  await expect(row, 'бронь гостя видна в списке').toBeVisible();
  await expect(row).toContainText(typeName);
  await expect(row).toContainText(whenLabel);
});
