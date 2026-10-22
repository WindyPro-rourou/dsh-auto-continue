/**
 * dsh-auto-continue: durable event log for cross-restart diagnosis.
 *
 * Appends one JSON line per event to <profile>/auto-continue.events.jsonl.
 * Rotates in place when the file exceeds 512KB (keeps the last 200 lines).
 * Every failure is swallowed: logging must never break the plugin fiber.
 */
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 512 * 1024;
const KEEP_LINES = 200;

/** 推导 profile 目录：…/profiles/<name>/node_modules/<pkg>/lib → …/profiles/<name>/ */
function profileDirOf() {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const marker = 'profiles' + sep;
  const idx = here.toLowerCase().lastIndexOf(marker);
  if (idx < 0) throw new Error('profile directory not found above ' + here);
  const rest = here.slice(idx + marker.length);
  const nameEnd = rest.indexOf(sep);
  if (nameEnd < 0) throw new Error('profile name not found in ' + here);
  return here.slice(0, idx + marker.length) + rest.slice(0, nameEnd) + sep;
}

/** 事件日志文件路径（读取端点与写入共用）。 */
export function eventLogPath() {
  return join(profileDirOf(), 'auto-continue.events.jsonl');
}

export function createEventLog(log) {
  let dir;
  try {
    dir = profileDirOf();
  } catch (error) {
    return { append() {} };
  }
  const file = eventLogPath();
  let ready = Promise.resolve().then(async () => {
    await mkdir(dirname(file), { recursive: true });
  }).catch(() => {});

  async function rotateIfNeeded() {
    try {
      const info = await stat(file);
      if (info.size <= MAX_BYTES) return;
      const text = await readFile(file, 'utf8');
      const lines = text.split('\n').filter((l) => l.trim() !== '');
      await writeFile(file, lines.slice(-KEEP_LINES).join('\n') + '\n', 'utf8');
    } catch (error) {
      // 轮转失败不影响主流程
    }
  }

  return {
    append(event) {
      ready = ready.then(async () => {
        await rotateIfNeeded();
        const line = JSON.stringify(Object.assign({ at: Date.now() }, event)) + '\n';
        await appendFile(file, line, 'utf8');
      }).catch(() => {});
    },
  };
}
