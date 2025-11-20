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
        this.isPanning = false;
        this.lastPanX = 0;
        this.lastPanY = 0;
        this.isShiftPressed = false;
        this.selectedEquipmentId = null;
        this.connectionManager = null;
        this.init();
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
                            2. Если файла нет, запустите <code>copy_db.py</code> для копирования базы данных<br>
                            3. Обновите эту страницу (F5)
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
        const SQL = await initSqlJs({
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
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
                id, name, equipment_type, productivity, cost, installation_cost,
                power_consumption, width, height, length, accuracy, speed,
                reliability, maintenance_interval, noise_level, vibration_level,
                operator_count, efficiency, price, photo, folder_path,
                input_materials, output_materials, daily_operation_cost,
                daily_maintenance_cost, gallery, setup_time, cycle_time
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
                if ((col === 'input_materials' || col === 'output_materials' || col === 'gallery') && value) {
                    try {
                        if (typeof value === 'string') {
                            value = JSON.parse(value);
                        }
                    } catch (e) {
                        value = [];
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
        if (!searchTerm.trim()) {
            this.equipment = this.allEquipment;
        } else {
            const term = searchTerm.toLowerCase();
            this.equipment = this.allEquipment.filter(eq => 
                eq.name.toLowerCase().includes(term) || 
                eq.equipment_type.toLowerCase().includes(term)
            );
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
                        1. Запустите: <code>python export_from_sqlite.py</code><br>
                        2. Дождитесь завершения экспорта<br>
                        3. Обновите эту страницу (F5)
                    </p>
                </div>
            `;
            return;
        }

        this.equipment.forEach(equipment => {
            const equipmentElement = document.createElement('div');
            equipmentElement.className = 'equipment-item';
            equipmentElement.draggable = true;
            equipmentElement.dataset.equipmentId = equipment.id;
            
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
            
            equipmentElement.innerHTML = `
                ${imageHTML}
                <div class="equipment-type">${this.getEquipmentTypeName(equipment.equipment_type)}</div>
                <h4>${equipment.name}</h4>
                <p><i class="fas fa-tachometer-alt"></i> ${calculatedProductivity} м³/смену</p>
                <p><i class="fas fa-bolt"></i> ${equipment.power_consumption} кВт</p>
                <p><i class="fas fa-ruler"></i> ${equipment.width}×${equipment.length}×${equipment.height} м</p>
                <p><i class="fas fa-ruble-sign"></i> ${priceDisplay}</p>
            `;

            catalog.appendChild(equipmentElement);
        });
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
        document.getElementById('clearWorkspaceBtn').addEventListener('click', () => this.clearWorkspace());
        document.getElementById('gridToggleBtn').addEventListener('click', () => this.toggleGrid());
        document.getElementById('zoomInBtn').addEventListener('click', () => this.setZoom(this.zoom * 1.2));
        document.getElementById('zoomOutBtn').addEventListener('click', () => this.setZoom(this.zoom * 0.8));
        document.getElementById('zoomResetBtn').addEventListener('click', () => {
            this.setZoom(1.0);
            this.centerWorkspace();
        });
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
        document.getElementById('equipmentSearch').addEventListener('input', (e) => this.filterEquipment(e.target.value));
        
        const workspaceArea = document.getElementById('workspaceArea');
        const workspaceContainer = document.querySelector('.workspace-container');
        
        // Обработка колесика мыши для масштабирования
        if (workspaceArea) {
            workspaceArea.addEventListener('wheel', (e) => {
                // Если зажат Ctrl или Cmd - масштабирование
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    const delta = e.deltaY > 0 ? 0.9 : 1.1;
                    this.setZoom(this.zoom * delta);
                }
            }, { passive: false });
        }
        
        // Панорамирование мышкой (как в основном проекте)
        if (workspaceArea) {
            this.isPanning = false;
            this.lastPanX = 0;
            this.lastPanY = 0;
            
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
                const equipmentId = parseInt(equipmentElement.dataset.equipmentId, 10);
                if (isNaN(equipmentId)) {
                    console.error('Неверный ID оборудования:', equipmentElement.dataset.equipmentId);
                    return;
                }
                if (this.selectedEquipmentId === null) {
                    this.selectedEquipmentId = equipmentId;
                    equipmentElement.classList.add('selected');
                } else if (this.selectedEquipmentId !== equipmentId) {
                    this.connectionManager.createConnection(this.selectedEquipmentId, equipmentId);
                    document.querySelectorAll('.placed-equipment').forEach(el => el.classList.remove('selected'));
                    this.selectedEquipmentId = null;
                }
            }
        });
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
                    const x = (e.clientX - rect.left) / this.zoom;
                    const y = (e.clientY - rect.top) / this.zoom;
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
        const workspace = document.getElementById('workspaceArea');
        if (!workspace) {
            console.error('Рабочая область не найдена при размещении оборудования!');
            return;
        }
        const div = document.createElement('div');
        div.className = 'placed-equipment';
        div.style.left = `${Math.max(0, x)}px`;
        div.style.top = `${Math.max(0, y)}px`;
        div.dataset.equipmentId = equipment.id;
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
            <h4>${equipment.name}</h4>
            <div class="equipment-stats">
                <p><i class="fas fa-tachometer-alt"></i> ${calculatedProductivity} м³/смену</p>
                <p><i class="fas fa-bolt"></i> ${equipment.power_consumption} кВт</p>
                <p><i class="fas fa-ruler"></i> ${equipment.width}×${equipment.length}×${equipment.height} м</p>
                <p><i class="fas fa-users"></i> ${equipment.operator_count || 1} оператор(ов)</p>
                <p><i class="fas fa-shield-alt"></i> Надежность: ${((equipment.reliability || 0.95) * 100).toFixed(0)}%</p>
                <p><i class="fas fa-volume-up"></i> Шум: ${equipment.noise_level || 75} дБ</p>
                <p><i class="fas fa-ruble-sign"></i> ${priceDisplay}</p>
            </div>
        `;
        this.makeDraggable(div);
        workspace.appendChild(div);
        this.placedEquipment.push({id: equipment.id, element: div, x: x, y: y, equipment: equipment});
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
            // Правильный расчет координат: getBoundingClientRect уже учитывает transform
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
            // Правильный расчет координат: getBoundingClientRect уже учитывает transform
            const cursorX = (e.clientX - workspaceRect.left) / this.zoom;
            const cursorY = (e.clientY - workspaceRect.top) / this.zoom;
            const newX = Math.max(0, cursorX - startX);
            const newY = Math.max(0, cursorY - startY);
            element.style.left = `${newX}px`;
            element.style.top = `${newY}px`;
            const placedItem = this.placedEquipment.find(item => item.element === element);
            if (placedItem) {
                placedItem.x = newX;
                placedItem.y = newY;
            }
            if (this.connectionManager) {
                const equipmentId = parseInt(element.dataset.equipmentId, 10);
                if (!isNaN(equipmentId)) {
                    this.connectionManager.connections.filter(conn => conn.fromId === equipmentId || conn.toId === equipmentId).forEach(conn => {
                        this.connectionManager.drawConnection(conn);
                    });
                }
            }
        };
        
        document.addEventListener('mousemove', updatePosition);
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                element.classList.remove('dragging');
            }
        });
    }

    removeEquipment(element) {
        const equipmentId = parseInt(element.dataset.equipmentId, 10);
        if (isNaN(equipmentId)) {
            console.error('Неверный ID оборудования при удалении:', element.dataset.equipmentId);
            return;
        }
        if (this.connectionManager) {
            this.connectionManager.removeConnectionsForEquipment(equipmentId);
        }
        this.placedEquipment = this.placedEquipment.filter(item => item.id !== equipmentId);
        element.remove();
    }

    clearWorkspace() {
        if (confirm('Очистить рабочую область?')) {
            const workspace = document.getElementById('workspaceArea');
            workspace.querySelectorAll('.placed-equipment').forEach(el => el.remove());
            if (this.connectionManager) {
                this.connectionManager.clearAllConnections();
            }
            this.placedEquipment = [];
        }
    }

    toggleGrid() {
        document.getElementById('gridOverlay').classList.toggle('active');
    }

    setZoom(newZoom) {
        this.zoom = Math.max(0.5, Math.min(3.0, newZoom));
        this.updateTransform();
        document.getElementById('zoomLevel').textContent = Math.round(this.zoom * 100) + '%';
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
        let totalOperators = 0;
        let totalDailyOperationCost = 0;
        let totalDailyMaintenanceCost = 0;
        let maxNoiseLevel = 0;
        let maxVibrationLevel = 0;
        let minReliability = 1.0;
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
            totalOperators += eq.operator_count || 1;
            totalDailyOperationCost += eq.daily_operation_cost || 0;
            totalDailyMaintenanceCost += eq.daily_maintenance_cost || 0;
            
            if ((eq.noise_level || 0) > maxNoiseLevel) {
                maxNoiseLevel = eq.noise_level || 0;
            }
            if ((eq.vibration_level || 0) > maxVibrationLevel) {
                maxVibrationLevel = eq.vibration_level || 0;
            }
            if ((eq.reliability || 1.0) < minReliability) {
                minReliability = eq.reliability || 1.0;
            }
            
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
                operators: eq.operator_count || 1,
                reliability: eq.reliability || 0.95,
                noise: eq.noise_level || 75,
                vibration: eq.vibration_level || 3,
                accuracy: eq.accuracy || 0.5,
                speed: eq.speed || 1.0,
                setup_time: eq.setup_time || 30,
                cycle_time: eq.cycle_time || 60,
                daily_operation: eq.daily_operation_cost || 0,
                daily_maintenance: eq.daily_maintenance_cost || 0,
                dimensions: `${eq.width || 1.5}×${eq.length || 3.0}×${eq.height || 2.0} м`
            });
        });
        
        const totalDailyCosts = totalDailyOperationCost + totalDailyMaintenanceCost;
        const totalAllCosts = totalCost + totalInstallationCost;
        const connectionsCount = this.connectionManager ? this.connectionManager.connections.length : 0;
        
        // Эффективность линии (на основе надежности)
        const productionLineEfficiency = minReliability * 100;
        
        // Собираем информацию о потоках материалов из соединений
        if (this.connectionManager && this.connectionManager.connections.length > 0) {
            this.connectionManager.connections.forEach(conn => {
                const fromEq = this.placedEquipment.find(p => p.id === conn.fromId);
                const toEq = this.placedEquipment.find(p => p.id === conn.toId);
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
            total_operators: totalOperators,
            daily_operation_cost: totalDailyOperationCost,
            daily_maintenance_cost: totalDailyMaintenanceCost,
            daily_total_costs: totalDailyCosts,
            max_noise_level: maxNoiseLevel,
            max_vibration_level: maxVibrationLevel,
            min_reliability: minReliability,
            production_line_efficiency: productionLineEfficiency,
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
                <div class="label">Количество операторов:</div>
                <div class="value">${calc.total_operators}</div>
            </div>
            <div class="calculation-item">
                <div class="label">Соединений:</div>
                <div class="value">${calc.connections_count > 0 ? calc.connections_count : 'Нет соединений'}</div>
            </div>
            <div class="calculation-item">
                <div class="label">Эффективность линии:</div>
                <div class="value">${calc.production_line_efficiency.toFixed(1)}%</div>
            </div>
            <div class="calculation-item">
                <div class="label">Макс. уровень шума:</div>
                <div class="value">${calc.max_noise_level.toFixed(1)} дБ</div>
            </div>
            <div class="calculation-item">
                <div class="label">Макс. вибрация:</div>
                <div class="value">${calc.max_vibration_level.toFixed(1)} мм/с</div>
            </div>
        </div>
        
        <div class="calc-section" style="margin-bottom: 2rem;">
            <h4 style="margin-bottom: 1rem; color: #5d4e37;">Экономические показатели</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
                <div class="calculation-item">
                    <div class="label">Эксплуатация в день:</div>
                    <div class="value">${calc.daily_operation_cost.toLocaleString()} руб</div>
                </div>
                <div class="calculation-item">
                    <div class="label">Обслуживание в день:</div>
                    <div class="value">${calc.daily_maintenance_cost.toLocaleString()} руб</div>
                </div>
                <div class="calculation-item">
                    <div class="label">ИТОГО в день:</div>
                    <div class="value" style="font-weight: bold; color: #8b6f47;">${calc.daily_total_costs.toLocaleString()} руб</div>
                </div>
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
                            <th style="padding: 0.75rem; text-align: center; border: 1px solid #ddd;">Произв. (м³/смену)</th>
                            <th style="padding: 0.75rem; text-align: center; border: 1px solid #ddd;">Мощность (кВт)</th>
                            <th style="padding: 0.75rem; text-align: center; border: 1px solid #ddd;">Операторы</th>
                            <th style="padding: 0.75rem; text-align: center; border: 1px solid #ddd;">Надежность</th>
                            <th style="padding: 0.75rem; text-align: center; border: 1px solid #ddd;">Шум (дБ)</th>
                            <th style="padding: 0.75rem; text-align: center; border: 1px solid #ddd;">Габариты</th>
                            <th style="padding: 0.75rem; text-align: right; border: 1px solid #ddd;">Стоимость (руб)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${calc.equipment_list.map((eq, idx) => `
                            <tr style="background: ${idx % 2 === 0 ? '#fff' : '#f8f9fa'};">
                                <td style="padding: 0.75rem; border: 1px solid #ddd;"><strong>${eq.name}</strong></td>
                                <td style="padding: 0.75rem; text-align: center; border: 1px solid #ddd;">${eq.production.toFixed(2)}</td>
                                <td style="padding: 0.75rem; text-align: center; border: 1px solid #ddd;">${eq.power.toFixed(1)}</td>
                                <td style="padding: 0.75rem; text-align: center; border: 1px solid #ddd;">${eq.operators}</td>
                                <td style="padding: 0.75rem; text-align: center; border: 1px solid #ddd;">${(eq.reliability * 100).toFixed(1)}%</td>
                                <td style="padding: 0.75rem; text-align: center; border: 1px solid #ddd;">${eq.noise.toFixed(1)}</td>
                                <td style="padding: 0.75rem; text-align: center; border: 1px solid #ddd;">${eq.dimensions}</td>
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
        // Создаем временный контейнер с HTML содержимым
        const calc = window.lastCalculations;
        const tempDiv = document.createElement('div');
        tempDiv.style.position = 'absolute';
        tempDiv.style.left = '-9999px';
        tempDiv.style.width = '800px';
        tempDiv.style.padding = '40px';
        tempDiv.style.backgroundColor = 'white';
        tempDiv.style.fontFamily = 'Arial, sans-serif';
        
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
        
        if (calc.production_line_efficiency) {
            html += `
                    <tr style="background: #fff;">
                        <td style="padding: 8px; border: 1px solid #ddd;">Эффективность линии</td>
                        <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${calc.production_line_efficiency.toFixed(2)}%</td>
                    </tr>
            `;
        }
        
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
            
            <div style="margin-bottom: 30px; padding-top: 10px; page-break-inside: avoid;">
                <h2 style="font-size: 18px; color: #8b6f47; margin-bottom: 15px; border-bottom: 2px solid #8b6f47; padding-bottom: 5px;">Экономические показатели</h2>
                <table style="width: 100%; border-collapse: collapse; page-break-inside: avoid;">
                    <tr style="background: #8b6f47; color: white;">
                        <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Показатель</th>
                        <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Значение</th>
                    </tr>
                    <tr style="background: #fff;">
                        <td style="padding: 8px; border: 1px solid #ddd;">Единовременные затраты</td>
                        <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${calc.installation_cost_total.toLocaleString()} руб</td>
                    </tr>
                    <tr style="background: #f8f9fa;">
                        <td style="padding: 8px; border: 1px solid #ddd;">Эксплуатация в день</td>
                        <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${calc.daily_operation_cost.toLocaleString()} руб</td>
                    </tr>
                    <tr style="background: #fff;">
                        <td style="padding: 8px; border: 1px solid #ddd;">Обслуживание в день</td>
                        <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${calc.daily_maintenance_cost.toLocaleString()} руб</td>
                    </tr>
                    <tr style="background: #d4edda;">
                        <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">ИТОГО в день</td>
                        <td style="padding: 8px; text-align: right; border: 1px solid #ddd; font-weight: bold;">${calc.daily_total_costs.toLocaleString()} руб</td>
                    </tr>
        `;
        
        if (calc.roi_days > 0 && !hasPriceRequest) {
            html += `
                    <tr style="background: #f8f9fa;">
                        <td style="padding: 8px; border: 1px solid #ddd;">Окупаемость</td>
                        <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">~${calc.roi_days} дней</td>
                    </tr>
            `;
        }
        
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
        
        // Производительность станков
        if (calc.equipment_list && calc.equipment_list.length > 0) {
            html += `
                <div style="margin-bottom: 30px; padding-top: 10px; page-break-inside: avoid;">
                    <h2 style="font-size: 18px; color: #8b6f47; margin-bottom: 15px; border-bottom: 2px solid #8b6f47; padding-bottom: 5px;">Производительность станков</h2>
                    <table style="width: 100%; border-collapse: collapse; page-break-inside: avoid;">
                        <tr style="background: #8b6f47; color: white;">
                            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Станок</th>
                            <th style="padding: 8px; text-align: right; border: 1px solid #ddd;">Производительность (м³/смену)</th>
                        </tr>
            `;
            calc.equipment_list.forEach((eq, idx) => {
                html += `
                        <tr style="background: ${idx % 2 === 0 ? '#fff' : '#f8f9fa'};">
                            <td style="padding: 6px; border: 1px solid #ddd;">${eq.name}</td>
                            <td style="padding: 6px; text-align: right; border: 1px solid #ddd;">${eq.production.toFixed(2)}</td>
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
        
        // Конвертируем HTML в canvas с учетом разрывов страниц
        const canvas = await html2canvas(tempDiv, {
            scale: 2,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff',
            windowWidth: 800,
            windowHeight: tempDiv.scrollHeight
        });
        
        // Удаляем временный элемент
        document.body.removeChild(tempDiv);
        
        // Создаем PDF из canvas с правильным разбиением на страницы
        const { jsPDF } = window.jspdf;
        const imgData = canvas.toDataURL('image/png', 1.0);
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgWidth = 210; // A4 width in mm
        const pageHeight = 297; // A4 height in mm
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        let heightLeft = imgHeight;
        let position = 0;
        
        // Добавляем первую страницу
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
        
        // Добавляем остальные страницы если нужно
        while (heightLeft > 0) {
            position = heightLeft - imgHeight;
            pdf.addPage();
            pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;
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
document.addEventListener('DOMContentLoaded', () => {
    factoryDesignerInstance = new FactoryDesigner();
    window.factoryDesigner = factoryDesignerInstance;
});

