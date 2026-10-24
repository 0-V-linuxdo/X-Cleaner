/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type LogLevel = "log" | "info" | "warn" | "error" | "debug";

const CAP = "color:#0f1419;font-weight:700;padding:2px 6px;border-radius:6px 0 0 6px;background:#1d9bf0;";
const BODY = "background:#15202b;font-weight:600;padding:2px 6px;border-radius:0 6px 6px 0;";

export class Logger {
    static silent = false;

    constructor(public name: string, public color = "#e7e9ea") {}

    private emit(level: LogLevel, args: unknown[]) {
        if (Logger.silent) return;
        console[level](`%cX Cleaner%c${this.name}`, CAP, `${BODY}color:${this.color};`, ...args);
    }

    log(...args: unknown[]) { this.emit("log", args); }
    info(...args: unknown[]) { this.emit("info", args); }
    warn(...args: unknown[]) { this.emit("warn", args); }
    error(...args: unknown[]) { this.emit("error", args); }
    debug(...args: unknown[]) { this.emit("debug", args); }
}
