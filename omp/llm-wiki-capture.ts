import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "../scripts/lib/config.mjs";

const DEFAULT_VAULT = join(homedir(), "Documents/Obsidian/llm-wiki");
const DEFAULT_WORK_HISTORY = "pages/process/omp-work-history.md";
const ACTIVITY_LOG = "log.md";
const LOCK_DIR = "meta/.omp-capture.lock";
const CAPTURED = new Set<string>();

export interface WorkCapture {
  capture: boolean;
  title: string;
  project: string;
  category: "delivery" | "investigation" | "design" | "operations" | "review" | "learning";
  status: "completed" | "validated" | "delivered" | "investigated";
  summary: string;
  outcomes: string[];
  evidence: string[];
  technologies: string[];
  reason?: string;
}

interface WikiCaptureConfig {
  enabled?: boolean;
  autoCapture?: boolean;
  autoSync?: boolean;
  vaultPath?: string;
  workHistoryPath?: string;
}

interface MessageView {
  role?: string;
  content?: string | unknown[];
  timestamp?: unknown;
  isError?: boolean;
  toolName?: string;
}

interface SessionEntryView {
  type?: string;
  timestamp?: unknown;
  message?: MessageView;
}

interface CaptureCandidate {
  capture?: unknown;
  title?: unknown;
  project?: unknown;
  category?: unknown;
  status?: unknown;
  summary?: unknown;
  outcomes?: unknown;
  evidence?: unknown;
  technologies?: unknown;
  reason?: unknown;
}

const NON_SUBSTANTIVE_TOOLS: Record<string, true> = {
  read: true,
  grep: true,
  glob: true,
  todo: true,
  ask: true,
};
const CATEGORIES: Record<WorkCapture["category"], true> = {
  delivery: true,
  investigation: true,
  design: true,
  operations: true,
  review: true,
  learning: true,
};
const STATUSES: Record<WorkCapture["status"], true> = {
  completed: true,
  validated: true,
  delivered: true,
  investigated: true,
};

function isCategory(value: unknown): value is WorkCapture["category"] {
  return typeof value === "string" && value in CATEGORIES;
}

function isStatus(value: unknown): value is WorkCapture["status"] {
  return typeof value === "string" && value in STATUSES;
}

interface CaptureResult {
  captured: boolean;
  reason: string;
  files?: string[];
  synced?: boolean;
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}


function dateKst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function messageText(message: MessageView): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  const text: string[] = [];
  for (const block of message.content) {
    if (typeof block !== "object" || block === null || !(("type" in block) && ("text" in block))) continue;
    if (block.type === "text" && typeof block.text === "string") text.push(block.text);
  }
  return text.join("\n");
}

function latestTurn(branch: readonly SessionEntryView[]): { userText: string; start: number; stamp: string } | undefined {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry.type !== "message" || entry.message?.role !== "user") continue;
    const userText = messageText(entry.message).trim();
    if (!userText) continue;
    return {
      userText,
      start: index,
      stamp: String(entry.timestamp ?? entry.message.timestamp ?? index),
    };
  }
  return undefined;
}

function shouldClassify(branch: readonly SessionEntryView[], turn: { userText: string; start: number }): boolean {
  const recent = branch.slice(turn.start + 1);
  let successfulTools = 0;
  let substantiveTools = 0;

  for (const entry of recent) {
    if (entry.type !== "message" || entry.message?.role !== "toolResult") continue;
    if (entry.message.isError === true) continue;
    successfulTools += 1;
    const tool = String(entry.message.toolName ?? "").toLowerCase();
    if (!(tool in NON_SUBSTANTIVE_TOOLS)) substantiveTools += 1;
  }

  if (substantiveTools > 0 || successfulTools >= 3) return true;
  return /완료|구축|구현|수정|배포|해결|검증|벤치마크|실험|분석|감사|리뷰|설계|마이그레이션|복구|통합|implement|deploy|fix|benchmark|investigat|audit|review|design|migrat|integrat/i.test(
    turn.userText,
  );
}

function fingerprint(sessionId: string, turn: { userText: string; stamp: string }): string {
  return createHash("sha256")
    .update(sessionId)
    .update("\0")
    .update(turn.stamp)
    .update("\0")
    .update(turn.userText)
    .digest("hex")
    .slice(0, 12);
}

function clean(value: unknown, max = 500): string {
  return String(value ?? "")
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(?:AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, "[REDACTED_SECRET]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_TOKEN]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function textField(value: unknown, max = 500): string {
  return typeof value === "string" ? clean(value, max) : "";
}

function stringList(value: unknown, limit: number, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => clean(item, max)).filter(Boolean).slice(0, limit);
}

