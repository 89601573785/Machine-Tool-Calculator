// Модуль для работы с соединениями между станками (standalone версия)
class ConnectionManager {
    constructor(workspace) {
        this.workspace = workspace;
        this.connections = [];
        this.selectedStations = [];
    }
    
    getStationElementById(stationId) {
        // stationId — это ID экземпляра на поле (placementId)
        return this.workspace.querySelector(`[data-placement-id="${stationId}"]`);
    }
    
    canConnect(stationId1, stationId2) {
        if (stationId1 === stationId2) {
            return { ok: false, message: 'Нельзя соединить станок сам с собой' };
        }
        
        const el1 = this.getStationElementById(stationId1);
        const el2 = this.getStationElementById(stationId2);
        if (!el1 || !el2) {
            return { ok: false, message: 'Один из станков не найден на рабочей области' };
        }
        
        const row1 = parseInt(el1.dataset.equipmentRow || '0', 10);
        const row2 = parseInt(el2.dataset.equipmentRow || '0', 10);
        const safeRow1 = Number.isFinite(row1) ? row1 : 0;
        const safeRow2 = Number.isFinite(row2) ? row2 : 0;
        const name1 = (el1.querySelector('h4')?.textContent || '').trim();
        const name2 = (el2.querySelector('h4')?.textContent || '').trim();
        
        // Ограничение: станки из 1 ряда нельзя соединять друг с другом (но можно соединять с другими рядами)
        if (safeRow1 === 1 && safeRow2 === 1) {
            return { ok: false, message: `Нельзя соединить: оба станка из 1 ряда (ряды: ${safeRow1} и ${safeRow2}) — "${name1}" ↔ "${name2}"` };
        }
        
        return { ok: true };
    }

    selectStation(element) {
        const placementId = parseInt(element.dataset.placementId, 10);
        if (isNaN(placementId)) {
            console.error('Неверный ID экземпляра при выборе станции:', element.dataset.placementId);
            return;
        }
        const isAlreadySelected = this.selectedStations.some(s => s.element === element);
        
        if (isAlreadySelected) {
            this.selectedStations = this.selectedStations.filter(s => s.element !== element);
            element.classList.remove('selected');
            return;
        }
        
        element.classList.add('selected');
        this.selectedStations.push({
            element: element,
            stationId: placementId
        });
        
        if (this.selectedStations.length === 2) {
            this.createConnectionAutomatically();
        }
    }
    
    async createConnectionAutomatically() {
        const [station1, station2] = this.selectedStations;
        const result = await this.createConnection(station1.stationId, station2.stationId);
        if (result && result.created) {
            this.showNotification('Соединение создано', 'success');
        }
        
        setTimeout(() => {
            this.clearSelection();
        }, 500);
    }
    
    clearSelection() {
        this.selectedStations.forEach(station => {
            station.element.classList.remove('selected');
        });
        this.selectedStations = [];
    }

    removeConnection(connectionId) {
        const connection = this.connections.find(c => c.id === connectionId);
        if (connection) {
            if (connection._cleanup) connection._cleanup();
            if (connection.element) connection.element.remove();
        }
        this.connections = this.connections.filter(c => c.id !== connectionId);
    }
    
