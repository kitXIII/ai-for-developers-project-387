# Бюджет запусков PR по истории Actions (тикет #48)

Как до вызова модели посчитать, сколько допущенных команд человека уже потрачено на одном pull
request в воркфлоу `opencode.yml` (события `issue_comment` и `pull_request_review_comment`), и
остановить четвёртую. Всё, что ниже, проверено на живом API этого репозитория (снимок
**2026-11-22T15:26Z**) и на публичных прогонах `grafana/mimir` там, где в этом репозитории данных
нет. Непроверенное помечено явно.

## TL;DR

1. **`pull_requests[].number` для счётчика не годится.** Поле перечисляет только **открытые** PR,
   у которых совпал `head_sha`/`head_branch` прогона; у прогонов по `issue_comment` head — это
   ветка `main`, а закрытый PR из списка исчезает. В этом репозитории поле пустое у **всех 48**
   прогонов `opencode.yml` (и у 400 прогонов остальных воркфлоу).
2. **Идентификатор треда надо писать в имя прогона**: `run-name: "opencode #<N>"`. Оно попадает в
   `display_title` (и в `name`) прогона и не меняется задним числом. Дальше счётчик — это список
   прогонов `opencode.yml` с `display_title == "opencode #<N>"`, новые сверху, `--paginate`.
