/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { registerStyle, unregisterStyle } from "@utils/css";
import { t } from "@utils/i18n";
import { Logger } from "@utils/Logger";
import { errorMessage } from "@utils/misc";
import { type Plugin, type PluginHooks, StartAt, type XCleanerEventMap } from "@utils/types";

import { dispatch, subscribe } from "./Events";
import { mergePluginSettings, migratePluginSettings, PlainSettings, pluginPath, Settings, settingsStore } from "./Settings";

const logger = new Logger("PluginManager", "#f4c430");

export const plugins: Record<string, Plugin> = {};
const cleanups = new Map<string, Array<() => void>>();

export interface HookDef<K extends keyof PluginHooks> {
    provider: string;
    optional?: boolean;
    attach(plugin: Plugin, value: NonNullable<PluginHooks[K]>): (() => void) | void;
}

const hooks = new Map<keyof PluginHooks, HookDef<any>>();
const hookCleanups = new Map<string, Map<keyof PluginHooks, () => void>>();

function attachHook(plugin: Plugin, key: keyof PluginHooks, hook: HookDef<any>) {
    const value = (plugin as any)[key];
    if (value == null) return;
    const perPlugin = hookCleanups.get(plugin.name) ?? new Map();
    hookCleanups.set(plugin.name, perPlugin);
    if (perPlugin.has(key)) return;
    try {
        const off = hook.attach(plugin, value);
        perPlugin.set(key, off ?? (() => {}));
    } catch (e) {
        logger.error(`Failed to attach ${String(key)} for ${plugin.name}`, e);
    }
}

function detachHook(pluginName: string, key: keyof PluginHooks) {
    const off = hookCleanups.get(pluginName)?.get(key);
    if (!off) return;
    hookCleanups.get(pluginName)!.delete(key);
    try { off(); } catch (e) { logger.error(`Failed to detach ${String(key)} for ${pluginName}`, e); }
}

export function defineHook<K extends keyof PluginHooks>(key: K, def: HookDef<K>) {
    hooks.set(key, def);
}

export function implicitDependencies(plugin: Plugin): string[] {
    const deps = new Set(plugin.dependencies ?? []);
    for (const [key, hook] of hooks) {
        if (!hook.optional && (plugin as any)[key] != null && hook.provider !== plugin.name) deps.add(hook.provider);
    }
    return [...deps];
}

export function registerPlugin(plugin: Plugin) {
    if (plugins[plugin.name]) {
        logger.warn(`Duplicate plugin ${plugin.name}`);
        return;
    }
    if (plugin.oldNames?.length) migratePluginSettings(plugin.name, ...plugin.oldNames);
    plugin.started = false;
    plugins[plugin.name] = plugin;
    if (plugin.settings) plugin.settings.pluginName = plugin.name;
}

function dependents(name: string): Plugin[] {
    return Object.values(plugins).filter(p => p.started && implicitDependencies(p).includes(name));
}

export function isPluginEnabled(name: string): boolean {
    const plugin = plugins[name];
    if (!plugin) return false;
    if (plugin.dev && !IS_DEV) return false;
    if (plugin.required) return true;
    if (plugin.isDependency && Object.values(plugins).some(p => p !== plugin && isPluginEnabled(p.name) && implicitDependencies(p).includes(name))) return true;
    return PlainSettings.plugins[name]?.enabled ?? plugin.enabledByDefault ?? false;
}

function runCleanups(name: string) {
    for (const fn of cleanups.get(name)?.splice(0).reverse() ?? []) {
        try { fn(); } catch (e) { logger.error(`Cleanup error in ${name}`, e); }
    }
    cleanups.delete(name);
}

