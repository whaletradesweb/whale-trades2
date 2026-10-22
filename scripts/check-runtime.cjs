const { reportRuntime } = require('../lib/runtime-security.cjs');
if (!reportRuntime()) {
  console.error('Deployment blocked: Node.js requires 22.23.4, 24.22.1 or 26.12.1 (or a newer patch within those major versions).');
  process.exitCode = 1;
}
