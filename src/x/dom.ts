/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { domainMatches, normalizeDomain } from "@rules/domains";

import { parseRoute, parseStatusHref, type RouteInfo } from "./route";
import { collapseWhitespace, normalizeHandle } from "./text";

export const SEL = {
    primaryColumn: '[data-testid="primaryColumn"]',
    tweet: 'article[data-testid="tweet"]',
    userName: '[data-testid="User-Name"]',
    tweetText: '[data-testid="tweetText"]',
    cell: '[data-testid="cellInnerDiv"]',
    tombstone: '[data-testid="tombstone"]',
    quote: '[data-testid="quoteTweet"], [data-testid="tweetQuote"], [data-testid="quotedTweet"], [data-testid="card.wrapper"]',
    caret: '[data-testid="caret"]',
    userActions: '[data-testid="userActions"]',
    profileLink: 'a[data-testid="AppTabBar_Profile_Link"][href]',
    accountSwitcher: '[data-testid="SideNav_AccountSwitcher_Button"]',
    grokDrawer: '#layers [data-testid="GrokDrawer"]',
} as const;

export const OWNED_ATTR = "data-xrb-owned";

export interface ReplyContext {
    tweetId: string;
    authorHandle: string;
    statusUrl: string;
    displayName: string;
    bodyText: string;
    visibleUrls: string[];
    domains: string[];
    mediaUrls: string[];
    isRoot: boolean;
    isOp: boolean;
    opIdentityKnown: boolean;
    isSelf: boolean;
    isPromoted: boolean;
    identityComplete: true;
    article: HTMLElement;
    cell: HTMLElement | null;
}

export type SerializableContext = Omit<ReplyContext, "article" | "cell">;

export function serializeContext(ctx: ReplyContext): SerializableContext {
    const { article: _a, cell: _c, ...rest } = ctx;
    return { ...rest, visibleUrls: [...rest.visibleUrls], domains: [...rest.domains], mediaUrls: [...rest.mediaUrls] };
}

export function findPrimaryColumn(doc: Document = document): HTMLElement | null {
    for (const el of doc.querySelectorAll<HTMLElement>(SEL.primaryColumn)) {
        if (!el.closest('[role="dialog"]')) return el;
    }
    return null;
}

export function isTopLevelTweet(article: Element, column: Element | null): boolean {
    if (!column || article.closest('[role="dialog"]')) return false;
    if (article.parentElement?.closest(SEL.tweet)) return false;
    return article.closest(SEL.primaryColumn) === column;
}

export function listTopLevelTweets(column: Element | null): HTMLElement[] {
    if (!column) return [];
    return [...column.querySelectorAll<HTMLElement>(SEL.tweet)].filter(a => isTopLevelTweet(a, column));
}

export function cellOf(el: Element): HTMLElement | null {
    return el.closest<HTMLElement>(SEL.cell);
}

export function textWithAlt(root: Node | null): string {
    if (!root) return "";
    let out = "";
    const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) { out += node.nodeValue ?? ""; return; }
        if (!(node instanceof Element)) return;
        if (node.tagName === "IMG") { out += node.getAttribute("alt") ?? ""; return; }
        if (node.tagName === "BR") { out += "\n"; return; }
        for (const child of node.childNodes) walk(child);
    };
    walk(root);
    return out;
}

const ownTweet = (el: Element) => el.closest(SEL.tweet);

function hasStatusLinkInside(el: Element, ignoreId?: string): boolean {
    for (const a of el.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')) {
        const parsed = parseStatusHref(a.getAttribute("href") ?? "");
        if (!ignoreId || !parsed || parsed.tweetId !== ignoreId) return true;
    }
    return false;
}

export function isInNestedStatusCard(el: Element, article: Element, ownId?: string): boolean {
    let node: Element | null = el.parentElement;
    while (node && node !== article) {
        if (node.matches(SEL.quote)) return true;
        if (node.getAttribute("role") === "link" && hasStatusLinkInside(node, ownId)) return true;
        node = node.parentElement;
    }
    return false;
}

export function isOwnContent(el: Element, article: Element, ownId: string): boolean {
    return ownTweet(el) === article && !isInNestedStatusCard(el, article, ownId);
}

export function findIdentityLink(article: Element): { handle: string; tweetId: string; link: HTMLAnchorElement } | null {
    for (const a of article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')) {
        if (ownTweet(a) !== article || !a.querySelector("time")) continue;
        if (isInNestedStatusCard(a, article)) continue;
        const parsed = parseStatusHref(a.getAttribute("href") ?? "");
        if (parsed) return { ...parsed, link: a };
    }
    return null;
}

export function profilePathHandle(href: string | null): string {
    if (!href) return "";
    let url: URL;
    try { url = new URL(href, location.origin); } catch { return ""; }
    if (url.pathname.includes("/status/")) return "";
    const seg = url.pathname.split("/").filter(Boolean);
    return seg.length === 1 ? normalizeHandle(seg[0]) : "";
}

