// The remote-control daemon: node daemon.ts
// It polls the bot, so run one per bot token. See README.md.
import { agentDir, configPath, readRemoteSettings, readTelegramConfig } from "./src/config.ts";
import { Daemon } from "./src/daemon/daemon.ts";
import { sessionsDir } from "./src/daemon/dirs.ts";
import { linksPath, remoteDir, socketPath } from "./src/remote/protocol.ts";
import { resolveBackend, terminalBinaries, backendChoice } from "./src/terminal.ts";

const path = configPath();
const remote = await readRemoteSettings(path);
const binaries = terminalBinaries();
const backend = await resolveBackend(backendChoice() ?? remote.terminal, binaries);
const tmuxSession = process.env.PI_TELEGRAM_TMUX_SESSION || remote.tmuxSession;
const daemon = new Daemon({
  telegram: await readTelegramConfig(path),
  remote,
  socket: socketPath(),
  dataDir: remoteDir(),
  linksPath: linksPath(),
  sessionsDir: sessionsDir(agentDir()),
  commands: {
    ...binaries,
    backend,
    tmuxSession,
    pi: process.env.PI_TELEGRAM_PI ?? "pi",
  },
});
await daemon.start();
console.error(`Pi Telegram remote control is listening on ${socketPath()}, and opens Pi in ${backend}.`);
if (backend === "tmux") console.error(`New sessions go into tmux session ${tmuxSession ?? "telegram"}.`);
