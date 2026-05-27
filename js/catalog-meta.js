/**
 * Метаданные каталога: catalogType, input/output, шаблоны комплексов.
 * Подключать после equipment-data.js
 */
(function (global) {
    'use strict';

    const CONVEYOR_IDS = new Set([45, 48, 49, 50, 51]);
    const COMPLEX_IDS = new Set([31, 32, 33, 34, 35, 36]);
    const DEFAULT_CONVEYOR_ID = 48;

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

    const BY_ID = {};

    function inferMaterialTypes(eq) {
        const cat = eq.category || '';
        if (CATEGORY_TYPES[cat]) return CATEGORY_TYPES[cat];
        const name = eq.name || '';
        for (const h of NAME_HINTS) {
            if (h.re.test(name)) return { in: h.in, out: h.out };
        }
        if (/транспорт|рольган|скребк/i.test(name)) return { in: 'pilomaterial', out: 'pilomaterial' };
        return { in: 'pilomaterial', out: 'pilomaterial' };
    }

    function resolveCatalogType(eq) {
        if (CONVEYOR_IDS.has(eq.id)) return 'conveyor';
        if (COMPLEX_IDS.has(eq.id)) return 'equipment_complex';
        const cat = (eq.category || '').toLowerCase();
        const name = (eq.name || '').toLowerCase();
        if (cat.includes('лесопильн') && (name.includes('линия') || name.includes('комплекс'))) {
            return 'equipment_complex';
        }
        if (/транспорт|рольган|скребк|конвей/i.test(name)) return 'conveyor';
        return 'machine';
    }

    function enrichEquipment(eq) {
        const item = { ...eq };
        if (!item.efficiency) item.efficiency = 0.85;
        item.catalogType = item.catalogType || resolveCatalogType(item);
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

    function getComplexTemplate(catalogId) {
        return COMPLEX_TEMPLATES[catalogId] || null;
    }

    function getComplexSummary(catalogId) {
        const t = COMPLEX_TEMPLATES[catalogId];
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
        COMPLEX_IDS,
        DEFAULT_CONVEYOR_ID,
        MATERIAL_LABELS,
        COMPLEX_TEMPLATES,
        enrichEquipment,
        enrichAll,
        getComplexTemplate,
        getComplexSummary,
        materialLabel,
        areTypesCompatible,
        isConveyor: (eq) => eq && eq.catalogType === 'conveyor'
    };
})(typeof window !== 'undefined' ? window : globalThis);
