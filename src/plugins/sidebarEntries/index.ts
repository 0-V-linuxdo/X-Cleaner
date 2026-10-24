/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Icons } from "@ui/icons";
import { registerStyle, unregisterStyle } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";

import { renderEditor } from "./editor";
import { buildCss, type Layout, mergeOrder, NAV, readEntries, type SidebarEntry } from "./entries";
import css from "./styles.css";
import { CHECKS } from "@x/health";

const STYLE = "sidebarEntries:layout";

export const settings = definePluginSettings({
    layout: {
        type: OptionType.CUSTOM,
        label: "侧栏入口",
        description: "拖动或用箭头调整顺序，开关控制是否显示。没出现在当前页面的入口会保留你的设置。",
        default: { order: [], hidden: [] } as Layout,
        render: ctx => renderEditor(ctx, entriesForEditor),
    },
}).withPrivateSettings<{ known?: SidebarEntry[] }>();

const known = (): SidebarEntry[] => settings.plain.known ?? [];

function layout(): Layout {
    const l = settings.plain.layout as Partial<Layout> | undefined;
    return { order: Array.isArray(l?.order) ? l.order : [], hidden: Array.isArray(l?.hidden) ? l.hidden : [] };
}

function apply() {
    const text = buildCss(known(), layout());
    if (text) registerStyle(STYLE, text);
    else unregisterStyle(STYLE);
}

/** Remembers every entry X has shown, in X's own order, so the editor can list them and the CSS can target them. */
function record(nav: Element) {
    const live = readEntries(nav);
    if (!live.length) return;
    const prev = known();
    const byKey = new Map(prev.map(e => [e.key, e]));
    for (const e of live) byKey.set(e.key, e);
    const next = mergeOrder(live.map(e => e.key), prev.map(e => e.key)).map(k => byKey.get(k)!);
    const same = next.length === prev.length && next.every((e, i) => e.key === prev[i].key && e.label === prev[i].label && e.selector === prev[i].selector);
    if (same) return;
    settings.store.known = next;
}

function entriesForEditor(): SidebarEntry[] {
    const nav = document.querySelector(NAV);
    if (nav) record(nav);
    return known();
}

export default definePlugin({
    name: "SidebarEntries",
    description: "管理 X 左侧栏的入口：选择显示哪些、按什么顺序排列。",
    icon: Icons.list,
    tags: ["appearance", "declutter"],
    enabledByDefault: true,
    settings,
    managedStyle: css,
    healthChecks: [CHECKS.sideNav],

    elements: {
        [NAV](nav) {
            record(nav);
            const observer = new MutationObserver(() => record(nav));
            observer.observe(nav, { childList: true });
            return () => observer.disconnect();
        },
    },

    start: apply,
    stop() { unregisterStyle(STYLE); },
    onSettingsChange: apply,
});
