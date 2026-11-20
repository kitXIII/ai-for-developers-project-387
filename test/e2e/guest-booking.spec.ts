import { expect, test, type Page } from '@playwright/test';
import { createMeetingTypeViaUi, meetingTypeDescription, uniqueName } from './helpers.js';

// Тикет #27: в мастере нет служебных подписей шага — ни счётчика «Шаг N из 3»,
// ни заголовка шага второго уровня. Единственный заголовок — название типа.
async function expectNoStepLabels(page: Page): Promise<void> {
  await expect(page.getByText(/Шаг \d+ из 3/)).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
}

test('гость видит типы встреч карточками на /booking', async ({ page }) => {
  const name = uniqueName('Знакомство');
  await createMeetingTypeViaUi(page, name);

  await page.goto('/booking');

  await expect(page.getByRole('heading', { name: 'Выбор типа встречи' })).toBeVisible();
  const card = page.getByRole('link', { name });
  await expect(card).toBeVisible();
  await expect(card.getByText('30 мин')).toBeVisible();
  await expect(card.getByText(meetingTypeDescription)).toBeVisible();
});

test('выбор карточки открывает мастер бронирования с шага «Тип»', async ({ page }) => {
  const name = uniqueName('Созвон');
  await createMeetingTypeViaUi(page, name);

  await page.goto('/booking');
  await page.getByRole('link', { name }).click();

  await expect(page).toHaveURL(/\/booking\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expectNoStepLabels(page);
  // Шаг «Тип»: гость сразу видит навигацию «Продолжить» без подписи шага.
  await expect(page.getByRole('button', { name: 'Продолжить' })).toBeVisible();

  // Каркас мастера: навигация «Продолжить»/«Назад» по трём шагам, шаги
  // различаются по видимому содержимому, а не по служебным подписям.
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.locator('table button').first()).toBeVisible();
  await expectNoStepLabels(page);

  // День и слот нужны, чтобы шаг подтверждения показал поле «Имя».
  await page.locator('table button:not([disabled])').first().click();
  const firstSlot = page.locator('button[aria-pressed]').first();
  await expect(firstSlot).toBeVisible();
  await firstSlot.click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByLabel('Имя')).toBeVisible();
  await expectNoStepLabels(page);
  // На последнем шаге «Продолжить» нет — подтверждение появится позже.
  await expect(page.getByRole('button', { name: 'Продолжить' })).toBeHidden();

  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(page.locator('table button').first()).toBeVisible();
  await expectNoStepLabels(page);
});

test('прямая ссылка на тип открывает мастер с пройденным шагом «Тип»', async ({ page }) => {
  const name = uniqueName('Лекция');
  await createMeetingTypeViaUi(page, name);

  await page.goto('/booking');
  await page.getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expectNoStepLabels(page);
  const wizardUrl = page.url();

  // Прямая ссылка — как открытие сохранённого адреса в новой вкладке: без
  // состояния выбора из списка шаг «Тип» уже пройден.
  const directLink = await page.context().newPage();
  await directLink.goto(wizardUrl);

  await expect(directLink.getByRole('heading', { name })).toBeVisible();
  await expect(directLink.locator('table button').first()).toBeVisible();
  await expectNoStepLabels(directLink);

  await directLink.close();
});

test('прямая ссылка на неизвестный тип показывает понятную ошибку', async ({ page }) => {
  await page.goto('/booking/00000000-0000-0000-0000-000000000000');

  await expect(page.getByText('Тип встречи не найден.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'К выбору типа' })).toBeVisible();
});
