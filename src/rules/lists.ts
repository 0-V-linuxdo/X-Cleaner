/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { AccountEntry, BlockerConfig } from "@config/config";
import { normalizeHandle, normalizePhrase } from "@x/text";

import { domainMatches, normalizeDomain } from "./domains";

export function findAccount(config: BlockerConfig, handle: string): AccountEntry | undefined {
    const h = normalizeHandle(handle);
    return h ? config.blacklists.accounts.find(a => a.handle === `@${h}`) : undefined;
}

export function isAllowed(config: BlockerConfig, handle: string): boolean {
    const h = normalizeHandle(handle);
    return !!h && config.allowHandles.includes(`@${h}`);
}

export type PhraseField = "body" | "displayName" | "handle";

export function matchPhrase(phrases: readonly string[], ctx: { bodyText?: string; displayName?: string; authorHandle?: string }): { phrase: string; field: PhraseField } | null {
    if (!phrases.length) return null;
    const fields: [PhraseField, string][] = [["body", ctx.bodyText ?? ""], ["displayName", ctx.displayName ?? ""], ["handle", ctx.authorHandle ?? ""]];
    for (const [field, raw] of fields) {
        const text = normalizePhrase(raw);
        if (!text) continue;
        const phrase = phrases.find(p => p && text.includes(p));
        if (phrase) return { phrase, field };
    }
    return null;
}

export function hostsFromUrls(urls: readonly string[]): string[] {
    const out = new Set<string>();
    for (const url of urls) {
        const host = normalizeDomain(url.replace(/[……]+$/u, ""));
        if (host && host !== "t.co") out.add(host);
    }
    return [...out];
}

export function matchDomain(domains: readonly string[], ctx: { visibleUrls?: string[]; domains?: string[] }): { domain: string; host: string } | null {
    if (!domains.length) return null;
    const hosts = new Set([...(ctx.domains ?? []), ...hostsFromUrls(ctx.visibleUrls ?? [])]);
    for (const host of hosts) {
        const domain = domains.find(d => domainMatches(host, d));
        if (domain) return { domain, host };
    }
    return null;
}
