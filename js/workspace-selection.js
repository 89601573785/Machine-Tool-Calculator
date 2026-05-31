/**
 * Выделение области (marquee) и групповое перемещение / удаление.
 */
class WorkspaceSelectionManager {
    constructor(designer) {
        this.designer = designer;
        this.workspace = null;
        this.selectedIds = new Set();
        this.marqueeEl = null;
        this.boundsEl = null;
        this.deleteBtnEl = null;
        this.isMarqueeActive = false;
        this.isGroupDragging = false;
        this.marqueeStart = null;
        this._groupDragCleanup = null;
        this._marqueeCleanup = null;
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onParentMessage = this._onParentMessage.bind(this);
        this.focusRoot = null;
        this._pendingClickSelectId = null;
    }

    attach(workspace) {
        this.workspace = workspace;
        this.focusRoot = document.getElementById('workspaceContainer') || workspace;
        if (this.focusRoot && !this.focusRoot.hasAttribute('tabindex')) {
            this.focusRoot.setAttribute('tabindex', '0');
        }
        this.ensureElements();
        const grabFocus = () => this.focusWorkspace();
        workspace.addEventListener('mousedown', grabFocus);
        this.focusRoot?.addEventListener('mousedown', grabFocus);
        document.addEventListener('keydown', this._onKeyDown, true);
        window.addEventListener('keydown', this._onKeyDown, true);
        window.addEventListener('message', this._onParentMessage);
    }

    detach() {
        document.removeEventListener('keydown', this._onKeyDown, true);
        window.removeEventListener('keydown', this._onKeyDown, true);
        window.removeEventListener('message', this._onParentMessage);
        this.clearSelection();
        this._marqueeCleanup?.();
        this._groupDragCleanup?.();
    }

    focusWorkspace() {
        const el = this.focusRoot || this.workspace;
        if (!el || typeof el.focus !== 'function') return;
        try {
            el.focus({ preventScroll: true });
        } catch {
            el.focus();
        }
    }

    isDeleteKey(e) {
        return e.key === 'Delete' || e.key === 'Del' || e.code === 'Delete';
    }

    isDeleteShortcut(e) {
        return this.isDeleteKey(e) || e.key === 'Backspace';
    }

