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

        const emptyBtn = document.createElement('button');
        emptyBtn.type = 'button';
        emptyBtn.className = 'conveyor-picker-item conveyor-picker-item--empty';
        emptyBtn.innerHTML = `
            <div class="conveyor-picker-item__head">
                <strong><i class="fas fa-minus"></i> Без конвейера</strong>
                <span>Пустое соединение</span>
            </div>
            <div class="conveyor-picker-item__meta">
                <span>Только связь станков, без транспортёра в расчёте</span>
            </div>
        `;
        emptyBtn.addEventListener('click', () => {
            modal.style.display = 'none';
            if (onSelect) onSelect(null);
        });
        list.appendChild(emptyBtn);

        if (conveyors.length === 0) {
            const note = document.createElement('p');
            note.style.cssText = 'padding:0.75rem 1rem;color:#666;font-size:0.9rem;';
            note.textContent = 'В каталоге нет конвейеров — можно использовать пустое соединение.';
            list.appendChild(note);
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
        this.redrawAllConnections();
        this.designer?.markProjectDirty?.();
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
                conn.conveyorCatalogId = catalogId ?? null;
                if (catalogId == null) {
                    conn.conveyorName = null;
                    this.showNotification('Соединение без конвейера', 'success');
                } else {
                    const cv = this.getConveyorById(catalogId);
                    conn.conveyorName = cv?.name || 'Конвейер';
                    this.showNotification('Конвейер обновлён', 'success');
                }
                this.redrawAllConnections();
                this.designer?.markProjectDirty?.();
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
        const silent = !!opts.silent;
        const can = this.canConnect(fromId, toId, { ignoreCompatibility: opts.ignoreCompatibility === true });
        if (!can.ok) {
            if (!silent) this.showNotification(can.message, 'error');
            return Promise.resolve({ created: false, reason: can.message });
        }

        const existing = this.connections.find(conn =>
            conn.fromId === fromId && conn.toId === toId
        );
        if (existing) {
            if (!silent) this.showNotification('Соединение уже существует', 'warning');
            return Promise.resolve({ created: false, reason: 'exists' });
        }

        const finish = (conveyorCatalogId) => {
            const hasConveyor = conveyorCatalogId != null && conveyorCatalogId !== '';
            const cv = hasConveyor ? this.getConveyorById(conveyorCatalogId) : null;
            const connectionId = Date.now() + Math.floor(Math.random() * 1000);
            const connection = {
                id: connectionId,
                fromId,
                toId,
                fromSide: fromSide || 'right',
                toSide: toSide || 'left',
                type: 'material_flow',
                conveyorCatalogId: hasConveyor ? conveyorCatalogId : null,
                conveyorName: hasConveyor ? (cv?.name || 'Конвейер') : null
            };
            if (hasConveyor) this.lastConveyorCatalogId = conveyorCatalogId;
            this.connections.push(connection);
            if (!opts._deferRedraw) {
                this.redrawAllConnections();
            }
            if (!opts.silent) {
                const msg = hasConveyor && cv
                    ? `Связь создана: ${cv.name}`
                    : (hasConveyor ? 'Связь создана' : 'Связь создана (без конвейера)');
                this.showNotification(msg, 'success');
            }
            this.designer?.markProjectDirty?.();
            return { created: true, id: connectionId };
        };

        if (opts.skipModal && ('conveyorCatalogId' in opts)) {
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

    getElementCenter(stationId) {
        const el = this.getStationElementById(stationId);
        if (!el) return null;
        return {
            x: el.offsetLeft + (el.offsetWidth || 120) / 2,
            y: el.offsetTop + (el.offsetHeight || 200) / 2
        };
    }

    prepareConnectionLayout() {
        for (const conn of this.connections) {
            const fromEl = this.getStationElementById(conn.fromId);
            const toEl = this.getStationElementById(conn.toId);
            if (!fromEl || !toEl) continue;
            const sides = this.resolveConnectionSides(fromEl, toEl, conn);
            conn._fromSide = sides.fromSide;
            conn._toSide = sides.toSide;
        }

        const outBySide = new Map();
        const inBySide = new Map();
        const outByFrom = new Map();

        for (const conn of this.connections) {
            const fromKey = `${conn.fromId}:${conn._fromSide}`;
            if (!outBySide.has(fromKey)) outBySide.set(fromKey, []);
            outBySide.get(fromKey).push(conn);

            const toKey = `${conn.toId}:${conn._toSide}`;
            if (!inBySide.has(toKey)) inBySide.set(toKey, []);
            inBySide.get(toKey).push(conn);

            if (!outByFrom.has(conn.fromId)) outByFrom.set(conn.fromId, []);
            outByFrom.get(conn.fromId).push(conn);
        }

        const byTargetAngle = (a, b) => {
            const fc = this.getElementCenter(a.fromId);
            const ta = this.getElementCenter(a.toId);
            const tb = this.getElementCenter(b.toId);
            if (!fc || !ta || !tb) return 0;
            return Math.atan2(ta.y - fc.y, ta.x - fc.x) - Math.atan2(tb.y - fc.y, tb.x - fc.x);
        };
        const bySourceAngle = (a, b) => {
            const tc = this.getElementCenter(a.toId);
            const fa = this.getElementCenter(a.fromId);
            const fb = this.getElementCenter(b.fromId);
            if (!tc || !fa || !fb) return 0;
            return Math.atan2(fa.y - tc.y, fa.x - tc.x) - Math.atan2(fb.y - tc.y, fb.x - tc.x);
        };

        for (const list of outBySide.values()) {
            list.sort(byTargetAngle);
            const n = list.length;
            list.forEach((conn, i) => {
                conn._fromPortIndex = i;
                conn._fromPortCount = n;
            });
        }

        for (const list of inBySide.values()) {
            list.sort(bySourceAngle);
            const n = list.length;
            list.forEach((conn, i) => {
                conn._toPortIndex = i;
                conn._toPortCount = n;
            });
        }

        for (const list of outByFrom.values()) {
            list.sort(byTargetAngle);
            const n = list.length;
            list.forEach((conn, i) => {
                conn._laneIndex = i;
                conn._laneCount = n;
            });
        }

        for (const conn of this.connections) {
            conn._fromPortIndex = conn._fromPortIndex ?? 0;
            conn._fromPortCount = conn._fromPortCount ?? 1;
            conn._toPortIndex = conn._toPortIndex ?? 0;
            conn._toPortCount = conn._toPortCount ?? 1;
            conn._laneIndex = conn._laneIndex ?? 0;
            conn._laneCount = conn._laneCount ?? 1;
        }
    }

    getSidePoint(element, side, portIndex, portCount) {
        const left = element.offsetLeft;
        const top = element.offsetTop;
        const w = element.offsetWidth || 120;
        const h = element.offsetHeight || 200;
        const cx = left + w / 2;
        const cy = top + h / 2;
        const spreadAxis = (side === 'left' || side === 'right') ? h : w;
        const maxSpread = Math.min(120, Math.max(36, spreadAxis * 0.55));
        const step = portCount > 1 ? maxSpread / (portCount - 1) : 0;
        const offset = portCount > 1 ? (portIndex - (portCount - 1) / 2) * step : 0;

        switch (side) {
            case 'left':
                return { x: left, y: cy + offset, dir: 'h' };
            case 'right':
                return { x: left + w, y: cy + offset, dir: 'h' };
            case 'top':
                return { x: cx + offset, y: top, dir: 'v' };
            case 'bottom':
                return { x: cx + offset, y: top + h, dir: 'v' };
            default:
                return { x: left + w, y: cy + offset, dir: 'h' };
        }
    }

    resolveConnectionSides(fromEl, toEl, conn) {
        const fromCenterX = fromEl.offsetLeft + (fromEl.offsetWidth || 120) / 2;
        const fromCenterY = fromEl.offsetTop + (fromEl.offsetHeight || 200) / 2;
        const toCenterX = toEl.offsetLeft + (toEl.offsetWidth || 120) / 2;
        const toCenterY = toEl.offsetTop + (toEl.offsetHeight || 200) / 2;
        const dx = toCenterX - fromCenterX;
        const dy = toCenterY - fromCenterY;

        const autoHorizontal = Math.abs(dx) >= Math.abs(dy) * 0.55;
        const auto = autoHorizontal
            ? (dx > 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' })
            : (dy > 0 ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' });

        if (!conn.fromSide || !conn.toSide) {
            return auto;
        }

        const wantsHorizontal =
            (conn.fromSide === 'right' && conn.toSide === 'left') ||
            (conn.fromSide === 'left' && conn.toSide === 'right');

        if (wantsHorizontal) {
            if (Math.abs(dy) > Math.abs(dx) * 0.85) return auto;
            if (conn.fromSide === 'right' && dx <= 0) return auto;
            if (conn.fromSide === 'left' && dx >= 0) return auto;
            return { fromSide: conn.fromSide, toSide: conn.toSide };
        }

        return auto;
    }

    buildRoutedPath(x1, y1, x2, y2, startDir, endDir, laneIndex, laneCount) {
        const STUB = 40;
        const LANE = 64;
        const laneShift = laneCount > 1 ? (laneIndex - (laneCount - 1) / 2) * LANE : 0;
        const laneStep = (laneIndex + 1) * 46;

        if (Math.abs(x1 - x2) < 3 && Math.abs(y1 - y2) < 3) {
            return { d: `M ${x1} ${y1} L ${x2} ${y2}`, labelX: x1, labelY: y1 - 18, labelSegLen: 0 };
        }

        if (startDir === 'h' && endDir === 'h') {
            const sign = Math.sign(x2 - x1) || 1;
            const spanX = Math.abs(x2 - x1);
            if (Math.abs(y1 - y2) < 5) {
                const labelY = Math.min(y1, y2) - 22 - Math.abs(laneShift) * 0.15;
                return {
                    d: `M ${x1} ${y1} L ${x2} ${y2}`,
                    labelX: (x1 + x2) / 2,
                    labelY,
                    labelSegLen: spanX
                };
            }
            const midX = (x1 + x2) / 2 + laneShift * sign;
            const d = `M ${x1} ${y1} L ${x1 + sign * STUB} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2 - sign * STUB} ${y2} L ${x2} ${y2}`;
            return { d, labelX: midX, labelY: (y1 + y2) / 2, labelSegLen: Math.abs(y2 - y1) };
        }

        if (startDir === 'v' && endDir === 'v') {
            const sign = Math.sign(y2 - y1) || 1;
            const spanY = Math.abs(y2 - y1);
            if (Math.abs(x1 - x2) < 5) {
                const labelX = Math.min(x1, x2) - 22 - Math.abs(laneShift) * 0.15;
                return {
                    d: `M ${x1} ${y1} L ${x2} ${y2}`,
                    labelX,
                    labelY: (y1 + y2) / 2,
                    labelSegLen: spanY
                };
            }
            const midY = (y1 + y2) / 2 + laneShift * sign;
            const d = `M ${x1} ${y1} L ${x1} ${y1 + sign * STUB} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2 - sign * STUB} L ${x2} ${y2}`;
            return { d, labelX: (x1 + x2) / 2, labelY: midY, labelSegLen: Math.abs(x2 - x1) };
        }

        if (startDir === 'h' && endDir === 'v') {
            const signX = Math.sign(x2 - x1) || 1;
            const signY = Math.sign(y2 - y1) || 1;
            const corridorX = x2 + signX * (STUB + laneStep);
            const d = `M ${x1} ${y1} L ${x1 + signX * STUB} ${y1} L ${corridorX} ${y1} L ${corridorX} ${y2} L ${x2} ${y2}`;
            return {
                d,
                labelX: corridorX + signX * 16,
                labelY: (y1 + y2) / 2,
                labelSegLen: Math.abs(corridorX - x1) + Math.abs(y2 - y1)
            };
        }

        const signY = Math.sign(y2 - y1) || 1;
        const signX = Math.sign(x2 - x1) || 1;
        const corridorY = y1 + signY * (STUB + laneStep);
        const d = `M ${x1} ${y1} L ${x1} ${corridorY} L ${x2} ${corridorY} L ${x2} ${y2}`;
        return {
            d,
            labelX: (x1 + x2) / 2,
            labelY: corridorY + signY * 16,
            labelSegLen: Math.abs(x2 - x1) + Math.abs(corridorY - y1)
        };
    }

    redrawAllConnections() {
        this.prepareConnectionLayout();
        for (const conn of this.connections) {
            this.drawConnection(conn);
        }
    }

    drawConnection(connection) {
        const fromElement = this.getStationElementById(connection.fromId);
        const toElement = this.getStationElementById(connection.toId);
        if (!fromElement || !toElement) return;

        const sides = {
            fromSide: connection._fromSide || 'right',
            toSide: connection._toSide || 'left'
        };
        const fromPt = this.getSidePoint(
            fromElement,
            sides.fromSide,
            connection._fromPortIndex ?? 0,
            connection._fromPortCount ?? 1
        );
        const toPt = this.getSidePoint(
            toElement,
            sides.toSide,
            connection._toPortIndex ?? 0,
            connection._toPortCount ?? 1
        );
        const x1 = fromPt.x;
        const y1 = fromPt.y;
        const x2 = toPt.x;
        const y2 = toPt.y;
        const startDir = fromPt.dir;
        const endDir = toPt.dir;

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
            pointerEvents: 'none', zIndex: String(5 + (connection._laneIndex ?? 0))
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

        const routed = this.buildRoutedPath(
            x1, y1, x2, y2, startDir, endDir,
            connection._laneIndex ?? 0,
            connection._laneCount ?? 1
        );

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', routed.d);
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
        if (label) {
            path.setAttribute('title', `${label}\nПКМ: сменить или удалить связь`);
        }

        svg.appendChild(path);

        const showLabel = label && routed.labelSegLen >= 80;
        if (showLabel) {
            const midX = routed.labelX;
            const midY = routed.labelY;
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
        this.designer?.markProjectDirty?.();
    }

    showNotification(message, type = 'info') {
        if (this.designer?._suppressNotifications) return;
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
