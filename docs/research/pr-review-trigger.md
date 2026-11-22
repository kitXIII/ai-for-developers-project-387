# Триггер авторевью на PR от GitHub App

Research к тикету [#49](https://github.com/kitXIII/ai-for-developers-project-387/issues/49)
(цикл [#46](https://github.com/kitXIII/ai-for-developers-project-387/issues/46)). Вопрос: идёт ли
`pull_request`-воркфлоу на PR, созданный App `opencode-agent`, и на PR, созданный `GITHUB_TOKEN`
(release-please), какие подтверждения и права нужны.

## Короткий ответ

- PR от GitHub App (App installation token) — обычный `pull_request`: событие приходит, прогон
  стартует сразу, подтверждение человека не нужно. Документация прямо говорит, что App-токен или PAT
  «lets `pull_request` workflows run automatically (without the approval prompt)».
- PR от `GITHUB_TOKEN` — событие тоже приходит и прогон создаётся, но для `opened`, `synchronize`,
  `reopened` он попадает в состояние **approval-required**: пока человек с write-доступом не нажмёт
  «Approve workflows to run», job'ы не стартуют. В API это `conclusion: action_required` у первой
  попытки. Остальные activity types (например, `labeled`, `edited`, `closed`) прогонов от
  `GITHUB_TOKEN` не создают вообще.
- Токен воркфлоу — всегда `GITHUB_TOKEN` этого репозитория, а не токен App и не токен создателя PR.
  Права — из `permissions:` воркфлоу; для PR из форка запись принудительно понижается до чтения.
- «Allow GitHub Actions to create and approve pull requests» (Settings → Actions → General →
  Workflow permissions) управляет тем, может ли `GITHUB_TOKEN` вообще создавать и апрувить PR.
  В этом репозитории настройка включена (`can_approve_pull_request_reviews: true`), иначе
  release-please не смог бы открыть PR.
- Фильтровать форки и недоверенных авторов можно в `if:` job'а на `pull_request`: сверять
  `user.type`, `user.login`, `head.repo.full_name == github.repository` и `head.ref`. Без
  `pull_request_target` и без запуска кода PR.
- Авторевью хватает `GITHUB_TOKEN`: `contents`, `issues`, `actions`, `checks`, `statuses` — read,
  `pull-requests` — write. `id-token` и App-токен не нужны, если ревью пишется от
  `github-actions[bot]` и не должно само запускать другие воркфлоу.

## Что проверено на этом репозитории

Репозиторий публичный, форков ноль, default workflow permissions — `read`:

```console
$ gh repo view --json visibility,forkCount  →  {"visibility":"PUBLIC","forkCount":0}
$ gh api repos/kitXIII/ai-for-developers-project-387/actions/permissions/workflow
{"default_workflow_permissions":"read","can_approve_pull_request_reviews":true}
```

PR агента (`opencode/issue*`) создаются App `opencode-agent` (OIDC-обмен внутри opencode, см.
README, «Авторизация и два App»), PR релиза — `googleapis/release-please-action` на `GITHUB_TOKEN`.
Оба вида PR лежат в самом репозитории, не в форке:

```console
$ gh api repos/.../pulls/43 --jq \
    '[.user.type,.user.login,.head.repo.full_name,.head.repo.fork]'
["Bot","opencode-agent[bot]","kitXIII/ai-for-developers-project-387",false]
$ gh api repos/.../pulls/42 --jq '[.user.type,.user.login,.head.repo.full_name]'
["Bot","github-actions[bot]","kitXIII/ai-for-developers-project-387"]
```

`quality` уже запускается на `pull_request` для обоих видов PR. Первая попытка прогона
(`GET /repos/{owner}/{repo}/actions/runs/{id}/attempts/1`):

| Прогон      | PR  | Автор PR              | attempt 1           | Итог                    |
| ----------- | --- | --------------------- | ------------------- | ----------------------- |
| 44636805003 | #17 | `opencode-agent[bot]` | success             | success, сразу          |
| 44693878708 | #28 | `opencode-agent[bot]` | success             | success, сразу          |
| 44699167849 | #31 | `opencode-agent[bot]` | success             | success, сразу          |
| 44737860933 | #43 | `opencode-agent[bot]` | success             | success, сразу          |
| 43972791934 | #8  | `github-actions[bot]` | **action_required** | success после апрува    |
| 44180249651 | #12 | `github-actions[bot]` | **action_required** | cancelled (concurrency) |
| 44632478656 | #14 | `github-actions[bot]` | **action_required** | success после апрува    |
| 44725494999 | #39 | `github-actions[bot]` | **action_required** | attempt 2 через 18 мин  |
| 44736706745 | #42 | `github-actions[bot]` | **action_required** | cancelled (concurrency) |

Таймлайн гейта на прогоне 44725494999:

```console
$ gh api repos/.../actions/runs/44725494999
{"created_at":"2026-11-20T11:11:09Z","run_started_at":"2026-11-20T11:29:28Z","run_attempt":2,
 "actor":"github-actions[bot]","triggering_actor":"kitXIII","conclusion":"success"}
$ gh api repos/.../actions/runs/44725494999/attempts/1 --jq .conclusion  →  action_required
```

То есть событие пришло в 11:11, прогон 18 минут ждал подтверждения, владелец нажал «Approve
workflows to run» — и только тогда стартовала вторая попытка. У прогонов PR агента такого гейта
нет ни разу: `actor` и `triggering_actor` — `opencode-agent[bot]`, попытка одна.

## PR от GitHub App: событие и токен

- `pull_request` — обычное событие вебхука; активность PR от бота ничем не отличается от PR
  человека. `opened`, `synchronize`, `reopened` — те типы, на которых воркфлоу запускается по
  умолчанию.
- Гейт первого запуска действует только для PR из **форков** (политика «Approval for running fork
  pull request workflows from contributors», по умолчанию апрув нужен first-time contributor'ам).
  PR агента приходит из ветки того же репозитория, поэтому под эту политику не попадает.
- Воркфлоу получает собственный `GITHUB_TOKEN` репозитория (скоуп — по `permissions:`), а не токен
  App. Токен App живёт только в процессе opencode и в окружение job'а не попадает. Для PR не из
  форка `GITHUB_TOKEN` не понижается до read-only — понижение предусмотрено только для форков.
- `github.actor` / `github.triggering_actor` такого прогона — `opencode-agent[bot]`.

## PR от `GITHUB_TOKEN`: чем отличается

- События `GITHUB_TOKEN` по общему правилу не создают прогонов (защита от рекурсии). Исключения:
  `workflow_dispatch`, `repository_dispatch` и `pull_request` с типами `opened`, `synchronize`,
  `reopened` — для последних прогон создаётся, но в состоянии approval-required.
- Пока прогон ждёт апрува, в PR висит баннер, а в merge box — «Awaiting approval» с кнопкой
  «Approve workflows to run»; апрувить может пользователь с write-доступом. Прогон, провисевший
  без апрува 30 дней, помечается failed.
- Токен после апрува — всё тот же `GITHUB_TOKEN`, не форковый: read-only понижения нет, права из
  `permissions:` действуют.
- Настройка «Allow GitHub Actions to create and approve pull requests» — это про право
  `GITHUB_TOKEN` открывать PR и апрувить их через API. Без неё release-please падает с ошибкой о
  запрете создавать PR. Проверка настройки — UI: Settings → Actions → General → Workflow
  permissions; API: `GET /repos/{owner}/{repo}/actions/permissions/workflow`, поле
  `can_approve_pull_request_reviews`.
- Практический вывод: авторевью на PR релиза и dependabot либо ждёт человека, либо не запускается
  вовсе. Если ревью релизных PR не нужно — их проще отфильтровать в `if:`.

## Как отличить бота агента от release-please и dependabot

`user.type` для всех троих — `Bot`, одного его мало. Рабочая связка:

- `github.event.pull_request.user.login == 'opencode-agent[bot]'` — автор PR, самое надёжное;
- `github.event.pull_request.head.repo.full_name == github.repository` — PR из своей ветки, не из
  форка (у форка здесь будет логин форка, а у PR из форка payload вообще может быть пустым);
- `startsWith(github.event.pull_request.head.ref, 'opencode/')` — ветки агента имеют префикс
  `opencode/issue<N>-<timestamp>`; это вторичный признак, логин важнее;
- `github.event.pull_request.draft == false` — черновики не ревьюим.

`dependabot[bot]` при этом попадает под правила форков (его PR считаются как из форка), поэтому
`head.repo.full_name` и read-only `GITHUB_TOKEN` отсекают его сами.

## Условие и права для авторевью

```yaml
name: pr-review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions: {}

concurrency:
  group: pr-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    name: Agent PR review
    if: |
      github.event.pull_request.user.type == 'Bot' &&
      github.event.pull_request.user.login == 'opencode-agent[bot]' &&
      github.event.pull_request.head.repo.full_name == github.repository &&
      startsWith(github.event.pull_request.head.ref, 'opencode/') &&
      github.event.pull_request.draft == false
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    permissions:
      contents: read
      issues: read
      actions: read
      checks: read
      statuses: read
      pull-requests: write
    steps:
      # только вызовы GitHub API по diff: ни pnpm install, ни mise run, ни код PR
      - run: echo "review via gh api / gh pr diff"
```

Почему именно так:

- `permissions: {}` на уровне воркфлоу и явный блок в job'е — стиль репозитория (`quality.yml`,
  `release-please.yml`): всё, что не перечислено, становится `none`.
- `contents: read` — diff и файлы PR; `pull-requests: write` — комментарий/ревью; `issues: read` —
  тело связанного тикета; `actions: read` — прогоны `quality` по `head.sha`; `checks: read` и
  `statuses: read` — причины красных проверок и commit statuses.
- `id-token: write` не нужен: OIDC нужен только для обмена на App-токен, а ревью пишет
  `GITHUB_TOKEN`. App-токен нужен, только если ревью должно быть от лица App или должно само
  запускать другие воркфлоу (события `GITHUB_TOKEN` новых прогонов не создают).
- Если ревью ставит не COMMENT, а APPROVE, `GITHUB_TOKEN` должен иметь право апрувить PR — это та
  же настройка «Allow GitHub Actions to create and approve pull requests» (в репозитории включена).

## Чек-лист проверки живого прогона

1. Прогон вообще есть:
   `gh run list --workflow=pr-review.yml -e pull_request -b <head.ref>`
   (добавить `--json databaseId,conclusion,attempt,event`).
2. Кто запустил и когда стартовали: `gh api repos/O/R/actions/runs/<id>` с `--jq` по полям
   `status`, `conclusion`, `run_attempt`, `created_at`, `run_started_at`, `actor.login`,
   `triggering_actor.login`. Для PR агента ждём `actor=opencode-agent[bot]`, `run_attempt=1`,
   `run_started_at==created_at`.
3. Гейт апрува, если старт не совпал с созданием:
   `gh api repos/O/R/actions/runs/<id>/attempts/1 --jq .conclusion` → `action_required`;
   разница `run_started_at - created_at` — сколько ждали; `triggering_actor` второй попытки —
   кто апрувил.
4. Все зависшие прогоны сразу: `gh run list --status action_required` (или
   `gh api "repos/O/R/actions/runs?status=action_required"`).
5. PR-страница: баннер «Awaiting approval» / кнопка «Approve workflows to run». `gh pr checks <n>`
   и `statusCheckRollup` тоже смотрим, но как именно там отображается ждущий апрува прогон, я не
   проверял — см. «Открытые вопросы».
6. Если прогона нет совсем: проверить, что PR не в merge conflict (на `pull_request` воркфлоу в
   этом случае не запускается), что ветка не из форка и что воркфлоу лежит на default branch.

Что писать в отчёте по прогону: id и ссылку, `event`, `head_branch`, автора PR (`user.login`,
`user.type`), `head.repo.full_name`, `run_attempt`, `conclusion` первой попытки, задержку
`run_started_at - created_at`, кто апрувил, финальный `conclusion` и список job'ов. Если прогона не
было — причину из пункта 6.

## Риски, которые это вскрывает

- `pull_request` запускает **файл воркфлоу из merge-коммита PR**, а не из default branch. Значит,
  PR агента может поправить `.github/workflows/pr-review.yml`, и следующий `synchronize` выполнит
  уже его версию. Для PR из своего репозитория доступны и секреты репозитория, а гейта первого
  запуска (в отличие от форков и `GITHUB_TOKEN`-PR) нет — человек не подтверждает ничего.
- Поэтому job авторевью должен быть пустым по секретам и не запускать код PR: только `gh api` /
  `gh pr diff`. Изменения в `.github/workflows/**` стоит защитить ruleset'ом или CODEOWNERS.
- Тот же риск уже есть у `quality` (она запускает `mise run check` на PR агента с секретами
  репозитория) — это принятое ранее решение, авторевью его не должно расширять.

## Открытые вопросы (не проверено)

- Прогон 44738473851 (PR #42) стартовал без гейта: attempt 1 = success, `actor` и
  `triggering_actor` — `kitXIII`, `created_at == run_started_at`. Остальные прогоны того же PR были
  `action_required`. Похоже на «апрув запомнился для PR» или на ручной re-run, но документацией это
  не подтверждено.
- Запоминает ли GitHub апрув для последующих `synchronize` того же `GITHUB_TOKEN`-PR —
  в документации не сказано. Если да, релизный PR достаточно апрувить один раз.
- Как именно `gh pr checks` показывает прогон, ждущий апрува (pending-чек или ничего) — не проверял.
- Точный объём настройки «create and approve pull requests» для review-апрува через API
  (`POST /pulls/{n}/reviews` с `event: APPROVE`) документацией подтверждён лишь в общем виде.
- Прогон в состоянии approval-required, отменённый новой попыткой, остаётся `action_required` в
  истории; считать ли это шумом в метриках — вопрос к тикету про бюджет запусков.

## Sources

- Events that trigger workflows, `pull_request` (гейт для `GITHUB_TOKEN`-PR, поведение форков,
  merge conflict, Dependabot как форк):
  <https://docs.github.com/en/actions/reference/events-that-trigger-workflows#pull_request>
- Triggering a workflow (правило «события `GITHUB_TOKEN` не создают прогонов», исключение для
  `pull_request`, App/PAT снимает approval prompt):
  <https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow>
- Approving workflow runs from forks (кто апрувит, баннер «Awaiting approval», истечение через
  30 дней): <https://docs.github.com/en/actions/how-tos/manage-workflow-runs/approve-runs-from-forks>
- Managing GitHub Actions settings for a repository (политика апрува для форков, Workflow
  permissions, «Allow GitHub Actions to create and approve pull requests»):
  <https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository>
- Workflow syntax, `permissions` (список скоупов, `write` включает `read`, расчёт прав и понижение
  до read-only для форков):
  <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions>
- Securely using `pull_request_target` (`pull_request` запускает файл воркфлоу из merge-коммита PR):
  <https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target>
- Secure use reference (почему не тащить `pull_request_target` без нужды):
  <https://docs.github.com/en/actions/reference/security/secure-use>
- Making authenticated API requests with a GitHub App in a GitHub Actions workflow:
  <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow>
- REST: workflow runs (`action_required` как состояние прогона):
  <https://docs.github.com/en/rest/actions/workflow-runs>
- REST: Actions permissions (`can_approve_pull_request_reviews`):
  <https://docs.github.com/en/rest/actions/permissions>
- OpenAPI-описание GitHub REST API (схемы `simple-user.type`, `repository.fork`,
  `repository.full_name`, `pull-request.head.{ref,repo}`):
  <https://github.com/github/rest-api-description>
