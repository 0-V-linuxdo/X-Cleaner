/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Void++ CustomSidebarIdentity for X: your own avatar, name and @handle in the account button at the
// bottom left (and, if you have several accounts, at the top of its menu) are swapped for your own
// picks. Only what you see changes; nothing is sent to X. The avatar is drawn in CSS over X's own
// image, and the text rows are marked and swapped in CSS like AbsoluteTimestamps, so React re-renders
// never fight us. StreamerMode's blur still applies on top.

import { definePluginSettings, migratePluginSetting, migrateSettingsToPlugin, PlainSettings, settingsStore } from "@api/Settings";
import { Icons } from "@ui/icons";
import { registerStyle, unregisterStyle } from "@utils/css";
import { N_ } from "@utils/i18n";
import definePlugin, { OptionType } from "@utils/types";
import { SEL } from "@x/dom";
import { CHECKS } from "@x/health";

import { clamp, type CropState, num, renderAvatarField } from "./avatar";
import css from "./styles.css";

const STYLE = "customSidebarIdentity:rules";
const SIZE_MIN = 24;
const SIZE_MAX = 64;
/** X draws the account button's avatar at 40px. */
const SIZE_DEFAULT = 40;

export const NAME_ATTR = "data-xc-csi-name";
export const HANDLE_ATTR = "data-xc-csi-handle";
export const HIDE_ATTR = "data-xc-csi-hide";
const MENU = '#layers [data-testid="HoverCard"]';
const AVATAR = '[data-testid^="UserAvatar-Container-"]';

export const settings = definePluginSettings({
    displayName: {
        type: OptionType.STRING,
        label: N_("显示名称"),
        description: N_("左下角账号按钮里显示的名字，认证徽标随之隐藏。留空保留原来的名字。"),
        default: "",
        placeholder: N_("显示在侧栏头像旁边"),
    },
    displayHandle: {
        type: OptionType.STRING,
        label: N_("显示用户名"),
        description: N_("名字下面的 @用户名，不用输入 @。留空保留原来的用户名。"),
        default: "",
        placeholder: N_("例如：someone"),
    },
    avatarUrl: {
        type: OptionType.CUSTOM,
        label: N_("头像"),
        description: N_("图片链接、data:image…，也可以直接粘贴或拖入图片，然后拖动圆圈选裁剪范围。留空保留原来的头像。"),
        default: "",
        render: (): HTMLElement => renderAvatarField(settings.store as unknown as CropState),
    },
    avatarSize: {
        type: OptionType.SLIDER,
        label: N_("头像大小"),
        description: N_("侧栏展开时账号按钮里头像的直径，X 默认 40。侧栏收起成图标时保持 40。"),
        min: SIZE_MIN,
        max: SIZE_MAX,
        step: 1,
        default: SIZE_DEFAULT,
        unit: "px",
    },
    applyToMenu: {
        type: OptionType.BOOLEAN,
        label: N_("账号菜单"),
        description: N_("同时替换账号菜单顶部当前账号的头像和名字（登录了多个账号时才有这一行）。"),
        default: true,
    },
}).withPrivateSettings<{ avatarSource: string; cropX: number; cropY: number; cropZoom: number }>();

/** Only images we can show under X's CSP (img-src allows data: and X's own hosts). */
export function avatarSrc(raw: unknown): string {
    const url = String(raw ?? "").trim();
    if (url.startsWith("data:image/")) return url;
    try {
        const { protocol } = new URL(url);
        return protocol === "https:" || protocol === "http:" ? url : "";
    } catch {
        return "";
    }
}

const cssUrl = (url: string) => `url("${url.replace(/["\\\n\r]/g, c => encodeURIComponent(c))}")`;

export function buildCss(opts: { avatarUrl?: string; avatarSize?: number; applyToMenu?: boolean }, self: string, avatarReady = true): string {
    const rules: string[] = [];
    const size = clamp(Math.round(num(opts.avatarSize, SIZE_DEFAULT)), SIZE_MIN, SIZE_MAX);
    // The expanded button has the name rows; the icon-only rail does not and keeps X's size.
    if (size !== SIZE_DEFAULT) {
        rules.push(`${SEL.accountSwitcher}:has([dir]) ${AVATAR} { width: ${size}px !important; height: ${size}px !important; flex-shrink: 0 !important; }`);
    }
    const url = avatarSrc(opts.avatarUrl);
    if (url && avatarReady) {
        const scopes = [`${SEL.accountSwitcher} ${AVATAR}`];
        if (opts.applyToMenu && self) scopes.push(`${MENU} [data-testid="UserAvatar-Container-${self.replace(/["\\]/g, "\\$&")}" i]`);
        // X paints the avatar as a background-image div, with a transparent <img> on top for drag/save.
        rules.push(`${scopes.map(s => `${s} [style*="background-image"]`).join(",\n")} { background-image: ${cssUrl(url)} !important; background-size: cover !important; background-position: center !important; }`);
        rules.push(`${scopes.map(s => `${s} img`).join(",\n")} { content: ${cssUrl(url)} !important; object-fit: cover !important; }`);
    }
    return rules.join("\n");
}

/** The account button's outermost text rows: name, verified badge and @handle. */
function rowsOf(root: Element): HTMLElement[] {
    const rows = [...root.querySelectorAll<HTMLElement>("[dir]")];
    return rows.filter(r => !rows.some(o => o !== r && o.contains(r)));
}

