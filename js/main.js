// Основной JavaScript файл (standalone версия - без сервера)
class FactoryDesigner {
    constructor() {
        this.equipment = [];
        this.allEquipment = [];
        this.placedEquipment = [];
        this.isDragging = false;
        this.dragElement = null;
        this.zoom = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.snapSize = 20;
        this.cmToPx = 0.8;
        this.isPanning = false;
        this.lastPanX = 0;
        this.lastPanY = 0;
        this.lastPointerX = null;
        this.lastPointerY = null;
        this.isShiftPressed = false;
        this.selectedPlacementId = null;
        this.connectionManager = null;
        this.catalogTab = 'all';
        this.workspaceWidth = 12000;
        this.workspaceHeight = 9000;
        this.nextPlacementId = 1;
        this.projectStorageKey = this.resolveProjectStorageKey();
        this.ready = this.init();
    }

    buildEquipmentLookup() {
        const byId = new Map();
        const bySlug = new Map();
        (this.allEquipment || []).forEach((eq) => {
            if (eq?.id != null) byId.set(Number(eq.id), eq);
            const slug = (eq.leskomSlug || '').toString().trim().toLowerCase();
            if (slug) bySlug.set(slug, eq);
        });
        return { byId, bySlug };
    }

    resolveEquipmentForPlacement(placed, lookup) {
        if (!placed || !lookup) return null;
        const id = Number(placed.equipmentId);
        if (Number.isFinite(id) && lookup.byId.has(id)) {
            return lookup.byId.get(id);
        }
        const slug = (placed.leskomSlug || '').toString().trim().toLowerCase();
        if (slug && lookup.bySlug.has(slug)) {
            return lookup.bySlug.get(slug);
        }
        return null;
    }

    clampPanToBounds() {
        const workspace = document.getElementById('workspaceArea');
        if (!workspace) return;
        const container = workspace.parentElement;
        if (!container) return;

        const scaledW = this.workspaceWidth * this.zoom;
        const scaledH = this.workspaceHeight * this.zoom;
        const cW = container.clientWidth || window.innerWidth;
        const cH = container.clientHeight || window.innerHeight;

        const minX = Math.min(0, cW - scaledW);
        const minY = Math.min(0, cH - scaledH);
        const maxX = 0;
        const maxY = 0;

        this.panX = Math.max(minX, Math.min(maxX, this.panX));
        this.panY = Math.max(minY, Math.min(maxY, this.panY));
    }

    updateBoundaryMarkers() {
        const workspace = document.getElementById('workspaceArea');
        if (!workspace) return;
        const container = workspace.parentElement;
        if (!container) return;

        const topMarker = document.getElementById('workspaceTopMarker');
        const bottomMarker = document.getElementById('workspaceEndMarker');
        const leftMarker = document.getElementById('workspaceLeftMarker');
        const rightMarker = document.getElementById('workspaceRightMarker');
        if (!topMarker && !bottomMarker && !leftMarker && !rightMarker) return;

        const visibleLeft = (-this.panX) / this.zoom;
        const visibleWidth = (container.clientWidth || window.innerWidth) / this.zoom;
        const visibleCenterX = visibleLeft + visibleWidth / 2;

        const safePadding = 180;
        const clampedX = Math.max(
            safePadding,
            Math.min(this.workspaceWidth - safePadding, visibleCenterX)
        );

        const visibleTop = (-this.panY) / this.zoom;
        const visibleHeight = (container.clientHeight || window.innerHeight) / this.zoom;
        const visibleCenterY = visibleTop + visibleHeight / 2;
        const clampedY = Math.max(
            safePadding,
            Math.min(this.workspaceHeight - safePadding, visibleCenterY)
        );

        if (topMarker) topMarker.style.left = `${clampedX}px`;
        if (bottomMarker) bottomMarker.style.left = `${clampedX}px`;
        if (leftMarker) leftMarker.style.top = `${clampedY}px`;
        if (rightMarker) rightMarker.style.top = `${clampedY}px`;
    }

    resolveProjectStorageKey() {
        const params = window.__leskomConfiguratorParams;
        const integration = window.LeskomConfiguratorIntegration;
        if (integration?.storageKey) {
            const userId = params?.userId || 'guest';
            const projectId = params?.projectId || window.__leskomProjectId || null;
            return integration.storageKey(userId, projectId);
        }
        return 'factory_designer_guest_draft';
    }

    getProjectTitle() {
        const input = document.getElementById('projectTitleInput');
        return (input?.value || '').trim() || 'Без названия';
    }

    updateWorkspaceBySidebar() {
        const workspace = document.querySelector('.workspace');
        if (!workspace) return;
        // Sidebar работает как overlay, поэтому рабочую область не сдвигаем.
        workspace.style.left = '0';
        workspace.style.width = '100%';
    }

    async init() {
        await this.loadEquipment();
        this.setupEventListeners();
        this.setupDragAndDrop();
        const workspaceArea = document.getElementById('workspaceArea');
        if (workspaceArea) {
            this.connectionManager = new ConnectionManager(workspaceArea);
            // Небольшая задержка для правильного расчета размеров
            setTimeout(() => {
                this.updateWorkspaceBySidebar();
                this.centerWorkspace();
                this.updateGridByZoom();
                if (this.equipment && this.equipment.length > 0 && this.connectionManager) {
                    this.connectionManager.showNotification(`Загружено ${this.equipment.length} станков`, 'success');
                }
            }, 100);
            
            // Также центрируем при изменении размера окна
            window.addEventListener('resize', () => {
                setTimeout(() => {
                    this.centerWorkspace();
                }, 100);
            });
        } else {
            console.error('Рабочая область не найдена!');
        }
    }

    resolveApiBase() {
        const params = window.__leskomConfiguratorParams;
        if (params?.apiBase) return params.apiBase.replace(/\/$/, '');
        try {
            const q = new URLSearchParams(window.location.search);
            const fromQuery = q.get('apiBase');
            if (fromQuery) return fromQuery.replace(/\/$/, '');
        } catch (_) { /* ignore */ }
        return '/api/v1';
    }

