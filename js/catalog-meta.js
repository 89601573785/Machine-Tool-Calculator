/**
 * Метаданные каталога: catalogType, input/output, шаблоны комплексов.
 * Подключать после equipment-data.js
 */
(function (global) {
    'use strict';

    /** Транспорт между станками (рольганги, транспортеры на связях) */
    const CONVEYOR_IDS = new Set([45, 48, 49, 50, 51]);
    /** Подача/накопление бревна до линии (не межстаночный конвейер) */
    const LOG_FEED_IDS = new Set([43, 44, 46, 52]);

    const CONVEYOR_NAME_RE = /конвей|рольган|скребк|транспортер|транспортёр|ленточн\w*\s+транспорт|поперечн\w*\s+транспорт|углов\w*\s+транспорт|цепн\w*\s+транспорт|открытый\s+транспорт/i;
    const CONVEYOR_SLUG_RE = /rolgang|rolgangi|skrebkov|lentochnyy-transporter|poperechn|uglovoy-transport|otkrytyy-transport/i;

    const LOG_FEED_NAME_RE = /бревнотас|кантоват|накопитель|центроват|перегруж|поштучн\w*\s+выдач|устройство\s+для\s+поштучн|вращател\s+бревн/i;
    const LOG_FEED_SLUG_RE = /brevnotaska|kantovatel|nakopitel|tsentrovat|poshtuchn|peregruzh|vrashchatel/i;

    const COMPLEX_IDS = new Set([31, 32, 33, 34, 35, 36]);
    const DEFAULT_CONVEYOR_ID = 48;

    /** Подбор станка по legacy catalogId из шаблона (каталог API отдаёт другие id). */
    const LEGACY_MEMBER_SELECTORS = {
        1: ['сбц', 'тополь', 'бревнопил', 'брусовал', 'brusoval'],
        3: ['сбц 480', 'sbts_480', 'sbc_480', 'бревнопильный станок сбц'],
        15: ['град-4', 'grad_4', 'горбыльно-перерабатывающий', 'горбыл'],
        17: ['тсм 100', 'tsm_100', 'мультиторцов', 'multitortsovka', 'торцовоч'],
        39: ['миг-1000', 'mig_1000', 'mig', 'кромкообрез', 'скр'],
        41: ['акула 2m', 'akula_2m', 'многопильный двухвальный', 'многопил'],
        65: ['тсм', 'торцов', 'multitortsovka', 'мультиторц']
    };

    const LEGACY_MEMBER_LABELS = {
        1: 'Бревнопильный станок',
        3: 'Бревнопильный СБЦ 480',
        15: 'Горбыльно-перерабатывающий Град-4',
        17: 'Мультиторцовка ТСМ',
        39: 'Кромкообрезной МИГ-1000',
        41: 'Многопильный Акула',
        65: 'Торцовочный станок'
    };

    /** Состав линий по slug каталога (если нет legacy-шаблона). */
    const COMPLEX_SLUG_STAGE_DEFS = {
        'lesopilynye_linii/derevoobrabatyvayuschiy_kompleks': {
            stages: [
                ['сбц 480', 'бревнопильный станок сбц', 'sbts_480', 'sbc_480'],
                ['акула 2m', 'многопильный двухвальный акула', 'akula_2m'],
                ['миг-1000', 'многопильный одновальный миг', 'mig_1000'],
                ['град-4', 'горбыльно-перерабатывающий станок град', 'grad_4']
            ]
        },
        'lesopilynye_linii/dlya_palletnoy_zagotovki': {
            stages: [
                ['сбц', 'тополь', 'бревнопил', 'брусовал'],
                ['акула', 'многопил'],
                ['миг', 'кромкообрез'],
                ['град-4', 'горбыл'],
                ['тсм', 'мультиторцов', 'торцов']
            ]
        },
        'lesopilynye_linii/dlya_raspilovki_srednego_lesa': {
            stages: [
                ['сбц 480', 'бревнопильный', 'sbts_480'],
                ['акула 2m', 'многопил'],
                ['миг-1000', 'кромкообрез'],
                ['град-4', 'горбыл']
            ]
        },
        'lesopilynye_linii/lesopilynyy_kompleks_s_avtomatizatsiey': {
            stages: [
                ['тополь 450', 'бревнопил тополь', 'topoly_450', 'topol_450'],
                ['акула 2m', 'многопильный двухвальный акула', 'akula_2m'],
                ['миг-1000', 'многопильный одновальный миг', 'mig_1000'],
                ['град-4', 'горбыльно-перерабатывающий станок град', 'grad_4'],
                ['тсм 100', 'мультиторцовка триумф тсм', 'tsm_100', 'multitortsovka']
            ]
        },
        'lesopilynye_linii/tonkomernaya': {
            stages: [
                ['сбц', 'тополь', 'бревнопил'],
                ['акула', 'многопил'],
                ['миг', 'кромкообрез']
            ]
        },
        'lesopilynye_linii/tonkomernaya_s_gorbilnim_stankom': {
            stages: [
                ['сбц', 'тополь', 'бревнопил'],
                ['акула', 'многопил'],
                ['миг', 'кромкообрез'],
                ['град-4', 'горбыл']
            ]
        },
        'profilirovochnye_stanki/kompleks_stankov_dlya_profilirovaniya_brusa_sbp_200': {
            stages: [
                ['сбп 200', 'профилиров', 'sbp_200'],
                ['тсм 100', 'мультиторцовка', 'торцов', 'tsm_100', 'multitortsovka'],
                ['миг-1000', 'акула 2m', 'mig_1000', 'akula_2m']
            ]
        }
    };

    const MATERIAL_LABELS = {
        brevno: 'Бревно',
        lafet: 'Лафет',
        doska: 'Доска',
        gorbyl: 'Горбыль',
        pilomaterial: 'Пиломатериал',
        polufabrikat: 'Полуфабрикат'
    };

    const CATEGORY_TYPES = {
        'Бревнопильные станки': { in: 'brevno', out: 'lafet' },
        'Горбыльные станки': { in: 'gorbyl', out: 'doska' },
        'Кромкообрезные станки': { in: 'lafet', out: 'doska' },
        'Многопильные станки': { in: 'lafet', out: 'doska' },
        'Торцовочные станки': { in: 'polufabrikat', out: 'polufabrikat' },
        'Лесопильные линии': { in: 'brevno', out: 'pilomaterial' }
    };

    const NAME_HINTS = [
        { re: /пилорам|бревнопил|бревнопил|тополь|сбц|сгу|брусовал|12п350/i, in: 'brevno', out: 'lafet' },
        { re: /кромкообрез|миг-|скр/i, in: 'lafet', out: 'doska' },
        { re: /многопиль|акула|бук-|триумф-300/i, in: 'lafet', out: 'doska' },
        { re: /горбыл|град-4|пгд/i, in: 'gorbyl', out: 'doska' },
        { re: /торцов|мультиторц|стб 450|тс-/i, in: 'polufabrikat', out: 'polufabrikat' },
        { re: /ленточн.*делител|лда/i, in: 'lafet', out: 'doska' }
    ];

    /** Шаблоны разворота комплексов (catalogId линии → состав) */
    const COMPLEX_TEMPLATES = {
        33: {
            members: [
                { catalogId: 3, offsetX: 0, offsetY: 0 },
                { catalogId: 39, offsetX: 280, offsetY: 0 },
                { catalogId: 41, offsetX: 560, offsetY: 0 },
                { catalogId: 15, offsetX: 840, offsetY: 0 }
            ],
            connections: [
                { fromIndex: 0, toIndex: 1, conveyorCatalogId: 48 },
                { fromIndex: 1, toIndex: 2, conveyorCatalogId: 48 },
                { fromIndex: 2, toIndex: 3, conveyorCatalogId: 51 }
            ]
        },
        32: {
            members: [
                { catalogId: 1, offsetX: 0, offsetY: 0 },
                { catalogId: 41, offsetX: 280, offsetY: 0 },
                { catalogId: 17, offsetX: 560, offsetY: 0 },
                { catalogId: 15, offsetX: 840, offsetY: 0 },
                { catalogId: 65, offsetX: 1120, offsetY: 0 }
            ],
            connections: [
                { fromIndex: 0, toIndex: 1, conveyorCatalogId: 48 },
                { fromIndex: 1, toIndex: 2, conveyorCatalogId: 48 },
                { fromIndex: 2, toIndex: 3, conveyorCatalogId: 51 },
                { fromIndex: 3, toIndex: 4, conveyorCatalogId: 48 }
            ]
        },
        34: {
            members: [
                { catalogId: 1, offsetX: 0, offsetY: 0 },
                { catalogId: 39, offsetX: 280, offsetY: 0 },
                { catalogId: 41, offsetX: 560, offsetY: 0 },
                { catalogId: 15, offsetX: 840, offsetY: 0 }
            ],
            connections: [
                { fromIndex: 0, toIndex: 1, conveyorCatalogId: 49 },
                { fromIndex: 1, toIndex: 2, conveyorCatalogId: 48 },
                { fromIndex: 2, toIndex: 3, conveyorCatalogId: 51 }
            ]
        },
        31: {
            members: [
                { catalogId: 1, offsetX: 0, offsetY: 0 },
                { catalogId: 39, offsetX: 280, offsetY: 0 },
                { catalogId: 41, offsetX: 560, offsetY: 0 }
            ],
            connections: [
                { fromIndex: 0, toIndex: 1, conveyorCatalogId: 48 },
                { fromIndex: 0, toIndex: 2, conveyorCatalogId: 48 }
            ]
        },
        35: {
            members: [
                { catalogId: 3, offsetX: 0, offsetY: 0 },
                { catalogId: 41, offsetX: 280, offsetY: 0 },
                { catalogId: 15, offsetX: 560, offsetY: 0 }
            ],
            connections: [
                { fromIndex: 0, toIndex: 1, conveyorCatalogId: 48 },
                { fromIndex: 1, toIndex: 2, conveyorCatalogId: 51 }
            ]
        },
        36: {
            members: [
                { catalogId: 3, offsetX: 0, offsetY: 0 },
                { catalogId: 39, offsetX: 280, offsetY: 0 },
                { catalogId: 41, offsetX: 560, offsetY: 0 },
                { catalogId: 15, offsetX: 840, offsetY: 0 }
            ],
            connections: [
                { fromIndex: 0, toIndex: 1, conveyorCatalogId: 50 },
                { fromIndex: 1, toIndex: 2, conveyorCatalogId: 48 },
                { fromIndex: 2, toIndex: 3, conveyorCatalogId: 51 }
            ]
        }
    };

    function inferMaterialTypes(eq) {
        const cat = eq.category || '';
        if (CATEGORY_TYPES[cat]) return CATEGORY_TYPES[cat];
        const name = eq.name || '';
        for (const h of NAME_HINTS) {
            if (h.re.test(name)) return { in: h.in, out: h.out };
        }
        if (isLogFeedLike(eq)) return { in: 'brevno', out: 'brevno' };
        if (isConveyorLike(eq)) return { in: 'pilomaterial', out: 'pilomaterial' };
        return { in: 'pilomaterial', out: 'pilomaterial' };
    }

    function isLogFeedLike(eq) {
        if (!eq) return false;
        const id = Number(eq.id);
        if (Number.isFinite(id) && LOG_FEED_IDS.has(id)) return true;

        const name = (eq.name || '').toLowerCase();
        const cat = (eq.category || '').toLowerCase();
        const type = (eq.equipment_type || '').toLowerCase();
        const slug = String(eq.leskomSlug || eq.url || eq.folder_path || '').toLowerCase();
        const blob = `${name} ${cat} ${type}`;

        if (/отделитель/i.test(blob)) return false;
        if (LOG_FEED_NAME_RE.test(blob)) return true;
        if (LOG_FEED_SLUG_RE.test(slug)) return true;
        return false;
    }

    function isConveyorLike(eq) {
        if (!eq) return false;
        if (isLogFeedLike(eq)) return false;

        const id = Number(eq.id);
        if (Number.isFinite(id) && CONVEYOR_IDS.has(id)) return true;

        const name = (eq.name || '').toLowerCase();
        const cat = (eq.category || '').toLowerCase();
        const type = (eq.equipment_type || '').toLowerCase();
        const slug = String(eq.leskomSlug || eq.url || eq.folder_path || '').toLowerCase();
        const blob = `${name} ${cat} ${type}`;

        if (/отделитель/i.test(blob)) return false;
        if (CONVEYOR_NAME_RE.test(blob)) return true;
        if (CONVEYOR_SLUG_RE.test(slug)) return true;
        return false;
    }

    function normalizeSlug(value) {
        return (value || '')
            .toString()
            .toLowerCase()
            .replace(/\\/g, '/')
            .replace(/^https?:\/\/[^/]+/i, '')
            .replace(/^\/catalog\//, '')
            .replace(/^\/product\//, '')
            .replace(/-/g, '_')
            .replace(/\/+$/, '');
    }

    /** Суффикс slug каталога → id шаблона из COMPLEX_TEMPLATES (legacy equipment-data) */
    const COMPLEX_SLUG_SUFFIX_TO_LEGACY_ID = {
        derevoobrabatyvayuschiy_kompleks: 31,
        derevoobrabativayuschii_kompleks: 31,
        dlya_palletnoy_zagotovki: 32,
        dlya_raspilovki_srednego_lesa: 33,
        kompleks_s_avtomatizaciei: 34,
        lesopilynyy_kompleks_s_avtomatizatsiey: 34,
        tonkomernaya: 35,
        tonkomernaya_s_gorbilnim_stankom: 36
    };

    function slugToLegacyComplexId(eq) {
        const slug = normalizeSlug(eq?.leskomSlug || eq?.url || eq?.folder_path || '');
        if (!slug) return null;
        for (const [suffix, legacyId] of Object.entries(COMPLEX_SLUG_SUFFIX_TO_LEGACY_ID)) {
            const normSuffix = normalizeSlug(suffix);
            if (slug === normSuffix || slug.endsWith('/' + normSuffix) || slug.endsWith(normSuffix)) {
                return legacyId;
            }
        }
        return null;
    }

    function isComplexLike(eq) {
        if (!eq) return false;
        const id = Number(eq.id);
        if (Number.isFinite(id) && COMPLEX_IDS.has(id)) return true;
        if (eq.catalogType === 'equipment_complex') return true;

        const type = (eq.equipment_type || '').toLowerCase().replace(/ё/g, 'е');
        const cat = (eq.category || '').toLowerCase().replace(/ё/g, 'е');
        const name = (eq.name || '').toLowerCase().replace(/ё/g, 'е');
        const slug = normalizeSlug(eq.leskomSlug || eq.url || '');

        if (type.includes('лесопил') && (type.includes('линии') || type.includes('линия'))) return true;
        if (cat.includes('лесопил') && (cat.includes('линии') || cat.includes('линия'))) return true;
        if (slug.includes('lesopil') && slug.includes('linii')) return true;
        if (name.includes('комплекс') && (name.includes('лесопил') || cat.includes('лесопил') || type.includes('лесопил'))) {
            return true;
        }
        if (name.includes('линия') && (name.includes('лесопил') || cat.includes('лесопил') || type.includes('лесопил'))) {
            return true;
        }
        return !!slugToLegacyComplexId(eq);
    }

    function resolveCatalogType(eq) {
        if (isLogFeedLike(eq)) return 'log_feed';
        if (isConveyorLike(eq)) return 'conveyor';
        if (isComplexLike(eq)) return 'equipment_complex';
        return 'machine';
    }

    function enrichEquipment(eq) {
        const item = { ...eq };
        if (!item.efficiency) item.efficiency = 0.85;
        item.catalogType = resolveCatalogType(item);
        const types = inferMaterialTypes(item);
        item.input_type = item.input_type || types.in;
        item.output_type = item.output_type || types.out;
        if (!item.input_materials || !item.input_materials.length) {
            item.input_materials = [{
                name: MATERIAL_LABELS[item.input_type] || 'Сырьё',
                material_type: item.input_type,
                quantity: 1,
                unit: 'м³'
            }];
        }
        if (!item.output_materials || !item.output_materials.length) {
            item.output_materials = [{
                name: MATERIAL_LABELS[item.output_type] || 'Продукция',
                material_type: item.output_type,
                quantity: 0.85,
                unit: 'м³'
            }];
        }
        return item;
    }

    function enrichAll(list) {
        return (list || []).map(enrichEquipment);
    }

    function matchEquipmentByHints(allEquipment, hints, usedIds) {
        const wanted = (hints || []).map((h) =>
            (h || '').toString().toLowerCase().replace(/ё/g, 'е')
        );
        for (const eq of allEquipment || []) {
            if (!eq || usedIds.has(eq.id)) continue;
            if (eq.catalogType === 'conveyor' || eq.catalogType === 'log_feed' || eq.catalogType === 'equipment_complex') {
                continue;
            }
            const hay = `${(eq.name || '').toLowerCase()} ${normalizeSlug(eq.leskomSlug)} ${(eq.category || '').toLowerCase()}`;
            if (wanted.some((h) => h && hay.includes(h))) {
                usedIds.add(eq.id);
                return eq;
            }
        }
        return null;
    }

    function resolveComplexMember(member, allEquipment, usedIds) {
        if (!member || !allEquipment?.length) return null;
        const legacyId = Number(member.catalogId);
        if (Number.isFinite(legacyId)) {
            const direct = allEquipment.find(
                (eq) =>
                    eq.id === legacyId ||
                    Number(eq.configuratorId) === legacyId ||
                    Number(eq.legacyCatalogId) === legacyId
            );
            if (direct && !usedIds.has(direct.id)) {
                usedIds.add(direct.id);
                return direct;
            }
            const hints = LEGACY_MEMBER_SELECTORS[legacyId];
            if (hints) {
                const byHints = matchEquipmentByHints(allEquipment, hints, usedIds);
                if (byHints) return byHints;
            }
        }
        if (member.selectors?.length) {
            return matchEquipmentByHints(allEquipment, member.selectors, usedIds);
        }
        return null;
    }

    function labelFromSelectors(selectors) {
        for (const raw of selectors || []) {
            const s = String(raw || '').trim();
            if (!s || s.length < 3) continue;
            if (/^[a-z0-9_.-]+$/i.test(s) && !/[а-яё]/i.test(s)) continue;
            return s.charAt(0).toUpperCase() + s.slice(1);
        }
        for (const raw of selectors || []) {
            const s = String(raw || '').trim();
            if (s.length >= 2) return s.toUpperCase();
        }
        return null;
    }

    function memberLabel(member, resolvedEq) {
        if (resolvedEq?.name) return resolvedEq.name;
        const legacyId = Number(member?.catalogId);
        if (Number.isFinite(legacyId) && LEGACY_MEMBER_LABELS[legacyId]) {
            return LEGACY_MEMBER_LABELS[legacyId];
        }
        if (Number.isFinite(legacyId) && LEGACY_MEMBER_SELECTORS[legacyId]) {
            const fromHints = labelFromSelectors(LEGACY_MEMBER_SELECTORS[legacyId]);
            if (fromHints) return fromHints;
        }
        return labelFromSelectors(member?.selectors);
    }

    function resolveSlugStageDef(eq) {
        const slug = normalizeSlug(eq?.leskomSlug || eq?.url || eq?.folder_path || '');
        if (!slug) return null;
        if (COMPLEX_SLUG_STAGE_DEFS[slug]) return COMPLEX_SLUG_STAGE_DEFS[slug];
        for (const [key, def] of Object.entries(COMPLEX_SLUG_STAGE_DEFS)) {
            const suffix = key.split('/').pop();
            if (slug === key || slug.endsWith('/' + suffix) || slug.endsWith(suffix)) {
                return def;
            }
        }
        return null;
    }

    function templateFromStageDef(def) {
        if (!def?.stages?.length) return null;
        const members = def.stages.map((selectors) => ({ selectors }));
        const connections = [];
        for (let i = 0; i < members.length - 1; i += 1) {
            connections.push({
                fromIndex: i,
                toIndex: i + 1,
                conveyorCatalogId: DEFAULT_CONVEYOR_ID
            });
        }
        return { members, connections };
    }

    function fallbackStageTemplate(eq) {
        const name = (eq?.name || '').toLowerCase().replace(/ё/g, 'е');
        const slug = normalizeSlug(eq?.leskomSlug || '');
        const stages = [];
        const push = (selectors) => stages.push(selectors);

        if (name.includes('профилиров') || slug.includes('profilirovochn')) {
            push(['сбп 200', 'профилиров', 'четырехсторон']);
            push(['торцов', 'тсм', 'мультиторцов']);
            push(['миг', 'кромкообрез', 'акула']);
        } else {
            push(['сбц', 'тополь', 'бревнопил', 'брусовал']);
            push(['акула', 'многопил', 'двухвальн']);
            push(['миг', 'кромкообрез', 'скр']);
            if (name.includes('автоматиз') || slug.includes('avtomatiz')) {
                push(['град-4', 'горбыл']);
                push(['тсм', 'мультиторцов', 'торцов']);
            } else if (name.includes('горбыл') || slug.includes('gorbil')) {
                push(['град-4', 'горбыл']);
            }
        }

        if (stages.length < 2) return null;
        return templateFromStageDef({ stages });
    }

    function getComplexMemberPreview(catalogId, eq, allEquipment) {
        const t = getComplexTemplate(catalogId, eq);
        if (!t?.members?.length) return '';
        const lines = [];
        for (const m of t.members) {
            const resolved = allEquipment?.length
                ? resolveComplexMember(m, allEquipment, new Set())
                : null;
            const label = memberLabel(m, resolved);
            if (label) lines.push(label);
        }
        if (!lines.length) return '';
        return lines.map((n) => `• ${n}`).join('<br>');
    }

    function getComplexTemplate(catalogId, eq) {
        if (COMPLEX_TEMPLATES[catalogId]) return COMPLEX_TEMPLATES[catalogId];
        const legacyId = slugToLegacyComplexId(eq);
        if (legacyId && COMPLEX_TEMPLATES[legacyId]) return COMPLEX_TEMPLATES[legacyId];
        const slugDef = resolveSlugStageDef(eq);
        if (slugDef) return templateFromStageDef(slugDef);
        if (isComplexLike(eq)) return fallbackStageTemplate(eq);
        return null;
    }

    function getComplexSummary(catalogId, eq) {
        const t = getComplexTemplate(catalogId, eq);
        if (!t) return null;
        const machines = t.members.length;
        const conveyors = t.connections.length;
        return `${machines} станк., ${conveyors} конв.`;
    }

    function materialLabel(code) {
        return MATERIAL_LABELS[code] || code;
    }

    function areTypesCompatible(outType, inType) {
        if (!outType || !inType) return true;
        if (outType === inType) return true;
        if (outType === 'brevno' && inType === 'lafet') return true;
        if (outType === 'lafet' && inType === 'doska') return true;
        if (outType === 'gorbyl' && inType === 'doska') return true;
        if (outType === 'lafet' && inType === 'pilomaterial') return true;
        if (outType === 'pilomaterial' && inType === 'lafet') return true;
        if (outType === 'doska' && inType === 'polufabrikat') return true;
        return false;
    }

    global.CatalogMeta = {
        CONVEYOR_IDS,
        LOG_FEED_IDS,
        DEFAULT_CONVEYOR_ID,
        MATERIAL_LABELS,
        COMPLEX_TEMPLATES,
        enrichEquipment,
        enrichAll,
        getComplexTemplate,
        getComplexSummary,
        getComplexMemberPreview,
        resolveComplexMember,
        LEGACY_MEMBER_SELECTORS,
        LEGACY_MEMBER_LABELS,
        COMPLEX_SLUG_STAGE_DEFS,
        materialLabel,
        areTypesCompatible,
        isLogFeedLike,
        isConveyorLike,
        isComplexLike,
        normalizeSlug,
        slugToLegacyComplexId,
        isConveyor: (eq) => eq && eq.catalogType === 'conveyor',
        isLogFeed: (eq) => eq && eq.catalogType === 'log_feed'
    };
})(typeof window !== 'undefined' ? window : globalThis);
