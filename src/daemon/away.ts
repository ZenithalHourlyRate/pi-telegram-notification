import { execFile, spawn, type ChildProcess } from "node:child_process";

const SCREENSAVER = ["--session", "--dest", "org.gnome.ScreenSaver", "--object-path", "/org/gnome/ScreenSaver"];

/**
 * Report whether the GNOME screen is locked, now and whenever it changes.
 * Returns a function that stops watching.
 */
export function watchScreenLock(onChange: (locked: boolean) => void, log: (message: string) => void): () => void {
  let stopped = false;
  let child: ChildProcess | undefined;
  let timer: NodeJS.Timeout | undefined;
  let reported = false;

  const start = () => {
    if (stopped) return;
    execFile("gdbus", ["call", ...SCREENSAVER, "--method", "org.gnome.ScreenSaver.GetActive"], (error, stdout) => {
      if (!error && !stopped) onChange(/\btrue\b/.test(stdout));
    });

    // Lines look like "/org/gnome/ScreenSaver: org.gnome.ScreenSaver.ActiveChanged (true,)".
    const monitor = spawn("gdbus", ["monitor", ...SCREENSAVER], { stdio: ["ignore", "pipe", "ignore"] });
    child = monitor;
    let buffer = "";
    monitor.stdout?.setEncoding("utf8");
    monitor.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const match = /ActiveChanged \((true|false)/.exec(line);
        if (match) onChange(match[1] === "true");
      }
    });
    monitor.on("error", (error) => {
      if (!reported) log(`Cannot watch the screen lock with gdbus: ${error.message}`);
      reported = true;
    });
    // gdbus exits when the session bus or GNOME Shell restarts.
    monitor.on("exit", () => {
      if (stopped) return;
      timer = setTimeout(start, 30_000);
      timer.unref();
    });
  };

  start();
  return () => {
    stopped = true;
    clearTimeout(timer);
    child?.kill();
  };
}
