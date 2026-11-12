# LM Computer — плагин для LM Studio

Клиент: [LM Chat](https://github.com/Spe4naz/lm-chat).

Даёт модели контролируемый доступ к компьютеру, на котором запущен LM Studio:
файлы в отдельной рабочей папке, команды shell, открытие файлов и папок.
Подтверждения сейчас показывает диалог `zenity` на машине с LM Studio. REST и
MCP уже готовы для LM Chat и opencode; экран подтверждений в приложении
появится позже.

Плагин также поднимает HTTP-сервер, поэтому тот же набор инструментов доступен
приложению и opencode:

- `native tools` — чат в LM Studio, со статусами и отменой;
- `POST/GET /mcp` — MCP Streamable HTTP для opencode и других клиентов;
- `/api/*` — REST для LM Chat и диагностики: файлы, журнал, подтверждения,
  автопринятие.

## Что уже реализовано

- рабочая папка `~/lm-chat-computer` (настраивается);
- `fs_list`, `fs_read`, `fs_write`, `fs_append`, `fs_mkdir`, `fs_move`,
  `fs_delete` (в корзину), `fs_search`;
- `shell_run` с таймаутом, лимитом вывода и убийством всей группы процессов;
- `open_path` и `system_info`;
- запрет выхода за рабочую папку, включая symlink и `..`;
- очередь подтверждений с таймаутом;
- временное автопринятие через API, максимум 30 минут;
- fallback-диалог `zenity`, если приложение не подключено;
- журнал действий `audit.jsonl`;
- REST API и MCP endpoint;
- одноразовый токен, который генерируется при первом запуске.

## Установка на Ubuntu

LM Studio 0.4.28 уже содержит Node.js, отдельно ставить его не нужно.

```bash
git clone https://github.com/Spe4naz/lm-computer.git
cd lm-computer
./install.sh
```

Если архив был скачан без executable-бита:

```bash
bash install.sh
```

Скрипт находит `lms`, выполняет `lms dev --install`, проверяет `zenity` и
предупреждает, если `ufw` блокирует порт `1236`. Он не использует `sudo`.

Ручная установка без скрипта:

```bash
~/.lmstudio/bin/lms dev --install
```

После запуска плагин пишет в лог:

```text
[lm-computer] REST/MCP listening on http://0.0.0.0:1236
[lm-computer] workspace: /home/<user>/lm-chat-computer
[lm-computer] token file: /home/<user>/.config/lm-computer/token.txt
```

Токен нужно один раз скопировать в настройки LM Chat. Если на машине включён
`ufw`, открыть порт:

```bash
sudo ufw allow 1236/tcp
```

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
из приложения через `PUT /api/config`.

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

## MCP

```jsonc
{
  "mcp": {
    "servers": {
      "lm-computer": {
        "type": "remote",
        "url": "http://<ip>:1236/mcp",
        "headers": {
          "Authorization": "Bearer <token>"
        }
      }
    }
  }
}
```

## Политика доступа

| Действие | По умолчанию |
|---|---|
| Чтение и запись в рабочей папке | без подтверждения |
| Удаление и перемещение | подтверждение |
| Файлы вне рабочей папки | запрещено |
| Shell-команда | подтверждение |
| Автопринятие | только временное, из приложения; действует, пока приложение на связи |
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

## Пакет для spike

Готовый архив:

```text
tools/lm-computer-plugin/lm-computer-plugin-0.1.0.zip
```

На Ubuntu:

```bash
mkdir -p ~/lm-computer-plugin
cd ~/lm-computer-plugin
unzip lm-computer-plugin-0.1.0.zip
~/.lmstudio/bin/lms dev
```

Если `zenity` не установлен:

```bash
sudo apt install -y zenity
```

## Ограничения spike-версии

- нет UI настроек внутри LM Studio — настройки в JSON и приложении;
- приложение LM Chat ещё не подключено к `/api`;
- MCP-сервер stateless: без сессий и server-initiated notifications;
- `zenity` должен быть установлен на Ubuntu;
- автопринятие живёт только в памяти плагина и сбрасывается при перезапуске.

## Проверка на Ubuntu

1. `lms dev` загружает плагин без ошибок.
2. В чате LM Studio с Qwen 3.5 9B: «создай файл `test.txt` со словом hello» —
   файл появляется в `~/lm-chat-computer`.
3. «выполни `whoami`» — в LM Chat появляется подтверждение; после разрешения
   вывод приходит в чат.
4. Закрыть LM Chat, повторить команду — появляется `zenity`.
5. Включить автопринятие на 1 минуту — команда выполняется без диалога.
6. `curl http://<ip>:1236/api/status` с токеном отвечает.
7. `opencode mcp list` показывает `lm-computer` подключённым.
