/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Void++ SettingsFlyout / PluginsFlyout for X: an 「X Cleaner」 entry in X's own 「更多」 menu that
// opens the plugin manager, followed by quick switches for the plugins you starred and shortcuts to
// X's own muted-word and block lists, which sit three levels deep in X's settings.

import { isPluginEnabled, plugins, setPluginEnabled } from "@api/PluginManager";
import { definePluginSettings, PlainSettings } from "@api/Settings";
import { closeMenu, cloneMenuRow, MENU_SEL } from "@plugins/_api/postMenu";
import { openPanel } from "@plugins/_core/settings";
import { Icons } from "@ui/icons";
import { showToast } from "@ui/toast";
import { N_, t } from "@utils/i18n";
import definePlugin, { OptionType } from "@utils/types";
import { CHECKS } from "@x/health";

const MORE_BUTTON = '[data-testid="AppTabBar_More_Menu"]';
export const ENTRY_ATTR = "data-xc-more-entry";
const WAIT_MS = 1500;

export const settings = definePluginSettings({
    showStarred: { type: OptionType.BOOLEAN, label: N_("显示收藏的插件"), description: N_("在入口下面列出你收藏的插件，点一下就能开关。"), default: true },
    xMutedWords: { type: OptionType.BOOLEAN, label: N_("快捷方式：隐藏词"), description: N_("打开 X 的「隐藏的字词」设置页。"), default: true },
    xBlocked: { type: OptionType.BOOLEAN, label: N_("快捷方式：已屏蔽账号"), description: N_("打开 X 的「已屏蔽的账号」列表。"), default: true },
    xMuted: { type: OptionType.BOOLEAN, label: N_("快捷方式：已隐藏账号"), description: N_("打开 X 的「已隐藏的账号」列表。"), default: true },
});

/** X's own settings pages that pair with X Cleaner's filters. Only navigates; never changes them. */
export const X_SHORTCUTS = [
    { key: "xMutedWords", path: "/settings/muted_keywords", label: N_("X 隐藏词"), icon: Icons.filter },
    { key: "xBlocked", path: "/settings/blocked/all", label: N_("X 已屏蔽账号"), icon: Icons.ban },
    { key: "xMuted", path: "/settings/muted/all", label: N_("X 已隐藏账号"), icon: Icons.eyeOff },
] as const;

/** Client-side navigation through X's own router, like clicking one of its links. */
export function goTo(path: string) {
    if (location.pathname === path) return;
    history.pushState({}, "", path);
    dispatchEvent(new PopStateEvent("popstate"));
}

/** The last row of X's 「更多」 menu (「设置和隐私」), whose wrapper we copy. */
function templateRow(menu: Element): HTMLElement | null {
    const link = menu.querySelector<HTMLElement>('[data-testid="Dropdown"] a[href="/settings"]') ?? [...menu.querySelectorAll<HTMLElement>('[data-testid="Dropdown"] a[role="link"]')].at(-1);
    if (!link) return null;
    return link.parentElement?.childElementCount === 1 ? link.parentElement : link;
}

export function starredPlugins(): string[] {
    return PlainSettings.core.starredPlugins.filter(n => plugins[n] && !plugins[n].required && !plugins[n].hidden);
}

export function fillMoreMenu(menu: Element): HTMLElement[] {
    if (menu.querySelector(`[${ENTRY_ATTR}]`)) return [];
    const tpl = templateRow(menu);
    const host = tpl?.parentElement;
    if (!tpl || !host) return [];
    const rows: HTMLElement[] = [];
    const add = (id: string, label: string, icon: string, run: () => void) => {
        const row = cloneMenuRow(tpl, label, icon);
        for (const a of row.querySelectorAll('[role="link"]')) a.removeAttribute("role");
        row.setAttribute(ENTRY_ATTR, id);
        row.style.cursor = "pointer";
        const activate = (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            closeMenu(menu);
            run();
        };
        row.addEventListener("click", activate);
        row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") activate(e); });
        host.appendChild(row);
        rows.push(row);
    };
    add("manager", t("X Cleaner 插件管理"), Icons.broom, openPanel);
    if (settings.store.showStarred) {
        for (const name of starredPlugins()) {
            const on = isPluginEnabled(name);
            add(`plugin:${name}`, on ? t("停用 {name}", { name }) : t("启用 {name}", { name }), on ? Icons.check : Icons.plug, () => {
                if (setPluginEnabled(name, !on)) showToast(on ? t("{name} 已停用。", { name }) : t("{name} 已启用。", { name }), { type: "success" });
                else showToast(on ? t("{name} 停用失败，详见控制台。", { name }) : t("{name} 启用失败，详见控制台。", { name }), { type: "error" });
            });
        }
    }
    for (const sc of X_SHORTCUTS) {
        if (settings.store[sc.key]) add(`x:${sc.key}`, t(sc.label), sc.icon, () => goTo(sc.path));
    }
    return rows;
}

let pendingAt = 0;
let observer: MutationObserver | null = null;

function tryFill() {
    if (!pendingAt) return;
    if (Date.now() - pendingAt > WAIT_MS) { pendingAt = 0; return; }
    const menu = document.querySelector(MENU_SEL);
    if (!menu || !templateRow(menu)) return;
    pendingAt = 0;
    fillMoreMenu(menu);
}

function onClick(e: MouseEvent) {
    if (!(e.target as Element | null)?.closest?.(MORE_BUTTON)) return;
    pendingAt = Date.now();
    queueMicrotask(tryFill);
}

export default definePlugin({
    name: "MoreMenuEntry",
    description: N_("在 X 左侧栏的「更多」菜单里加一个「X Cleaner 插件管理」入口，并列出收藏的插件供快速开关，以及 X 隐藏词、已屏蔽和已隐藏账号的快捷方式。"),
    icon: Icons.menu,
    tags: ["core", "appearance"],
    enabledByDefault: true,
    settings,
    healthChecks: [CHECKS.moreMenuButton],

    start() {
        document.addEventListener("click", onClick, true);
        observer = new MutationObserver(() => { if (pendingAt) tryFill(); });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    },

    stop() {
        document.removeEventListener("click", onClick, true);
        observer?.disconnect();
        observer = null;
        pendingAt = 0;
        for (const el of document.querySelectorAll(`[${ENTRY_ATTR}]`)) el.remove();
    },
});
