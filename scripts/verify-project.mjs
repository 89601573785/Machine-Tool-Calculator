/**
 * Полная проверка проекта Machine-Tool-Calculator.
 * Запуск: node scripts/verify-project.mjs
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function exists(rel) {
    return fs.existsSync(path.join(root, rel));
}

const checks = [];
function ok(name, pass, detail = '') {
    checks.push({ name, pass, detail });
}

function loadEquipmentData() {
    const code = read('js/equipment-data.js');
    const ctx = { window: {}, globalThis: {} };
    ctx.window = ctx;
    vm.runInNewContext(code + '\n;globalThis.EQUIPMENT_DATA = window.EQUIPMENT_DATA;', ctx);
    return ctx.EQUIPMENT_DATA || [];
}

function loadCatalogMeta() {
    const code = read('js/catalog-meta.js');
    const ctx = { window: {}, globalThis: {} };
    ctx.window = ctx;
    vm.runInNewContext(code, ctx);
    return ctx.CatalogMeta;
}

// --- Файловая структура ---
const requiredFiles = [
    'index.html',
    'README.md',
    'js/main.js',
    'js/connections.js',
    'js/catalog-meta.js',
    'js/factory-extensions.js',
    'js/integration.js',
    'js/equipment-data.js',
    'css/style.css',
    'css/theme.css',
    'css/connections.css',
    'css/embed.css',
    'docs/ROADMAP.md',
    'docs/CONFIGURATOR-INTEGRATION.md',
    'scripts/verify-integration.mjs',
    'scripts/audit-data-completeness.py',
    'vendor/README.md'
];
requiredFiles.forEach(f => ok(`Файл: ${f}`, exists(f)));

// --- index.html ссылки ---
const indexHtml = read('index.html');
const localRefs = [
    ...indexHtml.matchAll(/(?:href|src)="(css\/[^"]+|js\/[^"]+)"/g)
].map(m => m[1]);
localRefs.forEach(ref => {
    const cleanRef = ref.split('?')[0];
    ok(`index.html → ${ref}`, exists(cleanRef));
});

ok('Порядок: catalog-meta до main.js',
    indexHtml.indexOf('catalog-meta.js') < indexHtml.indexOf('main.js'));
ok('Порядок: integration.js до main.js',
    indexHtml.indexOf('integration.js') < indexHtml.indexOf('main.js'));
ok('Порядок: factory-extensions после main.js',
    indexHtml.indexOf('factory-extensions.js') > indexHtml.indexOf('main.js'));
ok('Модал conveyorPickerModal', indexHtml.includes('id="conveyorPickerModal"'));
ok('Вкладки каталога', indexHtml.includes('catalog-tabs'));

const domIds = [
    'equipmentSidebar', 'equipmentCatalog', 'equipmentSearch', 'workspaceArea',
    'calculateBtn', 'clearWorkspaceBtn', 'projectSyncStatus',
    'connectModeBtn', 'howToUseBtn', 'howToUseModal', 'howToUseTemplateUser', 'howToUseTemplateStaff',
    'catalogToggleBtn', 'gridCellSizeDisplay',
    'conveyorPickerModal', 'conveyorPickerList', 'calculationChoiceModal',
    'calculationsViewModal', 'projectTitleInput'
];
domIds.forEach(id => ok(`DOM id="${id}"`, indexHtml.includes(`id="${id}"`)));
ok('saveToCabinetBtn удалён (дублирует Сохранить)', !indexHtml.includes('id="saveToCabinetBtn"'));
ok('saveProjectBtn удалён (автосохранение)', !indexHtml.includes('id="saveProjectBtn"'));
ok('меню Проект удалено', !indexHtml.includes('id="projectMenuWrap"'));

// --- Данные каталога ---
let equipment = [];
let CatalogMeta = null;
try {
    equipment = loadEquipmentData();
    ok('EQUIPMENT_DATA загружается', Array.isArray(equipment) && equipment.length > 0,
        `${equipment.length} записей`);
} catch (e) {
    ok('EQUIPMENT_DATA загружается', false, e.message);
}

try {
    CatalogMeta = loadCatalogMeta();
    ok('CatalogMeta доступен', !!CatalogMeta);
} catch (e) {
    ok('CatalogMeta доступен', false, e.message);
}

if (equipment.length && CatalogMeta) {
    const enriched = CatalogMeta.enrichAll(equipment);
    ok('enrichAll не ломает массив', enriched.length === equipment.length);

    const types = { machine: 0, conveyor: 0, equipment_complex: 0 };
    enriched.forEach(eq => { types[eq.catalogType] = (types[eq.catalogType] || 0) + 1; });
    ok('catalogType: machine > 0', types.machine > 0, String(types.machine));
    ok('catalogType: conveyor >= 5', types.conveyor >= 5, String(types.conveyor));
    ok('catalogType: equipment_complex >= 6', types.equipment_complex >= 6, String(types.equipment_complex));

    enriched.forEach(eq => {
        ok(`input_type у id=${eq.id}`, !!eq.input_type, eq.input_type || 'пусто');
        ok(`output_type у id=${eq.id}`, !!eq.output_type, eq.output_type || 'пусто');
    });

    const ids = new Set(enriched.map(e => e.id));
    Object.entries(CatalogMeta.COMPLEX_TEMPLATES).forEach(([complexId, tpl]) => {
        ok(`Комплекс ${complexId} в каталоге`, ids.has(Number(complexId)));
        tpl.members.forEach((m, i) => {
            ok(`  member[${i}] catalogId=${m.catalogId}`, ids.has(m.catalogId));
        });
        tpl.connections.forEach((c, i) => {
            ok(`  link[${i}] conveyor=${c.conveyorCatalogId}`, ids.has(c.conveyorCatalogId));
        });
    });

    CatalogMeta.CONVEYOR_IDS.forEach(id => {
        const eq = enriched.find(e => e.id === id);
        ok(`CONVEYOR_IDS ${id}`, eq && eq.catalogType === 'conveyor', eq?.name || 'не найден');
    });
}

// --- data/factory.db и images ---
ok('data/factory.db', exists('data/factory.db'),
    exists('data/factory.db') ? 'OK' : 'нет — работает fallback equipment-data.js');
ok('images/equipment/', exists('images/equipment'),
    exists('images/equipment') ? 'OK' : 'нет — фото станков будут 404');

if (equipment.length && exists('images/equipment')) {
    let missingPhotos = 0;
    equipment.forEach(eq => {
        if (eq.photo && !eq.photo.startsWith('http')) {
            const p = eq.photo.replace(/^images\/equipment\//, '');
            if (!exists(`images/equipment/${p}`) && !exists(eq.photo)) missingPhotos++;
        }
    });
    ok('Фото оборудования на диске', missingPhotos === 0, missingPhotos ? `${missingPhotos} без файла` : 'OK');
}

// --- vendor ---
const vendorOk = exists('vendor/sql.js/1.8.0/sql-wasm.js') &&
    exists('vendor/jspdf/2.5.1/jspdf.umd.min.js');
ok('vendor/ для продакшена', vendorOk, vendorOk ? 'OK' : 'только README — CDN в index.html');

// --- JS паттерны ROADMAP ---
const mainJs = read('js/main.js');
const connJs = read('js/connections.js');
const extJs = read('js/factory-extensions.js');

ok('expandComplex в extensions', extJs.includes('expandComplex'));
ok('computeLineProduction', extJs.includes('computeLineProduction'));
ok('handleEquipmentDrop', extJs.includes('handleEquipmentDrop'));
ok('serialize version 2', extJs.includes('project.version = 2'));
ok('conveyorCatalogId в serialize', extJs.includes('conveyorCatalogId'));
ok('canConnect без ограничений совместимости', !connJs.includes('areTypesCompatible('));
ok('showConveyorPickerModal', connJs.includes('showConveyorPickerModal'));
ok('CatalogMeta.enrichAll в main.js', mainJs.includes('CatalogMeta.enrichAll'));
ok('handleEquipmentDrop в drop', mainJs.includes('handleEquipmentDrop'));

// --- Дубли / мёртвый код ---
ok('loadProjectFromObject переопределён в extensions',
    extJs.includes('FactoryDesigner.prototype.loadProjectFromObject'));
ok('mountHowToUseContent', mainJs.includes('mountHowToUseContent'));
ok('buildPdfReportSections', mainJs.includes('buildPdfReportSections'));
ok('positionProjectMenu', mainJs.includes('positionProjectMenu'));
ok('escapeHtml в connections', connJs.includes('escapeHtml'));

// --- Итог ---
const passed = checks.filter(c => c.pass).length;
const failed = checks.filter(c => !c.pass);

console.log('\n=== Полная проверка проекта ===\n');
checks.forEach(c => {
    const mark = c.pass ? '✓' : '✗';
    const detail = c.detail ? ` — ${c.detail}` : '';
    console.log(`${mark} ${c.name}${detail}`);
});

console.log(`\nИтого: ${passed}/${checks.length} OK`);

if (failed.length) {
    console.log('\n--- Не прошло / предупреждения ---');
    failed.forEach(c => console.log(`  • ${c.name}${c.detail ? ': ' + c.detail : ''}`));
}

const critical = failed.filter(c =>
    !c.name.includes('vendor') &&
    !c.name.includes('factory.db') &&
    !c.name.includes('images/equipment') &&
    !c.name.includes('Фото оборудования')
);

process.exit(critical.length ? 1 : 0);
