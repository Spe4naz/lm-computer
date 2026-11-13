# Установка

## Требования

- Ubuntu (или другой Linux с systemd) и LM Studio 0.4.x с CLI `lms`;
- Node.js 22+ в `PATH` — для сборки и сервиса;
- `zenity` — для подтверждений на машине с LM Studio;
- открытые порты `1236` (REST) и `1237` (MCP), если клиенты в сети.

`sudo` для установки не нужен: плагин и сервис ставятся в профиль пользователя.

## Одна команда

```bash
git clone https://github.com/Spe4naz/lm-computer.git
cd lm-computer
./install.sh
```

Если архив скачан без executable-бита:

```bash
bash install.sh
```

Что делает `install.sh`:

- находит `lms` в `PATH` или `~/.lmstudio/bin/lms`;
- ставит зависимости (`npm ci`) и собирает `dist/`;
- выполняет `lms dev --install` — регистрирует плагин в LM Studio;
- создаёт `~/.config/systemd/user/lm-computer.service`, включает и запускает его;
- проверяет наличие `zenity`;
- предупреждает, если `ufw` активен, и подсказывает команды для портов;
- не использует `sudo`.

Юнит-файл перезаписывается при каждом запуске — правки в нём не сохраняются.
Меняйте настройки через `config.json` или переменные окружения.

## Ручная установка

```bash
npm ci
npm run build
~/.lmstudio/bin/lms dev --install
node dist/standalone.js
```

Для автозапуска сервиса без `install.sh` создайте юнит по образцу из
[`install.sh`](https://github.com/Spe4naz/lm-computer/blob/main/install.sh) или
запустите `./install.sh` — он это сделает сам.

## После первого запуска

```text
workspace: ~/lm-chat-computer
config:    ~/.config/lm-computer/config.json
token:     ~/.config/lm-computer/token.txt
audit:     ~/.config/lm-computer/audit.jsonl
REST API:  http://<this-machine>:1236/api
MCP:       http://<this-machine>:1237/mcp
```

Токен создаётся автоматически (32 случайных байта) и записывается в `token.txt`
с правами `0600`. Он нужен LM Chat и opencode.

## zenity

```bash
sudo apt install -y zenity
```

Если `zenity` не установлен, подтверждения не показываются, и запросы
`shell_run` завершаются по таймауту. Проверка:

```bash
zenity --question --text="LM Computer test"
```

Диалог должен появиться в графической сессии пользователя.

## Файрвол

```bash
sudo ufw allow 1236/tcp   # REST API для LM Chat
sudo ufw allow 1237/tcp   # MCP для opencode
sudo ufw status
```

`1237` можно не открывать, если opencode не используется. Не открывайте порты в
интернет: токен передаётся по HTTP.

## Сервис без входа в графическую сессию

```bash
sudo loginctl enable-linger "$USER"
```

Иначе user-сервис останавливается после выхода из сессии. Для `zenity` нужны
`DISPLAY`/`WAYLAND_DISPLAY`; `install.sh` передаёт их через `PassEnvironment`
из текущей сессии.

## Проверка установки

1. `./install.sh` завершается без ошибок.
2. `systemctl --user status lm-computer.service` — `active (running)`.
3. `ss -ltnp | grep -E '1236|1237'` — два listener'а.
4. `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:1236/api/status`
   отвечает и показывает оба listener'а.
5. В чате LM Studio: «создай файл `test.txt` со словом hello» — файл появляется
   в `~/lm-chat-computer`.
6. «выполни `whoami`» — появляется `zenity`; после разрешения вывод приходит в
   чат.
7. `opencode mcp list` показывает `lm-computer` подключённым к `1237`.
8. `./stop.sh` останавливает сервис.

## Windows

`install.sh` рассчитан на Linux. Плагин внутри LM Studio и сам сервис написаны
на Node.js, поэтому `node dist/standalone.js` можно запустить и на Windows для
разработки, но автоматической установки, systemd и `zenity` там нет. Для
повседневной работы с LM Chat и opencode используйте Linux-машину с LM Studio.

## Удаление

```bash
systemctl --user disable --now lm-computer.service
rm ~/.config/systemd/user/lm-computer.service
systemctl --user daemon-reload
```

Плагин удалите через LM Studio (Integrations / My Plugins). Каталог
`~/.config/lm-computer` и рабочая папка `~/lm-chat-computer` остаются — удалите
их вручную, если данные больше не нужны.