3. **Единица бюджета — попытка (`run_attempt`) прогона, в которой job агента реально стартовал**
   (`steps` непустой). `skipped` (условие job'а не прошло), `action_required`, `startup_failure`,
   `stale` и отказы бюджета не считаются; отмены, таймауты и Re-run считаются.
4. **Токену хватает `actions: read` у `GITHUB_TOKEN`** — новый App не нужен. Агентский токен
   (`issues: write`) историю Actions не перепишет: удаление прогона/логов и Re-run требуют
   `Actions: write`.
5. Отказ (`limit_exhausted`) считается **до checkout и до модели** отдельным job'ом, причины
   `timeout`/`infra`/`agent_failed` публикует job с `if: always()`, который модель не запускает.

## 1. Что такое единица бюджета

Решение карты (#46): 3 допущенные команды человека на один PR, включая отмены, таймауты и Re-run;
треды issue не ограничиваются. Отсюда определение, которое дальше и считается:

> Единица = один **attempt** прогона `opencode.yml` в этом треде, у которого job агента был запущен
> на раннере (в объекте job `steps` непустой). Первый attempt — 1 единица, каждый Re-run — ещё одна.

Почему так, а не «прогон»: Re-run заново выполняет job и снова вызывает модель
([Re-running workflows and jobs][rerun]), а в списке прогонов попытки схлопнуты в одну запись с
`run_attempt = N`. Считать прогоны, а не попытки, значит бесплатно разрешать Re-run.

Что **не** является единицей:

- прогон, у которого job не прошёл по `if` (в этом репозитории это любой не-командный комментарий
  в треде) — `conclusion: skipped`, `jobs[0].steps: []`;
- прогон, завершившийся `action_required` (PR из форка ждёт approve) или `startup_failure`
  (битый YAML) — модель не стартовала;
- прогон-отказ самого бюджета (job агента пропущен по `if`) — иначе счётчик рос бы на каждом
  отказе;
- сам текущий прогон (`github.run_id`) — он в момент проверки уже `in_progress` и уже попал бы в
  выдачу.

## 2. Как отличить прогоны одного PR

### 2.1. Почему не `pull_requests[].number`

Схема ответа говорит прямо: `pull_requests` — «Pull requests that are open with a `head_sha` or
`head_branch` that matches the workflow run. The returned pull requests do not necessarily indicate
pull requests that triggered the run» ([OpenAPI, схема `workflow-run`][spec]). То есть поле:

- фильтрует по **открытости** PR на момент запроса — после мержа/закрытия связь исчезает;
- у `issue_comment`-прогонов сверять нечего: прогон идёт с дефолтной ветки (`head_branch: main`,
  `head_sha` = head `main`).

Живые данные этого репозитория (2026-11-22T15:26Z):

```bash
gh api "repos/kitXIII/ai-for-developers-project-387/actions/workflows/opencode.yml/runs?per_page=100" \
  --jq '{total:.total_count, with_pr: [.workflow_runs[]|select((.pull_requests|length)>0)]|length,
         events: ([.workflow_runs[]|.event]|group_by(.)|map({(.[0]):length})|add)}'
# {"total":48,"with_pr":0,"events":{"issue_comment":47,"pull_request_review_comment":1}}
```

Ноль — не случайность: то же самое у `triage.yml`, `quality.yml`, `merge-audit.yml`
(`with_pr: 0` в каждом, по 100 последних прогонов). Обратный пример — `grafana/mimir`, где PR
открыт (поле заполнено) и закрыт (поле пустое) при том же воркфлоу:

```bash
gh api "repos/grafana/mimir/actions/workflows/backport.yaml/runs?per_page=3" \
  --jq '.workflow_runs[] | {display_title, pull_requests:(.pull_requests|map(.number))}'
```

| `display_title`                                                   | `pull_requests` |
| ----------------------------------------------------------------- | --------------- |
| `Backport for query-frontend: … (#17451)`                         | `[17451]`       |
| `Backport for mixin: Don't count context cancellation … (#17452)` | `[]`            |

Оба PR существуют; #17452 уже смержен, поэтому из `pull_requests` выпал. **Вывод: поле — про
текущее состояние PR, а не про историю прогонов. Для счётчика оно непригодно.**

### 2.2. Маркер в имени прогона

`run-name` — «The name for workflow runs generated from the workflow», допускает выражения с
контекстами `github` и `inputs` ([workflow syntax, `run-name`][runname]). Значение попадает в
`display_title` прогона («The event-specific title associated with the run or the run-name if
set», [спека][spec]) и, как показала живая проверка, ещё и в `name`.

Проверено на `grafana/mimir` (воркфлоу `backport.yaml`, `run-name: "Backport for ${{ github.event.pull_request.title }} (#${{ github.event.pull_request.number }})"`):

```json
{
  "event": "pull_request",
  "display_title": "Backport for query-frontend: … (#17451)",
  "name": "Backport for query-frontend: … (#17451)"
}
```

Для нашего воркфлоу это одна строка над `on:`:

```yaml
name: opencode
run-name: 'opencode #${{ github.event.issue.number || github.event.pull_request.number }}'
```

- `github.event.issue.number` есть у `issue_comment` (и у комментария в PR — это номер PR),
  `github.event.pull_request.number` — у `pull_request_review_comment`
  ([events that trigger workflows][events]); оба контекста доступны в `run-name` по документации.
- Номера issue и PR в репозитории общие, коллизий `opencode #34` между issue и PR не бывает.
- ⚠️ Не проверено живьём в этом репозитории (правка воркфлоу вне тикета): что выражение с
  `github.event.issue.number` даёт непустую строку именно для `issue_comment`. Механика та же, что
  у mimir для `pull_request`, ограничение документировано только на список контекстов.
- Побочный эффект: `name` прогона перестаёт быть `opencode` и становится `opencode #N`. На запросы
  по `workflows/opencode.yml/runs` это не влияет (workflow_id — путь файла), но `gh run list`
  в отчётах будет показывать маркер.
- Прогоны до правки маркера не имеют: их `display_title` — заголовок issue/PR. Для раскатки это
  значит, что счётчик начинает считать с нуля в момент включения. Так и задумано (бюджет — новая
  функция), но в теле реализации это надо записать.

### 2.3. Почему не `head_branch` / `head_sha`

| событие                       | `head_branch`                      | `head_sha`                    |
| ----------------------------- | ---------------------------------- | ----------------------------- |
| `issue_comment` в PR          | `main` (у всех прогонов одинаково) | head `main` на момент прогона |
| `pull_request_review_comment` | ветка PR                           | head PR на момент прогона     |

Живой пример: прогон 44635136943 (`pull_request_review_comment`) — `head_branch`
`release-please--branches--main--…`, `head_sha` `a4fe0272…`; у PR #42 сейчас head `931e2d07…`.
То есть `head_sha` прогона — снимок на момент запуска, а не текущий head PR, и у `issue_comment` он
вообще про `main`. Фильтр `branch=` спасает только для review-комментариев (и ломается, если ветку
переиспользовали под второй PR).

## 3. Точные запросы

### 3.1. Endpoint и параметры

`GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs` — «List workflow runs for a
workflow» ([docs][listruns]). Параметры, которые нам нужны ([спека][spec], `components.parameters`):

| параметр   | смысл                                                                                 |
| ---------- | ------------------------------------------------------------------------------------- |
| `event`    | `issue_comment`, `pull_request_review_comment`, … (одно значение)                     |
| `status`   | одно значение: `queued`, `in_progress`, `completed`, `success`, `skipped`…            |
| `created`  | диапазон дат в синтаксисе поиска (`>=2026-11-20T00:00:00Z`, `2026-11-20..2026-11-22`) |
| `per_page` | максимум **100**                                                                      |
| `page`     | номер страницы                                                                        |
| `head_sha` | точный head прогона (для `issue_comment` бесполезен)                                  |

Важное ограничение из описания операции: «This endpoint will return up to 1,000 results for each
search when using the following parameters: `actor`, `branch`, `check_suite_id`, `created`, `event`,
`head_sha`, `status`» ([docs][listruns]). Поэтому счётчик **не должен** фильтровать по `created`/
`event` на сервере: иначе после 1000 прогонов история обрежется. Фильтр по маркеру всё равно
клиентский, так что запрос — просто пагинация всего воркфлоу.

Формы ответа (живой снимок, 48 прогонов):

```json
{
  "total_count": 48,
  "workflow_runs": [
    {
      "id": 44736990687,
      "name": "opencode",
      "display_title": "Изменение расположения временных слотов при выборе даты и времени при бронировании",
      "event": "issue_comment",
      "path": ".github/workflows/opencode.yml",
      "head_branch": "main",
      "head_sha": "0b683d4cf7c8765974aa81f7e541fddf153175d8",
      "status": "completed",
      "conclusion": "success",
      "run_attempt": 1,
      "run_number": 46,
      "created_at": "2026-11-20T12:35:03Z",
      "run_started_at": "2026-11-20T12:35:03Z",
      "updated_at": "2026-11-20T12:41:17Z",
      "previous_attempt_url": null,
      "pull_requests": [],
      "html_url": "https://github.com/kitXIII/ai-for-developers-project-387/actions/runs/44736990687",
      "logs_url": "https://api.github.com/repos/kitXIII/ai-for-developers-project-387/actions/runs/44736990687/logs",
      "jobs_url": "https://api.github.com/repos/kitXIII/ai-for-developers-project-387/actions/runs/44736990687/jobs",
      "rerun_url": "https://api.github.com/repos/kitXIII/ai-for-developers-project-387/actions/runs/44736990687/rerun",
      "workflow_id": 424409784
    }
  ]
}
```

Полный список ключей элемента: `actor, artifacts_url, cancel_url, check_suite_id,
check_suite_node_id, check_suite_url, conclusion, created_at, display_title, event, head_branch,
head_commit, head_repository, head_sha, html_url, id, jobs_url, logs_url, name, node_id, path,
previous_attempt_url, pull_requests, referenced_workflows, repository, rerun_url, run_attempt,
run_number, run_started_at, status, triggering_actor, updated_at, url, workflow_id, workflow_url`.

Сортировка — по `created_at` по убыванию (свежие сверху); проверено: `--paginate` с `per_page=5`
отдаёт ровно 48 строк, `Link` ведёт на `page=2`.

Альтернатива без ручной пагинации — `gh run list` (обёртка над тем же эндпоинтом, сама листает
страницы до `--limit`; `displayTitle` = `display_title`, `attempt` = `run_attempt`):

```bash
gh run list --workflow=opencode.yml --limit 500 \
  --json displayTitle,attempt,conclusion,event,headSha,status,createdAt,url
# [{"attempt":1,"conclusion":"skipped","createdAt":"2026-11-22T15:09:56Z",
#   "displayTitle":"…","event":"issue_comment","headSha":"1be48851…","status":"completed",
#   "url":"https://github.com/kitXIII/ai-for-developers-project-387/actions/runs/45036770594"}]
```

Годится для отчётности; для preflight лучше явный `gh api`, потому что нужен `run_id` для
исключения текущего прогона и `run_attempt` без ограничений `--limit`. Ещё грабли: `gh api --jq`
не принимает `--arg`/`--argjson` (`accepts 1 arg(s), received 4`) — фильтр по маркеру пишется через
`| jq --arg …`.

### 3.2. Дешёвый счётчик (run-level, без доп. запросов)

Одна пагинируемая выборка + `jq`. Единицы — `run_attempt`; исключаются `skipped`, `action_required`,
`startup_failure`, `stale` и текущий прогон. Считает до лимита и выходит (обычно 1 запрос).

```bash
#!/usr/bin/env bash
# Счётчик бюджета: сколько запусков opencode уже потрачено в треде.
# Переменные ожидаются из workflow: GITHUB_REPOSITORY, GITHUB_RUN_ID, GH_TOKEN.
set -euo pipefail
thread="$1"                 # номер PR / issue
limit="${LIMIT:-3}"
marker="opencode #$thread"
self="${GITHUB_RUN_ID:-0}"  # текущий прогон не считаем
spent=0; page=1
while :; do
  body=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/opencode.yml/runs?per_page=100&page=$page")
  while IFS=$'\t' read -r id attempts; do
    [ -n "$id" ] || continue
    spent=$((spent + attempts))
    [ "$spent" -ge "$limit" ] && break 2
  done < <(jq -r --arg m "$marker" --argjson self "$self" '
      .workflow_runs[]
      | select(.display_title == $m and .id != $self)
      | select((.conclusion // "running")
               | IN("skipped","action_required","startup_failure","stale") | not)
      | [.id, .run_attempt] | @tsv' <<<"$body")
  [ "$(jq '.workflow_runs | length' <<<"$body")" -lt 100 ] && break
  page=$((page + 1))
done
echo "spent=$spent"; [ "$spent" -lt "$limit" ] || echo "REFUSE limit_exhausted"
```

Плюсы: один-два запроса, ~2 с. Минусы: считает и прогоны-отказы (у них `conclusion` не `skipped`,
потому что отказ публикует отдельный job), и ещё не стартовавшие queued-прогоны того же треда.
Для решения «пора остановить?» это безопасно (пересчёт только ужесточает), для точной цифры в
отчёте — нет.

### 3.3. Точный счётчик (attempt-level)

Единица = attempt, где job агента реально работал: у job'а непустой `steps`. Один запрос на список

- один на каждый attempt из посчитанных (≤ лимита + 1).

```bash
#!/usr/bin/env bash
set -euo pipefail
thread="$1"; limit="${LIMIT:-3}"; marker="opencode #$thread"; self="${GITHUB_RUN_ID:-0}"
units=0; page=1
while :; do
  body=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/opencode.yml/runs?per_page=100&page=$page")
  while IFS=$'\t' read -r id attempts; do
    [ -n "$id" ] || continue
    for n in $(seq 1 "$attempts"); do
      jobs=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$id/attempts/$n/jobs")
      ran=$(jq '[.jobs[] | select(.name == "Agent") | select((.steps | length) > 0)] | length' <<<"$jobs")
      units=$((units + ran))
      [ "$units" -ge "$limit" ] && break 2
    done
  done < <(jq -r --arg m "$marker" --argjson self "$self" '
      .workflow_runs[]
      | select(.display_title == $m and .id != $self)
      | select((.conclusion // "running")
               | IN("skipped","action_required","startup_failure","stale") | not)
      | [.id, .run_attempt] | @tsv' <<<"$body")
  [ "$(jq '.workflow_runs | length' <<<"$body")" -lt 100 ] && break
  page=$((page + 1))
done
echo "units=$units"; [ "$units" -lt "$limit" ] || echo "REFUSE limit_exhausted"
```

Проверка на реальных данных (тред issue #34, маркер подставлен заголовком, потому что `run-name`
пока нет): `units=6` при `LIMIT=99` (6 прогонов из 11, 1 + 6 = 7 запросов, ~8 с) и `units=3` +
`REFUSE` при `LIMIT=3` (1 + 3 = 4 запроса, ~5 с). `name == "Agent"` — это `jobs.opencode.name` из
`opencode.yml`; после переименования job'а строку надо поправить.

Уточнения:

- `attempts/{n}/jobs` существует и отдаёт `steps` ([list jobs for a workflow run attempt][attemptjobs])
  — проверено: `attempts/1` и `attempts/2` у прогона mimir 44098595519.
- `attempts/{n}` — только по одному номеру; эндпоинта «список attempts» **нет** (в спеке есть лишь
  `attempts/{attempt_number}`, `…/jobs`, `…/logs`), `GET …/attempts` → 404. Живая проверка:
  `…/runs/44736990687/attempts` → `Not Found`, `…/attempts/2` → `Not Found` (у прогона
  `run_attempt: 1`).
- Отдельный `GET /repos/{o}/{r}/actions/jobs/{job_id}` тоже отдаёт `steps` — если понадобится
  добирать только модель-шаг.

## 4. Попытки: Re-run, отмены, таймауты, очередь, skipped

### 4.1. `run_attempt`

«Attempt number of the run, 1 for first attempt and higher if the workflow was re-run»
([спека][spec]). В списке прогонов — **одна** запись на прогон с номером последней попытки;
`previous_attempt_url` при `run_attempt: 1` равен `null`, при Re-run — ссылка на предыдущую
попытку. Живой пример (mimir, прогон 44098595519):

```json
{
  "id": 44098595519,
  "run_attempt": 2,
  "previous_attempt_url": "https://api.github.com/repos/grafana/mimir/actions/runs/44098595519/attempts/1",
  "conclusion": "skipped",
  "created_at": "2026-11-17T14:01:17Z",
  "run_started_at": "2026-11-17T14:01:26Z"
}
```

Там же попытки расходятся по исходам: attempt 1 — `action_required` (форк без approve), attempt 2 —
`skipped`. Отсюда правило: **`conclusion` в списке — про последнюю попытку**; если нужна точность по
попыткам, смотри `attempts/{n}`.

`run_started_at` «Resets on re-run» ([спека][spec]) — сортировать по нему нельзя, только по
`created_at`.

Re-run доступен до 30 дней после первого запуска, максимум 50 раз, использует тот же `GITHUB_SHA`
и `GITHUB_REF`, то есть перезапускает job'ы (и модель) в прежнем контексте ([rerun][rerun]). Значит
каждый Re-run — новая единица бюджета.

### 4.2. Кого не считать

- **skipped от `if` job'а.** Любой комментарий в треде запускает воркфлоу; job при этом
  `conclusion: skipped`, и в объекте job `steps: []`. Живой пример (прогон 44737862831):
  `{"conclusion":"skipped","steps":[]}`, `created_at` = `updated_at` +2 с. В репозитории таких
  большинство: 28 из 48 прогонов на 2026-11-22T15:26Z (`success` 14, `failure` 3, `cancelled` 3,
  `skipped` 28).
- **cancelled и timed-out — считать.** Отменённый прогон 44714286160: job `cancelled`, в списке
  шагов модель-шаг присутствует и помечен `cancelled` (setup-шаги при этом `success`) — модель
  уже работала, единица потрачена.
- **queued.** `status: queued`, `conclusion: null`. Догоняющая единица: preflight такого прогона
  выполнится, когда кончится очередь, и увидит предыдущие завершёнными. В дешёвом счётчике
  `conclusion // "running"` как раз попадает в счёт — это команда человека, она будет выполнена.
- **`action_required`, `startup_failure`, `stale`** — прогон не дошёл до job'а агента; в фильтре
  исключены вместе со `skipped`.
- **Прогоны-отказы** (`limit_exhausted`): job агента пропущен, `steps: []` — точный счётчик их не
  видит, дешёвый считает (см. 3.2).

### 4.3. Очередь

`concurrency` в `opencode.yml`: группа `opencode-<номер треда>`, `cancel-in-progress: false`,
`queue: max` — до 100 ожидающих прогонов в группе, порядок FIFO по времени ожидания
([concurrency][concurrency]). Для счётчика это важно так: preflight всегда выполняется, когда
предыдущие прогоны треда уже завершились, поэтому читаемая история полна; гонки «два preflight
одного треда одновременно» нет. Между разными тредами гонки не страшны — бюджет у каждого свой.

## 5. Исключение чужих тредов и других воркфлоу

- Чужие треды: фильтр `display_title == "opencode #<N>"`. Ни `actor`, ни `event` этого не дают:
  в треде бывают комментарии разных людей, а `issue_comment` покрывает и issue, и PR.
- Другие воркфлоу: запрос идёт по `actions/workflows/opencode.yml/runs`, поэтому `triage.yml`,
  `merge-audit.yml`, `quality.yml` и `release-please.yml` в выборку не попадают вообще. Проверено:
  `total_count` у каждого воркфлоу считается отдельно (opencode 48, quality 52, release-please 23,
  merge-audit 13, triage 12 на 2026-11-22).
- Если авторевью (#47) заведёт свой воркфлоу — он не попадёт в счётчик по построению запроса; если
  его положат в `opencode.yml` другим job'ом — фильтр по `display_title` всё равно отделит его
  прогоны, только `run-name` должен остаться маркером PR.
- `--paginate` обязателен: 48 прогонов сегодня — это одна страница, но история растёт. Без
  `created`-фильтра лимит 1000 результатов не действует, пагинация обычная.

## 6. Токены: `actions: read` и что может агент

| что                                    | эндпоинт                       | право            |
| -------------------------------------- | ------------------------------ | ---------------- |
| список прогонов, прогон, попытка, jobs | `…/actions/…` (GET)            | `Actions: read`  |
| скачать логи (`logs_url`)              | `…/runs/{id}/logs`             | `Actions: read`  |
| Re-run                                 | `…/runs/{id}/rerun`            | `Actions: write` |
| удалить прогон / логи                  | `DELETE …/runs/{id}`, `…/logs` | `Actions: write` |
| комментарий в PR/issue                 | `POST …/issues/{n}/comments`   | `Issues: write`  |

Права — из разделов «Fine-grained access tokens for …» на страницах [workflow runs][listruns]
(`List workflow runs…` → Actions read, `Get a workflow run attempt` → Actions read, `Re-run a
workflow` → Actions write, `Delete a workflow run` → Actions write, `Download workflow run logs` →
Actions read). Там же: «Anyone with read access to the repository can use this endpoint» — для
публичного репозитория чтение работает даже без токена, но в job'е дешевле и предсказуемее
`permissions: actions: read` у `GITHUB_TOKEN` (ключ `actions` в блоке `permissions`
[workflow syntax][perms]).

Практический вывод: **новый App не нужен**, preflight ходит дефолтным токеном, как guard форков:

```yaml
permissions:
  contents: read
  actions: read # ← добавить
  pull-requests: read
```

`create-github-app-token` умеет `permission-actions: read`
([README][apptoken]), но это требует выдать право самому App; у трекера его нет и не надо.

### Почему счётчик живёт в истории Actions, а не в комментарии

1. **Прогон создаётся до любого шага.** Запись в истории появляется в момент события
   (`created_at` совпадает со временем комментария), то есть фиксирует команду даже если прогон
   отменили, он упал по таймауту или раннер умер. Комментарий-счётчик пишется в конце, а в этих
   сценариях его не будет — счётчик «потеряет» потраченные попытки и разрешит лишние вызовы.
2. **Агент не может переписать историю.** В шелле агента часовой токен App'а с `Issues: write`
   (README, «Авторизация и два App»), у `opencode-agent` — `contents`/`pull-requests`; ни у одного
   нет `Actions: write`, а удаление прогона/логов и Re-run требуют именно его (таблица выше).
   Комментарии же (`Issues: write`) агент править и удалять может — по крайней мере свои, и это
   ровно та поверхность, где счётчик был бы под контролем агента.
3. **История неизменяема платформой.** Попытки (`run_attempt`) и исходы пишет GitHub; человек
   может удалить свой комментарий, но не строку истории. Попытка «обнулить» бюджет требует
   `Actions: write`, которого у агента нет.
4. **Re-run виден.** Комментарий-счётчик не отличит «повторный запуск» от «новой команды», а
   `run_attempt` отличает.

## 7. Отчёт об отказе: последний head SHA и ссылка на лог

Из списка прогонов берётся самая свежая запись треда (кроме текущей):

```bash
latest=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/opencode.yml/runs?per_page=100" \
  | jq -c --arg m "opencode #$thread" --argjson self "$GITHUB_RUN_ID" \
    '[.workflow_runs[] | select(.display_title == $m and .id != $self)] | first
     | {id, conclusion, run_attempt, created_at, head_sha, url: .html_url, logs: .logs_url}')
```

Живой результат для одного прогона:

```json
{
  "id": 44635136943,
  "head_sha": "a4fe0272d8b1d00830cfe0d41ecb05f404c08a46",
  "url": "https://github.com/kitXIII/ai-for-developers-project-387/actions/runs/44635136943",
  "logs": "https://api.github.com/repos/kitXIII/ai-for-developers-project-387/actions/runs/44635136943/logs"
}
```

- **Ссылка на лог** — `html_url` (страница прогона в UI; у job'а есть свой `html_url` из
  `…/jobs`, он ведёт прямо к логу шага). `logs_url` — API-архив zip, требует `Actions: read` и
  уходит в редирект; для комментария человеку он неудобен, для машины — годится.
- **head SHA** — `.head_sha` прогона: у `pull_request_review_comment` это head PR **на момент
  запуска** (снимок), у `issue_comment` — head `main`. Поэтому в отчёте нужно два SHA:
  `.head_sha` последнего прогона и текущий head PR:

```bash
gh api "repos/$GITHUB_REPOSITORY/pulls/$thread" --jq .head.sha   # pull-requests: read уже есть
```

Живое сравнение: прогон 44635136943 — `a4fe0272…`, текущий head PR #42 — `931e2d07…`.

- ⚠️ Не проверено: время жизни `logs_url` (архив логов и артефакты удаляются по политике
  ретенции, по умолчанию 90 дней — [retention][retention]); сама запись прогона в списке остаётся,
  поэтому счётчик не «сбрасывается», но ссылка в старом отказе может протухнуть.

## 8. Поведение `limit_exhausted` и три остальные причины

### 8.1. Схема job'ов

Проверка бюджета — **отдельный job без checkout**, первый в графе; шарнир — `needs` + `if`:

```yaml
name: opencode
run-name: 'opencode #${{ github.event.issue.number || github.event.pull_request.number }}'

jobs:
  budget:
    name: Budget
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions:
      contents: read
      actions: read
      pull-requests: read
    outputs:
      allowed: ${{ steps.check.outputs.allowed }}
      spent: ${{ steps.check.outputs.spent }}
      reason: ${{ steps.check.outputs.reason }}
    steps:
      - id: check
        env:
          GH_TOKEN: ${{ github.token }}
          GITHUB_REPOSITORY: ${{ github.repository }}
          GITHUB_RUN_ID: ${{ github.run_id }}
          LIMIT: '3'
          THREAD: ${{ github.event.issue.number || github.event.pull_request.number }}
        run: bash .github/scripts/pr-run-budget.sh # тело из 3.3

  agent:
    name: Agent
    needs: budget
    if: needs.budget.outputs.allowed == 'true'
    # … существующие шаги: fork guard, checkout, mise, pnpm, токен трекера, модель …

  report:
    name: Report
    needs: [budget, agent]
    if: always()
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions:
      contents: read
      actions: read
      pull-requests: read
      issues: write
    steps: [… классификация и комментарий, см. 8.3 …]
```

Почему так, а не проверка в первом шаге job'а: при падении первого шага последующие получают
`skipped`, а `always()`-шаг в том же job'е не спасёт от таймаута и отмены; отдельный job с
`needs` + `if: always()` переживает падение и таймаут агентского job'а
([`needs.<job_id>.result`][contexts], [`always()`][expressions]).

### 8.2. Что происходит при исчерпании

1. `budget` считает единицы; при `spent >= 3` выставляет `allowed=false`, `reason=limit_exhausted`
   и **завершается успешно** (никаких checkout, mise, pnpm, модели).
2. `agent` пропускается по `if` — модель не вызывается, секреты не читаются, App-токен не
   выпускается.
3. `report` (`if: always()`) публикует комментарий с причиной, счётчиком, ссылкой на последний
   прогон и обоими SHA. Это единственный job, который тратит время на отказ (~5–10 с).

Отдельные причины, которые различает `report`:

| причина           | условие                                                                                           | что писать                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `limit_exhausted` | `needs.budget.outputs.allowed != 'true'`                                                          | «лимит 3 команды на PR исчерпан, модель не запускалась»          |
| `timeout`         | `needs.agent.result` ∈ {`cancelled`, `failure`} и длительность job'а ≈ `timeout-minutes` (±2 мин) | ссылка на лог, SHA, «прогон убит по таймауту, единица потрачена» |
| `infra`           | агентский job упал/отменён, но **модель-шага не было** в `steps`                                  | «сбой инфраструктуры до модели» (checkout, mise, pnpm, токен)    |
| `agent_failed`    | модель-шаг есть и завершился `failure`/`cancelled`                                                | «модель упала» + ссылка на лог                                   |

Живые подтверждения: все 6 прогонов с `failure`/`cancelled` в этом репозитории умерли именно в
шаге модели (`Run anomalyco/opencode/github@…`), то есть в терминах таблицы это `agent_failed`;
отменённый прогон 44714286160 — 14 мин 20 с, шаг модели `cancelled`. Инфраструктурных падений в
истории пока нет — ветка `infra` на живом примере не наблюдалась.

`timeout-minutes` у job'а: «The maximum number of minutes to let a job run before GitHub
automatically cancels it» ([workflow syntax][timeout]). ⚠️ Не проверено, какой именно `conclusion`
получает прогон при таймауте (`cancelled` по формулировке доков, но в UI такие прогоны красные);
поэтому условие выше принимает и `failure`, и `cancelled` и опирается на длительность.

### 8.3. Публикация без модели

`report` не запускает модель и не делает checkout: `gh api` + `jq` + `gh api …/comments`. Шаги:

```bash
# env: ALLOWED (needs.budget.outputs.allowed), RESULT (needs.agent.result),
#      GITHUB_REPOSITORY, GITHUB_RUN_ID, GH_TOKEN
if [ "$ALLOWED" != "true" ]; then
  reason=limit_exhausted
elif [ "$RESULT" = success ] || [ "$RESULT" = skipped ]; then
  exit 0                      # отчитываться не о чем
else
  job=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/jobs" \
        --jq '.jobs[] | select(.name == "Agent")')
  started=$(jq -r .started_at <<<"$job"); done_at=$(jq -r .completed_at <<<"$job")
  dur=$(( $(date -d "$done_at" +%s) - $(date -d "$started" +%s) ))
  model=$(jq '[.steps[] | select(.name == "Run the agent model")] | length' <<<"$job")
  if [ "$dur" -ge $(( 45 * 60 - 120 )) ]; then reason=timeout
  elif [ "$model" -gt 0 ]; then reason=agent_failed
  else reason=infra
  fi
fi
```

`…/runs/{run_id}/jobs` отдаёт `steps` с `name`, `status`, `conclusion`
([list jobs for a workflow run][jobs]); `gh` и `jq` на `ubuntu-24.04` предустановлены
(gh 2.104.0, jq 1.7 — [runner images][images]). ⚠️ Не проверено: виден ли job'у свой собственный
прогон в `…/jobs` в момент выполнения — по смыслу да (агентский job к этому моменту завершён), но
живьём в этом job'е не запускалось.

Связка «имя шага модели» — единственная хрупкость: API отдаёт только `name` шага, не `id`, поэтому
шаг модели стоит назвать явно (`- name: Run the agent model`) и держать это имя в одном месте.

## 9. Прогон на реальных данных этого репозитория

Снимок 2026-11-22T15:26Z, `opencode.yml`:

| показатель                                      | значение        |
| ----------------------------------------------- | --------------- |
| всего прогонов                                  | 48              |
| `success` / `failure` / `cancelled` / `skipped` | 14 / 3 / 3 / 28 |
| `issue_comment` / `pull_request_review_comment` | 47 / 1          |
| прогонов с непустым `pull_requests`             | 0               |
| прогонов с `run_attempt > 1`                    | 0               |

Тред issue #34 (11 прогонов, все `run_attempt: 1`) — единственный тред с длинной историей; на нём
и проверялся счётчик (маркер подставлялся заголовком, `run-name` в воркфлоу ещё нет):

```bash
gh api "repos/kitXIII/ai-for-developers-project-387/actions/workflows/opencode.yml/runs?per_page=100" \
  --jq '[.workflow_runs[] | select(.display_title=="Изменение расположения временных слотов при выборе даты и времени при бронировании")]
       | {runs:length, skipped:(map(select(.conclusion=="skipped"))|length),
          units:(map(select(.conclusion!="skipped")|.run_attempt)|add)}'
# {"runs":11,"skipped":5,"units":6}
```

Разбор: 5 прогонов `skipped` (комментарии без команды) не считаются; оставшиеся 6 дали 6 единиц —
`success` 2 (`44736990687`, `44726380028`), `failure` 3 (`44734203598`, `44726834761`,
`44722289663`), `cancelled` 1 (`44714286160`, 14 мин 20 с, шаг модели `cancelled`). С `LIMIT=3`
скрипт из 3.3 останавливается на третьей единице и печатает `REFUSE limit_exhausted`.

**Чего в репозитории нет:** ни одного прогона `opencode.yml` на PR-треде (единственный
`pull_request_review_comment` — release-please #42, и он `skipped`). Поэтому PR-специфичная часть
(маркер `opencode #N`, `pull_requests`) проверена на публичных данных `grafana/mimir`, где
`run-name` уже используется, а `pull_requests` ведёт себя ровно так, как описано в спеке.

## 10. Edge cases

- **Правка/удаление комментария человеком** — не влияет: счётчик читает историю прогонов.
- **Комментарий-команда в PR, а не в issue** — один `issue_comment`, тот же маркер; `issue.number`
  в payload равен номеру PR.
- **Команда в review-треде** — `pull_request_review_comment`, маркер тот же (`pull_request.number`).
- **Re-run после отказа** — невозможен через UI у `skipped`-прогона, но API/`gh run rerun` может;
  точный счётчик всё равно не посчитает попытку без запущенного job'а.
- **Отмена в очереди** — прогон `cancelled`, job агента не стартовал (`steps: []`) → точный
  счётчик не считает. Это осознанное решение: бюджет ограничивает вызовы модели, а не нажатия.
  Если нужно считать и такие — критерий «job стартовал» меняется на «job не skipped», и тогда
  отказы бюджета тоже начнут считаться (нужен второй признак).
- **Переполнение `queue: max` (100 ожидающих)** — лишние прогоны отменяются платформой; они
  попадут в историю как `cancelled`; точный счётчик их не посчитает (job не стартовал).
- **PR старше ретенции** — запись прогона остаётся, лог может истечь (см. 7).
- **Прогоны до включения `run-name`** — без маркера, не считаются; ожидаемый «сброс» на старте.
- **Форки** — до бюджета дело не доходит: guard форков падает раньше (и `agent` вообще не
  запускается при `allowed=false`).
- **Авторевью (#47)** — свой воркфлоу не попадает в выборку; если его положат внутрь
  `opencode.yml`, маркер PR сохранит разделение, но job'ы авторевью должны иметь своё имя, если
  точный счётчик будет считать по имени job'а.
- **Публичный репозиторий** — чтение работает и без токена, но `permissions: actions: read` всё
  равно нужен: без него `GITHUB_TOKEN` в job'е не имеет права `actions`.

## 11. Sources

- [Спека REST API GitHub (OpenAPI), схема `workflow-run` и параметры списка прогонов][spec] —
  формулировки про `pull_requests`, `run_attempt`, `run_started_at`, `display_title`, `logs_url`,
  `previous_attempt_url`; список параметров эндпоинта.
- [REST: workflow runs — «List workflow runs for a workflow» и права fine-grained][listruns] —
  `Actions: read`, лимит 1000 результатов при серверных фильтрах, «Anyone with read access…».
- [REST: «List jobs for a workflow run attempt»][attemptjobs] — `attempts/{n}/jobs` со `steps`.
- [REST: «List jobs for a workflow run»][jobs] — поля job'а (`steps`, `conclusion`, `started_at`).
- [Actions: Re-running workflows and jobs][rerun] — Re-run перезапускает job'ы с тем же
  `GITHUB_SHA`/`GITHUB_REF`, до 30 дней / 50 раз.
- [Workflow syntax: `run-name`][runname] — имя прогона, выражения, контексты `github`/`inputs`.
- [Workflow syntax: `jobs.<job_id>.timeout-minutes`][timeout] — «GitHub automatically cancels it».
- [Workflow syntax: `concurrency` и `queue`][concurrency] — один running + до 100 pending при
  `queue: max`, FIFO.
- [Workflow syntax: `permissions`][perms] — ключ `actions` у `GITHUB_TOKEN`.
- [Contexts: `needs.<job_id>.result`, `steps.<step_id>.outcome`][contexts].
- [Expressions: `always()`][expressions].
- [Events that trigger workflows: `issue_comment`, `pull_request_review_comment`][events] — payload
  с `issue.number` / `pull_request.number`.
- [`actions/create-github-app-token`: `permission-<name>`][apptoken] — как выдать `actions: read`
  токену App (нам не требуется).
- [Ubuntu 24.04 runner image: gh 2.104.0, jq 1.7][images].
- [Ретенция логов и артефактов Actions (по умолчанию 90 дней)][retention].
- Живые данные: прогоны `opencode.yml` этого репозитория (снимок 2026-11-22T15:26Z) и публичные
  прогоны `grafana/mimir` (`backport.yaml`, прогон 44098595519 с `run_attempt: 2`).

[spec]: https://github.com/github/rest-api-description/blob/main/descriptions/api.github.com/api.github.com.json
[listruns]: https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow
[attemptjobs]: https://docs.github.com/en/rest/actions/workflow-runs#list-jobs-for-a-workflow-run-attempt
[jobs]: https://docs.github.com/en/rest/actions/workflow-runs#list-jobs-for-a-workflow-run
[rerun]: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs
[runname]: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#run-name
[timeout]: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idtimeout-minutes
[concurrency]: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency
[perms]: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions
[contexts]: https://docs.github.com/en/actions/reference/workflows-and-actions/contexts
[expressions]: https://docs.github.com/en/actions/reference/workflows-and-actions/expressions
[events]: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
[apptoken]: https://github.com/actions/create-github-app-token#permission-permission-name
[images]: https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md
[retention]: https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization
