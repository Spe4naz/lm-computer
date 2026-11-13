# Устранение неполадок

## Сервис не запускается

```bash
systemctl --user status lm-computer.service
journalctl --user -u lm-computer.service -n 80 --no-pager
```

Частые причины:

| Симптом | Причина |
|---|---|
| `node: command not found` | Node.js не в `PATH` у systemd; перезапустите `install.sh` |
| `SyntaxError` в JSON | повреждён `~/.config/lm-computer/config.json` |
| `EADDRINUSE` | порт занят другим процессом |
| `No HTTP listener started` | оба listener'а выключены или заняты |

Если оба listener'а заняты, `standalone.js` завершается с кодом 1. Проверьте:

```bash
ss -ltnp | grep -E '1236|1237'
```

## Порт занят, но второй listener работает

Это ожидаемое поведение: listener'ы независимы. В `GET /api/status` у
занятого будет `"listening": false` и текст ошибки, второй продолжит
обслуживать клиентов. Освободите порт или измените его в `config.json`
(потребуется перезапуск).

Частая причина — включённый `LM_COMPUTER_PLUGIN_HTTP=1` в LM Studio при
работающем сервисе. Остановите сервис перед отладкой плагина.

## Плагина нет в LM Studio

```bash
~/.lmstudio/bin/lms dev --install
```

Затем перезапустите LM Studio. Проверьте, что `dist/index.js` существует
(`npm run build`), и посмотрите лог LM Studio на ошибки загрузки плагина.

Сообщения об выгрузке — норма:

```text
[InternalPluginsProvider] Evicting plugin lmchat/lm-computer.
[InternalPluginsProvider][PluginInstance] Force exiting plugin process.
```

LM Studio выгружает процесс плагина, когда он не нужен. Именно поэтому REST и
MCP живут в отдельном сервисе.

## 401 Unauthorized

- токен не совпадает с `~/.config/lm-computer/token.txt`;
- в конфиге клиента лишние пробелы или перевод строки;
- токен меняли и не обновили клиента.

```bash
cat ~/.config/lm-computer/token.txt
curl -H "Authorization: Bearer $(cat ~/.config/lm-computer/token.txt)" \
  http://127.0.0.1:1236/api/status
```

`/api/health` без токена отвечает 200, но отдаёт только имя и версию — это не
признак успешной авторизации.

## Workspace не разрешён

```json
{"ok": false, "error": "Workspace must stay inside an allowed root ..."}
```

Workspace должен быть внутри домашнего каталога. Другой корень разрешается
явно:

```bash
LM_COMPUTER_ALLOWED_ROOTS=/mnt/data systemctl --user import-environment LM_COMPUTER_ALLOWED_ROOTS
systemctl --user restart lm-computer.service
```

Проще добавить переменную в юнит или запускать сервис из окружения, где она
задана. Корень файловой системы запрещён всегда.

## Не появляется диалог zenity

```bash
which zenity
zenity --question --text="test"
```

- `zenity` не установлен: `sudo apt install -y zenity`;
- нет графической сессии: `zenity` из systemd требует `DISPLAY` или
  `WAYLAND_DISPLAY`;
- сервис запущен без `PassEnvironment` — перезапустите `install.sh`, он
  добавляет эти переменные в юнит.

Без `zenity` подтверждения завершаются по таймауту (`approvalTimeoutSec`).

## Подтверждение висит и модель ждёт

- проверьте `/api/approvals`;
- `zenityFallback` включён?
- не истёк ли `approvalTimeoutSec` (120 с по умолчанию);
- не закрыт ли LM Chat, если вы ждали подтверждения в приложении.

Отменить всё сразу:

```bash
curl -H "Authorization: Bearer $TOKEN" -X POST http://127.0.0.1:1236/api/cancel
```

## opencode не подключается к MCP

- URL заканчивается на `/mcp`: `http://<ip>:1237/mcp`;
- заголовок `Authorization: Bearer <токен>` на месте;
- порт `1237` открыт в файрволе;
- `mcpEnabled` не `false`;
- в `GET /api/status` у `listeners.mcp` стоит `listening: true`.

```bash
opencode mcp list
```

Если opencode на той же машине, попробуйте `http://127.0.0.1:1237/mcp`.

Не добавляйте этот сервер в `mcp.json` LM Studio: там уже есть native tools.

## PUT /api/config возвращает 400

Поля `host`, `port`, `apiEnabled`, `mcpHost`, `mcpPort`, `mcpEnabled` нельзя
менять на лету. Отредактируйте `config.json` и перезапустите сервис:

```bash
systemctl --user restart lm-computer.service
```

## `stop.sh` не останавливает сервис

Скрипт сначала пробует `POST /api/shutdown` на REST-порту, затем на MCP-порту,
и только потом `systemctl --user stop`. Если все варианты не сработали:

```bash
systemctl --user stop lm-computer.service
systemctl --user status lm-computer.service
```

Проверьте, что `token.txt` читается и в нём нет Windows-переводов строк.

## `npm ci` падает

- нужен Node.js 22+ (`node -v`);
- нет доступа к npm — соберите `dist/` на другой машине;
- повреждён `package-lock.json` — `git checkout package-lock.json`.

## После обновления работает старая версия

Перезапустите LM Studio: плагин кэшируется до рестарта. Сервис перезапускает
`install.sh`. Проверьте версию:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:1236/api/status | grep -o '"version":"[^"]*"'
```

## Модель не видит инструменты

- плагин установлен и включён в LM Studio;
- в чате выбрана модель с поддержкой tool calling;
- системный промт не запрещает инструменты;
- посмотрите `GET /api/tools` у сервиса и список tools в настройках чата.

## Сервис падает с `Failed to drop capabilities`

Симптом: `systemctl --user status lm-computer.service` показывает
`activating (auto-restart)`, в журнале — `Failed at step CAPABILITIES spawning`
и `status=218/CAPABILITIES`, счётчик рестартов растёт.

Причина: в юните заданы `ProtectKernelModules=yes` и/или `ProtectClock=yes`.
Эти опции требуют сброса capabilities, а пользовательский менеджер systemd
(`systemd --user`) на это не имеет прав.

Решение: удалить обе строки из `~/.config/systemd/user/lm-computer.service`,
затем:

```bash
systemctl --user daemon-reload
systemctl --user reset-failed lm-computer.service
systemctl --user restart lm-computer.service
```

`install.sh` из текущей версии уже создаёт юнит без этих опций.


## Диагностика одним блоком

```bash
TOKEN="$(cat ~/.config/lm-computer/token.txt)"
systemctl --user status lm-computer.service --no-pager
ss -ltnp | grep -E '1236|1237'
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:1236/api/status
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:1236/api/audit?limit=10"
journalctl --user -u lm-computer.service -n 40 --no-pager
```
