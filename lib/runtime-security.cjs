const MINIMUM_PATCH = new Map([[22, [23, 4]], [24, [22, 1]], [26, [12, 1]]]);

function isPatched(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  const minimum = MINIMUM_PATCH.get(major);
  return !!minimum && (minor > minimum[0] || (minor === minimum[0] && patch >= minimum[1]));
}

function reportRuntime() {
  const patched = isPatched(process.version);
  console.info(JSON.stringify({
    event: 'runtime-security-check',
    node: process.version,
    patched,
    deployment: process.env.VERCEL_GIT_COMMIT_SHA || 'local'
  }));
  return patched;
}

module.exports = { isPatched, reportRuntime };
