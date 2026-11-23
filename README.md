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

## Защита `main` и релизы

`main` защищён classic branch protection (Settings → Branches), владелец репозитория — `kitXIII`.
Мерж PR блокируют три обязательных чека GitHub Actions: `Quality gates`, `Docker build` и
`Architecture gate`. Это независимые job'ы [`quality.yml`](.github/workflows/quality.yml), поэтому
красная сборка образа или нарушение архитектурного гейта не проскочат вместе с зелёным
`Quality gates`. `strict: false` — ветку не нужно перестраивать на свежий `main`; `enforce_admins:
true`, force-push и удаление ветки запрещены. Обязательные review не включены: владелец не может
апрувить свой PR, а решение о мерже и так остаётся человеческим (`AGENTS.md`, «Слияния»).

**Workflow permissions.** У `GITHUB_TOKEN` по умолчанию только `read`, но включено «Allow GitHub
Actions to create and approve pull requests» (`can_approve_pull_request_reviews: true`). Этого хватает
release-please: job [`release-please.yml`](.github/workflows/release-please.yml) объявляет
`pull-requests: write` и создаёт релизный PR от `GITHUB_TOKEN` — так появились PR
[#39](https://github.com/kitXIII/ai-for-developers-project-387/pull/39),
[#42](https://github.com/kitXIII/ai-for-developers-project-387/pull/42) и релизы v0.5.1, v0.5.2.

**Гейт подтверждения.** Проверки релизного PR, созданного `GITHUB_TOKEN`, могут ждать «Approve
workflows to run»: прогон 44725494999 ждал 18 минут. Это ожидаемое поведение настроек, а не поломка
release-please; владелец подтверждает запуск вручную. Если ожидание станет частой болью, вернёмся к
отдельному App-токену для release-please.

**Проверка.** Настройки читает только владелец: токен агента на этих эндпоинтах получает `403`.

```bash
gh api repos/kitXIII/ai-for-developers-project-387/branches/main/protection \
  --jq '{checks: [.required_status_checks.checks[].context], strict: .required_status_checks.strict,
         enforce_admins: .enforce_admins.enabled, force_pushes: .allow_force_pushes.enabled,
         deletions: .allow_deletions.enabled}'
# → {"checks":["Quality gates","Docker build","Architecture gate"],"strict":false,
#    "enforce_admins":true,"force_pushes":false,"deletions":false}

gh api repos/kitXIII/ai-for-developers-project-387/actions/permissions/workflow
# → {"default_workflow_permissions":"read","can_approve_pull_request_reviews":true}
```

**Остаточные ужесточения.** Allowlist Actions, `required_conversation_resolution` и отказ от
`sha_pinning_required` (он потребовал бы пинов в `hexlet-check.yml`, который нельзя менять) ведутся в
[#55](https://github.com/kitXIII/ai-for-developers-project-387/issues/55).

## Агент в GitHub Actions

В репозитории работает агент [opencode](https://opencode.ai): он отвечает на команду в обсуждении
issue или pull request. Воркфлоу — [`.github/workflows/opencode.yml`](.github/workflows/opencode.yml).

**Событие.** `issue_comment` (обсуждение issue и pull request) и `pull_request_review_comment`
(комментарий к строке diff), оба только `types: [created]`. Само событие модель не вызывает: прогон
стартует, только если тред открыт, в комментарии есть команда, автор не бот и у автора есть
`author_association` — `OWNER`, `MEMBER` или `COLLABORATOR`. Это предфильтр: он не отличает
читателя от автора с правом записи, точную проверку (`assertPermissions`, до обращения к модели)
делает сам экшен. Команды ботов прогон не запускают.

**Команды.** Агент слушает `/opencode` и `/oc` — это `mentions` по умолчанию, других нет. Команда
распознаётся в начале комментария или после пробела (`startsWith` и `contains` в выражениях Actions
регистронезависимы), поэтому `/OC` работает так же. Команда без текста означает «перескажи тред»,
команда с текстом — задачу.

**PR из форков.** `/oc` в таком PR не запускается: экшен чекаутит ветку форка и исполняет её код
(`pnpm install`, `pnpm test`) рядом с App-токеном на запись, которым можно запушить ветку и смержить
PR. Guard-шаг до checkout'а отсекает форк по `.head.repo.fork` и роняет прогон с аннотацией; ответа
в треде не будет — у job нет прав писать.

**Модель.** `opencode/deepseek-v4.1-flash` (провайдер OpenCode Zen); ключ лежит в GitHub Secrets как
`OPENCODE_API_KEY`. Прайс — $0.30 за 1M входных токенов и $1.20 за 1M выходных, но в агентном цикле
платят не за прайс: 90%+ входа — это чтение кэша по $0.006, а запись кэша бесплатна, поэтому длинный
прогон выходит примерно на 40% дешевле qwen3.8-flash. Контекст — 1M токенов.

**Назначение.** Объяснить код, поправить ошибку, ответить по строке diff, разобрать тикет. Для правок
агент создаёт ветку `opencode/issue<N>-<timestamp>` (или ветку pull request), коммитит, пушит и
открывает PR; в `main` он не коммитит никогда. **PR агент не мержит:** слияние остаётся человеку, он
открывает PR и останавливается (см. `AGENTS.md`, раздел «Слияния»). Правило поведенческое, поэтому
воркфлоу [`merge-audit.yml`](.github/workflows/merge-audit.yml) красит прогон, если `merged_by` — не
владелец репозитория.

**Результаты.** Комментарий с ответом в issue или pull request, ветка и PR при изменениях, прогон в
Actions. Проверки своего PR агент увидеть не может: ветка и PR появляются после его ответа, job на
этом заканчивается — PR проверяет `quality`. Тело PR оформляется по
[шаблону](.github/pull_request_template.md): проверки с командами, ссылками на прогоны и SHA, риск,
откат и данные.

**Авторизация и два App.** Стандартный режим — OIDC и GitHub App
[`opencode-agent`](https://github.com/apps/opencode-agent): у job есть `contents: read`,
`id-token: write` и `pull-requests: read` (последнее нужно только guard'у, который отсекает PR из
форков), checkout идёт с `persist-credentials: false`, а токен App (комментарии, ветки, PR) opencode
получает по OIDC внутри своего процесса и в окружение агента не отдаёт. В `.git/config` рабочей
копии он всё же оказывается (`http.https://github.com/.extraheader`), поэтому это не песочница:
`gh pr merge` не сработает лишь потому, что в шелле у агента часовой токен с правом на issues, а
слияние держится правилом в `AGENTS.md`, а не правами.

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

**Запуск.** Upstream-экшен `anomalyco/opencode/github` не используется: его шаг выбора версии ходит в
`api.github.com` без токена, падает на rate limit, а сам экшен удалён из upstream. Вместо него —
локальный composite action [`.github/actions/opencode`](.github/actions/opencode/action.yml): он ставит
закреплённый OpenCode V1.19.6 напрямую из release и запускает `opencode github run`. Версия — input
`version`; при обновлении проверьте синтаксис `OPENCODE_CONFIG_CONTENT` (V1 `permission`, не V2
`permissions`).

**Параметр `share`** устарел: сессии больше не публикуются (sharing отключён в v1.19.6), а локальный
action этот вход не принимает. Мы его не задаём.

**Границы прогона.** `timeout-minutes: 45`; `concurrency` — по номеру issue или pull request,
`cancel-in-progress: false` и `queue: max`: вторая команда ждёт и не рвёт текущую правку, а третья не
вытесняет вторую (дефолтная очередь держит всего один ожидающий прогон). Глобального потолка нет —
команды в разных тредах идут параллельно.

**Что есть на раннере.** Скиллы `.agents/skills/` и соглашения `docs/agents/` — из checkout.
Тулчейн ставится до агента: `mise` (Node 26, pnpm 12) и `pnpm install`, поэтому работают
`mise run lint`, `mise run typecheck` и `mise run test`. Не работают `mise run check` (osv-скану
нужна сеть) и `mise run test:e2e` (Chromium не ставится). `mise run setup` не вызывается: он ставит
`hk`-хуки, и каждый коммит агента гонял бы полный pre-push гейт.

**Файловая граница.** Локальный action ставит закреплённый OpenCode V1.19.6, поэтому inline-конфиг
(`OPENCODE_CONFIG_CONTENT`) пишется в V1-синтаксисе `permission`; ключ `permissions` (V2) ломает
валидацию конфига и прогон не стартует. Checkout — единственное доступное дерево: `external_directory`
запрещён, поэтому `read`, `edit`, `glob`, `grep` и `cd` за пределы рабочей копии получают отказ прав.
Обычные команды (`mise run …`, `pnpm test`, `git`) работают внутри checkout и не задеты; если сценарию
правда нужен внешний путь, правило сужается до каталога, а не снимается.

### Автотриаж новых обращений

Второй воркфлоу — [`triage.yml`](.github/workflows/triage.yml): он запускается на `issues: [opened]`
и делает предварительный разбор без команды в комментарии. Правила — в
[`docs/agents/auto-triage.md`](docs/agents/auto-triage.md).

**Фильтры.** Прогон стартует только для доверенного автора (`OWNER`, `MEMBER`, `COLLABORATOR`)
и не запускается для ботов. Тикеты процесса не триажатся: issue с любым state-лейблом из
`docs/agents/triage-labels.md` или с `wayfinder:*` пропускается — `/to-tickets` и `/to-spec` уже
ставят `ready-for-agent`.

**Права.** У модели нет доступа на запись: `edit` запрещён, `bash` — только `gh issue view/list`,
`GH_TOKEN` — read-only токен App (`issues: read`), веб-доступ, скиллы и инструменты MCP запрещены
inline-конфигом (`OPENCODE_CONFIG_CONTENT`), внешние каталоги (`external_directory`) закрыты.
Комментарий постит сам экшен; лейблы ставит пост-шаг по маркеру `<!-- triage: ... -->` через
`GITHUB_TOKEN` с `issues: write`. Ветку и PR прогон создать не может.

**Результат.** Комментарий с дисклеймером и разбором, `bug`/`enhancement` (если категория очевидна)
и одно состояние: `needs-triage` или `needs-info` с конкретными вопросами. `ready-for-*`, закрытие
issue и правки кода автотриаж не делает — это остаётся человеку.

**Граница.** Внешние обращения (автор без write-доступа) не триажатся: для события `issues` экшен
проверяет write-доступ автора. Это отдельная задача.

---

## Защита `main` и релизы

`main` защищён classic branch protection (rulesets не используем: у user-репозитория нет
bypass-акторов, а текущих правил хватает):

- обязательные проверки — `Quality gates`, `Docker build` и `Architecture gate` из
  [`quality.yml`](.github/workflows/quality.yml): красный CI в любом из трёх job'ов блокирует мерж;
- `strict: false` — ветку не нужно обновлять перед мержем: PR короткоживущие, мержит один владелец;
- обязательных review нет: владелец не может апрувить свой PR, решение о мерже остаётся человеческим;
- `enforce_admins: true` — прямые пуши в `main` запрещены и владельцу, force-push и удаление ветки
  тоже;
- мержит только владелец — правило в `AGENTS.md` («Слияния»), а
  [`merge-audit.yml`](.github/workflows/merge-audit.yml) ловит нарушение постфактум.

**Проверка настроек:**

```bash
gh api repos/kitXIII/ai-for-developers-project-387/branches/main/protection \
  --jq '{checks: [.required_status_checks.checks[].context],
         strict: .required_status_checks.strict,
         enforce_admins: .enforce_admins.enabled,
         force_pushes: .allow_force_pushes.enabled,
         deletions: .allow_deletions.enabled}'
# {"checks":["Quality gates","Docker build","Architecture gate"],"strict":false,
#  "enforce_admins":true,"force_pushes":false,"deletions":false}
```

**Релизы.** release-please ([`release-please.yml`](.github/workflows/release-please.yml)) работает от
штатного `GITHUB_TOKEN` при `default_workflow_permissions: read` и
`can_approve_pull_request_reviews: true`: release-PR создаются, но их проверки ждут ручного
«Approve workflows to run». Это ожидаемое поведение, а не поломка — владелец подтверждает прогоны,
потом мержит PR. App-токен вместо `GITHUB_TOKEN` не заводим: вернёмся к вопросу, если ручное
подтверждение станет частой болью. Живая проверка — на первом реальном release-PR.

**Авария.** Если CI недоступен, а мерж нужен, временно снимается только проверка админов:

```bash
gh api -X DELETE repos/kitXIII/ai-for-developers-project-387/branches/main/protection/enforce_admins
# включить обратно сразу после мержа:
gh api -X POST repos/kitXIII/ai-for-developers-project-387/branches/main/protection/enforce_admins
```

Полное снятие защиты (`DELETE .../protection`) — крайний случай: вместе с ним уходят обязательные
проверки.

**Остаточные риски** и их план — #55: allowlist Actions и `required_conversation_resolution`;
`sha_pinning_required` заблокирован `hexlet-check.yml`, который нельзя менять по `AGENTS.md`.

---

<details>
<summary>Автоматические тесты Хекслета</summary>

Тесты запускаются на каждый коммит. За запуск отвечает файл `.github/workflows/hexlet-check.yml` — не удаляйте и не переименовывайте ни его, ни репозиторий.

</details>

## О Хекслете

[Хекслет](https://ru.hexlet.io/) — школа программирования: авторские программы обучения с практикой, поддержкой наставников и реальными проектами, которые остаются в резюме. Этот репозиторий — один из таких проектов.
