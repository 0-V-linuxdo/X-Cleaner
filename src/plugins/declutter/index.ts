/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// X's counterpart of Void++'s Cleaner / NoGrokBot / NoShareLink: one switch per distraction.
// Everything is CSS except two things X gives no stable selector for: promoted posts are marked
// on their cell first, and the unread count is stripped from the tab title.

import { definePluginSettings } from "@api/Settings";
import { Icons } from "@ui/icons";
import { registerStyle, unregisterStyle } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { cellOf, isPromotedTweet, SEL } from "@x/dom";
import { collapseWhitespace } from "@x/text";

const STYLE = "declutter:rules";
export const AD_ATTR = "data-xc-ad";
const SIDE = '[data-testid="sidebarColumn"]';

const opt = (label: string, description: string, def: boolean) => ({ type: OptionType.BOOLEAN as const, label, description, default: def });

export const settings = definePluginSettings({
    hidePremiumUpsell: opt("Premium 推销", "侧栏的「订阅 Premium」卡片和各处的升级提示。", true),
    hidePromoted: opt("推广帖", "时间线和回复里标着「广告 / Promoted」的帖子。", true),
    hideWhoToFollow: opt("推荐关注", "侧栏的「推荐关注」卡片。", true),
    hideTrends: opt("趋势", "侧栏的「有什么新鲜事」趋势卡片。", false),
    hideSidebarFooter: opt("侧栏页脚", "侧栏底部的服务条款、隐私政策等链接。", true),
    hideGrokButtons: opt("帖子上的 Grok 按钮", "每条帖子右上角的 Grok 按钮。回复盾牌仍会正常显示。", false),
    hideGrokDrawer: opt("Grok 浮窗", "右下角的 Grok 对话浮窗。", false),
    hideMessagesDrawer: opt("私信浮窗", "右下角的私信浮窗。", false),
    hideViewCounts: opt("浏览量", "帖子操作栏里的浏览量数字。", false),
    hideTitleCount: opt("标题未读数", "去掉浏览器标签页标题前面的「(3)」未读数。", false),
});

type Key = keyof typeof settings.def;

export const RULES: Record<Exclude<Key, "hideTitleCount">, string> = {
    hidePremiumUpsell: [
        `${SIDE} div:has(> aside a[href*="/i/premium"])`,
        `${SIDE} div:has(> div > aside a[href*="/i/premium"])`,
        '[data-testid*="upsell" i]',
        '[data-testid="verified_profile_upsell"]',
    ].join(",\n"),
    hidePromoted: `${SEL.cell}[${AD_ATTR}]`,
    hideWhoToFollow: `${SIDE} div:has(> div > aside [data-testid="UserCell"])`,
    hideTrends: `${SIDE} div:has(> section [data-testid="trend"])`,
    hideSidebarFooter: `${SIDE} div:has(> nav[role="navigation"])`,
    hideGrokButtons: `${SEL.tweet} button[aria-label*="Grok"]:not([data-xrb-inline-rule])`,
    hideGrokDrawer: '[data-testid="GrokDrawer"]',
    hideMessagesDrawer: '[data-testid="chat-drawer-root"]',
    hideViewCounts: `${SEL.tweet} [role="group"] > div:has(> a[href$="/analytics"])`,
};

export function buildCss(values: Partial<Record<Key, boolean>>): string {
    return (Object.keys(RULES) as (keyof typeof RULES)[])
        .filter(k => values[k])
        .map(k => `${RULES[k]} { display: none !important; }`)
        .join("\n");
}

const AD_LABEL_RE = /^(?:ad|ads|promoted|sponsored|广告|推广|廣告|贊助|赞助|プロモーション|anuncio|promocionado|gesponsert|sponsorisé)$/iu;

/** isPromotedTweet plus the bare 「Ad」 label X now prints in a promoted post's header. */
export function isAdTweet(article: Element): boolean {
    if (isPromotedTweet(article)) return true;
    for (const span of article.querySelectorAll("span")) {
        if (span.childElementCount || span.closest(`${SEL.tweetText}, ${SEL.quote}, ${SEL.userName}`)) continue;
        if (span.closest(SEL.tweet) !== article) continue;
        if (AD_LABEL_RE.test(collapseWhitespace(span.textContent ?? ""))) return true;
    }
    return false;
}

export const stripTitleCount = (title: string) => title.replace(/^\(\d+\+?\)\s*/, "");

let titleObserver: MutationObserver | null = null;

function syncTitleWatch() {
    const want = !!settings.store.hideTitleCount;
    if (!want) {
        titleObserver?.disconnect();
        titleObserver = null;
        return;
    }
    const fix = () => {
        const next = stripTitleCount(document.title);
        if (next !== document.title) document.title = next;
    };
    fix();
    if (titleObserver) return;
    titleObserver = new MutationObserver(fix);
    titleObserver.observe(document.head ?? document.documentElement, { subtree: true, childList: true, characterData: true });
}

function apply() {
    const css = buildCss(settings.store as Partial<Record<Key, boolean>>);
    if (css) registerStyle(STYLE, css);
    else unregisterStyle(STYLE);
    syncTitleWatch();
}

export default definePlugin({
    name: "Declutter",
    description: "精简 X 的页面：分别隐藏 Premium 推销、推广帖、推荐关注、趋势、Grok 按钮和浮窗、浏览量等干扰元素。",
    icon: Icons.broom,
    tags: ["declutter", "timeline"],
    settings,

    elements: {
        [SEL.tweet](article) {
            if (!isAdTweet(article)) return;
            const cell = cellOf(article);
            cell?.setAttribute(AD_ATTR, "");
            return () => cell?.removeAttribute(AD_ATTR);
        },
    },

    start: apply,
    stop() {
        unregisterStyle(STYLE);
        titleObserver?.disconnect();
        titleObserver = null;
        for (const el of document.querySelectorAll(`[${AD_ATTR}]`)) el.removeAttribute(AD_ATTR);
    },
    onSettingsChange: apply,
});
