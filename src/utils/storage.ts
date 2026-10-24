/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Logger } from "./Logger";
import { safeJsonParse } from "./misc";

const logger = new Logger("Storage");

export interface StorageBackend {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    remove(key: string): void;
}

const hasGM = () => typeof GM_getValue === "function" && typeof GM_setValue === "function";

export const gmStorage: StorageBackend = {
    get(key) {
        if (hasGM()) {
            try {
                const value = GM_getValue(key, null);
                return typeof value === "string" ? safeJsonParse(value) ?? value : value;
            } catch (e) { logger.warn("GM_getValue failed", e); }
        }
        try {
            const raw = localStorage.getItem(key);
            return raw == null ? null : safeJsonParse(raw);
        } catch { return null; }
    },
    set(key, value) {
        if (hasGM()) {
            try { GM_setValue(key, value); return; } catch (e) { logger.warn("GM_setValue failed", e); }
        }
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { logger.warn("localStorage write failed", e); }
    },
    remove(key) {
        if (typeof GM_deleteValue === "function") {
            try { GM_deleteValue(key); } catch {}
        }
        try { localStorage.removeItem(key); } catch {}
    },
};

export function memoryStorage(initial: Record<string, unknown> = {}): StorageBackend & { data: Record<string, unknown> } {
    const data = { ...initial };
    return {
        data,
        get: key => (key in data ? structuredClone(data[key]) : null),
        set(key, value) { data[key] = structuredClone(value); },
        remove(key) { delete data[key]; },
    };
}
