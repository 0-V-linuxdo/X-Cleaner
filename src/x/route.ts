/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { normalizeHandle } from "./text";

export interface RouteInfo {
    active: boolean;
    isStatusRoute: boolean;
    hostname: string;
    pathname: string;
    opHandle: string;
    rootTweetId: string;
    statusId: string;
    routeKey: string;
}

export const X_HOST_RE = /^(?:www\.|mobile\.|m\.)?(?:x\.com|twitter\.com)$/i;
const GENERIC_STATUS_RE = /^\/i\/(?:web\/)?status\/(\d+)(?:\/|$)/;
const USER_STATUS_RE = /^\/([a-z0-9_]{1,15})\/status\/(\d+)(?:\/|$)/i;

export function parseRoute(input: string | URL | Location = location.href): RouteInfo {
    let url: URL;
    try { url = new URL(String(input)); } catch { url = new URL("about:blank"); }
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname;
    const base: RouteInfo = { active: false, isStatusRoute: false, hostname, pathname, opHandle: "", rootTweetId: "", statusId: "", routeKey: "" };
    if (!X_HOST_RE.test(hostname)) return base;
    base.active = true;
    const generic = pathname.match(GENERIC_STATUS_RE);
    if (generic) return { ...base, isStatusRoute: true, rootTweetId: generic[1], statusId: generic[1], routeKey: `i/status/${generic[1]}` };
    const user = pathname.match(USER_STATUS_RE);
    if (user) {
        const opHandle = normalizeHandle(user[1]);
        if (opHandle) return { ...base, isStatusRoute: true, opHandle, rootTweetId: user[2], statusId: user[2], routeKey: `${opHandle}/status/${user[2]}` };
    }
    return base;
}

export function parseStatusHref(href: string, base = location.origin): { handle: string; tweetId: string } | null {
    let url: URL;
    try { url = new URL(href, base); } catch { return null; }
    if (!X_HOST_RE.test(url.hostname)) return null;
    const m = url.pathname.match(USER_STATUS_RE);
    if (!m) return null;
    const handle = normalizeHandle(m[1]);
    return handle && handle !== "i" ? { handle, tweetId: m[2] } : null;
}
