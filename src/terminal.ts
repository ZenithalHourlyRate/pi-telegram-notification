import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const TIMEOUT_MS = 15_000;

/** A terminal that can run Pi in a pane of its own. */
export type TerminalBackend = "wezterm" | "tmux";

/** The terminal executables, which PI_TELEGRAM_WEZTERM and PI_TELEGRAM_TMUX override. */
export interface TerminalBinaries {
  wezterm: string;
  tmux: string;
}

/** What the daemon needs to open Pi, and to match the session that Pi reports back. */
export interface TerminalCommands extends TerminalBinaries {
  backend: TerminalBackend;
  /** The pi executable, as the terminal server's PATH finds it. */
  pi: string;
  /** The tmux session that gets a window for each Pi. Defaults to "telegram". */
  tmuxSession?: string;
}

/** The tmux session that the daemon uses, and creates when it does not exist. */
const DEFAULT_TMUX_SESSION = "telegram";

export function terminalBinaries(env: NodeJS.ProcessEnv = process.env): TerminalBinaries {
  return {
    wezterm: env.PI_TELEGRAM_WEZTERM ?? "wezterm",
    tmux: env.PI_TELEGRAM_TMUX ?? "tmux",
  };
}

/**
 * The pane that runs a session, as the session reports it. TMUX_PANEL comes first, because it
 * can point a session at a pane other than its own; then the variables that the terminals set.
 */
export function paneOf(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return value(env.TMUX_PANEL) ?? value(env.TMUX_PANE) ?? value(env.WEZTERM_PANE);
}

/** Which terminal runs this session, from the variables that the terminal sets. */
export function backendOf(env: NodeJS.ProcessEnv = process.env): TerminalBackend | undefined {
  const forced = backendChoice(env);
  if (forced && forced !== "auto") return forced;
  if (!paneOf(env)) return undefined;
  // tmux sets TMUX and TMUX_PANE in every pane. TMUX_PANEL means tmux too.
  if (value(env.TMUX) || value(env.TMUX_PANE) || value(env.TMUX_PANEL)) return "tmux";
  return "wezterm";
}

/** PI_TELEGRAM_TERMINAL, when it names a backend. */
export function backendChoice(env: NodeJS.ProcessEnv = process.env): TerminalBackend | "auto" | undefined {
  const choice = env.PI_TELEGRAM_TERMINAL;
  return choice === "tmux" || choice === "wezterm" || choice === "auto" ? choice : undefined;
}

/**
 * Which terminal the daemon opens Pi in. "auto" uses tmux when the daemon runs in tmux or a
 * tmux server is running, because windows then appear in a session that already exists.
 */
