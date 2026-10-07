const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

module.exports = function loadTypescript(file, mocks = {}, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: file,
  });
  const module = { exports: {} };
  const mockRequire = name => Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  new Function('require', 'module', 'exports', ...Object.keys(globals), outputText)(
    mockRequire, module, module.exports, ...Object.values(globals));
  return module.exports;
};
