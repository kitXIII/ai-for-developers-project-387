# OpenCode CLI для авторевью PR (тикет #47)

Как запустить «обычный» OpenCode CLI в GitHub Actions, чтобы получить текст ревью PR без
`opencode github run`. Заметка опирается на исходники и документацию тега `v1.19.6` — именно эта
версия закреплена в репозитории (см. `.github/actions/opencode/action.yml`). Живые страницы
`opencode.ai/docs` уже описывают V2, где поле называется `permissions`, поэтому для закреплённой V1
источником служат файлы документации в git-теге `v1.19.6`.

## Коротко

- Headless-запуск — `opencode run [message..]`; модель задаётся `-m/--model provider/model`,
  агент — `--agent`, промпт — позиционным аргументом (или stdin), файлы — `-f/--file`.
- CLI ничего не знает про GitHub: ни про номер PR, ни про base/head. Diff готовит workflow
  (`actions/checkout` + `git diff --merge-base`), а внутрь модели его кладут через `--file`.
  GitHub-токен самому OpenCode не нужен; токен нужен только `checkout` и шагу публикации.
- Запись запрещается V1-конфигом `permission`: `edit`, `bash`, `task`, `webfetch`, `skill`,
  `external_directory` в `deny`. В non-interactive режиме правило `ask` не ждёт человека, а
  автоматически отклоняется, поэтому `deny` — единственный надёжный способ.
- Текст ревью отделяется от служебного вывода потоками: в `opencode run` служебные строки и ошибки
  идут в **stderr**, а текст ассистента — в **stdout**. Альтернатива — `--format json` и `jq`.
- Публикация — отдельный шаг `gh pr comment --body-file`, только после успешного шага ревью.
  Таймаута у CLI нет: ограничение задаётся `timeout-minutes` шага/джобы GitHub Actions.
- Версия в репозитории: `1.19.6`, установка — tar-архив
  `opencode-linux-x64.tar.gz` из GitHub Releases.

## 1. Точная headless-команда

