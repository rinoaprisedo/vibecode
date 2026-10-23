import { existsSync } from "node:fs";
import { chmod, mkdir, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { DATA_DIR } from "./paths";

// Public links to local ports through Cloudflare "quick tunnels": no account, no login, a random *.trycloudflare.com URL.
// The `cloudflared` binary is found on the machine, or downloaded once (on request) into the app's data folder.
const BIN_DIR = join(DATA_DIR, "bin");
const EXE = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
const EXTRA_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".local/bin"), "/usr/bin"];
const sep = process.platform === "win32" ? ";" : ":";

export function cloudflaredBin(): string | null {
  const own = join(BIN_DIR, EXE);
  if (existsSync(own)) return own;
  const dirs = [...(process.env.PATH ?? "").split(sep).filter(Boolean), ...EXTRA_DIRS];
  return dirs.map((d) => join(d, EXE)).find((f) => existsSync(f)) ?? null;
}

// Official release asset for this machine, or null where there is none we know how to handle.
function asset(): { name: string; tgz: boolean } | null {
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : null;
  if (!arch) return null;
  if (process.platform === "darwin") return { name: `cloudflared-darwin-${arch}.tgz`, tgz: true };
  if (process.platform === "linux") return { name: `cloudflared-linux-${arch}`, tgz: false };
  if (process.platform === "win32" && arch === "amd64") return { name: "cloudflared-windows-amd64.exe", tgz: false };
  return null;
}

const text = async (cmd: string[]) => {
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const out = await new Response(p.stdout).text();
    await p.exited;
    return out;
  } catch { return ""; }
};

export type Port = { port: number; process: string; pid: number; inProject: boolean };
export type TunnelInfo = { project: string; port: number; state: "starting" | "live" | "error"; url?: string; error?: string };

