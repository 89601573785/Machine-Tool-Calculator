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
        if (tab === 'log_feed') {
            return list.filter(eq => eq.catalogType === 'log_feed');
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

    const normalizeText = (value) => (value || '').toString().toLowerCase().replace(/ё/g, 'е');
    const includesAny = (value, needles) => needles.some(n => value.includes(n));

    function resolveTemplateMemberId(allEquipment, selectors = [], used = new Set()) {
        if (!Array.isArray(allEquipment) || !allEquipment.length) return null;
        const wanted = selectors.map(s => normalizeText(s));
        const candidate = allEquipment.find(eq => {
            if (!eq || used.has(eq.id)) return false;
            if (eq.catalogType === 'conveyor' || eq.catalogType === 'log_feed' || eq.catalogType === 'equipment_complex') {
                return false;
            }
            const hay = `${normalizeText(eq.name)} ${normalizeText(eq.equipment_type)} ${normalizeText(eq.category)} ${normalizeText(eq.leskomSlug)}`;
            return includesAny(hay, wanted);
        });
        if (!candidate) return null;
        used.add(candidate.id);
        return candidate.id;
    }

    function buildFallbackComplexTemplate(complexEquipment, allEquipment) {
        const used = new Set();
        const complexName = normalizeText(complexEquipment?.name);
        const complexSlug = normalizeText(complexEquipment?.leskomSlug);
        const members = [];

        const pushStage = (selectors) => {
            const id = resolveTemplateMemberId(allEquipment, selectors, used);
            if (id) members.push({ catalogId: id });
        };

        if (complexName.includes('профилиров') || complexSlug.includes('profilirovochn')) {
            pushStage(['сбп 200', 'профилиров', 'четырехсторон']);
            pushStage(['торцов', 'тсм', 'оптимизир']);
            pushStage(['рольган', 'транспортер', 'конвей']);
        } else {
            pushStage(['сбц', 'тополь', 'бревнопил', 'брусовал']);
            pushStage(['акула', 'многопил', 'двухвальн']);
            pushStage(['миг', 'кромкообрез', 'скр']);
            pushStage(['град-4', 'горбыл']);
            pushStage(['тсм', 'мультиторцов', 'торцов']);
        }

        if (members.length < 2) return null;

        const connections = [];
        for (let i = 0; i < members.length - 1; i += 1) {
            connections.push({
                fromIndex: i,
                toIndex: i + 1,
                conveyorCatalogId: window.CatalogMeta?.DEFAULT_CONVEYOR_ID
            });
        }

        return { members, connections };
    }

    function buildComplexTemplateBySlug(complexEquipment) {
        const template = window.CatalogMeta?.getComplexTemplate?.(complexEquipment.id, complexEquipment);
        if (template?.members?.length >= 2) return template;
        return null;
    }

    function computeComplexLayout(designer, template, resolved, dropX, dropY) {
        const GAP = 120;
        const ROW_GAP = 180;
        const positions = new Array(template.members.length);

        const outgoing = new Map();
        (template.connections || []).forEach((c) => {
            if (!outgoing.has(c.fromIndex)) outgoing.set(c.fromIndex, []);
            outgoing.get(c.fromIndex).push(c.toIndex);
        });
        const hasFork = [...outgoing.values()].some((targets) => targets.length > 1);

        const byIndex = (idx) => resolved.find((r) => r.index === idx)?.eq || null;
        const cardSize = (eq) => (eq ? designer.getEquipmentCardSize(eq) : { widthPx: 260, lengthPx: 260 });

        if (hasFork) {
            const rootIdx = 0;
            const rootEq = byIndex(rootIdx);
            const rootSize = cardSize(rootEq);
            positions[rootIdx] = { x: dropX, y: dropY };

            const children = outgoing.get(rootIdx) || [];
            children.forEach((childIdx, branchI) => {
                const childEq = byIndex(childIdx);
                const childSize = cardSize(childEq);
                positions[childIdx] = {
                    x: dropX + rootSize.widthPx + GAP,
                    y: dropY + branchI * (Math.max(rootSize.lengthPx, childSize.lengthPx) + ROW_GAP * 0.45)
                };
            });

            let tailX = dropX;
            let maxRowY = dropY;
            resolved.forEach(({ index, eq }) => {
                if (!eq || positions[index]) return;
                const size = cardSize(eq);
                positions[index] = { x: tailX, y: maxRowY + ROW_GAP + size.lengthPx * 0.15 };
                tailX += size.widthPx + GAP;
            });
            return positions;
        }

        let cursorX = dropX;
        const baseY = dropY;
        template.members.forEach((member, idx) => {
            const eq = byIndex(idx);
            if (!eq) return;
            const size = cardSize(eq);
            if (Number.isFinite(member.offsetY) && member.offsetY > 0) {
                positions[idx] = {
                    x: dropX + (Number.isFinite(member.offsetX) ? member.offsetX : cursorX - dropX),
                    y: dropY + member.offsetY * 0.85
                };
                cursorX = Math.max(cursorX, positions[idx].x + size.widthPx + GAP);
                return;
            }
            positions[idx] = { x: cursorX, y: baseY };
            cursorX += size.widthPx + GAP;
        });
        return positions;
    }

    FactoryDesigner.prototype.expandComplex = async function (complexEquipment, dropX, dropY) {
        const template =
            window.CatalogMeta?.getComplexTemplate(complexEquipment.id, complexEquipment) ||
            buildComplexTemplateBySlug(complexEquipment) ||
            buildFallbackComplexTemplate(complexEquipment, this.allEquipment || []);
        if (!template || !template.members?.length) {
            this.showNotification('Шаблон комплекса не найден — размещён как карточка', 'warning');
            this.placeEquipmentInstance(complexEquipment, dropX, dropY);
            return;
        }

        const allEquipment = this.allEquipment || [];
        const placementIds = new Array(template.members.length).fill(null);
        const usedEquip = new Set();
        const resolveMember = (member) =>
            window.CatalogMeta?.resolveComplexMember?.(member, allEquipment, usedEquip);

        const resolved = template.members.map((member, index) => ({
            index,
            eq: resolveMember(member)
        }));
        const positions = computeComplexLayout(this, template, resolved, dropX, dropY);

        resolved.forEach(({ index, eq }) => {
            if (!eq) return;
            const pos = positions[index];
            if (!pos) return;
            const el = this.placeEquipmentInstance(eq, pos.x, pos.y);
            if (el) placementIds[index] = parseInt(el.dataset.placementId, 10);
        });

        if (this.connectionManager && template.connections) {
            for (const link of template.connections) {
                const fromId = placementIds[link.fromIndex];
                const toId = placementIds[link.toIndex];
                if (!fromId || !toId) continue;
                await this.connectionManager.createConnection(fromId, toId, 'right', 'left', {
                    skipModal: true,
                    silent: true,
                    _deferRedraw: true,
                    conveyorCatalogId: link.conveyorCatalogId || CatalogMeta.DEFAULT_CONVEYOR_ID,
                    ignoreCompatibility: true
                });
            }
            this.connectionManager.redrawAllConnections();
        }

        const placedCount = placementIds.filter(Boolean).length;
        if (placedCount < 1) {
            this.showNotification(
                'Не удалось подобрать станки линии в каталоге — проверьте загрузку каталога',
                'warning'
            );
            return;
        }
        this.showNotification(`Линия «${complexEquipment.name}» развёрнута (${placedCount} станков)`, 'success');
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
        const lookup = this.buildEquipmentLookup();

        conns.forEach(conn => {
            if (conn.conveyorCatalogId == null) return;
            const catalogId = Number(conn.conveyorCatalogId);
            const cv = Number.isFinite(catalogId) ? lookup.byId.get(catalogId) : null;
            const fromEq = this.placedEquipment.find(p => p.placementId === conn.fromId);
            const toEq = this.placedEquipment.find(p => p.placementId === conn.toId);
            const priceOnRequest = !cv || cv.cost === 0 || (cv.price && String(cv.price).includes('Цена по запросу'));
            list.push({
                name: conn.conveyorName || cv?.name || 'Конвейер',
                catalogId: conn.conveyorCatalogId,
                route: `${fromEq?.equipment?.name || `#${conn.fromId}`} → ${toEq?.equipment?.name || `#${conn.toId}`}`,
                from: fromEq?.equipment?.name || `#${conn.fromId}`,
                to: toEq?.equipment?.name || `#${conn.toId}`,
                cost: priceOnRequest ? null : (Number(cv?.cost) || 0),
                price_on_request: priceOnRequest,
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
            const labels = {
                all: 'Всё',
                machine: 'Станки',
                log_feed: 'Подача бревна',
                conveyor: 'Конвейеры',
                complex: 'Комплексы и линии'
            };
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
        if (Array.isArray(project.placed)) {
            project.placed = project.placed.map((p) => {
                const rec = this.placedEquipment.find((x) => x.placementId === p.placementId);
                return {
                    ...p,
                    leskomSlug: rec?.equipment?.leskomSlug || p.leskomSlug || null
                };
            });
        }
        project.connections = (this.connectionManager?.connections || []).map(c => ({
            fromId: c.fromId,
            toId: c.toId,
            conveyorCatalogId: c.conveyorCatalogId ?? null,
            conveyorName: c.conveyorName ?? null
        }));
        return project;
    };

    FactoryDesigner.prototype.restoreConnections = async function (connections, options = {}) {
        if (!this.connectionManager || !Array.isArray(connections)) return;
        const silent = !!options.silent;
        for (const c of connections) {
            const fromId = Number(c.fromId);
            const toId = Number(c.toId);
            if (!Number.isFinite(fromId) || !Number.isFinite(toId)) continue;
            const hasConveyor = c.conveyorCatalogId != null && c.conveyorCatalogId !== '';
            const opts = {
                skipModal: true,
                silent,
                _deferRedraw: true,
                conveyorCatalogId: hasConveyor ? Number(c.conveyorCatalogId) : null
            };
            const result = await this.connectionManager.createConnection(
                fromId, toId, c.fromSide, c.toSide, opts
            );
            if (!result?.created) continue;
            const last = this.connectionManager.connections[this.connectionManager.connections.length - 1];
            if (!last) continue;
            if (!hasConveyor) {
                last.conveyorCatalogId = null;
                last.conveyorName = null;
            } else if (c.conveyorName) {
                last.conveyorName = c.conveyorName;
            }
        }
        this.connectionManager.redrawAllConnections();
    };

    FactoryDesigner.prototype.syncConnectionsFromProject = async function (connections, options = {}) {
        const silent = !!options.silent;
        const movedIds = options.movedIds || new Set();
        const cm = this.connectionManager;
        if (!cm) return;

        const desired = [];
        for (const c of connections || []) {
            const fromId = Number(c.fromId);
            const toId = Number(c.toId);
            if (!Number.isFinite(fromId) || !Number.isFinite(toId)) continue;
            const hasConveyor = c.conveyorCatalogId != null && c.conveyorCatalogId !== '';
            desired.push({
                fromId,
                toId,
                fromSide: c.fromSide,
                toSide: c.toSide,
                conveyorCatalogId: hasConveyor ? Number(c.conveyorCatalogId) : null,
                conveyorName: hasConveyor ? (c.conveyorName ?? null) : null
            });
        }

        const pairKey = (fromId, toId) => `${fromId}:${toId}`;
        const desiredMap = new Map(desired.map((d) => [pairKey(d.fromId, d.toId), d]));

        for (const conn of [...cm.connections]) {
            if (desiredMap.has(pairKey(conn.fromId, conn.toId))) continue;
            if (conn._cleanup) conn._cleanup();
            if (conn.element) conn.element.remove();
        }
        cm.connections = cm.connections.filter((c) => desiredMap.has(pairKey(c.fromId, c.toId)));

        for (const spec of desired) {
            let existing = cm.connections.find(
                (c) => c.fromId === spec.fromId && c.toId === spec.toId
            );
            if (!existing) {
                await cm.createConnection(spec.fromId, spec.toId, spec.fromSide, spec.toSide, {
                    skipModal: true,
                    silent,
                    _deferRedraw: true,
                    conveyorCatalogId: spec.conveyorCatalogId
                });
                existing = cm.connections.find(
                    (c) => c.fromId === spec.fromId && c.toId === spec.toId
                );
                if (existing && spec.conveyorName) existing.conveyorName = spec.conveyorName;
                continue;
            }
            const convChanged =
                (existing.conveyorCatalogId ?? null) !== (spec.conveyorCatalogId ?? null);
            if (convChanged) {
                existing.conveyorCatalogId = spec.conveyorCatalogId;
                existing.conveyorName = spec.conveyorName;
                if (existing.element) {
                    existing._cleanup?.();
                    existing.element.remove();
                    existing.element = null;
                }
                continue;
            }
            const endpointsMoved = movedIds.has(spec.fromId) || movedIds.has(spec.toId);
            if (endpointsMoved || !existing.element) {
                if (existing.element) {
                    existing._cleanup?.();
                    existing.element.remove();
                    existing.element = null;
                }
            }
        }
        cm.redrawAllConnections();
    };

    FactoryDesigner.prototype.syncProjectFromObject = async function (project, options = {}) {
        const silent = !!options.silent;
        const movedIds = new Set();
        const lookup = this.buildEquipmentLookup();
        const remoteById = new Map();
        let maxPlacementId = 0;
        let missing = 0;

        for (const p of project.placed) {
            const placementId = Number(p.placementId);
            if (!Number.isFinite(placementId)) continue;
            remoteById.set(placementId, p);
            if (placementId > maxPlacementId) maxPlacementId = placementId;
        }

        for (const rec of [...this.placedEquipment]) {
            if (!remoteById.has(rec.placementId)) {
                this.removeEquipment(rec.element);
            }
        }

        for (const [placementId, p] of remoteById) {
            const eq = this.resolveEquipmentForPlacement(p, lookup);
            if (!eq) {
                missing += 1;
                continue;
            }
            const x = Number(p.x);
            const y = Number(p.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

            const existing = this.placedEquipment.find((r) => r.placementId === placementId);
            if (existing) {
                const equipmentId = eq.id;
                if (existing.equipmentId !== equipmentId) {
                    this.removeEquipment(existing.element);
                    this.placeEquipmentInstance(eq, x, y, placementId);
                } else {
                    const snapped = this.applySnap(x, y);
                    if (existing.x !== snapped.x || existing.y !== snapped.y) {
                        movedIds.add(placementId);
                        existing.x = snapped.x;
                        existing.y = snapped.y;
                        existing.element.style.left = `${snapped.x}px`;
                        existing.element.style.top = `${snapped.y}px`;
                    }
                }
            } else {
                this.placeEquipmentInstance(eq, x, y, placementId);
            }
        }

        this.nextPlacementId = Math.max(this.nextPlacementId, maxPlacementId + 1);

        if (missing > 0 && !silent) {
            this.showNotification?.(
                `Не найдено в каталоге: ${missing} из ${project.placed.length} станков`,
                'warning'
            );
        }

        await this.syncConnectionsFromProject(project.connections || [], { silent, movedIds });
    };

    FactoryDesigner.prototype.loadProjectFromObject = async function (project, options = {}) {
        if (!project || (project.version !== 1 && project.version !== 2)) {
            throw new Error('Неподдерживаемый формат проекта');
        }
        if (!Array.isArray(project.placed)) {
            throw new Error('Некорректный проект: отсутствует placed');
        }

        const preserveView = !!options.preserveView;
        const silent = !!options.silent;
        const seamless = !!options.seamless;
        const savedView = preserveView
            ? { zoom: this.zoom, panX: this.panX, panY: this.panY }
            : null;

        if (seamless) {
            if (preserveView && savedView) {
                this.zoom = savedView.zoom;
                this.panX = savedView.panX;
                this.panY = savedView.panY;
                this.updateTransform();
                const zoomLabel = document.getElementById('zoomLevel');
                if (zoomLabel) zoomLabel.textContent = Math.round(this.zoom * 100) + '%';
            }
            const titleInput = document.getElementById('projectTitleInput');
            if (titleInput && project.title) titleInput.value = project.title;
            await this.syncProjectFromObject(project, { silent });
            this.updateGridByZoom?.();
            return;
        }

        this.clearWorkspace(false);

        if (preserveView && savedView) {
            this.zoom = savedView.zoom;
            this.panX = savedView.panX;
            this.panY = savedView.panY;
            this.updateTransform();
            const zoomLabel = document.getElementById('zoomLevel');
            if (zoomLabel) zoomLabel.textContent = Math.round(this.zoom * 100) + '%';
        } else if (project.view && typeof project.view.zoom === 'number') {
            this.zoom = project.view.zoom;
            this.panX = project.view.panX || 0;
            this.panY = project.view.panY || 0;
            this.updateTransform();
            const zoomLabel = document.getElementById('zoomLevel');
            if (zoomLabel) zoomLabel.textContent = Math.round(this.zoom * 100) + '%';
        }

        const titleInput = document.getElementById('projectTitleInput');
        if (titleInput && project.title) titleInput.value = project.title;

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

        if (missing > 0 && !silent) {
            this.showNotification?.(
                `Не найдено в каталоге: ${missing} из ${project.placed.length} станков`,
                'warning'
            );
        }

        const connections = project.connections;
        if (connections?.length) {
            await this.restoreConnections(connections, { silent });
        }

        if (this.placedEquipment.length > 0) {
            setTimeout(() => {
                this.updateGridByZoom?.();
                if (preserveView) {
                    this.updateTransform?.();
                } else {
                    this.centerWorkspace?.();
                }
            }, 150);
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

        let conveyorCostTotal = 0;
        let conveyorCostUnknownCount = 0;
        conveyors.forEach(cv => {
            window.lastCalculations.total_energy += cv.power;
            if (cv.price_on_request) {
                conveyorCostUnknownCount += 1;
            } else {
                conveyorCostTotal += Number(cv.cost) || 0;
            }
        });
        window.lastCalculations.conveyor_cost_total = conveyorCostTotal;
        window.lastCalculations.conveyor_cost_unknown_count = conveyorCostUnknownCount;
        const equipmentTotal = Number(
            window.lastCalculations.equipment_cost_total ?? window.lastCalculations.total_cost
        ) || 0;
        const installationTotal = Number(window.lastCalculations.installation_cost_total) || 0;
        const logFeed = this.collectLogFeedReport();
        window.lastCalculations.log_feed_list = logFeed;
        window.lastCalculations.log_feed_count = logFeed.length;
        let logFeedCostTotal = 0;
        let logFeedCostUnknownCount = 0;
        logFeed.forEach((lf) => {
            if (lf.price_on_request) {
                logFeedCostUnknownCount += 1;
            } else {
                logFeedCostTotal += Number(lf.cost) || 0;
            }
        });
        window.lastCalculations.log_feed_cost_total = logFeedCostTotal;
        window.lastCalculations.log_feed_cost_unknown_count = logFeedCostUnknownCount;

        window.lastCalculations.line_total_cost =
            equipmentTotal + installationTotal + conveyorCostTotal + logFeedCostTotal;
        window.lastCalculations.total_cost_with_installation = window.lastCalculations.line_total_cost;
    };

    FactoryDesigner.prototype.collectLogFeedReport = function () {
        return this.placedEquipment
            .filter((p) => p.equipment?.catalogType === 'log_feed')
            .map((p) => {
                const eq = p.equipment;
                const priceOnRequest = eq.cost === 0 || (eq.price && String(eq.price).includes('Цена по запросу'));
                return {
                    name: eq.name,
                    cost: priceOnRequest ? null : (Number(eq.cost) || 0),
                    price_on_request: priceOnRequest,
                    power: eq.power_consumption || 0
                };
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
        if (equipment.catalogType === 'log_feed') {
            this.placeEquipment(equipment, x, y);
            return;
        }
        if (equipment.catalogType === 'equipment_complex') {
            await this.expandComplex(equipment, x, y);
            return;
        }
        this.placeEquipment(equipment, x, y);
    };
})();
