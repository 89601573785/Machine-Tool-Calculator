// Связи между станками с выбором конвейера из каталога
class ConnectionManager {
    constructor(workspace) {
        this.workspace = workspace;
        this.connections = [];
        this.selectedStations = [];
        this.designer = null;
        this.pendingConnection = null;
        this.lastConveyorCatalogId = window.CatalogMeta?.DEFAULT_CONVEYOR_ID || 48;
    }

    setDesigner(designer) {
        this.designer = designer;
    }

    getStationElementById(stationId) {
        return this.workspace.querySelector(`[data-placement-id="${stationId}"]`);
    }

    getConveyorList() {
        const all = this.designer?.allEquipment || [];
        return all.filter(eq => eq.catalogType === 'conveyor');
    }

    getConveyorById(catalogId) {
        return (this.designer?.allEquipment || []).find(eq => eq.id === catalogId) || null;
    }

    getPlacementMeta(stationId) {
        const el = this.getStationElementById(stationId);
        if (!el) return null;
        return {
            input_type: el.dataset.inputType || '',
            output_type: el.dataset.outputType || '',
            name: (el.querySelector('h4')?.textContent || '').trim()
        };
    }

    canConnect(stationId1, stationId2, options = {}) {
        if (stationId1 === stationId2) {
            return { ok: false, message: 'Нельзя соединить станок сам с собой' };
        }

        const el1 = this.getStationElementById(stationId1);
        const el2 = this.getStationElementById(stationId2);
        if (!el1 || !el2) {
            return { ok: false, message: 'Один из станков не найден на рабочей области' };
        }

        if (el1.dataset.catalogType === 'conveyor' || el2.dataset.catalogType === 'conveyor') {
            return { ok: false, message: 'Конвейер размещается на связи, а не как отдельный станок' };
        }

        // Совместимость типов отключена по требованию: связь разрешается между любыми станками.

        return { ok: true };
    }

    selectStation(element) {
        const placementId = parseInt(element.dataset.placementId, 10);
        if (isNaN(placementId)) return;

        const isAlreadySelected = this.selectedStations.some(s => s.element === element);
        if (isAlreadySelected) {
            this.selectedStations = this.selectedStations.filter(s => s.element !== element);
            element.classList.remove('selected');
            return;
        }

        element.classList.add('selected');
        this.selectedStations.push({ element, stationId: placementId });

        if (this.selectedStations.length === 2) {
            this.createConnectionAutomatically();
        }
    }

    async createConnectionAutomatically() {
        const [station1, station2] = this.selectedStations;
        await this.createConnection(station1.stationId, station2.stationId);
        setTimeout(() => this.clearSelection(), 300);
    }

    clearSelection() {
        this.selectedStations.forEach(station => station.element.classList.remove('selected'));
        this.selectedStations = [];
        if (this.designer) this.designer.selectedPlacementId = null;
    }

    showConveyorPickerModal(onSelect, onCancel) {
        const modal = document.getElementById('conveyorPickerModal');
        const list = document.getElementById('conveyorPickerList');
        if (!modal || !list) {
            const fallback = this.getConveyorById(this.lastConveyorCatalogId);
            if (onSelect) onSelect(fallback?.id || this.lastConveyorCatalogId);
            return;
        }

        const conveyors = this.getConveyorList();
        list.innerHTML = '';
        if (conveyors.length === 0) {
            list.innerHTML = '<p style="padding:1rem;color:#666;">Конвейеры не найдены в каталоге.</p>';
        } else {
            conveyors.forEach(cv => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'conveyor-picker-item' + (cv.id === this.lastConveyorCatalogId ? ' selected' : '');
                const price = cv.cost > 0 ? `${cv.cost.toLocaleString()} руб` : (cv.price || 'Цена по запросу');
                const power = cv.power_consumption ? `${cv.power_consumption} кВт` : '—';
                const size = (cv.width && cv.length && cv.height) ? `${cv.width}×${cv.length}×${cv.height} м` : '—';
                const speed = cv.speed ? `${cv.speed} м/с` : '—';
                btn.innerHTML = `
                    <div class="conveyor-picker-item__head">
                        <strong>${cv.name}</strong>
                        <span>${price}</span>
                    </div>
                    <div class="conveyor-picker-item__meta">
                        <span><i class="fas fa-bolt"></i> ${power}</span>
                        <span><i class="fas fa-ruler"></i> ${size}</span>
                        <span><i class="fas fa-gauge-high"></i> ${speed}</span>
                    </div>
                `;
                btn.addEventListener('click', () => {
                    this.lastConveyorCatalogId = cv.id;
                    modal.style.display = 'none';
                    if (onSelect) onSelect(cv.id);
                });
                list.appendChild(btn);
            });
        }