export function parseCapture(text: string): WorkCapture | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;

  let raw: CaptureCandidate;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    raw = parsed as CaptureCandidate;
  } catch {
    return undefined;
  }

  if (raw.capture !== true) {
    return {
      capture: false,
      title: "",
      project: "",
      category: "learning",
      status: "investigated",
      summary: "",
      outcomes: [],
      evidence: [],
      technologies: [],
      reason: textField(raw.reason, 300),
    };
  }

  const capture: WorkCapture = {
    capture: true,
    title: textField(raw.title, 100),
    project: textField(raw.project, 100),
    category: isCategory(raw.category) ? raw.category : "delivery",
    status: isStatus(raw.status) ? raw.status : "completed",
    summary: textField(raw.summary, 600),
    outcomes: stringList(raw.outcomes, 6, 400),
    evidence: stringList(raw.evidence, 8, 400),
    technologies: stringList(raw.technologies, 12, 80),
    reason: textField(raw.reason, 300),
  };

  if (!capture.title || !capture.summary || capture.outcomes.length === 0 || capture.evidence.length === 0) {
    return undefined;
  }
  return capture;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function acquireLock(vault: string): Promise<() => Promise<void>> {
  await mkdir(join(vault, "meta"), { recursive: true });
  const lock = join(vault, LOCK_DIR);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await mkdir(lock);
      return () => rm(lock, { recursive: true, force: true });
    } catch (error: unknown) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code !== "EEXIST") throw error;
      try {
        const age = Date.now() - (await stat(lock)).mtimeMs;
        if (age > 120_000) {
          await rm(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        // Another session released the lock between checks.
      }
      await Bun.sleep(50);
    }
  }
  throw new Error("llm-wiki capture lock timed out");
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.omp-${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

function yaml(value: string): string {
  return JSON.stringify(clean(value, 500));
}

function sourceMarkdown(
  capture: WorkCapture,
  meta: { date: string; sessionId: string; fingerprint: string; cwd: string },
): string {
  const outcomes = capture.outcomes.map((item) => `- ${item}`).join("\n");
  const evidence = capture.evidence.map((item) => `- ${item}`).join("\n");
  return `---
title: ${yaml(`OMP work capture — ${capture.title}`)}
captured: ${meta.date}
type: note
source: omp-session
session_id: ${yaml(meta.sessionId)}
fingerprint: ${yaml(meta.fingerprint)}
project: ${yaml(capture.project)}
category: ${capture.category}
status: ${capture.status}
tags: [omp, auto-capture, work-history]
---

# ${capture.title}

${capture.summary}

## 결과
${outcomes}

## 근거
${evidence}

## 기술
${capture.technologies.length ? capture.technologies.map((item) => `- ${item}`).join("\n") : "- 기록 없음"}

## Provenance
- OMP session: \`${meta.sessionId}\`
- Working directory: \`${meta.cwd}\`
- 최신 사용자 요청과 그에 따른 도구 실행·검증 결과만 요약한 자동 캡처.
`;
}

function historyEntry(capture: WorkCapture, sourceSlug: string, date: string): string {
  return `
## ${date} — ${capture.title}
- **프로젝트:** ${capture.project || "미분류"}
- **상태/유형:** ${capture.status} / ${capture.category}
- **요약:** ${capture.summary}
- **결과:** ${capture.outcomes.join(" · ")}
- **근거:** ${capture.evidence.join(" · ")}
- **기술:** ${capture.technologies.length ? capture.technologies.join(", ") : "기록 없음"}
- **원본:** [[sources/${sourceSlug}]]
`;
}

async function runGit(vault: string, args: string[]): Promise<{ code: number; stderr: string }> {
  const child = Bun.spawn(["git", "-C", vault, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  return { code, stderr: stderr.trim() };
}

async function fastForwardFromUpstream(vault: string, autoSync: boolean): Promise<string | undefined> {
  if (!autoSync || process.env.LLM_WIKI_AUTO_SYNC === "0") return "automatic sync disabled";

  const fetched = await runGit(vault, ["fetch", "--quiet"]);
  if (fetched.code !== 0) return `fetch failed; capturing locally: ${fetched.stderr}`;

  const upstream = await runGit(vault, ["rev-parse", "--verify", "@{upstream}"]);
  if (upstream.code !== 0) return "no upstream configured; capturing locally";

  const remoteIsAncestor = await runGit(vault, ["merge-base", "--is-ancestor", "@{upstream}", "HEAD"]);
  if (remoteIsAncestor.code === 0) return undefined;

  const localIsAncestor = await runGit(vault, ["merge-base", "--is-ancestor", "HEAD", "@{upstream}"]);
  if (localIsAncestor.code !== 0) {
    throw new Error("llm-wiki local and upstream branches diverged; resolve them before capturing");
  }

  const advanced = await runGit(vault, ["merge", "--ff-only", "@{upstream}"]);
  if (advanced.code !== 0) throw new Error(`llm-wiki fast-forward failed: ${advanced.stderr}`);
  return undefined;
}

async function commitAndPushCapture(
  vault: string,
  files: string[],
  title: string,
  autoSync: boolean,
): Promise<{ synced: boolean; warning?: string }> {
  if (process.env.LLM_WIKI_AUTO_COMMIT === "0") {
    return { synced: false, warning: "automatic commit disabled" };
  }

  const added = await runGit(vault, ["add", "--", ...files]);
  if (added.code !== 0) throw new Error(`git add failed: ${added.stderr}`);
  const committed = await runGit(vault, ["commit", "-m", `capture: OMP work — ${clean(title, 72)}`, "--", ...files]);
  if (committed.code !== 0 && !committed.stderr.includes("nothing to commit")) {
    throw new Error(`git commit failed: ${committed.stderr}`);
  }
  if (!autoSync || process.env.LLM_WIKI_AUTO_SYNC === "0") {
    return { synced: false, warning: "automatic sync disabled" };
  }

  const pushed = await runGit(vault, ["push"]);
  if (pushed.code !== 0) {
    return { synced: false, warning: `push failed; capture remains local: ${pushed.stderr}` };
  }
  return { synced: true };
}

export async function persistCapture(
  vault: string,
  workHistoryRelative: string,
  autoSync: boolean,
  capture: WorkCapture,
  meta: { date: string; sessionId: string; fingerprint: string; cwd: string },
): Promise<CaptureResult> {
  const release = await acquireLock(vault);
  try {
    const syncWarning = await fastForwardFromUpstream(vault, autoSync);
    await mkdir(join(vault, "sources"), { recursive: true });
    const sourceSlug = `${meta.date}-omp-${meta.sessionId.slice(0, 8)}-${meta.fingerprint}`;
    const sourceRelative = `sources/${sourceSlug}.md`;
    const sourcePath = join(vault, sourceRelative);
    if (await pathExists(sourcePath)) return { captured: false, reason: "already captured" };

    const historyPath = resolve(vault, workHistoryRelative);
    const normalizedHistory = relative(vault, historyPath);
    if (!normalizedHistory || normalizedHistory.startsWith("..") || isAbsolute(normalizedHistory)) {
      throw new Error(`wiki.workHistoryPath escapes the vault: ${workHistoryRelative}`);
    }
    const logPath = join(vault, ACTIVITY_LOG);
    if (!(await pathExists(logPath))) throw new Error(`missing ${ACTIVITY_LOG}; initialize the wiki first`);
    if (!(await pathExists(historyPath))) {
      await mkdir(dirname(historyPath), { recursive: true });
      await writeFile(historyPath, `---
title: OMP 작업 이력
type: work-history
created: ${meta.date}
updated: ${meta.date}
tags: [omp, auto-capture, work-history]
---

# OMP 작업 이력

OMP에서 완료·검증한 작업을 근거와 함께 자동 누적한다.
`, { encoding: "utf8", flag: "wx" });
    }

    const [history, log] = await Promise.all([
      readFile(historyPath, "utf8"),
      readFile(logPath, "utf8"),
    ]);
    const updatedHistory = history.replace(/^updated: .*$/m, `updated: ${meta.date}`).trimEnd()
      + "\n" + historyEntry(capture, sourceSlug, meta.date);
    const historyLink = normalizedHistory.replace(/\.md$/i, "").split("\\").join("/");
    const updatedLog = `${log.trimEnd()}\n\n## [${meta.date}] auto-capture | ${capture.title}\n${capture.summary}\n[[sources/${sourceSlug}]], [[${historyLink}]].\n`;

    await writeFile(sourcePath, sourceMarkdown(capture, meta), { encoding: "utf8", flag: "wx" });
    await atomicWrite(historyPath, updatedHistory);
    await atomicWrite(logPath, updatedLog);

    const files = [sourceRelative, normalizedHistory, ACTIVITY_LOG];
    let synced = false;
    let warning = syncWarning;
    try {
      const result = await commitAndPushCapture(vault, files, capture.title, autoSync);
      synced = result.synced;
      warning = result.warning ?? warning;
    } catch (error) {
      // The wiki bytes are already durable. Leave them visible rather than losing the capture.
      warning = String(error);
      console.error(`[llm-wiki] ${warning}`);
    }
    return { captured: true, synced, reason: warning ?? "captured and pushed", files };
  } finally {
    await release();
  }
}

const CLASSIFIER_PROMPT = `Review only the latest user request and the work performed in response to it in this OMP session.
Return exactly one JSON object and no markdown.

Capture when the latest turn contains at least one of:
- completed implementation, fix, deployment, migration, integration, or operational change;
- validated experiment, benchmark, incident investigation, audit, or substantial code review;
- delivered technical design or a durable cross-repository learning.

Do not capture greetings, planning without delivery, failed attempts without a durable finding, routine questions, or claims unsupported by the user statement or observed tool output. User-reported completed work is evidence, but label it as user-reported. Never include credentials, tokens, private keys, personal evaluations of coworkers, or raw confidential content. Focus on the user's contribution and concrete outcomes. Write concise Korean.

Schema:
{"capture":boolean,"title":"<=100 chars","project":"repo/system","category":"delivery|investigation|design|operations|review|learning","status":"completed|validated|delivered|investigated","summary":"1-2 factual sentences","outcomes":["1-6 concrete outcomes"],"evidence":["1-8 observed files, commands, tests, metrics, PR/task IDs, or user-reported facts"],"technologies":["0-12 items"],"reason":"required when capture=false"}`;

export default function llmWikiCapture(pi: ExtensionAPI): void {
  pi.setLabel("LLM Wiki auto-capture");

  const captureCurrent = async (ctx: ExtensionContext, force = false): Promise<CaptureResult> => {
    if (ctx.agent.kind !== "main") return { captured: false, reason: "subagent" };
    const mergedConfig = loadConfig(ctx.cwd);
    const wiki = (mergedConfig.wiki ?? {}) as WikiCaptureConfig;
    if (wiki.enabled !== true) return { captured: false, reason: "wiki disabled" };
    if (!force && wiki.autoCapture !== true) return { captured: false, reason: "auto-capture disabled" };

    const configuredVault = process.env.LLM_WIKI_PATH || wiki.vaultPath || DEFAULT_VAULT;
    const vault = resolve(expandHome(configuredVault));
    const workHistory = wiki.workHistoryPath || DEFAULT_WORK_HISTORY;
    const autoSync = wiki.autoSync !== false;
    if (resolve(ctx.cwd).startsWith(`${vault}/`) || resolve(ctx.cwd) === vault) {
      return { captured: false, reason: "wiki maintenance session" };
    }
    if (!(await pathExists(join(vault, "CLAUDE.md")))) {
      return { captured: false, reason: `vault unavailable: ${vault}` };
    }

    const branch = ctx.sessionManager.getBranch();
    const turn = latestTurn(branch);
    if (!turn) return { captured: false, reason: "no user turn" };
    if (!force && !shouldClassify(branch, turn)) return { captured: false, reason: "no substantive evidence" };

    const sessionId = String(ctx.sessionManager.getSessionId());
    const key = fingerprint(sessionId, turn);
    if (CAPTURED.has(key)) return { captured: false, reason: "already captured this turn" };
    if (!ctx.runEphemeralTurn) return { captured: false, reason: "ephemeral classifier unavailable" };

    const response = await ctx.runEphemeralTurn({
      promptText: `${CLASSIFIER_PROMPT}\nCurrent working directory: ${ctx.cwd}\nProject fallback: ${basename(ctx.cwd)}`,
      tools: false,
      dedupeReply: true,
      conversationKey: `llm-wiki-capture-${sessionId}-${key}`,
    });
    const capture = parseCapture(response.replyText);
    if (!capture) return { captured: false, reason: "invalid classifier response" };
    if (!capture.capture) return { captured: false, reason: capture.reason || "not durable" };
    if (!capture.project) capture.project = basename(ctx.cwd);

    const result = await persistCapture(vault, workHistory, autoSync, capture, {
      date: dateKst(),
      sessionId,
      fingerprint: key,
      cwd: ctx.cwd,
    });
    if (result.captured) CAPTURED.add(key);
    return result;
  };


  pi.on("session_stop", async (_event, ctx) => {
    try {
      const result = await captureCurrent(ctx);
      if (!result.captured) return;
      if (result.synced) {
        ctx.ui.notify("LLM Wiki에 이번 작업을 기록하고 원격 저장소까지 동기화했습니다.", "info");
      } else {
        ctx.ui.notify(`LLM Wiki에는 기록했지만 원격 동기화가 필요합니다: ${result.reason}`, "warning");
      }
    } catch (error) {
      pi.logger.error(`[llm-wiki] auto-capture failed: ${String(error)}`);
      ctx.ui.notify(`LLM Wiki 자동 기록 실패: ${String(error)}`, "warning");
    }
  });

  pi.registerCommand("wiki-capture", {
    description: "현재 OMP 작업을 LLM Wiki에 강제로 평가·기록",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();
      try {
        const result = await captureCurrent(ctx, true);
        const message = !result.captured
          ? `기록하지 않음: ${result.reason}`
          : result.synced
            ? "LLM Wiki 기록 및 원격 동기화 완료"
            : `로컬 기록 완료, 원격 동기화 필요: ${result.reason}`;
        ctx.ui.notify(message, result.captured && !result.synced ? "warning" : "info");
      } catch (error) {
        ctx.ui.notify(`LLM Wiki 기록 실패: ${String(error)}`, "error");
      }
    },
  });
}
