/**
 * Проверка пунктов ТЗ интеграции (статический анализ + unit-тесты хелперов).
 * Запуск: node scripts/verify-integration.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function exists(rel) {
    return fs.existsSync(path.join(root, rel));
}

const checks = [];

function ok(id, name, pass, detail = '') {
    checks.push({ id, name, pass, detail });
}

// --- Файлы ---
ok(0, 'docs/CONFIGURATOR-INTEGRATION.md', exists('docs/CONFIGURATOR-INTEGRATION.md'));
ok(0, 'docs/configurator-integration.js', exists('docs/configurator-integration.js'));
ok(1, 'js/integration.js', exists('js/integration.js'));
ok(5, 'css/embed.css', exists('css/embed.css'));
ok(8, 'vendor/README.md', exists('vendor/README.md'));

const indexHtml = read('index.html');
const integrationJs = read('js/integration.js');
const mainJs = read('js/main.js');
const readme = read('README.md');
const embedCss = read('css/embed.css');

// --- index.html wiring ---
ok(1, 'integration.js подключён до main.js',
    indexHtml.indexOf('js/integration.js') < indexHtml.indexOf('js/main.js'));
ok(2, 'Поле projectTitleInput в index.html', indexHtml.includes('id="projectTitleInput"'));
ok(5, 'embed.css подключён', indexHtml.includes('css/embed.css'));

// --- README ---
ok(9, 'README без server popa/', !readme.includes('server popa'));
ok(9, 'README clone URL Machine-Tool-Calculator',
    readme.includes('89601573785/Machine-Tool-Calculator'));

// --- main.js ---
ok(2, 'serializeProject() в main.js', /serializeProject\s*\(\)/.test(mainJs));
ok(6, 'resolveProjectStorageKey в main.js', mainJs.includes('resolveProjectStorageKey'));
ok(6, 'Нет старого ключа factory_designer_project_v1', !mainJs.includes('factory_designer_project_v1'));
ok(2, 'attach() после FactoryDesigner', mainJs.includes('LeskomConfiguratorIntegration.attach'));

// --- integration.js ---
ok(1, 'credentials: include в apiFetch', integrationJs.includes("credentials: 'include'"));
ok(3, 'GET /configurator/projects/{id}', integrationJs.includes('/configurator/projects/${encodeURIComponent(params.projectId)}') ||
    integrationJs.includes('/configurator/projects/${encodeURIComponent'));
ok(2, 'POST /configurator/projects', integrationJs.includes("apiFetch(params.apiBase, '/configurator/projects'"));
ok(2, 'serializeProject() при сохранении', integrationJs.includes('designer.serializeProject()'));
ok(4, 'postMessage leskom:configurator:saved', integrationJs.includes("'leskom:configurator:saved'"));
ok(5, 'embed-mode на body', integrationJs.includes("'embed-mode'"));
ok(6, 'storageKey factory_designer_{userId}_{projectId}',
    integrationJs.includes('factory_designer_${userId || \'guest\'}_${projectId || \'draft\'}'));

// --- embed css ---
ok(5, 'CSS body.embed-mode', embedCss.includes('body.embed-mode'));

// --- vendor (п.8) ---
const vendorHasJs = exists('vendor/sql.js/1.8.0/sql-wasm.js') &&
    exists('vendor/jspdf/2.5.1/jspdf.umd.min.js');
ok(8, 'Файлы в vendor/ (деплой на хостинг)', vendorHasJs,
    vendorHasJs ? 'OK' : 'только vendor/README.md — в index.html пока CDN');
ok(8, 'index.html: CDN или vendor', indexHtml.includes('cdnjs') || indexHtml.includes('vendor/'));

// --- leskomSlug (п.7 позже) ---
ok(7, 'leskomSlug — отложено', !mainJs.includes('leskomSlug') && !integrationJs.includes('leskomSlug'),
    'не реализовано по плану');

// --- Unit: загрузка integration в sandbox ---
const sandbox = {
    document: { body: { classList: { add: () => {} } }, cookie: '', addEventListener: () => {} },
    location: { search: '?embed=1&projectId=abc-123&userId=u1', origin: 'http://localhost:3000', href: 'http://localhost:3000/?embed=1&projectId=abc-123&userId=u1' },
    parent: {},
    fetch: async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({}) }),
    history: { replaceState: () => {} },
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
    console
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.globalThis = sandbox;

vm.runInNewContext(integrationJs, sandbox, { filename: 'integration.js' });
const L = sandbox.LeskomConfiguratorIntegration;
const p = L.parseParams('?embed=1&projectId=abc-123&userId=u1');
ok(5, 'parseParams embed=1', p.embed === true);
ok(3, 'parseParams projectId', p.projectId === 'abc-123');
ok(6, 'storageKey u1 + abc-123', L.storageKey('u1', 'abc-123') === 'factory_designer_u1_abc-123');
ok(6, 'storageKey guest + draft', L.storageKey(null, null) === 'factory_designer_guest_draft');

// --- Report ---
const passed = checks.filter(c => c.pass).length;
const failed = checks.filter(c => !c.pass);

console.log('\n=== Проверка интеграции (ТЗ) ===\n');
for (const c of checks) {
    const mark = c.pass ? '✓' : '✗';
    const line = c.detail ? ` — ${c.detail}` : '';
    console.log(`${mark} [${c.id || '-'}] ${c.name}${line}`);
}
console.log(`\nИтого: ${passed}/${checks.length} OK`);
if (failed.length) {
    console.log('\nНе прошло:');
    failed.forEach(f => console.log(`  - ${f.name}${f.detail ? ': ' + f.detail : ''}`));
    process.exit(1);
}
