# Календарь звонков (продолжение)

[![hexlet-check](https://github.com/kitXIII/ai-for-developers-project-387/actions/workflows/hexlet-check.yml/badge.svg)](https://github.com/kitXIII/ai-for-developers-project-387/actions)

Интегрируйте работу агентов в GitHub проект

Учебный проект Хекслета: https://ru.hexlet.io/programs/ai-for-developers
Как это должно работать: https://files.hexlet.app/a/2ipc5m

## Стек

- **Node.js 26** — среда выполнения
- **TypeScript 7** — строгая типизация
- **Fastify 5** — HTTP-сервер и API
- **TypeSpec** — описание API-контракта, из него генерируются OpenAPI и SDK
- **React 19** — клиентское приложение
- **Vite 8** — сборка клиента и dev-сервер
- **@fastify/vite** — интеграция Vite с Fastify
- **pnpm 12** — пакетный менеджер

## Установка

В проекте используется [mise](https://mise.jdx.dev/), рекомендуется его установить для простого удобного запуска команд

```bash
git clone https://github.com/kitXIII/ai-for-developers-project-387.git
cd ai-for-developers-project-387

# Установка окружения проекта (Node.js, pnpm и др.)
mise install

# Установка зависимостей, инструментов и git-хуков
mise run setup

# Запуск dev-сервера
mise run
```

## Сборка и запуск

```bash
mise run build   # соберёт клиент и сервер в dist/
mise run start   # запустит собранный сервер с NODE_ENV=production
```

## Docker

Прод-образ собирается multi-stage `Dockerfile` на базе `node:26-alpine`.

```bash
mise run docker:build   # соберёт образ kit-calls-calendar
mise run docker:run     # запустит контейнер; хост-порт переопределяется: PORT=8080 mise run docker:run
```

Данные хранятся в памяти процесса, так что перезапуск контейнера сбрасывает записи.

## Деплой

Прод: <https://kit-calls-calendar.onrender.com>. Render собирает образ из `Dockerfile` в репозитории и
деплоит его из `main` на каждый коммит; инфраструктура зафиксирована в [`render.yaml`](render.yaml)

---

<details>
<summary>Автоматические тесты Хекслета</summary>

Тесты запускаются на каждый коммит. За запуск отвечает файл `.github/workflows/hexlet-check.yml` — не удаляйте и не переименовывайте ни его, ни репозиторий.

</details>

## О Хекслете

[Хекслет](https://ru.hexlet.io/) — школа программирования: авторские программы обучения с практикой, поддержкой наставников и реальными проектами, которые остаются в резюме. Этот репозиторий — один из таких проектов.