Документация V1: «Run opencode in non-interactive mode by passing a prompt directly» —
`opencode run [message..]`
([cli.mdx#run](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/web/src/content/docs/cli.mdx)).
Полный список флагов подтверждён локальным запуском `opencode run --help` у бинаря `1.19.6`
(darwin-arm64) и совпадает с исходником
([run.ts](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/cli/cmd/run.ts)).

| Флаг                                                             | Что делает                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `-m, --model provider/model`                                     | Модель, например `opencode/deepseek-v4.1-flash`                                      |
| `--agent <name>`                                                 | Primary-агент; subagent использовать нельзя — CLI предупредит и откатится на default |
| `--format default\|json`                                         | `default` — форматированный вывод, `json` — поток JSON-событий                       |
| `-f, --file <path>`                                              | Прикрепить файл к сообщению (можно несколько раз)                                    |
| `--dir <path>`                                                   | Рабочая директория (по умолчанию — cwd)                                              |
| `--attach <url>`                                                 | Подключиться к запущенному `opencode serve` вместо локального сервера                |
| `--auto`                                                         | Авто-подтверждать `ask`-правила (явные `deny` не отменяет); для ревью не нужен       |
| `-c/--continue`, `-s/--session`, `--fork`                        | Продолжить/форкнуть сессию                                                           |
| `--command <name>`                                               | Выполнить slash-команду вместо свободного промпта                                    |
| `--title`, `--variant`, `--thinking`, `--password`, `--username` | Служебные                                                                            |

Пример точной командной строки (одна строка, без переносов):

```bash
opencode run --model opencode/deepseek-v4.1-flash --agent plan --file "$RUNNER_TEMP/pr.diff" "$REVIEW_PROMPT"
```

Промпт: позиционные аргументы склеиваются через пробел; если stdin не TTY, CLI дочитывает его и
добавляет к сообщению через перевод строки. Пустой промпт без `--command` завершает процесс с
кодом 1 и ошибкой `You must provide a message or a command`
([run.ts](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/cli/cmd/run.ts)).
Для длинного промпта удобно положить его в переменную окружения шага и передать `"$REVIEW_PROMPT"`.

Модель: формат `provider/model`, разбиение по первому `/` — остальное считается modelID
([run.ts](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/cli/cmd/run.ts)).
Для OpenCode Zen ключ читается из `OPENCODE_API_KEY`; без ключа провайдер уходит в режим `public`
([opencode.ts](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/core/src/plugin/provider/opencode.ts)).
Документация провайдеров описывает подключение Zen через `/connect` и API-ключ
([providers.mdx](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/web/src/content/docs/providers.mdx)).

Агент: `--agent plan` — встроенный primary-агент для анализа без изменений кода; Build — default с
полным доступом. Subagent из `--agent` не подходит: `run` проверяет `mode` и откатывается на
default
([agents.mdx](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/web/src/content/docs/agents.mdx),
[run.ts](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/cli/cmd/run.ts)).

## 2. Как CLI видит diff и файлы PR

`opencode run` не читает событие GitHub: у него нет ни `GITHUB_EVENT_PATH`, ни номера PR. Он
работает в текущей директории и даёт модели инструменты `read`, `glob`, `grep`, `bash` и т. д.
Единственная команда, которая разбирает событие и сама пишет комментарий, — `opencode github run`
([github.mdx](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/web/src/content/docs/github.mdx),
[github.ts](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/cli/cmd/github.ts)).
Именно поэтому в схеме «обычный CLI» контекст PR обязан подготовить workflow.

Практическая схема:

1. `actions/checkout` с `fetch-depth: 0` и `persist-credentials: false`. По умолчанию checkout
   забирает один коммит, а для diff нужен base
   ([actions/checkout README](https://github.com/actions/checkout#readme)).
2. Для события `pull_request` checkout садится на merge-ветку `refs/pull/N/merge`, а
   `github.event.pull_request.base.sha` даёт базу
   ([events-that-trigger-workflows#pull_request](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)).
3. Diff считается трёхточечно: `git diff --merge-base "$BASE_SHA" HEAD > pr.diff`
   ([git-diff](https://git-scm.com/docs/git-diff)).
4. Готовый diff прикрепляется к промпту через `--file` — модель читает его как вложение. Лимит
   вложения 10 MiB на файл — константа `ATTACH_FILE_MAX_BYTES`
   ([run.ts](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/cli/cmd/run.ts)).
   Если diff больше, его можно порезать по файлам или положить в рабочую копию и дать прочитать
   инструментом `read`.

Альтернатива для приватного репозитория — `gh pr diff "$PR" > pr.diff`: это REST-запрос diff PR,
нужен токен с доступом на чтение pull requests
([gh pr diff](https://cli.github.com/manual/gh_pr_diff)). Но при уже сделанном checkout локальный
`git diff` дешевле и не требует токена.

Токен и права:

- Сам OpenCode GitHub-токен не использует; `GITHUB_TOKEN` в его коде появляется только в ветке
  `opencode github run` с `use_github_token`
  ([github.ts](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/cli/cmd/github.ts)).
- `actions/checkout` использует `GITHUB_TOKEN`; достаточно `contents: read`, а
  `persist-credentials: false` не оставляет токен в `.git/config`
  ([actions/checkout README](https://github.com/actions/checkout#readme)).
- Публикация комментария: `POST /repos/{owner}/{repo}/issues/{number}/comments`; «every pull request
  is an issue», поэтому подходит `issues: write`
  ([REST issue comments](https://docs.github.com/en/rest/issues/comments?apiVersion=2022-11-28#create-an-issue-comment)).
  На практике для PR GitHub может потребовать `pull-requests: write` — в примере выданы оба; это
  поведение платформы не проверено по первоисточнику, помечено как **не проверено**.
- У PR из форка `GITHUB_TOKEN` read-only, поэтому комментарий из такого прогона не опубликуется
  ([events-that-trigger-workflows#pull_request](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)).
  В примере форки отсечены условием `head.repo.fork == false`.

`opencode pr <number>` как headless-вариант не подходит: команда делает `gh pr checkout` и запускает
интерактивный TUI, а не `run`
([pr.ts](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/cli/cmd/pr.ts)).

## 3. Запрет записи: V1 `permission`

V1 использует ключ `permission` (не `permissions`), действия `bash`/`task` (не `shell`/`subagent`)
([permissions.mdx](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/web/src/content/docs/permissions.mdx)).
Схема конфига перечисляет известные ключи: `read`, `edit`, `glob`, `grep`, `list`, `bash`, `task`,
`external_directory`, `todowrite`, `question`, `webfetch`, `websearch`, `lsp`, `doom_loop`, `skill`
([config/permission.ts](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/core/src/v1/config/permission.ts)).

Правила: `allow` / `ask` / `deny`; в объектной форме побеждает **последнее** совпавшее правило,
`"*"` — catch-all
([permissions.mdx](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/web/src/content/docs/permissions.mdx)).
`OPENCODE_CONFIG_CONTENT` — inline-конфиг с высоким приоритетом, выше project-конфига
([config.mdx](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/web/src/content/docs/config.mdx)).
Проектный конфиг и агенты из `.opencode` при этом всё равно загружаются, а правила агента применяются
после глобальных — поэтому `deny` в inline-конфиге нужно дублировать явными ключами и проверять
рабочее дерево после прогона (см. ниже; приоритет агентских правил — **не проверено** экспериментом).

Конфиг для ревьюера:

```json
{
  "permission": {
    "*": "deny",
    "read": { "*": "allow", "*.env": "deny", "*.env.*": "deny", "*.env.example": "allow" },
    "glob": "allow",
    "grep": "allow",
    "list": "allow",
    "edit": "deny",
    "bash": "deny",
    "task": "deny",
    "webfetch": "deny",
    "websearch": "deny",
    "skill": "deny",
    "lsp": "deny",
    "external_directory": "deny",
    "doom_loop": "deny"
  }
}
```

Почему именно так:

- `edit` закрывает `edit`, `write` и `patch` — модель не изменит код
  ([permissions.mdx](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/web/src/content/docs/permissions.mdx)).
- `bash: deny` закрывает `git commit`, `git push`, `gh`, `curl` и любые записи через shell. Если
  разрешить `git diff *`, то shell-правила надо перечислять явно и помнить, что парсер команд — не
  граница безопасности.
- `task`, `webfetch`, `websearch`, `skill`, `lsp` запрещены, чтобы ревьюер не уходил в субагентов, сеть
  и внешние скиллы.
- `external_directory: deny` не даёт читать/писать за пределами рабочей копии; `--dir` не нужен,
  процесс и так стартует в checkout.
- `webfetch`/`websearch` в `deny` — единственный способ гарантировать отсутствие сети у модели.

Важное поведение headless-режима: при `permission.asked` CLI без `--auto` **сам отклоняет** запрос
(`reply: "reject"`), а не зависает в ожидании
([run.ts](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/cli/cmd/run.ts)).
То есть `ask` в CI — это фактически `deny` с записью в stderr. `--auto` подтверждает `ask`, но
явные `deny` не отменяет
([permissions.mdx](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/web/src/content/docs/permissions.mdx));
для ревью флаг не нужен.

Дополнительно: `--pure` отключает внешние плагины
([cli.mdx](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/web/src/content/docs/cli.mdx)),
что снижает риск исполнения кода из PR. Но проектный `opencode.json` и агенты всё равно читаются,
поэтому после прогона проверяйте `git status --porcelain` и держите токен read-only: даже если
модель что-то записала, запушить она не сможет.

## 4. Отделение текста ревью от служебного вывода

В `opencode run` потоки разделены на уровне UI: `UI.println`/`UI.error` пишут в **stderr**, а готовые
текстовые части ответа ассистента в non-TTY режиме пишутся напрямую в **stdout**
([ui.ts](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/cli/ui.ts),
[run.ts](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/cli/cmd/run.ts)).
Баннер, строки `> build · model`, статусы инструментов и `Error: ...` остаются в stderr, поэтому
простое перенаправление даёт чистый Markdown:

```bash
opencode run ... > "$RUNNER_TEMP/review.md" 2> "$RUNNER_TEMP/opencode.log"
```

Структурированный вариант — `--format json`: каждая строка stdout — JSON-событие; текст лежит в
событиях `type: "text"` как `part.text`, ошибки — в `type: "error"` (см. `emit()` в
[run.ts](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/cli/cmd/run.ts)).
Извлечение:

```bash
opencode run --format json ... 2> "$RUNNER_TEMP/opencode.log" \
  | jq -r 'select(.type == "text") | .part.text' > "$RUNNER_TEMP/review.md"
```

`jq` есть на образе `ubuntu-24.04`
([runner-images](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)).
С `set -o pipefail` падение CLI уронит шаг, а не оставит пустой файл. Плюс JSON-режима: ошибка
провайдера детерминированно видна как событие `type: "error"` в stdout, без разбора текста stderr.

Публикация — отдельный шаг, чтобы CLI не смешивался с записью в GitHub и чтобы у модели не было
токена на комментарии:

```bash
gh pr comment "$PR" --body-file "$RUNNER_TEMP/review.md"
```

`--body-file` читает тело из файла; `-F -` читает stdin
([gh pr comment](https://cli.github.com/manual/gh_pr_comment)). Шаг публикации должен выполняться
только при успехе шага ревью (условие по умолчанию `success()`), иначе есть риск опубликовать
пустой/частичный текст. Перед публикацией полезны две проверки:

```bash
test -s "$RUNNER_TEMP/review.md"           # текст не пустой
test -z "$(git status --porcelain)"        # ревьюер не изменил рабочую копию
```

Если нужно обновлять один и тот же комментарий, а не плодить новые, у `gh pr comment` есть
`--edit-last`/`--delete-last`; это отдельный дизайн-вопрос, в примере не используется
([gh pr comment](https://cli.github.com/manual/gh_pr_comment)).

## 5. Таймауты и коды выхода

У `opencode run` в `1.19.6` нет флага таймаута — ни в `--help`, ни в исходнике
([run.ts](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/cli/cmd/run.ts)).
Ограничение задаёт GitHub Actions: `timeout-minutes` у шага или у джобы; по умолчанию джоба живёт
360 минут
([workflow-syntax#jobsjob_idsteps_timeout-minutes](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idsteps_timeout-minutes),
[workflow-syntax#jobsjob_idtimeout-minutes](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idtimeout-minutes)).
По истечении GitHub убивает процесс; шаг/джоба помечается как failed/cancelled. Точный код выхода
убитого процесса GitHub не публикует — **не проверено**.

Если нужен собственный таймаут с различимым кодом, оберните вызов в GNU `timeout`:

```bash
timeout --signal=TERM 15m opencode run ...
```

`timeout` вернёт `124`, если команда не уложилась, `125` — ошибка самого `timeout`, `126` — команда
найдена, но не запускается, `127` — команда не найдена
([coreutils: timeout](https://www.gnu.org/software/coreutils/manual/html_node/timeout-invocation.html)).

Коды `opencode run`:

| Код   | Когда                                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0`   | Сессия дошла до `idle` без `session.error`                                                                                                                               |
| `1`   | Ошибка модели/провайдера (`session.error`, ошибка `session.prompt`), пустой промпт, неверные аргументы; в конце CLI делает `process.exit()`, сохраняя `process.exitCode` |
| `127` | Бинаря нет в `PATH` (сбой установки/шага PATH)                                                                                                                           |

Источник кодов: `execute()`/`loop()` выставляют `process.exitCode = 1` при ошибке
([run.ts](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/cli/cmd/run.ts)), а
`index.ts` в `finally` вызывает `process.exit()`
([index.ts](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/index.ts));
семантика `process.exit()`/`exitCode` — в документации Node
([process.exit](https://nodejs.org/api/process.html#processexitcode)).

Как отличить сбой модели от сбоя установки:

- Установка — отдельный шаг. `curl`/`tar`/`install` падают с ненулевым кодом до запуска CLI; после
  установки сразу выполните `opencode --version` — это дешёвый guard, что бинарь на месте.
- Модель — шаг CLI вернул `1`, в stderr есть `Error: ...` (или в JSON — событие `type: "error"`),
  при этом `opencode --version` в том же джобе уже отработал.
- `127` — установка/PATH, а не модель.
- Отказ в permissions **не** роняет прогон: инструмент получает ошибку, модель продолжает, код
  остаётся `0`; поэтому проверка `git status` обязательна.

Локальная проверка бинаря `1.19.6` (darwin-arm64) с невалидным ключом провайдера подтвердила эту
картину: default-режим — `exit 1`, stdout пуст, в stderr `Error: Invalid credential`; JSON-режим —
`exit 1`, stdout содержит `{"type":"error", ...}`, stderr пуст. Успешный ответ модели проверить не
удалось: ключ провайдера был невалиден, поэтому ветка успеха подтверждена только исходниками, а не
экспериментом.

## 6. Закреплённая версия в этом репозитории

Локальный composite action `.github/actions/opencode/action.yml` принимает input `version` со
значением по умолчанию `1.19.6` и ставит бинарь из публичного релиза:

```text
https://github.com/anomalyco/opencode/releases/download/v${VERSION}/opencode-linux-x64.tar.gz
```

([action.yml](https://github.com/kitXIII/ai-for-developers-project-387/blob/research/opencode-cli-review/.github/actions/opencode/action.yml)).
Релиз `v1.19.6` опубликован 2026-11-17, архив `opencode-linux-x64.tar.gz` в нём присутствует
([release v1.19.6](https://github.com/anomalyco/opencode/releases/tag/v1.19.6),
[assets](https://github.com/anomalyco/opencode/releases/expanded_assets/v1.19.6)). Версия закреплена
потому, что workflow используют V1 `permission`, а V2 с `permissions` не проходит валидацию
(комментарий в `action.yml`).

Важно: сам composite action в конце запускает `opencode github run`, поэтому для ревью его нельзя
вызвать как есть. В примере ниже шаги установки скопированы из action.yml, а запуск — `opencode run`.
Если понадобится переиспользование, у action стоит добавить input с командой, но это изменение кода,
а не предмет этой заметки.

## 7. Готовый workflow

Скопируйте в `.github/workflows/pr-review.yml`. Предполагается, что секрет `OPENCODE_API_KEY` уже
настроен (он же используется в `opencode.yml` и `triage.yml`). Комментарий публикуется только для
PR из этого же репозитория: у форков токен read-only.

```yaml
name: pr-review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions: {}

concurrency:
  group: pr-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    name: OpenCode review
    runs-on: ubuntu-24.04
    timeout-minutes: 25
    # У PR из форка GITHUB_TOKEN read-only: комментарий не опубликуется.
    if: github.event.pull_request.head.repo.fork == false
    permissions:
      contents: read # checkout
      pull-requests: write # комментарий к PR
      issues: write # тот же комментарий идёт через Issues API

    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false

      - name: Install OpenCode 1.19.6
        env:
          VERSION: '1.19.6'
        run: |
          set -euo pipefail
          mkdir -p "$HOME/.opencode/bin"
          curl -fsSL \
            "https://github.com/anomalyco/opencode/releases/download/v${VERSION}/opencode-linux-x64.tar.gz" \
            -o "$RUNNER_TEMP/opencode.tar.gz"
          tar -xzf "$RUNNER_TEMP/opencode.tar.gz" -C "$RUNNER_TEMP"
          install -m 0755 "$RUNNER_TEMP/opencode" "$HOME/.opencode/bin/opencode"
          echo "$HOME/.opencode/bin" >> "$GITHUB_PATH"
          "$HOME/.opencode/bin/opencode" --version

      - name: Build PR diff
        env:
          BASE_SHA: ${{ github.event.pull_request.base.sha }}
        run: |
          set -euo pipefail
          git diff --no-color --merge-base "$BASE_SHA" HEAD > "$RUNNER_TEMP/pr.diff"
          test -s "$RUNNER_TEMP/pr.diff"

      - name: Review with OpenCode
        timeout-minutes: 15
        env:
          OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}
          # V1 permission: модель может читать код, но не писать, не запускать shell,
          # не ходить в сеть и не выходить за пределы checkout.
          OPENCODE_CONFIG_CONTENT: >-
            {"permission":{"*":"deny",
            "read":{"*":"allow","*.env":"deny","*.env.*":"deny","*.env.example":"allow"},
            "glob":"allow","grep":"allow","list":"allow",
            "edit":"deny","bash":"deny","task":"deny","webfetch":"deny","websearch":"deny",
            "skill":"deny","lsp":"deny","external_directory":"deny","doom_loop":"deny"}}
          REVIEW_PROMPT: |
            Ты — ревьюер pull request. Приложенный файл pr.diff содержит diff PR
            против базовой ветки. Прочитай его и при необходимости открой файлы
            репозитория для контекста. Не меняй файлы, не запускай команды, не ходи
            в сеть. Верни только текст ревью в Markdown: краткое резюме, затем
            замечания по строкам с путями и приоритетом (blocker/major/minor),
            затем список того, что проверено. Без вступлений и служебных фраз.
        run: |
          set -euo pipefail
          opencode run \
            --model opencode/deepseek-v4.1-flash \
            --agent plan \
            --file "$RUNNER_TEMP/pr.diff" \
            "$REVIEW_PROMPT" \
            > "$RUNNER_TEMP/review.md" 2> "$RUNNER_TEMP/opencode.log"
          test -s "$RUNNER_TEMP/review.md"

      - name: Verify the reviewer did not write
        run: |
          set -euo pipefail
          git status --porcelain
          test -z "$(git status --porcelain)"

      - name: Publish review
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.pull_request.number }}
        run: |
          set -euo pipefail
          gh pr comment "$PR" --body-file "$RUNNER_TEMP/review.md"
```

Замечания к примеру:

- `fetch-depth: 0` нужен, чтобы `base.sha` был в локальном репозитории; иначе `git diff` упадёт
  ([actions/checkout README](https://github.com/actions/checkout#readme)).
- `persist-credentials: false` убирает токен из git config, поэтому даже при утечке записи модель не
  сможет запушить
  ([actions/checkout README](https://github.com/actions/checkout#readme)).
- `OPENCODE_CONFIG_CONTENT` записан в JSON как многострочный YAML folded-scalar; итоговая строка
  должна остаться валидным JSON (пробелы/переводы строк между токенами допустимы).
- Если diff превышает 10 MiB, `--file` отклонит вложение
  ([run.ts](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/cli/cmd/run.ts)).
  Для больших PR режьте diff по файлам или передавайте список изменённых файлов и дайте модели читать
  их из рабочей копии.
- Модель и агент должны существовать в провайдере и быть primary; проверьте это до раскатки.
- Логи `opencode.log` стоит выгружать артефактом при падении — они отделены от текста ревью и не
  попадут в комментарий.

## 8. Что осталось непроверенным

- **не проверено**: требует ли GitHub именно `pull-requests: write` (а не `issues: write`) для
  `gh pr comment` на PR; в примере выданы оба права.
- **не проверено**: переопределяют ли правила агента из проектного `.opencode`/`opencode.json`
  inline-`deny`; поэтому в примере есть пост-проверка `git status` и read-only токен.
- **не проверено**: как GitHub кодирует код выхода шага, убитого по `timeout-minutes`.
- **не проверено**: успешный ответ модели на `1.19.6` — локальный ключ провайдера был невалиден.
- **не проверено**: полный эффект `--pure` на проектный конфиг и агентов (документация обещает
  только отключение внешних плагинов).
- **не проверено**: контрольные суммы релизных архивов OpenCode — в action.yml они не проверяются.

## Sources

- Документация CLI V1 (тег v1.19.6), раздел `run`:
  <https://github.com/anomalyco/opencode/blob/v1.19.6/packages/web/src/content/docs/cli.mdx>
- Исходник `opencode run` (флаги, stdin, вывод, exitCode):
  <https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/cli/cmd/run.ts>
- UI-потоки (`UI.println` → stderr):
  <https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/cli/ui.ts>
- Точка входа CLI (`process.exit()`):
  <https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/index.ts>
- Документация permissions V1:
  <https://github.com/anomalyco/opencode/blob/v1.19.6/packages/web/src/content/docs/permissions.mdx>
- Схема V1 permission (ключи и типы):
  <https://github.com/anomalyco/opencode/blob/v1.19.6/packages/core/src/v1/config/permission.ts>
- Документация config V1 (приоритет `OPENCODE_CONFIG_CONTENT`):
  <https://github.com/anomalyco/opencode/blob/v1.19.6/packages/web/src/content/docs/config.mdx>
- Документация agents V1 (Build/Plan, primary/subagent):
  <https://github.com/anomalyco/opencode/blob/v1.19.6/packages/web/src/content/docs/agents.mdx>
- Документация GitHub-интеграции (`opencode github run`, OIDC/token):
  <https://github.com/anomalyco/opencode/blob/v1.19.6/packages/web/src/content/docs/github.mdx>
- Исходник `opencode github` (единственное место с `GITHUB_TOKEN`):
  <https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/cli/cmd/github.ts>
- Исходник `opencode pr` (интерактивный checkout):
  <https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/cli/cmd/pr.ts>
- Провайдер Zen и `OPENCODE_API_KEY`:
  <https://github.com/anomalyco/opencode/blob/v1.19.6/packages/core/src/plugin/provider/opencode.ts>
- Документация провайдеров V1:
  <https://github.com/anomalyco/opencode/blob/v1.19.6/packages/web/src/content/docs/providers.mdx>
- Релиз v1.19.6 (дата, ассеты):
  <https://github.com/anomalyco/opencode/releases/tag/v1.19.6>
- Живая документация CLI (V2, для сравнения):
  <https://opencode.ai/docs/cli/>
- Живая документация permissions (V2: `permissions`, `shell`, `subagent`):
  <https://opencode.ai/docs/permissions/>
- Локальный composite action с пином версии:
  <https://github.com/kitXIII/ai-for-developers-project-387/blob/research/opencode-cli-review/.github/actions/opencode/action.yml>
- actions/checkout (`fetch-depth`, `persist-credentials`):
  <https://github.com/actions/checkout#readme>
- Синтаксис workflow: permissions и timeout-minutes:
  <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idpermissions>
- Событие `pull_request` (merge-ref, read-only токен форков):
  <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request>
- REST: создание комментария к issue/PR:
  <https://docs.github.com/en/rest/issues/comments?apiVersion=2022-11-28#create-an-issue-comment>
- `gh pr comment` (`--body-file`):
  <https://cli.github.com/manual/gh_pr_comment>
- `git diff --merge-base`:
  <https://git-scm.com/docs/git-diff>
- GNU `timeout` и коды 124–127:
  <https://www.gnu.org/software/coreutils/manual/html_node/timeout-invocation.html>
- Node.js `process.exit`/`process.exitCode`:
  <https://nodejs.org/api/process.html#processexitcode>
- Образ `ubuntu-24.04` (наличие `jq`):
  <https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md>
