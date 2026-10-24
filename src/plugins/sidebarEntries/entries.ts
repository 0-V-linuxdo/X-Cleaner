/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { N_, t } from "@utils/i18n";

/** X's left sidebar; its entries are the direct children of this flex column. */
export const NAV = 'header[role="banner"] nav[role="navigation"]';

/** Marks the copies of 「更多」 menu rows pinned into the sidebar; the value is the row's key. */
export const PIN_ATTR = "data-xc-pin";

export interface SidebarEntry {
    key: string;
    selector: string;
    label: string;
}

export interface Layout {
    order: string[];
    hidden: string[];
}

const LABELS: Record<string, string> = {
    "tid:AppTabBar_Home_Link": N_("主页"),
    "tid:AppTabBar_Explore_Link": N_("探索"),
    "tid:AppTabBar_Notifications_Link": N_("通知"),
    "tid:AppTabBar_Follow_Link": N_("关注"),
    "tid:AppTabBar_DirectMessage_Link": N_("私信"),
    "tid:AppTabBar_Calls_Link": N_("通话"),
    "href:/i/grok": "Grok",
    "href:/i/bookmarks": N_("书签"),
    "href:/~/lists": N_("列表"),
    "href:/~/communities": N_("社群"),
    "href:/i/history": N_("历史记录"),
    "href:/jobs": N_("工作"),
    "tid:premium-hub-tab": N_("订阅"),
    "tid:AppTabBar_Profile_Link": N_("个人资料"),
    "tid:AppTabBar_More_Menu": N_("更多"),
};

/** Entries whose hiding removes access to something X has no other sidebar route to. */
export const HIDE_HINTS: Record<string, string> = {
    "tid:AppTabBar_More_Menu": N_("隐藏后侧栏里就没有 X 的「设置和隐私」入口了。"),
};

const quote = (v: string) => JSON.stringify(v);

/** Stable identity for one sidebar child: its data-testid, else its link path (per-user paths use `~`). */
export function describeEntry(el: Element): SidebarEntry | null {
    const tid = el.getAttribute("data-testid");
    const pin = el.getAttribute(PIN_ATTR);
    let key: string;
    let selector: string;
    if (pin) {
        key = `pin:${pin}`;
        selector = `[${PIN_ATTR}=${quote(pin)}]`;
    } else if (tid) {
        key = `tid:${tid}`;
        selector = `[data-testid=${quote(tid)}]`;
    } else {
        const href = el.getAttribute("href");
        if (!href || !href.startsWith("/")) return null;
        const path = href.split(/[?#]/)[0];
        const own = path.match(/^\/[^/]+\/(lists|communities|articles|creator-studio)$/);
        if (own && !path.startsWith("/i/")) {
            key = `href:/~/${own[1]}`;
            selector = `[href$=${quote(`/${own[1]}`)}]`;
        } else {
            key = `href:${path}`;
            selector = `[href=${quote(path)}]`;
        }
    }
    const text = (el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.textContent || "").trim().split("\n")[0];
    const label = LABELS[key] ? t(LABELS[key]) : text || key.replace(/^\w+:/, "");
    return { key, selector, label: pin ? t("{label}（来自「更多」）", { label }) : label };
}

export function readEntries(nav: Element): SidebarEntry[] {
    const seen = new Set<string>();
    const out: SidebarEntry[] = [];
    for (const child of nav.children) {
        const entry = describeEntry(child);
        if (!entry || seen.has(entry.key)) continue;
        seen.add(entry.key);
        out.push(entry);
    }
    return out;
}

/**
 * The user's order with entries they have never placed slotted in after their
 * nearest preceding neighbour in X's own order, so new X entries stay where X put them.
 */
export function mergeOrder(user: string[], natural: string[]): string[] {
    const out = user.filter((k, i) => user.indexOf(k) === i);
    for (let i = 0; i < natural.length; i++) {
        const key = natural[i];
        if (out.includes(key)) continue;
        let at = 0;
        for (let j = i - 1; j >= 0; j--) {
            const idx = out.indexOf(natural[j]);
            if (idx >= 0) { at = idx + 1; break; }
        }
        out.splice(at, 0, key);
    }
    return out;
}

export function buildCss(entries: SidebarEntry[], layout: Layout): string {
    const natural = entries.map(e => e.key);
    const bySelector = new Map(entries.map(e => [e.key, e.selector]));
    const rules: string[] = [];
    const order = mergeOrder(layout.order, natural).filter(k => bySelector.has(k));
    if (layout.order.length && order.some((k, i) => k !== natural[i])) {
        order.forEach((k, i) => rules.push(`${NAV} > ${bySelector.get(k)}{order:${i} !important}`));
    }
    for (const k of layout.hidden) {
        const sel = bySelector.get(k);
        if (sel) rules.push(`${NAV} > ${sel}{display:none !important}`);
    }
    return rules.join("\n");
}
