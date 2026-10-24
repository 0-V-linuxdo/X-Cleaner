/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { isObject } from "@utils/guards";
import { mergeDefaults } from "@utils/misc";
import { SettingsStore } from "@utils/SettingsStore";
import { gmStorage, type StorageBackend } from "@utils/storage";
import { type DefinedSettings, OptionType, type SettingDef, type SettingsDefinition } from "@utils/types";

export const STORAGE_KEY = "XCleanerSettings";

export interface ThemeData {
    id: string;
    name: string;
    author: string;
    description: string;
    /** Remote themes keep their source so they can be re-fetched; local ones have none. */
    url?: string;
    css: string;
    enabled: boolean;
    updatedAt: number;
}

export interface CoreData {
    pinnedPlugins: string[];
    starredPlugins: string[];
    knownPlugins: Record<string, number>;
    themes: ThemeData[];
    themesEnabled: boolean;
    quickCss: string;
    quickCssEnabled: boolean;
    /** UI language: "auto" follows X's own language setting. */
    language: "auto" | "zh" | "en";
    [key: string]: unknown;
}

export interface SettingsShape {
    plugins: Record<string, { enabled?: boolean; [key: string]: unknown }>;
    core: CoreData;
}

const defaults = (): SettingsShape => ({
    plugins: {},
    core: { pinnedPlugins: [], starredPlugins: [], knownPlugins: {}, themes: [], themesEnabled: true, quickCss: "", quickCssEnabled: true, language: "auto" },
});

let backend: StorageBackend = gmStorage;
const plain = defaults() as SettingsShape;

export const settingsStore = new SettingsStore<SettingsShape>(plain, data => backend.set(STORAGE_KEY, data));
export const Settings = settingsStore.store;
export const PlainSettings = plain;

export const pluginPath = (name: string, key?: string) => (key ? `plugins.${name}.${key}` : `plugins.${name}`);

export function loadSettings(storage: StorageBackend = gmStorage) {
    backend = storage;
    const stored = storage.get(STORAGE_KEY);
    for (const key of Object.keys(plain)) delete (plain as any)[key];
    Object.assign(plain, defaults());
    if (isObject(stored)) {
        if (isObject(stored.plugins)) plain.plugins = stored.plugins as SettingsShape["plugins"];
        if (isObject(stored.core)) plain.core = stored.core as CoreData;
    }
    mergeDefaults(plain, defaults());
}

export function exportSettings(): string {
    return JSON.stringify(plain, null, 2);
}

export function importSettings(json: string): boolean {
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch { return false; }
    if (!isObject(parsed) || !isObject(parsed.plugins)) return false;
    plain.plugins = parsed.plugins as SettingsShape["plugins"];
    if (isObject(parsed.core)) plain.core = parsed.core as CoreData;
    mergeDefaults(plain, defaults());
    settingsStore.markAsChanged();
    settingsStore.flush();
    return true;
}

export function resetPluginSettings(name: string) {
    const enabled = plain.plugins[name]?.enabled;
    plain.plugins[name] = enabled === undefined ? {} : { enabled };
    settingsStore.markAsChanged();
}

/** Void++ migratePluginSettings: carries a renamed plugin's settings over from its first old name that has any. */
export function migratePluginSettings(name: string, ...oldNames: string[]) {
    if (name in plain.plugins) return;
    const old = oldNames.find(n => n in plain.plugins);
    if (!old) return;
    plain.plugins[name] = plain.plugins[old];
    delete plain.plugins[old];
    for (const key of ["pinnedPlugins", "starredPlugins"] as const) {
        plain.core[key] = plain.core[key].map(n => (n === old ? name : n));
    }
    if (old in plain.core.knownPlugins) {
        plain.core.knownPlugins[name] ??= plain.core.knownPlugins[old];
        delete plain.core.knownPlugins[old];
    }
    settingsStore.markAsChanged();
}

/** Void++ migratePluginSetting: renames one setting key inside a plugin. */
export function migratePluginSetting(pluginName: string, newKey: string, oldKey: string) {
    const bag = plain.plugins[pluginName];
    if (!bag || !(oldKey in bag) || newKey in bag) return;
    bag[newKey] = bag[oldKey];
    delete bag[oldKey];
    settingsStore.markAsChanged();
}

/** Void++ migrateSettingsToPlugin: moves settings keys from one plugin to another, e.g. when two plugins merge. */
export function migrateSettingsToPlugin(target: string, source: string, ...keys: string[]) {
    const from = plain.plugins[source];
    if (!from) return;
    const to = plain.plugins[target] ??= {};
    let changed = false;
    for (const key of keys) {
        if (!(key in from) || key in to) continue;
        to[key] = from[key];
        delete from[key];
        changed = true;
    }
    if (changed) settingsStore.markAsChanged();
}

export function resolveDefault(def: SettingDef): unknown {
    if (def.type === OptionType.SELECT) return (def.options.find(o => o.default) ?? def.options[0])?.value;
    return "default" in def ? def.default : undefined;
}

export function mergePluginSettings(name: string, patch: Record<string, unknown>) {
    Settings.plugins[name] = { ...(PlainSettings.plugins[name] ?? {}), ...patch };
}

function toggleInList(key: "pinnedPlugins" | "starredPlugins", name: string): boolean {
    const list = PlainSettings.core[key];
    const has = list.includes(name);
    Settings.core[key] = has ? list.filter(n => n !== name) : [name, ...list];
    return !has;
}

export const togglePinned = (name: string) => toggleInList("pinnedPlugins", name);
export const toggleStarred = (name: string) => toggleInList("starredPlugins", name);
export const isPinned = (name: string) => PlainSettings.core.pinnedPlugins.includes(name);
export const isStarred = (name: string) => PlainSettings.core.starredPlugins.includes(name);

export function definePluginSettings<D extends SettingsDefinition>(def: D): DefinedSettings<D> {
    let name = "";
    const ensure = () => {
        if (!name) throw new Error("Settings accessed before plugin registration");
        return name;
    };
    const defined: DefinedSettings<D> = {
        def,
        get store() { return Settings.plugins[ensure()] as any; },
        get plain() { return PlainSettings.plugins[ensure()] as any; },
        get pluginName() { return name; },
        set pluginName(value: string) {
            name = value;
            PlainSettings.plugins[name] ??= {};
            settingsStore.setDefaultGetter(pluginPath(name), key => (def[key] ? resolveDefault(def[key]) : undefined));
        },
        subscribe: listener => settingsStore.addPrefixChangeListener(pluginPath(ensure()), listener),
        withPrivateSettings: () => defined as any,
    };
    return defined;
}
