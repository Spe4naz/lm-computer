# LM Computer

Плагин для **LM Studio**, который даёт модели контролируемый доступ к
компьютеру: файлы в отдельной рабочей папке, команды shell, открытие файлов и
папок. Подтверждения показывает `zenity` на машине с LM Studio, а REST и MCP
готовы для [LM Chat](https://github.com/Spe4naz/lm-chat/wiki) и opencode.

- Репозиторий: <https://github.com/Spe4naz/lm-computer>
- Клиент: <https://github.com/Spe4naz/lm-chat>
- Полное описание: [README](https://github.com/Spe4naz/lm-computer#readme)

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

Вместе с процессом плагина исчезли бы и порты `1236`/`1237`. Поэтому:

- плагин отвечает только за native tools внутри LM Studio;
- REST и MCP живут в `lm-computer.service` и не зависят от LM Studio;
- подтверждения работают через `zenity`, пока в LM Chat нет экрана подтверждений;
- у сервиса и native tools разные очереди подтверждений.

## Быстрый старт

```bash
git clone https://github.com/Spe4naz/lm-computer.git
cd lm-computer
./install.sh
```

После установки перезапустите LM Studio, если плагин не появился сразу.
Проверка:

```bash
systemctl --user status lm-computer.service
ss -ltnp | grep -E '1236|1237'
```

Токен для клиентов: `~/.config/lm-computer/token.txt`.

## Страницы

| Страница | О чём |
|---|---|
| [Installation](https://github.com/Spe4naz/lm-computer/wiki/Installation) | Требования, `install.sh`, ручная установка, проверка |
| [Updating](https://github.com/Spe4naz/lm-computer/wiki/Updating) | **Как обновить плагин**, откат, обновление только сервиса |
| [Configuration](https://github.com/Spe4naz/lm-computer/wiki/Configuration) | `config.json`, переменные окружения, workspace |
| [Tools](https://github.com/Spe4naz/lm-computer/wiki/Tools) | Все инструменты модели, лимиты и подтверждения |
| [REST-API](https://github.com/Spe4naz/lm-computer/wiki/REST-API) | Эндпоинты, примеры `curl`, коды ошибок |
| [MCP](https://github.com/Spe4naz/lm-computer/wiki/MCP) | Подключение opencode, ограничения stateless-сервера |
| [Approvals](https://github.com/Spe4naz/lm-computer/wiki/Approvals) | Как работают подтверждения, автопринятие, `zenity` |
| [Security](https://github.com/Spe4naz/lm-computer/wiki/Security) | Модель безопасности, denylist, отчёты о журнале |
| [Troubleshooting](https://github.com/Spe4naz/lm-computer/wiki/Troubleshooting) | Сервис не стартует, порт занят, 401, нет `zenity` |
| [FAQ](https://github.com/Spe4naz/lm-computer/wiki/FAQ) | Короткие ответы на частые вопросы |

## Совместимость

- LM Studio 0.4.x с CLI `lms`;
- Ubuntu или другой Linux с systemd и `zenity`;
- Node.js 22+ для сервиса и сборки;
- клиенты: LM Chat, opencode (MCP), любой HTTP-клиент с Bearer-токеном.

Версия плагина указана в `package.json` и `src/version.ts`, её же отдаёт
`GET /api/status`.

Страницы вики хранятся в репозитории в каталоге
[`wiki/`](https://github.com/Spe4naz/lm-computer/tree/main/wiki).
