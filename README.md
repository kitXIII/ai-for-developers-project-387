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

## Агент в GitHub Actions

В репозитории работает агент [opencode](https://opencode.ai): он отвечает на команду в обсуждении
issue или pull request. Воркфлоу — [`.github/workflows/opencode.yml`](.github/workflows/opencode.yml).

**Событие.** `issue_comment` (обсуждение issue и pull request) и `pull_request_review_comment`
(комментарий к строке diff), оба только `types: [created]`. Само событие модель не вызывает: прогон
стартует, только если в комментарии есть команда, автор не бот и у автора есть право записи в
репозиторий (`author_association` — `OWNER`, `MEMBER` или `COLLABORATOR`). Команды ботов прогон не
запускают, а комментарии из fork не получают секретов.

**Команды.** Агент слушает `/opencode` и `/oc` — это `mentions` по умолчанию, других нет. Команда без
текста означает «перескажи тред», команда с текстом — задачу.

**Модель.** `opencode/deepseek-v4.1-flash` (провайдер OpenCode Zen); ключ лежит в GitHub Secrets как
`OPENCODE_API_KEY`. Прайс — $0.30 за 1M входных токенов и $1.20 за 1M выходных, но в агентном цикле
платят не за прайс: 90%+ входа — это чтение кэша по $0.006, а запись кэша бесплатна, поэтому длинный
прогон выходит примерно на 40% дешевле qwen3.8-flash. Контекст — 1M токенов.

**Назначение.** Объяснить код, поправить ошибку, ответить по строке diff, разобрать тикет. Для правок
агент создаёт ветку `opencode/issue<N>-<timestamp>` (или ветку pull request), коммитит, пушит и
открывает PR; в `main` он не коммитит никогда.

**Результаты.** Комментарий с ответом в issue или pull request, ветка и PR при изменениях, прогон в
Actions. Проверки своего PR агент увидеть не может: ветка и PR появляются после его ответа, job на
этом заканчивается — PR проверяет `quality`.

**Авторизация и два App.** Стандартный режим — OIDC и GitHub App
[`opencode-agent`](https://github.com/apps/opencode-agent): у job есть `contents: read` и
`id-token: write`, checkout идёт с `persist-credentials: false`, а токен App (комментарии, ветки, PR)
opencode получает по OIDC внутри своего процесса и в окружение агента не отдаёт.

Отсюда ограничение: `gh` в шелле агента неаутентифицирован, а процессы из `.agents/skills`
(`wayfinder`, `to-tickets`, `triage`) начинаются с `gh`. Поэтому нужен второй App — свой, с правом
`Issues: Read and write`: `actions/create-github-app-token` выдаёт часовой токен на этот репозиторий
и кладёт его в `GH_TOKEN` только на шаг агента. Секреты: `AGENT_APP_CLIENT_ID` и
`AGENT_APP_PRIVATE_KEY` (`.pem` генерируется один раз при создании App).

Отличие от `use_github_token: true`: там один токен `GITHUB_TOKEN` обслуживает и opencode, и `gh`, но
job получает `contents`, `pull-requests` и `issues` на запись, а checkout приходится оставлять с
`persist-credentials: true` — иначе нечем пушить, а гейт `artipacked` в `quality` такое валит.
Стандартный режим с двумя App держит код и PR за короткоживущим токеном `opencode-agent`, а трекер —
за часовым токеном с правом только на issues.

**Параметр `share`** устарел: сессии больше не публикуются (sharing отключён в v1.19.6), экшен вход
игнорирует. Мы его не задаём.

**Границы прогона.** `timeout-minutes: 45`; `concurrency` — по номеру issue или pull request,
`cancel-in-progress: false`, чтобы вторая команда встала в очередь и не рвала текущую правку.

**Что есть на раннере.** Скиллы `.agents/skills/` и соглашения `docs/agents/` — из checkout.
Тулчейн ставится до агента: `mise` (Node 26, pnpm 12) и `pnpm install`, поэтому работают
`mise run lint`, `mise run typecheck` и `mise run test`. Не работают `mise run check` (osv-скану
нужна сеть) и `mise run test:e2e` (Chromium не ставится). `mise run setup` не вызывается: он ставит
`hk`-хуки, и каждый коммит агента гонял бы полный pre-push гейт.

---

<details>
<summary>Автоматические тесты Хекслета</summary>

Тесты запускаются на каждый коммит. За запуск отвечает файл `.github/workflows/hexlet-check.yml` — не удаляйте и не переименовывайте ни его, ни репозиторий.

</details>

## О Хекслете

[Хекслет](https://ru.hexlet.io/) — школа программирования: авторские программы обучения с практикой, поддержкой наставников и реальными проектами, которые остаются в резюме. Этот репозиторий — один из таких проектов.
