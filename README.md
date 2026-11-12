# LM Computer — плагин для LM Studio

Клиент: [LM Chat](https://github.com/Spe4naz/lm-chat).

Даёт модели контролируемый доступ к компьютеру, на котором запущен LM Studio:
файлы в отдельной рабочей папке, команды shell, открытие файлов и папок.
Подтверждения показывает диалог `zenity` на машине с LM Studio. REST и MCP
готовы для LM Chat и opencode; экран подтверждений в приложении появится позже.

## Как это устроено

```text
LM Studio
  └─ plugin lmchat/lm-computer
       └─ native tools в чате LM Studio

lm-computer.service (systemd --user)
  └─ node dist/standalone.js
       ├─ REST API  http://<host>:1236/api
       └─ MCP       http://<host>:1237/mcp
```

HTTP специально вынесен из плагина в отдельный процесс. LM Studio выгружает
плагины, когда они не нужны, и делает это сразу после регистрации инструментов:

```text
[InternalPluginsProvider] Evicting plugin lmchat/lm-computer.
[InternalPluginsProvider][PluginInstance] Force exiting plugin process.
```

Вместе с процессом плагина исчезали бы и порты `1236`/`1237`. Поэтому:

- плагин отвечает только за native tools внутри LM Studio;
- REST и MCP живут в `lm-computer.service` и не зависят от LM Studio;
- MCP-клиент не считается приложением LM Chat: если REST никто не опрашивает,
  подтверждение для `shell_run` показывается через `zenity`;
- у сервиса и native tools разные очереди подтверждений, но обе используют
  `zenity`, пока в LM Chat нет экрана подтверждений.

## Стартовый промт для модели

Готовый текст: [`prompts/system-prompt.md`](prompts/system-prompt.md). Он коротко
объясняет модели, что она работает в `~/lm-chat-computer`, какие инструменты у
неё есть и когда нужно подтверждение.

В LM Studio:

1. откройте чат;
2. в правой панели откройте **System Prompt**;
3. вставьте текст из файла;
4. при желании сохраните как пресет.

Плагин не может сам подставить системный промт: LM Studio не даёт плагинам
такого хука. Описания инструментов модель получает автоматически из
`toolsProvider`, а промт задаёт правила поведения.

В OpenCode промт не обязателен: MCP-инструменты приходят с описаниями. Если
нужно зафиксировать правила в проекте, используйте `AGENTS.md`.

## Установка на Ubuntu

Требования:

- Ubuntu (или другой Linux с LM Studio);
- LM Studio 0.4.x с CLI `lms`;
- Node.js в `PATH` — нужен для `lm-computer.service` и сборки.

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
- ставит npm-зависимости (`npm ci`) и собирает `dist/`;
- выполняет `lms dev --install`;
- создаёт `~/.config/systemd/user/lm-computer.service` и запускает его;
- проверяет `zenity`;
- предупреждает, если `ufw` активен и порты `1236`/`1237` могут быть закрыты;
- не использует `sudo`.

Ручная установка без скрипта:

```bash
npm ci
npm run build
~/.lmstudio/bin/lms dev --install
node dist/standalone.js
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

`zenity` нужен для подтверждений:

```bash
sudo apt install -y zenity
```

Если включён `ufw`, откройте нужные порты:

```bash
sudo ufw allow 1236/tcp   # REST API для LM Chat
sudo ufw allow 1237/tcp   # MCP для opencode
```

Порт `1237` можно не открывать, если opencode не используется.

Обновление:

```bash
git pull
./install.sh
```

## Управление сервисом

```bash
systemctl --user status lm-computer.service
systemctl --user restart lm-computer.service
journalctl --user -u lm-computer.service -f
```

Из репозитория:

```bash
./start.sh
./stop.sh
```

`stop.sh` сначала останавливает процесс через API, а если он недоступен —
через `systemctl --user stop`.

Если сервис должен работать без входа в графическую сессию:

```bash
sudo loginctl enable-linger "$USER"
```

## Порты

| Listener | Порт | Назначение |
|---|---|---|
| REST API | `1236` | LM Chat, подтверждения, `/api/status`, `/api/shutdown` |
| MCP | `1237` | opencode и другие MCP-клиенты, `/mcp` |
| DEV-экземпляр | `1246` / `1247` | опционально, при разработке |

Лог сервиса:

```text
[lm-computer] REST API listening on http://0.0.0.0:1236
[lm-computer] MCP listening on http://0.0.0.0:1237/mcp
```

Если порт занят, listener помечается как `listening: false`, а второй
продолжает работать. Состояние видно в `GET /api/status` → `listeners.api` и
`listeners.mcp`.

## MCP-сервер

MCP уже входит в сервис и доступен по адресу `http://<host>:1237/mcp`.
Все запросы требуют токен из `~/.config/lm-computer/token.txt`.

### opencode

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

Если opencode на той же машине, используйте `http://127.0.0.1:1237/mcp`.

### LM Studio

**MCP в LM Studio добавлять не нужно.** Плагин уже даёт native tools, а
`mcp/lm-computer` в `mcp.json` создаёт второй слой, который к тому же
подключается к порту до того, как сервис успевает стартовать.

Уберите `lm-computer` из **Program → Install → Edit mcp.json** и перезапустите
LM Studio. В Integrations должен остаться только установленный
`lmchat/lm-computer`.

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
сервиса:

```bash
systemctl --user restart lm-computer.service
```

Остальное можно менять через `PUT /api/config`.

## Параллельный запуск

### REST и MCP

Это два независимых listener'а в одном процессе. Они работают параллельно,
но у них общая очередь подтверждений, автопринятие и журнал.

### Второй экземпляр

Для DEV-профиля нужен отдельный конфиг и отдельные порты:

```bash
LM_COMPUTER_HOME=~/.config/lm-computer-dev \
LM_COMPUTER_PORT=1246 \
LM_COMPUTER_MCP_PORT=1247 \
node dist/standalone.js
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
| `LM_COMPUTER_PLUGIN_HTTP` | `1` — включить HTTP внутри плагина для отладки |

Приоритет: аргументы кода → переменные окружения → `config.json` → значения по
умолчанию. Env-значения не записываются в `config.json`.

### HTTP внутри плагина

По умолчанию плагин HTTP не поднимает. Для отладки можно включить:

```bash
LM_COMPUTER_PLUGIN_HTTP=1 ~/.lmstudio/bin/lms dev
```

Но тогда сначала остановите сервис, иначе порты будут заняты:

```bash
systemctl --user stop lm-computer.service
```

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

На Ubuntu 26.04 проверены standalone-сервис на `1236`/`1237`, REST
`/api/status` и MCP `initialize`.

Юнит-тесты: 32/32 (`npm test`).

## Ограничения

- нет UI настроек внутри LM Studio — настройки в JSON и API;
- экран подтверждений в LM Chat ещё не подключён, используется `zenity`;
- MCP-сервер stateless: без сессий и server-initiated notifications;
- `zenity` должен быть установлен на Ubuntu;
- автопринятие живёт только в памяти сервиса и сбрасывается при перезапуске;
- у сервиса и native tools в LM Studio разные очереди подтверждений;
- `zenity` из systemd-сервиса требует `DISPLAY`/`WAYLAND_DISPLAY`; они
  передаются через `PassEnvironment` из сессии пользователя.

## Проверка на Ubuntu

1. `./install.sh` завершается без ошибок.
2. `systemctl --user status lm-computer.service` — `active (running)`.
3. `ss -ltnp | grep -E '1236|1237'` — два listener'а.
4. `curl http://127.0.0.1:1236/api/status` с токеном отвечает и показывает оба
   listener'а.
5. В чате LM Studio с Qwen 3.5 9B: «создай файл `test.txt` со словом hello» —
   файл появляется в `~/lm-chat-computer`.
6. «выполни `whoami`» — появляется `zenity`; после разрешения вывод приходит
   в чат.
7. `opencode mcp list` показывает `lm-computer` подключённым к `1237`.
8. `./stop.sh` останавливает сервис.
