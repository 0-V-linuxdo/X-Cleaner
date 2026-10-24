/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Void++ StreamerMode / NoSidebarIdentity for X: blur your own identity so screenshots and screen
// shares don't give your account away. Pure CSS keyed on X's own test ids and your handle.

import { definePluginSettings } from "@api/Settings";
import { Icons } from "@ui/icons";
import { registerStyle, unregisterStyle } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { detectSelfHandle, SEL } from "@x/dom";
import { CHECKS } from "@x/health";

const STYLE = "streamerMode:rules";

export const settings = definePluginSettings({
    accountAvatar: { type: OptionType.BOOLEAN, label: "账号菜单头像", description: "左下角账号菜单里的头像。", default: true },
    accountName: { type: OptionType.BOOLEAN, label: "账号菜单名字", description: "左下角账号菜单里的昵称和 @handle。", default: true },
    ownAvatars: { type: OptionType.BOOLEAN, label: "自己的头像", description: "页面其他位置（发帖框、自己的帖子）出现的你的头像。", default: true },
    dmNames: { type: OptionType.BOOLEAN, label: "私信列表", description: "私信页里对话的头像和名字。", default: false },
    revealOnHover: { type: OptionType.BOOLEAN, label: "悬停时显示", description: "鼠标移上去时暂时取消模糊。", default: true },
    blur: { type: OptionType.SLIDER, label: "模糊程度", description: "", min: 2, max: 16, step: 1, default: 8, unit: "px" },
});

const escapeAttr = (v: string) => v.replace(/["\\]/g, "\\$&");

export function buildCss(opts: { accountAvatar?: boolean; accountName?: boolean; ownAvatars?: boolean; dmNames?: boolean; revealOnHover?: boolean; blur?: number }, self: string): string {
    const targets: string[] = [];
    if (opts.accountAvatar) targets.push(`${SEL.accountSwitcher} [data-testid^="UserAvatar-Container-"]`);
    // Outermost [dir] only: nested blurs would stack.
    if (opts.accountName) targets.push(`${SEL.accountSwitcher} [dir]:not(${SEL.accountSwitcher} [dir] [dir])`);
    if (opts.ownAvatars && self) targets.push(`[data-testid="UserAvatar-Container-${escapeAttr(self)}" i]`);
    if (opts.dmNames) targets.push('[data-testid="conversation"] [data-testid^="UserAvatar-Container-"]', '[data-testid="conversation"] [dir]:not([data-testid="conversation"] [dir] [dir])');
    if (!targets.length) return "";
    const list = targets.join(",\n");
    let css = `${list} { filter: blur(${opts.blur ?? 8}px) !important; transition: filter .15s ease; }`;
    if (opts.revealOnHover) css += `\n${targets.map(t => `${t}:hover`).join(",\n")} { filter: none !important; }`;
    return css;
}

let self = "";
let retry: ReturnType<typeof setInterval> | undefined;

function apply() {
    self = self || detectSelfHandle();
    const css = buildCss(settings.store, self);
    if (css) registerStyle(STYLE, css);
    else unregisterStyle(STYLE);
}

export default definePlugin({
    name: "StreamerMode",
    description: "主播模式：模糊你自己的头像、昵称和 @handle，可选模糊私信列表，截图和录屏时不暴露账号。",
    icon: Icons.eyeOff,
    tags: ["privacy"],
    settings,

    healthChecks: [CHECKS.accountSwitcher],
    start() {
        apply();
        // The handle is only known once X renders the sidebar; keep trying briefly so own avatars get covered.
        let tries = 0;
        retry = setInterval(() => {
            if (self || ++tries > 30) { clearInterval(retry); return; }
            if (detectSelfHandle()) apply();
        }, 1000);
    },
    stop() {
        clearInterval(retry);
        unregisterStyle(STYLE);
    },
    onSettingsChange: apply,
});
