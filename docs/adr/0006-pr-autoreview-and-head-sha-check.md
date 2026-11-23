# Авторевью PR отдельным агентом и независимая проверка head SHA

Status: accepted

Авторевью выполняет отдельный воркфлоу на событие `pull_request`, а не `opencode github run`:
воркфлоу готовит diff и контекст, модель работает с запретом записи и только пишет текст, а
публикация идёт отдельным шагом `gh pr comment`. Так ревью не получает секретов, не запускает
код PR и не может писать в репозиторий; `pull_request_target` и PR из форков не используются.
Независимая проверка — отдельный job `e2e-head` в `quality.yml`: checkout ровно `head.sha`,
явная трассировка и артефакт с SHA в имени и содержимом, потому что обычный прогон `quality`
идёт на merge-коммите и не доказывает состояние head SHA. Решение принято по итогам research
[#47](https://github.com/kitXIII/ai-for-developers-project-387/issues/47) и
[#49](https://github.com/kitXIII/ai-for-developers-project-387/issues/49); альтернативы —
`opencode github run` (меньше контроля над diff и публикацией) и `pull_request_target` (даёт
секреты недоверенному коду).
