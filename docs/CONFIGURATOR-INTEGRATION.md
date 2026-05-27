# Интеграция конфигуратора с сайтом ЛЕСКОМ

Репозиторий: [89601573785/Machine-Tool-Calculator](https://github.com/89601573785/Machine-Tool-Calculator)

Сайт отдаёт конфигуратор как статику `/configurator/` (iframe из ЛК). Проекты хранятся в API (`configurations`, cookie-сессия).

## Схема

```
[ Vue ЛК /cabinet/configurator ]
        │ iframe (same-origin)
        ▼
[ /configurator/?embed=1&projectId=<uuid> ]
        │ fetch(..., { credentials: 'include' })
        ▼
[ GET/POST /api/v1/configurator/projects ]
```

## URL-параметры

| Параметр | Описание |
|----------|----------|
| `embed=1` | Компактный UI в iframe (`embed-mode` на `<body>`) |
| `projectId=<uuid>` | Загрузка при старте: `GET .../projects/{id}` |
| `userId=<id>` | Ключ localStorage (если нет cookie) |
| `apiBase=/api/v1` | База API (по умолчанию `/api/v1`) |
| `parentOrigin=<url>` | `targetOrigin` для `postMessage` (по умолчанию `location.origin`) |

Пример: `/configurator/?embed=1&projectId=a1b2c3d4-e5f6-7890-abcd-ef1234567890`

## API

Все запросы: `credentials: 'include'`.

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/v1/configurator/projects/{id}` | Загрузка проекта |
| POST | `/api/v1/configurator/projects` | Создать/обновить |
| GET | `/api/v1/me/configurations` | Список в ЛК (родитель) |

### GET — ответ

```json
{
  "id": "uuid",
  "title": "Моя линия",
  "project": { "version": 1, "view": {}, "placed": [], "connections": [] }
}
```

Клиент также понимает поля `payload` / `data` вместо `project`.

### POST — тело

```json
{
  "id": "uuid",
  "title": "Моя линия",
  "project": { "version": 1, "placed": [], "connections": [], "view": {} }
}
```

`project` — результат `factoryDesigner.serializeProject()`. `id` опционален (новый проект).

### POST — ответ

```json
{ "id": "uuid", "title": "Моя линия", "updatedAt": "2026-05-27T12:00:00.000Z" }
```

При `401` — показать «Войдите на сайт ЛЕСКОМ».

## postMessage

После успешного сохранения в ЛК:

```javascript
window.parent.postMessage({
  type: 'leskom:configurator:saved',
  projectId: '<uuid>',
  title: '<string>',
  updatedAt: '<ISO8601>'
}, parentOrigin);
```

Родитель (Vue):

```javascript
window.addEventListener('message', (e) => {
  if (e.origin !== window.location.origin) return;
  if (e.data?.type === 'leskom:configurator:saved') {
    // обновить список конфигураций
  }
});
```

## localStorage

Не один ключ на всех:

```
factory_designer_{userId}_{projectId}
```

- `userId`: `?userId=`, cookie `leskom_user_id`, иначе `guest`
- `projectId`: из URL или `draft`

Кнопка «Сохранить» — localStorage. «Сохранить в ЛК» — только API.

## Файлы

| Файл | Назначение |
|------|------------|
| `js/integration.js` | Рабочий код (embed, API, postMessage) |
| `docs/configurator-integration.js` | Шаблон для справки |
| `css/embed.css` | Стили `embed=1` |

Подключение в `index.html` **до** `main.js`:

```html
<script src="js/integration.js"></script>
```

## Standalone

Без `embed=1` приложение работает как раньше (локальное сохранение, экспорт JSON). Интеграция не ломает автономный режим.

## vendor/ вместо CDN

Для продакшена положите скрипты в `vendor/` (см. `vendor/README.md`) и замените CDN-ссылки в `index.html`.

Сейчас в репозитории в `index.html` используется **CDN** (локальная разработка); на хостинге Timeweb рекомендуется `vendor/`.

## Позже (не в этом спринте)

- Поле `leskomSlug` у станков для связи с каталогом сайта.

## Чеклист

- [x] `js/integration.js`
- [x] Кнопка «Сохранить в ЛК» + название проекта
- [x] Загрузка по `?projectId=`
- [x] Standalone без embed
- [ ] `leskomSlug` у станков
- [ ] Файлы в `vendor/` на хостинге
