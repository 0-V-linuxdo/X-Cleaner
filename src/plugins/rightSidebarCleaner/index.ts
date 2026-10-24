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
import { N_ } from "@utils/i18n";
import definePlugin, { OptionType } from "@utils/types";

const STYLE = "rightSidebarCleaner:rules";
const SIDE = '[data-testid="sidebarColumn"]';

const opt = (label: string, description: string) => ({ type: OptionType.BOOLEAN as const, label, description, default: true });

export const settings = definePluginSettings({
    hideTrends: opt(N_("有什么新鲜事"), N_("「What's happening」趋势卡片。")),
    hideWhoToFollow: opt(N_("推荐关注"), N_("「Who to follow」卡片，帖子页的「相关用户」也算。")),
    hideFooter: opt(N_("页脚链接"), N_("服务条款、隐私政策、Cookie、© X Corp. 那一排链接。")),
});

type Key = keyof typeof settings.def;

// Checked on x.com: each card sits in its own div right under the sidebar's content column.
export const RULES: Record<Key, string> = {
    hideTrends: `${SIDE} div:has(> section [data-testid="trend"])`,
    hideWhoToFollow: `${SIDE} div:has(> div > aside [data-testid="UserCell"])`,
    hideFooter: `${SIDE} div:has(> nav[role="navigation"])`,
};

// X keeps empty bordered card boxes between the cards; with the cards gone they are left as a 2px
// line (under the search box on Home, at the top on Explore). Every empty child of the card column
// is one of them, except the spacer X puts right after the sticky search box.
export const DIVIDER = `${SIDE} div:has(> div > nav[role="navigation"]) > div:empty:not(div:has(form[role="search"]) + div)`;

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
    name: "RightSidebarCleaner",
    oldNames: ["SidebarWidgets"],
    description: N_("隐藏右侧栏三大件：「有什么新鲜事」趋势、「推荐关注」和底部页脚链接，可分别开关。"),
    icon: Icons.eyeOff,
    tags: ["appearance", "declutter"],
    enabledByDefault: true,
    settings,
    start: apply,
    stop() { unregisterStyle(STYLE); },
    onSettingsChange: apply,
});