export function extractDisplayName(block: Element | null, handle: string): string {
    if (!block) return "";
    for (const a of block.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        if (profilePathHandle(a.getAttribute("href")) !== handle) continue;
        const text = collapseWhitespace(textWithAlt(a));
        if (text && normalizeHandle(text) !== handle && text.replace(/^@/, "").toLowerCase() !== handle) return text;
    }
    for (const span of block.querySelectorAll("span")) {
        if (span.querySelector("span")) continue;
        const text = collapseWhitespace(textWithAlt(span));
        if (!text || /^[@·\s]*$/u.test(text)) continue;
        if (text.replace(/^@/, "").toLowerCase() === handle) continue;
        return text;
    }
    return collapseWhitespace(textWithAlt(block).replace(new RegExp(`@${handle}\\b`, "ig"), ""));
}

const LINKLIKE_RE = /^(?:https?:\/\/|www\.)\S+$|^(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[\p{L}]{2,}(?::\d+)?(?:[/?#]\S*)?$/iu;
const X_OWN_HOST = /(?:^|\.)(?:x\.com|twitter\.com|twimg\.com)$/i;

export function looksLikeLink(value: string): boolean {
    return !!value && !/\s/u.test(value) && LINKLIKE_RE.test(value);
}

export function hostOf(value: string): string {
    return normalizeDomain(value.replace(/[……]+$/u, ""));
}

export function extractLinks(article: Element, ownId: string): { visibleUrls: string[]; domains: string[] } {
    const visible = new Set<string>();
    const domains = new Set<string>();
    for (const a of article.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        if (!isOwnContent(a, article, ownId) || a.closest(SEL.userName)) continue;
        const href = a.getAttribute("href") ?? "";
        const candidates = [a.getAttribute("data-expanded-url"), a.getAttribute("data-unwound-url"), a.getAttribute("title"), collapseWhitespace(textWithAlt(a)).replace(/\s+/gu, ""), href];
        const displayed = candidates.find(c => c && looksLikeLink(c.trim()))?.trim() ?? "";
        let externalHref = "";
        try {
            const url = new URL(href, location.origin);
            const host = url.hostname.toLowerCase();
            if ((url.protocol === "http:" || url.protocol === "https:") && (!X_OWN_HOST.test(host) || host === "t.co")) externalHref = url.href;
        } catch {}
        const value = displayed || externalHref;
        if (!value) continue;
        visible.add(value);
        const host = hostOf(displayed || externalHref);
        if (host && host !== "t.co") domains.add(host);
    }
    return { visibleUrls: [...visible], domains: [...domains] };
}

export function extractMedia(article: Element, ownId: string): string[] {
    const out: string[] = [];
    const push = (v: string | null | undefined) => {
        if (!v || !/^https?:\/\//i.test(v) || out.includes(v)) return;
        out.push(v);
    };
    const selectors = ['[data-testid="tweetPhoto"] img[src]', '[data-testid="videoPlayer"] video[poster]', "video[poster]", 'img[src*="pbs.twimg.com/media"]'];
    for (const el of article.querySelectorAll<HTMLElement>(selectors.join(","))) {
        if (!isOwnContent(el, article, ownId)) continue;
        if (el instanceof HTMLVideoElement) push(el.poster || el.getAttribute("poster"));
        else if (el instanceof HTMLImageElement) push(el.currentSrc || el.getAttribute("src"));
        if (out.length >= 2) break;
    }
    return out.slice(0, 2);
}

const PROMOTED_RE = /(?:^|\s)(?:promoted|sponsored|advertisement|ad|推广|广告|贊助|赞助|プロモーション|プロモツイート|promocionado|patrocinado|sponsorisé|gesponsert)(?:\s|$)/iu;

export function isPromotedTweet(article: Element): boolean {
    if (article.closest('[data-testid="placementTracking"]')) return true;
    if (article.querySelector('[data-testid="promotedIndicator"], [data-testid*="promoted" i]')) return true;
    for (const el of article.querySelectorAll('[data-testid="socialContext"]')) {
        if (ownTweet(el) === article && PROMOTED_RE.test(collapseWhitespace(el.textContent ?? ""))) return true;
    }
    return false;
}

export function detectSelfHandle(doc: Document = document): string {
    const link = doc.querySelector<HTMLAnchorElement>(SEL.profileLink);
    if (link) {
        const h = profilePathHandle(link.getAttribute("href"));
        if (h) return h;
    }
    const sw = doc.querySelector<HTMLElement>(SEL.accountSwitcher);
    if (sw) {
        const attr = normalizeHandle(sw.getAttribute("data-screen-name") ?? sw.getAttribute("data-username") ?? "");
        if (attr) return attr;
        const m = (sw.textContent ?? "").match(/@([A-Za-z0-9_]{1,15})/);
        if (m) return normalizeHandle(m[1]);
    }
    return "";
}

export function findRootArticle(column: Element | null, route: RouteInfo): HTMLElement | null {
    if (!route.isStatusRoute) return null;
    for (const article of listTopLevelTweets(column)) {
        if (findIdentityLink(article)?.tweetId === route.rootTweetId) return article;
    }
    return null;
}

export interface ExtractOptions {
    route?: RouteInfo;
    selfHandle?: string;
    column?: Element | null;
}

export function resolveOpHandle(route: RouteInfo, column: Element | null): string {
    if (!route.isStatusRoute) return "";
    if (route.opHandle) return route.opHandle;
    const root = findRootArticle(column, route);
    return root ? findIdentityLink(root)?.handle ?? "" : "";
}

export function extractReplyContext(article: HTMLElement, opts: ExtractOptions = {}): ReplyContext | null {
    const identity = findIdentityLink(article);
    if (!identity) return null;
    const route = opts.route ?? parseRoute();
    const { handle, tweetId } = identity;
    const column = opts.column === undefined ? findPrimaryColumn(article.ownerDocument) : opts.column;
    const selfHandle = opts.selfHandle ?? detectSelfHandle(article.ownerDocument);
    const nameBlock = [...article.querySelectorAll(SEL.userName)].find(el => isOwnContent(el, article, tweetId)) ?? null;
    const textEl = [...article.querySelectorAll(SEL.tweetText)].find(el => isOwnContent(el, article, tweetId)) ?? null;
    const { visibleUrls, domains } = extractLinks(article, tweetId);
    const opHandle = resolveOpHandle(route, column);
    const opIdentityKnown = !route.isStatusRoute || !!opHandle;
    return {
        tweetId,
        authorHandle: handle,
        statusUrl: `${location.origin}/${handle}/status/${tweetId}`,
        displayName: extractDisplayName(nameBlock, handle),
        bodyText: collapseWhitespace(textWithAlt(textEl)),
        visibleUrls,
        domains,
        mediaUrls: extractMedia(article, tweetId),
        isRoot: route.isStatusRoute && tweetId === route.rootTweetId,
        isOp: route.isStatusRoute && !!opHandle && handle === opHandle,
        opIdentityKnown,
        isSelf: !!selfHandle && handle === selfHandle,
        isPromoted: isPromotedTweet(article),
        identityComplete: true,
        article,
        cell: cellOf(article),
    };
}

export function contextSignature(ctx: Pick<ReplyContext, "tweetId" | "authorHandle" | "displayName" | "bodyText" | "opIdentityKnown" | "isOp" | "visibleUrls" | "mediaUrls">): string {
    return JSON.stringify([ctx.tweetId, ctx.authorHandle, ctx.displayName, ctx.bodyText, ctx.opIdentityKnown, ctx.isOp, ctx.visibleUrls, ctx.mediaUrls]);
}

export function quickContext(article: HTMLElement): { bodyText: string; displayName: string; authorHandle: string } {
    const textEl = article.querySelector(SEL.tweetText);
    const block = article.querySelector(SEL.userName);
    const m = (block?.textContent ?? "").match(/@([A-Za-z0-9_]{1,15})/);
    const authorHandle = m ? normalizeHandle(m[1]) : "";
    return { bodyText: collapseWhitespace(textWithAlt(textEl)), displayName: block ? extractDisplayName(block, authorHandle) : "", authorHandle };
}

const UNAVAILABLE_RE = /(?:这个帖子不可用|此帖子不可用|此貼文無法查看|此貼文不可用|this post is unavailable|this tweet is unavailable|このポストは表示できません|このツイートは表示できません|이 게시물을 볼 수 없습니다)/iu;

export function isTombstoneCell(cell: Element): boolean {
    if (!cell.matches(SEL.cell)) return false;
    if (cell.querySelector(SEL.tweet) || cell.querySelector('h2, [role="heading"]')) return false;
    const text = collapseWhitespace(cell.textContent ?? "");
    if (!text) return false;
    if (cell.querySelector(SEL.tombstone)) return text.length <= 160;
    return text.length <= 96 && UNAVAILABLE_RE.test(text);
}

export { domainMatches };

/** Visible to the user: no hidden ancestor (display/visibility/opacity/hidden/aria-hidden) and a non-empty box. */
export function isRendered(el: HTMLElement): boolean {
    for (let n: HTMLElement | null = el; n; n = n.parentElement) {
        if (n.hidden || n.getAttribute("aria-hidden") === "true") return false;
        const s = getComputedStyle(n);
        if (s.display === "none" || s.visibility === "hidden" || s.visibility === "collapse" || s.opacity === "0") return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}
