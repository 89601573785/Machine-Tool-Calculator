/**
 * Расширения FactoryDesigner: комплексы, вкладки каталога, расчёт по цепочке.
 */
(function () {
    'use strict';

    if (typeof FactoryDesigner === 'undefined') return;

    FactoryDesigner.prototype.catalogTab = 'all';

    FactoryDesigner.prototype.applyCatalogTabFilter = function (list) {
        const tab = this.catalogTab || 'all';
        if (tab === 'machine') {
            return list.filter(eq => eq.catalogType === 'machine');
        }
        if (tab === 'conveyor') {
            return list.filter(eq => eq.catalogType === 'conveyor');
        }
        if (tab === 'complex') {
            return list.filter(eq => eq.catalogType === 'equipment_complex');
        }
        return list;
    };

    FactoryDesigner.prototype.setupCatalogTabs = function () {
        const tabs = document.querySelectorAll('.catalog-tab');
        if (!tabs.length) return;
        tabs.forEach(btn => {
            btn.addEventListener('click', () => {
                this.catalogTab = btn.dataset.tab || 'all';
                tabs.forEach(b => b.classList.toggle('active', b === btn));
                const search = document.getElementById('equipmentSearch');
                this.filterEquipment(search?.value || '');
            });
        });
    };

    FactoryDesigner.prototype.expandComplex = async function (complexEquipment, dropX, dropY) {
        const template = window.CatalogMeta?.getComplexTemplate(complexEquipment.id);
        if (!template || !template.members?.length) {
            this.showNotification('Шаблон комплекса не найден — размещён как карточка', 'warning');
            this.placeEquipmentInstance(complexEquipment, dropX, dropY);
            return;
        }

        const equipmentById = new Map((this.allEquipment || []).map(eq => [eq.id, eq]));
        const placementIds = new Array(template.members.length).fill(null);

        // Аккуратное построение: уровни графа с равными отступами.
        const indegree = new Array(template.members.length).fill(0);
        const out = new Map();
        (template.connections || []).forEach(link => {
            if (!out.has(link.fromIndex)) out.set(link.fromIndex, []);
            out.get(link.fromIndex).push(link.toIndex);
            indegree[link.toIndex] = (indegree[link.toIndex] || 0) + 1;
        });

        const roots = [];
        indegree.forEach((deg, idx) => {
            if (!deg) roots.push(idx);
        });
        if (!roots.length) roots.push(0);

        const level = new Array(template.members.length).fill(0);
        const queue = [...roots];
        while (queue.length) {
            const node = queue.shift();
            const next = out.get(node) || [];
            next.forEach(to => {
                const cand = level[node] + 1;
                if (cand > level[to]) level[to] = cand;
                queue.push(to);
            });
        }

        const byLevel = new Map();
        level.forEach((lvl, idx) => {
            if (!byLevel.has(lvl)) byLevel.set(lvl, []);
            byLevel.get(lvl).push(idx);
        });
        const levels = [...byLevel.keys()].sort((a, b) => a - b);
        const colGap = 360;
        const rowGap = 240;

        levels.forEach(lvl => {
            const nodes = byLevel.get(lvl);
            const totalHeight = (nodes.length - 1) * rowGap;
            nodes.forEach((memberIndex, rowIndex) => {
                const member = template.members[memberIndex];
                const eq = equipmentById.get(member.catalogId);
                if (!eq) return;
                const x = dropX + lvl * colGap;
                const y = dropY + rowIndex * rowGap - totalHeight / 2;
                const el = this.placeEquipmentInstance(eq, x, y);
                if (el) placementIds[memberIndex] = parseInt(el.dataset.placementId, 10);
            });
        });

        if (this.connectionManager && template.connections) {
            for (const link of template.connections) {
                const fromId = placementIds[link.fromIndex];
                const toId = placementIds[link.toIndex];
                if (!fromId || !toId) continue;
                await this.connectionManager.createConnection(fromId, toId, 'right', 'left', {
                    skipModal: true,
                    conveyorCatalogId: link.conveyorCatalogId || CatalogMeta.DEFAULT_CONVEYOR_ID,
                    ignoreCompatibility: true
                });
            }
        }

        this.showNotification(`Комплекс «${complexEquipment.name}» развёрнут (${placementIds.length} станков)`, 'success');
    };

    FactoryDesigner.prototype.computeLineProduction = function () {
        const prodMap = new Map();
        this.placedEquipment.forEach(p => {
            prodMap.set(p.placementId, (p.equipment.productivity || 0) * (p.equipment.efficiency || 0.85));
        });

        const conns = this.connectionManager?.connections || [];
        if (conns.length === 0) {
            const values = [...prodMap.values()].filter(v => v > 0);
            const final = values.length ? Math.min(...values) : 0;
            let bottleneckName = 'Нет';
            if (final > 0) {
                const item = this.placedEquipment.find(p =>
                    Math.abs(((p.equipment.productivity || 0) * (p.equipment.efficiency || 0.85)) - final) < 0.001
                );
                bottleneckName = item?.equipment?.name || 'Нет';
            }
            return { final, bottleneckName, bottleneckProductivity: final, chains: [] };
        }

        const adj = new Map();
        const incoming = new Map();
        const nodes = new Set();

        conns.forEach(c => {
            nodes.add(c.fromId);
            nodes.add(c.toId);
            if (!adj.has(c.fromId)) adj.set(c.fromId, []);
            adj.get(c.fromId).push(c.toId);
            incoming.set(c.toId, (incoming.get(c.toId) || 0) + 1);
            if (!incoming.has(c.fromId)) incoming.set(c.fromId, incoming.get(c.fromId) || 0);
        });

        const sources = [...nodes].filter(n => !incoming.get(n));
        const chainMins = [];

        const dfs = (node, pathMin) => {
            const p = prodMap.get(node);
            const currentMin = Math.min(pathMin, p != null ? p : pathMin);
            const next = adj.get(node) || [];
            if (next.length === 0) {
                chainMins.push(currentMin);
                return;
            }
            next.forEach(n => dfs(n, currentMin));
        };

        if (sources.length === 0) {
            const connectedProds = [...nodes].map(n => prodMap.get(n)).filter(v => v > 0);
            if (connectedProds.length) chainMins.push(Math.min(...connectedProds));
        } else {
            sources.forEach(s => dfs(s, Infinity));
        }

        const final = chainMins.length ? Math.min(...chainMins) : 0;
        let bottleneckName = 'Нет';
        if (final > 0 && final !== Infinity) {
            const item = this.placedEquipment.find(p => {
                const prod = (p.equipment.productivity || 0) * (p.equipment.efficiency || 0.85);
                return Math.abs(prod - final) < 0.001;
            });
            bottleneckName = item?.equipment?.name || 'Узкое место в цепочке';
        }

        return {
            final: final === Infinity ? 0 : final,
            bottleneckName,
            bottleneckProductivity: final === Infinity ? 0 : final,
            chains: chainMins
        };
    };

    FactoryDesigner.prototype.collectConveyorReport = function () {
        const list = [];
        const conns = this.connectionManager?.connections || [];
        const equipmentById = new Map((this.allEquipment || []).map(eq => [eq.id, eq]));

        conns.forEach(conn => {
            if (!conn.conveyorCatalogId) return;
            const cv = equipmentById.get(conn.conveyorCatalogId);
            const fromEq = this.placedEquipment.find(p => p.placementId === conn.fromId);
            const toEq = this.placedEquipment.find(p => p.placementId === conn.toId);
            list.push({
                name: conn.conveyorName || cv?.name || 'Конвейер',
                catalogId: conn.conveyorCatalogId,
                from: fromEq?.equipment?.name || `#${conn.fromId}`,
                to: toEq?.equipment?.name || `#${conn.toId}`,
                cost: cv?.cost || 0,
                power: cv?.power_consumption || 0
            });
        });
        return list;
    };

    const origFilter = FactoryDesigner.prototype.filterEquipment;
    FactoryDesigner.prototype.filterEquipment = function (searchTerm) {
        if (!this.allEquipment || this.allEquipment.length === 0) return;
        const trimmed = (searchTerm || '').trim();
        let base = [...this.allEquipment];
        if (trimmed) {
            const term = trimmed.toLowerCase();
            base = base.filter(eq => {
                const name = (eq.name || '').toLowerCase();
                const type = (eq.equipment_type || '').toLowerCase();
                const category = (eq.category || '').toLowerCase();
                return name.includes(term) || type.includes(term) || category.includes(term);
            });
        }
        this.equipment = this.applyCatalogTabFilter(base);
        this.renderEquipmentCatalog();
    };

    const origRender = FactoryDesigner.prototype.renderEquipmentCatalog;
    FactoryDesigner.prototype.renderEquipmentCatalog = function () {
        const catalogBadge = document.getElementById('catalogTabHint');
        if (catalogBadge) {
            const labels = { all: 'Всё', machine: 'Станки', conveyor: 'Конвейеры', complex: 'Комплексы' };
            catalogBadge.textContent = labels[this.catalogTab] || '';
        }
        origRender.call(this);
    };

    const origPlace = FactoryDesigner.prototype.placeEquipmentInstance;
    FactoryDesigner.prototype.placeEquipmentInstance = function (equipment, x, y, placementIdOverride) {
        const el = origPlace.call(this, equipment, x, y, placementIdOverride);
        if (el && equipment) {
            el.dataset.catalogType = equipment.catalogType || 'machine';
            el.dataset.inputType = equipment.input_type || '';
            el.dataset.outputType = equipment.output_type || '';
            if (equipment.catalogType === 'equipment_complex') {
                el.classList.add('placed-complex-card');
            }
        }
        return el;
    };

    const origSerialize = FactoryDesigner.prototype.serializeProject;
    FactoryDesigner.prototype.serializeProject = function () {
        const project = origSerialize.call(this);
        project.version = 2;
        project.connections = (this.connectionManager?.connections || []).map(c => ({
            fromId: c.fromId,
            toId: c.toId,
            conveyorCatalogId: c.conveyorCatalogId || null,
            conveyorName: c.conveyorName || null
        }));
        return project;
    };

    FactoryDesigner.prototype.restoreConnections = async function (connections) {
        if (!this.connectionManager || !Array.isArray(connections)) return;
        for (const c of connections) {
            const fromId = Number(c.fromId);
            const toId = Number(c.toId);
            if (!Number.isFinite(fromId) || !Number.isFinite(toId)) continue;
            const opts = c.conveyorCatalogId != null
                ? { skipModal: true, conveyorCatalogId: Number(c.conveyorCatalogId) }
                : {};
            await this.connectionManager.createConnection(fromId, toId, c.fromSide, c.toSide, opts);
            const last = this.connectionManager.connections[this.connectionManager.connections.length - 1];
            if (last && c.conveyorName && !last.conveyorName) {
                last.conveyorName = c.conveyorName;
                this.connectionManager.drawConnection(last);
            }
        }
    };

    FactoryDesigner.prototype.loadProjectFromObject = function (project) {
        if (!project || (project.version !== 1 && project.version !== 2)) {
            throw new Error('Неподдерживаемый формат проекта');
        }
        if (!Array.isArray(project.placed)) {
            throw new Error('Некорректный проект: отсутствует placed');
        }

        this.clearWorkspace(false);

        if (project.view && typeof project.view.zoom === 'number') {
            this.zoom = project.view.zoom;
            this.panX = project.view.panX || 0;
            this.panY = project.view.panY || 0;
            this.updateTransform();
            const zoomLabel = document.getElementById('zoomLevel');
            if (zoomLabel) zoomLabel.textContent = Math.round(this.zoom * 100) + '%';
        }

        const titleInput = document.getElementById('projectTitleInput');
        if (titleInput && project.title) titleInput.value = project.title;

        const equipmentById = new Map((this.allEquipment || []).map(eq => [eq.id, eq]));
        let maxPlacementId = 0;
        project.placed.forEach(p => {
            const eq = equipmentById.get(p.equipmentId);
            if (!eq) return;
            const placementId = Number(p.placementId);
            const x = Number(p.x);
            const y = Number(p.y);
            if (!Number.isFinite(placementId) || !Number.isFinite(x) || !Number.isFinite(y)) return;
            this.placeEquipmentInstance(eq, x, y, placementId);
            if (placementId > maxPlacementId) maxPlacementId = placementId;
        });
        this.nextPlacementId = Math.max(this.nextPlacementId, maxPlacementId + 1);

        const connections = project.connections;
        if (connections?.length) {
            this.restoreConnections(connections);
        }
    };

    const origCalc = FactoryDesigner.prototype.calculateProduction;
    FactoryDesigner.prototype.calculateProduction = function () {
        if (this.placedEquipment.length === 0) {
            alert('Разместите оборудование для расчета');
            return;
        }

        origCalc.call(this);

        if (!window.lastCalculations) return;

        const line = this.computeLineProduction();
        window.lastCalculations.final_production = line.final;
        window.lastCalculations.bottleneck_equipment = line.bottleneckName;
        window.lastCalculations.bottleneck_productivity = line.bottleneckProductivity;
        window.lastCalculations.line_production_method = 'chain_min';

        const conveyors = this.collectConveyorReport();
        window.lastCalculations.conveyor_list = conveyors;
        window.lastCalculations.conveyor_count = conveyors.length;

        conveyors.forEach(cv => {
            window.lastCalculations.total_energy += cv.power;
            if (cv.cost > 0) window.lastCalculations.total_cost += cv.cost;
        });
    };

    const origInit = FactoryDesigner.prototype.init;
    FactoryDesigner.prototype.init = async function () {
        await origInit.call(this);
        if (this.connectionManager) {
            this.connectionManager.setDesigner(this);
        }
        this.setupCatalogTabs();
    };

    const origDropHandler = null;
    FactoryDesigner.prototype.handleEquipmentDrop = async function (equipment, x, y) {
        if (equipment.catalogType === 'conveyor') {
            this.showNotification('Конвейер выбирается при создании связи между станками', 'info');
            return;
        }
        if (equipment.catalogType === 'equipment_complex') {
            await this.expandComplex(equipment, x, y);
            return;
        }
        this.placeEquipment(equipment, x, y);
    };
})();