// TCP ports something on this machine is listening on, with the process name; flagged when that process was started
// from inside the project folder (its working directory is the folder or below it).
async function listening(root: string, own: number | undefined): Promise<Port[]> {
  if (process.platform === "win32") return [];
  const out = await text(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"]);
  const found = new Map<number, { port: number; process: string; pid: number }>();
  let pid = 0, cmd = "";
  for (const line of out.split("\n")) {
    if (line[0] === "p") pid = +line.slice(1);
    else if (line[0] === "c") cmd = line.slice(1);
    else if (line[0] === "n") {
      const m = line.match(/:(\d+)$/);
      const port = m ? +m[1] : 0;
      if (port && port !== own && !found.has(port)) found.set(port, { port, process: cmd, pid });
    }
  }
  const pids = [...new Set([...found.values()].map((f) => f.pid))];
  const cwds = new Map<number, string>();
  if (pids.length) {
    let cur = 0;
    for (const line of (await text(["lsof", "-a", "-p", pids.join(","), "-d", "cwd", "-Fpn"])).split("\n")) {
      if (line[0] === "p") cur = +line.slice(1);
      else if (line[0] === "n") cwds.set(cur, line.slice(1));
    }
  }
  const inside = (p: number) => { const c = cwds.get(p); return !!c && (c === root || c.startsWith(root.replace(/\/$/, "") + "/")); };
  return [...found.values()].map((f) => ({ ...f, inProject: inside(f.pid) })).sort((a, b) => Number(b.inProject) - Number(a.inProject) || a.port - b.port);
}

export function makeTunnels(broadcast: (m: unknown) => void, ownPort: () => number | undefined) {
  type Run = { proc: ReturnType<typeof Bun.spawn>; info: TunnelInfo; stopping: boolean; log: string[] };
  const runs = new Map<string, Run>();
  const key = (project: string, port: number) => `${project}:${port}`;
  const emit = (r: Run, state: TunnelInfo["state"] | "stopped") => {
    if (state !== "stopped") r.info.state = state;
    broadcast({ type: "tunnel", ...r.info, state });
  };
  let installing: Promise<void> | undefined;

  const stop = (project: string, port: number) => {
    const r = runs.get(key(project, port));
    if (!r) return;
    r.stopping = true;
    r.proc.kill();
  };

  return {
    list: (): TunnelInfo[] => [...runs.values()].map((r) => r.info),
    stop,
    stopProject: (project: string) => { for (const r of runs.values()) if (r.info.project === project) stop(r.info.project, r.info.port); },
    stopAll: () => { for (const r of runs.values()) { r.stopping = true; r.proc.kill(); } },

    async status() {
      const bin = cloudflaredBin();
      const version = bin ? (await text([bin, "--version"])).trim().split("\n")[0] : "";
      return { installed: !!bin, version, canInstall: !!asset(), scan: process.platform !== "win32", tunnels: [...runs.values()].map((r) => r.info) };
    },
    ports: (root: string) => listening(root, ownPort()),

    // Download the official cloudflared release once. The caller waits; parallel calls share one download.
    install(): Promise<void> {
      installing ??= (async () => {
        const a = asset();
        if (!a) throw new Error("No cloudflared download for this system; install it yourself (for example: brew install cloudflared)");
        await mkdir(BIN_DIR, { recursive: true });
        const res = await fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/${a.name}`);
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        // Read the body in pieces so the UI can show a progress bar.
        const total = Number(res.headers.get("content-length")) || 0;
        const parts: Uint8Array[] = [];
        let received = 0, lastEmit = 0;
        const progress = (phase: "downloading" | "unpacking" | "verifying" | "done") => broadcast({ type: "tunnel-install", phase, received, total });
        progress("downloading");
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          parts.push(chunk);
          received += chunk.length;
          if (Date.now() - lastEmit > 100) { lastEmit = Date.now(); progress("downloading"); }
        }
        const data = new Uint8Array(received);
        let at = 0;
        for (const part of parts) { data.set(part, at); at += part.length; }
        progress("unpacking");
        const dest = join(BIN_DIR, EXE);
        if (a.tgz) {
          const tmp = join(BIN_DIR, a.name);
          await Bun.write(tmp, data);
          const p = Bun.spawn(["tar", "-xzf", tmp, "-C", BIN_DIR], { stdout: "ignore", stderr: "pipe" });
          const err = await new Response(p.stderr).text();
          await rm(tmp, { force: true });
          if ((await p.exited) !== 0) throw new Error("Could not unpack cloudflared: " + err.trim());
        } else {
          const tmp = dest + ".part";
          await Bun.write(tmp, data);
          await rename(tmp, dest);
        }
        if (process.platform !== "win32") await chmod(dest, 0o755);
        progress("verifying");
        if (!(await text([dest, "--version"])).includes("cloudflared")) { await rm(dest, { force: true }); throw new Error("The downloaded file does not run on this machine"); }
        progress("done");
      })().finally(() => { installing = undefined; });
      return installing;
    },

    start(project: string, port: number): TunnelInfo {
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
      if (port === ownPort()) throw new Error("That is Vibecode's own port; it is not shared");
      const k = key(project, port);
      const have = runs.get(k);
      if (have) return have.info;
      const bin = cloudflaredBin();
      if (!bin) throw new Error("cloudflared is not installed");

      const proc = Bun.spawn([bin, "tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], {
        stdout: "ignore", stderr: "pipe", stdin: "ignore", env: { ...process.env },
      });
      const run: Run = { proc, info: { project, port, state: "starting" }, stopping: false, log: [] };
      runs.set(k, run);
      emit(run, "starting");

      let url = "", registered = false;
      const maybeLive = () => { if (url && registered && run.info.state === "starting") { run.info.url = url; emit(run, "live"); } };
      const timeout = setTimeout(() => {
        if (run.info.state === "starting") { run.info.error = "Timed out waiting for Cloudflare. Check your internet connection and try again."; proc.kill(); }
      }, 45_000);

      void (async () => {
        const dec = new TextDecoder();
        let buf = "";
        for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
          buf += dec.decode(chunk, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            run.log.push(line);
            if (run.log.length > 30) run.log.shift();
            const m = line.match(/https:\/\/([a-z0-9-]+)\.trycloudflare\.com/i);
            if (m && m[1] !== "api" && !url) url = m[0];
            if (/Registered tunnel connection/i.test(line)) registered = true;
            maybeLive();
          }
        }
      })().catch(() => {});

      void proc.exited.then(() => {
        clearTimeout(timeout);
        if (runs.get(k) === run) runs.delete(k);
        if (!run.stopping && !run.info.error) {
          const errLine = [...run.log].reverse().find((l) => /\b(ERR|error|failed)\b/i.test(l));
          run.info.error = errLine ? errLine.replace(/^\S+\s+(ERR|INF|WRN)\s+/, "").slice(0, 300) : "The tunnel stopped unexpectedly";
        }
        broadcast({ type: "tunnel", project, port, state: run.stopping ? "stopped" : "error", error: run.stopping ? undefined : run.info.error });
      });
      return run.info;
    },
  };
}
