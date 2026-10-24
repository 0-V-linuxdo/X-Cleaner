/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { h } from "@ui/h";
import { Icons } from "@ui/icons";
import { registerStyle, unregisterStyle } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";

import { renderEditor, renderPinEditor } from "./editor";
import { buildCss, type Layout, mergeOrder, NAV, readEntries, type SidebarEntry } from "./entries";
import { activatePin, isMoreMenu, MENU_SEL, type MoreItem, readMoreMenu, syncPins, withHiddenMoreMenu } from "./pins";
import css from "./styles.css";
import { CHECKS } from "@x/health";

const STYLE = "sidebarEntries:layout";

export const settings = definePluginSettings({
    layout: {
        type: OptionType.CUSTOM,
        label: "侧栏入口",
        description: "拖动或用箭头调整顺序，开关控制是否显示。没出现在当前页面的入口会保留你的设置。",
        default: { order: [], hidden: [] } as Layout,
        render: ctx => {
            const editor = renderEditor(ctx, entriesForEditor);
            const pins = renderPinEditor({
                items: () => settings.plain.moreItems ?? [],
                pinned: pinnedKeys,
                setPinned(keys) {
                    settings.store.pinned = keys;
                    const nav = document.querySelector(NAV);
                    if (nav) record(nav);
                    editor.refresh();
                },
                rescan: scanMoreMenu,
            });
            return h("div", { class: "xc-sbe-wrap" }, editor.el, pins);
        },
    },
}).withPrivateSettings<{ known?: SidebarEntry[]; moreItems?: MoreItem[]; pinned?: string[] }>();

const known = (): SidebarEntry[] => settings.plain.known ?? [];
const pinnedKeys = (): string[] => Array.isArray(settings.plain.pinned) ? settings.plain.pinned : [];

/** The 「更多」 rows to show in the sidebar, in the order they were pinned. */
function pinnedItems(): MoreItem[] {
    const byKey = new Map((settings.plain.moreItems ?? []).map(i => [i.key, i]));
    return pinnedKeys().map(k => byKey.get(k)).filter((i): i is MoreItem => !!i);
}

/** Remembers the rows of X's 「更多」 menu, keeping rows X no longer shows so pins survive A/B tests. */
function recordMoreItems(live: MoreItem[]) {
    const plain = settings.plain;
    if (!live.length || !plain) return;
    const prev = plain.moreItems ?? [];
    const byKey = new Map(prev.map(i => [i.key, i]));
    for (const i of live) byKey.set(i.key, i);
    const next = mergeOrder(live.map(i => i.key), prev.map(i => i.key)).map(k => byKey.get(k)!);
    if (JSON.stringify(next) === JSON.stringify(prev)) return;
    settings.store.moreItems = next;
}

async function scanMoreMenu(): Promise<boolean> {
    return withHiddenMoreMenu(menu => {
        recordMoreItems(readMoreMenu(menu));
        return false;
    });
}

const onPinActivate = (item: MoreItem) => void activatePin(item);

function syncNav() {
    const nav = document.querySelector(NAV);
    if (nav) syncPins(nav, pinnedItems(), onPinActivate);
}

function layout(): Layout {
    const l = settings.plain.layout as Partial<Layout> | undefined;
    return { order: Array.isArray(l?.order) ? l.order : [], hidden: Array.isArray(l?.hidden) ? l.hidden : [] };
}

function apply() {
    syncNav();
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
    const pinned = new Set(pinnedKeys().map(k => `pin:${k}`));
    return known().filter(e => !e.key.startsWith("pin:") || pinned.has(e.key));
}

export default definePlugin({
    name: "SidebarEntries",
    description: "管理 X 左侧栏的入口：选择显示哪些、按什么顺序排列，还能把「更多」菜单里的项目固定到侧栏。",
    icon: Icons.list,
    tags: ["appearance", "declutter"],
    enabledByDefault: true,
    settings,
    managedStyle: css,
    healthChecks: [CHECKS.sideNav],

    elements: {
        [NAV](nav) {
            const update = () => {
                syncPins(nav, pinnedItems(), onPinActivate);
                record(nav);
            };
            update();
            // X redraws its links when the sidebar switches between wide and icon-only; pins follow.
            const observer = new MutationObserver(update);
            observer.observe(nav, { childList: true, subtree: true });
            return () => observer.disconnect();
        },
        [MENU_SEL](menu) {
            const read = () => { if (isMoreMenu(menu)) recordMoreItems(readMoreMenu(menu)); };
            read();
            const observer = new MutationObserver(read);
            observer.observe(menu, { childList: true, subtree: true });
            return () => observer.disconnect();
        },
    },

    start: apply,
    stop() {
        unregisterStyle(STYLE);
        const nav = document.querySelector(NAV);
        if (nav) syncPins(nav, [], onPinActivate);
    },
    onSettingsChange: apply,
});
