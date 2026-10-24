/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export enum OptionType {
    STRING = "string",
    NUMBER = "number",
    BOOLEAN = "boolean",
    SELECT = "select",
    SLIDER = "slider",
    LIST = "list",
    CUSTOM = "custom",
}

export const enum StartAt {
    Init = "Init",
    DOMContentLoaded = "DOMContentLoaded",
}

export type PluginTag = "core" | "timeline" | "replies" | "filters" | "messages" | "ai" | "moderation" | "appearance" | "declutter" | "privacy" | "developer";

interface SettingCommon {
    description: string;
    label?: string;
    hidden?: boolean;
    placeholder?: string;
    restartNeeded?: boolean;
    disabled?(): boolean;
    onChange?(value: unknown): void;
}

export interface StringSetting extends SettingCommon { type: OptionType.STRING; default?: string; multiline?: boolean; secret?: boolean; isValid?(v: string): true | string }
export interface NumberSetting extends SettingCommon { type: OptionType.NUMBER; default?: number; min?: number; max?: number; step?: number }
export interface BooleanSetting extends SettingCommon { type: OptionType.BOOLEAN; default?: boolean }
export interface SelectSetting<V extends string | number = string | number> extends SettingCommon { type: OptionType.SELECT; options: readonly { label: string; value: V; default?: boolean }[] }
export interface SliderSetting extends SettingCommon { type: OptionType.SLIDER; min: number; max: number; step?: number; default: number; unit?: string }
export interface ListSetting extends SettingCommon { type: OptionType.LIST; default?: string[]; itemPlaceholder?: string; isValid?(v: string): true | string }
export interface CustomSetting<T = unknown> extends SettingCommon {
    type: OptionType.CUSTOM;
    default?: T;
    render(ctx: { get(): T; set(value: T): void; pluginName: string }): HTMLElement;
}

export type SettingDef = StringSetting | NumberSetting | BooleanSetting | SelectSetting | SliderSetting | ListSetting | CustomSetting<any>;
export type SettingsDefinition = Record<string, SettingDef>;

type ValueOf<D extends SettingDef> =
    D extends StringSetting ? string
    : D extends NumberSetting | SliderSetting ? number
    : D extends BooleanSetting ? boolean
    : D extends SelectSetting<infer V> ? V
    : D extends ListSetting ? string[]
    : D extends CustomSetting<infer T> ? T
    : never;

export type SettingsValues<D extends SettingsDefinition> = { [K in keyof D]: ValueOf<D[K]> } & { enabled?: boolean };

export interface DefinedSettings<D extends SettingsDefinition = SettingsDefinition, P extends object = {}> {
    readonly def: D;
    readonly store: SettingsValues<D> & P;
    readonly plain: SettingsValues<D> & P;
    pluginName: string;
    subscribe(listener: (path: string) => void): () => void;
    withPrivateSettings<T extends object>(): DefinedSettings<D, T>;
}

export interface PluginHooks {}

/** A selector a plugin depends on; SelectorHealth reports it when X stops rendering it. */
export interface HealthCheck {
    id: string;
    /** What the user would call it, e.g. 「帖子上的 Grok 按钮」. */
    label: string;
    selector: string;
    /** Only checked while this holds (e.g. on a post page that already shows a post). */
    when?(): boolean;
}

export interface XCleanerEventMap {
    pluginToggle: { name: string; enabled: boolean };
    settingsOpen: void;
    navigate: { url: string; previous: string };
    reloadNeeded: { name: string };
    healthChange: void;
}

export interface PluginDef extends Partial<PluginHooks> {
    name: string;
    description: string;
    authors?: string[];
    icon?: string;
    tags?: PluginTag[];
    enabledByDefault?: boolean;
    required?: boolean;
    hidden?: boolean;
    dev?: boolean;
    startAt?: StartAt;
    dependencies?: string[];
    /** Names this plugin had before; their settings, stars and pins carry over on first run. */
    oldNames?: string[];
    healthChecks?: HealthCheck[];
    /** Enabling or disabling only fully applies after a page reload. */
    requiresRestart?: boolean;
    settings?: DefinedSettings<any, any>;
    managedStyle?: string;
    cleanupSelectors?: string[];
    events?: { [K in keyof XCleanerEventMap]?: (data: XCleanerEventMap[K]) => void };
    start?(): void;
    stop?(): void;
    onSettingsChange?(path: string): void;
}

export interface Plugin extends PluginDef {
    started: boolean;
    isDependency?: boolean;
    /** Why the last start attempt failed; cleared on a successful start. */
    startError?: string;
    /** Labels of health checks that currently fail, kept up to date by SelectorHealth. */
    healthWarnings?: string[];
}

export default function definePlugin<P extends PluginDef>(p: P & Record<string, any>): P & Plugin {
    return Object.assign(p, { started: false });
}
