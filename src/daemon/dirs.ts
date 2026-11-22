import { existsSync, statSync } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

/** Pi's session directory, as in Pi's own configuration. */
export function sessionsDir(agentDir: string): string {
  return process.env.PI_CODING_AGENT_SESSION_DIR ?? join(agentDir, "sessions");
}

/** The first line of a session file. */
export async function readSessionHeader(path: string): Promise<{ id?: string; cwd?: string } | undefined> {
  let handle;
  try {
    handle = await open(path, "r");
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const line = buffer.subarray(0, bytesRead).toString("utf8").split("\n", 1)[0];
    const header = JSON.parse(line) as { type?: string; id?: string; cwd?: string };
    return header.type === "session" ? header : undefined;
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

/** Session files are named <timestamp>_<id>.jsonl, one folder per working directory. */
export async function findSessionFile(root: string, id: string): Promise<string | undefined> {
  const suffix = `_${id}.jsonl`;
  for (const folder of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!folder.isDirectory()) continue;
    const files = await readdir(join(root, folder.name)).catch(() => [] as string[]);
    const name = files.find((file) => file.endsWith(suffix));
    if (name) return join(root, folder.name, name);
  }
  return undefined;
}

/**
 * Working directories of past sessions, newest first. Folder names cannot be decoded,
 * because Pi writes both "/" and "-" as "-", so the newest session's header gives the path.
 */
export async function recentDirectories(root: string): Promise<string[]> {
  const found: Array<{ cwd: string; newest: string }> = [];
  for (const folder of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!folder.isDirectory()) continue;
    const files = (await readdir(join(root, folder.name)).catch(() => [] as string[]))
      .filter((file) => file.endsWith(".jsonl"));
    if (!files.length) continue;
    // File names start with the creation time, so the largest name is the newest session.
    const newest = files.reduce((a, b) => (a > b ? a : b));
    const header = await readSessionHeader(join(root, folder.name, newest));
    if (header?.cwd) found.push({ cwd: header.cwd, newest });
  }
  found.sort((a, b) => (a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : 0));
  const seen = new Set<string>();
  return found
    .map((entry) => entry.cwd)
    .filter((cwd) => {
      if (seen.has(cwd)) return false;
      seen.add(cwd);
      // Leave out caches, such as worktrees that tools create, and folders that are gone.
      return !cwd.split(sep).includes(".cache") && isDirectory(cwd);
    });
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

export function tildify(path: string): string {
  const home = homedir();
  return path === home ? "~" : path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
}

/**
 * Directories that the first word of /new names: a path, or the start of a directory's name.
 * An exact name wins over names that only start with the word.
 */
export function matchDirectory(word: string, directories: string[]): string[] {
  if (word.startsWith("/") || word.startsWith("~")) {
    const path = resolve(expandHome(word));
    return existsSync(path) && isDirectory(path) ? [path] : [];
  }
  const query = word.toLowerCase();
  const exact = directories.filter((dir) => basename(dir).toLowerCase() === query);
  if (exact.length) return exact;
  return directories.filter((dir) => basename(dir).toLowerCase().startsWith(query));
}
