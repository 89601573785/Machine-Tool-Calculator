/**
 * Интеграция конфигуратора с ЛК ЛЕСКОМ (iframe + API).
 * Подключать в index.html до main.js
 * ТЗ: docs/CONFIGURATOR-INTEGRATION.md
 */
(function (global) {
    'use strict';

    const MESSAGE_SAVED = 'leskom:configurator:saved';
    const COOKIE_USER_ID = 'leskom_user_id';

    function getCookie(name) {
        const match = global.document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : null;
    }

    function parseParams(search) {
        const q = new URLSearchParams(search || global.location.search);
        const apiBase = (q.get('apiBase') || '/api/v1').replace(/\/$/, '');
        return {
            embed: q.get('embed') === '1' || q.get('embed') === 'true',
            projectId: q.get('projectId') || null,
            userId: q.get('userId') || getCookie(COOKIE_USER_ID) || null,
            apiBase,
            parentOrigin: q.get('parentOrigin') || global.location.origin
        };
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

    function applyEmbedChrome(params) {
        if (!params.embed) return;
        global.document.body.classList.add('embed-mode');
        const instruction = global.document.getElementById('connectionInstruction');
        if (instruction) instruction.style.display = 'none';
        const saveCabinet = global.document.getElementById('saveToCabinetBtn');
        const titleWrap = global.document.getElementById('projectTitleWrap');
        if (saveCabinet) saveCabinet.hidden = false;
        if (titleWrap) titleWrap.hidden = false;
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

    async function saveProjectToCabinet(designer, params) {
        const titleInput = global.document.getElementById('projectTitleInput');
        const title = titleInput?.value?.trim() || 'Без названия';
        const project = designer.serializeProject();
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

        designer.showNotification?.('Сохранено в личном кабинете', 'success');
        return saved;
    }

    function bindSaveToCabinet(designer, params) {
        const btn = global.document.getElementById('saveToCabinetBtn');
        if (!btn || btn.dataset.leskomBound === '1') return;
        btn.dataset.leskomBound = '1';
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            try {
                await saveProjectToCabinet(designer, params);
            } catch (e) {
                console.error('[LeskomConfiguratorIntegration]', e);
                designer.showNotification?.(e.message || 'Ошибка сохранения', 'error');
            } finally {
                btn.disabled = false;
            }
        });
    }

    /**
     * @param {import('./main').FactoryDesigner} designer
     */
    async function attach(designer) {
        const params = parseParams();
        global.__leskomConfiguratorParams = params;
        global.__leskomProjectId = params.projectId;

        applyEmbedChrome(params);

        const userId = params.userId || 'guest';
        designer.projectStorageKey = storageKey(userId, params.projectId);

        bindSaveToCabinet(designer, params);

        if (params.projectId) {
            try {
                await loadProjectFromApi(designer, params);
                designer.showNotification?.('Проект загружен из ЛК', 'success');
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
    if (params.embed && global.document.body) {
        global.document.body.classList.add('embed-mode');
    } else if (params.embed) {
        global.document.addEventListener('DOMContentLoaded', () => {
            global.document.body.classList.add('embed-mode');
        });
    }

    global.LeskomConfiguratorIntegration = {
        MESSAGE_SAVED,
        parseParams,
        storageKey,
        attach
    };
})(typeof window !== 'undefined' ? window : globalThis);
