import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { backendOf, paneOf, resolveBackend, type TerminalBinaries } from "../src/terminal.ts";

test("a session reports the pane of the terminal that runs it", () => {
  assert.equal(paneOf({ TMUX_PANEL: "%3", TMUX_PANE: "%4", WEZTERM_PANE: "7" }), "%3");
  assert.equal(paneOf({ TMUX_PANE: "%4", WEZTERM_PANE: "7" }), "%4");
  assert.equal(paneOf({ WEZTERM_PANE: "7" }), "7");
  assert.equal(paneOf({}), undefined);
});

test("the backend comes from the terminal's variables, or from PI_TELEGRAM_TERMINAL", () => {
  assert.equal(backendOf({ TMUX: "/tmp/tmux-1000/default,1,0", TMUX_PANE: "%4" }), "tmux");
  // A session of this daemon gets TMUX_PANEL even if TMUX and TMUX_PANE are not set.
  assert.equal(backendOf({ TMUX_PANEL: "%4" }), "tmux");
  assert.equal(backendOf({ WEZTERM_PANE: "7" }), "wezterm");
  assert.equal(backendOf({ WEZTERM_PANE: "7", PI_TELEGRAM_TERMINAL: "tmux" }), "tmux");
  assert.equal(backendOf({ PI_TELEGRAM_TERMINAL: "wezterm" }), "wezterm");
  assert.equal(backendOf({}), undefined);
});

test("auto uses tmux when a tmux server is running, and WezTerm otherwise", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-telegram-terminal-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const binaries = (tmuxExit: number): TerminalBinaries => {
    const path = join(dir, `tmux-${tmuxExit}`);
    return { wezterm: "wezterm", tmux: path };
  };
  for (const code of [0, 1]) {
    await writeFile(binaries(code).tmux, `#!/bin/sh\nexit ${code}\n`);
    await chmod(binaries(code).tmux, 0o755);
  }

  assert.equal(await resolveBackend("auto", binaries(0), {}), "tmux");
  assert.equal(await resolveBackend("auto", binaries(1), {}), "wezterm");
  // A daemon that runs inside tmux uses its own server, even when a stale tmux is on PATH.
  assert.equal(await resolveBackend("auto", binaries(1), { TMUX: "/tmp/tmux-1,1,0" }), "tmux");
  // A configured backend wins over detection.
  assert.equal(await resolveBackend("wezterm", binaries(0), {}), "wezterm");
  assert.equal(await resolveBackend("tmux", binaries(1), {}), "tmux");
});
