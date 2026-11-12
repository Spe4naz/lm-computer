# LM Computer — плагин для LM Studio

Клиент: [LM Chat](https://github.com/Spe4naz/lm-chat).

Даёт модели контролируемый доступ к компьютеру, на котором запущен LM Studio:
файлы в отдельной рабочей папке, команды shell, открытие файлов и папок.
Подтверждения показывает диалог `zenity` на машине с LM Studio. REST и MCP
готовы для LM Chat и opencode; экран подтверждений в приложении появится позже.

Плагин поднимает HTTP-сервер, поэтому один и тот же набор инструментов доступен:

- `native tools` — чат в LM Studio, со статусами и отменой;
- `/mcp` — MCP Streamable HTTP для opencode и других клиентов;
- `/api/*` — REST для LM Chat и диагностики.

## Установка на Ubuntu

Требования:

- Ubuntu (или другой Linux с LM Studio);
- LM Studio 0.4.x с CLI `lms`;
- Node.js ставить отдельно не нужно — LM Studio содержит его.

```bash
git clone https://github.com/Spe4naz/lm-computer.git
cd lm-computer
./install.sh
```

Если архив скачан без executable-бита:

```bash
bash install.sh
```

Скрипт:

- находит `lms` в `PATH` или `~/.lmstudio/bin/lms`;
- выполняет `lms dev --install`;
- при ошибке пробует `npm ci` и повторяет установку;
- проверяет `zenity`;
- предупреждает, если `ufw` активен и порт `1236` может быть закрыт;
- не использует `sudo`.

Ручная установка без скрипта:

```bash
~/.lmstudio/bin/lms dev --install
```

После установки перезапустите LM Studio, если плагин не появился сразу.
Первый запуск создаёт:

```text
workspace: ~/lm-chat-computer
config:    ~/.config/lm-computer/config.json
token:     ~/.config/lm-computer/token.txt
REST/MCP:  http://<this-machine>:1236
```

`zenity` нужен для подтверждений, если приложение не подключено:

```bash
sudo apt install -y zenity
```

Если включён `ufw`, откройте порт для локальной сети:

```bash
sudo ufw allow 1236/tcp
```

Обновление плагина:

```bash
git pull
./install.sh
```

## MCP-сервер

Отдельный MCP-сервер ставить не нужно: он уже входит в плагин и доступен по
адресу `http://<host>:1236/mcp`. Все запросы требуют токен из
`~/.config/lm-computer/token.txt`.

### opencode

Добавьте сервер в глобальный или проектный `opencode.json(c)`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "lm-computer": {
        "type": "remote",
        "url": "http://<ip-машины-с-lm-studio>:1236/mcp",
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

В списке должен появиться `lm-computer` со статусом `connected`.

### LM Studio

LM Studio 0.3.17+ умеет подключать MCP-серверы. Плагин уже даёт native tools,
поэтому MCP в LM Studio нужен только если вы хотите использовать тот же сервер
через `mcp.json` или другой клиент.

Откройте **Program → Install → Edit mcp.json** и добавьте:

```json
{
  "mcpServers": {
    "lm-computer": {
      "url": "http://127.0.0.1:1236/mcp",
      "headers": {
        "Authorization": "Bearer <токен>"
      }
    }
  }
}
```

В настройках сервера LM Studio включите **Allow calling servers from mcp.json**.
После изменения `mcp.json` перезапустите LM Studio.

Если LM Studio и плагин на одной машине, используйте `127.0.0.1`. Если клиент
на другой машине — IP машины с LM Studio и токен.

### LM Chat

REST уже доступен по `http://<ip>:1236/api`, но экран подтверждений и файлов
в текущей версии приложения ещё не подключён. Для подтверждений сейчас
используется `zenity`.

## Настройки

Файл: `~/.config/lm-computer/config.json` (создаётся автоматически).

```json
{
  "workspace": "/home/user/lm-chat-computer",
  "host": "0.0.0.0",
  "port": 1236,
  "token": "<генерируется>",
  "shellEnabled": true,
  "approvalTimeoutSec": 120,
  "shellTimeoutSec": 120,
  "maxOutputBytes": 65536,
  "autoAcceptMaxSec": 1800,
  "zenityFallback": true
}
```

`host` и `port` меняются только с перезапуском плагина. Остальное можно менять
через `PUT /api/config`.

## REST

Все запросы, кроме минимального `/api/health`, требуют
`Authorization: Bearer <token>`.

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:1236/api/status

curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:1236/api/files?path=."

curl -H "Authorization: Bearer $TOKEN" \
  -X PUT --data-binary @book.md \
  "http://127.0.0.1:1236/api/file?path=book.md"

curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:1236/api/approvals"

curl -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"allow":true}' \
  "http://127.0.0.1:1236/api/approvals/<id>"

curl -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"seconds":1800}' \
  "http://127.0.0.1:1236/api/auto-accept"
```

События и журнал:

- `GET /api/events?since=N&wait=20` — long-poll;
- `GET /api/audit?limit=100`;
- `POST /api/cancel` — отменить команду и все ожидающие подтверждения.

## Остановка

Только скрипт:

```bash
./stop.sh
```

Если архив скачан без executable-бита:

```bash
bash stop.sh
```

Скрипт читает токен из `~/.config/lm-computer/token.txt`, останавливает
HTTP/MCP-сервер и отменяет активные команды. Native tools в LM Studio
продолжают работать до перезапуска LM Studio.

Для другого адреса:

```bash
LM_COMPUTER_URL=http://192.168.1.50:1236 ./stop.sh
```

## Политика доступа

| Действие | По умолчанию |
|---|---|
| Чтение и запись в рабочей папке | без подтверждения |
| Удаление и перемещение | подтверждение |
| Файлы вне рабочей папки | запрещено |
| Shell-команда | подтверждение |
| Автопринятие | только временное через API, максимум 30 минут; действует, пока клиент на связи |
| Опасные команды (`sudo`, `mkfs`, `dd`, `shutdown`, `rm -rf /`) | блокируются всегда |

## Проверено локально

На Windows (Node 24) прошёл smoke-тест без LM Studio:

- `/api/health`, `/api/status`;
- загрузка и скачивание файла через `/api/file`;
- MCP `initialize`, `tools/list`, `fs_list`;
- временное автопринятие;
- `shell_run` с `whoami`;
- записи в `audit.jsonl`.

Юнит-тесты: 13/13 (`npm test`).

## Ограничения

- нет UI настроек внутри LM Studio — настройки в JSON и API;
- экран подтверждений в LM Chat ещё не подключён, используется `zenity`;
- MCP-сервер stateless: без сессий и server-initiated notifications;
- `zenity` должен быть установлен на Ubuntu;
- автопринятие живёт только в памяти плагина и сбрасывается при перезапуске.

## Проверка на Ubuntu

1. `./install.sh` завершается без ошибок.
2. В чате LM Studio с Qwen 3.5 9B: «создай файл `test.txt` со словом hello» —
   файл появляется в `~/lm-chat-computer`.
3. «выполни `whoami`» — появляется `zenity`; после разрешения вывод приходит
   в чат.
4. `curl http://127.0.0.1:1236/api/status` с токеном отвечает.
5. `opencode mcp list` показывает `lm-computer` подключённым.
6. `./stop.sh` останавливает HTTP/MCP.
