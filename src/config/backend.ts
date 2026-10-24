/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Logger } from "@utils/Logger";

const logger = new Logger("Storage");

export interface KeyValueBackend {
    read(key: string): unknown;
    write(key: string, value: string): void;
    listen?(key: string, cb: (value: unknown, remote: boolean) => void): () => void;
}

declare function GM_addValueChangeListener(key: string, cb: (key: string, oldValue: unknown, newValue: unknown, remote: boolean) => void): number | string;
declare function GM_removeValueChangeListener(id: number | string): void;

export function parseStored(raw: unknown): unknown {
    if (raw == null || raw === "") return null;
    if (typeof raw !== "string") return raw;
    try { return JSON.parse(raw); } catch (e) {
        logger.error("Failed to parse stored value", e);
        return null;
    }
}

export function createGmBackend(): KeyValueBackend {
    const hasGM = typeof GM_getValue === "function" && typeof GM_setValue === "function";
    if (!hasGM) return createMemoryBackend();
    return {
        read: key => parseStored(GM_getValue(key, null)),
        write: (key, value) => GM_setValue(key, value),
        listen(key, cb) {
            if (typeof GM_addValueChangeListener !== "function") return () => {};
            const id = GM_addValueChangeListener(key, (_k, _old, value, remote) => cb(parseStored(value), remote));
            return () => { try { GM_removeValueChangeListener(id); } catch {} };
        },
    };
}

export function createMemoryBackend(initial: Record<string, string> = {}): KeyValueBackend & { data: Record<string, string>; emitRemote(key: string, value: string): void } {
    const data = { ...initial };
    const listeners = new Map<string, Set<(value: unknown, remote: boolean) => void>>();
    return {
        data,
        read: key => parseStored(data[key] ?? null),
        write(key, value) { data[key] = value; },
        listen(key, cb) {
            if (!listeners.has(key)) listeners.set(key, new Set());
            listeners.get(key)!.add(cb);
            return () => listeners.get(key)?.delete(cb);
        },
        emitRemote(key, value) {
            data[key] = value;
            for (const cb of listeners.get(key) ?? []) cb(parseStored(value), true);
        },
    };
}
