// The remote-control daemon: node daemon.ts
// It polls the bot, so run one per bot token. See README.md.
import { agentDir, configPath, readRemoteSettings, readTelegramConfig } from "./src/config.ts";
import { Daemon } from "./src/daemon/daemon.ts";
import { sessionsDir } from "./src/daemon/dirs.ts";
import { linksPath, remoteDir, socketPath } from "./src/remote/protocol.ts";

const path = configPath();
const daemon = new Daemon({
  telegram: await readTelegramConfig(path),
  remote: await readRemoteSettings(path),
  socket: socketPath(),
  dataDir: remoteDir(),
  linksPath: linksPath(),
  sessionsDir: sessionsDir(agentDir()),
  commands: {
    wezterm: process.env.PI_TELEGRAM_WEZTERM ?? "wezterm",
    pi: process.env.PI_TELEGRAM_PI ?? "pi",
  },
});
await daemon.start();
console.error(`Pi Telegram remote control is listening on ${socketPath()}.`);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    void daemon.stop().then(() => process.exit(0));
  });
}
