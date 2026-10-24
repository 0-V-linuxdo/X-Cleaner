/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Hides the three cards under the search box in X's right sidebar. Each card's wrapper is matched
// by what it holds (trend rows, user cells, the footer nav), since X gives the wrappers no testid.

import { definePluginSettings } from "@api/Settings";
import { Icons } from "@ui/icons";
import { registerStyle, unregisterStyle } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";

const STYLE = "sidebarWidgets:rules";
const SIDE = '[data-testid="sidebarColumn"]';

const opt = (label: string, description: string) => ({ type: OptionType.BOOLEAN as const, label, description, default: true });

export const settings = definePluginSettings({
    hideTrends: opt("有什么新鲜事", "「What's happening」趋势卡片。"),
    hideWhoToFollow: opt("推荐关注", "「Who to follow」卡片，帖子页的「相关用户」也算。"),
    hideFooter: opt("页脚链接", "服务条款、隐私政策、Cookie、© X Corp. 那一排链接。"),
});

type Key = keyof typeof settings.def;

// Checked on x.com: each card sits in its own div right under the sidebar's content column.
export const RULES: Record<Key, string> = {
    hideTrends: `${SIDE} div:has(> section [data-testid="trend"])`,
    hideWhoToFollow: `${SIDE} div:has(> div > aside [data-testid="UserCell"])`,
    hideFooter: `${SIDE} div:has(> nav[role="navigation"])`,
};

// A 2px bordered divider sits between the search box's spacer and the first card; with a card gone
// it is left floating under the search box. It is the last empty div before the cards.
export const DIVIDER = `${SIDE} div:has(> div > nav[role="navigation"]) > div:empty:has(+ div:not(:empty))`;

export function buildCss(values: Partial<Record<Key, boolean>>): string {
    const hidden = (Object.keys(RULES) as Key[]).filter(k => values[k]).map(k => RULES[k]);
    if (!hidden.length) return "";
    return [...hidden, DIVIDER].map(sel => `${sel} { display: none !important; }`).join("\n");
}

function apply() {
    const css = buildCss(settings.store as Partial<Record<Key, boolean>>);
    if (css) registerStyle(STYLE, css);
    else unregisterStyle(STYLE);
}

export default definePlugin({
    name: "SidebarWidgets",
    description: "隐藏右侧栏三大件：「有什么新鲜事」趋势、「推荐关注」和底部页脚链接，可分别开关。",
    icon: Icons.eyeOff,
    tags: ["appearance", "declutter"],
    enabledByDefault: true,
    settings,
    start: apply,
    stop() { unregisterStyle(STYLE); },
    onSettingsChange: apply,
});
