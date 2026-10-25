/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings, Settings } from "@api/Settings";
import { cleanerEntries } from "@plugins/moreMenuEntry";
import { h } from "@ui/h";
import { Icons } from "@ui/icons";
import { registerStyle, unregisterStyle } from "@utils/css";
import { N_ } from "@utils/i18n";
import definePlugin, { OptionType } from "@utils/types";

import { renderEditor, renderPinEditor } from "./editor";
import { buildCss, type Layout, mergeOrder, NAV, readEntries, type SidebarEntry } from "./entries";
import { activatePin, isMoreMenu, markHiddenRows, MENU_HIDDEN_ATTR, MENU_SEL, type MoreItem, readMoreMenu, syncPins, withHiddenMoreMenu } from "./pins";
import { type InlineRow, refreshInline, startInline, stopInline, syncInline } from "./inline";
import css from "./styles.css";
import { CHECKS } from "@x/health";

const STYLE = "sidebarEntries:layout";

export const settings = definePluginSettings({
    inlineMore: {
        type: OptionType.BOOLEAN,
        label: N_("「更多」在侧栏里展开"),
        description: N_("点侧栏的「更多」时，把它的项目直接展开在按钮下方，不再弹出菜单。侧栏收起成图标时也一样。"),
        default: true,
    },
    sidebarScrollbarLeft: {
        type: OptionType.BOOLEAN,
        label: N_("侧栏滚动条放在左边"),
        description: N_("「更多」展开后侧栏需要滚动时，把滚动条放在侧栏左边；关闭则留在右边。两边都没有轨道，只在鼠标移到侧栏上时显示。"),
        default: true,
    },
    layout: {
        type: OptionType.CUSTOM,
        label: N_("侧栏入口"),
        description: N_("拖动或用箭头调整顺序，开关控制是否显示。没出现在当前页面的入口会保留你的设置。"),
        default: { order: [], hidden: [] } as Layout,
        render: ctx => {
            const editor = renderEditor(ctx, entriesForEditor);
            const pins = renderPinEditor({
                items: () => settings.plain.moreItems ?? [],
                pinned: pinnedKeys,
                hidden: menuHiddenKeys,
                setHidden(keys) { settings.store.menuHidden = keys; },
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
}).withPrivateSettings<{ known?: SidebarEntry[]; moreItems?: MoreItem[]; pinned?: string[]; menuHidden?: string[]; inlineOpen?: boolean }>();

const known = (): SidebarEntry[] => settings.plain.known ?? [];
const pinnedKeys = (): string[] => Array.isArray(settings.plain.pinned) ? settings.plain.pinned : [];
const menuHiddenKeys = (): string[] => Array.isArray(settings.plain?.menuHidden) ? settings.plain.menuHidden : [];

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

let scannedThisPage = false;

const inlineSource = {
    enabled: () => !!settings.plain && settings.store.inlineMore,
    isOpen: () => !!settings.plain?.inlineOpen,
    scrollbarLeft: () => !!settings.plain && settings.store.sidebarScrollbarLeft,
    setOpen(open: boolean) { settings.store.inlineOpen = open; },
    groups(): InlineRow[][] {
        const hidden = new Set(menuHiddenKeys());
        const xRows = (settings.plain.moreItems ?? []).filter(i => !hidden.has(i.key)).map(i => ({ ...i, run: () => void activatePin(i) }));
        const ours = isPluginEnabled("MoreMenuEntry") && Settings.plugins.MoreMenuEntry
            ? cleanerEntries().map(e => ({ key: `xc:${e.id}`, label: e.label, icon: e.icon, run: e.run }))
            : [];
        return [xRows, ours];
    },
    /** Reads X's menu once per page so new or renamed rows show up; the first unfold uses what was stored. */
    onOpen() {
        if (scannedThisPage) return;
        scannedThisPage = true;
        const before = JSON.stringify(settings.plain.moreItems ?? []);
        void scanMoreMenu().then(() => {
            if (JSON.stringify(settings.plain.moreItems ?? []) !== before) refreshInline();
        });
    },
};

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
    refreshInline();
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
    description: N_("管理 X 左侧栏的入口：选择显示哪些、按什么顺序排列，还能把「更多」菜单里的项目固定到侧栏或从菜单里隐藏。"),
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
                syncInline(nav);
                record(nav);
            };
            update();
            // X redraws its links when the sidebar switches between wide and icon-only; pins follow.
            const observer = new MutationObserver(update);
            observer.observe(nav, { childList: true, subtree: true });
            return () => observer.disconnect();
        },
        [MENU_SEL](menu) {
            const read = () => {
                if (!isMoreMenu(menu)) return;
                recordMoreItems(readMoreMenu(menu));
                markHiddenRows(menu, new Set(menuHiddenKeys()));
            };
            read();
            const observer = new MutationObserver(read);
            observer.observe(menu, { childList: true, subtree: true });
            return () => observer.disconnect();
        },
    },

    start() {
        startInline(inlineSource);
        apply();
    },
    stop() {
        stopInline();
        unregisterStyle(STYLE);
        const nav = document.querySelector(NAV);
        if (nav) syncPins(nav, [], onPinActivate);
        for (const row of document.querySelectorAll(`[${MENU_HIDDEN_ATTR}]`)) row.removeAttribute(MENU_HIDDEN_ATTR);
    },
    onSettingsChange: apply,
});