        const close = () => {
            modal.style.display = 'none';
            if (onCancel) onCancel();
        };

        document.getElementById('conveyorPickerClose')?.addEventListener('click', close, { once: true });
        document.getElementById('conveyorPickerCancel')?.addEventListener('click', close, { once: true });
        modal.style.display = 'block';
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    removeConnection(connectionId) {
        const connection = this.connections.find(c => c.id === connectionId);
        if (connection) {
            if (connection._cleanup) connection._cleanup();
            if (connection.element) connection.element.remove();
        }
        this.connections = this.connections.filter(c => c.id !== connectionId);
    }

    showConnectionContextMenu(connectionId, x, y) {
        const existing = document.getElementById('connectionContextMenu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.id = 'connectionContextMenu';
        menu.className = 'connection-context-menu';
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.innerHTML = `
            <button type="button" data-action="change">Сменить конвейер</button>
            <button type="button" data-action="delete" class="danger">Удалить связь</button>
        `;
        document.body.appendChild(menu);

        menu.querySelector('[data-action="change"]').addEventListener('click', () => {
            menu.remove();
            const conn = this.connections.find(c => c.id === connectionId);
            if (!conn) return;
            this.showConveyorPickerModal(catalogId => {
                conn.conveyorCatalogId = catalogId;
                const cv = this.getConveyorById(catalogId);
                conn.conveyorName = cv?.name || 'Конвейер';
                this.drawConnection(conn);
                this.showNotification('Конвейер обновлён', 'success');
            });
        });

        menu.querySelector('[data-action="delete"]').addEventListener('click', () => {
            menu.remove();
            this.removeConnection(connectionId);
            this.showNotification('Соединение удалено', 'success');
        });

        setTimeout(() => {
            document.addEventListener('click', function handler(e) {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', handler);
                }
            });
        }, 50);
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

    createConnection(fromId, toId, fromSide, toSide, options = {}) {
        const opts = typeof options === 'object' && options !== null ? options : {};
        const can = this.canConnect(fromId, toId, { ignoreCompatibility: opts.ignoreCompatibility === true });
        if (!can.ok) {
            this.showNotification(can.message, 'error');
            return Promise.resolve({ created: false, reason: can.message });
        }

        const existing = this.connections.find(conn =>
            conn.fromId === fromId && conn.toId === toId
        );
        if (existing) {
            this.showNotification('Соединение уже существует', 'warning');
            return Promise.resolve({ created: false, reason: 'exists' });
        }

        const finish = (conveyorCatalogId) => {
            const cv = this.getConveyorById(conveyorCatalogId);
            const connectionId = Date.now() + Math.floor(Math.random() * 1000);
            const connection = {
                id: connectionId,
                fromId,
                toId,
                fromSide: fromSide || 'right',
                toSide: toSide || 'left',
                type: 'material_flow',
                conveyorCatalogId: conveyorCatalogId || null,
                conveyorName: cv?.name || null
            };
            if (conveyorCatalogId) this.lastConveyorCatalogId = conveyorCatalogId;
            this.connections.push(connection);
            this.drawConnection(connection);
            this.showNotification(`Связь создана${cv ? ': ' + cv.name : ''}`, 'success');
            return { created: true, id: connectionId };
        };

        if (opts.skipModal && opts.conveyorCatalogId != null) {
            return Promise.resolve(finish(opts.conveyorCatalogId));
        }

        return new Promise(resolve => {
            this.showConveyorPickerModal(
                catalogId => resolve(finish(catalogId)),
                () => resolve({ created: false, reason: 'cancelled' })
            );
        });
    }

    buildOrthogonalPath(x1, y1, x2, y2, startDir, endDir) {
        if (x1 === x2 || y1 === y2) return `M ${x1} ${y1} L ${x2} ${y2}`;
        if (startDir === 'h' && endDir === 'v') return `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`;
        if (startDir === 'v' && endDir === 'h') return `M ${x1} ${y1} L ${x1} ${y2} L ${x2} ${y2}`;
        if (startDir === 'h' && endDir === 'h') {
            const midX = (x1 + x2) / 2;
            return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
        }
        const midY = (y1 + y2) / 2;
        return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
    }

    drawConnection(connection) {
        const fromElement = this.getStationElementById(connection.fromId);
        const toElement = this.getStationElementById(connection.toId);
        if (!fromElement || !toElement) return;

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
                x1 = fromLeft + fromWidth; y1 = fromCenterY;
                x2 = toLeft; y2 = toCenterY;
            } else {
                x1 = fromLeft; y1 = fromCenterY;
                x2 = toLeft + toWidth; y2 = toCenterY;
            }
        } else if (dy > 0) {
            x1 = fromCenterX; y1 = fromTop + fromHeight;
            x2 = toCenterX; y2 = toTop;
        } else {
            x1 = fromCenterX; y1 = fromTop;
            x2 = toCenterX; y2 = toTop + toHeight;
        }

