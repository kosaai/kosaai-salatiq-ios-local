const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const transpile = (file) => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

let available = true, calls = 0;
const engine = {};
vm.runInNewContext(transpile('services/engineConnection.ios.ts'), {
  exports: engine,
  require(name) {
    assert.equal(name, '../modules/local-classification');
    return { localClassification: { async checkAvailability() { calls++; return available; } } };
  },
});

async function main() {
  const slots = [], pending = [];
  let cursor = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useRef(v) { const i = cursor++; slots[i] ??= { current: v }; return slots[i]; },
    useState(v) { const i = cursor++; slots[i] ??= { v }; return [slots[i].v, (value) => { slots[i].v = value; }]; },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) { slots[i] = { deps }; pending.push(fn); } },
  };
  const hook = {};
  vm.runInNewContext(transpile('hooks/useEngineConnection.ts'), {
    exports: hook,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react-native') return { Platform: { OS: 'ios' } };
      if (name === '../services/engineConnection') return engine;
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  const render = () => { cursor = 0; const state = hook.useEngineConnection(); pending.splice(0).forEach((fn) => fn()); return state; };
  assert.equal(engine.getEngineApiUrl(), null);
  render();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(render().engineStatus, 'connected', 'iOS hook must load native model despite having no API URL');
  assert.equal(calls, 1);
  available = false;
  assert.equal(await render().checkConnection(), 'error');
  assert.equal(render().engineStatus, 'error');
  available = true;
  assert.equal(await render().checkConnection(), 'connected');
  console.log('PASS: actual iOS engine service AND shared readiness hook use native model loading only; null API URL never blocks iOS; missing model disables readiness.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
