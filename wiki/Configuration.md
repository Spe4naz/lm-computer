# Настройки

Файл: `~/.config/lm-computer/config.json` (создаётся при первом запуске).

```json
{
  "workspace": "/home/user/lm-chat-computer",
  "host": "0.0.0.0",
  "port": 1236,
  "apiEnabled": true,
  "mcpHost": "0.0.0.0",
  "mcpPort": 1237,
  "mcpEnabled": true,
  "token": "<генерируется>",
  "shellEnabled": true,
  "approvalTimeoutSec": 120,
  "shellTimeoutSec": 120,
  "maxOutputBytes": 65536,
  "autoAcceptMaxSec": 1800,
  "zenityFallback": true
}
```

| Поле | По умолчанию | Назначение |
|---|---|---|
| `workspace` | `~/lm-chat-computer` | корень файловых инструментов |
| `host` | `0.0.0.0` | адрес REST |
| `port` | `1236` | порт REST |
| `apiEnabled` | `true` | включён ли REST-listener |
| `mcpHost` | `0.0.0.0` | адрес MCP |
| `mcpPort` | `1237` | порт MCP, должен отличаться от `port` |
| `mcpEnabled` | `true` | включён ли MCP-listener |
| `token` | генерируется | Bearer-токен для REST и MCP |
| `shellEnabled` | `true` | разрешены ли `shell_run` |
| `approvalTimeoutSec` | `120` | сколько ждать подтверждения (5–3600) |
| `shellTimeoutSec` | `120` | таймаут команды по умолчанию (1–3600) |
| `maxOutputBytes` | `65536` | лимит вывода команды (1 КиБ – 4 МиБ) |
| `autoAcceptMaxSec` | `1800` | максимум временного автопринятия (0–1800) |
| `zenityFallback` | `true` | показывать `zenity`, если LM Chat не на связи |

Поля, меняющие listener'ы, применяются **только после перезапуска** сервиса:

```bash
systemctl --user restart lm-computer.service
```

`PUT /api/config` с такими полями возвращает 400:

```json
{"ok": false, "error": "host, port changes require a plugin restart"}
```

## Изменение через API

```bash
TOKEN="$(cat ~/.config/lm-computer/token.txt)"

curl -H "Authorization: Bearer $TOKEN" \
  -X PUT -H "Content-Type: application/json" \
  -d '{"shellTimeoutSec":300,"maxOutputBytes":131072}' \
  http://127.0.0.1:1236/api/config
```

`GET /api/config` возвращает публичную часть настроек без токена.

## Переменные окружения

| Переменная | Что меняет |
|---|---|
| `LM_COMPUTER_HOME` | каталог конфига, токена, журнала и корзины |
| `LM_COMPUTER_HOST` | адрес REST |
| `LM_COMPUTER_PORT` | порт REST |
| `LM_COMPUTER_API_ENABLED` | `true`/`false` |
| `LM_COMPUTER_MCP_HOST` | адрес MCP |
| `LM_COMPUTER_MCP_PORT` | порт MCP |
| `LM_COMPUTER_MCP_ENABLED` | `true`/`false` |
| `LM_COMPUTER_ALLOWED_ROOTS` | дополнительные корни workspace через `path.delimiter` (`:` на Linux, `;` на Windows) |
| `LM_COMPUTER_CORS_ORIGINS` | список Origin через запятую для браузерного клиента |
| `LM_COMPUTER_PLUGIN_HTTP` | `1` — поднять HTTP внутри плагина для отладки |

Приоритет: значения кода → переменные окружения → `config.json` → значения по
умолчанию. Значения из окружения не записываются в `config.json`.

Пример второго профиля для разработки:

```bash
LM_COMPUTER_HOME=~/.config/lm-computer-dev \
LM_COMPUTER_PORT=1246 \
LM_COMPUTER_MCP_PORT=1247 \
node dist/standalone.js
```

## Workspace

- По умолчанию рабочая папка — `~/lm-chat-computer`, она создаётся сама.
- Workspace обязан находиться внутри домашнего каталога пользователя. Другой
  корень разрешается явно через `LM_COMPUTER_ALLOWED_ROOTS`.
- Корень файловой системы запрещён всегда.
- Симлинки раскрываются: файл, указывающий за пределы workspace, отклоняется.
- Все пути файловых инструментов относительны workspace.

## Токен

Токен генерируется один раз и хранится в `config.json` и `token.txt`
(`0600`). Чтобы сменить его:

1. остановите сервис: `systemctl --user stop lm-computer.service`;
2. замените `token` в `config.json` на новую случайную строку;
3. запустите сервис;
4. обновите токен в LM Chat и в конфигурации opencode.

Удобная генерация:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## CORS

CORS выключен. Браузерный клиент заработает только если его Origin явно указан:

```bash
LM_COMPUTER_CORS_ORIGINS=https://my-console.local systemctl --user restart lm-computer.service
```

Wildcard-Origin не поддерживается: с Bearer-токеном это позволило бы любой
странице читать ответы API.

## HTTP внутри плагина

По умолчанию плагин HTTP не поднимает. Для отладки:

```bash
systemctl --user stop lm-computer.service
LM_COMPUTER_PLUGIN_HTTP=1 ~/.lmstudio/bin/lms dev
```

Иначе порты будут заняты сервисом.
