import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { repairCredProcess, credProcessCommand } from '../../scripts/lib/aws-cred-install.mjs';

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'cred-install-'));
  return { dir, confPath: join(dir, 'config'), destDir: join(dir, 'bin'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('stale plugin-cache path is repointed to the stable copy, other sections kept', () => {
  const s = sandbox();
  const stale = 'node /home/u/.claude/plugins/cache/codepresso/codepresso/0.2.26/scripts/aws-cred-process.mjs';
  writeFileSync(s.confPath, `[default]\nregion = ap-northeast-2\ncredential_process = ${stale}\n[profile other]\nregion = us-east-1\n`);

  const r = repairCredProcess({ confPath: s.confPath, destDir: s.destDir });

  const expected = credProcessCommand(join(s.destDir, 'aws-cred-process.mjs'));
  assert.strictEqual(r.rewired, true);
  const conf = readFileSync(s.confPath, 'utf-8');
  assert.ok(conf.includes(`credential_process = ${expected}`));
  assert.ok(!conf.includes('0.2.26'));
  assert.ok(conf.includes('[profile other]\nregion = us-east-1'));
  assert.ok(readFileSync(`${s.confPath}.codepresso-repair.bak`, 'utf-8').includes(stale));
  // Second run is a no-op.
  assert.strictEqual(repairCredProcess({ confPath: s.confPath, destDir: s.destDir }).rewired, false);
  s.cleanup();
});

test('installed copy runs standalone (import closure complete)', () => {
  const s = sandbox();
  writeFileSync(s.confPath, '[default]\ncredential_process = node /gone/scripts/aws-cred-process.mjs\n');
  repairCredProcess({ confPath: s.confPath, destDir: s.destDir });
  const session = join(s.dir, 'session.json');
  writeFileSync(session, JSON.stringify({ AccessKeyId: 'ASIA', SecretAccessKey: 'sk', SessionToken: 'tok', Expiration: new Date(Date.now() + 600000).toISOString() }));

  const out = JSON.parse(execFileSync('node', [join(s.destDir, 'aws-cred-process.mjs')], {
    cwd: s.dir, env: { ...process.env, AWS_CRED_PROCESS_SESSION_FILE: session }, encoding: 'utf-8',
  }));
  assert.strictEqual(out.Version, 1);
  assert.strictEqual(out.AccessKeyId, 'ASIA');
  s.cleanup();
});

test('foreign credential_process and configs without one are left alone', () => {
  const s = sandbox();
  const foreign = '[default]\ncredential_process = aws-vault exec work --json\n';
  writeFileSync(s.confPath, foreign);
  assert.strictEqual(repairCredProcess({ confPath: s.confPath, destDir: s.destDir }).rewired, false);
  assert.strictEqual(readFileSync(s.confPath, 'utf-8'), foreign);
  assert.ok(!existsSync(s.destDir));

  writeFileSync(s.confPath, '[default]\nregion = ap-northeast-2\n');
  assert.strictEqual(repairCredProcess({ confPath: s.confPath, destDir: s.destDir }).rewired, false);
  s.cleanup();
});
