# fourtexec accounts

Сайт аккаунта: **accounts.fourtexec.site**. Вход, регистрация, сброс пароля, подтверждение почты, профиль, 2FA (с QR-кодом и recovery-кодами), список устройств, история входов, удаление аккаунта, публичные профили `#/u/<username>`.

Статический сайт без сборки: `index.html` + `app.js` + `style.css`. Работает с API из [fourtexec/api](https://github.com/fourtexec/api) — там же описание всей архитектуры.

- Адреса API и соседних сайтов — в `config.js` (на `localhost` подставляются локальные порты).
- После входа возвращает туда, откуда пришли: `#/login?next=https://fourtexec.site/...` (только на `*.fourtexec.site`).
- Строгий Content-Security-Policy в `index.html`. Если поменяете inline-скрипт темы — пересчитайте его sha256 в CSP.
- `vendor/qrcode.js` — [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT) для QR-кода 2FA.

## Публикация

GitHub Pages из ветки по умолчанию, файл `CNAME` уже есть. В DNS: `CNAME accounts → fourtexec.github.io`.

## Локально

```bash
python3 -m http.server 8001   # api должен работать на :8080
```
