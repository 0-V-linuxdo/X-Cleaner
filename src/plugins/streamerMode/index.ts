/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Void++ StreamerMode / NoSidebarIdentity for X: blur your own identity so screenshots and screen
// shares don't give your account away. Pure CSS keyed on X's own test ids and your handle; the optional
// alias (Void++ CustomSidebarIdentity) marks the account menu's name rows and swaps their text in CSS.

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
    dmNames: { type: OptionType.BOOLEAN, label: N_("私信列表"), description: N_("私信页里对话的头像和名字。"), default: false },
    revealOnHover: { type: OptionType.BOOLEAN, label: N_("悬停时显示"), description: N_("鼠标移上去时暂时取消模糊。"), default: true },
    blur: { type: OptionType.SLIDER, label: N_("模糊程度"), description: "", min: 2, max: 16, step: 1, default: 8, unit: "px" },
    alias: { type: OptionType.STRING, label: N_("显示别名"), description: N_("填写后，左下角账号菜单里的昵称换成这段文字，认证徽标和 @handle 隐藏，不再模糊。留空则按上面的设置模糊。"), default: "", placeholder: N_("例如：观众朋友们好") },
});

export const ALIAS_ATTR = "data-xc-alias";
const ALIAS_HIDE_ATTR = "data-xc-alias-hide";

const escapeAttr = (v: string) => v.replace(/["\\]/g, "\\$&");

export function buildCss(opts: { accountAvatar?: boolean; accountName?: boolean; ownAvatars?: boolean; dmNames?: boolean; revealOnHover?: boolean; blur?: number; alias?: string }, self: string): string {
    const targets: string[] = [];
    const alias = opts.alias?.trim();
    if (opts.accountAvatar) targets.push(`${SEL.accountSwitcher} [data-testid^="UserAvatar-Container-"]`);
    // Outermost [dir] only: nested blurs would stack. An alias replaces the name, so it isn't blurred.
    if (opts.accountName && !alias) targets.push(`${SEL.accountSwitcher} [dir]:not(${SEL.accountSwitcher} [dir] [dir])`);
    if (opts.ownAvatars && self) targets.push(`[data-testid="UserAvatar-Container-${escapeAttr(self)}" i]`);
    if (opts.dmNames) targets.push('[data-testid="conversation"] [data-testid^="UserAvatar-Container-"]', '[data-testid="conversation"] [dir]:not([data-testid="conversation"] [dir] [dir])');
    const rules: string[] = [];
    if (targets.length) {
        rules.push(`${targets.join(",\n")} { filter: blur(${opts.blur ?? 8}px) !important; transition: filter .15s ease; }`);
        if (opts.revealOnHover) rules.push(`${targets.map(t => `${t}:hover`).join(",\n")} { filter: none !important; }`);
    }
    if (alias) {
        // Same trick as AbsoluteTimestamps: zero the real text, draw the alias in ::after at X's own size.
        rules.push(`${SEL.accountSwitcher} [${ALIAS_ATTR}] > * { display: none !important; }`);
        rules.push(`${SEL.accountSwitcher} [${ALIAS_ATTR}]::after { content: attr(${ALIAS_ATTR}); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`);
        rules.push(`${SEL.accountSwitcher} [${ALIAS_HIDE_ATTR}] { display: none !important; }`);
    }
    return rules.join("\n");
}

/** Marks the account menu's name row with the alias and hides the badge and @handle rows next to it. */
export function markAlias(switcher: Element, alias: string) {
    const rows = [...switcher.querySelectorAll<HTMLElement>("[dir]")].filter(d => !d.parentElement?.closest(`${SEL.accountSwitcher} [dir]`));
    for (const r of rows) { r.removeAttribute(ALIAS_ATTR); r.removeAttribute(ALIAS_HIDE_ATTR); }
    if (!alias || !rows.length) return;
    const [name, ...rest] = rows;
    if (name.getAttribute(ALIAS_ATTR) !== alias) name.setAttribute(ALIAS_ATTR, alias);
    for (const r of rest) r.setAttribute(ALIAS_HIDE_ATTR, "");
}

const aliasObservers = new Map<Element, MutationObserver>();

function watchAlias(switcher: Element) {
    const sync = () => {
        observer.disconnect();
        markAlias(switcher, settings.store.alias.trim());
        observer.observe(switcher, { childList: true, subtree: true, characterData: true });
    };
    const observer = new MutationObserver(sync);
    aliasObservers.set(switcher, observer);
    sync();
    return () => {
        observer.disconnect();
        aliasObservers.delete(switcher);
        markAlias(switcher, "");
    };
}

let self = "";
let retry: ReturnType<typeof setInterval> | undefined;

function apply() {
    self = self || detectSelfHandle();
    const css = buildCss(settings.store, self);
    if (css) registerStyle(STYLE, css);
    else unregisterStyle(STYLE);
    for (const sw of aliasObservers.keys()) markAlias(sw, settings.store.alias.trim());
}

export default definePlugin({
    name: "StreamerMode",
    description: N_("主播模式：模糊你自己的头像、昵称和 @handle，可选模糊私信列表，也可以把账号菜单里的名字换成别名，截图和录屏时不暴露账号。"),
    icon: Icons.eyeOff,
    tags: ["privacy"],
    settings,

    healthChecks: [CHECKS.accountSwitcher],
    elements: {
        [SEL.accountSwitcher]: watchAlias,
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
