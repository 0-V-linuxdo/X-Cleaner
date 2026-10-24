/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { AccountEntry } from "@config/config";
import type { ReplyEvent } from "@filter/types";
import { isAllowed } from "@rules/lists";
import { Icons } from "@ui/icons";
import { N_, t } from "@utils/i18n";
import definePlugin from "@utils/types";

import { getConfigStore } from "../_api/blockerConfig";

interface Tracked {
    handle: string;
    source: AccountEntry["source"];
    createdAt: number;
}

const tracked = new Map<string, Tracked>();
const suppressed = new Set<string>();
const rollingBack = new Set<string>();
let pending: AccountEntry[] = [];
let unsub: (() => void) | null = null;

function flush() {
    const batch = pending;
    pending = [];
    const store = getConfigStore();
    const fresh = batch.filter(e => !store.findAccount(e.handle) && !store.config.allowHandles.includes(e.handle));
    if (!fresh.length) return;
    store.update(c => {
        for (const e of fresh) if (!c.blacklists.accounts.some(a => a.handle === e.handle)) c.blacklists.accounts.push(e);
    });
}

function onHidden({ ctx, verdict }: ReplyEvent) {
    const store = getConfigStore();
    const req = verdict.autoEntry;
    if (!req || !store.config.autoBlacklistAccounts) return;
    if (ctx.isRoot || ctx.isSelf || ctx.isOp || isAllowed(store.config, ctx.authorHandle)) return;
    const handle = `@${ctx.authorHandle}`;
    if (suppressed.has(handle) || store.findAccount(handle) || pending.some(p => p.handle === handle)) return;
    const entry: AccountEntry = { handle, source: req.source, category: req.category.slice(0, 60), reason: req.reason.slice(0, 240), score: req.score ?? null, confidence: req.confidence ?? null, createdAt: Date.now() };
    tracked.set(ctx.tweetId, { handle, source: entry.source, createdAt: entry.createdAt });
    if (!pending.length) queueMicrotask(flush);
    pending.push(entry);
}

function onOutOfScope({ tweetId }: { tweetId: string }) {
    const t = tracked.get(tweetId);
    if (!t) return;
    tracked.delete(tweetId);
    const store = getConfigStore();
    const entry = store.findAccount(t.handle);
    if (!entry || entry.source !== t.source || entry.createdAt !== t.createdAt) return;
    rollingBack.add(t.handle);
    try { store.removeBlockedAccount(t.handle); } finally { rollingBack.delete(t.handle); }
}

export default definePlugin({
    name: "AutoBlacklist",
    description: N_("自动账号黑名单：词语、域名、正则命中或分类器高分时，把作者加入账号黑名单（本地自动）；AI 高置信恶意时加入（AI 自动）。"),
    icon: Icons.ban,
    tags: ["filters", "moderation"],
    enabledByDefault: true,
    dependencies: ["BlockerConfig", "ReplyFilter"],

    events: {
        replyHidden: onHidden,
        replyOutOfScope: onOutOfScope,
        filterRouteChanged() {
            tracked.clear();
            suppressed.clear();
        },
    },

    start() {
        unsub = getConfigStore().subscribe(({ config, previous }) => {
            const now = new Set(config.blacklists.accounts.map(a => a.handle));
            for (const a of previous.blacklists.accounts) {
                if (!now.has(a.handle) && !rollingBack.has(a.handle)) suppressed.add(a.handle);
            }
        });
    },

    stop() {
        unsub?.();
        unsub = null;
        pending = [];
    },
});

export function isSuppressed(handle: string): boolean {
    return suppressed.has(handle);
}