    ensureElements() {
        if (!this.workspace) return;
        if (!this.marqueeEl) {
            this.marqueeEl = document.createElement('div');
            this.marqueeEl.className = 'workspace-marquee';
            this.marqueeEl.hidden = true;
            this.workspace.appendChild(this.marqueeEl);
        }
        if (!this.boundsEl) {
            this.boundsEl = document.createElement('div');
            this.boundsEl.className = 'workspace-selection-bounds';
            this.boundsEl.hidden = true;
            this.workspace.appendChild(this.boundsEl);

            this.deleteBtnEl = document.createElement('button');
            this.deleteBtnEl.type = 'button';
            this.deleteBtnEl.className = 'workspace-selection-delete';
            this.deleteBtnEl.title = 'Удалить выделенное (Delete)';
            this.deleteBtnEl.innerHTML = '<i class="fas fa-trash-alt"></i>';
            this.deleteBtnEl.addEventListener('mousedown', (e) => e.stopPropagation());
            this.deleteBtnEl.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteSelected();
            });
            this.boundsEl.appendChild(this.deleteBtnEl);
        }
    }

    clientToWorkspace(clientX, clientY) {
        const rect = this.workspace.getBoundingClientRect();
        const z = this.designer.zoom || 1;
        return {
            x: (clientX - rect.left) / z,
            y: (clientY - rect.top) / z
        };
    }

    isSelected(placementId) {
        return this.selectedIds.has(Number(placementId));
    }

    clearSelection() {
        this.selectedIds.clear();
        this.workspace?.querySelectorAll('.placed-equipment.box-selected').forEach((el) => {
            el.classList.remove('box-selected');
        });
        this.updateSelectionChrome();
    }

    setSelection(ids) {
        this.clearSelection();
        ids.forEach((id) => this.selectedIds.add(Number(id)));
        this.applySelectionClasses();
        this.updateSelectionChrome();
    }

    toggleSelection(placementId) {
        const id = Number(placementId);
        if (this.selectedIds.has(id)) {
            this.selectedIds.delete(id);
            this.getElementByPlacementId(id)?.classList.remove('box-selected');
        } else {
            this.selectedIds.add(id);
            this.getElementByPlacementId(id)?.classList.add('box-selected');
        }
        this.updateSelectionChrome();
    }

    applySelectionClasses() {
        this.workspace?.querySelectorAll('.placed-equipment').forEach((el) => {
            const id = parseInt(el.dataset.placementId, 10);
            el.classList.toggle('box-selected', this.selectedIds.has(id));
        });
    }

    getElementByPlacementId(placementId) {
        return this.workspace?.querySelector(`[data-placement-id="${placementId}"]`) || null;
    }

    getPlacementRect(rec) {
        const el = rec.element;
        if (!el || !this.workspace) {
            const w = 260;
            const h = 200;
            return {
                left: rec.x,
                top: rec.y,
                right: rec.x + w,
                bottom: rec.y + h,
                width: w,
                height: h
            };
        }
        const wsRect = this.workspace.getBoundingClientRect();
        const z = this.designer.zoom || 1;
        const r = el.getBoundingClientRect();
        const left = (r.left - wsRect.left) / z;
        const top = (r.top - wsRect.top) / z;
        const width = r.width / z;
        const height = r.height / z;
        return {
            left,
            top,
            right: left + width,
            bottom: top + height,
            width,
            height
        };
    }

    rectsIntersect(a, b) {
        return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
    }

    updateSelectionChrome() {
        this.ensureElements();
        if (!this.boundsEl) return;

        if (this.selectedIds.size === 0) {
            this.boundsEl.hidden = true;
            return;
        }

        for (const id of this.selectedIds) {
            const rec = this.designer.placedEquipment.find((p) => p.placementId === id);
            if (!rec?.element) continue;
            const liveX = parseFloat(rec.element.style.left);
            const liveY = parseFloat(rec.element.style.top);
            if (Number.isFinite(liveX)) rec.x = liveX;
            if (Number.isFinite(liveY)) rec.y = liveY;
        }

        if (this.selectedIds.size === 1) {
            this.boundsEl.hidden = true;
            return;
        }

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const id of this.selectedIds) {
            const rec = this.designer.placedEquipment.find((p) => p.placementId === id);
            if (!rec?.element) continue;
            const r = this.getPlacementRect(rec);
            minX = Math.min(minX, r.left);
            minY = Math.min(minY, r.top);
            maxX = Math.max(maxX, r.right);
            maxY = Math.max(maxY, r.bottom);
        }

        if (!Number.isFinite(minX)) {
            this.boundsEl.hidden = true;
            return;
        }

        const pad = 4;
        minX -= pad;
        minY -= pad;
        maxX += pad;
        maxY += pad;

        this.boundsEl.hidden = false;
        this.boundsEl.style.left = `${minX}px`;
        this.boundsEl.style.top = `${minY}px`;
        this.boundsEl.style.width = `${maxX - minX}px`;
        this.boundsEl.style.height = `${maxY - minY}px`;
    }

    selectByMarqueeRect(rect) {
        const ids = [];
        for (const rec of this.designer.placedEquipment) {
            const pr = this.getPlacementRect(rec);
            if (this.rectsIntersect(rect, pr)) {
                ids.push(rec.placementId);
            }
        }
        this.setSelection(ids);
        this.focusWorkspace();
    }

    beginMarquee(e) {
        if (this.designer.isConnectMode || this.designer.isShiftPressed) return false;
        if (e.button !== 0 || e.altKey) return false;

        this.ensureElements();
        this.isMarqueeActive = true;
        const start = this.clientToWorkspace(e.clientX, e.clientY);
        this.marqueeStart = start;

        this.marqueeEl.hidden = false;
        this.marqueeEl.style.left = `${start.x}px`;
        this.marqueeEl.style.top = `${start.y}px`;
        this.marqueeEl.style.width = '0px';
        this.marqueeEl.style.height = '0px';

        const onMove = (ev) => {
            if (!this.isMarqueeActive) return;
            const cur = this.clientToWorkspace(ev.clientX, ev.clientY);
            const left = Math.min(start.x, cur.x);
            const top = Math.min(start.y, cur.y);
            const width = Math.abs(cur.x - start.x);
            const height = Math.abs(cur.y - start.y);
            this.marqueeEl.style.left = `${left}px`;
            this.marqueeEl.style.top = `${top}px`;
            this.marqueeEl.style.width = `${width}px`;
            this.marqueeEl.style.height = `${height}px`;
        };

        const onUp = (ev) => {
            if (!this.isMarqueeActive) return;
            this.isMarqueeActive = false;
            this.marqueeEl.hidden = true;

            const end = this.clientToWorkspace(ev.clientX, ev.clientY);
            const left = Math.min(start.x, end.x);
            const top = Math.min(start.y, end.y);
            const width = Math.abs(end.x - start.x);
            const height = Math.abs(end.y - start.y);

            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            this._marqueeCleanup = null;

            if (width < 4 && height < 4) {
                this.clearSelection();
                return;
            }

            this.selectByMarqueeRect({
                left,
                top,
                right: left + width,
                bottom: top + height
            });
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        this._marqueeCleanup = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        e.preventDefault();
        return true;
    }

    handleEquipmentPointerDown(e, element) {
        if (this.designer.isConnectMode || this.designer.isShiftPressed) return false;
        if (e.button !== 0 || e.target.classList.contains('delete-btn')) return false;

        const placementId = parseInt(element.dataset.placementId, 10);
        if (!Number.isFinite(placementId)) return false;

        this.focusWorkspace();
        this._pendingClickSelectId = null;

        const additive = e.ctrlKey || e.metaKey;
        if (additive) {
            this.toggleSelection(placementId);
            if (this.selectedIds.size > 1 && this.isSelected(placementId)) {
                this.startGroupDrag(e);
                return true;
            }
            return false;
        }

        if (this.selectedIds.size > 1 && this.isSelected(placementId)) {
            this.startGroupDrag(e);
            return true;
        }

        if (this.isSelected(placementId)) {
            return false;
        }

        this._pendingClickSelectId = placementId;
        return false;
    }

    finishEquipmentPointer(placementId, didDrag) {
        if (this.designer.isConnectMode || this.designer.isShiftPressed) {
            this._pendingClickSelectId = null;
            return;
        }
        if (didDrag) {
            this._pendingClickSelectId = null;
            return;
        }
        if (this._pendingClickSelectId === placementId) {
            this.setSelection([placementId]);
        }
        this._pendingClickSelectId = null;
    }

    markDragInteraction() {
        if (this.designer) {
            this.designer._suppressConnectionClick = true;
        }
        this._pendingClickSelectId = null;
    }

    movePlacement(rec, x, y) {
        const el = rec.element;
        const edgePadding = this.designer.getEdgePadding();
        const cardW = el.offsetWidth || 260;
        const cardH = el.offsetHeight || 200;
        const maxX = Math.max(edgePadding, this.designer.workspaceWidth - cardW - edgePadding);
        const maxY = Math.max(edgePadding, this.designer.workspaceHeight - cardH - edgePadding);
        const snapped = this.designer.applySnap(x, y);
        let newX = Math.max(edgePadding, Math.min(maxX, snapped.x));
        let newY = Math.max(edgePadding, Math.min(maxY, snapped.y));
        el.style.left = `${newX}px`;
        el.style.top = `${newY}px`;
        rec.x = newX;
        rec.y = newY;

        const cm = this.designer.connectionManager;
        if (cm) {
            cm.redrawAllConnections();
        }
    }

    startGroupDrag(e) {
        this._groupDragCleanup?.();
        this.isGroupDragging = true;

        const start = this.clientToWorkspace(e.clientX, e.clientY);
        const items = [];
        for (const id of this.selectedIds) {
            const rec = this.designer.placedEquipment.find((p) => p.placementId === id);
            if (rec) items.push({ rec, ox: rec.x, oy: rec.y });
        }

        items.forEach(({ rec }) => rec.element.classList.add('dragging'));

        const onMove = (ev) => {
            if (!this.isGroupDragging) return;
            const cur = this.clientToWorkspace(ev.clientX, ev.clientY);
            const dx = cur.x - start.x;
            const dy = cur.y - start.y;
            for (const { rec, ox, oy } of items) {
                this.movePlacement(rec, ox + dx, oy + dy);
            }
            this.updateSelectionChrome();
        };

        const onUp = () => {
            if (!this.isGroupDragging) return;
            this.isGroupDragging = false;
            items.forEach(({ rec }) => rec.element.classList.remove('dragging'));
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            this._groupDragCleanup = null;
            this.updateSelectionChrome();
            this.designer.markProjectDirty();
            this.designer._suppressConnectionClick = true;
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        this._groupDragCleanup = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        e.preventDefault();
        e.stopPropagation();
    }

    deleteSelected() {
        if (this.selectedIds.size === 0) return;
        const ids = [...this.selectedIds];
        this.clearSelection();
        for (const id of ids) {
            const el = this.getElementByPlacementId(id);
            if (el) this.designer.removeEquipment(el);
        }
    }

    tryHandleDeleteKey(e) {
        if (!this.isDeleteShortcut(e)) return false;
        const tag = (e.target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return false;
        if (this.selectedIds.size === 0) return false;
        e.preventDefault();
        e.stopPropagation();
        this.deleteSelected();
        return true;
    }

    _onKeyDown(e) {
        this.tryHandleDeleteKey(e);
    }

    _onParentMessage(e) {
        if (e.origin !== window.location.origin) return;
        if (e.data?.type === 'leskom:configurator:delete-selection') {
            if (this.selectedIds.size > 0) this.deleteSelected();
        }
    }

    onEquipmentRemoved(placementId) {
        this.selectedIds.delete(Number(placementId));
        this.updateSelectionChrome();
    }

    onWorkspaceCleared() {
        this.clearSelection();
    }
}

if (typeof window !== 'undefined') {
    window.WorkspaceSelectionManager = WorkspaceSelectionManager;
}
