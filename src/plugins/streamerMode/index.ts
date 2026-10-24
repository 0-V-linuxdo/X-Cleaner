/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Void++ StreamerMode / NoSidebarIdentity for X: blur your own identity so screenshots and screen
// shares don't give your account away. Pure CSS keyed on X's own test ids and your handle. A custom
// name or avatar is CustomSidebarIdentity's job; it is blurred here like the real one.

import { definePluginSettings } from "@api/Settings";
import { Icons } from "@ui/icons";
import { registerStyle, unregisterStyle } from "@utils/css";
import { N_, t } from "@utils/i18n";
import definePlugin, { OptionType } from "@utils/types";
import { detectSelfHandle, SEL } from "@x/dom";
import { CHECKS } from "@x/health";

const STYLE = "streamerMode:rules";

export const settings = definePluginSettings({
    accountAvatar: { type: OptionType.BOOLEAN, label: N_("账号菜单头像"), description: N_("左下角账号菜单里的头像。"), default: true },
    accountName: { type: OptionType.BOOLEAN, label: N_("账号菜单名字"), description: N_("左下角账号菜单里的昵称和 @handle。"), default: true },
    ownAvatars: { type: OptionType.BOOLEAN, label: N_("自己的头像"), description: N_("页面其他位置（发帖框、自己的帖子）出现的你的头像。"), default: true },
    settingsInfo: { type: OptionType.BOOLEAN, label: N_("设置页账号信息"), description: N_("「设置」里的用户名、邮箱、手机号和国家，包括「账号信息」页。"), default: true },
    dmNames: { type: OptionType.BOOLEAN, label: N_("私信列表"), description: N_("私信页里对话的头像和名字。"), default: false },
    revealOnHover: { type: OptionType.BOOLEAN, label: N_("悬停时显示"), description: N_("鼠标移上去时暂时取消模糊。"), default: true },
    blur: { type: OptionType.SLIDER, label: N_("模糊程度"), description: "", min: 2, max: 16, step: 1, default: 8, unit: "px" },
});

/** Rows of 「设置 → 账号信息」 that show a value under their label. */
export const INFO_ROWS = ["screen_name", "email", "phone", "country"].map(p => `main a[href="/settings/${p}"]`).join(", ");
export const VALUE_ATTR = "data-xc-streamer-value";
/** The edit boxes on those rows' own pages. */
const INFO_INPUTS = ['input[name="typedScreenName"]', 'input[name="current_email"]', 'input[type="tel"]'].map(s => `main ${s}`);

/** Marks every text line of an info row but the first (its label). */
export function markInfoRow(row: Element): Element[] {
    const lines = [...row.querySelectorAll("[dir]")].filter(d => !d.querySelector("[dir]"));
    const values = lines.slice(1);
    for (const v of values) v.setAttribute(VALUE_ATTR, "");
    return values;
}

const escapeAttr = (v: string) => v.replace(/["\\]/g, "\\$&");

export function buildCss(opts: { accountAvatar?: boolean; accountName?: boolean; ownAvatars?: boolean; settingsInfo?: boolean; dmNames?: boolean; revealOnHover?: boolean; blur?: number }, self: string): string {
    const targets: string[] = [];
    if (opts.accountAvatar) targets.push(`${SEL.accountSwitcher} [data-testid^="UserAvatar-Container-"]`);
    // Outermost [dir] only: nested blurs would stack.
    if (opts.accountName) targets.push(`${SEL.accountSwitcher} [dir]:not(${SEL.accountSwitcher} [dir] [dir])`);
    if (opts.ownAvatars && self) targets.push(`[data-testid="UserAvatar-Container-${escapeAttr(self)}" i]`);
    if (opts.settingsInfo) targets.push(`[${VALUE_ATTR}]`, ...INFO_INPUTS);
    if (opts.dmNames) targets.push('[data-testid="conversation"] [data-testid^="UserAvatar-Container-"]', '[data-testid="conversation"] [dir]:not([data-testid="conversation"] [dir] [dir])');
    const rules: string[] = [];
    if (targets.length) {
        rules.push(`${targets.join(",\n")} { filter: blur(${opts.blur ?? 8}px) !important; transition: filter .15s ease; }`);
        if (opts.revealOnHover) rules.push(`${targets.map(t => `${t}:hover`).join(",\n")} { filter: none !important; }`);
    }
    return rules.join("\n");
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
    description: N_("主播模式：模糊你自己的头像、昵称和 @handle、设置页里的邮箱和手机号，可选模糊私信列表，截图和录屏时不暴露账号。"),
    icon: Icons.eyeOff,
    tags: ["privacy"],
    settings,

    healthChecks: [CHECKS.accountSwitcher],
    elements: {
        // X fills a row's value in after the label, so re-mark while the row changes.
        [INFO_ROWS](row) {
            markInfoRow(row);
            const mo = new MutationObserver(() => markInfoRow(row));
            mo.observe(row, { childList: true, subtree: true });
            return () => {
                mo.disconnect();
                for (const v of row.querySelectorAll(`[${VALUE_ATTR}]`)) v.removeAttribute(VALUE_ATTR);
            };
        },
    },
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
