# Онлайн-сборщик производственного цеха

**Тема дипломного проекта:** разработка веб-решения создания и конфигурирования производственной линии ООО «ЛЕСКОМ».

Веб-приложение для планирования и визуализации компоновки производственного цеха: каталог станков, рабочая область, технологические связи, расчёт и PDF-отчёт.

## Возможности

- Каталог оборудования с поиском и drag-and-drop
- Связи между станками (Shift + клик)
- Зум, панорамирование, сетка и привязка
- Черновик в `localStorage` (ключ per user/project)
- Экспорт/импорт JSON
- Расчёт и выгрузка PDF
- **Интеграция с ЛК:** embed в iframe, сохранение через API, `postMessage` родителю

## Стек

| Компонент | Технология |
|-----------|------------|
| Интерфейс | HTML5, CSS3, JavaScript (ES6+) |
| Иконки | Font Awesome 6 |
| PDF | jsPDF, html2canvas |
| Каталог | SQL.js (`data/factory.db`) / `equipment-data.js` |

## Структура

```
├── index.html
├── css/
│   ├── style.css
│   └── embed.css
├── js/
│   ├── main.js
│   ├── connections.js
│   ├── integration.js      # embed + API ЛК
│   └── equipment-data.js
├── data/factory.db
├── images/equipment/
├── vendor/                 # локальные скрипты (см. vendor/README.md)
└── docs/
    ├── CONFIGURATOR-INTEGRATION.md
    └── configurator-integration.js   # шаблон
```

## Запуск

```bash
git clone https://github.com/89601573785/Machine-Tool-Calculator.git
cd Machine-Tool-Calculator
npx serve .
```

Откройте `http://localhost:3000` (порт может отличаться).

> Через `file://` SQLite не загрузится — используется `equipment-data.js`. Для `vendor/` нужен HTTP-сервер.

### Режим embed (как на сайте)

```
/?embed=1&projectId=<uuid>
```

Кнопка **«Сохранить в ЛК»** → `POST /api/v1/configurator/projects` с `credentials: 'include'`.

Подробно: [docs/CONFIGURATOR-INTEGRATION.md](docs/CONFIGURATOR-INTEGRATION.md)

## Управление

| Действие | Клавиши/мышь |
|----------|---------------|
| Добавить станок | Перетащить из каталога |
| Связать станки | Shift + клик по двум станкам |
| Зум | Ctrl + колесо или кнопки ± |
| Перемещение | Alt / СКМ / ПКМ + перетаскивание |
| Удалить станок | × на карточке |

## Интеграция с leskomphp

Статика деплоится в `/configurator/` на том же домене, что и сайт (cookie сессии). API: `GET/POST /api/v1/configurator/projects`.

Данные в каталоге **учебные**, не официальный прайс ООО «ЛЕСКОМ».

## Лицензия

MIT
