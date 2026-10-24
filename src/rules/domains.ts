/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export function normalizeDomain(raw: unknown): string {
    if (typeof raw !== "string") return "";
    let value = raw.trim().replace(/^\.+/, "");
    if (!value) return "";
    if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) value = `https://${value}`;
    let url: URL;
    try { url = new URL(value); } catch { return ""; }
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    return url.hostname.toLowerCase().replace(/^\.+|\.+$/g, "");
}

export function domainMatches(host: string, blocked: string): boolean {
    if (!host || !blocked || host === "t.co" || blocked === "t.co") return false;
    return host === blocked || host.endsWith(`.${blocked}`);
}

const BROAD_SUFFIXES = new Set(["ac.uk", "co.jp", "co.uk", "com.au", "com.br", "com.cn", "com.hk", "com.tw", "gov.uk", "net.au", "net.cn", "org.uk"]);
const BROAD_PLATFORMS = new Set(["discord.com", "discord.gg", "facebook.com", "github.com", "instagram.com", "linktr.ee", "medium.com", "reddit.com", "substack.com", "t.me", "telegram.me", "twitter.com", "x.com", "youtu.be", "youtube.com"]);
const SHORTENERS = new Set(["bit.ly", "buff.ly", "cutt.ly", "goo.gl", "is.gd", "ow.ly", "t.co", "tinyurl.com"]);

export interface DomainWarning {
    level: "error" | "warning";
    message: string;
}

export function domainWarning(raw: string): { domain: string; warning: DomainWarning | null } {
    const domain = normalizeDomain(raw);
    if (!domain) return { domain, warning: { level: "error", message: "请输入有效域名。" } };
    if (domain === "t.co") return { domain, warning: { level: "warning", message: "t.co 隐藏了最终目标；脚本不会访问短链，因此仅有 t.co 时会保持可见。" } };
    if (!domain.includes(".") || BROAD_SUFFIXES.has(domain)) return { domain, warning: { level: "warning", message: "该规则范围过宽，可能匹配大量无关链接。" } };
    if (BROAD_PLATFORMS.has(domain)) return { domain, warning: { level: "warning", message: `屏蔽 ${domain} 会命中该平台上的所有相关链接。` } };
    if (SHORTENERS.has(domain)) return { domain, warning: { level: "warning", message: `屏蔽 ${domain} 会命中使用该短链服务的所有链接。` } };
    return { domain, warning: null };
}