    showDeleteConfirmation(connectionId, x, y) {
        // Удаляем предыдущее модальное окно, если есть
        const existingModal = document.getElementById('deleteConnectionModal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Создаем модальное окно
        const modal = document.createElement('div');
        modal.id = 'deleteConnectionModal';
        modal.style.position = 'fixed';
        modal.style.left = `${x}px`;
        modal.style.top = `${y}px`;
        modal.style.zIndex = '10000';
        modal.style.background = 'white';
        modal.style.border = '2px solid #dc3545';
        modal.style.borderRadius = '8px';
        modal.style.padding = '15px';
        modal.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        modal.style.minWidth = '200px';
        modal.style.fontFamily = 'Arial, sans-serif';
        
        modal.innerHTML = `
            <div style="margin-bottom: 12px; font-weight: bold; color: #dc3545;">
                Удалить соединение?
            </div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="deleteConnectionYes" style="
                    padding: 6px 16px;
                    background: #dc3545;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                ">Да</button>
                <button id="deleteConnectionNo" style="
                    padding: 6px 16px;
                    background: #6c757d;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                ">Нет</button>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Обработчики кнопок
        document.getElementById('deleteConnectionYes').addEventListener('click', () => {
            this.removeConnection(connectionId);
            modal.remove();
            this.showNotification('Соединение удалено', 'success');
        });
        
        document.getElementById('deleteConnectionNo').addEventListener('click', () => {
            modal.remove();
        });
        
        // Закрытие при клике вне модального окна
        const closeOnOutsideClick = (e) => {
            if (!modal.contains(e.target)) {
                modal.remove();
                document.removeEventListener('click', closeOnOutsideClick);
            }
        };
        
        setTimeout(() => {
            document.addEventListener('click', closeOnOutsideClick);
        }, 100);
    }
    
    removeConnectionsForEquipment(stationId) {
        this.connections.forEach(conn => {
            if (conn.fromId === stationId || conn.toId === stationId) {
                if (conn._cleanup) conn._cleanup();
                if (conn.element) conn.element.remove();
            }
        });
        this.connections = this.connections.filter(conn => conn.fromId !== stationId && conn.toId !== stationId);
    }
    
    async createConnection(fromId, toId, fromSide, toSide) {
        const can = this.canConnect(fromId, toId);
        if (!can.ok) {
            this.showNotification(can.message, 'error');
            return { created: false, reason: can.message };
        }
        
        const existing = this.connections.find(conn => 
            (conn.fromId === fromId && conn.toId === toId) ||
            (conn.fromId === toId && conn.toId === fromId)
        );
        if (existing) {
            this.showNotification('Соединение уже существует', 'warning');
            return { created: false, reason: 'exists' };
        }
        
        const connectionId = Date.now();
        const connection = {
            id: connectionId,
            fromId: fromId,
            toId: toId,
            fromSide: fromSide || 'right',
            toSide: toSide || 'left',
            type: 'material_flow'
        };

        this.connections.push(connection);
        this.drawConnection(connection);
        return { created: true, id: connectionId };
    }

    buildOrthogonalPath(x1, y1, x2, y2, startDir, endDir) {
        // startDir / endDir: 'h' (горизонтально) или 'v' (вертикально)
        // Цель: первый сегмент выходит из нужной стороны, последний сегмент входит в нужную сторону.
        // Если точки уже на одной линии — рисуем прямую.
        if (x1 === x2 || y1 === y2) {
            return `M ${x1} ${y1} L ${x2} ${y2}`;
        }

        // Если направления разные — можно обойтись одним углом
        if (startDir === 'h' && endDir === 'v') {
            return `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`;
        }
        if (startDir === 'v' && endDir === 'h') {
            return `M ${x1} ${y1} L ${x1} ${y2} L ${x2} ${y2}`;
        }

        // Если направления одинаковые — нужен “заведомо правильный” двухугольный путь
        if (startDir === 'h' && endDir === 'h') {
            const midX = (x1 + x2) / 2;
            return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
        }
        // startDir === 'v' && endDir === 'v'
        const midY = (y1 + y2) / 2;
        return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
    }

    drawConnection(connection) {
        const fromElement = this.getStationElementById(connection.fromId);
        const toElement = this.getStationElementById(connection.toId);
        
        if (!fromElement || !toElement) {
            return;
        }

        const fromLeft = fromElement.offsetLeft;
        const fromTop = fromElement.offsetTop;
        const fromWidth = fromElement.offsetWidth || 120;
        const fromHeight = fromElement.offsetHeight || 200;
        
        const toLeft = toElement.offsetLeft;
        const toTop = toElement.offsetTop;
        const toWidth = toElement.offsetWidth || 120;
        const toHeight = toElement.offsetHeight || 200;
        
        const fromCenterX = fromLeft + fromWidth / 2;
        const fromCenterY = fromTop + fromHeight / 2;
        const toCenterX = toLeft + toWidth / 2;
        const toCenterY = toTop + toHeight / 2;
        
        const dx = toCenterX - fromCenterX;
        const dy = toCenterY - fromCenterY;
        
        let x1, y1, x2, y2;
        
        if (Math.abs(dx) > Math.abs(dy)) {
            if (dx > 0) {
                x1 = fromLeft + fromWidth;
                y1 = fromCenterY;
                x2 = toLeft;
                y2 = toCenterY;
            } else {
                x1 = fromLeft;
                y1 = fromCenterY;
                x2 = toLeft + toWidth;
                y2 = toCenterY;
            }
        } else {
            if (dy > 0) {
                x1 = fromCenterX;
                y1 = fromTop + fromHeight;
                x2 = toCenterX;
                y2 = toTop;
            } else {
                x1 = fromCenterX;
                y1 = fromTop;
                x2 = toCenterX;
                y2 = toTop + toHeight;
            }
        }

        if (connection.element) {
            if (connection._cleanup) connection._cleanup();
            connection.element.remove();
        }

        // Создаем маркер стрелки если его еще нет
        this.createArrowMarker();
        
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'connection-line');
        svg.style.position = 'absolute';
        svg.style.left = '0';
        svg.style.top = '0';
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.style.pointerEvents = 'auto'; // Разрешаем события для удаления
        svg.style.zIndex = '5';
        svg.setAttribute('data-connection-id', connection.id);
        
        const w = this.workspace.offsetWidth || 8000;
        const h = this.workspace.offsetHeight || 6000;
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        
        // Добавляем defs с маркером в этот SVG
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.id = `arrowhead-${connection.id}`;
        // Компактная стрелка, масштабируется от толщины линии
        marker.setAttribute('viewBox', '0 0 10 10');
        marker.setAttribute('refX', '10');
        marker.setAttribute('refY', '5');
        marker.setAttribute('markerWidth', '4');
        marker.setAttribute('markerHeight', '4');
        marker.setAttribute('orient', 'auto');
        marker.setAttribute('markerUnits', 'strokeWidth');
        
        const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        arrowPath.setAttribute('d', 'M 0,0 L 10,5 L 0,10 Z');
        arrowPath.setAttribute('fill', '#28a745');
        arrowPath.setAttribute('stroke', '#ffffff');
        arrowPath.setAttribute('stroke-width', '0.9');
        marker.appendChild(arrowPath);
        defs.appendChild(marker);
        svg.appendChild(defs);

        // Определяем направления “выхода” и “входа” по выбранным сторонам точек.
        // Если точка на левом/правом ребре — горизонтальное направление, иначе вертикальное.
        const EPS = 0.01;
        const startDir = (Math.abs(x1 - fromLeft) < EPS || Math.abs(x1 - (fromLeft + fromWidth)) < EPS) ? 'h' : 'v';
        const endDir = (Math.abs(x2 - toLeft) < EPS || Math.abs(x2 - (toLeft + toWidth)) < EPS) ? 'h' : 'v';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const pathData = this.buildOrthogonalPath(x1, y1, x2, y2, startDir, endDir);
        path.setAttribute('d', pathData);
        path.setAttribute('stroke', '#28a745');
        path.setAttribute('stroke-width', '4');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('marker-end', `url(#arrowhead-${connection.id})`); // Добавляем стрелку
        path.setAttribute('data-connection-id', connection.id);
        path.style.cursor = 'pointer';
        path.style.pointerEvents = 'auto'; // Делаем линию кликабельной
        
        const onContextMenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showDeleteConfirmation(connection.id, e.clientX, e.clientY);
        };
        path.addEventListener('contextmenu', onContextMenu);
        
        svg.appendChild(path);
        this.workspace.appendChild(svg);
        connection.element = svg;
        connection._cleanup = () => {
            path.removeEventListener('contextmenu', onContextMenu);
        };
    }
    
    createArrowMarker() {
        // Проверяем, есть ли уже маркер в workspace или в body
        let existingMarker = document.getElementById('arrowhead-marker');
        if (existingMarker) return;
        
        // Создаем SVG для маркера
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.position = 'absolute';
        svg.style.width = '0';
        svg.style.height = '0';
        svg.style.overflow = 'hidden';
        svg.style.pointerEvents = 'none';
        svg.id = 'arrowhead-marker';
        
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        
        marker.id = 'arrowhead';
        marker.setAttribute('viewBox', '0 0 12 12');
        marker.setAttribute('refX', '10');
        marker.setAttribute('refY', '6');
        marker.setAttribute('markerWidth', '10');
        marker.setAttribute('markerHeight', '10');
        marker.setAttribute('orient', 'auto');
        marker.setAttribute('markerUnits', 'userSpaceOnUse');
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M 0,0 L 10,6 L 0,12 Z');
        path.setAttribute('fill', '#28a745');
        path.setAttribute('stroke', '#ffffff');
        path.setAttribute('stroke-width', '0.5');
        
        marker.appendChild(path);
        defs.appendChild(marker);
        svg.appendChild(defs);
        
        // Добавляем маркер в workspace, чтобы он был в том же SVG контексте
        if (this.workspace) {
            this.workspace.appendChild(svg);
        } else {
            document.body.appendChild(svg);
        }
    }

    clearAllConnections() {
        this.connections.forEach(connection => {
            if (connection._cleanup) connection._cleanup();
            if (connection.element) connection.element.remove();
        });
        this.connections = [];
    }

    showNotification(message, type = 'info') {
        let container = document.getElementById('notifications-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notifications-container';
            Object.assign(container.style, {
                position: 'fixed',
                top: '20px',
                right: '20px',
                zIndex: '10000',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: '12px'
            });
            document.body.appendChild(container);
        }

        const notification = document.createElement('div');
        notification.textContent = message;

        Object.assign(notification.style, {
            padding: '1rem 1.5rem',
            borderRadius: '8px',
            color: 'white',
            fontWeight: '500',
            maxWidth: '300px',
            wordWrap: 'break-word',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
        });

        const colors = {
            success: '#28a745',
            error: '#dc3545',
            warning: '#ffc107',
            info: '#17a2b8'
        };
        notification.style.backgroundColor = colors[type] || colors.info;

        if (container.firstChild) {
            container.insertBefore(notification, container.firstChild);
        } else {
            container.appendChild(notification);
        }

        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transition = 'opacity 0.2s ease';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 200);
        }, 2000);
    }
}

window.ConnectionManager = ConnectionManager;

