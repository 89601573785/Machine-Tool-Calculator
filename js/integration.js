/**
 * Интеграция конфигуратора с ЛК ЛЕСКОМ (iframe + API).
 * Подключать в index.html до main.js
 */
(function (global) {
    'use strict';

    const MESSAGE_SAVED = 'leskom:configurator:saved';
    const COOKIE_USER_ID = 'leskom_user_id';
    const IS_FILE_PROTOCOL = global.location?.protocol === 'file:';

    function getCookie(name) {
        const match = global.document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : null;
    }

    function parseParams(search) {
        const q = new URLSearchParams(search || global.location.search);
        const apiBase = (q.get('apiBase') || '/api/v1').replace(/\/$/, '');
        const staffHint = q.get('staff') === '1' || q.get('staff') === 'true';
        return {
            embed: q.get('embed') === '1' || q.get('embed') === 'true',
            projectId: q.get('projectId') || null,
            userId: q.get('userId') || getCookie(COOKIE_USER_ID) || null,
            apiBase,
            parentOrigin: q.get('parentOrigin') || global.location.origin,
            staffHint
        };
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

    function applySiteChrome() {
        if (IS_FILE_PROTOCOL) return;
        const titleWrap = global.document.getElementById('projectTitleWrap');
        const titleInput = global.document.getElementById('projectTitleInput');
        const saveBtn = global.document.getElementById('saveProjectBtn');
        if (titleWrap) titleWrap.hidden = false;
        if (saveBtn) {
            saveBtn.title = 'Сохранить линию в личный кабинет (видно менеджерам)';
            const label = saveBtn.querySelector('.btn-label');
            if (label) label.textContent = ' Сохранить';
        }
        if (titleInput && !titleInput.value) {
            titleInput.placeholder = 'Название линии (например: Лесопильный комплекс)';
        }
    }

    async function loadProjectFromApi(designer, params) {
        const body = await apiFetch(
            params.apiBase,
            `/configurator/projects/${encodeURIComponent(params.projectId)}`,
            { method: 'GET', headers: { Accept: 'application/json' } }
        );
        const project = extractProject(body);
        if (!project) {
            throw new Error('Пустой ответ проекта');
        }
        designer.loadProjectFromObject(project);
        const titleInput = global.document.getElementById('projectTitleInput');
        if (titleInput && body.title) {
            titleInput.value = body.title;
        }
        if (body.id) {
            global.__leskomProjectId = body.id;
            params.projectId = body.id;
        }
    }

    function askProjectTitle(designer, defaultTitle) {
        return new Promise((resolve, reject) => {
            const modal = global.document.getElementById('saveProjectModal');
            const input = global.document.getElementById('saveProjectModalInput');
            const btnOk = global.document.getElementById('saveProjectModalConfirm');
            const btnCancel = global.document.getElementById('saveProjectModalCancel');
            const btnClose = global.document.getElementById('saveProjectModalClose');
            if (!modal || !input || !btnOk) {
                resolve((defaultTitle || '').trim() || 'Без названия');
                return;
            }

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
                    designer.showNotification?.('Введите название конфигурации', 'warning');
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

    async function saveProjectToCabinet(designer, params) {
        const titleInput = global.document.getElementById('projectTitleInput');
        const draftTitle = titleInput?.value?.trim() || designer.getProjectTitle?.() || '';
        const title = await askProjectTitle(designer, draftTitle);
        if (titleInput) titleInput.value = title;

        const project = designer.serializeProject();
        if (project.version !== 1 && project.version !== 2) {
            project.version = Array.isArray(project.connections) && project.connections.length ? 2 : 1;
        }
        project.title = title;
        const id = global.__leskomProjectId || params.projectId || undefined;

        const saved = await apiFetch(params.apiBase, '/configurator/projects', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({ id, title, project })
        });

        const newId = saved?.id || id;
        if (newId) {
            global.__leskomProjectId = newId;
            params.projectId = newId;
            const userId = params.userId || 'guest';
            designer.projectStorageKey = storageKey(userId, newId);
            try {
                const raw = localStorage.getItem(designer.projectStorageKey);
                localStorage.setItem(designer.projectStorageKey, JSON.stringify(project));
            } catch (_) { /* ignore */ }
            try {
                const url = new URL(global.location.href);
                url.searchParams.set('projectId', newId);
                global.history.replaceState({}, '', url);
            } catch (_) { /* ignore */ }
        }

        notifyParent(params.parentOrigin, {
            projectId: newId,
            title: saved?.title || title,
            updatedAt: saved?.updatedAt || new Date().toISOString()
        });

        designer.showNotification?.('Сохранено — менеджеры увидят вашу линию в админке', 'success');
        return saved;
    }

    function bindSaveButton(designer, params) {
        const btn = global.document.getElementById('saveProjectBtn');
        if (!btn || btn.dataset.leskomBound === '1') return;
        btn.dataset.leskomBound = '1';
        btn.addEventListener('click', async (e) => {
            if (IS_FILE_PROTOCOL) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            btn.disabled = true;
            try {
                await saveProjectToCabinet(designer, params);
            } catch (err) {
                if (err?.message === 'cancelled') return;
                console.error('[LeskomConfiguratorIntegration]', err);
                designer.showNotification?.(err.message || 'Ошибка сохранения', 'error');
            } finally {
                btn.disabled = false;
            }
        }, true);
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

        applySiteChrome();

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

        bindSaveButton(designer, params);

        if (params.projectId) {
            try {
                await loadProjectFromApi(designer, params);
                designer.showNotification?.('Проект загружен', 'success');
            } catch (e) {
                console.error('[LeskomConfiguratorIntegration] load:', e);
                designer.showNotification?.(
                    e.status === 401 ? 'Войдите на сайт ЛЕСКОМ' : 'Не удалось загрузить проект: ' + e.message,
                    'error'
                );
            }
        }
    }

    const params = parseParams();
    global.__leskomConfiguratorParams = params;
    if (!IS_FILE_PROTOCOL && global.document.body) {
        applySiteChrome();
    } else if (!IS_FILE_PROTOCOL) {
        global.document.addEventListener('DOMContentLoaded', applySiteChrome);
    }

    global.LeskomConfiguratorIntegration = {
        MESSAGE_SAVED,
        parseParams,
        storageKey,
        saveProjectToCabinet,
        attach
    };
})(typeof window !== 'undefined' ? window : globalThis);