function clearMarks(root: Element) {
    for (const el of root.querySelectorAll(`[${NAME_ATTR}], [${HANDLE_ATTR}], [${HIDE_ATTR}]`)) {
        el.removeAttribute(NAME_ATTR);
        el.removeAttribute(HANDLE_ATTR);
        el.removeAttribute(HIDE_ATTR);
    }
}

const setAttr = (el: Element, name: string, value: string) => { if (el.getAttribute(name) !== value) el.setAttribute(name, value); };

/** Marks the name row with the custom name (hiding the badge rows) and the @handle row with the custom handle. */
export function markIdentity(root: Element, name: string, handle: string) {
    const rows = rowsOf(root);
    const isHandle = (r: Element) => /^@\w/.test(r.textContent?.trim() ?? "");
    const isBadge = (r: Element) => !r.textContent?.trim() && !!r.querySelector("svg");
    for (const r of rows) {
        const wantName = !!name && r === rows.find(x => !isHandle(x) && !isBadge(x));
        const wantHandle = !!handle && isHandle(r);
        const wantHide = !!name && isBadge(r);
        if (wantName) setAttr(r, NAME_ATTR, name); else r.removeAttribute(NAME_ATTR);
        if (wantHandle) setAttr(r, HANDLE_ATTR, `@${handle}`); else r.removeAttribute(HANDLE_ATTR);
        if (wantHide) setAttr(r, HIDE_ATTR, ""); else r.removeAttribute(HIDE_ATTR);
    }
}

const trimmed = (v: unknown) => String(v ?? "").trim();
const handleValue = () => trimmed(settings.store.displayHandle).replace(/^@+/, "");

/** Your handle, read from the account button's avatar test id. */
export function selfFrom(switcher: Element | null): string {
    const id = switcher?.querySelector(AVATAR)?.getAttribute("data-testid") ?? "";
    return id.slice("UserAvatar-Container-".length);
}

/** The current-account row of the account menu: the smallest block holding your avatar and @handle. */
function menuIdentity(menu: Element, self: string): Element | null {
    if (!self || !menu.querySelector('[data-testid^="AccountSwitcher_"]')) return null;
    const id = `useravatar-container-${self.toLowerCase()}`;
    const avatar = [...menu.querySelectorAll(AVATAR)].find(a => a.getAttribute("data-testid")?.toLowerCase() === id);
    for (let el = avatar?.parentElement; el && el !== menu; el = el.parentElement) {
        if (el.textContent?.toLowerCase().includes(`@${self.toLowerCase()}`)) return el;
    }
    return null;
}

let self = "";
let ready = "";
let probing = "";
const watched = new Map<Element, () => void>();

function paintCss() {
    const url = avatarSrc(settings.store.avatarUrl);
    // Only draw a picture that actually loads; a broken link keeps X's own avatar.
    if (url && url !== ready && url !== probing) {
        probing = url;
        const img = new Image();
        img.onload = () => { if (probing === url) { ready = url; probing = ""; paintCss(); } };
        img.onerror = () => { if (probing === url) probing = ""; };
        img.referrerPolicy = "no-referrer";
        img.src = url;
    }
    const rules = buildCss(settings.store, self, !!url && ready === url);
    if (rules) registerStyle(STYLE, rules);
    else unregisterStyle(STYLE);
}

function apply() {
    paintCss();
    for (const sync of watched.values()) sync();
}

function watch(root: Element, target: () => Element | null) {
    const sync = () => {
        observer.disconnect();
        const el = target();
        clearMarks(root);
        if (el) markIdentity(el, trimmed(settings.store.displayName), handleValue());
        observer.observe(root, { childList: true, subtree: true, characterData: true });
    };
    const observer = new MutationObserver(sync);
    watched.set(root, sync);
    sync();
    return () => {
        observer.disconnect();
        watched.delete(root);
        clearMarks(root);
    };
}

/** StreamerMode used to hold the alias for the account button; it lives here now. */
function migrateAlias() {
    const alias = trimmed(PlainSettings.plugins.StreamerMode?.alias);
    migrateSettingsToPlugin("CustomSidebarIdentity", "StreamerMode", "alias");
    migratePluginSetting("CustomSidebarIdentity", "displayName", "alias");
    const bag = PlainSettings.plugins.CustomSidebarIdentity;
    if (bag && "alias" in bag) { delete bag.alias; settingsStore.markAsChanged(); }
    if (alias && bag && bag.displayName === alias && bag.enabled === undefined) {
        bag.enabled = PlainSettings.plugins.StreamerMode?.enabled === true;
        settingsStore.markAsChanged();
    }
}

export default definePlugin({
    name: "CustomSidebarIdentity",
    description: N_("自定义身份：把左下角账号按钮里的头像、名字和 @用户名换成你自己设定的，头像支持粘贴图片和裁剪。只改你看到的样子，不会改动 X 上的资料。"),
    icon: Icons.userPen,
    tags: ["appearance", "privacy"],
    settings,
    managedStyle: css,
    migrate: migrateAlias,

    healthChecks: [CHECKS.accountSwitcher],
    elements: {
        [SEL.accountSwitcher](sw) {
            const handle = selfFrom(sw);
            if (handle && handle !== self) { self = handle; paintCss(); }
            return watch(sw, () => sw);
        },
        [MENU](menu) {
            return watch(menu, () => (settings.store.applyToMenu ? menuIdentity(menu, self) : null));
        },
    },
    start() {
        self = selfFrom(document.querySelector(SEL.accountSwitcher));
        apply();
    },
    stop() {
        unregisterStyle(STYLE);
        ready = "";
        probing = "";
    },
    onSettingsChange: apply,
});