    async loadFromSiteCatalog() {
        const apiBase = this.resolveApiBase();
        const res = await fetch(`${apiBase}/catalog/configurator/equipment`, {
            credentials: 'include',
            headers: { Accept: 'application/json' }
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const body = await res.json();
        const items = body.items || body;
        if (!Array.isArray(items)) {
            throw new Error('Некорректный ответ API каталога');
        }
        return items;
    }

    async loadEquipment() {
        try {
            console.log('Начинаю загрузку оборудования...');
            
            let data = null;
            
            const isFileProtocol = window.location.protocol === 'file:';
            if (!isFileProtocol) {
                try {
                    data = await this.loadFromSiteCatalog();
                    if (data && data.length > 0) {
                        console.log('✓ Каталог загружен с сайта ЛЕСКОМ:', data.length, 'поз.');
                    } else {
                        data = null;
                    }
                } catch (siteError) {
                    console.warn('Каталог сайта недоступен:', siteError.message);
                    data = null;
                }
            }

            // SQLite — запасной вариант (локальный factory.db)
            if (!isFileProtocol && !data) {
                try {
                    data = await this.loadFromSQLite();
                    if (data && data.length > 0) {
                        console.log('✓ Данные загружены из SQLite базы данных:', data.length, 'элементов');
                    } else {
                        console.warn('SQLite база данных пуста или не содержит данных');
                        data = null;
                    }
                } catch (sqliteError) {
                    console.warn('Загрузка из SQLite не удалась:', sqliteError.message);
                    data = null;
                }
            }
            
            // Если SQLite не сработал, пробуем встроенные данные
            if (!data && window.EQUIPMENT_DATA && Array.isArray(window.EQUIPMENT_DATA)) {
                data = window.EQUIPMENT_DATA;
                console.log('✓ Данные загружены из встроенного JavaScript:', data.length, 'элементов');
            }
            
            if (!data) {
                throw new Error(
                    'Не удалось загрузить каталог. Импортируйте каталог на сайте (админка → Запарсить) или проверьте data/factory.db.'
                );
            }
            
            if (!Array.isArray(data)) {
                throw new Error('Данные не являются массивом');
            }
            
            if (data.length === 0) {
                console.warn('Массив пуст');
                this.equipment = [];
                this.allEquipment = [];
                this.renderEquipmentCatalog();
                return;
            }
            
            data = this.normalizeEquipmentDimensions(data);
            if (window.CatalogMeta) {
                data = CatalogMeta.enrichAll(data);
            }
            this.equipment = data;
            this.allEquipment = [...data];
            console.log(`✓ Загружено ${data.length} единиц оборудования`);
            this.renderEquipmentCatalog();
        } catch (error) {
            console.error('Ошибка загрузки оборудования:', error);
            this.showNotification('Ошибка загрузки оборудования: ' + error.message, 'error');
            // Показываем сообщение пользователю
            const catalog = document.getElementById('equipmentCatalog');
            if (catalog) {
                catalog.innerHTML = `
                    <div style="padding: 2rem; text-align: center; color: #dc3545;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 1rem;"></i>
                        <p><strong>Ошибка загрузки данных</strong></p>
                        <p style="font-size: 0.9rem; margin-top: 1rem; color: #6c757d;">
                            <strong>Решение:</strong><br>
                            1. Импортируйте каталог в БД (админка → «Запарсить сейчас») и перезапустите API<br>
                            2. Либо положите <code>data/factory.db</code> в папку конфигуратора<br>
                            3. Если открыли через <code>file://</code> — используйте сайт или Live Server<br>
                            4. Обновите эту страницу (F5)
                        </p>
                        <p style="font-size: 0.8rem; margin-top: 0.5rem; color: #999;">
                            Ошибка: ${error.message}
                        </p>
                    </div>
                `;
            }
        }
    }

    parseDimensionMeters(value) {
        if (value === null || value === undefined) return null;
        if (typeof value === 'number') {
            return Number.isFinite(value) && value > 0 ? value : null;
        }
        if (typeof value !== 'string') return null;
        const normalized = value
            .replace(',', '.')
            .replace(/[^\d.]/g, '')
            .trim();
        if (!normalized) return null;
        const n = Number(normalized);
        return Number.isFinite(n) && n > 0 ? n : null;
    }

    formatDimensionValue(value) {
        const meters = this.parseDimensionMeters(value);
        if (!Number.isFinite(meters)) return '—';
        return Number(meters.toFixed(3)).toString();
    }

    formatPowerValue(value) {
        if (value === null || value === undefined) return '—';
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (!normalized || normalized === 'null' || normalized === 'undefined' || normalized === 'nan') {
                return '—';
            }
        }
        const num = Number(value);
        if (!Number.isFinite(num) || num <= 0) return '—';
        return Number(num.toFixed(3)).toString();
    }

    normalizeEquipmentDimensions(list) {
        if (!Array.isArray(list)) return [];
        return list.map((item) => {
            const width = this.parseDimensionMeters(item?.width);
            const length = this.parseDimensionMeters(item?.length);
            const height = this.parseDimensionMeters(item?.height);
            return {
                ...item,
                width: width ?? null,
                length: length ?? null,
                height: height ?? null
            };
        });
    }
    
    async loadFromSQLite() {
        // Проверяем наличие SQL.js
        if (typeof initSqlJs === 'undefined') {
            throw new Error('SQL.js не загружен');
        }
        
        // Инициализируем SQL.js
        const sqlBase = window.__sqlJsBase || 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/';
        const SQL = await initSqlJs({
            locateFile: file => `${sqlBase}${file}`
        });
        
        // Загружаем базу данных
        // ВАЖНО: fetch может не работать через file:// протокол из-за CORS
        // В этом случае будет использован fallback на equipment-data.js
        let response;
        try {
            response = await fetch('data/factory.db');
            if (!response.ok) {
                throw new Error(`Не удалось загрузить базу данных: ${response.status}`);
            }
        } catch (fetchError) {
            // Если fetch не работает (file:// протокол), выбрасываем ошибку
            // для использования fallback на equipment-data.js
            throw new Error(`Не удалось загрузить базу данных через fetch: ${fetchError.message}. Используется резервный вариант.`);
        }
        
        const buffer = await response.arrayBuffer();
        const db = new SQL.Database(new Uint8Array(buffer));
        
        // Запрашиваем все оборудование
        const result = db.exec(`
            SELECT 
                id, name, equipment_type, category, productivity, cost, installation_cost,
                power_consumption, width, height, length, speed,
                operator_count, efficiency, price, photo, folder_path,
                input_materials, output_materials, daily_operation_cost,
                daily_maintenance_cost, gallery, cycle_time,
                description, specifications, advantages, fast_info, url
            FROM equipment
            ORDER BY name
        `);
        
        if (!result || result.length === 0) {
            db.close();
            return [];
        }
        
        const columns = result[0].columns;
        const values = result[0].values;
        
        // Преобразуем результат в массив объектов
        const equipment = [];
        for (let i = 0; i < values.length; i++) {
            const row = {};
            let folderPath = null;
            
            // Сначала собираем все данные и находим folder_path
            columns.forEach((col, idx) => {
                let value = values[i][idx];
                
                // Обрабатываем NULL значения
                if (value === null || value === undefined) {
                    value = null;
                }
                
                // Сохраняем folder_path сразу для использования в других полях
                if (col === 'folder_path') {
                    folderPath = value || null;
                }
                
                row[col] = value;
            });
            
            // Теперь обрабатываем поля, которые зависят от folder_path
            columns.forEach((col, idx) => {
                let value = row[col];
                
                // Обрабатываем JSON поля
                if ((col === 'input_materials' || col === 'output_materials' || col === 'gallery' || 
                     col === 'specifications' || col === 'advantages' || col === 'fast_info') && value) {
                    try {
                        if (typeof value === 'string') {
                            value = JSON.parse(value);
                        }
                    } catch (e) {
                        // Если не массив, то пустой массив или null
                        if (col === 'fast_info' || col === 'gallery') {
                            value = [];
                        } else {
                            value = [];
                        }
                    }
                }
                
                // Обрабатываем gallery пути (теперь folderPath уже известен)
                if (col === 'gallery' && Array.isArray(value) && value.length > 0) {
                    value = value.map(img => {
                        if (img && typeof img === 'object' && img.src) {
                            // Если это объект с полем src
                            if (img.src && !img.src.startsWith('http') && !img.src.startsWith('/')) {
                                if (folderPath) {
                                    img.src = `images/equipment/${folderPath}/${img.src}`;
                                } else {
                                    img.src = `images/equipment/${img.src}`;
                                }
                            }
                            return img;
                        } else if (typeof img === 'string' && img) {
                            // Если это просто строка с путем
                            if (!img.startsWith('http') && !img.startsWith('/')) {
                                if (folderPath) {
                                    return `images/equipment/${folderPath}/${img}`;
                                } else {
                                    return `images/equipment/${img}`;
                                }
                            }
                            return img;
                        }
                        return img;
                    });
                }
                
                row[col] = value;
            });
            
            // Обрабатываем photo путь после создания row
            if (row.photo) {
                // Если путь относительный, добавляем images/equipment/
                if (!row.photo.startsWith('http') && !row.photo.startsWith('/')) {
                    if (folderPath) {
                        row.photo = `images/equipment/${folderPath}/${row.photo}`;
                    } else {
                        row.photo = `images/equipment/${row.photo}`;
                    }
                }
            }
            
            equipment.push(row);
        }
        
        db.close();
        return equipment;
    }

    filterEquipment(searchTerm) {
        if (!this.allEquipment || this.allEquipment.length === 0) return;
        const trimmed = (searchTerm || '').trim();
        if (!trimmed) {
            this.equipment = [...this.allEquipment];
        } else {
            const term = trimmed.toLowerCase();
            this.equipment = this.allEquipment.filter(eq => {
                const name = (eq.name || '').toLowerCase();
                const type = (eq.equipment_type || '').toLowerCase();
                const category = (eq.category || '').toLowerCase();
                return name.includes(term) || type.includes(term) || category.includes(term);
            });
        }
        this.renderEquipmentCatalog();
    }

    renderEquipmentCatalog() {
        const catalog = document.getElementById('equipmentCatalog');
        if (!catalog) {
            console.error('Элемент equipmentCatalog не найден!');
            return;
        }
        
        catalog.innerHTML = '';

        if (!this.equipment || this.equipment.length === 0) {
            const searchInput = document.getElementById('equipmentSearch');
            const searchTerm = (searchInput?.value || '').trim();
            const isSearchNoResults = searchTerm.length > 0 && (this.allEquipment?.length || 0) > 0;

            if (isSearchNoResults) {
                catalog.innerHTML = `
                    <div style="padding: 2rem; text-align: center; color: #6c757d;">
                        <i class="fas fa-search" style="font-size: 2rem; margin-bottom: 1rem;"></i>
                        <p><strong>Ничего не найдено</strong></p>
                        <p style="font-size: 0.9rem; margin-top: 0.75rem; color: #495057;">
                            По запросу «${searchTerm.replace(/</g, '&lt;').replace(/>/g, '&gt;')}» оборудование не найдено.
                        </p>
                    </div>
                `;
            } else {
                catalog.innerHTML = `
                    <div style="padding: 2rem; text-align: center; color: #6c757d;">
                        <i class="fas fa-info-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i>
                        <p><strong>Нет доступного оборудования</strong></p>
                        <p style="font-size: 0.9rem; margin-top: 1rem; color: #495057;">
                            Данные оборудования не загружены.
                        </p>
                    </div>
                `;
            }
            return;
        }

        const renderEquipmentGroup = (equipmentList, rowTitle, rowNumber) => {
            if (equipmentList.length === 0) return null;
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'equipment-row-content';
            
            equipmentList.forEach(equipment => {
                const equipmentElement = document.createElement('div');
                equipmentElement.className = 'equipment-item';
                equipmentElement.draggable = true;
                equipmentElement.dataset.equipmentId = equipment.id;
                equipmentElement.dataset.equipmentRow = 0;
                equipmentElement.dataset.catalogType = equipment.catalogType || 'machine';

                let badgeHTML = '';
                if (equipment.catalogType === 'equipment_complex') {
                    const summary = window.CatalogMeta?.getComplexSummary(equipment.id) || '';
                    badgeHTML = `<span class="catalog-badge catalog-badge--complex">Комплекс станков</span>${summary ? `<div style="font-size:0.75rem;color:#1e40af;margin-bottom:4px;">${summary}</div>` : ''}`;
                } else if (equipment.catalogType === 'log_feed') {
                    badgeHTML = '<span class="catalog-badge catalog-badge--log-feed">Подача бревна</span>';
                } else if (equipment.catalogType === 'conveyor') {
                    badgeHTML = '<span class="catalog-badge catalog-badge--conveyor">Конвейер · на связи</span>';
                }

                const efficiency = equipment.efficiency || 0.85;
                const calculatedProductivity = (equipment.productivity * efficiency).toFixed(2);
                
                // Форматируем цену
                let priceDisplay = '';
                if (equipment.cost === 0 || (equipment.price && equipment.price.includes('Цена по запросу'))) {
                    priceDisplay = 'Цена по запросу';
                } else if (equipment.cost && equipment.cost > 0) {
                    priceDisplay = `${equipment.cost.toLocaleString()} руб`;
                } else if (equipment.price) {
                    priceDisplay = equipment.price;
                } else {
                    priceDisplay = 'Цена по запросу';
                }
                
                // Добавляем картинку
                let imageHTML = '';
                if (equipment.photo) {
                    imageHTML = `<img src="${equipment.photo}" alt="${equipment.name}" style="width: 100%; height: 150px; object-fit: cover; border-radius: 8px; margin-bottom: 10px;" onerror="this.style.display='none'">`;
                }
                
                // Форматируем данные с проверкой на наличие
                const powerValue = this.formatPowerValue(equipment.power_consumption);
                const powerConsumption = powerValue !== '—' ? `${powerValue} кВт` : null;
                const w = this.formatDimensionValue(equipment.width);
                const l = this.formatDimensionValue(equipment.length);
                const h = this.formatDimensionValue(equipment.height);
                const dimensions = (w !== '—' && l !== '—' && h !== '—')
                    ? `${w}×${l}×${h} м`
                    : null;
                
                // Формируем HTML карточки
                equipmentElement.innerHTML = `
                    ${imageHTML}
                    ${badgeHTML}
                    <div class="equipment-type">${this.getEquipmentTypeName(equipment.equipment_type)}</div>
                    <h4>${equipment.name}</h4>
                    <div class="equipment-card-info">
                        <p><i class="fas fa-tachometer-alt"></i> Производительность: ${calculatedProductivity} м³/смену</p>
                        ${powerConsumption ? `<p><i class="fas fa-bolt"></i> Мощность: ${powerConsumption}</p>` : ''}
                        ${dimensions ? `<p><i class="fas fa-ruler"></i> Габариты: ${dimensions}</p>` : ''}
                        <p><i class="fas fa-ruble-sign"></i> ${priceDisplay}</p>
                    </div>
                `;
                
                contentDiv.appendChild(equipmentElement);
            });
            
            return contentDiv;
        };
        
        const flatGroup = renderEquipmentGroup(this.equipment, 'Каталог', 0);
        if (flatGroup) catalog.appendChild(flatGroup);
    }

    // Ряды отключены: вся логика через связи/конвейеры.
    getEquipmentRow(equipment) {
        return 0;
    }

    getEquipmentTypeName(type) {
        if (!type) return 'Оборудование';
        const typeLower = type.toLowerCase();
        const types = {
            'пилорама': 'Пилорама',
            'ленточная пилорама': 'Ленточная пилорама',
            'ленточные пилорамы': 'Ленточная пилорама',
            'lentochnye_piloramy': 'Ленточная пилорама',
            'дисковая пилорама': 'Дисковая пилорама',
            'diskovye_piloramy': 'Дисковая пилорама',
            'бревнопильный станок': 'Бревнопильный',
            'brevnopilynye_stanki': 'Бревнопильный',
            'многопильный станок': 'Многопильный',
            'mnogopilynye_stanki': 'Многопильный',
            'фрезерный_станок': 'Фрезерный',
            'фрезерный': 'Фрезерный',
            'шлифовальный_станок': 'Шлифовальный',
            'шлифовальный': 'Шлифовальный',
            'сушильная_камера': 'Сушильная',
            'сушильная камера': 'Сушильная',
            'упаковочная_линия': 'Упаковка',
            'упаковочная линия': 'Упаковка',
            'рейсмус': 'Рейсмус',
            'рейсмусовый станок': 'Рейсмус',
            'фуговальный_станок': 'Фуговальный',
            'фуговальный': 'Фуговальный',
            'торцовочная_пила': 'Торцовка',
            'торцовочная пила': 'Торцовка',
            'торцовочный станок': 'Торцовка',
            'tortsovochnye_stanki': 'Торцовка',
            'шпоночный_станок': 'Шпоночный',
            'шпоночный': 'Шпоночный',
            'дровокол': 'Дровокол',
            'горбыльный станок': 'Горбыльный',
            'gorbylynye_stanki': 'Горбыльный',
            'кромкообрезной станок': 'Кромкообрезной',
            'kromkoobreznye_stanki': 'Кромкообрезной',
            'заточный станок': 'Заточный',
            'zatochnye_stanki': 'Заточный',
            'оцилиндровочный станок': 'Оцилиндровочный',
            'otsilindrovochnye_stanki': 'Оцилиндровочный',
            'профилировочный станок': 'Профилировочный',
            'profilirovochnye_stanki': 'Профилировочный',
            'лесопильная линия': 'Лесопильная линия',
            'lesopilynye_linii': 'Лесопильная линия',
            'рубительная машина': 'Рубительная',
            'rubitelynaya_mashina': 'Рубительная',
            'разводное устройство': 'Разводное',
            'razvodnye_ustroystva': 'Разводное',
            'околостаночное оборудование': 'Околостаночное',
            'okolostanochnoe_oborudovanie': 'Околостаночное'
        };
        // Проверяем точное совпадение
        if (types[typeLower]) return types[typeLower];
        // Проверяем частичное совпадение
        for (const [key, value] of Object.entries(types)) {
            if (typeLower.includes(key) || key.includes(typeLower)) {
                return value;
            }
        }
        // Если не нашли, возвращаем первую часть типа
        return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || type;
    }

    setupEventListeners() {
        this.isConnectMode = false;
        const bindClick = (id, handler) => {
            const el = document.getElementById(id);
            if (!el) {
                console.warn(`Кнопка не найдена: #${id}`);
                return null;
            }
            el.addEventListener('click', handler);
            return el;
        };

        bindClick('calculateBtn', () => this.calculateProduction());
        bindClick('clearWorkspaceBtn', () => this.clearWorkspace(true));
        bindClick('zoomInBtn', () => {
            const pivot = this.getZoomPivot();
            this.setZoom(this.zoom * 1.2, pivot.x, pivot.y);
        });
        bindClick('zoomOutBtn', () => {
            const pivot = this.getZoomPivot();
            this.setZoom(this.zoom * 0.8, pivot.x, pivot.y);
        });
        bindClick('zoomResetBtn', () => {
            this.setZoom(1.0);
            this.centerWorkspace();
        });

        const saveBtn = document.getElementById('saveProjectBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                if (
                    window.location.protocol !== 'file:' &&
                    window.LeskomConfiguratorIntegration?.saveProjectToCabinet &&
                    window.__leskomConfiguratorParams
                ) {
                    return;
                }
                this.saveProjectToLocalStorage();
            });
        }
        const howToUseBtn = document.getElementById('howToUseBtn');
        const howToUseModal = document.getElementById('howToUseModal');
        const closeHowToUse = () => {
            if (howToUseModal) howToUseModal.style.display = 'none';
        };
        if (howToUseBtn && howToUseModal) {
            howToUseBtn.addEventListener('click', () => {
                howToUseModal.style.display = 'block';
            });
            document.getElementById('howToUseClose')?.addEventListener('click', closeHowToUse);
            document.getElementById('howToUseCloseBtn')?.addEventListener('click', closeHowToUse);
            howToUseModal.addEventListener('click', (e) => {
                if (e.target === howToUseModal) closeHowToUse();
            });
        }
        const connectModeBtn = document.getElementById('connectModeBtn');
        if (connectModeBtn) {
            connectModeBtn.addEventListener('click', () => {
                this.isConnectMode = !this.isConnectMode;
                connectModeBtn.classList.toggle('active', this.isConnectMode);
                if (!this.isConnectMode) {
                    document.querySelectorAll('.placed-equipment').forEach(el => el.classList.remove('selected'));
                    this.selectedPlacementId = null;
                }
                this.showNotification(this.isConnectMode ? 'Режим связывания включён' : 'Режим связывания выключен', 'info');
            });
        }
        bindClick('catalogToggleBtn', () => {
            const sidebar = document.getElementById('equipmentSidebar');
            if (!sidebar) return;
            sidebar.classList.toggle('collapsed');
            this.updateWorkspaceBySidebar();
        });
        const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
        if (sidebarToggleBtn) {
            sidebarToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const sidebar = document.getElementById('equipmentSidebar');
            if (!sidebar) return;
            sidebar.classList.toggle('collapsed');
            this.updateWorkspaceBySidebar();
        });
        }
        const searchInput = document.getElementById('equipmentSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.filterEquipment(e.target.value));
        }
        
        const workspaceArea = document.getElementById('workspaceArea');
        const workspaceContainer = document.querySelector('.workspace-container');
        
        // Отключаем прокрутку страницы колесом (скролл нужен только внутри списков/модалок).
        window.addEventListener('wheel', (e) => {
            const inScrollable =
                !!e.target.closest('.sidebar-content') ||
                !!e.target.closest('.modal-body') ||
                !!e.target.closest('.conveyor-picker-list');
            if (!inScrollable && !(e.ctrlKey || e.metaKey)) {
                e.preventDefault();
            }
        }, { passive: false });

        // Обработка колесика мыши для масштабирования (зум вокруг курсора)
        if (workspaceArea) {
            workspaceArea.addEventListener('wheel', (e) => {
                // Если зажат Ctrl или Cmd - масштабирование
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    const delta = e.deltaY > 0 ? 0.9 : 1.1;
                    // Масштабируем так, чтобы точка под курсором оставалась на месте
                    this.setZoom(this.zoom * delta, e.clientX, e.clientY);
                }
            }, { passive: false });
        }
        
        // Панорамирование мышкой (как в основном проекте)
        if (workspaceArea) {
            this.isPanning = false;
            this.lastPanX = 0;
            this.lastPanY = 0;
            
            // Запоминаем последнюю позицию курсора над рабочей областью
            workspaceArea.addEventListener('mousemove', (e) => {
                this.lastPointerX = e.clientX;
                this.lastPointerY = e.clientY;
            });
            
            workspaceArea.addEventListener('mousedown', (e) => {
                // Правая/средняя кнопка, Alt+ЛКМ или ЛКМ по пустому месту рабочей области
                const onEmptyArea = e.button === 0 && (
                    e.target === workspaceArea ||
                    e.target.id === 'gridOverlay' ||
                    e.target.classList?.contains('grid-overlay')
                );
                if (e.button === 2 || e.button === 1 || (e.button === 0 && e.altKey) || onEmptyArea) {
                    e.preventDefault();
                    this.isPanning = true;
                    this.lastPanX = e.clientX;
                    this.lastPanY = e.clientY;
                    workspaceArea.style.cursor = 'grabbing';
                }
            });
            
            document.addEventListener('mousemove', (e) => {
                if (this.isPanning) {
                    e.preventDefault();
                    const deltaX = e.clientX - this.lastPanX;
                    const deltaY = e.clientY - this.lastPanY;
                    this.panX += deltaX;
                    this.panY += deltaY;
                    this.clampPanToBounds();
                    this.lastPanX = e.clientX;
                    this.lastPanY = e.clientY;
                    this.updateTransform();
                }
            });
            
            document.addEventListener('mouseup', (e) => {
                if (this.isPanning) {
                    this.isPanning = false;
                    workspaceArea.style.cursor = 'grab';
                }
            });
            
            // Отключаем контекстное меню при правом клике
            workspaceArea.addEventListener('contextmenu', (e) => {
                e.preventDefault();
            });
        }
        
        document.addEventListener('keydown', (e) => { if (e.key === 'Shift') this.isShiftPressed = true; });
        document.addEventListener('keyup', (e) => { if (e.key === 'Shift') this.isShiftPressed = false; });

        document.addEventListener('click', (e) => {
            const equipmentElement = e.target.closest('.placed-equipment');
            if (!equipmentElement) return;
            if (this.isShiftPressed || this.isConnectMode) {
                e.preventDefault();
                this.handleConnectionSelection(equipmentElement);
            }
        });
    }

    handleConnectionSelection(equipmentElement) {
        const placementId = parseInt(equipmentElement.dataset.placementId, 10);
        if (isNaN(placementId)) return;
        if (this.selectedPlacementId === null) {
            this.selectedPlacementId = placementId;
            equipmentElement.classList.add('selected');
            return;
        }
        if (this.selectedPlacementId === placementId) return;
        this.connectionManager.createConnection(this.selectedPlacementId, placementId, 'right', 'left', {
            ignoreCompatibility: true
        });
        document.querySelectorAll('.placed-equipment').forEach(el => el.classList.remove('selected'));
        this.selectedPlacementId = null;
        if (this.isConnectMode) {
            this.isConnectMode = false;
            document.getElementById('connectModeBtn')?.classList.remove('active');
        }
    }

    getGridStepCm() {
        if (this.zoom >= 2.2) return 10;
        if (this.zoom >= 1.6) return 20;
        if (this.zoom >= 1.1) return 50;
        if (this.zoom >= 0.8) return 100;
        if (this.zoom >= 0.6) return 200;
        return 200;
    }

    formatGridStepLabel(stepCm) {
        if (stepCm > 60) {
            const meters = stepCm / 100;
            const text = Number.isInteger(meters) ? `${meters}` : meters.toFixed(1).replace('.', ',');
            return `${text} м`;
        }
        return `${stepCm} см`;
    }

    updateGridCellSizeDisplay(stepCm) {
        const display = document.getElementById('gridCellSizeDisplay');
        if (!display) return;
        display.textContent = `Клетка: ${this.formatGridStepLabel(stepCm)}`;
    }

    getGridSizes() {
        const minorCm = this.getGridStepCm();
        const majorCm = minorCm * 5;
        const minor = Math.max(8, Math.round(minorCm * this.cmToPx));
        const major = Math.max(minor, Math.round(majorCm * this.cmToPx));
        return { major, minor, minorCm, majorCm };
    }

    getSnapSize() {
        return this.getGridSizes().minor;
    }

    getEdgePadding() {
        return this.getSnapSize();
    }

    snapValue(v) {
        const size = this.getSnapSize();
        return Math.round(v / size) * size;
    }

    applySnap(x, y) {
        return { x: this.snapValue(x), y: this.snapValue(y) };
    }
    
    setupDragAndDrop() {
        const workspace = document.getElementById('workspaceArea');
        if (!workspace) {
            console.error('Рабочая область не найдена!');
            return;
        }
        
        document.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('equipment-item') || e.target.closest('.equipment-item')) {
                this.dragElement = e.target.closest('.equipment-item');
                e.dataTransfer.effectAllowed = 'copy';
            }
        });
        
        workspace.addEventListener('dragover', (e) => { 
            e.preventDefault(); 
            e.dataTransfer.dropEffect = 'copy';
        });
        
        workspace.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.dragElement) {
                const equipmentId = parseInt(this.dragElement.dataset.equipmentId, 10);
                if (isNaN(equipmentId)) {
                    console.error('Неверный ID оборудования при перетаскивании:', this.dragElement.dataset.equipmentId);
                    this.dragElement = null;
                    return;
                }
                const equipment = this.equipment.find(eq => eq.id === equipmentId);
                if (equipment) {
                    const rect = workspace.getBoundingClientRect();
                    // Правильный расчет координат: getBoundingClientRect уже учитывает transform
                    // Поэтому нужно просто вычесть позицию элемента и разделить на масштаб
                    let x = (e.clientX - rect.left) / this.zoom;
                    let y = (e.clientY - rect.top) / this.zoom;
                    const snapped = this.applySnap(x, y);
                    x = snapped.x;
                    y = snapped.y;
                    if (typeof this.handleEquipmentDrop === 'function') {
                        this.handleEquipmentDrop(equipment, x, y);
                    } else {
                        this.placeEquipment(equipment, x, y);
                    }
                }
            }
            this.dragElement = null;
        });
        
        workspace.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-btn')) {
                e.stopPropagation();
                const equipmentElement = e.target.closest('.placed-equipment');
                if (equipmentElement) {
                    this.removeEquipment(equipmentElement);
                }
            }
        });
    }

    placeEquipment(equipment, x, y) {
        return this.placeEquipmentInstance(equipment, x, y);
    }

    placeEquipmentInstance(equipment, x, y, placementIdOverride = null) {
        const workspace = document.getElementById('workspaceArea');
        if (!workspace) {
            console.error('Рабочая область не найдена при размещении оборудования!');
            return;
        }
        const div = document.createElement('div');
        div.className = 'placed-equipment';
        const edgePadding = this.getEdgePadding();
        const dimensions = this.getEquipmentCardSize(equipment);
        const cardW = dimensions.widthPx;
        const cardH = dimensions.lengthPx;
        const cardArea = cardW * cardH;
        const maxX = Math.max(edgePadding, this.workspaceWidth - cardW - edgePadding);
        const maxY = Math.max(edgePadding, this.workspaceHeight - cardH - edgePadding);
        let safeX = x;
        let safeY = y;
        const snapped = this.applySnap(x, y);
        safeX = snapped.x;
        safeY = snapped.y;
        safeX = Math.min(maxX, Math.max(edgePadding, safeX));
        safeY = Math.min(maxY, Math.max(edgePadding, safeY));
        div.style.left = `${safeX}px`;
        div.style.top = `${safeY}px`;
        div.style.width = `${cardW}px`;
        div.style.minHeight = `${cardH}px`;
        // Уникальный ID экземпляра на поле (важно: один и тот же станок можно разместить несколько раз)
        const placementId = placementIdOverride !== null ? placementIdOverride : this.nextPlacementId++;
        div.dataset.placementId = placementId;
        div.dataset.equipmentId = equipment.id;
        div.dataset.equipmentRow = 0;
        div.dataset.catalogType = equipment.catalogType || 'machine';
        div.dataset.inputType = equipment.input_type || '';
        div.dataset.outputType = equipment.output_type || '';
        const efficiency = equipment.efficiency || 0.85;
        const calculatedProductivity = (equipment.productivity * efficiency).toFixed(2);
        
        // Добавляем миниатюру картинки
        let imageHTML = '';
        let visualMode = 'normal';
        if (equipment.photo && (cardW >= 520 || cardH >= 520 || cardArea >= 240000)) {
            visualMode = 'image-only';
        } else if (cardW >= 360 || cardH >= 300 || cardArea >= 120000) {
            visualMode = 'large';
        }
        if (visualMode === 'large') div.classList.add('placed-equipment--large');
        if (visualMode === 'image-only') div.classList.add('placed-equipment--image-only');
        if (equipment.photo) {
            imageHTML = `<img class="placed-equipment-image" src="${equipment.photo}" alt="${equipment.name}" onerror="this.style.display='none'">`;
        }
        
        // Форматируем цену
        let priceDisplay = '';
        if (equipment.cost === 0 || (equipment.price && equipment.price.includes('Цена по запросу'))) {
            priceDisplay = 'Цена по запросу';
        } else if (equipment.cost && equipment.cost > 0) {
            priceDisplay = `${equipment.cost.toLocaleString()} руб`;
        } else if (equipment.price) {
            priceDisplay = equipment.price;
        } else {
            priceDisplay = 'Цена по запросу';
        }
        
        div.innerHTML = `
            <button class="delete-btn">×</button>
            ${imageHTML}
            <h4>${equipment.name}</h4>
            <div class="equipment-stats">
                <p><i class="fas fa-tachometer-alt"></i> ${calculatedProductivity} м³/смену</p>
                <p><i class="fas fa-bolt"></i> ${this.formatPowerValue(equipment.power_consumption)} кВт</p>
                <p><i class="fas fa-ruler"></i> ${this.formatDimensionValue(equipment.width)}×${this.formatDimensionValue(equipment.length)}×${this.formatDimensionValue(equipment.height)} м</p>
                <p><i class="fas fa-ruble-sign"></i> ${priceDisplay}</p>
            </div>
        `;
        this.makeDraggable(div);
        workspace.appendChild(div);
        this.placedEquipment.push({placementId, equipmentId: equipment.id, element: div, x: safeX, y: safeY, equipment: equipment});
        // Поддерживаем nextPlacementId так, чтобы он всегда был больше любого существующего ID
        if (placementId >= this.nextPlacementId) this.nextPlacementId = placementId + 1;
        return div;
    }

    makeDraggable(element) {
        let isDragging = false;
        let startX, startY, initialX, initialY;
        const workspace = document.getElementById('workspaceArea');
        if (!workspace) return;
        
        element.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('delete-btn')) return;
            if (e.shiftKey) return;
            isDragging = true;
            element.classList.add('dragging');
            const workspaceRect = workspace.getBoundingClientRect();
            const currentX = parseFloat(element.style.left) || 0;
            const currentY = parseFloat(element.style.top) || 0;
            const clickX = (e.clientX - workspaceRect.left) / this.zoom;
            const clickY = (e.clientY - workspaceRect.top) / this.zoom;
            startX = clickX - currentX;
            startY = clickY - currentY;
            initialX = currentX;
            initialY = currentY;
            e.preventDefault();
            e.stopPropagation();
        });
        
        const updatePosition = (e) => {
            if (!isDragging) return;
            const workspaceRect = workspace.getBoundingClientRect();
            const cursorX = (e.clientX - workspaceRect.left) / this.zoom;
            const cursorY = (e.clientY - workspaceRect.top) / this.zoom;
            const edgePadding = this.getEdgePadding();
            const maxXRaw = this.workspaceWidth - (element.offsetWidth || 260) - edgePadding;
            const maxYRaw = this.workspaceHeight - (element.offsetHeight || 260) - edgePadding;
            const maxX = Math.max(edgePadding, maxXRaw);
            const maxY = Math.max(edgePadding, maxYRaw);
            let newX = cursorX - startX;
            let newY = cursorY - startY;
            const snapped = this.applySnap(newX, newY);
            newX = snapped.x;
            newY = snapped.y;
            newX = Math.max(edgePadding, Math.min(maxX, newX));
            newY = Math.max(edgePadding, Math.min(maxY, newY));
            element.style.left = `${newX}px`;
            element.style.top = `${newY}px`;
            const placedItem = this.placedEquipment.find(item => item.element === element);
            if (placedItem) {
                placedItem.x = newX;
                placedItem.y = newY;
            }
            if (this.connectionManager) {
                const placementId = parseInt(element.dataset.placementId, 10);
                if (!isNaN(placementId)) {
                    this.connectionManager.connections
                        .filter(conn => conn.fromId === placementId || conn.toId === placementId)
                        .forEach(conn => {
                            this.connectionManager.drawConnection(conn);
                        });
                }
            }
        };
        
        const onMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                element.classList.remove('dragging');
            }
        };
        
        document.addEventListener('mousemove', updatePosition);
        document.addEventListener('mouseup', onMouseUp);
        
        element._dragCleanup = () => {
            document.removeEventListener('mousemove', updatePosition);
            document.removeEventListener('mouseup', onMouseUp);
        };
    }

    removeEquipment(element) {
        const placementId = parseInt(element.dataset.placementId, 10);
        if (isNaN(placementId)) {
            console.error('Неверный ID экземпляра оборудования при удалении:', element.dataset.placementId);
            return;
        }
        if (this.connectionManager) {
            this.connectionManager.removeConnectionsForEquipment(placementId);
        }
        if (element._dragCleanup) {
            element._dragCleanup();
            element._dragCleanup = null;
        }
        this.placedEquipment = this.placedEquipment.filter(item => item.placementId !== placementId);
        element.remove();
    }

    clearWorkspace(askConfirm = true) {
        if (askConfirm && !confirm('Очистить рабочую область?')) return;
        const workspace = document.getElementById('workspaceArea');
        workspace.querySelectorAll('.placed-equipment').forEach(el => {
            if (el._dragCleanup) {
                el._dragCleanup();
                el._dragCleanup = null;
            }
            el.remove();
        });
        if (this.connectionManager) {
            this.connectionManager.clearAllConnections();
        }
        this.placedEquipment = [];
        this.selectedPlacementId = null;
    }

    serializeProject() {
        return {
            version: 1,
            externalId: window.__leskomProjectId || null,
            title: this.getProjectTitle(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            view: {
                zoom: this.zoom,
                panX: this.panX,
                panY: this.panY
            },
            placed: this.placedEquipment.map(p => ({
                placementId: p.placementId,
                equipmentId: p.equipmentId,
                leskomSlug: p.equipment?.leskomSlug || null,
                x: p.x,
                y: p.y
            })),
            connections: (this.connectionManager?.connections || []).map(c => ({
                fromId: c.fromId,
                toId: c.toId
            }))
        };
    }

    saveProjectToLocalStorage() {
        try {
            const project = this.serializeProject();
            localStorage.setItem(this.projectStorageKey, JSON.stringify(project));
            this.showNotification('Проект сохранён', 'success');
        } catch (e) {
            console.error('Ошибка сохранения проекта:', e);
            this.showNotification('Не удалось сохранить проект: ' + (e?.message || e), 'error');
        }
    }

    loadProjectFromLocalStorage() {
        try {
            const raw = localStorage.getItem(this.projectStorageKey);
            if (!raw) {
                this.showNotification('Сохранённый проект не найден', 'warning');
                return;
            }
            const project = JSON.parse(raw);
            this.loadProjectFromObject(project);
            this.showNotification('Проект загружен', 'success');
        } catch (e) {
            console.error('Ошибка загрузки проекта:', e);
            this.showNotification('Не удалось загрузить проект: ' + (e?.message || e), 'error');
        }
    }

    loadProjectFromObject(project) {
        if (!project || (project.version !== 1 && project.version !== 2)) {
            throw new Error('Неподдерживаемый формат проекта');
        }
        if (!Array.isArray(project.placed)) {
            throw new Error('Некорректный проект: отсутствует placed');
        }

        // Сбрасываем поле без подтверждения
        this.clearWorkspace(false);

        // Восстанавливаем вид
        if (project.view && typeof project.view.zoom === 'number') {
            this.zoom = project.view.zoom;
            this.panX = project.view.panX || 0;
            this.panY = project.view.panY || 0;
            this.updateTransform();
            const zoomLabel = document.getElementById('zoomLevel');
            if (zoomLabel) zoomLabel.textContent = Math.round(this.zoom * 100) + '%';
        }

        const lookup = this.buildEquipmentLookup();
        let maxPlacementId = 0;
        let missing = 0;
        project.placed.forEach(p => {
            const eq = this.resolveEquipmentForPlacement(p, lookup);
            if (!eq) {
                missing += 1;
                return;
            }
            const placementId = Number(p.placementId);
            const x = Number(p.x);
            const y = Number(p.y);
            if (!Number.isFinite(placementId) || !Number.isFinite(x) || !Number.isFinite(y)) return;
            this.placeEquipmentInstance(eq, x, y, placementId);
            if (placementId > maxPlacementId) maxPlacementId = placementId;
        });
        this.nextPlacementId = Math.max(this.nextPlacementId, maxPlacementId + 1);

        if (missing > 0) {
            this.showNotification(
                `Не найдено в каталоге: ${missing} из ${project.placed.length} станков`,
                'warning'
            );
        }

        // Восстанавливаем соединения
        if (this.connectionManager && Array.isArray(project.connections)) {
            const restore = typeof this.restoreConnections === 'function'
                ? this.restoreConnections(project.connections)
                : project.connections.forEach(c => {
                    const fromId = Number(c.fromId);
                    const toId = Number(c.toId);
                    if (!Number.isFinite(fromId) || !Number.isFinite(toId)) return;
                    this.connectionManager.createConnection(fromId, toId);
                });
            if (restore && typeof restore.then === 'function') {
                restore.catch(err => console.error('Ошибка восстановления связей:', err));
            }
        }
    }

    exportProjectToFile() {
        try {
            const project = this.serializeProject();
            const json = JSON.stringify(project, null, 2);
            const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `project_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            this.showNotification('Проект экспортирован', 'success');
        } catch (e) {
            console.error('Ошибка экспорта проекта:', e);
            this.showNotification('Не удалось экспортировать проект: ' + (e?.message || e), 'error');
        }
    }

    importProjectFromFile(event) {
        const input = event?.target;
        const file = input?.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const project = JSON.parse(String(reader.result || ''));
                this.loadProjectFromObject(project);
                this.showNotification('Проект импортирован', 'success');
            } catch (e) {
                console.error('Ошибка импорта проекта:', e);
                this.showNotification('Не удалось импортировать проект: ' + (e?.message || e), 'error');
            } finally {
                // чтобы можно было импортировать тот же файл повторно
                input.value = '';
            }
        };
        reader.onerror = () => {
            this.showNotification('Не удалось прочитать файл проекта', 'error');
            input.value = '';
        };
        reader.readAsText(file);
    }

    updateGridByZoom() {
        const workspace = document.getElementById('workspaceArea');
        const grid = document.getElementById('gridOverlay');
        const { major, minor, minorCm } = this.getGridSizes();
        this.snapSize = minor;
        this.updateGridCellSizeDisplay(minorCm);
        const linePx = this.zoom <= 0.6 ? 3 : 1;
        const majorAlpha = this.zoom <= 0.6 ? 0.35 : 0.22;
        const minorAlpha = this.zoom <= 0.6 ? 0.18 : 0.10;
        if (workspace) {
            workspace.style.backgroundSize = `${minor}px ${minor}px`;
            workspace.style.backgroundImage = `radial-gradient(circle at ${linePx}px ${linePx}px, rgba(34, 139, 34, 0.18) ${linePx}px, transparent 0)`;
        }
        if (!grid) return;
        grid.classList.add('active');
        grid.style.backgroundImage = `
            linear-gradient(rgba(34, 139, 34, ${majorAlpha}) ${linePx}px, transparent ${linePx}px),
            linear-gradient(90deg, rgba(34, 139, 34, ${majorAlpha}) ${linePx}px, transparent ${linePx}px),
            linear-gradient(rgba(34, 139, 34, ${minorAlpha}) ${linePx}px, transparent ${linePx}px),
            linear-gradient(90deg, rgba(34, 139, 34, ${minorAlpha}) ${linePx}px, transparent ${linePx}px)
        `;
        grid.style.backgroundSize = `${major}px ${major}px, ${major}px ${major}px, ${minor}px ${minor}px, ${minor}px ${minor}px`;
    }

    getEquipmentCardSize(equipment) {
        const widthM = this.parseDimensionMeters(equipment?.width);
        const lengthM = this.parseDimensionMeters(equipment?.length);
        const fallbackW = 260;
        const fallbackH = 260;
        if (!Number.isFinite(widthM) || !Number.isFinite(lengthM) || widthM <= 0 || lengthM <= 0) {
            return { widthPx: fallbackW, lengthPx: fallbackH };
        }

        const widthCm = widthM * 100;
        const lengthCm = lengthM * 100;
        const widthPxRaw = Math.round(widthCm * this.cmToPx);
        const lengthPxRaw = Math.round(lengthCm * this.cmToPx);
        const baseSnapPx = Math.max(1, Math.round(10 * this.cmToPx)); // база: 10 см
        // Минимальный визуальный размер карточки на поле:
        // реальные габариты сохраняем, но не даём карточкам становиться "иголками".
        const minSize = 220;
        const maxSize = 900;
        const snapToBase = (value) => Math.max(baseSnapPx, Math.round(value / baseSnapPx) * baseSnapPx);
        return {
            widthPx: Math.max(minSize, Math.min(maxSize, snapToBase(widthPxRaw))),
            lengthPx: Math.max(minSize, Math.min(maxSize, snapToBase(lengthPxRaw)))
        };
    }

    getZoomPivot() {
        const workspace = document.getElementById('workspaceArea');
        if (!workspace) {
            return { x: null, y: null };
        }

        const rect = workspace.getBoundingClientRect();

        // Если есть последняя позиция курсора и она внутри рабочей области — зум вокруг неё
        if (this.lastPointerX !== null && this.lastPointerY !== null) {
            if (this.lastPointerX >= rect.left && this.lastPointerX <= rect.right &&
                this.lastPointerY >= rect.top && this.lastPointerY <= rect.bottom) {
                return { x: this.lastPointerX, y: this.lastPointerY };
            }
        }

        // Иначе — вокруг центра видимой части рабочей области
        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
    }

    setZoom(newZoom, pivotClientX = null, pivotClientY = null) {
        const workspace = document.getElementById('workspaceArea');
        if (!workspace) {
            this.zoom = Math.max(0.5, Math.min(3.0, newZoom));
            this.updateTransform();
            const zoomLabel = document.getElementById('zoomLevel');
            if (zoomLabel) zoomLabel.textContent = Math.round(this.zoom * 100) + '%';
            return;
        }

        const oldZoom = this.zoom || 1.0;
        const clampedZoom = Math.max(0.5, Math.min(3.0, newZoom));

        // Если не передана точка поворота (кнопки +/-), просто меняем масштаб как раньше
        if (pivotClientX === null || pivotClientY === null) {
            this.zoom = clampedZoom;
            this.updateTransform();
            const zoomLabel = document.getElementById('zoomLevel');
            if (zoomLabel) zoomLabel.textContent = Math.round(this.zoom * 100) + '%';
            return;
        }

        const rect = workspace.getBoundingClientRect();
        // Смещение курсора относительно текущего прямоугольника рабочей области
        const offsetX = pivotClientX - rect.left;
        const offsetY = pivotClientY - rect.top;

        // Мировые координаты точки под курсором до изменения зума
        const worldX = offsetX / oldZoom;
        const worldY = offsetY / oldZoom;

        // Экранные координаты этой точки относительно контейнера (без знания containerLeft)
        const screenX = offsetX + this.panX;
        const screenY = offsetY + this.panY;

        // Применяем новый масштаб
        this.zoom = clampedZoom;

        // Пересчитываем pan так, чтобы та же мировая точка осталась под курсором
        this.panX = screenX - worldX * this.zoom;
        this.panY = screenY - worldY * this.zoom;

        this.updateTransform();
        this.updateGridByZoom();
        const zoomLabel = document.getElementById('zoomLevel');
        if (zoomLabel) zoomLabel.textContent = Math.round(this.zoom * 100) + '%';
    }

    updateTransform() {
        const workspace = document.getElementById('workspaceArea');
        if (workspace) {
            workspace.style.width = `${this.workspaceWidth}px`;
            workspace.style.minWidth = `${this.workspaceWidth}px`;
            workspace.style.height = `${this.workspaceHeight}px`;
        }
        this.clampPanToBounds();
        workspace.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
        workspace.style.transformOrigin = 'top left';
        this.updateBoundaryMarkers();
    }

    centerWorkspace() {
        const workspace = document.getElementById('workspaceArea');
        if (!workspace) return;
        
        const container = workspace.parentElement;
        if (!container) return;
        
        const wsWidth = this.workspaceWidth;
        const wsHeight = this.workspaceHeight;
        const containerWidth = container.offsetWidth || window.innerWidth;
        const containerHeight = container.offsetHeight || window.innerHeight;
        
        // Центр рабочей области (сетчатой области)
        const centerX = wsWidth / 2;  // 4000
        const centerY = wsHeight / 2;  // 3000
        
        // Центрируем вид так, чтобы центр рабочей области был в центре видимого окна
        // panX и panY - это смещение рабочей области, поэтому нужно вычесть центр контейнера
        this.panX = (containerWidth / 2) - (centerX * this.zoom);
        this.panY = (containerHeight / 2) - (centerY * this.zoom);
        
        this.updateTransform();
    }

    calculateProduction() {
        if (this.placedEquipment.length === 0) {
            alert('Разместите оборудование для расчета');
            return;
        }
        
        let totalProduction = 0;
        let totalPower = 0;
        let totalCost = 0;
        let equipmentCostUnknownCount = 0;
        let totalInstallationCost = 0;
        let totalArea = 0;
        let totalDailyOperationCost = 0;
        let totalDailyMaintenanceCost = 0;
        let totalInputMaterials = {};
        let totalOutputMaterials = {};
        const equipmentList = [];
        const priceWarnings = []; // Предупреждения о ценах по запросу
        const connectionsInfo = []; // Информация о потоках материалов
        
        // Находим узкое место (минимальная производительность)
        let bottleneckProductivity = Infinity;
        let bottleneckEquipment = null;
        
        this.placedEquipment.forEach(item => {
            const eq = item.equipment;
            if (
                eq.catalogType === 'conveyor'
                || eq.catalogType === 'log_feed'
                || window.CatalogMeta?.isConveyorLike?.(eq)
                || window.CatalogMeta?.isLogFeedLike?.(eq)
            ) {
                return;
            }
            const production = (eq.productivity || 0) * (eq.efficiency || 0.85);
            totalProduction += production;
            totalPower += eq.power_consumption || 0;
            
            const priceOnRequest = eq.cost === 0 || (eq.price && eq.price.includes('Цена по запросу'));
            if (priceOnRequest) {
                priceWarnings.push({
                    name: eq.name,
                    price: eq.price || 'Цена по запросу'
                });
                equipmentCostUnknownCount += 1;
            } else {
                totalCost += eq.cost || 0;
            }
            totalInstallationCost += eq.installation_cost || 0;
            const widthM = this.parseDimensionMeters(eq.width);
            const lengthM = this.parseDimensionMeters(eq.length);
            if (Number.isFinite(widthM) && Number.isFinite(lengthM)) {
                totalArea += widthM * lengthM;
            }
            totalDailyOperationCost += eq.daily_operation_cost || 0;
            totalDailyMaintenanceCost += eq.daily_maintenance_cost || 0;
            
            // Узкое место
            if (production > 0 && production < bottleneckProductivity) {
                bottleneckProductivity = production;
                bottleneckEquipment = eq.name;
            }
            
            // Собираем материалы
            if (eq.input_materials && Array.isArray(eq.input_materials)) {
                eq.input_materials.forEach(mat => {
                    const matName = mat.name || 'Сырье';
                    totalInputMaterials[matName] = (totalInputMaterials[matName] || 0) + (mat.quantity || 0) * production;
                });
            }
            
            if (eq.output_materials && Array.isArray(eq.output_materials)) {
                eq.output_materials.forEach(mat => {
                    const matName = mat.name || 'Продукция';
                    totalOutputMaterials[matName] = (totalOutputMaterials[matName] || 0) + (mat.quantity || 0) * production;
                });
            }
            
            const widthDisplay = this.formatDimensionValue(eq.width);
            const lengthDisplay = this.formatDimensionValue(eq.length);
            const heightDisplay = this.formatDimensionValue(eq.height);
            equipmentList.push({
                name: eq.name,
                production: production,
                power: eq.power_consumption || 0,
                cost: priceOnRequest ? null : (eq.cost || 0),
                price_on_request: priceOnRequest,
                installation_cost: eq.installation_cost || 0,
                speed: eq.speed || 1.0,
                cycle_time: eq.cycle_time || 60,
                daily_operation: eq.daily_operation_cost || 0,
                daily_maintenance: eq.daily_maintenance_cost || 0,
                dimensions: `${widthDisplay}×${lengthDisplay}×${heightDisplay} м`
            });
        });
        
        const totalDailyCosts = totalDailyOperationCost + totalDailyMaintenanceCost;
        const totalAllCosts = totalCost + totalInstallationCost;
        const connectionsCount = this.connectionManager ? this.connectionManager.connections.length : 0;
        
        // Собираем информацию о потоках материалов из соединений
        if (this.connectionManager && this.connectionManager.connections.length > 0) {
            this.connectionManager.connections.forEach(conn => {
                const fromEq = this.placedEquipment.find(p => p.placementId === conn.fromId);
                const toEq = this.placedEquipment.find(p => p.placementId === conn.toId);
                if (fromEq && toEq) {
                    const fromProduction = (fromEq.equipment.productivity || 0) * (fromEq.equipment.efficiency || 0.85);
                    const toProduction = (toEq.equipment.productivity || 0) * (toEq.equipment.efficiency || 0.85);
                    const throughput = Math.min(fromProduction, toProduction);
                    connectionsInfo.push({
                        from: fromEq.equipment.name,
                        to: toEq.equipment.name,
                        conveyor: conn.conveyorName || null,
                        throughput: throughput
                    });
                }
            });
        }
        
        // Рассчитываем окупаемость
        const roiDays = totalDailyCosts > 0 ? Math.round(totalCost / totalDailyCosts) : 0;
        
        const calculations = {
            final_production: totalProduction,
            total_energy: totalPower,
            equipment_cost_total: totalCost,
            equipment_cost_unknown_count: equipmentCostUnknownCount,
            total_cost: totalCost,
            installation_cost_total: totalInstallationCost,
            conveyor_cost_total: 0,
            total_cost_with_installation: totalAllCosts,
            line_total_cost: totalAllCosts,
            total_area: totalArea,
            recommended_area: totalArea * 1.5, // Площадь с учетом проходов
            equipment_count: this.placedEquipment.length,
            daily_operation_cost: totalDailyOperationCost,
            daily_maintenance_cost: totalDailyMaintenanceCost,
            daily_total_costs: totalDailyCosts,
            bottleneck_equipment: bottleneckEquipment || 'Нет',
            bottleneck_productivity: bottleneckProductivity === Infinity ? 0 : bottleneckProductivity,
            connections_count: connectionsCount,
            connections_info: connectionsInfo,
            input_materials: totalInputMaterials,
            output_materials: totalOutputMaterials,
            equipment_list: equipmentList,
            price_warnings: priceWarnings,
            roi_days: roiDays
        };
        
        window.lastCalculations = calculations;
        document.getElementById('calculationChoiceModal').style.display = 'block';
    }

    showNotification(message, type = 'info') {
        if (this.connectionManager) {
            this.connectionManager.showNotification(message, type);
        }
    }
}

function isStaffHowToAudience() {
    if (window.__leskomConfiguratorStaff === true) return true;
    const q = new URLSearchParams(window.location.search);
    return q.get('staff') === '1' || q.get('staff') === 'true';
}

function mountHowToUseContent() {
    const tplId = isStaffHowToAudience() ? 'howToUseTemplateStaff' : 'howToUseTemplateUser';
    const tpl = document.getElementById(tplId);
    if (!tpl) return;
    const html = tpl.innerHTML;
    const modalBody = document.getElementById('howToUseModalBody');
    const instructionContent = document.getElementById('instructionContent');
    if (modalBody) modalBody.innerHTML = html;
    if (instructionContent) instructionContent.innerHTML = html;
}
window.mountHowToUseContent = mountHowToUseContent;

function toggleInstruction() {
    document.getElementById('connectionInstruction').classList.toggle('collapsed');
}

function closeCalculationChoiceModal() {
    document.getElementById('calculationChoiceModal').style.display = 'none';
}

function closeCalculationsViewModal() {
    document.getElementById('calculationsViewModal').style.display = 'none';
}

function formatCalcMoney(amount) {
    return `${Number(amount || 0).toLocaleString('ru-RU')} руб`;
}

function getEquipmentCostTotal(calc) {
    return Number(calc?.equipment_cost_total ?? calc?.total_cost) || 0;
}

function formatEquipmentCostSummary(calc, { html = true } = {}) {
    const total = getEquipmentCostTotal(calc);
    const unknown = Number(calc?.equipment_cost_unknown_count) || 0;
    if (unknown > 0 && total === 0) {
        return html ? '<span style="color:#856404;">Цена по запросу</span>' : 'Цена по запросу';
    }
    if (unknown > 0) {
        const note = ` (+ ${unknown} по запросу)`;
        return html
            ? `${formatCalcMoney(total)} <span style="font-size:0.85em;color:#856404;">${note}</span>`
            : `${formatCalcMoney(total)}${note}`;
    }
    return formatCalcMoney(total);
}

function formatEquipmentRowCost(eq) {
    if (eq.price_on_request || eq.cost == null) {
        return '<span style="color:#856404;">По запросу</span>';
    }
    return formatCalcMoney(eq.cost);
}

function getConveyorCostTotal(calc) {
    return Number(calc?.conveyor_cost_total) || 0;
}

function formatConveyorCostSummary(calc, { html = true } = {}) {
    const list = calc?.conveyor_list;
    if (!list || list.length === 0) {
        return html ? '—' : '—';
    }
    const total = getConveyorCostTotal(calc);
    const unknown = Number(calc?.conveyor_cost_unknown_count) || 0;
    if (unknown > 0 && total === 0) {
        return html ? '<span style="color:#856404;">Цена по запросу</span>' : 'Цена по запросу';
    }
    if (unknown > 0) {
        const note = ` (+ ${unknown} по запросу)`;
        return html
            ? `${formatCalcMoney(total)} <span style="font-size:0.85em;color:#856404;">${note}</span>`
            : `${formatCalcMoney(total)}${note}`;
    }
    return formatCalcMoney(total);
}

function formatConveyorRowCost(cv) {
    if (cv.price_on_request || cv.cost == null) {
        return '<span style="color:#856404;">По запросу</span>';
    }
    return formatCalcMoney(cv.cost);
}

function getLogFeedCostTotal(calc) {
    return Number(calc?.log_feed_cost_total) || 0;
}

function formatLogFeedCostSummary(calc, { html = true } = {}) {
    const list = calc?.log_feed_list;
    if (!list || list.length === 0) {
        return html ? '—' : '—';
    }
    const total = getLogFeedCostTotal(calc);
    const unknown = Number(calc?.log_feed_cost_unknown_count) || 0;
    if (unknown > 0 && total === 0) {
        return html ? '<span style="color:#856404;">Цена по запросу</span>' : 'Цена по запросу';
    }
    if (unknown > 0) {
        const note = ` (+ ${unknown} по запросу)`;
        return html
            ? `${formatCalcMoney(total)} <span style="font-size:0.85em;color:#856404;">${note}</span>`
            : `${formatCalcMoney(total)}${note}`;
    }
    return formatCalcMoney(total);
}

function formatLogFeedRowCost(lf) {
    if (lf.price_on_request || lf.cost == null) {
        return '<span style="color:#856404;">По запросу</span>';
    }
    return formatCalcMoney(lf.cost);
}

function renderCostTableSection(title, columns, rows, footerLabel, footerValue) {
    return `
        <div class="calc-section" style="margin-bottom: 2rem;">
            <h4 style="margin-bottom: 1rem; color: #5d4e37;">${title}</h4>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                    <thead>
                        <tr style="background: #8b6f47; color: white;">
                            ${columns.map(col => `<th style="padding: 0.75rem; text-align: ${col.align || 'left'}; border: 1px solid #ddd;">${col.label}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                    <tfoot>
                        <tr style="background: #e8dfd0; font-weight: 700;">
                            <td style="padding: 0.75rem; border: 1px solid #ddd;" colspan="${columns.length - 1}">${footerLabel}</td>
                            <td style="padding: 0.75rem; text-align: right; border: 1px solid #ddd;">${footerValue}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    `;
}

function viewCalculations() {
    if (!window.lastCalculations) return;
    closeCalculationChoiceModal();
    const content = document.getElementById('calculationsViewContent');
    const calc = window.lastCalculations;
    
    let html = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
            <div class="calculation-item">
                <div class="label">Производительность:</div>
                <div class="value">${calc.final_production.toFixed(2)} м³/смену</div>
            </div>
            <div class="calculation-item">
                <div class="label">Энергопотребление:</div>
                <div class="value">${calc.total_energy.toFixed(2)} кВт</div>
            </div>
            <div class="calculation-item">
                <div class="label">Стоимость оборудования:</div>
                <div class="value">${formatEquipmentCostSummary(calc)}</div>
            </div>
            <div class="calculation-item">
                <div class="label">Стоимость установки:</div>
                <div class="value">${formatCalcMoney(calc.installation_cost_total)}</div>
            </div>
            <div class="calculation-item">
                <div class="label">Общая стоимость:</div>
                <div class="value">${formatCalcMoney(calc.line_total_cost ?? calc.total_cost_with_installation)}</div>
            </div>
            <div class="calculation-item">
                <div class="label">Площадь:</div>
                <div class="value">${calc.total_area.toFixed(2)} м²</div>
            </div>
            <div class="calculation-item">
                <div class="label">Количество станков:</div>
                <div class="value">${calc.equipment_count}</div>
            </div>
            <div class="calculation-item">
                <div class="label">Соединений:</div>
                <div class="value">${calc.connections_count > 0 ? calc.connections_count : 'Нет соединений'}</div>
            </div>
        </div>
    `;

    if (calc.price_warnings && calc.price_warnings.length > 0) {
        html += `
            <div class="calc-section" style="margin-bottom: 1.5rem; padding: 1rem; background: #f8d7da; border-radius: 8px; border-left: 4px solid #dc3545;">
                <h4 style="margin-bottom: 0.5rem; color: #721c24;">Цены по запросу</h4>
                <ul style="margin: 0; padding-left: 1.25rem; color: #721c24;">
                    ${calc.price_warnings.map(w => `<li>${escapeReportHtml(w.name)}</li>`).join('')}
                </ul>
            </div>
        `;
    }
    
    if (calc.bottleneck_equipment && calc.bottleneck_equipment !== 'Нет') {
        html += `
            <div class="calc-section" style="margin-bottom: 2rem; padding: 1rem; background: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107;">
                <h4 style="margin-bottom: 0.5rem; color: #856404;">⚠️ Узкое место производства</h4>
                <p style="margin: 0;"><strong>${calc.bottleneck_equipment}</strong> - ${calc.bottleneck_productivity.toFixed(2)} м³/смену</p>
            </div>
        `;
    }
    
    if (Object.keys(calc.input_materials || {}).length > 0) {
        html += `
            <div class="calc-section" style="margin-bottom: 2rem;">
                <h4 style="margin-bottom: 1rem; color: #5d4e37;">Потребление сырья (м³/смену)</h4>
                <ul style="list-style: none; padding: 0;">
                    ${Object.entries(calc.input_materials).map(([name, qty]) => `
                        <li style="padding: 0.5rem; background: #f8f9fa; margin-bottom: 0.5rem; border-radius: 4px;">
                            <strong>${name}:</strong> ${qty.toFixed(2)} м³/смену
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }
    
    if (Object.keys(calc.output_materials || {}).length > 0) {
        html += `
            <div class="calc-section" style="margin-bottom: 2rem;">
                <h4 style="margin-bottom: 1rem; color: #5d4e37;">Выпуск продукции (м³/смену)</h4>
                <ul style="list-style: none; padding: 0;">
                    ${Object.entries(calc.output_materials).map(([name, qty]) => `
                        <li style="padding: 0.5rem; background: #d4edda; margin-bottom: 0.5rem; border-radius: 4px;">
                            <strong>${name}:</strong> ${qty.toFixed(2)} м³/смену
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }
    
    // Информация о связях между станками
    if (calc.connections_info && calc.connections_info.length > 0) {
        html += `
            <div class="calc-section" style="margin-bottom: 2rem;">
                <h4 style="margin-bottom: 1rem; color: #5d4e37;">Связи между станками</h4>
                <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px; border-left: 4px solid #28a745;">
                    <p style="margin: 0 0 0.5rem 0; font-weight: bold; color: #28a745;">✓ Найдено ${calc.connections_count} соединений:</p>
                    <ul style="list-style: none; padding: 0; margin: 0;">
                        ${calc.connections_info.map((conn, idx) => `
                            <li style="padding: 0.5rem; background: white; margin-bottom: 0.5rem; border-radius: 4px; border-left: 3px solid #28a745;">
                                <strong>${idx + 1}.</strong> ${conn.from} → ${conn.to}
                                ${conn.conveyor ? `<br><span style="color:#e67e22;font-size:0.85em;"><i class="fas fa-arrows-alt-h"></i> ${conn.conveyor}</span>` : ''}
                                <span style="color: #666; font-size: 0.9em;">(${conn.throughput.toFixed(2)} м³/смену)</span>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            </div>
        `;
    } else if (calc.equipment_count > 1) {
        html += `
            <div class="calc-section" style="margin-bottom: 2rem;">
                <h4 style="margin-bottom: 1rem; color: #5d4e37;">Связи между станками</h4>
                <div style="background: #fff3cd; padding: 1rem; border-radius: 8px; border-left: 4px solid #ffc107;">
                    <p style="margin: 0; color: #856404;">
                        <strong>⚠ Соединений нет.</strong> Для создания производственной линии рекомендуется связать станки между собой.
                    </p>
                </div>
            </div>
        `;
    }

    const equipmentRows = calc.equipment_list.map((eq, idx) => `
        <tr style="background: ${idx % 2 === 0 ? '#fff' : '#f8f9fa'};">
            <td style="padding: 0.75rem; border: 1px solid #ddd;"><strong>${escapeReportHtml(eq.name)}</strong></td>
            <td style="padding: 0.75rem; text-align: right; border: 1px solid #ddd;">${formatEquipmentRowCost(eq)}</td>
        </tr>
    `).join('');

    html += renderCostTableSection(
        'Детальная информация по оборудованию',
        [
            { label: 'Станок', align: 'left' },
            { label: 'Стоимость (руб)', align: 'right' }
        ],
        equipmentRows,
        'Итого по станкам',
        formatEquipmentCostSummary(calc)
    );

    if (calc.log_feed_list && calc.log_feed_list.length > 0) {
        const logFeedRows = calc.log_feed_list.map((lf, idx) => `
            <tr style="background: ${idx % 2 === 0 ? '#fff' : '#f8f9fa'};">
                <td style="padding: 0.75rem; border: 1px solid #ddd;"><strong>${escapeReportHtml(lf.name)}</strong></td>
                <td style="padding: 0.75rem; text-align: right; border: 1px solid #ddd;">${formatLogFeedRowCost(lf)}</td>
            </tr>
        `).join('');

        html += renderCostTableSection(
            'Подача бревна (на схеме)',
            [
                { label: 'Оборудование', align: 'left' },
                { label: 'Стоимость (руб)', align: 'right' }
            ],
            logFeedRows,
            'Итого по подаче бревна',
            formatLogFeedCostSummary(calc)
        );
    }

    if (calc.conveyor_list && calc.conveyor_list.length > 0) {
        const conveyorRows = calc.conveyor_list.map((cv, idx) => `
            <tr style="background: ${idx % 2 === 0 ? '#fff' : '#f8f9fa'};">
                <td style="padding: 0.75rem; border: 1px solid #ddd;"><strong>${escapeReportHtml(cv.name)}</strong></td>
                <td style="padding: 0.75rem; border: 1px solid #ddd; color: #666;">${escapeReportHtml(cv.route || `${cv.from} → ${cv.to}`)}</td>
                <td style="padding: 0.75rem; text-align: right; border: 1px solid #ddd;">${formatConveyorRowCost(cv)}</td>
            </tr>
        `).join('');

        html += renderCostTableSection(
            'Конвейеры на связях',
            [
                { label: 'Конвейер', align: 'left' },
                { label: 'Маршрут', align: 'left' },
                { label: 'Стоимость (руб)', align: 'right' }
            ],
            conveyorRows,
            'Итого по конвейерам',
            formatConveyorCostSummary(calc)
        );
    }
    
    content.innerHTML = html;
    document.getElementById('calculationsViewModal').style.display = 'block';
}

function escapeReportHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function pdfSectionTitle(title, compact = true) {
    const fs = compact ? 10 : 13;
    const mb = compact ? 3 : 6;
    return `<h2 style="font-size:${fs}px;color:#8b6f47;margin:0 0 ${mb}px;border-bottom:1px solid #8b6f47;padding-bottom:2px;font-weight:700;">${escapeReportHtml(title)}</h2>`;
}

function pdfTableHeader(cells) {
    return `<tr style="background:#8b6f47;color:white;">${cells.map(cell => `<th style="padding:3px 5px;border:1px solid #ccc;font-size:8.5px;font-weight:600;">${cell}</th>`).join('')}</tr>`;
}

function pdfTableRow(cells, idx, alignments = []) {
    const bg = idx % 2 === 0 ? '#fff' : '#f8f9fa';
    return `<tr style="background:${bg};">${cells.map((cell, i) => {
        const align = alignments[i] || 'left';
        return `<td style="padding:2px 4px;border:1px solid #ddd;text-align:${align};word-break:break-word;overflow-wrap:anywhere;vertical-align:top;font-size:8.5px;line-height:1.25;">${cell}</td>`;
    }).join('')}</tr>`;
}

const PDF_A4_WIDTH_PX = 794;
const PDF_PADDING_PX = 22;
const PDF_PAGE_MAX_HEIGHT_PX = Math.floor(((297 - 14) / 25.4) * 96);
const PDF_FONT_STACK = "'Segoe UI', Arial, 'Helvetica Neue', sans-serif";

function pdfWrapSection(inner, compact = true) {
    const mb = compact ? 4 : 8;
    return `<div class="pdf-section" style="margin-bottom:${mb}px;">${inner}</div>`;
}

function pdfWrapSectionRow(sections) {
    return pdfWrapSection(`<div style="display:flex;gap:6px;align-items:flex-start;">${sections.join('')}</div>`);
}

function pdfTableOpen(colWidths = []) {
    const cols = colWidths.length
        ? `<colgroup>${colWidths.map(w => `<col style="width:${w}">`).join('')}</colgroup>`
        : '';
    return `<table style="width:100%;border-collapse:collapse;table-layout:fixed;">${cols}`;
}

function pdfPageFooter(pageNum, totalPages) {
    if (totalPages <= 1) return '';
    return `<div style="margin-top:6px;padding-top:4px;border-top:1px solid #e0e0e0;text-align:center;font-size:8px;color:#888;font-family:${PDF_FONT_STACK};">Страница ${pageNum} из ${totalPages}</div>`;
}

function chunkRows(rows, size) {
    const chunks = [];
    for (let i = 0; i < rows.length; i += size) {
        chunks.push(rows.slice(i, i + size));
    }
    return chunks;
}

function buildPdfReportSections(calc) {
    const hasPriceRequest = calc.price_warnings && calc.price_warnings.length > 0;
    const equipmentTotal = getEquipmentCostTotal(calc);
    const equipmentCostDisplay = formatEquipmentCostSummary(calc, { html: false });
    const lineTotal = Number(calc.line_total_cost ?? calc.total_cost_with_installation) || 0;
    const totalWithInstallDisplay = hasPriceRequest && equipmentTotal === 0
        ? 'Цена по запросу'
        : formatCalcMoney(lineTotal);
    const sections = [];
    const logFeedCount = calc.log_feed_count || (calc.log_feed_list?.length ?? 0);

    sections.push(pdfWrapSection(`
        <div style="text-align:center;margin-bottom:2px;">
            <h1 style="font-size:13px;color:#5d4e37;margin:0 0 2px;font-family:${PDF_FONT_STACK};">Отчёт о расчёте производственного цеха</h1>
            <p style="font-size:7.5px;color:#666;margin:0;font-family:${PDF_FONT_STACK};">Дата: ${escapeReportHtml(new Date().toLocaleString('ru-RU'))}</p>
        </div>
    `));

    sections.push(pdfWrapSection(`
        ${pdfSectionTitle('Основные показатели')}
        ${pdfTableOpen(['58%', '42%'])}
            ${pdfTableHeader(['<span style="text-align:left;display:block;">Показатель</span>', '<span style="text-align:right;display:block;">Значение</span>'])}
            ${pdfTableRow(['Производительность линии', `${Number(calc.final_production || 0).toFixed(2)} м³/смену`], 0, ['left', 'right'])}
            ${pdfTableRow(['Энергопотребление', `${Number(calc.total_energy || 0).toFixed(2)} кВт`], 1, ['left', 'right'])}
            ${pdfTableRow(['Станки', equipmentCostDisplay], 2, ['left', 'right'])}
            ${logFeedCount ? pdfTableRow(['Подача бревна', formatLogFeedCostSummary(calc, { html: false })], 3, ['left', 'right']) : ''}
            ${(calc.conveyor_count || 0) > 0 ? pdfTableRow(['Конвейеры на связях', formatConveyorCostSummary(calc, { html: false })], 4, ['left', 'right']) : ''}
            ${pdfTableRow(['Стоимость установки', formatCalcMoney(calc.installation_cost_total)], 5, ['left', 'right'])}
            ${pdfTableRow(['Общая стоимость', totalWithInstallDisplay], 6, ['left', 'right'])}
            ${pdfTableRow(['Площадь / с проходами', `${Number(calc.total_area || 0).toFixed(2)} / ${Math.round(Number(calc.recommended_area || calc.total_area * 1.5))} м²`], 7, ['left', 'right'])}
            ${pdfTableRow(['Станков / связей', `${calc.equipment_count || 0} / ${calc.connections_count > 0 ? calc.connections_count : '0'}`], 8, ['left', 'right'])}
        </table>
    `));

    if (calc.bottleneck_equipment && calc.bottleneck_equipment !== 'Нет') {
        sections.push(pdfWrapSection(`
            ${pdfSectionTitle('Узкое место производства')}
            <p style="margin:0;color:#856404;font-size:8.5px;line-height:1.3;font-family:${PDF_FONT_STACK};"><strong>${escapeReportHtml(calc.bottleneck_equipment)}</strong> — ${Number(calc.bottleneck_productivity || 0).toFixed(2)} м³/смену</p>
        `));
    }

    const sideBlocks = [];

    if (calc.input_materials && Object.keys(calc.input_materials).length > 0) {
        const matRows = Object.entries(calc.input_materials).map(([name, qty], idx) => pdfTableRow([
            escapeReportHtml(name),
            Number(qty || 0).toFixed(2)
        ], idx, ['left', 'right'])).join('');
        sideBlocks.push(`<div style="flex:1;min-width:0;">${pdfSectionTitle('Сырьё, м³/смену')}
            ${pdfTableOpen(['62%', '38%'])}
            ${pdfTableHeader(['Материал', '<span style="text-align:right;display:block;">Кол-во</span>'])}
            ${matRows}</table></div>`);
    }

    if (calc.output_materials && Object.keys(calc.output_materials).length > 0) {
        const outRows = Object.entries(calc.output_materials).map(([name, qty], idx) => pdfTableRow([
            escapeReportHtml(name),
            Number(qty || 0).toFixed(2)
        ], idx, ['left', 'right'])).join('');
        sideBlocks.push(`<div style="flex:1;min-width:0;">${pdfSectionTitle('Продукция, м³/смену')}
            ${pdfTableOpen(['62%', '38%'])}
            ${pdfTableHeader(['Продукция', '<span style="text-align:right;display:block;">Кол-во</span>'])}
            ${outRows}</table></div>`);
    }

    if (sideBlocks.length) {
        sections.push(pdfWrapSectionRow(sideBlocks));
    }

    if (calc.connections_info && calc.connections_info.length > 0) {
        const connRows = calc.connections_info.map((conn, idx) => pdfTableRow([
            String(idx + 1),
            escapeReportHtml(conn.from),
            escapeReportHtml(conn.to),
            escapeReportHtml(conn.conveyor || '—'),
            Number(conn.throughput || 0).toFixed(2)
        ], idx, ['center', 'left', 'left', 'left', 'right'])).join('');
        sections.push(pdfWrapSection(`
            ${pdfSectionTitle('Связи между станками')}
            ${pdfTableOpen(['5%', '22%', '22%', '33%', '18%'])}
                ${pdfTableHeader(['№', 'От', 'К', 'Конвейер', '<span style="text-align:right;display:block;">м³/смену</span>'])}
                ${connRows}
            </table>
        `));
    }

    if (calc.log_feed_list && calc.log_feed_list.length > 0) {
        const lfRows = calc.log_feed_list.map((lf, idx) => pdfTableRow([
            String(idx + 1),
            escapeReportHtml(lf.name),
            lf.price_on_request || lf.cost == null ? 'По запросу' : Number(lf.cost).toLocaleString('ru-RU')
        ], idx, ['center', 'left', 'right'])).join('');
        const lfFooter = pdfTableRow(
            ['', '<strong>Итого</strong>', escapeReportHtml(formatLogFeedCostSummary(calc, { html: false }))],
            calc.log_feed_list.length,
            ['center', 'left', 'right']
        );
        sections.push(pdfWrapSection(`
            ${pdfSectionTitle('Подача бревна')}
            ${pdfTableOpen(['6%', '64%', '30%'])}
                ${pdfTableHeader(['№', 'Оборудование', '<span style="text-align:right;display:block;">руб</span>'])}
                ${lfRows}${lfFooter}
            </table>
        `));
    }

    if (calc.conveyor_list && calc.conveyor_list.length > 0) {
        const cvRows = calc.conveyor_list.map((cv, idx) => pdfTableRow([
            String(idx + 1),
            escapeReportHtml(cv.name),
            escapeReportHtml(cv.route || `${cv.from} → ${cv.to}`),
            cv.price_on_request || cv.cost == null
                ? 'По запросу'
                : Number(cv.cost).toLocaleString('ru-RU')
        ], idx, ['center', 'left', 'left', 'right'])).join('');
        const cvFooter = pdfTableRow(
            ['', '<strong>Итого</strong>', '', escapeReportHtml(formatConveyorCostSummary(calc, { html: false }))],
            calc.conveyor_list.length,
            ['center', 'left', 'left', 'right']
        );
        sections.push(pdfWrapSection(`
            ${pdfSectionTitle('Конвейеры на связях')}
            ${pdfTableOpen(['5%', '30%', '45%', '20%'])}
                ${pdfTableHeader(['№', 'Конвейер', 'Маршрут', '<span style="text-align:right;display:block;">руб</span>'])}
                ${cvRows}${cvFooter}
            </table>
        `));
    }

    if (calc.equipment_list && calc.equipment_list.length > 0) {
        const eqRows = calc.equipment_list.map((eq, idx) => pdfTableRow([
            String(idx + 1),
            escapeReportHtml(eq.name),
            `${Number(eq.production || 0).toFixed(2)}`,
            Number(eq.power || 0).toFixed(1),
            eq.price_on_request || eq.cost == null
                ? 'По запросу'
                : Number(eq.cost).toLocaleString('ru-RU')
        ], idx, ['center', 'left', 'right', 'right', 'right'])).join('');
        const eqFooter = pdfTableRow(
            ['', '<strong>Итого по станкам</strong>', '', '', escapeReportHtml(formatEquipmentCostSummary(calc, { html: false }))],
            calc.equipment_list.length,
            ['center', 'left', 'right', 'right', 'right']
        );
        sections.push(pdfWrapSection(`
            ${pdfSectionTitle('Станки')}
            ${pdfTableOpen(['5%', '38%', '19%', '14%', '24%'])}
                ${pdfTableHeader(['№', 'Станок', '<span style="text-align:right;display:block;">м³/смену</span>', '<span style="text-align:right;display:block;">кВт</span>', '<span style="text-align:right;display:block;">руб</span>'])}
                ${eqRows}${eqFooter}
            </table>
        `));
    }

    if (hasPriceRequest) {
        sections.push(pdfWrapSection(`
            ${pdfSectionTitle('Цены требуют уточнения')}
            ${calc.price_warnings.map(w => `<p style="margin:2px 0;color:#dc3545;font-size:8.5px;font-family:${PDF_FONT_STACK};">• ${escapeReportHtml(w.name)}: ${escapeReportHtml(w.price)}</p>`).join('')}
        `));
    }

    if (calc.roi_days > 0 && !hasPriceRequest) {
        sections.push(pdfWrapSection(`
            <p style="font-size:8.5px;color:#666;margin:0;font-family:${PDF_FONT_STACK};">Ориентировочная окупаемость: ${Number(calc.roi_days).toLocaleString('ru-RU')} дн.</p>
        `));
    }

    return sections;
}

function paginatePdfSections(sections) {
    const measureBox = document.createElement('div');
    measureBox.style.cssText = `position:fixed;left:0;top:0;transform:translateX(-200vw);width:${PDF_A4_WIDTH_PX}px;padding:${PDF_PADDING_PX}px;box-sizing:border-box;visibility:hidden;pointer-events:none;font-family:${PDF_FONT_STACK};font-size:8px;line-height:1.25;`;
    document.body.appendChild(measureBox);

    const measure = (html) => {
        measureBox.innerHTML = html;
        return measureBox.offsetHeight;
    };

    const fullHtml = sections.join('');
    const fullHeight = measure(fullHtml);
    if (fullHeight <= PDF_PAGE_MAX_HEIGHT_PX) {
        document.body.removeChild(measureBox);
        return [fullHtml];
    }

    const pages = [];
    let current = [];
    let currentHeight = 0;

    sections.forEach(section => {
        const sectionHeight = measure(section);
        if (currentHeight + sectionHeight > PDF_PAGE_MAX_HEIGHT_PX && current.length > 0) {
            pages.push(current.join(''));
            current = [];
            currentHeight = 0;
        }
        current.push(section);
        currentHeight += sectionHeight;
    });

    if (current.length) {
        pages.push(current.join(''));
    }

    document.body.removeChild(measureBox);
    return pages.length ? pages : [''];
}

async function renderPdfPageCanvas(pageHtml, pageNum, totalPages) {
    const tempDiv = document.createElement('div');
    tempDiv.style.cssText = `position:fixed;left:0;top:0;transform:translateX(-200vw);width:${PDF_A4_WIDTH_PX}px;padding:${PDF_PADDING_PX}px;background:#ffffff;font-family:${PDF_FONT_STACK};box-sizing:border-box;color:#1d3557;font-size:9px;line-height:1.3;`;
    tempDiv.innerHTML = pageHtml + pdfPageFooter(pageNum, totalPages);
    document.body.appendChild(tempDiv);

    try {
        return await html2canvas(tempDiv, {
            scale: 1.6,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff',
            width: PDF_A4_WIDTH_PX,
            height: tempDiv.scrollHeight,
            windowWidth: PDF_A4_WIDTH_PX,
            windowHeight: tempDiv.scrollHeight
        });
    } finally {
        document.body.removeChild(tempDiv);
    }
}

async function renderHtmlReportToPdf(sections) {
    if (!window.jspdf?.jsPDF) {
        throw new Error('Библиотека jsPDF не загружена');
    }
    if (typeof html2canvas !== 'function') {
        throw new Error('Библиотека html2canvas не загружена');
    }

    const pages = paginatePdfSections(sections);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 8;
    const imgWidth = pageWidth - margin * 2;
    const totalPages = pages.length;

    for (let i = 0; i < pages.length; i++) {
        const canvas = await renderPdfPageCanvas(pages[i], i + 1, totalPages);
        if (i > 0) {
            pdf.addPage();
        }
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        const maxHeight = pageHeight - margin * 2;
        const drawHeight = Math.min(imgHeight, maxHeight);
        const drawWidth = imgHeight > maxHeight ? (canvas.width * drawHeight) / canvas.height : imgWidth;
        pdf.addImage(canvas.toDataURL('image/png', 1.0), 'PNG', margin, margin, drawWidth, drawHeight);
    }

    return pdf;
}

function buildPdfReportHtml(calc) {
    return buildPdfReportSections(calc).join('');
}

// Функция для генерации и скачивания PDF (клиентская версия)
async function downloadPDF() {
    if (!window.lastCalculations) {
        alert('Нет данных для экспорта. Сначала выполните расчёт.');
        return;
    }

    const designer = window.factoryDesigner;
    if (designer?.showNotification) {
        designer.showNotification('Формирование PDF…', 'info');
    }

    try {
        closeCalculationChoiceModal();
        const sections = buildPdfReportSections(window.lastCalculations);
        const pdf = await renderHtmlReportToPdf(sections);
        const filename = `расчет_${new Date().toISOString().split('T')[0]}.pdf`;
        pdf.save(filename);

        if (designer?.showNotification) {
            designer.showNotification('PDF файл скачан', 'success');
        }
    } catch (error) {
        console.error('Ошибка генерации PDF:', error);
        alert('Ошибка при генерации PDF: ' + error.message);
    }
}

// Делаем функцию доступной глобально
window.downloadPDF = downloadPDF;

let factoryDesignerInstance = null;
document.addEventListener('DOMContentLoaded', async () => {
    mountHowToUseContent();
    factoryDesignerInstance = new FactoryDesigner();
    window.factoryDesigner = factoryDesignerInstance;
    await factoryDesignerInstance.ready;
    if (window.LeskomConfiguratorIntegration?.attach) {
        try {
            await window.LeskomConfiguratorIntegration.attach(factoryDesignerInstance);
        } catch (e) {
            console.error('Интеграция ЛК:', e);
        }
    }
});

