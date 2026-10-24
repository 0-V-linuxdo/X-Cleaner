/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Hides X's two always-visible ways to start a post: the "What's happening?" box on top of the Home
// timeline and the Post button in the left sidebar. Replying, quoting and the "n" shortcut still work.

import { definePluginSettings } from "@api/Settings";
import { Icons } from "@ui/icons";
import { registerStyle, unregisterStyle } from "@utils/css";
import { N_ } from "@utils/i18n";
import definePlugin, { OptionType } from "@utils/types";

const STYLE = "hidePostEntries:rules";

const opt = (label: string, description: string) => ({ type: OptionType.BOOLEAN as const, label, description, default: true });

export const settings = definePluginSettings({
    hideHomeComposer: opt(N_("首页发帖框"), N_("主页时间线顶部的「有什么新鲜事？」发帖框。帖子页的回复框不受影响。")),
    hideSideNavButton: opt(N_("侧栏发帖按钮"), N_("左侧栏的「发帖」按钮，侧栏收起时的图标按钮也算。")),
});

type Key = keyof typeof settings.def;

// Checked on x.com: the Home composer is a direct child of the timeline column, next to the tab bar
// and the post list; the reply box on a post page sits inside the conversation's cells instead, so
// a wrapper holding cells is never the composer.
// The sidebar button keeps its testid when the sidebar collapses to icons; its wrapper carries the
// vertical margin, so the wrapper goes too.
export const RULES: Record<Key, string> = {
    hideHomeComposer: '[data-testid="primaryColumn"] > div > div:has([data-testid="tweetTextarea_0"]):not(:has([data-testid="cellInnerDiv"]))',
    hideSideNavButton: 'header div:has(> [data-testid="SideNav_NewTweet_Button"])',
};

export function buildCss(values: Partial<Record<Key, boolean>>): string {
    return (Object.keys(RULES) as Key[])
        .filter(k => values[k])
        .map(k => `${RULES[k]} { display: none !important; }`)
        .join("\n");
}

function apply() {
    const css = buildCss(settings.store as Partial<Record<Key, boolean>>);
    if (css) registerStyle(STYLE, css);
    else unregisterStyle(STYLE);
}

export default definePlugin({
    name: "HidePostEntries",
    description: N_("隐藏发帖入口：主页时间线顶部的发帖框和左侧栏的「发帖」按钮，可分别开关。回复、引用和快捷键 N 不受影响。"),
    icon: Icons.eyeOff,
    tags: ["appearance", "declutter"],
    enabledByDefault: true,
    settings,
    start: apply,
    stop() { unregisterStyle(STYLE); },
    onSettingsChange: apply,
});