export async function resolveBackend(
  choice: TerminalBackend | "auto",
  binaries: TerminalBinaries = terminalBinaries(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<TerminalBackend> {
  if (choice !== "auto") return choice;
  if (value(env.TMUX) || value(env.TMUX_PANE)) return "tmux";
  if (await tmuxServerRunning(binaries)) return "tmux";
  return "wezterm";
}

async function tmuxServerRunning(binaries: TerminalBinaries): Promise<boolean> {
  try {
    await run(binaries.tmux, ["list-sessions", "-F", "#{session_name}"], { timeout: TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

/**
 * Open Pi in a new pane and return that pane's ID, which is what the session reports in "hello".
 * The pane's working directory is the session's directory, which is how Pi files the session
 * where `pi --resume` lists it.
 */
export async function spawnPi(commands: TerminalCommands, cwd: string, args: string[]): Promise<string> {
  return commands.backend === "tmux" ? spawnInTmux(commands, cwd, args) : spawnInWezTerm(commands, cwd, args);
}

/**
 * Press Enter in a pane. The extension cannot submit Pi's editor itself, so it presses Enter
 * the way a person at the computer would: in the tmux pane, or in the WezTerm pane.
 */
export async function pressEnter(
  backend: TerminalBackend,
  pane: string,
  binaries: TerminalBinaries = terminalBinaries(),
): Promise<void> {
  if (backend === "tmux") {
    await run(binaries.tmux, ["send-keys", "-t", pane, "Enter"], { timeout: TIMEOUT_MS });
    return;
  }
  await run(binaries.wezterm, ["cli", "send-text", "--pane-id", pane, "--no-paste", "\r"], { timeout: TIMEOUT_MS });
}

/**
 * Open Pi in a new tab of the WezTerm mux server and return the new pane's ID.
 * The daemon has no WEZTERM_PANE, so it names a window, or opens one if there is none.
 */
async function spawnInWezTerm(commands: TerminalCommands, cwd: string, args: string[]): Promise<string> {
  const list = await run(commands.wezterm, ["cli", "--prefer-mux", "list", "--format", "json"], { timeout: TIMEOUT_MS });
  const panes = JSON.parse(list.stdout) as Array<{ window_id: number }>;
  const windows = panes.map((pane) => pane.window_id);
  const where = windows.length ? ["--window-id", String(Math.min(...windows))] : ["--new-window"];
  const spawned = await run(
    commands.wezterm,
    ["cli", "--prefer-mux", "spawn", ...where, "--cwd", cwd, "--", commands.pi, ...args],
    { timeout: TIMEOUT_MS },
  );
  const pane = spawned.stdout.trim();
  if (!/^\d+$/.test(pane)) throw new Error(`wezterm cli spawn printed ${JSON.stringify(pane)} instead of a pane ID`);
  return pane;
}

/**
 * Open Pi in a new window of the tmux session, or in a new session, and return the new pane's
 * ID, such as %3. The window is detached and remembers its own directory.
 */
async function spawnInTmux(commands: TerminalCommands, cwd: string, args: string[]): Promise<string> {
  const target = await tmuxTarget(commands);
  const where = target.exists
    ? ["new-window", "-d", "-t", `=${target.session}:`]
    : ["new-session", "-d", "-s", target.session];
  const spawned = await run(
    commands.tmux,
    [...where, "-P", "-F", "#{pane_id}", "-c", cwd, "--", commands.pi, ...args],
    { timeout: TIMEOUT_MS },
  );
  const pane = spawned.stdout.trim();
  if (!/^%\d+$/.test(pane)) throw new Error(`tmux printed ${JSON.stringify(pane)} instead of a pane ID`);
  return pane;
}

interface TmuxTarget {
  session: string;
  /** Whether the session exists, and gets a window, instead of being created. */
  exists: boolean;
}

/**
 * The tmux session that a new window goes into. The configured name wins, else the "telegram"
 * session if there is one, else the session the daemon itself runs in, else a session that a
 * client is attached to, most recently used first. The "telegram" session is created when none
 * of these exists.
 */
async function tmuxTarget(commands: TerminalCommands): Promise<TmuxTarget> {
  const wanted = commands.tmuxSession ?? DEFAULT_TMUX_SESSION;
  if (await hasSession(commands, wanted)) return { session: wanted, exists: true };
  // A configured name is used even before the session exists, so it gets exactly that name.
  if (commands.tmuxSession) return { session: wanted, exists: false };
  const other = await sessionOfOwnPane(commands) ?? await sessionWithClient(commands);
  if (other && other !== wanted) return { session: other, exists: true };
  return { session: wanted, exists: false };
}

/** The tmux session of the pane that runs the daemon, for a daemon started by hand inside tmux. */
async function sessionOfOwnPane(commands: TerminalCommands): Promise<string | undefined> {
  const own = value(process.env.TMUX_PANE);
  if (!own || !value(process.env.TMUX)) return undefined;
  try {
    const found = await run(commands.tmux, ["display-message", "-p", "-t", own, "#{session_name}"], { timeout: TIMEOUT_MS });
    return found.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** A tmux session that a client is attached to, so a new window appears where the user looks. */
async function sessionWithClient(commands: TerminalCommands): Promise<string | undefined> {
  try {
    const listed = await run(
      commands.tmux,
      ["list-sessions", "-F", "#{session_name}\t#{session_attached}\t#{session_activity}"],
      { timeout: TIMEOUT_MS },
    );
    const attached = listed.stdout.split("\n").filter(Boolean)
      .map((line) => line.split("\t"))
      .filter(([, count = ""]) => Number(count) > 0)
      .sort((a, b) => Number(b[2] ?? 0) - Number(a[2] ?? 0));
    return attached[0]?.[0] || undefined;
  } catch {
    return undefined;
  }
}

async function hasSession(commands: TerminalCommands, session: string): Promise<boolean> {
  try {
    // = matches the whole name, so "pi" is not taken for "pipi".
    await run(commands.tmux, ["has-session", "-t", `=${session}`], { timeout: TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

function value(item: string | undefined): string | undefined {
  return item ? item : undefined;
}
