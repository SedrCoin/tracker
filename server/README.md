# Tracker API (сервер)

Node + SQLite, без внешних зависимостей. Нужен Node ≥ 22.5 (встроенный `node:sqlite`).

## Локально
```bash
TRACKER_TOKEN=dev-token node index.js
# проверка: curl localhost:8787/health -> {"ok":true}
```

## Тесты
```bash
npm test
```

## Деплой без поддомена

1. Скопировать папку `server/` на сервер, напр. в `/opt/tracker/server`.
2. Сгенерировать токен: `openssl rand -hex 32` — сохранить.
3. Положить `tracker.service` в `/etc/systemd/system/tracker.service`, вписать токен и пути:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now tracker
   curl localhost:8787/health   # {"ok":true}
   ```
4. Прокинуть путь `/trackerapi/` в reverse-proxy домена.

   **nginx** — внутри существующего `server { ... }`:
   ```nginx
   location /trackerapi/ {
       proxy_pass http://127.0.0.1:8787/;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```
   затем `sudo nginx -t && sudo systemctl reload nginx`.

   **Caddy** — внутри существующего блока домена:
   ```
   handle_path /trackerapi/* {
       reverse_proxy 127.0.0.1:8787
   }
   ```
   затем `sudo systemctl reload caddy`.

5. Проверить снаружи: `curl https://ТВОЙ-ДОМЕН/trackerapi/health` → `{"ok":true}`.
6. В приложении (Настройки → Синхронизация): адрес `https://ТВОЙ-ДОМЕН/trackerapi`, ключ = токен.

Префикс `/trackerapi/` срезается прокси — Node видит `/health`, `/state`.
