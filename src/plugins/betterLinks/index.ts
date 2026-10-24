/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Void++ BetterLinks for X. X routes every link in a post through t.co but prints the real URL in
// the link text (partly in hidden spans), so the real address is known without asking t.co.

import { definePluginSettings } from "@api/Settings";
import { Icons } from "@ui/icons";
import { registerStyle, unregisterStyle } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { SEL } from "@x/dom";

const STYLE = "betterLinks:colors";
export const ORIGINAL_ATTR = "data-xc-tco";
const TCO_SEL = `${SEL.tweet} a[href^="https://t.co/"]`;
const COLOR_RE = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([^)]*\)|[a-z]+)$/i;

const isValidColor = (v: string) => (!v.trim() || COLOR_RE.test(v.trim()) ? true : "请填颜色值，例如 #1d9bf0 或 orange。");

export const settings = definePluginSettings({
    bypassTco: { type: OptionType.BOOLEAN, label: "直接打开真实地址", description: "点击帖子里的链接时直接打开原网址，不经过 t.co 跳转。", default: true },
    showFullUrl: { type: OptionType.BOOLEAN, label: "悬停显示完整地址", description: "鼠标停在链接上时，用提示显示被截断的完整网址。", default: true },
    linkColor: { type: OptionType.STRING, label: "链接颜色", description: "留空则用 X 的默认蓝色。", placeholder: "#1d9bf0", default: "", isValid: isValidColor },
    visitedColor: { type: OptionType.STRING, label: "已访问链接颜色", description: "打开过的链接换成这个颜色；留空则不区分。", placeholder: "#a371f7", default: "", isValid: isValidColor },
});

/** The address X prints in a t.co link: all text including hidden spans, minus the trailing ellipsis. */
export function expandedUrl(a: HTMLAnchorElement): string | null {
    const href = a.getAttribute(ORIGINAL_ATTR) ?? a.getAttribute("href") ?? "";
    if (!href.startsWith("https://t.co/")) return null;
    const raw = (a.textContent ?? "").trim();
    // Card links read like 「From github.com」; an address X prints never has a space inside it.
    if (!raw || /\s/u.test(raw)) return null;
    const text = raw.replace(/[…]+$/u, "");
    try {
        const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        if (!url.hostname.includes(".") || url.hostname === "t.co") return null;
        return url.href;
    } catch {
        return null;
    }
}

function prepare(a: HTMLAnchorElement) {
    const url = expandedUrl(a);
    if (!url) return;
    if (settings.store.showFullUrl && !a.title) a.title = url;
    if (settings.store.bypassTco && !a.hasAttribute(ORIGINAL_ATTR)) {
        a.setAttribute(ORIGINAL_ATTR, a.getAttribute("href")!);
        a.setAttribute("href", url);
    }
}

/** Links are rewritten lazily, when the pointer or focus reaches them, so idle timelines stay untouched. */
function onPoint(e: Event) {
    const a = (e.target as Element | null)?.closest?.<HTMLAnchorElement>(TCO_SEL);
    if (a) prepare(a);
}

export function restoreLinks() {
    for (const a of document.querySelectorAll<HTMLAnchorElement>(`a[${ORIGINAL_ATTR}]`)) {
        a.setAttribute("href", a.getAttribute(ORIGINAL_ATTR)!);
        a.removeAttribute(ORIGINAL_ATTR);
    }
}

export function buildCss(linkColor: string, visitedColor: string): string {
    const links = `${SEL.tweet} ${SEL.tweetText} a[href]:not([href^="/"])`;
    const out: string[] = [];
    if (linkColor.trim() && COLOR_RE.test(linkColor.trim())) out.push(`${links}, ${links} * { color: ${linkColor.trim()} !important; }`);
    if (visitedColor.trim() && COLOR_RE.test(visitedColor.trim())) out.push(`${links}:visited, ${links}:visited * { color: ${visitedColor.trim()} !important; }`);
    return out.join("\n");
}

function apply() {
    const css = buildCss(settings.store.linkColor, settings.store.visitedColor);
    if (css) registerStyle(STYLE, css);
    else unregisterStyle(STYLE);
    if (!settings.store.bypassTco) restoreLinks();
}

export default definePlugin({
    name: "BetterLinks",
    description: "链接增强：帖子里的链接直接打开真实网址、不经 t.co 跳转，悬停显示完整地址，可自定义链接和已访问链接的颜色。",
    icon: Icons.link,
    tags: ["timeline", "privacy"],
    settings,

    start() {
        apply();
        document.addEventListener("pointerover", onPoint, true);
        document.addEventListener("focusin", onPoint, true);
    },
    stop() {
        document.removeEventListener("pointerover", onPoint, true);
        document.removeEventListener("focusin", onPoint, true);
        unregisterStyle(STYLE);
        restoreLinks();
    },
    onSettingsChange: apply,
});
