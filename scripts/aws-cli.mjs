#!/usr/bin/env node
// Codepresso AWS MFA session CLI. Commands: status | detect-mfa | refresh | setup
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { loadConfig } from './lib/config.mjs';
import { getSessionFile, readCache, isSessionValid, parseMfaSerial, parseStsSessionToken, writeCache, redact } from './lib/aws-session.mjs';
import { renameSection, upsertSectionKV, hasSectionKey } from './lib/aws-ini.mjs';
import { installCredProcess, credProcessCommand, repairCredProcess } from './lib/aws-cred-install.mjs';

function awsJson(args) {
  return JSON.parse(execFileSync('aws', [...args, '--output', 'json'], { encoding: 'utf-8' }));
}

function cmdStatus() {
  const cfg = loadConfig();
  const cache = readCache(getSessionFile(cfg));
  const valid = isSessionValid(cache);
  let repair = { rewired: false };
  let repairError = null;
  if (cfg.aws?.enabled) {
    try { repair = repairCredProcess(); } catch (e) { repairError = e.message; }
  }
  console.log(JSON.stringify({
    enabled: !!cfg.aws?.enabled,
    sourceProfile: cfg.aws?.sourceProfile,
    mfaSerial: cfg.aws?.mfaSerial,
    sessionValid: valid,
    expiration: cache?.Expiration || null,
    credProcessRepaired: repair.rewired ? repair.to : null,
    credProcessRepairError: repairError,
  }));
}

function cmdDetectMfa() {
  const cfg = loadConfig();
  const profile = cfg.aws?.sourceProfile || 'codepresso-source';
  const out = awsJson(['iam', 'list-mfa-devices', '--profile', profile]);
  const serial = parseMfaSerial(out);
  console.log(JSON.stringify({ mfaSerial: serial }));
}

function cmdRefresh() {
  const cfg = loadConfig();
  const aws = cfg.aws || {};
  if (!aws.mfaSerial) {
    console.error(JSON.stringify({ ok: false, error: 'NO_MFA_SERIAL', hint: 'Register a virtual TOTP, then run: aws-cli detect-mfa' }));
    process.exit(1);
  }
  const i = process.argv.indexOf('--token-code');
  const code = i >= 0 ? process.argv[i + 1] : null;
  if (!code || !/^\d{6}$/.test(code)) {
    console.error(JSON.stringify({ ok: false, error: 'BAD_CODE', hint: 'Pass --token-code <6 digits>' }));
    process.exit(1);
  }
  try {
    const sts = awsJson([
      'sts', 'get-session-token',
      '--profile', aws.sourceProfile || 'codepresso-source',
      '--serial-number', aws.mfaSerial,
      '--token-code', code,
      '--duration-seconds', String(aws.sessionTtlSeconds || 14400),
    ]);
    const cache = parseStsSessionToken(sts);
    writeCache(getSessionFile(cfg), cache);
    console.log(JSON.stringify({ ok: true, expiration: cache.Expiration, redacted: redact(cache) }));
  } catch (e) {
    const msg = String(e.stderr || e.message || '');
    let error = 'REFRESH_FAILED';
    if (/session credentials/i.test(msg)) error = 'TEMP_SESSION';      // running inside temp creds
    else if (/AccessDenied|MultiFactorAuthentication|invalid.*token|not authorized/i.test(msg)) error = 'BAD_OR_DENIED_CODE';
    console.error(JSON.stringify({ ok: false, error, hint: error === 'TEMP_SESSION' ? 'Run from a normal shell (not inside temp credentials).' : 'Check the 6-digit code and retry.' }));
    process.exit(1);
  }
}

function cmdSetup() {
  const cfg = loadConfig();
  const aws = cfg.aws || {};
  const sourceProfile = aws.sourceProfile || 'codepresso-source';
  const region = aws.region || 'ap-northeast-2';
  const awsDir = join(homedir(), '.aws');
  const credPath = join(awsDir, 'credentials');
  const confPath = join(awsDir, 'config');
  const credProcessScript = installCredProcess();

  // 1. Back up + relocate long-term [default] key → [codepresso-source]
  if (existsSync(credPath)) {
    copyFileSync(credPath, `${credPath}.codepresso.bak`);
    const moved = renameSection(readFileSync(credPath, 'utf-8'), 'default', sourceProfile);
    writeFileSync(credPath, moved, { mode: 0o600 });
  }

  // After step 1: detect a lingering [default] static key (would bypass MFA)
  const defaultKeyRemains = existsSync(credPath)
    && hasSectionKey(readFileSync(credPath, 'utf-8'), 'default', 'aws_access_key_id');

  // 2. Back up + write [default] credential_process into ~/.aws/config
  mkdirSync(awsDir, { recursive: true });
  const confText = existsSync(confPath) ? (copyFileSync(confPath, `${confPath}.codepresso.bak`), readFileSync(confPath, 'utf-8')) : '';
  const newConf = upsertSectionKV(confText, 'default', { credential_process: credProcessCommand(credProcessScript), region });
  writeFileSync(confPath, newConf);

  // 3. Detect mfaSerial via the source profile (allowed without MFA)
  let mfaSerial = null;
  try { mfaSerial = parseMfaSerial(awsJson(['iam', 'list-mfa-devices', '--profile', sourceProfile])); } catch { /* leave null */ }

  // 4. Persist aws config section + enable
  const globalCfgPath = join(homedir(), '.codepresso', 'config.json');
  mkdirSync(dirname(globalCfgPath), { recursive: true });
  const existing = existsSync(globalCfgPath) ? JSON.parse(readFileSync(globalCfgPath, 'utf-8')) : {};
  existing.aws = { ...(existing.aws || {}), enabled: !!mfaSerial, sourceProfile, mfaSerial, sessionTtlSeconds: aws.sessionTtlSeconds || 14400, sessionFile: aws.sessionFile || '~/.codepresso/aws-session.json', region };
  writeFileSync(globalCfgPath, JSON.stringify(existing, null, 2));

  console.log(JSON.stringify({ ok: true, mfaSerial, enabled: !!mfaSerial, credProcess: credProcessScript, backups: [`${credPath}.codepresso.bak`, `${confPath}.codepresso.bak`], note: mfaSerial ? null : 'No virtual TOTP found — register one, then run: aws-cli detect-mfa && aws-cli setup', warning: defaultKeyRemains ? 'A [default] static key remains in ~/.aws/credentials and takes precedence over the credential_process profile — MFA is NOT enforced for the plugin until it is moved/removed (e.g. [codepresso-source] may already exist).' : null }));
}

const cmd = process.argv[2];
const handlers = { status: cmdStatus, 'detect-mfa': cmdDetectMfa, refresh: cmdRefresh, setup: cmdSetup };
if (!handlers[cmd]) { console.error(`Unknown command: ${cmd}`); process.exit(2); }
handlers[cmd]();
