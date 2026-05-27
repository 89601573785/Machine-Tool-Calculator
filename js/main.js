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
        this.snapEnabled = false;
        this.snapSize = 50;
        this.alignSnapThreshold = 8;
        this.isPanning = false;
        this.lastPanX = 0;
        this.lastPanY = 0;
        this.lastPointerX = null;
        this.lastPointerY = null;
        this.isShiftPressed = false;
        this.selectedPlacementId = null;
        this.connectionManager = null;
        this.nextPlacementId = 1;
        this.projectStorageKey = this.resolveProjectStorageKey();
        this.init();
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

    async init() {
        await this.loadEquipment();
        this.setupEventListeners();
        this.setupDragAndDrop();
        const workspaceArea = document.getElementById('workspaceArea');
        if (workspaceArea) {
            this.connectionManager = new ConnectionManager(workspaceArea);
            // Небольшая задержка для правильного расчета размеров
            setTimeout(() => {
                this.centerWorkspace();
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

    async loadEquipment() {
        try {
            console.log('Начинаю загрузку оборудования...');
            
            let data = null;
            
            // Сначала пробуем загрузить из SQLite базы данных (работает без сервера)
            // ВАЖНО: через file:// протокол fetch не работает, поэтому будет использован fallback
            try {
                data = await this.loadFromSQLite();
                if (data && data.length > 0) {
                    console.log('✓ Данные загружены из SQLite базы данных:', data.length, 'элементов');
                } else {
                    console.warn('SQLite база данных пуста или не содержит данных');
                    data = null;
                }
            } catch (sqliteError) {
                // Это нормально при работе через file:// протокол
                // Используем fallback на equipment-data.js
                console.warn('Загрузка из SQLite не удалась (это нормально при открытии через file://):', sqliteError.message);
                data = null;
            }
            
            // Если SQLite не сработал, пробуем встроенные данные
            if (!data && window.EQUIPMENT_DATA && Array.isArray(window.EQUIPMENT_DATA)) {
                data = window.EQUIPMENT_DATA;
                console.log('✓ Данные загружены из встроенного JavaScript:', data.length, 'элементов');
            }
            
            if (!data) {
                throw new Error('Не удалось загрузить данные. Убедитесь, что файл data/factory.db существует.');
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
            
            this.equipment = data;
            this.allEquipment = data;
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
                            1. Убедитесь, что файл <code>data/factory.db</code> существует<br>
                            2. Если вы открыли файл через <code>file://</code>, запустите страницу через локальный сервер (например, расширение Live Server)<br>
                            3. Либо используйте резервные данные из <code>js/equipment-data.js</code><br>
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
            catalog.innerHTML = `
                <div style="padding: 2rem; text-align: center; color: #6c757d;">
                    <i class="fas fa-info-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i>
                    <p><strong>Нет доступного оборудования</strong></p>
                    <p style="font-size: 0.9rem; margin-top: 1rem; color: #495057;">
                        Данные оборудования не загружены.
                    </p>
                    <p style="font-size: 0.85rem; margin-top: 0.5rem; color: #6c757d;">
                        <strong>Решение:</strong><br>
                        1. Если вы открыли страницу через <code>file://</code>, запустите её через локальный сервер (например, Live Server)<br>
                        2. Убедитесь, что существует <code>data/factory.db</code> или подключён <code>js/equipment-data.js</code><br>
                        3. Обновите эту страницу (F5)
                    </p>
                </div>
            `;
            return;
        }

        // Группируем оборудование по рядам
        const row1 = []; // Станки, которые пилят бревно, очищают
        const row2 = []; // Кромкообрезные
        const row3 = []; // Изготавливают полуготовую продукцию
        const other = []; // Остальное оборудование
        
        this.equipment.forEach(equipment => {
            const row = this.getEquipmentRow(equipment);
            if (row === 1) row1.push(equipment);
            else if (row === 2) row2.push(equipment);
            else if (row === 3) row3.push(equipment);
            else other.push(equipment);
        });
        
        // Функция для отрисовки группы оборудования
        const renderEquipmentGroup = (equipmentList, rowTitle, rowNumber) => {
            if (equipmentList.length === 0) return null;
            
            const groupDiv = document.createElement('div');
            groupDiv.className = 'equipment-row-group';
            groupDiv.dataset.row = rowNumber;
            
            const header = document.createElement('div');
            header.className = 'equipment-row-header';
            header.innerHTML = `
                <span class="equipment-row-title">${rowTitle}</span>
                <span class="equipment-row-count">(${equipmentList.length})</span>
                <i class="fas fa-chevron-down equipment-row-toggle"></i>
            `;
            header.style.cursor = 'pointer';
            
            // Обработчик сворачивания/разворачивания
            header.addEventListener('click', () => {
                const content = groupDiv.querySelector('.equipment-row-content');
                const toggle = header.querySelector('.equipment-row-toggle');
                if (content) {
                    const isCollapsed = content.style.display === 'none';
                    content.style.display = isCollapsed ? '' : 'none';
                    toggle.classList.toggle('fa-chevron-down', isCollapsed);
                    toggle.classList.toggle('fa-chevron-up', !isCollapsed);
                    header.classList.toggle('collapsed', !isCollapsed);
                }
            });
            
            groupDiv.appendChild(header);
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'equipment-row-content';
            groupDiv.appendChild(contentDiv);
            
            equipmentList.forEach(equipment => {
                const equipmentElement = document.createElement('div');
                equipmentElement.className = 'equipment-item';
                equipmentElement.draggable = true;
                equipmentElement.dataset.equipmentId = equipment.id;
                equipmentElement.dataset.equipmentRow = rowNumber;
                
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
                const powerConsumption = (equipment.power_consumption !== null && equipment.power_consumption !== undefined && equipment.power_consumption !== 0)
                    ? `${equipment.power_consumption} кВт`
                    : null;
                const dimensions = (equipment.width && equipment.length && equipment.height)
                    ? `${equipment.width}×${equipment.length}×${equipment.height} м`
                    : null;
                
                // Формируем HTML карточки
                equipmentElement.innerHTML = `
                    ${imageHTML}
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
            
            return groupDiv;
        };
        
        // Отрисовываем группы по порядку
        const group1 = renderEquipmentGroup(row1, '1 ряд: Станки, которые пилят бревно, очищают', 1);
        if (group1) catalog.appendChild(group1);
        
        const group2 = renderEquipmentGroup(row2, '2 ряд: Кромкообрезные (длительный)', 2);
        if (group2) catalog.appendChild(group2);
        
        const group3 = renderEquipmentGroup(row3, '3 ряд: Изготавливают полуготовую продукцию', 3);
        if (group3) catalog.appendChild(group3);
        
        const groupOther = renderEquipmentGroup(other, 'Прочее оборудование', 0);
        if (groupOther) catalog.appendChild(groupOther);
    }

    // Определяет ряд станка для группировки и ограничения соединений
    getEquipmentRow(equipment) {
        if (!equipment) return 0;
        const type = (equipment.equipment_type || '').toLowerCase();
        const category = (equipment.category || '').toLowerCase();
        const name = (equipment.name || '').toLowerCase();
        
        // 1 ряд: Станки, которые пилят бревно, очищают
        if (type.includes('бревнопильн') || type.includes('brevnopilynye') ||
            type.includes('горбыльн') || type.includes('gorbylynye') ||
            type.includes('пилорам') || type.includes('piloram') ||
            category.includes('бревнопильн') || category.includes('горбыльн') ||
            category.includes('пилорам') ||
            name.includes('пилорам')) {
            return 1;
        }
        
        // 2 ряд: Кромкообрезные (длительный)
        if (type.includes('кромкообрезн') || type.includes('kromkoobreznye') ||
            category.includes('кромкообрезн')) {
            return 2;
        }
        
        // 3 ряд: Изготавливают полуготовую продукцию (многопильные)
        if (type.includes('многопильн') || type.includes('mnogopilynye') ||
            category.includes('многопильн')) {
            return 3;
        }
        
        // По умолчанию - без ряда (можно соединять со всеми)
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
        document.getElementById('calculateBtn').addEventListener('click', () => this.calculateProduction());
        document.getElementById('clearWorkspaceBtn').addEventListener('click', () => this.clearWorkspace(true));
        document.getElementById('gridToggleBtn').addEventListener('click', () => this.toggleGrid());
        const snapToggleBtn = document.getElementById('snapToggleBtn');
        if (snapToggleBtn) {
            snapToggleBtn.addEventListener('click', () => this.toggleSnap());
        }
        document.getElementById('zoomInBtn').addEventListener('click', () => {
            const pivot = this.getZoomPivot();
            this.setZoom(this.zoom * 1.2, pivot.x, pivot.y);
        });
        document.getElementById('zoomOutBtn').addEventListener('click', () => {
            const pivot = this.getZoomPivot();
            this.setZoom(this.zoom * 0.8, pivot.x, pivot.y);
        });
        document.getElementById('zoomResetBtn').addEventListener('click', () => {
            this.setZoom(1.0);
            this.centerWorkspace();
        });

        const saveBtn = document.getElementById('saveProjectBtn');
        const loadBtn = document.getElementById('loadProjectBtn');
        const exportBtn = document.getElementById('exportProjectBtn');
        const importBtn = document.getElementById('importProjectBtn');
        const importInput = document.getElementById('importProjectFileInput');

        if (saveBtn) saveBtn.addEventListener('click', () => this.saveProjectToLocalStorage());
        if (loadBtn) loadBtn.addEventListener('click', () => this.loadProjectFromLocalStorage());
        if (exportBtn) exportBtn.addEventListener('click', () => this.exportProjectToFile());
        if (importBtn && importInput) {
            importBtn.addEventListener('click', () => importInput.click());
            importInput.addEventListener('change', (e) => this.importProjectFromFile(e));
        }
        document.getElementById('catalogToggleBtn').addEventListener('click', () => {
            const sidebar = document.getElementById('equipmentSidebar');
            sidebar.classList.toggle('collapsed');
            // Обновляем позицию кнопок управления
            const controls = document.querySelector('.workspace-top-controls');
            if (sidebar.classList.contains('collapsed')) {
                controls.style.left = '20px';
            } else {
                controls.style.left = '340px';
            }
        });
        document.getElementById('sidebarToggleBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            const sidebar = document.getElementById('equipmentSidebar');
            sidebar.classList.toggle('collapsed');
            // Обновляем позицию кнопок управления
            const controls = document.querySelector('.workspace-top-controls');
            if (sidebar.classList.contains('collapsed')) {
                controls.style.left = '20px';
            } else {
                controls.style.left = '340px';
            }
        });
        const searchInput = document.getElementById('equipmentSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.filterEquipment(e.target.value));
        }
        
        const workspaceArea = document.getElementById('workspaceArea');
        const workspaceContainer = document.querySelector('.workspace-container');
        
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
                // Правая кнопка, средняя кнопка мыши или Alt + левая кнопка
                if (e.button === 2 || e.button === 1 || (e.button === 0 && e.altKey)) {
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
            if (this.isShiftPressed && e.target.closest('.placed-equipment')) {
                e.preventDefault();
                const equipmentElement = e.target.closest('.placed-equipment');
                const placementId = parseInt(equipmentElement.dataset.placementId, 10);
                if (isNaN(placementId)) {
                    console.error('Неверный ID экземпляра оборудования:', equipmentElement.dataset.placementId);
                    return;
                }
                if (this.selectedPlacementId === null) {
                    this.selectedPlacementId = placementId;
                    equipmentElement.classList.add('selected');
                } else if (this.selectedPlacementId !== placementId) {
                    this.connectionManager.createConnection(this.selectedPlacementId, placementId);
                    document.querySelectorAll('.placed-equipment').forEach(el => el.classList.remove('selected'));
                    this.selectedPlacementId = null;
                }
            }
        });
    }

    toggleSnap() {
        this.snapEnabled = !this.snapEnabled;
        const btn = document.getElementById('snapToggleBtn');
        if (btn) btn.classList.toggle('active', this.snapEnabled);
        this.showNotification(this.snapEnabled ? 'Привязка к сетке включена' : 'Привязка к сетке выключена', 'info');
    }

    snapValue(v) {
        const size = this.snapSize || 50;
        return Math.round(v / size) * size;
    }

    applySnap(x, y) {
        if (!this.snapEnabled) return { x, y };
        return { x: this.snapValue(x), y: this.snapValue(y) };
    }
    
    applyAlignmentSnap(x, y, element) {
        if (!this.snapEnabled) return { x, y };
        if (!element) return { x, y };
        
        const ws = document.getElementById('workspaceArea');
        if (!ws) return { x, y };
        
        const threshold = this.alignSnapThreshold ?? 8;
        const w = element.offsetWidth || 200;
        const h = element.offsetHeight || 200;
        
        // Собираем кандидатов по другим элементам (лево/центр/право и верх/середина/низ)
        const others = Array.from(ws.querySelectorAll('.placed-equipment')).filter(el => el !== element);
        if (others.length === 0) return { x, y };
        
        const xCandidates = [];
        const yCandidates = [];
        
        others.forEach(el => {
            const left = el.offsetLeft;
            const top = el.offsetTop;
            const ew = el.offsetWidth || 200;
            const eh = el.offsetHeight || 200;
            
            // X
            xCandidates.push({ pos: left, line: left }); // left-left
            xCandidates.push({ pos: left + ew / 2 - w / 2, line: left + ew / 2 }); // center-center
            xCandidates.push({ pos: left + ew - w, line: left + ew }); // right-right
            
            // Y
            yCandidates.push({ pos: top, line: top }); // top-top
            yCandidates.push({ pos: top + eh / 2 - h / 2, line: top + eh / 2 }); // middle-middle
            yCandidates.push({ pos: top + eh - h, line: top + eh }); // bottom-bottom
        });
        
        const findClosest = (value, candidates) => {
            let best = null;
            let bestDiff = Infinity;
            for (const c of candidates) {
                const diff = Math.abs(value - c.pos);
                if (diff < bestDiff) {
                    bestDiff = diff;
                    best = c;
                }
            }
            if (best !== null && bestDiff <= threshold) return best;
            return null;
        };
        
        const bestX = findClosest(x, xCandidates);
        const bestY = findClosest(y, yCandidates);
        
        return {
            x: bestX ? bestX.pos : x,
            y: bestY ? bestY.pos : y,
            guideX: bestX ? bestX.line : null,
            guideY: bestY ? bestY.line : null
        };
    }

    ensureAlignmentGuides() {
        const ws = document.getElementById('workspaceArea');
        if (!ws) return null;
        let container = ws.querySelector('.alignment-guides');
        if (container) return container;
        
        container = document.createElement('div');
        container.className = 'alignment-guides';
        
        const v = document.createElement('div');
        v.className = 'alignment-guide vertical';
        v.style.display = 'none';
        
        const h = document.createElement('div');
        h.className = 'alignment-guide horizontal';
        h.style.display = 'none';
        
        container.appendChild(v);
        container.appendChild(h);
        ws.appendChild(container);
        return container;
    }

    setAlignmentGuides(guideX, guideY) {
        const container = this.ensureAlignmentGuides();
        if (!container) return;
        const v = container.querySelector('.alignment-guide.vertical');
        const h = container.querySelector('.alignment-guide.horizontal');
        if (!v || !h) return;
        
        if (typeof guideX === 'number' && Number.isFinite(guideX)) {
            v.style.left = `${guideX}px`;
            v.style.display = 'block';
        } else {
            v.style.display = 'none';
        }
        
        if (typeof guideY === 'number' && Number.isFinite(guideY)) {
            h.style.top = `${guideY}px`;
            h.style.display = 'block';
        } else {
            h.style.display = 'none';
        }
    }

    hideAlignmentGuides() {
        this.setAlignmentGuides(null, null);
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
                    if (this.snapEnabled && !e.ctrlKey) {
                        const snapped = this.applySnap(x, y);
                        x = snapped.x;
                        y = snapped.y;
                    }
                    this.placeEquipment(equipment, x, y);
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
        div.style.left = `${Math.max(0, x)}px`;
        div.style.top = `${Math.max(0, y)}px`;
        // Уникальный ID экземпляра на поле (важно: один и тот же станок можно разместить несколько раз)
        const placementId = placementIdOverride !== null ? placementIdOverride : this.nextPlacementId++;
        div.dataset.placementId = placementId;
        div.dataset.equipmentId = equipment.id;
        const row = this.getEquipmentRow(equipment);
        div.dataset.equipmentRow = row;
        const efficiency = equipment.efficiency || 0.85;
        const calculatedProductivity = (equipment.productivity * efficiency).toFixed(2);
        
        // Добавляем миниатюру картинки
        let imageHTML = '';
        if (equipment.photo) {
            imageHTML = `<img src="${equipment.photo}" alt="${equipment.name}" style="width: 100%; height: 80px; object-fit: cover; border-radius: 4px; margin-bottom: 5px;" onerror="this.style.display='none'">`;
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
            <div class="equipment-row-badge" title="Технологический ряд станка">Ряд: ${row === 0 ? '—' : row}</div>
            <h4>${equipment.name}</h4>
            <div class="equipment-stats">
                <p><i class="fas fa-tachometer-alt"></i> ${calculatedProductivity} м³/смену</p>
                <p><i class="fas fa-bolt"></i> ${equipment.power_consumption} кВт</p>
                <p><i class="fas fa-ruler"></i> ${equipment.width}×${equipment.length}×${equipment.height} м</p>
                <p><i class="fas fa-ruble-sign"></i> ${priceDisplay}</p>
            </div>
        `;
        this.makeDraggable(div);
        workspace.appendChild(div);
        this.placedEquipment.push({placementId, equipmentId: equipment.id, element: div, x: x, y: y, equipment: equipment});
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
            let newX = Math.max(0, cursorX - startX);
            let newY = Math.max(0, cursorY - startY);
            if (this.snapEnabled && !e.ctrlKey) {
                const snapped = this.applySnap(newX, newY);
                newX = Math.max(0, snapped.x);
                newY = Math.max(0, snapped.y);
                const aligned = this.applyAlignmentSnap(newX, newY, element);
                newX = Math.max(0, aligned.x);
                newY = Math.max(0, aligned.y);
                this.setAlignmentGuides(aligned.guideX, aligned.guideY);
            } else {
                this.hideAlignmentGuides();
            }
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
                this.hideAlignmentGuides();
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
        if (!project || project.version !== 1) {
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

        // Быстрый доступ к оборудованию по id
        const equipmentById = new Map((this.allEquipment || []).map(eq => [eq.id, eq]));

        let maxPlacementId = 0;
        project.placed.forEach(p => {
            const eq = equipmentById.get(p.equipmentId);
            if (!eq) return; // если в данных нет такого оборудования — пропускаем
            const placementId = Number(p.placementId);
            const x = Number(p.x);
            const y = Number(p.y);
            if (!Number.isFinite(placementId) || !Number.isFinite(x) || !Number.isFinite(y)) return;
            this.placeEquipmentInstance(eq, x, y, placementId);
            if (placementId > maxPlacementId) maxPlacementId = placementId;
        });
        this.nextPlacementId = Math.max(this.nextPlacementId, maxPlacementId + 1);

        // Восстанавливаем соединения
        if (this.connectionManager && Array.isArray(project.connections)) {
            project.connections.forEach(c => {
                const fromId = Number(c.fromId);
                const toId = Number(c.toId);
                if (!Number.isFinite(fromId) || !Number.isFinite(toId)) return;
                this.connectionManager.createConnection(fromId, toId);
            });
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

    toggleGrid() {
        document.getElementById('gridOverlay').classList.toggle('active');
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
        const zoomLabel = document.getElementById('zoomLevel');
        if (zoomLabel) zoomLabel.textContent = Math.round(this.zoom * 100) + '%';
    }

    updateTransform() {
        const workspace = document.getElementById('workspaceArea');
        workspace.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
        workspace.style.transformOrigin = 'top left';
    }

    centerWorkspace() {
        const workspace = document.getElementById('workspaceArea');
        if (!workspace) return;
        
        const container = workspace.parentElement;
        if (!container) return;
        
        const wsWidth = 8000, wsHeight = 6000;
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
            const production = (eq.productivity || 0) * (eq.efficiency || 0.85);
            totalProduction += production;
            totalPower += eq.power_consumption || 0;
            
            // Проверяем цену для предупреждений
            if (eq.cost === 0 || (eq.price && eq.price.includes('Цена по запросу'))) {
                priceWarnings.push({
                    name: eq.name,
                    price: eq.price || 'Цена по запросу'
                });
                // Если цена по запросу, не добавляем стоимость в общую сумму
                totalCost += 0;
            } else {
                totalCost += eq.cost || 0;
            }
            totalInstallationCost += eq.installation_cost || 0;
            totalArea += (eq.width || 1) * (eq.length || 1);
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
            
            equipmentList.push({
                name: eq.name,
                production: production,
                power: eq.power_consumption || 0,
                cost: eq.cost || 0,
                installation_cost: eq.installation_cost || 0,
                speed: eq.speed || 1.0,
                cycle_time: eq.cycle_time || 60,
                daily_operation: eq.daily_operation_cost || 0,
                daily_maintenance: eq.daily_maintenance_cost || 0,
                dimensions: `${eq.width || 1.5}×${eq.length || 3.0}×${eq.height || 2.0} м`
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
            total_cost: totalCost,
            installation_cost_total: totalInstallationCost,
            total_cost_with_installation: totalAllCosts,
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

function toggleInstruction() {
    document.getElementById('connectionInstruction').classList.toggle('collapsed');
}

function closeCalculationChoiceModal() {
    document.getElementById('calculationChoiceModal').style.display = 'none';
}

function closeCalculationsViewModal() {
    document.getElementById('calculationsViewModal').style.display = 'none';
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
                <div class="value">${calc.total_cost.toLocaleString()} руб</div>
            </div>
            <div class="calculation-item">
                <div class="label">Стоимость установки:</div>
                <div class="value">${calc.installation_cost_total.toLocaleString()} руб</div>
            </div>
            <div class="calculation-item">
                <div class="label">Общая стоимость:</div>
                <div class="value">${calc.total_cost_with_installation.toLocaleString()} руб</div>
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
    
    html += `
        <div class="calc-section">
            <h4 style="margin-bottom: 1rem; color: #5d4e37;">Детальная информация по оборудованию</h4>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                    <thead>
                        <tr style="background: #8b6f47; color: white;">
                            <th style="padding: 0.75rem; text-align: left; border: 1px solid #ddd;">Станок</th>
                            <th style="padding: 0.75rem; text-align: right; border: 1px solid #ddd;">Стоимость (руб)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${calc.equipment_list.map((eq, idx) => `
                            <tr style="background: ${idx % 2 === 0 ? '#fff' : '#f8f9fa'};">
                                <td style="padding: 0.75rem; border: 1px solid #ddd;"><strong>${eq.name}</strong></td>
                                <td style="padding: 0.75rem; text-align: right; border: 1px solid #ddd;">${eq.cost.toLocaleString()}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    content.innerHTML = html;
    document.getElementById('calculationsViewModal').style.display = 'block';
}

// Функция для генерации и скачивания PDF (клиентская версия)
// Используем html2canvas для конвертации HTML в изображение, затем в PDF
async function downloadPDF() {
    if (!window.lastCalculations) {
        alert('Нет данных для экспорта. Сначала выполните расчет.');
        return;
    }
    
    try {
        // Параметры для формата A4
        // A4 формат: 210mm = 794px (при 96 DPI)
        const a4WidthPx = 794;
        const marginPx = 57; // 15mm = ~57px при 96 DPI
        
        // Создаем временный контейнер с HTML содержимым для формата A4
        const calc = window.lastCalculations;
        const tempDiv = document.createElement('div');
        tempDiv.style.position = 'absolute';
        tempDiv.style.left = '-9999px';
        tempDiv.style.width = `${a4WidthPx}px`;
        tempDiv.style.minWidth = `${a4WidthPx}px`;
        tempDiv.style.maxWidth = `${a4WidthPx}px`;
        tempDiv.style.padding = `${marginPx}px`;
        tempDiv.style.backgroundColor = 'white';
        tempDiv.style.fontFamily = 'Arial, sans-serif';
        tempDiv.style.boxSizing = 'border-box';
        
        // Определяем, есть ли цены по запросу
        const hasPriceRequest = calc.price_warnings && calc.price_warnings.length > 0;
        const totalCostDisplay = hasPriceRequest ? 'Цена по запросу' : `${calc.total_cost.toLocaleString()} руб`;
        
        let html = `
            <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="font-size: 24px; color: #5d4e37; margin-bottom: 10px;">Отчет о расчете производственного цеха</h1>
                <p style="font-size: 12px; color: #666;">Дата: ${new Date().toLocaleString('ru-RU')}</p>
            </div>
            
            <div style="margin-bottom: 30px; padding-top: 10px; page-break-inside: avoid;">
                <h2 style="font-size: 18px; color: #8b6f47; margin-bottom: 15px; border-bottom: 2px solid #8b6f47; padding-bottom: 5px;">Основные показатели</h2>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; page-break-inside: avoid;">
                    <tr style="background: #8b6f47; color: white;">
                        <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Показатель</th>
                        <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Значение</th>
                    </tr>
                    <tr style="background: #fff;">
                        <td style="padding: 8px; border: 1px solid #ddd;">Производительность</td>
                        <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${calc.final_production.toFixed(2)} м³/смену</td>
                    </tr>
                    <tr style="background: #f8f9fa;">
                        <td style="padding: 8px; border: 1px solid #ddd;">Общее энергопотребление</td>
                        <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${calc.total_energy.toFixed(2)} кВт</td>
                    </tr>
                    <tr style="background: #fff;">
                        <td style="padding: 8px; border: 1px solid #ddd;">Общая стоимость</td>
                        <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${totalCostDisplay}</td>
                    </tr>
                    <tr style="background: #f8f9fa;">
                        <td style="padding: 8px; border: 1px solid #ddd;">Общая площадь</td>
                        <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${calc.total_area.toFixed(2)} м²</td>
                    </tr>
                </table>
            </div>
            
            <div style="margin-bottom: 30px; padding-top: 10px; page-break-inside: avoid;">
                <h2 style="font-size: 18px; color: #8b6f47; margin-bottom: 15px; border-bottom: 2px solid #8b6f47; padding-bottom: 5px;">Детализация</h2>
                <table style="width: 100%; border-collapse: collapse; page-break-inside: avoid;">
                    <tr style="background: #8b6f47; color: white;">
                        <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Параметр</th>
                        <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Значение</th>
                    </tr>
        `;
        
        
        if (calc.installation_cost_total > 0) {
            html += `
                    <tr style="background: #f8f9fa;">
                        <td style="padding: 8px; border: 1px solid #ddd;">Цена установки</td>
                        <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${calc.installation_cost_total.toFixed(2)} руб</td>
                    </tr>
            `;
        }
        
        html += `
                    <tr style="background: #fff;">
                        <td style="padding: 8px; border: 1px solid #ddd;">Потребление электричества</td>
                        <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${calc.total_energy.toFixed(2)} кВт</td>
                    </tr>
        `;
        
        if (calc.bottleneck_equipment && calc.bottleneck_equipment !== 'Нет') {
            html += `
                    <tr style="background: #f8f9fa;">
                        <td style="padding: 8px; border: 1px solid #ddd;">Узкое место</td>
                        <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${calc.bottleneck_equipment} (${calc.bottleneck_productivity.toFixed(2)} м³/смену)</td>
                    </tr>
            `;
        }
        
        html += `
                    <tr style="background: #fff;">
                        <td style="padding: 8px; border: 1px solid #ddd;">Количество станков</td>
                        <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${calc.equipment_count}</td>
                    </tr>
        `;
        
        html += `
                    <tr style="background: #f8f9fa;">
                        <td style="padding: 8px; border: 1px solid #ddd;">Количество соединений</td>
                        <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${calc.connections_count > 0 ? calc.connections_count : 'Нет соединений'}</td>
                    </tr>
        `;
        
        html += `
                </table>
            </div>
        `;
        
        
        html += `
                </table>
            </div>
        `;
        
        // Связи между станками (отдельный раздел)
        if (calc.connections_info && calc.connections_info.length > 0) {
            html += `
                <div style="margin-bottom: 30px; padding-top: 10px; page-break-inside: avoid;">
                    <h2 style="font-size: 18px; color: #8b6f47; margin-bottom: 15px; border-bottom: 2px solid #8b6f47; padding-bottom: 5px;">Связи между станками</h2>
                    <div style="padding: 10px; background: #d4edda; border-left: 4px solid #28a745; border-radius: 4px; margin-bottom: 15px;">
                        <p style="margin: 0; color: #155724; font-weight: bold;">✓ Найдено ${calc.connections_count} соединений</p>
                    </div>
                    <table style="width: 100%; border-collapse: collapse; page-break-inside: avoid;">
                        <tr style="background: #8b6f47; color: white;">
                            <th style="padding: 8px; text-align: center; border: 1px solid #ddd;">№</th>
                            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">От</th>
                            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">К</th>
                            <th style="padding: 8px; text-align: right; border: 1px solid #ddd;">Пропускная способность (м³/смену)</th>
                        </tr>
            `;
            calc.connections_info.forEach((conn, idx) => {
                html += `
                        <tr style="background: ${idx % 2 === 0 ? '#fff' : '#f8f9fa'};">
                            <td style="padding: 6px; border: 1px solid #ddd; text-align: center;">${idx + 1}</td>
                            <td style="padding: 6px; border: 1px solid #ddd;">${conn.from}</td>
                            <td style="padding: 6px; border: 1px solid #ddd;">${conn.to}</td>
                            <td style="padding: 6px; text-align: right; border: 1px solid #ddd;">${conn.throughput.toFixed(2)}</td>
                        </tr>
                `;
            });
            html += `</table></div>`;
        } else if (calc.equipment_count > 1) {
            html += `
                <div style="margin-bottom: 30px; padding-top: 10px; page-break-inside: avoid;">
                    <h2 style="font-size: 18px; color: #8b6f47; margin-bottom: 15px; border-bottom: 2px solid #8b6f47; padding-bottom: 5px;">Связи между станками</h2>
                    <div style="padding: 15px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                        <p style="margin: 0; color: #856404;"><strong>⚠ Соединений нет.</strong> Для создания производственной линии рекомендуется связать станки между собой.</p>
                    </div>
                </div>
            `;
        } else if (calc.equipment_count === 1) {
            html += `
                <div style="margin-bottom: 30px; padding-top: 10px; page-break-inside: avoid;">
                    <h2 style="font-size: 18px; color: #8b6f47; margin-bottom: 15px; border-bottom: 2px solid #8b6f47; padding-bottom: 5px;">Связи между станками</h2>
                    <div style="padding: 15px; background: #e2e3e5; border-left: 4px solid #6c757d; border-radius: 4px;">
                        <p style="margin: 0; color: #383d41;">Для создания соединений необходимо разместить минимум 2 станка.</p>
                    </div>
                </div>
            `;
        }
        
        // Потоки материалов (если есть связи)
        if (calc.connections_info && calc.connections_info.length > 0) {
            html += `
                <div style="margin-bottom: 30px; padding-top: 10px; page-break-inside: avoid;">
                    <h2 style="font-size: 18px; color: #8b6f47; margin-bottom: 15px; border-bottom: 2px solid #8b6f47; padding-bottom: 5px;">Потоки материалов</h2>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr style="background: #8b6f47; color: white;">
                            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">От</th>
                            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">К</th>
                            <th style="padding: 8px; text-align: right; border: 1px solid #ddd;">Пропускная способность (м³/смену)</th>
                        </tr>
            `;
            calc.connections_info.forEach((conn, idx) => {
                html += `
                        <tr style="background: ${idx % 2 === 0 ? '#fff' : '#f8f9fa'};">
                            <td style="padding: 6px; border: 1px solid #ddd;">${conn.from}</td>
                            <td style="padding: 6px; border: 1px solid #ddd;">${conn.to}</td>
                            <td style="padding: 6px; text-align: right; border: 1px solid #ddd;">${conn.throughput.toFixed(2)}</td>
                        </tr>
                `;
            });
            html += `</table></div>`;
        }
        
        if (calc.input_materials && Object.keys(calc.input_materials).length > 0) {
            const materials = Object.entries(calc.input_materials);
            const rowsPerPage = 20; // Количество строк на страницу
            const totalPages = Math.ceil(materials.length / rowsPerPage);
            
            for (let page = 0; page < totalPages; page++) {
                const startIdx = page * rowsPerPage;
                const endIdx = Math.min(startIdx + rowsPerPage, materials.length);
                const pageData = materials.slice(startIdx, endIdx);
                
                html += `
                    <div style="margin-bottom: 30px; ${page > 0 ? 'page-break-before: always; padding-top: 20px;' : ''} page-break-inside: avoid;">
                        <h2 style="font-size: 18px; color: #8b6f47; margin-bottom: 15px; border-bottom: 2px solid #8b6f47; padding-bottom: 5px;">
                            Потребление сырья (м³/смену) ${totalPages > 1 ? `(стр. ${page + 1} из ${totalPages})` : ''}
                        </h2>
                        <table style="width: 100%; border-collapse: collapse; page-break-inside: avoid;">
                            <tr style="background: #8b6f47; color: white;">
                                <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Материал</th>
                                <th style="padding: 8px; text-align: right; border: 1px solid #ddd;">Количество (м³/смену)</th>
                            </tr>
                `;
                pageData.forEach(([name, qty], idx) => {
                    html += `
                        <tr style="background: ${idx % 2 === 0 ? '#fff' : '#f8f9fa'};">
                            <td style="padding: 6px; border: 1px solid #ddd;">${name}</td>
                            <td style="padding: 6px; text-align: right; border: 1px solid #ddd;">${qty.toFixed(2)}</td>
                        </tr>
                    `;
                });
                html += `</table></div>`;
            }
        }
        
        if (calc.output_materials && Object.keys(calc.output_materials).length > 0) {
            const materials = Object.entries(calc.output_materials);
            const rowsPerPage = 20; // Количество строк на страницу
            const totalPages = Math.ceil(materials.length / rowsPerPage);
            
            for (let page = 0; page < totalPages; page++) {
                const startIdx = page * rowsPerPage;
                const endIdx = Math.min(startIdx + rowsPerPage, materials.length);
                const pageData = materials.slice(startIdx, endIdx);
                
                html += `
                    <div style="margin-bottom: 30px; ${page > 0 ? 'page-break-before: always; padding-top: 20px;' : ''} page-break-inside: avoid;">
                        <h2 style="font-size: 18px; color: #8b6f47; margin-bottom: 15px; border-bottom: 2px solid #8b6f47; padding-bottom: 5px;">
                            Выпуск продукции (м³/смену) ${totalPages > 1 ? `(стр. ${page + 1} из ${totalPages})` : ''}
                        </h2>
                        <table style="width: 100%; border-collapse: collapse; page-break-inside: avoid;">
                            <tr style="background: #8b6f47; color: white;">
                                <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Продукция</th>
                                <th style="padding: 8px; text-align: right; border: 1px solid #ddd;">Количество (м³/смену)</th>
                            </tr>
                `;
                pageData.forEach(([name, qty], idx) => {
                    html += `
                        <tr style="background: ${idx % 2 === 0 ? '#fff' : '#d4edda'};">
                            <td style="padding: 6px; border: 1px solid #ddd;">${name}</td>
                            <td style="padding: 6px; text-align: right; border: 1px solid #ddd;">${qty.toFixed(2)}</td>
                        </tr>
                    `;
                });
                html += `</table></div>`;
            }
        }
        
        // Детальная информация по оборудованию
        if (calc.equipment_list && calc.equipment_list.length > 0) {
            html += `
                <div style="margin-bottom: 30px; padding-top: 10px; page-break-inside: avoid;">
                    <h2 style="font-size: 18px; color: #8b6f47; margin-bottom: 15px; border-bottom: 2px solid #8b6f47; padding-bottom: 5px;">Детальная информация по оборудованию</h2>
                    <table style="width: 100%; border-collapse: collapse; page-break-inside: avoid;">
                        <tr style="background: #8b6f47; color: white;">
                            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Станок</th>
                            <th style="padding: 8px; text-align: right; border: 1px solid #ddd;">Стоимость (руб)</th>
                        </tr>
            `;
            calc.equipment_list.forEach((eq, idx) => {
                html += `
                        <tr style="background: ${idx % 2 === 0 ? '#fff' : '#f8f9fa'};">
                            <td style="padding: 6px; border: 1px solid #ddd;">${eq.name}</td>
                            <td style="padding: 6px; text-align: right; border: 1px solid #ddd;">${eq.cost.toLocaleString()}</td>
                        </tr>
                `;
            });
            html += `</table></div>`;
        }
        
        // Предупреждения о ценах
        if (calc.price_warnings && calc.price_warnings.length > 0) {
            html += `
                <div style="margin-bottom: 30px; padding: 15px; background: #fff; border-left: 4px solid #dc3545;">
                    <h3 style="font-size: 16px; color: #dc3545; margin-bottom: 10px; font-weight: bold;">ВНИМАНИЕ! Цены требуют уточнения:</h3>
            `;
            calc.price_warnings.forEach(warning => {
                html += `
                    <p style="margin: 5px 0; color: #dc3545;">• ${warning.name}: ${warning.price}</p>
                `;
            });
            html += `</div>`;
        }
        
        // Площадь с учетом проходов
        if (calc.recommended_area) {
            html += `
                <div style="margin-bottom: 30px;">
                    <p style="font-size: 14px; color: #666;">Площадь с учетом проходов: ${Math.round(calc.recommended_area)} м²</p>
                </div>
            `;
        }
        
        tempDiv.innerHTML = html;
        document.body.appendChild(tempDiv);
        
        // Конвертируем HTML в canvas для формата A4
        const canvas = await html2canvas(tempDiv, {
            scale: 2, // Увеличиваем масштаб для лучшего качества
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff',
            width: a4WidthPx,
            height: tempDiv.scrollHeight,
            windowWidth: a4WidthPx,
            windowHeight: tempDiv.scrollHeight
        });
        
        // Удаляем временный элемент
        document.body.removeChild(tempDiv);
        
        // Создаем PDF из canvas с правильным разбиением на страницы A4
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        
        // Размеры A4 в миллиметрах
        const pageWidth = 210; // Ширина A4
        const pageHeight = 297; // Высота A4
        const margin = 15; // Отступы со всех сторон
        
        // Вычисляем размеры изображения для вставки
        const imgWidth = pageWidth - (margin * 2); // Ширина с учетом отступов
        const imgHeight = (canvas.height * imgWidth) / canvas.width; // Пропорциональная высота
        
        // Конвертируем canvas в изображение
        const imgData = canvas.toDataURL('image/png', 1.0);
        
        // Разбиваем изображение на страницы
        let heightLeft = imgHeight;
        let position = 0;
        let pageNumber = 1;
        
        // Добавляем первую страницу
        pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight);
        heightLeft -= (pageHeight - margin * 2);
        
        // Добавляем остальные страницы если контент не помещается на одну страницу
        while (heightLeft > 0) {
            position = heightLeft - imgHeight;
            pdf.addPage();
            pdf.addImage(imgData, 'PNG', margin, margin + position, imgWidth, imgHeight);
            heightLeft -= (pageHeight - margin * 2);
            pageNumber++;
        }
        
        // Добавляем номера страниц
        const totalPages = pdf.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            pdf.setPage(i);
            pdf.setFontSize(10);
            pdf.setTextColor(128, 128, 128);
            pdf.text(
                `Страница ${i} из ${totalPages}`,
                pageWidth / 2,
                pageHeight - 10,
                { align: 'center' }
            );
        }
        
        // Сохраняем PDF
        const filename = `расчет_${new Date().toISOString().split('T')[0]}.pdf`;
        pdf.save(filename);
        
        if (window.factoryDesigner && window.factoryDesigner.showNotification) {
            window.factoryDesigner.showNotification('PDF файл скачан', 'success');
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
    factoryDesignerInstance = new FactoryDesigner();
    window.factoryDesigner = factoryDesignerInstance;
    if (window.LeskomConfiguratorIntegration?.attach) {
        try {
            await window.LeskomConfiguratorIntegration.attach(factoryDesignerInstance);
        } catch (e) {
            console.error('Интеграция ЛК:', e);
        }
    }
});

