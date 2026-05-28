/**
 * Интеграция конфигуратора с ЛК ЛЕСКОМ (iframe + API).
 * Подключать в index.html до main.js
 */
(function (global) {
    'use strict';

    const MESSAGE_SAVED = 'leskom:configurator:saved';
    const COOKIE_USER_ID = 'leskom_user_id';
    const IS_FILE_PROTOCOL = global.location?.protocol === 'file:';
    const AUTOSAVE_DEBOUNCE_MS = 900;
    const SYNC_FADE_OUT_MS = 280;
    const SYNC_FADE_IN_MS = 380;

    /** Адаптивный опрос: редко в одиночку, чаще при совместном редактировании */
    const SYNC_POLL = {
        IDLE_MS: 24000,
        HIDDEN_MS: 50000,
        COLLAB_MS: 4500,
        HOT_MS: 3200,
        HOT_AFTER_REMOTE_MS: 50000,
        PRESENCE_MS: 12000,
        MIN_GAP_MS: 700
    };

    const syncState = {
        knownServerUpdatedAt: null,
        localDirty: false,
        isSaving: false,
        applyingRemote: false,
        autosaveTimer: null,
        pollTimer: null,
        presenceTimer: null,
        othersEditing: false,
        hotUntil: 0,
        lastPollAt: 0,
        collabStatusShown: false,
        pendingRemoteSync: false,
        pointerDown: false,
        interactionIdleTimer: null,
        _designer: null,
        _params: null
    };

    function getCookie(name) {
        const match = global.document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : null;
    }

    function parseParams(search) {
        const q = new URLSearchParams(search || global.location.search);
        const apiBase = (q.get('apiBase') || '/api/v1').replace(/\/$/, '');
        const staffHint = q.get('staff') === '1' || q.get('staff') === 'true';
        const debugSync = q.get('debugSync') === '1' || q.get('debugSync') === 'true';
        return {
            embed: q.get('embed') === '1' || q.get('embed') === 'true',
            projectId: q.get('projectId') || null,
            userId: q.get('userId') || getCookie(COOKIE_USER_ID) || null,
            apiBase,
            parentOrigin: q.get('parentOrigin') || global.location.origin,
            staffHint,
            debugSync
        };
    }

    function getEditorSessionId() {
        const key = 'leskom_editor_session';
        try {
            let id = sessionStorage.getItem(key);
            if (!id) {
                id =
                    global.crypto?.randomUUID?.() ||
                    `s${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
                sessionStorage.setItem(key, id);
            }
            return id;
        } catch {
            return 'default';
        }
    }

    function syncSessionQuery(params) {
        const sid = encodeURIComponent(getEditorSessionId());
        return `session_id=${sid}`;
    }

    const STAFF_PERMISSIONS = new Set([
        'configs.manage',
        'users.manage',
        'carts.manage',
        'catalog.manage',
        'crm.read',
        'security.manage'
    ]);
    const STAFF_ROLES = new Set(['manager', 'superadmin', 'admin']);

    async function resolveStaffAudience(params) {
        if (params.staffHint) return true;
        try {
            const me = await apiFetch(params.apiBase, '/auth/me', {
                method: 'GET',
                headers: { Accept: 'application/json' }
            });
            const roles = Array.isArray(me?.roles) ? me.roles : [];
            if (roles.some((r) => STAFF_ROLES.has(String(r)))) return true;
            const perms = Array.isArray(me?.permissions) ? me.permissions : [];
            return perms.some((p) => STAFF_PERMISSIONS.has(String(p)));
        } catch {
            return false;
        }
    }

    function storageKey(userId, projectId) {
        return `factory_designer_${userId || 'guest'}_${projectId || 'draft'}`;
    }

    function extractProject(body) {
        if (!body || typeof body !== 'object') return null;
        return body.project ?? body.payload ?? body.data ?? null;
    }

    function serverUpdatedAt(body) {
        return body?.updated_at ?? body?.updatedAt ?? null;
    }

    function normalizeUpdatedAtKey(iso) {
        if (!iso) return null;
        const ms = Date.parse(String(iso));
        return Number.isFinite(ms) ? String(ms) : String(iso);
    }

    function updatedAtChanged(remoteAt, knownAt) {
        if (!remoteAt) return false;
        if (!knownAt) return true;
        return normalizeUpdatedAtKey(remoteAt) !== normalizeUpdatedAtKey(knownAt);
    }

    function projectFingerprint(project) {
        try {
            return JSON.stringify(project);
        } catch {
            return '';
        }
    }

    function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function getWorkspaceContainer() {
        if (typeof global.document?.getElementById !== 'function') return null;
        return global.document.getElementById('workspaceContainer');
    }

    function isWorkspaceInteractionActive() {
        if (syncState.pointerDown) return true;
        if (syncState.autosaveTimer) return true;
        const container = getWorkspaceContainer();
        if (container?.querySelector('.dragging')) return true;
        return false;
    }

    function scheduleInteractionIdleCheck() {
        if (syncState.interactionIdleTimer) clearTimeout(syncState.interactionIdleTimer);
        syncState.interactionIdleTimer = setTimeout(() => {
            syncState.interactionIdleTimer = null;
            if (!isWorkspaceInteractionActive() && syncState.pendingRemoteSync) {
                flushPendingRemoteSync().catch(() => {});
            }
        }, 450);
    }

    async function flushPendingRemoteSync() {
        const designer = syncState._designer;
        const params = syncState._params;
        if (!designer || !params?.projectId || !syncState.pendingRemoteSync) return;
        if (isWorkspaceInteractionActive() || syncState.isSaving || syncState.applyingRemote) {
            scheduleInteractionIdleCheck();
            return;
        }
        if (syncState.localDirty) return;
        syncState.pendingRemoteSync = false;
        await pollRemoteProject(designer, params);
    }

    function bindWorkspaceInteractionGuard() {
        const container = getWorkspaceContainer();
        if (!container || container.dataset.leskomSyncGuard === '1') return;
        container.dataset.leskomSyncGuard = '1';
        const onDown = () => {
            syncState.pointerDown = true;
        };
        const onUp = () => {
            syncState.pointerDown = false;
            scheduleInteractionIdleCheck();
        };
        container.addEventListener('pointerdown', onDown, true);
        container.addEventListener('pointerup', onUp, true);
        container.addEventListener('pointercancel', onUp, true);
    }

    function setSyncStatus(text, kind) {
        const el = global.document.getElementById('projectSyncStatus');
        if (!el) return;
        if (!text) {
            el.classList.add('project-sync-status--leaving');
            setTimeout(() => {
                if (!el.dataset.syncText) {
                    el.hidden = true;
                    el.textContent = '';
                    el.className = 'project-sync-status';
                }
                el.classList.remove('project-sync-status--leaving');
            }, 320);
            delete el.dataset.syncText;
            return;
        }
        el.dataset.syncText = text;
        el.hidden = false;
        el.classList.remove('project-sync-status--leaving');
        el.textContent = text;
        el.className = `project-sync-status project-sync-status--${kind || 'info'}`;
        requestAnimationFrame(() => {
            el.classList.add('project-sync-status--visible');
        });
    }

    async function withWorkspaceSyncTransition(applyFn) {
        const container = getWorkspaceContainer();
        if (!container) {
            await applyFn();
            return;
        }
        container.classList.add('workspace-sync-active');
        void container.offsetWidth;
        container.classList.add('workspace-sync-dimmed');
        await delay(SYNC_FADE_OUT_MS);
        try {
            await applyFn();
        } finally {
            container.classList.remove('workspace-sync-dimmed');
            container.classList.add('workspace-sync-restored');
            await delay(SYNC_FADE_IN_MS);
            container.classList.remove('workspace-sync-restored', 'workspace-sync-active');
        }
    }

    async function apiFetch(apiBase, path, options) {
        const res = await global.fetch(`${apiBase}${path}`, {
            credentials: 'include',
            ...options
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            const err = new Error(
                res.status === 401
                    ? 'Войдите на сайт ЛЕСКОМ'
                    : `Ошибка API (${res.status})${text ? ': ' + text.slice(0, 120) : ''}`
            );
            err.status = res.status;
            throw err;
        }
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) return res.json();
        return null;
    }

    function notifyParent(parentOrigin, data) {
        if (IS_FILE_PROTOCOL) return;
        if (global.parent === global) return;
        global.parent.postMessage(
            {
                type: MESSAGE_SAVED,
                projectId: data.projectId,
                title: data.title,
                updatedAt: data.updatedAt
            },
            parentOrigin
        );
    }

    function applySiteChrome(hasProject) {
        if (IS_FILE_PROTOCOL || typeof global.document?.getElementById !== 'function') return;
        const titleWrap = global.document.getElementById('projectTitleWrap');
        const titleInput = global.document.getElementById('projectTitleInput');
        if (titleWrap) titleWrap.hidden = !hasProject;
        if (titleInput && !titleInput.value) {
            titleInput.placeholder = 'Название конфигурации';
        }
    }

    async function loadProjectFromApi(designer, params, { silent = false } = {}) {
        const body = await apiFetch(
            params.apiBase,
            `/configurator/projects/${encodeURIComponent(params.projectId)}`,
            { method: 'GET', headers: { Accept: 'application/json' } }
        );
        const project = extractProject(body);
        if (!project) {
            throw new Error('Пустой ответ проекта');
        }
        syncState.applyingRemote = true;
        designer._suppressProjectDirty = true;
        try {
            await designer.loadProjectFromObject(project);
            const titleInput = global.document.getElementById('projectTitleInput');
            if (titleInput && body.title) {
                titleInput.value = body.title;
            }
            if (body.id) {
                global.__leskomProjectId = body.id;
                params.projectId = body.id;
            }
            syncState.knownServerUpdatedAt = serverUpdatedAt(body);
            syncState.localDirty = false;
        } finally {
            designer._suppressProjectDirty = false;
            syncState.applyingRemote = false;
        }
        if (!silent) {
            designer.showNotification?.('Конфигурация загружена', 'success');
        }
        return body;
    }

    function askProjectTitle(designer, defaultTitle, { mode = 'create' } = {}) {
        return new Promise((resolve, reject) => {
            const modal = global.document.getElementById('saveProjectModal');
            const input = global.document.getElementById('saveProjectModalInput');
            const btnOk = global.document.getElementById('saveProjectModalConfirm');
            const btnCancel = global.document.getElementById('saveProjectModalCancel');
            const btnClose = global.document.getElementById('saveProjectModalClose');
            const heading = modal?.querySelector('.modal-header h3');
            const hint = modal?.querySelector('.modal-body p');
            if (!modal || !input || !btnOk) {
                resolve((defaultTitle || '').trim() || 'Без названия');
                return;
            }

            if (heading) {
                heading.innerHTML =
                    mode === 'create'
                        ? '<i class="fas fa-file-circle-plus"></i> Новая конфигурация'
                        : '<i class="fas fa-save"></i> Название конфигурации';
            }
            if (hint) {
                hint.textContent =
                    mode === 'create'
                        ? 'Укажите наименование конфигурации перед началом работы. Оно будет отображаться в личном кабинете.'
                        : 'Укажите наименование конфигурации.';
            }
            btnOk.textContent = mode === 'create' ? 'Создать' : 'Сохранить';

            input.value = defaultTitle || '';
            modal.style.display = 'block';
            input.focus();
            input.select();

            const cleanup = () => {
                modal.style.display = 'none';
                btnOk.removeEventListener('click', onOk);
                btnCancel?.removeEventListener('click', onCancel);
                btnClose?.removeEventListener('click', onCancel);
                input.removeEventListener('keydown', onKey);
            };

            const onOk = () => {
                const title = input.value.trim();
                if (!title) {
                    designer.showNotification?.('Введите наименование конфигурации', 'warning');
                    input.focus();
                    return;
                }
                cleanup();
                resolve(title);
            };

            const onCancel = () => {
                cleanup();
                reject(new Error('cancelled'));
            };

            const onKey = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    onOk();
                }
                if (e.key === 'Escape') {
                    onCancel();
                }
            };

            btnOk.addEventListener('click', onOk);
            btnCancel?.addEventListener('click', onCancel);
            btnClose?.addEventListener('click', onCancel);
            input.addEventListener('keydown', onKey);
        });
    }

    function buildPayload(designer, title) {
        const project = designer.serializeProject();
        if (project.version !== 1 && project.version !== 2) {
            project.version = Array.isArray(project.connections) && project.connections.length ? 2 : 1;
        }
        project.title = title;
        return project;
    }

    async function persistProject(designer, params, { title } = {}) {
        const titleInput = global.document.getElementById('projectTitleInput');
        const resolvedTitle = (title || titleInput?.value || '').trim();
        if (!resolvedTitle) {
            throw new Error('Не указано наименование конфигурации');
        }
        if (titleInput) titleInput.value = resolvedTitle;

        const project = buildPayload(designer, resolvedTitle);
        const id = global.__leskomProjectId || params.projectId || undefined;

        const saved = await apiFetch(params.apiBase, '/configurator/projects', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({ id, title: resolvedTitle, project })
        });

        const newId = saved?.id || id;
        if (newId) {
            global.__leskomProjectId = newId;
            params.projectId = newId;
            const userId = params.userId || 'guest';
            designer.projectStorageKey = storageKey(userId, newId);
            try {
                localStorage.setItem(designer.projectStorageKey, JSON.stringify(project));
            } catch (_) { /* ignore */ }
            try {
                const url = new URL(global.location.href);
                url.searchParams.set('projectId', newId);
                global.history.replaceState({}, '', url);
            } catch (_) { /* ignore */ }
            applySiteChrome(true);
        }

        syncState.knownServerUpdatedAt = serverUpdatedAt(saved);
        syncState.localDirty = false;

        notifyParent(params.parentOrigin, {
            projectId: newId,
            title: saved?.title || resolvedTitle,
            updatedAt: serverUpdatedAt(saved) || new Date().toISOString()
        });

        return saved;
    }

    async function createProjectOnServer(designer, params) {
        const title = await askProjectTitle(designer, '', { mode: 'create' });
        syncState.isSaving = true;
        setSyncStatus('Создание…', 'busy');
        try {
            const saved = await persistProject(designer, params, { title });
            designer.showNotification?.('Конфигурация создана', 'success');
            setSyncStatus('Сохранено', 'ok');
            setTimeout(() => setSyncStatus('', ''), 2000);
            return saved;
        } finally {
            syncState.isSaving = false;
        }
    }

    async function autosaveProject(designer, params) {
        if (IS_FILE_PROTOCOL || !params.projectId) return;
        if (syncState.isSaving || syncState.applyingRemote) return;

        syncState.isSaving = true;
        setSyncStatus('Сохранение…', 'busy');
        try {
            await persistProject(designer, params);
            setSyncStatus('Сохранено', 'ok');
            setTimeout(() => {
                if (!syncState.localDirty) setSyncStatus('', '');
            }, 1500);
        } catch (err) {
            console.error('[LeskomConfiguratorIntegration] autosave:', err);
            setSyncStatus('Ошибка сохранения', 'error');
            designer.showNotification?.(err.message || 'Ошибка сохранения', 'error');
            throw err;
        } finally {
            syncState.isSaving = false;
            if (syncState.pendingRemoteSync) {
                scheduleInteractionIdleCheck();
            } else if (!syncState.othersEditing) {
                kickSyncSoon(designer, params);
            }
        }
    }

    function scheduleAutosave(designer, params) {
        if (IS_FILE_PROTOCOL || !params.projectId) return;
        syncState.localDirty = true;
        if (syncState.autosaveTimer) {
            clearTimeout(syncState.autosaveTimer);
        }
        syncState.autosaveTimer = setTimeout(() => {
            syncState.autosaveTimer = null;
            autosaveProject(designer, params).catch(() => {});
        }, AUTOSAVE_DEBOUNCE_MS);
    }

    function bindProjectChangeHooks(designer, params) {
        designer.onProjectChange = () => scheduleAutosave(designer, params);

        const titleInput = global.document.getElementById('projectTitleInput');
        if (titleInput && titleInput.dataset.leskomTitleBound !== '1') {
            titleInput.dataset.leskomTitleBound = '1';
            let titleTimer = null;
            titleInput.addEventListener('input', () => {
                syncState.localDirty = true;
                if (titleTimer) clearTimeout(titleTimer);
                titleTimer = setTimeout(() => {
                    titleTimer = null;
                    autosaveProject(designer, params).catch(() => {});
                }, AUTOSAVE_DEBOUNCE_MS);
            });
        }
    }

    function computePollDelayMs() {
        if (global.document?.hidden) return SYNC_POLL.HIDDEN_MS;
        if (Date.now() < syncState.hotUntil) return SYNC_POLL.HOT_MS;
        if (syncState.othersEditing) return SYNC_POLL.COLLAB_MS;
        return SYNC_POLL.IDLE_MS;
    }

    function markHotSyncWindow() {
        syncState.hotUntil = Date.now() + SYNC_POLL.HOT_AFTER_REMOTE_MS;
    }

    function updateCollabStatusHint(params) {
        if (params?.debugSync) {
            const sec = Math.round(computePollDelayMs() / 1000);
            const mode = syncState.othersEditing ? 'быстрый (~2 с)' : 'редкий (~24 с)';
            setSyncStatus(`Опрос: ${sec} с · ${mode}`, 'info');
            return;
        }
        if (syncState.othersEditing) {
            if (!syncState.collabStatusShown) {
                syncState.collabStatusShown = true;
                setSyncStatus('Совместное редактирование', 'info');
                setTimeout(() => {
                    if (!syncState.othersEditing) setSyncStatus('', '');
                }, 2200);
            }
        } else {
            syncState.collabStatusShown = false;
        }
    }

    async function fetchSyncStatus(params) {
        try {
            return await apiFetch(
                params.apiBase,
                `/configurator/projects/${encodeURIComponent(params.projectId)}/sync?${syncSessionQuery(params)}`,
                { method: 'GET', headers: { Accept: 'application/json' } }
            );
        } catch (e) {
            if (e.status !== 404) throw e;
            const body = await apiFetch(
                params.apiBase,
                `/configurator/projects/${encodeURIComponent(params.projectId)}`,
                { method: 'GET', headers: { Accept: 'application/json' } }
            );
            return {
                id: body?.id,
                updated_at: serverUpdatedAt(body),
                others_editing: false,
                editors: []
            };
        }
    }

    async function fetchAndApplyRemote(designer, params) {
        const body = await apiFetch(
            params.apiBase,
            `/configurator/projects/${encodeURIComponent(params.projectId)}`,
            { method: 'GET', headers: { Accept: 'application/json' } }
        );
        await applyRemoteProjectBody(designer, body);
        syncState.pendingRemoteSync = false;
    }

    function kickSyncSoon(designer, params) {
        if (syncState.pollTimer) clearTimeout(syncState.pollTimer);
        syncState.pollTimer = setTimeout(async () => {
            syncState.pollTimer = null;
            await pollRemoteProject(designer, params);
            scheduleNextPoll(designer, params);
        }, 500);
    }

    async function sendPresenceHeartbeat(params) {
        if (IS_FILE_PROTOCOL || !params.projectId || global.document?.hidden) return;
        try {
            const body = await apiFetch(
                params.apiBase,
                `/configurator/projects/${encodeURIComponent(params.projectId)}/presence`,
                {
                    method: 'POST',
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ session_id: getEditorSessionId() })
                }
            );
            syncState.othersEditing = !!body?.others_editing;
            updateCollabStatusHint(params);
        } catch (e) {
            if (e.status !== 401 && e.status !== 404) {
                console.warn('[LeskomConfiguratorIntegration] presence:', e.message);
            }
        }
    }

    async function applyRemoteProjectBody(designer, body) {
        const remoteAt = serverUpdatedAt(body);
        const remoteProject = extractProject(body);
        if (!remoteProject || !remoteAt) return;

        const remoteFp = projectFingerprint(remoteProject);
        const localFp = projectFingerprint(buildPayload(designer, body.title || ''));

        if (remoteFp === localFp) {
            syncState.knownServerUpdatedAt = remoteAt;
            if (body.title) {
                const titleInput = global.document.getElementById('projectTitleInput');
                if (titleInput) titleInput.value = body.title;
            }
            return;
        }

        syncState.applyingRemote = true;
        designer._suppressProjectDirty = true;
        const collabRemote = syncState.othersEditing;
        if (!collabRemote) setSyncStatus('Синхронизация с сервером…', 'busy');
        try {
            await withWorkspaceSyncTransition(async () => {
                await designer.loadProjectFromObject(remoteProject, { preserveView: true });
                const titleInput = global.document.getElementById('projectTitleInput');
                if (titleInput && body.title) titleInput.value = body.title;
            });
            syncState.knownServerUpdatedAt = remoteAt;
            syncState.localDirty = false;
            markHotSyncWindow();
            if (!collabRemote) {
                setSyncStatus('Синхронизировано', 'ok');
                setTimeout(() => setSyncStatus('', ''), 2800);
            }
        } finally {
            designer._suppressProjectDirty = false;
            syncState.applyingRemote = false;
        }
    }

    async function pollRemoteProject(designer, params) {
        if (IS_FILE_PROTOCOL || !params.projectId) return;
        if (syncState.isSaving || syncState.applyingRemote) return;

        const now = Date.now();
        if (now - syncState.lastPollAt < SYNC_POLL.MIN_GAP_MS) return;
        syncState.lastPollAt = now;

        try {
            const status = await fetchSyncStatus(params);
            syncState.othersEditing = !!status?.others_editing;
            updateCollabStatusHint(params);

            const remoteAt = serverUpdatedAt(status);
            if (!updatedAtChanged(remoteAt, syncState.knownServerUpdatedAt)) return;

            if (syncState.localDirty || isWorkspaceInteractionActive()) {
                syncState.pendingRemoteSync = true;
                return;
            }

            await fetchAndApplyRemote(designer, params);
        } catch (e) {
            if (e.status !== 401) {
                console.warn('[LeskomConfiguratorIntegration] poll:', e.message);
            }
        }
    }

    function scheduleNextPoll(designer, params) {
        if (syncState.pollTimer) clearTimeout(syncState.pollTimer);
        const delay = computePollDelayMs();
        syncState.pollTimer = setTimeout(async () => {
            syncState.pollTimer = null;
            await pollRemoteProject(designer, params);
            scheduleNextPoll(designer, params);
        }, delay);
    }

    function stopAdaptiveSync() {
        if (syncState.pollTimer) clearTimeout(syncState.pollTimer);
        if (syncState.presenceTimer) clearInterval(syncState.presenceTimer);
        syncState.pollTimer = null;
        syncState.presenceTimer = null;
        global.document?.removeEventListener('visibilitychange', syncState._onVisibility);
    }

    function startAdaptiveSync(designer, params) {
        stopAdaptiveSync();
        syncState._designer = designer;
        syncState._params = params;
        bindWorkspaceInteractionGuard();
        sendPresenceHeartbeat(params);
        syncState.presenceTimer = setInterval(() => sendPresenceHeartbeat(params), SYNC_POLL.PRESENCE_MS);
        syncState._onVisibility = () => {
            if (!global.document.hidden) {
                sendPresenceHeartbeat(params);
                scheduleNextPoll(designer, params);
            }
        };
        global.document.addEventListener('visibilitychange', syncState._onVisibility);
        scheduleNextPoll(designer, params);
    }

    /**
     * @param {import('./main').FactoryDesigner} designer
     */
    async function attach(designer) {
        const params = parseParams();
        global.__leskomConfiguratorParams = params;
        global.__leskomProjectId = params.projectId;

        if (designer?.ready) {
            await designer.ready;
        }

        applySiteChrome(!!params.projectId);

        global.__leskomConfiguratorStaff = params.staffHint;
        if (!IS_FILE_PROTOCOL) {
            global.__leskomConfiguratorStaff = await resolveStaffAudience(params);
        }
        if (typeof global.mountHowToUseContent === 'function') {
            global.mountHowToUseContent();
        }

        if (IS_FILE_PROTOCOL) {
            return;
        }

        const userId = params.userId || 'guest';
        designer.projectStorageKey = storageKey(userId, params.projectId);

        try {
            if (params.projectId) {
                await loadProjectFromApi(designer, params, { silent: true });
            } else {
                await createProjectOnServer(designer, params);
            }
            bindProjectChangeHooks(designer, params);
            startAdaptiveSync(designer, params);
        } catch (e) {
            if (e?.message === 'cancelled') {
                designer.showNotification?.('Создание конфигурации отменено', 'warning');
                setSyncStatus('Укажите название для начала работы', 'error');
                return;
            }
            console.error('[LeskomConfiguratorIntegration] attach:', e);
            designer.showNotification?.(
                e.status === 401 ? 'Войдите на сайт ЛЕСКОМ' : 'Ошибка: ' + e.message,
                'error'
            );
        }
    }

    const params = parseParams();
    global.__leskomConfiguratorParams = params;
    if (!IS_FILE_PROTOCOL && global.document.body) {
        applySiteChrome(!!params.projectId);
    } else if (!IS_FILE_PROTOCOL) {
        global.document.addEventListener('DOMContentLoaded', () => applySiteChrome(!!params.projectId));
    }

    global.LeskomConfiguratorIntegration = {
        MESSAGE_SAVED,
        parseParams,
        storageKey,
        attach
    };
})(typeof window !== 'undefined' ? window : globalThis);
