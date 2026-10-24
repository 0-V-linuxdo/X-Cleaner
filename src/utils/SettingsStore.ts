/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { isObject } from "./guards";
import { Logger } from "./Logger";
import { mapGetOrCreate } from "./misc";

const logger = new Logger("SettingsStore");

export type ChangeListener = (path: string) => void;

export class SettingsStore<T extends object> {
    readonly store: T;
    private prefixListeners = new Map<string, Set<ChangeListener>>();
    private defaultGetters = new Map<string, (key: string) => unknown>();
    private proxies = new WeakMap<object, object>();
    private saveTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(public readonly plain: T, private readonly persist: (data: T) => void, private readonly saveDelay = 100) {
        this.store = this.proxify(plain as Record<string, unknown>, "") as T;
    }

    setDefaultGetter(prefix: string, getter: (key: string) => unknown) {
        this.defaultGetters.set(prefix, getter);
    }

    private defaultFor(fullPath: string): unknown {
        for (const [prefix, getter] of this.defaultGetters) {
            if (!fullPath.startsWith(prefix + ".")) continue;
            const key = fullPath.slice(prefix.length + 1);
            if (key && !key.includes(".")) return getter(key);
        }
        return undefined;
    }

    private proxify(target: Record<string, unknown>, path: string): object {
        const cached = this.proxies.get(target);
        if (cached) return cached;
        const join = (key: string) => (path ? `${path}.${key}` : key);
        const proxy = new Proxy(target, {
            get: (t, key) => {
                if (typeof key !== "string") return Reflect.get(t, key);
                let value = t[key];
                if (value === undefined) {
                    const def = this.defaultFor(join(key));
                    if (def !== undefined) value = t[key] = structuredClone(def);
                }
                return isObject(value) || Array.isArray(value) ? this.proxify(value as Record<string, unknown>, join(key)) : value;
            },
            set: (t, key, value) => {
                if (typeof key !== "string") return Reflect.set(t, key, value);
                if (t[key] === value) return true;
                t[key] = value;
                this.notify(join(key));
                return true;
            },
            deleteProperty: (t, key) => {
                if (typeof key !== "string" || !(key in t)) return true;
                delete t[key];
                this.notify(join(key));
                return true;
            },
        });
        this.proxies.set(target, proxy);
        return proxy;
    }

    private notify(path: string) {
        for (const [prefix, set] of Array.from(this.prefixListeners)) {
            if (!(prefix === "" || path === prefix || path.startsWith(prefix + ".") || prefix.startsWith(path + "."))) continue;
            for (const l of Array.from(set)) {
                try { l(path); } catch (e) { logger.error("Listener error", e); }
            }
        }
        this.scheduleSave();
    }

    markAsChanged() { this.notify(""); }

    private scheduleSave() {
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(() => this.flush(), this.saveDelay);
    }

    flush() {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = null;
        try { this.persist(this.plain); } catch (e) { logger.error("Failed to save settings", e); }
    }

    addPrefixChangeListener(prefix: string, listener: ChangeListener) {
        mapGetOrCreate(this.prefixListeners, prefix, () => new Set()).add(listener);
        return () => this.removePrefixChangeListener(prefix, listener);
    }

    removePrefixChangeListener(prefix: string, listener: ChangeListener) {
        const set = this.prefixListeners.get(prefix);
        if (!set) return;
        set.delete(listener);
        if (!set.size) this.prefixListeners.delete(prefix);
    }
}
