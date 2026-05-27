# Локальные зависимости (вместо CDN)

Скопируйте файлы с [cdnjs](https://cdnjs.cloudflare.com) или из `node_modules` перед деплоем на хостинг без внешних скриптов.

| Путь | Источник |
|------|----------|
| `vendor/sql.js/1.8.0/sql-wasm.js` | sql.js 1.8.0 |
| `vendor/sql.js/1.8.0/sql-wasm.wasm` | sql.js 1.8.0 |
| `vendor/jspdf/2.5.1/jspdf.umd.min.js` | jspdf 2.5.1 |
| `vendor/html2canvas/1.4.1/html2canvas.min.js` | html2canvas 1.4.1 |
| `vendor/font-awesome/6.0.0/css/all.min.css` + `webfonts/*` | Font Awesome 6 |

Пока каталог пуст, в `index.html` можно временно раскомментировать CDN (см. комментарии в файле).
