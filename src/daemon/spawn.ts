import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface SpawnCommands {
  /** The wezterm executable. */
  wezterm: string;
  /** The pi executable, as the WezTerm mux server's PATH finds it. */
  pi: string;
}

/**
 * Open Pi in a new tab of the WezTerm mux server and return the new pane's ID.
 * The daemon has no WEZTERM_PANE, so it names a window, or opens one if there is none.
 */
export async function spawnPi(commands: SpawnCommands, cwd: string, args: string[]): Promise<string> {
  const list = await run(commands.wezterm, ["cli", "--prefer-mux", "list", "--format", "json"], { timeout: 15_000 });
  const panes = JSON.parse(list.stdout) as Array<{ window_id: number }>;
  const windows = panes.map((pane) => pane.window_id);
  const where = windows.length ? ["--window-id", String(Math.min(...windows))] : ["--new-window"];
  const spawned = await run(
    commands.wezterm,
    ["cli", "--prefer-mux", "spawn", ...where, "--cwd", cwd, "--", commands.pi, ...args],
    { timeout: 15_000 },
  );
  const pane = spawned.stdout.trim();
  if (!/^\d+$/.test(pane)) throw new Error(`wezterm cli spawn printed ${JSON.stringify(pane)} instead of a pane ID`);
  return pane;
}
