/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isObject } from "./guards";

export const pageWindow: typeof globalThis = typeof unsafeWindow !== "undefined" ? unsafeWindow : globalThis;

export function mergeDefaults<T extends object>(target: T, defaults: T): T {
    for (const [key, def] of Object.entries(defaults)) {
        const value = (target as Record<string, unknown>)[key];
        if (isObject(value) && isObject(def)) mergeDefaults(value, def);
        else if (value === undefined) (target as Record<string, unknown>)[key] = structuredClone(def);
    }
    return target;
}

export function mapGetOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
    let value = map.get(key);
    if (value === undefined) map.set(key, value = create());
    return value;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wrapped = (...args: A) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
    wrapped.cancel = () => clearTimeout(timer);
    return wrapped;
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export const uid = (prefix = "") => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

export function safeJsonParse<T = unknown>(raw: string): T | null {
    try { return JSON.parse(raw) as T; } catch { return null; }
}

export function onlyOnce<A extends unknown[], R>(fn: (...args: A) => R) {
    let done = false;
    let result: R;
    return (...args: A): R => {
        if (!done) { done = true; result = fn(...args); }
        return result;
    };
}
