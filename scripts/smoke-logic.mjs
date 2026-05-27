/** Smoke-тесты логики без браузера */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = {
    window: {},
    console,
    alert: () => {},
    document: {
        getElementById: () => null,
        addEventListener: () => {},
        querySelectorAll: () => [],
        body: { appendChild: () => {} }
    }
};
ctx.window = ctx;
ctx.globalThis = ctx;

for (const f of ['js/equipment-data.js', 'js/catalog-meta.js', 'js/connections.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}

const { CatalogMeta, ConnectionManager, EQUIPMENT_DATA } = ctx;
const enriched = CatalogMeta.enrichAll(EQUIPMENT_DATA);
const ws = {
    querySelector: () => null,
    querySelectorAll: () => [],
    appendChild: () => {},
    offsetWidth: 8000,
    offsetHeight: 6000
};
const cm = new ConnectionManager(ws);
cm.setDesigner({ allEquipment: enriched, placedEquipment: [] });

const tests = [
    ['areTypesCompatible brevno→lafet', CatalogMeta.areTypesCompatible('brevno', 'lafet') === true],
    ['areTypesCompatible brevno→doska', CatalogMeta.areTypesCompatible('brevno', 'doska') === false],
    ['areTypesCompatible lafet→doska', CatalogMeta.areTypesCompatible('lafet', 'doska') === true],
    ['6 complex templates', Object.keys(CatalogMeta.COMPLEX_TEMPLATES).length === 6],
    ['5 conveyors in meta', CatalogMeta.CONVEYOR_IDS.size === 5],
    ['canConnect rejects same id', cm.canConnect(1, 1).ok === false],
    ['getComplexSummary 33', !!CatalogMeta.getComplexSummary(33)],
];

let failed = 0;
tests.forEach(([name, pass]) => {
    console.log((pass ? '✓' : '✗') + ' ' + name);
    if (!pass) failed++;
});
process.exit(failed ? 1 : 0);
