# Частые вопросы

## Как обновить плагин?

```bash
cd ~/lm-computer
git pull
./install.sh
```

Затем полностью перезапустите LM Studio. Настройки, токен и рабочая папка
сохраняются. Полная инструкция с проверкой и откатом:
[Updating](https://github.com/Spe4naz/lm-computer/wiki/Updating).

## Нужен ли LM Chat?

Нет. Плагин даёт native tools в LM Studio, а подтверждения показывает `zenity`.
LM Chat нужен, если вы хотите управлять подтверждениями из приложения на
телефоне и работать с файлами через REST.

## Можно ли пользоваться без LM Studio?

Сервис `lm-computer.service` — отдельный процесс: он запускается и отвечает на
REST/MCP даже при закрытом LM Studio. Но инструменты модели работают только в
чате LM Studio; без него это просто API к файлам и shell.

## Зачем два порта?

Это два независимых listener'а в одном процессе:

- `1236` — REST для LM Chat;
- `1237` — MCP для opencode.

Их можно включать по отдельности (`apiEnabled`, `mcpEnabled`) и разносить по
разным адресам. Порты должны отличаться.

## Почему HTTP, а не HTTPS?

LM Studio и локальные клиенты работают по HTTP, а сертификат для LAN требует
ручной настройки доверия на каждом устройстве. Токен при этом идёт в cleartext:
используйте доверенную сеть, `ufw` или Tailscale. Не открывайте порты в
интернет.

## Где взять токен?

```bash
cat ~/.config/lm-computer/token.txt
```

Он же лежит в `config.json`. Токен нужен LM Chat, opencode и любым другим
клиентам REST/MCP.

## Как сменить рабочую папку?

Отредактируйте `workspace` в `~/.config/lm-computer/config.json` или выполните:

```bash
curl -H "Authorization: Bearer $TOKEN" -X PUT \
  -H "Content-Type: application/json" \
  -d '{"workspace":"/home/user/work"}' \
  http://127.0.0.1:1236/api/config
```

Папка должна находиться внутри домашнего каталога или разрешённого корня.
Перезапуск для этого не нужен.

## Почему автопринятие пропало?

Оно временное и живёт в памяти:

- максимум 30 минут;
- сбрасывается при перезапуске сервиса;
- действует, только пока LM Chat опрашивает API (окно 15 секунд);
- не распространяется на native tools внутри LM Studio — у них своя очередь.

## Можно ли запустить на Windows?

Плагин написан на Node.js и запускается в LM Studio, но установка рассчитана
на Linux: `install.sh` использует systemd, а подтверждения — `zenity`. На
Windows можно вручную запустить `node dist/standalone.js` для разработки; для
повседневного использования берите Ubuntu-машину с LM Studio.

## Что именно видит модель?

12 инструментов: файлы внутри workspace, `system_info`, `open_path` и
`shell_run`. Модель не получает доступ к сети, браузеру или системным
настройкам напрямую, но `shell_run` может запустить любую разрешённую команду с
правами пользователя. Полный список — [Tools](https://github.com/Spe4naz/lm-computer/wiki/Tools).

## Куда удаляются файлы?

В корзину: `~/.config/lm-computer/trash/<время>-<имя>`. Оттуда файл можно
вернуть вручную. Автоматической очистки нет.

## Где журнал?

`~/.config/lm-computer/audit.jsonl`, а также
`GET /api/audit?limit=100`. Секреты маскируются, файл ротируется после 5 МиБ.

## Почему LM Studio пишет «Evicting plugin»?

Это нормальное поведение: LM Studio выгружает процесс плагина, когда он не
нужен. Поэтому REST и MCP работают в отдельном сервисе, а не внутри плагина.

## Как удалить плагин?

```bash
systemctl --user disable --now lm-computer.service
rm ~/.config/systemd/user/lm-computer.service
systemctl --user daemon-reload
```

Плагин удалите через LM Studio (Integrations / My Plugins). `~/.config/lm-computer`
и `~/lm-chat-computer` остаются — удалите их вручную, если данные не нужны.

## Это безопасно?

Относительно: файлы ограничены workspace, разрушительные команды блокируются,
подтверждения обязательны, токен обязателен. Но `shell_run` после подтверждения
работает с вашими правами, а denylist можно обойти. Подробности:
[Security](https://github.com/Spe4naz/lm-computer/wiki/Security).