export function startPlugin(plugin: Plugin, chain: string[] = []): boolean {
    if (plugin.started) return true;
    if (chain.includes(plugin.name)) {
        logger.error(`Circular dependency: ${[...chain, plugin.name].join(" -> ")}`);
        return false;
    }

    for (const depName of implicitDependencies(plugin)) {
        const dep = plugins[depName];
        if (!dep) {
            logger.error(`${plugin.name} is missing dependency ${depName}`);
            plugin.startError = t("缺少依赖插件 {depName}", { depName });
            return false;
        }
        if (!dep.started) {
            dep.isDependency = true;
            if (!startPlugin(dep, [...chain, plugin.name])) {
                plugin.startError = t("依赖插件 {depName} 启动失败", { depName });
                return false;
            }
        }
    }

    const list: Array<() => void> = [];
    cleanups.set(plugin.name, list);
    try {
        if (plugin.managedStyle) {
            registerStyle(`plugin:${plugin.name}`, plugin.managedStyle);
            list.push(() => unregisterStyle(`plugin:${plugin.name}`));
        }
        plugin.start?.();
        plugin.started = true;

        for (const [key, hook] of hooks) {
            if (hook.optional && !plugins[hook.provider]?.started) continue;
            attachHook(plugin, key, hook);
        }
        list.push(() => { for (const key of [...(hookCleanups.get(plugin.name)?.keys() ?? [])]) detachHook(plugin.name, key); });
        for (const [key, hook] of hooks) {
            if (hook.provider !== plugin.name || !hook.optional) continue;
            for (const other of Object.values(plugins)) if (other !== plugin && other.started) attachHook(other, key, hook);
            list.push(() => { for (const other of Object.values(plugins)) detachHook(other.name, key); });
        }
        for (const [event, handler] of Object.entries(plugin.events ?? {})) {
            if (handler) list.push(subscribe(event as keyof XCleanerEventMap, handler.bind(plugin) as any));
        }
        if (plugin.onSettingsChange) {
            const listener = (path: string) => plugin.onSettingsChange!(path);
            list.push(settingsStore.addPrefixChangeListener(pluginPath(plugin.name), listener));
        }
        delete plugin.startError;
        return true;
    } catch (e) {
        logger.error(`Failed to start ${plugin.name}`, e);
        plugin.startError = errorMessage(e);
        plugin.started = true;
        stopPlugin(plugin);
        return false;
    }
}

export function stopPlugin(plugin: Plugin): boolean {
    if (!plugin.started) return true;
    for (const dependent of dependents(plugin.name)) stopPlugin(dependent);
    let ok = true;
    try { plugin.stop?.(); } catch (e) { ok = false; logger.error(`Error in ${plugin.name}.stop()`, e); }
    runCleanups(plugin.name);
    for (const selector of plugin.cleanupSelectors ?? []) {
        for (const el of document.querySelectorAll(selector)) el.remove();
    }
    plugin.started = false;
    return ok;
}

export function setPluginEnabled(name: string, enabled: boolean): boolean {
    const plugin = plugins[name];
    if (!plugin || plugin.required) return false;
    mergePluginSettings(name, { enabled });
    if (enabled) {
        if (!startPlugin(plugin)) {
            mergePluginSettings(name, { enabled: false });
            return false;
        }
    } else {
        stopPlugin(plugin);
        stopUnusedDependencies();
    }
    dispatch("pluginToggle", { name, enabled });
    if (plugin.requiresRestart) markReloadNeeded(name);
    return true;
}

const reloadReasons = new Set<string>();

/** Like Void++'s reloadNeeded: remembers that a change only applies after a reload, for the plugin manager's banner. */
export function markReloadNeeded(name: string) {
    reloadReasons.add(name);
    dispatch("reloadNeeded", { name });
}

export const isReloadNeeded = () => reloadReasons.size > 0;

export const togglePlugin = (name: string) => setPluginEnabled(name, !isPluginEnabled(name));

function stopUnusedDependencies() {
    for (const p of Object.values(plugins)) {
        if (p.started && p.isDependency && !isPluginEnabled(p.name)) stopPlugin(p);
    }
}

export function startAllPlugins(at: StartAt) {
    for (const plugin of Object.values(plugins)) {
        if ((plugin.startAt ?? StartAt.Init) !== at) continue;
        for (const dep of implicitDependencies(plugin)) if (plugins[dep] && isPluginEnabled(plugin.name)) plugins[dep].isDependency = true;
    }
    for (const plugin of Object.values(plugins)) {
        if ((plugin.startAt ?? StartAt.Init) !== at || !isPluginEnabled(plugin.name)) continue;
        startPlugin(plugin);
    }
}

export function stopAllPlugins() {
    for (const plugin of Object.values(plugins).reverse()) stopPlugin(plugin);
}

/** Void++ pruneOrphanedPluginSettings: drops stored settings of plugins that no longer exist. */
export function pruneOrphanedPluginSettings(): string[] {
    const orphaned = Object.keys(PlainSettings.plugins).filter(name => !plugins[name]);
    for (const name of orphaned) {
        logger.info(`Pruning settings for removed plugin ${name}`);
        delete PlainSettings.plugins[name];
    }
    if (orphaned.length) settingsStore.markAsChanged();
    return orphaned;
}

export function trackKnownPlugins(now = Date.now()) {
    const known = { ...PlainSettings.core.knownPlugins };
    let changed = false;
    // Like Void++: only user-facing plugins are tracked, so required/hidden ones never show 「新」.
    for (const name of Object.keys(plugins).filter(n => !plugins[n].hidden && !plugins[n].required)) {
        if (!(name in known)) { known[name] = now; changed = true; }
    }
    if (changed) Settings.core.knownPlugins = known;
}
