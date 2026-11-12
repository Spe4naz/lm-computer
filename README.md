# LM Computer — плагин для LM Studio

Клиент: [LM Chat](https://github.com/Spe4naz/lm-chat).

Даёт модели контролируемый доступ к компьютеру, на котором запущен LM Studio:
файлы в отдельной рабочей папке, команды shell, открытие файлов и папок.
Подтверждения показывает диалог `zenity` на машине с LM Studio. REST и MCP
готовы для LM Chat и opencode; экран подтверждений в приложении появится позже.

Плагин поднимает два независимых HTTP-listener'а:

- `native tools` — чат в LM Studio, со статусами и отменой;
- `/api/*` на порту `1236` — REST для LM Chat и диагностики;
- `/mcp` на порту `1237` — MCP Streamable HTTP для opencode.

Если один порт занят или listener упал, второй продолжает работать.

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
- предупреждает, если `ufw` активен и порты `1236`/`1237` могут быть закрыты;
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
REST API:  http://<this-machine>:1236/api
MCP:       http://<this-machine>:1237/mcp
```

`zenity` нужен для подтверждений, если приложение не подключено:

```bash
sudo apt install -y zenity
```

Если включён `ufw`, откройте нужные порты:

```bash
sudo ufw allow 1236/tcp   # REST API для LM Chat
sudo ufw allow 1237/tcp   # MCP для opencode
```

Порт `1237` можно не открывать, если opencode не используется.

Обновление плагина:

```bash
git pull
./install.sh
```

## Порты

| Listener | Порт | Назначение |
|---|---|---|
| REST API | `1236` | LM Chat, подтверждения, `/api/status`, `/api/shutdown` |
| MCP | `1237` | opencode и другие MCP-клиенты, `/mcp` |
| DEV-экземпляр | `1246` / `1247` | опционально, при разработке |

В логе плагина видно состояние каждого listener'а:

```text
[lm-computer] REST API listening on http://0.0.0.0:1236
[lm-computer] MCP listening on http://0.0.0.0:1237/mcp
```

Если порт занят:

```text
[lm-computer] MCP failed on http://0.0.0.0:1237/mcp: listen EADDRINUSE ...
```

REST при этом продолжает работать. Состояние также видно в
`GET /api/status` → `listeners.api` и `listeners.mcp`.

## MCP-сервер

Отдельный MCP-сервер ставить не нужно: он уже входит в плагин и доступен по
адресу `http://<host>:1237/mcp`. Все запросы требуют токен из
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
        "url": "http://<ip-машины-с-lm-studio>:1237/mcp",
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

Если opencode запущен на той же машине, что и плагин, используйте
`http://127.0.0.1:1237/mcp`.

### LM Studio

**MCP в LM Studio добавлять не нужно.** Плагин уже даёт native tools, а
`mcp/lm-computer` в `mcp.json` создаёт отдельный мост, который подключается к
порту раньше, чем плагин успевает загрузиться. Отсюда ошибки вида:

```text
connect ECONNREFUSED 127.0.0.1:1236
```

Уберите `lm-computer` из **Program → Install → Edit mcp.json** и перезапустите
LM Studio. В LM Studio должен остаться только один плагин: установленный
`lmchat/lm-computer`, без `DEV` и без MCP-моста.

### LM Chat

REST доступен по `http://<ip>:1236/api`, но экран подтверждений и файлов в
текущей версии приложения ещё не подключён. Для подтверждений сейчас
используется `zenity`.

## Настройки

Файл: `~/.config/lm-computer/config.json` (создаётся автоматически).

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

- `port` — REST API для LM Chat;
- `mcpPort` — MCP для opencode; должен отличаться от `port`;
- `mcpHost` — адрес MCP; если не задан, наследует `host`;
- `apiEnabled` / `mcpEnabled` — можно оставить только один listener.

Порты, адреса и `apiEnabled`/`mcpEnabled` меняются только с перезапуском
плагина. Остальное можно менять через `PUT /api/config`.

## Параллельный запуск

### REST и MCP

Это два независимых listener'а в одном процессе. Они работают параллельно,
но у них общая очередь подтверждений, автопринятие и журнал.

### Установленный плагин и DEV

Два экземпляра одновременно возможны, но только с разными портами **и** разным
конфигом. Иначе оба попытаются занять `1236`/`1237`.

Для DEV-экземпляра:

```bash
LM_COMPUTER_HOME=~/.config/lm-computer-dev \
LM_COMPUTER_PORT=1246 \
LM_COMPUTER_MCP_PORT=1247 \
~/.lmstudio/bin/lms dev
```

Переменные окружения:

| Переменная | Что меняет |
|---|---|
| `LM_COMPUTER_HOME` | каталог конфига, токена и журнала |
| `LM_COMPUTER_HOST` | адрес REST |
| `LM_COMPUTER_PORT` | порт REST |
| `LM_COMPUTER_API_ENABLED` | `true`/`false` |
| `LM_COMPUTER_MCP_HOST` | адрес MCP |
| `LM_COMPUTER_MCP_PORT` | порт MCP |
| `LM_COMPUTER_MCP_ENABLED` | `true`/`false` |

Приоритет: аргументы кода → переменные окружения → `config.json` → значения по
умолчанию.

Важно: у двух экземпляров **разные** очереди подтверждений и разные окна
автопринятия. Для обычной работы оставляйте один экземпляр.

Проверить, что `lms dev` передал переменные плагину, можно по строке в логе:

```text
[lm-computer] REST API listening on http://0.0.0.0:1246
[lm-computer] MCP listening on http://0.0.0.0:1247/mcp
```

### Постоянный MCP без LM Studio

В репозитории есть `standalone.js` — тот же сервер без LM Studio:

```bash
npm run build
node dist/standalone.js
```

Профиль «только MCP»:

```json
{
  "apiEnabled": false,
  "mcpEnabled": true,
  "mcpPort": 1237
}
```

Такой процесс можно запускать через systemd, но у него будет **своя** очередь
подтверждений: автопринятие из LM Chat на него не подействует, а `zenity`
из user-сервиса может не иметь доступа к дисплею. Этот режим пока не входит в
`install.sh`; используйте его, только если понимаете ограничения.

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

`/api/health` и `/api/shutdown` также отвечают на MCP-порту, чтобы `stop.sh`
работал при выключенном REST.

## Остановка

Только скрипт:

```bash
./stop.sh
```

Если архив скачан без executable-бита:

```bash
bash stop.sh
```

Скрипт читает `config.json`, определяет порт REST, при необходимости пробует
MCP-порт, останавливает оба listener'а и отменяет активные команды. Native tools
в LM Studio продолжают работать до перезапуска LM Studio.

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
- записи в `audit.jsonl`;
- два listener'а на разных портах и отказ одного без остановки второго.

Юнит-тесты: 30/30 (`npm test`).

## Ограничения

- нет UI настроек внутри LM Studio — настройки в JSON и API;
- экран подтверждений в LM Chat ещё не подключён, используется `zenity`;
- MCP-сервер stateless: без сессий и server-initiated notifications;
- `zenity` должен быть установлен на Ubuntu;
- автопринятие живёт только в памяти плагина и сбрасывается при перезапуске;
- у установленного и DEV-экземпляра разные очереди подтверждений.

## Проверка на Ubuntu

1. `./install.sh` завершается без ошибок.
2. В чате LM Studio с Qwen 3.5 9B: «создай файл `test.txt` со словом hello» —
   файл появляется в `~/lm-chat-computer`.
3. «выполни `whoami`» — появляется `zenity`; после разрешения вывод приходит
   в чат.
4. `curl http://127.0.0.1:1236/api/status` с токеном отвечает и показывает оба
   listener'а.
5. `opencode mcp list` показывает `lm-computer` подключённым к `1237`.
6. `./stop.sh` останавливает оба listener'а.
