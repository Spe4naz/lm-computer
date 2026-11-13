# REST API

База: `http://<host>:1236/api`. Все запросы, кроме минимального `/api/health`,
требуют заголовок:

```text
Authorization: Bearer <токен из ~/.config/lm-computer/token.txt>
```

## Эндпоинты

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/health` | проверка живости; без токена отдаёт только имя и версию |
| GET | `/api/status` | состояние сервиса и listener'ов |
| POST | `/api/shutdown` | остановить сервис |
| GET | `/api/config` | публичные настройки без токена |
| PUT | `/api/config` | изменить настройки (часть — только с перезапуском) |
| GET | `/api/tools` | список инструментов |
| GET | `/api/files?path=.` | список файлов в workspace |
| GET | `/api/file?path=book.md` | скачать файл; `&inline=1` — как текст |
| PUT | `/api/file?path=book.md` | загрузить/перезаписать файл |
| GET | `/api/approvals` | ожидающие подтверждения и дедлайн автопринятия |
| POST | `/api/approvals/<id>` | решить: `{"allow":true|false}` |
| POST | `/api/auto-accept` | временное автопринятие: `{"seconds":1800}` |
| POST | `/api/cancel` | отменить команды и все ожидающие подтверждения |
| GET | `/api/events?since=N&wait=20` | long-poll событий |
| GET | `/api/audit?limit=100` | последние записи журнала |

`/api/health` и `/api/shutdown` также отвечают на MCP-порту `1237`, чтобы
`stop.sh` работал при выключенном REST.

## Примеры

```bash
TOKEN="$(cat ~/.config/lm-computer/token.txt)"
API="http://127.0.0.1:1236/api"

curl -H "Authorization: Bearer $TOKEN" "$API/status"
curl -H "Authorization: Bearer $TOKEN" "$API/files?path=."
curl -H "Authorization: Bearer $TOKEN" "$API/tools"

curl -H "Authorization: Bearer $TOKEN" \
  -X PUT --data-binary @book.md "$API/file?path=book.md"

curl -H "Authorization: Bearer $TOKEN" "$API/approvals"
curl -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"allow":true}' \
  "$API/approvals/<id>"

curl -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"seconds":1800}' \
  "$API/auto-accept"

curl -H "Authorization: Bearer $TOKEN" "$API/audit?limit=20"
```

Скачивание файла:

```bash
curl -H "Authorization: Bearer $TOKEN" -OJ "$API/file?path=report.pdf"
```

Для предпросмотра текста добавьте `inline=1`.

## Ответ `/api/status`

```json
{
  "ok": true,
  "name": "lm-computer",
  "version": "0.1.5",
  "pid": 12345,
  "platform": "linux x64",
  "startedAt": 1763000000000,
  "workspace": "/home/user/lm-chat-computer",
  "host": "0.0.0.0",
  "port": 1236,
  "mcpHost": "0.0.0.0",
  "mcpPort": 1237,
  "listeners": {
    "api": { "enabled": true, "host": "0.0.0.0", "port": 1236, "listening": true },
    "mcp": { "enabled": true, "host": "0.0.0.0", "port": 1237, "listening": true }
  },
  "shellEnabled": true,
  "approvalTimeoutSec": 120,
  "pendingApprovals": 0,
  "autoAcceptUntil": 0,
  "autoAcceptRemainingSec": 0,
  "activeCommands": 0,
  "tokenFile": "/home/user/.config/lm-computer/token.txt",
  "configFile": "/home/user/.config/lm-computer/config.json"
}
```

## Ошибки

| Код | Когда |
|---|---|
| 400 | неверный JSON, путь вне workspace, изменение listener-полей без перезапуска |
| 401 | нет или неверный токен |
| 404 | неизвестный путь, файл не найден, подтверждение истекло |
| 500 | внутренняя ошибка (сообщение в `error`) |

Формат:

```json
{"ok": false, "error": "Workspace must stay inside an allowed root ..."}
```

## Лимиты

| Что | Значение |
|---|---|
| Тело JSON-запроса | 8 МиБ |
| Загрузка файла (`PUT /api/file`) | 8 МиБ |
| `wait` у `/api/events` | 0–25 секунд |
| `limit` у `/api/audit` | по умолчанию 100 |
| Проверка токена | сравнение за постоянное время |

## События и журнал

`GET /api/events?since=N&wait=20` возвращает новые события и следующий `seq`.
Так LM Chat узнаёт о подтверждениях и изменениях файлов.

`GET /api/audit` отдаёт записи из `~/.config/lm-computer/audit.jsonl`. Секреты
в командах и аргументах маскируются, файл ротируется после 5 МиБ.

## CORS

По умолчанию CORS выключен, `Access-Control-Allow-Origin` не отдаётся. Чтобы
браузерный клиент мог обращаться к API, перечислите его Origin в
`LM_COMPUTER_CORS_ORIGINS` и перезапустите сервис.
