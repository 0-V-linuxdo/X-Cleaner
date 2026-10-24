/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Void++ WiderChat for X: lets the 600px main column grow on wide screens. X fixes the width on
// the column and on the 990px row around it, so both are overridden.

import { definePluginSettings } from "@api/Settings";
import { Icons } from "@ui/icons";
import { registerStyle, unregisterStyle } from "@utils/css";
import { N_, t } from "@utils/i18n";
import definePlugin, { OptionType } from "@utils/types";
import { SEL } from "@x/dom";

const STYLE = "widerTimeline:rules";
/** Sidebar column (350px) plus the gutter X keeps between the two columns. */
const SIDEBAR_SPACE = 390;

export const settings = definePluginSettings({
    width: { type: OptionType.SLIDER, label: N_("主栏宽度"), description: N_("X 默认是 600px。屏幕不够宽时会自动收窄。"), min: 600, max: 1200, step: 20, default: 800, unit: "px" },
    hideSidebar: { type: OptionType.BOOLEAN, label: N_("隐藏右侧栏"), description: N_("去掉搜索、趋势所在的右侧栏，把空间都给主栏。"), default: false },
});

export function buildCss(width: number, hideSidebar: boolean): string {
    const row = hideSidebar ? width : width + SIDEBAR_SPACE;
    // Checked on x.com: main may shrink, the row takes the requested width but never more than main,
    // and the column grows into it up to the chosen width while the sidebar keeps its 350px.
    return [
        `main[role="main"] { min-width: 0 !important; }`,
        `main[role="main"] > div { width: ${row}px !important; max-width: 100% !important; }`,
        `main[role="main"] > div > div, main[role="main"] > div > div > div { width: 100% !important; max-width: none !important; }`,
        `${SEL.primaryColumn} { width: auto !important; max-width: ${width}px !important; flex-shrink: 1 !important; min-width: 0 !important; }`,
        hideSidebar ? `[data-testid="sidebarColumn"] { display: none !important; }` : "",
    ].filter(Boolean).join("\n");
}

function apply() {
    registerStyle(STYLE, buildCss(settings.store.width, settings.store.hideSidebar));
}

export default definePlugin({
    name: "WiderTimeline",
    description: N_("加宽主栏：大屏幕上把 600px 的时间线和帖子页加宽，宽度可调，可选隐藏右侧栏。"),
    icon: Icons.widen,
    tags: ["appearance"],
    settings,
    start: apply,
    stop() { unregisterStyle(STYLE); },
    onSettingsChange: apply,
});
