# Подтверждения

## Какие действия требуют подтверждения

| Инструмент | Подтверждение |
|---|---|
| `fs_move` | всегда |
| `fs_delete` | всегда |
| `open_path` | всегда |
| `shell_run` | всегда, если не включено автопринятие |

Чтение, запись и создание файлов внутри workspace выполняются без
подтверждения — workspace и так ограничен рабочей папкой.

## Как проходит запрос

1. Модель вызывает инструмент.
2. Сервис создаёт запрос с `id`, `summary` и `details`, ставит его в очередь и
   добавляет событие `approval_requested`.
3. Если включено временное автопринятие **и** LM Chat опрашивает API, запрос
   подтверждается автоматически (`approval_auto`).
4. Иначе LM Chat или другой клиент забирает событие через `/api/events`,
   показывает диалог и отвечает `POST /api/approvals/<id>`.
5. Если приложение не опрашивает API дольше ~3 секунд, на машине с LM Studio
   появляется диалог `zenity`.
6. По истечении `approvalTimeoutSec` (120 с по умолчанию) запрос закрывается
   как `timeout`, и модель получает отказ.

В текущей версии LM Chat экран подтверждений ещё не подключён, поэтому на
практике подтверждения приходят через `zenity`.

## zenity

```bash
sudo apt install -y zenity
```

Диалог показывает имя инструмента, краткое описание и кнопки «Разрешить» /
«Запретить». Если `zenity` не установлен или нет доступа к дисплею, запрос
завершится по таймауту.

Для systemd-сервиса нужны `DISPLAY`/`WAYLAND_DISPLAY`; юнит передаёт их через
`PassEnvironment` из сессии пользователя. Без графической сессии `zenity`
работать не будет — используйте автопринятие или API.

## Временное автопринятие

```bash
TOKEN="$(cat ~/.config/lm-computer/token.txt)"

curl -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"seconds":900}' \
  http://127.0.0.1:1236/api/auto-accept
```

- максимум — `autoAcceptMaxSec`, по умолчанию и в жёстком пределе 1800 секунд
  (30 минут);
- `{"seconds":0}` выключает автопринятие;
- действует, только пока LM Chat опрашивает API (окно 15 секунд); закрыли
  приложение — автопринятие перестало применяться;
- живёт в памяти процесса и сбрасывается при перезапуске сервиса;
- к native tools внутри LM Studio не относится: это другой процесс со своей
  очередью, у него автопринятия нет.

Отключить автопринятие можно и перезапуском:

```bash
systemctl --user restart lm-computer.service
```

## Отмена

```bash
curl -H "Authorization: Bearer $TOKEN" -X POST http://127.0.0.1:1236/api/cancel
```

Отменяет запущенные команды и все ожидающие подтверждения. Модель получает
`cancelled`.

## Список ожидающих

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:1236/api/approvals
```

```json
{
  "ok": true,
  "approvals": [
    {
      "id": "0b0f...",
      "tool": "shell_run",
      "risk": "high",
      "summary": "Run command: whoami",
      "details": { "command": "whoami", "cwd": ".", "timeout_sec": null },
      "origin": "mcp",
      "createdAt": 1763000000000,
      "expiresAt": 1763000120000
    }
  ],
  "autoAcceptUntil": 0
}
```

`origin` показывает, откуда пришёл вызов: `native` (плагин в LM Studio) или
`mcp`.

## Журнал

Каждое решение попадает в `audit.jsonl` и в события:

- `approval_requested` — запрос создан;
- `approval_auto` — разрешено автопринятием;
- `approval_resolved` — решение (`allow`, `deny`, `timeout`, `cancelled`) и
  канал (`app`, `zenity`, `auto`, `timeout`, `abort`);
- `zenity_unavailable` — диалог не удалось показать.

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:1236/api/audit?limit=50" | grep approval
```

## Две очереди

У сервиса (`lm-computer.service`) и у native tools внутри LM Studio разные
процессы и разные очереди подтверждений. Обе используют `zenity`. Это
осознанное следствие того, что LM Studio выгружает процессы плагинов: держать
HTTP внутри плагина нельзя.

## Таймауты

| Параметр | Где | По умолчанию |
|---|---|---|
| `approvalTimeoutSec` | подтверждение в очереди | 120 с |
| `shellTimeoutSec` | выполнение команды | 120 с |
| `timeout_sec` у `shell_run` | конкретная команда | до 600 с |
