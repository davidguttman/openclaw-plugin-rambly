import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import type { DaemonCommand, DaemonEvent } from "./types.ts";

export class RamblyDaemon extends EventEmitter {
  private proc: ChildProcess | null = null;
  private _ready = false;

  get ready() {
    return this._ready;
  }

  spawn(room: string, opts: { name: string; command: string; voice?: string }): Promise<void> {
    if (this.proc) {
      throw new Error("Daemon already running. Leave first.");
    }

    return new Promise((resolve, reject) => {
      const args = opts.command.split(/\s+/);
      const bin = args.shift()!;
      args.push("daemon", room, "--name", opts.name, "--json");
      if (opts.voice) {
        args.push("--voice", opts.voice);
      }

      this.proc = spawn(bin, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      const rl = createInterface({ input: this.proc.stdout! });

      rl.on("line", (line) => {
        if (!line.trim()) return;
        try {
          const event: DaemonEvent = JSON.parse(line);
          this.emit("event", event);

          if (event.event === "joined") {
            this._ready = true;
            resolve();
          }

          if (event.event === "error") {
            this.emit("error", new Error(event.message));
          }

          if (event.event === "left") {
            this._ready = false;
          }
        } catch {
          // non-JSON output, ignore
        }
      });

      // Collect stderr for debugging
      const stderrRl = createInterface({ input: this.proc.stderr! });
      stderrRl.on("line", (line) => {
        this.emit("stderr", line);
      });

      this.proc.on("error", (err) => {
        this._ready = false;
        this.proc = null;
        reject(err);
      });

      this.proc.on("exit", (code) => {
        this._ready = false;
        this.proc = null;
        this.emit("exit", code);
      });

      // Timeout if daemon doesn't join within 15s
      setTimeout(() => {
        if (!this._ready) {
          reject(new Error("Daemon failed to join room within 15 seconds"));
          this.kill();
        }
      }, 15000);
    });
  }

  send(cmd: DaemonCommand): void {
    if (!this.proc?.stdin?.writable) {
      throw new Error("Daemon not running");
    }
    this.proc.stdin.write(JSON.stringify(cmd) + "\n");
  }

  kill(): void {
    if (this.proc) {
      try {
        this.send({ action: "leave" });
      } catch {
        // ignore
      }
      setTimeout(() => {
        this.proc?.kill("SIGTERM");
        this.proc = null;
        this._ready = false;
      }, 500);
    }
  }
}
