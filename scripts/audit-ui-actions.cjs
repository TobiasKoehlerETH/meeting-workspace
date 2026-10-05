const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function auditInterface() {
  const root = path.resolve(__dirname, '..');
  const native = fs.readFileSync(path.join(root, 'src/lib.rs'), 'utf8');
  const handlerBlock = native.match(/invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1] || '';
  const commands = new Set(handlerBlock.replace(/\/\/[^\n]*/g, '').split(',').map(value => value.trim().split('::').pop()).filter(Boolean));
  const actions = [];
  const invocations = [];
  for (const directory of ['app', 'components', 'contexts', 'hooks', 'lib', 'services']) {
    for (const file of sourceFiles(path.join(root, directory))) {
      const content = fs.readFileSync(file, 'utf8');
      const ast = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      function visit(node) {
        const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
        if (ts.isJsxAttribute(node) && ['onClick', 'onCheckedChange', 'onSubmit', 'onValueChange'].includes(node.name.getText(ast))) {
          actions.push({ file: path.relative(root, file).replaceAll('\\', '/'), line, event: node.name.getText(ast), handler: node.initializer?.getText(ast).slice(0, 180) || '' });
        }
        if (ts.isCallExpression(node) && ['invoke', 'invokeTauri'].includes(node.expression.getText(ast)) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          const command = node.arguments[0].text;
          invocations.push({ file: path.relative(root, file).replaceAll('\\', '/'), line, command, registered: command.startsWith('plugin:') || commands.has(command) });
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
  }
  const outputDirectory = path.join(root, 'tests/ui');
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'action-inventory.json'), JSON.stringify({ actions, invocations }, null, 2) + '\n');
  const missing = invocations.filter(item => !item.registered);
  console.log(JSON.stringify({ actionCount: actions.length, invocationCount: invocations.length, missingCommands: missing }, null, 2));
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

auditInterface();
