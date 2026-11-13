# MCP

MCP-сервер входит в `lm-computer.service` и доступен по адресу:

```text
http://<host>:1237/mcp
```

Транспорт — Streamable HTTP, ответы в JSON. Авторизация — тот же Bearer-токен:

```text
Authorization: Bearer <токен из ~/.config/lm-computer/token.txt>
```

## opencode

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "lm-computer": {
        "type": "remote",
        "url": "http://192.168.1.50:1237/mcp",
        "headers": {
          "Authorization": "Bearer <токен>"
        }
      }
    }
  }
}
```

Проверка:

```bash
opencode mcp list
```

В списке должен появиться `lm-computer` со статусом `connected`. Если opencode
на той же машине, используйте `http://127.0.0.1:1237/mcp`.

## LM Studio

**MCP в LM Studio добавлять не нужно.** Плагин уже даёт native tools, а
`mcp/lm-computer` в `mcp.json` создаёт второй слой, который к тому же
подключается к порту раньше, чем сервис успевает стартовать.

Уберите `lm-computer` из **Program → Install → Edit mcp.json** и перезапустите
LM Studio. В Integrations должен остаться только установленный
`lmchat/lm-computer`.

## Инструменты

MCP отдаёт те же 12 инструментов, что и REST: `computer_status`, `fs_*`,
`system_info`, `open_path`, `shell_run`. Описания и схемы аргументов приходят
клиенту автоматически — отдельный системный промт не обязателен.

Правила подтверждений те же, что и у native tools, но очередь своя:
подтверждение показывается через `zenity`, потому что MCP-клиент не считается
приложением LM Chat.

## Ограничения

- Сервер stateless: без сессий и server-initiated notifications.
- Один порт на все клиенты; авторизация только по токену.
- Если `mcpEnabled: false` или порт занят, listener помечается
  `listening: false`, REST при этом продолжает работать.
- Вывод инструментов ограничен теми же лимитами, что и в REST: 1 МиБ на
  чтение, 5 МиБ на запись, 64 КиБ на вывод команды по умолчанию.

## Проверка вручную

```bash
TOKEN="$(cat ~/.config/lm-computer/token.txt)"

curl -s -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' \
  http://127.0.0.1:1237/mcp
```

Ответ содержит `serverInfo` с именем `lm-computer` и версией.
