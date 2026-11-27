import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  /** Whether an interactive session starts with notifications on. Default true. */
  notifyOnStart: boolean;
  /** The model that writes status summaries, as "provider/modelId". Work stays on the session's model. */
  summaryModel?: string;
}

export interface RemoteSettings {
  /** The Telegram user ID of the only person who can control Pi, or undefined if it is not set. */
  userId: string | undefined;
  /** Notify for every session while the GNOME screen is locked. */
  awayOnLock: boolean;
  /** Ask before running a message that arrives this late, such as after the computer wakes up. */
  staleMinutes: number;
  /** The terminal that gets a pane for each Pi it starts. "auto" picks tmux when a tmux server runs. */
  terminal: "auto" | "wezterm" | "tmux";
  /** The tmux session that gets a window for each Pi, or undefined for the default, "telegram". */
  tmuxSession: string | undefined;
}

/** Pi's agent directory, found the way Pi's getAgentDir() finds it, so the daemon need not load Pi. */
export function agentDir(): string {
  const dir = process.env.PI_CODING_AGENT_DIR;
  if (!dir) return join(homedir(), ".pi", "agent");
  if (dir === "~") return homedir();
  return dir.startsWith("~/") ? join(homedir(), dir.slice(2)) : dir;
}

export function configPath(): string {
  return join(agentDir(), "telegram-notification.json");
}

async function readConfigObject(path: string): Promise<Record<string, unknown>> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch {
    throw new Error(`Cannot read ${path}. Configure botToken and chatId first.`);
  }

  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    // JSON parser errors can include a snippet of the secret. Do not show them.
    throw new Error(`Invalid JSON in ${path}.`);
  }
  if (typeof value !== "object" || value === null) throw new Error(`Invalid JSON in ${path}.`);
  return value as Record<string, unknown>;
}

export async function readTelegramConfig(path: string): Promise<TelegramConfig> {
  const config = await readConfigObject(path) as Partial<TelegramConfig>;
  if (
    typeof config.botToken !== "string" ||
    !/^\d+:[A-Za-z0-9_-]+$/.test(config.botToken.trim())
  ) {
    throw new Error(`Telegram botToken is missing or invalid in ${path}.`);
  }
  if (
    (typeof config.chatId !== "string" && typeof config.chatId !== "number") ||
    !String(config.chatId).trim()
  ) {
    throw new Error(`Telegram chatId is missing in ${path}.`);
  }

  const summaryModel = typeof config.summaryModel === "string" ? config.summaryModel.trim() : "";
  return {
    botToken: config.botToken.trim(),
    chatId: String(config.chatId).trim(),
    notifyOnStart: typeof config.notifyOnStart === "boolean" ? config.notifyOnStart : true,
    ...(summaryModel ? { summaryModel } : {}),
  };
}

/** The "remote" object of the same file, which only the daemon reads. */
export async function readRemoteSettings(path: string): Promise<RemoteSettings> {
  const config = await readConfigObject(path);
  const remote = (typeof config.remote === "object" && config.remote !== null ? config.remote : {}) as Record<string, unknown>;
  const userId = typeof remote.userId === "number" || typeof remote.userId === "string" ? String(remote.userId).trim() : "";
  const terminal = readTerminal(remote.terminal);
  const tmuxSession = typeof remote.tmuxSession === "string" ? remote.tmuxSession.trim() : "";
  return {
    userId: /^\d+$/.test(userId) ? userId : undefined,
    awayOnLock: typeof remote.awayOnLock === "boolean" ? remote.awayOnLock : true,
    staleMinutes: typeof remote.staleMinutes === "number" && remote.staleMinutes > 0 ? remote.staleMinutes : 10,
    terminal: terminal.backend,
    tmuxSession: tmuxSession || terminal.session,
  };
}

/**
 * "terminal" is a backend name, or an object { kind, session }, which some configs use.
 * Anything else means "auto".
 */
function readTerminal(value: unknown): { backend: RemoteSettings["terminal"]; session?: string } {
  const backend = (item: unknown): RemoteSettings["terminal"] | undefined =>
    item === "wezterm" || item === "tmux" || item === "auto" ? item : undefined;
  if (typeof value === "string") return { backend: backend(value) ?? "auto" };
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const { kind, session } = value as Record<string, unknown>;
    const name = typeof session === "string" ? session.trim() : "";
    return { backend: backend(kind) ?? "auto", ...(name ? { session: name } : {}) };
  }
  return { backend: "auto" };
}
