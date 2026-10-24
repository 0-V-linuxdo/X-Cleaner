/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { KeyValueBackend } from "@config/backend";

export const STATS_KEY = "xReplyBlockerRuleStatsV1";
const MAX_SEEN = 4000;
const MAX_COUNT = 1_000_000;

export interface StatEntry {
    count: number;
    lastHitAt: number;
}

interface StatsData {
    entries: Record<string, StatEntry>;
    seen: string[];
}

export function normalizeStats(raw: unknown): StatsData {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
    const entries: Record<string, StatEntry> = {};
    for (const [key, v] of Object.entries(o.entries && typeof o.entries === "object" ? o.entries : {})) {
        const e = v as Record<string, unknown>;
        if (!/^(?:phrase|domain|regex|account):.+/.test(key)) continue;
        if (typeof e?.count !== "number" || !Number.isFinite(e.count) || e.count <= 0) continue;
        entries[key] = { count: Math.min(MAX_COUNT, Math.floor(e.count)), lastHitAt: typeof e.lastHitAt === "number" ? e.lastHitAt : 0 };
    }
    const seen = Array.isArray(o.seen) ? o.seen.filter((s: unknown) => typeof s === "string").slice(-MAX_SEEN) : [];
    return { entries, seen };
}

export class RuleStatsStore {
    private data: StatsData;
    private seenSet: Set<string>;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private listeners = new Set<() => void>();
    private off: (() => void) | null = null;

    constructor(private backend: KeyValueBackend) {
        this.data = normalizeStats(backend.read(STATS_KEY));
        this.seenSet = new Set(this.data.seen);
        this.off = backend.listen?.(STATS_KEY, (value, remote) => {
            if (!remote) return;
            this.data = normalizeStats(value);
            this.seenSet = new Set(this.data.seen);
            this.notify();
        }) ?? null;
    }

    dispose() {
        this.off?.();
        this.flush();
    }

    subscribe(l: () => void) {
        this.listeners.add(l);
        return () => this.listeners.delete(l);
    }

    private notify() {
        for (const l of this.listeners) l();
    }

    record(tweetId: string, key: string, now = Date.now()): boolean {
        const id = `${tweetId}|${key}`;
        if (this.seenSet.has(id)) return false;
        this.seenSet.add(id);
        this.data.seen.push(id);
        while (this.data.seen.length > MAX_SEEN) this.seenSet.delete(this.data.seen.shift()!);
        const entry = this.data.entries[key] ?? { count: 0, lastHitAt: 0 };
        this.data.entries[key] = { count: Math.min(MAX_COUNT, entry.count + 1), lastHitAt: now };
        this.scheduleSave();
        this.notify();
        return true;
    }

    count(key: string): number {
        return this.data.entries[key]?.count ?? 0;
    }

    total(keys: string[]): number {
        return keys.reduce((n, k) => n + this.count(k), 0);
    }

    clear() {
        this.data = { entries: {}, seen: [] };
        this.seenSet.clear();
        this.flush();
        this.notify();
    }

    private scheduleSave() {
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(() => this.flush(), 500);
    }

    flush() {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = null;
        this.backend.write(STATS_KEY, JSON.stringify(this.data));
    }
}