        if (connection.element) {
            if (connection._cleanup) connection._cleanup();
            connection.element.remove();
        }

        const hasConveyor = !!connection.conveyorCatalogId;
        const strokeColor = hasConveyor ? '#e67e22' : '#28a745';
        const label = connection.conveyorName || (hasConveyor ? 'Конвейер' : '');

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'connection-line' + (hasConveyor ? ' connection-line--conveyor' : ''));
        Object.assign(svg.style, {
            position: 'absolute', left: '0', top: '0', width: '100%', height: '100%',
            pointerEvents: 'none', zIndex: '5'
        });
        svg.setAttribute('data-connection-id', connection.id);

        const w = this.workspace.offsetWidth || 8000;
        const h = this.workspace.offsetHeight || 6000;
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        svg.setAttribute('preserveAspectRatio', 'none');

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.id = `arrowhead-${connection.id}`;
        marker.setAttribute('viewBox', '0 0 10 10');
        marker.setAttribute('refX', '10');
        marker.setAttribute('refY', '5');
        marker.setAttribute('markerWidth', '4');
        marker.setAttribute('markerHeight', '4');
        marker.setAttribute('orient', 'auto');
        marker.setAttribute('markerUnits', 'strokeWidth');
        const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        arrowPath.setAttribute('d', 'M 0,0 L 10,5 L 0,10 Z');
        arrowPath.setAttribute('fill', strokeColor);
        marker.appendChild(arrowPath);
        defs.appendChild(marker);
        svg.appendChild(defs);

        const EPS = 0.01;
        const startDir = (Math.abs(x1 - fromLeft) < EPS || Math.abs(x1 - (fromLeft + fromWidth)) < EPS) ? 'h' : 'v';
        const endDir = (Math.abs(x2 - toLeft) < EPS || Math.abs(x2 - (toLeft + toWidth)) < EPS) ? 'h' : 'v';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', this.buildOrthogonalPath(x1, y1, x2, y2, startDir, endDir));
        path.setAttribute('stroke', strokeColor);
        path.setAttribute('stroke-width', hasConveyor ? '5' : '4');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('marker-end', `url(#arrowhead-${connection.id})`);
        path.style.cursor = 'pointer';
        path.style.pointerEvents = 'stroke';

        const onContextMenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showConnectionContextMenu(connection.id, e.clientX, e.clientY);
        };
        path.addEventListener('contextmenu', onContextMenu);

        svg.appendChild(path);

        if (label) {
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            const labelWidth = Math.min(300, Math.max(140, Math.ceil(label.length * 5.6)));
            const labelHeight = label.length > 24 ? 44 : 30;

            const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
            fo.setAttribute('x', String(midX - labelWidth / 2));
            fo.setAttribute('y', String(midY - labelHeight / 2));
            fo.setAttribute('width', String(labelWidth));
            fo.setAttribute('height', String(labelHeight));
            fo.style.pointerEvents = 'all';
            fo.style.overflow = 'visible';

            const labelWrap = document.createElement('div');
            labelWrap.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
            labelWrap.className = 'connection-conveyor-label';
            labelWrap.title = `${label}\nПКМ: сменить или удалить связь`;
            labelWrap.innerHTML = `<i class="fas fa-arrows-alt-h"></i><span class="connection-conveyor-label__text">${this.escapeHtml(label)}</span>`;
            labelWrap.addEventListener('contextmenu', onContextMenu);
            fo.appendChild(labelWrap);
            svg.appendChild(fo);

            connection._cleanup = () => {
                path.removeEventListener('contextmenu', onContextMenu);
                labelWrap.removeEventListener('contextmenu', onContextMenu);
            };
        } else {
            connection._cleanup = () => path.removeEventListener('contextmenu', onContextMenu);
        }

        this.workspace.appendChild(svg);
        connection.element = svg;
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
                position: 'fixed', top: '72px', right: '20px', zIndex: '10000',
                display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '12px'
            });
            document.body.appendChild(container);
        }
        const notification = document.createElement('div');
        notification.textContent = message;
        Object.assign(notification.style, {
            padding: '1rem 1.5rem', borderRadius: '8px', color: 'white', fontWeight: '500',
            maxWidth: '320px', wordWrap: 'break-word', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            backgroundColor: { success: '#28a745', error: '#dc3545', warning: '#ffc107', info: '#17a2b8' }[type] || '#17a2b8'
        });
        container.insertBefore(notification, container.firstChild);
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transition = 'opacity 0.2s ease';
            setTimeout(() => notification.remove(), 200);
        }, 2500);
    }
}

window.ConnectionManager = ConnectionManager;
