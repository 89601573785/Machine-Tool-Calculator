/**
 * Шаблон интеграции (справка). Рабочий код: js/integration.js
 */
(function (global) {
    'use strict';

    const MESSAGE_SAVED = 'leskom:configurator:saved';

    function parseParams(search) {
        const q = new URLSearchParams(search || global.location.search);
        const apiBase = (q.get('apiBase') || '/api/v1').replace(/\/$/, '');
        return {
            embed: q.get('embed') === '1' || q.get('embed') === 'true',
            projectId: q.get('projectId') || null,
            userId: q.get('userId') || null,
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
            const err = new Error(res.status === 401 ? 'Войдите на сайт ЛЕСКОМ' : `API ${res.status}`);
            err.status = res.status;
            throw err;
        }
        const ct = res.headers.get('content-type') || '';
        return ct.includes('application/json') ? res.json() : null;
    }

    function notifyParent(parentOrigin, data) {
        if (global.parent === global) return;
        global.parent.postMessage({ type: MESSAGE_SAVED, ...data }, parentOrigin);
    }

    async function attach(designer, params) {
        if (params.embed) {
            global.document.body.classList.add('embed-mode');
        }

        const userId = params.userId || 'guest';
        designer.projectStorageKey = storageKey(userId, params.projectId);

        if (params.projectId) {
            const body = await apiFetch(
                params.apiBase,
                `/configurator/projects/${encodeURIComponent(params.projectId)}`,
                { method: 'GET', headers: { Accept: 'application/json' } }
            );
            const project = extractProject(body);
            if (project) designer.loadProjectFromObject(project);
        }

        global.document.getElementById('saveToCabinetBtn')?.addEventListener('click', async () => {
            const title = global.document.getElementById('projectTitleInput')?.value?.trim() || 'Без названия';
            const project = designer.serializeProject();
            const saved = await apiFetch(params.apiBase, '/configurator/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    id: params.projectId || undefined,
                    title,
                    project
                })
            });
            notifyParent(params.parentOrigin, {
                projectId: saved.id,
                title: saved.title || title,
                updatedAt: saved.updatedAt || new Date().toISOString()
            });
        });
    }

    global.LeskomConfiguratorIntegrationTemplate = {
        parseParams,
        storageKey,
        attach,
        MESSAGE_SAVED
    };
})(typeof window !== 'undefined' ? window : globalThis);
