# Как обновить плагин

Обновление занимает минуту и не трогает рабочие файлы, настройки и токен.

```bash
cd ~/lm-computer
git pull
./install.sh
```

Затем **полностью закройте и откройте LM Studio**. Плагин загружается при
старте, и LM Studio кэширует сборку до перезапуска.

## Что происходит по шагам

| Шаг | Что делает |
|---|---|
| `git pull` | обновляет исходники и `package-lock.json` |
| `npm ci` | ставит ровно те зависимости, что в lock-файле |
| `npm run build` | пересобирает `dist/` |
| `lms dev --install` | регистрирует новую сборку плагина в LM Studio |
| `systemctl --user restart` | перезапускает REST/MCP с новым `dist/standalone.js` |

`install.sh` также перезаписывает юнит `lm-computer.service` (например, если
изменились пути или параметры запуска) и проверяет `zenity` и `ufw`.

Конфиг `~/.config/lm-computer/config.json` не перезаписывается: токен, workspace
и лимиты сохраняются. Новые поля, появившиеся в версии, получают значения по
умолчанию.

## Проверка после обновления

```bash
systemctl --user status lm-computer.service
curl -s -H "Authorization: Bearer $(cat ~/.config/lm-computer/token.txt)" \
  http://127.0.0.1:1236/api/status | head -c 300
ss -ltnp | grep -E '1236|1237'
```

- в `status` поле `version` совпадает с новой версией;
- оба listener'а в состоянии `listening: true`;
- `pendingApprovals` не завис;
- в чате LM Studio инструменты работают как раньше;
- `opencode mcp list` показывает `lm-computer` со статусом `connected`.

## Частичные обновления

**Только REST/MCP, без перезапуска LM Studio:**

```bash
git pull
npm ci
npm run build
systemctl --user restart lm-computer.service
```

Подходит, если менялся только сервис. Плагин внутри LM Studio продолжит работать
со старой сборкой до перезапуска.

**Только плагин внутри LM Studio:**

```bash
git pull
npm ci
npm run build
~/.lmstudio/bin/lms dev --install
```

После этого перезапустите LM Studio.

## Если что-то пошло не так

**`npm ci` падает**

Проверьте Node.js (`node -v`, нужен 22+) и доступ к npm. Если машина без сети,
соберите `dist/` на другой машине и перенесите репозиторий целиком.

**Сервис не стартует после обновления**

```bash
journalctl --user -u lm-computer.service -n 50 --no-pager
```

Частые причины: занятый порт `1236`/`1237`, синтаксис в `config.json`, старый
Node.js. Подробнее: [Troubleshooting](https://github.com/Spe4naz/lm-computer/wiki/Troubleshooting).

**Плагин в LM Studio остался старым**

Перезапустите LM Studio полностью (не только чат). Убедитесь, что `lms dev
--install` завершился успешно и в логах LM Studio нет ошибки загрузки плагина.

**Переехал каталог репозитория**

`install.sh` записывает `WorkingDirectory` и `ExecStart` в юнит. Запустите его
заново из нового каталога и перезапустите сервис.

## Откат

```bash
cd ~/lm-computer
git log --oneline -10        # выберите коммит или тег
git checkout <commit>
./install.sh
```

После проверки вернитесь на основную ветку:

```bash
git switch main
git pull
./install.sh
```

Если новая версия меняла формат `config.json`, откат может потребовать ручной
правки файла — сделайте копию перед обновлением:

```bash
cp ~/.config/lm-computer/config.json ~/.config/lm-computer/config.json.bak
```

## Обновление клиентов

- **LM Chat**: токен и адрес не меняются, обновлять настройки не нужно.
- **opencode**: адрес MCP и заголовок `Authorization` не меняются.
- Если вы вручную меняли токен, обновите его у всех клиентов.

## Чего обновление не делает

- не перезаписывает `config.json` и `token.txt`;
- не удаляет рабочую папку `~/lm-chat-computer`;
- не сбрасывает автопринятие и журнал;
- не удаляет старые задания в памяти — они теряются при перезапуске сервиса,
  как и раньше.
