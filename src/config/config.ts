/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { normalizeDomain } from "@rules/domains";
import { normalizeRegexRules, type RegexRule } from "@rules/regex";
import { collapseWhitespace, normalizeHandle, normalizePhrase, toConfigHandle } from "@x/text";

export type Sensitivity = "conservative" | "balanced" | "aggressive";
export type AccountSource = "manual" | "local-auto" | "ai-auto";

export interface AccountEntry {
    handle: string;
    source: AccountSource;
    category: string;
    reason: string;
    score: number | null;
    confidence: number | null;
    createdAt: number;
}

export interface AiConfig {
    enabled: boolean;
    consented: boolean;
    endpoint: string;
    model: string;
    maxReviewsPerConversation: number;
    concurrency: number;
    timeoutMs: number;
}

export interface BlockerConfig {
    version: 1;
    enabled: boolean;
    autoBlacklistAccounts: boolean;
    scope: "status-replies";
    displayMode: "hide";
    sensitivity: Sensitivity;
    categories: { adult: boolean; crypto: boolean; promotionalName: boolean };
    protections: { self: boolean; op: boolean };
    allowHandles: string[];
    blacklists: { accounts: AccountEntry[]; phrases: string[]; domains: string[]; regexRules: RegexRule[] };
    ai: AiConfig;
    debug: boolean;
}

export const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
export const DEFAULT_MODEL = "gpt-4o-mini";

export const LIMITS = { allowHandles: 500, accounts: 2000, phrases: 500, domains: 500, regexRules: 200 } as const;

export const SENSITIVITY_THRESHOLDS: Record<Sensitivity, number> = { conservative: 10, balanced: 8, aggressive: 6 };

export function defaultConfig(): BlockerConfig {
    return {
        version: 1,
        enabled: true,
        autoBlacklistAccounts: true,
        scope: "status-replies",
        displayMode: "hide",
        sensitivity: "balanced",
        categories: { adult: true, crypto: true, promotionalName: true },
        protections: { self: true, op: true },
        allowHandles: [],
        blacklists: { accounts: [], phrases: [], domains: [], regexRules: [] },
        ai: { enabled: false, consented: false, endpoint: DEFAULT_ENDPOINT, model: DEFAULT_MODEL, maxReviewsPerConversation: 20, concurrency: 2, timeoutMs: 20000 },
        debug: false,
    };
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {});
const notFalse = (v: unknown) => v !== false;
const isTrue = (v: unknown) => v === true;

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

function uniq<T>(list: T[], key: (v: T) => string = String): T[] {
    const seen = new Set<string>();
    return list.filter(v => {
        const k = key(v);
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

export function normalizeHandleList(list: unknown, max: number): string[] {
    return uniq((Array.isArray(list) ? list : []).map(toConfigHandle)).slice(0, max);
}

const SOURCES: AccountSource[] = ["manual", "local-auto", "ai-auto"];

export function normalizeAccountEntry(raw: unknown, now = Date.now()): AccountEntry | null {
    const o = typeof raw === "string" ? { handle: raw } : obj(raw);
    const handle = toConfigHandle(o.handle);
    if (!handle) return null;
    const source = SOURCES.includes(o.source) ? o.source as AccountSource : "manual";
    const score = typeof o.score === "number" && Number.isFinite(o.score) ? o.score : null;
    const confidence = typeof o.confidence === "number" && Number.isFinite(o.confidence) ? Math.min(1, Math.max(0, o.confidence)) : null;
    const createdAt = typeof o.createdAt === "number" && Number.isFinite(o.createdAt) ? o.createdAt : now;
    return {
        handle,
        source,
        category: typeof o.category === "string" ? o.category.trim().slice(0, 60) : "",
        reason: typeof o.reason === "string" ? collapseWhitespace(o.reason).slice(0, 240) : "",
        score,
        confidence,
        createdAt,
    };
}

export function normalizeAccounts(list: unknown, now = Date.now()): AccountEntry[] {
    const out: AccountEntry[] = [];
    const index = new Map<string, number>();
    for (const raw of Array.isArray(list) ? list : []) {
        const entry = normalizeAccountEntry(raw, now);
        if (!entry) continue;
        const at = index.get(entry.handle);
        if (at === undefined) {
            index.set(entry.handle, out.length);
            out.push(entry);
        } else if (entry.source === "manual" && out[at].source !== "manual") {
            out[at] = entry;
        }
    }
    return out.slice(0, LIMITS.accounts);
}

function normalizeString(v: unknown, max: number, fallback: string): string {
    const s = typeof v === "string" ? v.trim().slice(0, max) : "";
    return s || fallback;
}

export function normalizeConfig(input: unknown, now = Date.now()): BlockerConfig {
    const o = obj(input);
    const cat = obj(o.categories);
    const prot = obj(o.protections);
    const bl = obj(o.blacklists);
    const ai = obj(o.ai);
    const sensitivity: Sensitivity = ["conservative", "balanced", "aggressive"].includes(o.sensitivity) ? o.sensitivity : "balanced";
    return {
        version: 1,
        enabled: notFalse(o.enabled),
        autoBlacklistAccounts: notFalse(o.autoBlacklistAccounts),
        scope: "status-replies",
        displayMode: "hide",
        sensitivity,
        categories: { adult: notFalse(cat.adult), crypto: notFalse(cat.crypto), promotionalName: notFalse(cat.promotionalName) },
        protections: { self: notFalse(prot.self), op: notFalse(prot.op) },
        allowHandles: normalizeHandleList(o.allowHandles, LIMITS.allowHandles),
        blacklists: {
            accounts: normalizeAccounts(bl.accounts, now),
            phrases: uniq((Array.isArray(bl.phrases) ? bl.phrases : []).map(normalizePhrase)).slice(0, LIMITS.phrases),
            domains: uniq((Array.isArray(bl.domains) ? bl.domains : []).map(normalizeDomain)).slice(0, LIMITS.domains),
            regexRules: normalizeRegexRules(bl.regexRules, LIMITS.regexRules),
        },
        ai: {
            enabled: isTrue(ai.enabled),
            consented: isTrue(ai.consented),
            endpoint: normalizeString(ai.endpoint, 500, DEFAULT_ENDPOINT),
            model: normalizeString(ai.model, 120, DEFAULT_MODEL),
            maxReviewsPerConversation: clampInt(ai.maxReviewsPerConversation, 1, 100, 20),
            concurrency: clampInt(ai.concurrency, 1, 4, 2),
            timeoutMs: clampInt(ai.timeoutMs, 5000, 60000, 20000),
        },
        debug: isTrue(o.debug),
    };
}

const AUTO_SOURCE_ALIASES: Record<string, AccountSource> = { local: "local-auto", "local-auto": "local-auto", ai: "ai-auto", "ai-auto": "ai-auto", automatic: "local-auto" };

function legacyEntries(list: unknown, forced: "manual" | "auto" | null): unknown[] {
    if (!Array.isArray(list)) return [];
    return list.flatMap(item => {
        const o = typeof item === "string" ? { handle: item } : obj(item);
        if (o.enabled === false) return [];
        const alias = AUTO_SOURCE_ALIASES[String(o.source ?? "")];
        const source = forced === "manual" ? "manual" : alias ?? (forced === "auto" ? "local-auto" : "manual");
        return [{ ...o, source }];
    });
}

export function applyLegacyAliases(input: Record<string, any>): Record<string, any> {
    const o = { ...input };
    const bl = { ...obj(o.blacklists) };
    const allow = [o.allowHandles, o.allowlist, o.whitelist].find(Array.isArray);
    if (allow) o.allowHandles = allow.filter((v: unknown) => obj(v).enabled !== false).map((v: unknown) => (typeof v === "string" ? v : obj(v).handle));
    const accountsSrc = Array.isArray(bl.accounts) ? bl.accounts : Array.isArray(o.accounts) ? o.accounts : [];
    const manual = [
        ...[o.manualHandles, o.handles, o.manualBlacklist, o.accountBlacklist, bl.manualHandles, bl.handles].flatMap(l => legacyEntries(l, "manual")),
        ...legacyEntries(accountsSrc, null),
    ];
    const auto = [o.autoHandles, o.autoBlacklist, o.automaticAccounts, bl.autoHandles].flatMap(l => legacyEntries(l, "auto"));
    bl.accounts = [...manual, ...auto];
    for (const key of ["phrases", "domains", "regexRules"]) if (!Array.isArray(bl[key]) && Array.isArray(o[key])) bl[key] = o[key];
    o.blacklists = bl;
    return o;
}

export function prepareImport(input: unknown): BlockerConfig {
    const copy = structuredClone(obj(input));
    delete copy.apiKey;
    delete copy.secrets;
    const ai = obj(copy.ai);
    delete ai.apiKey;
    copy.ai = { ...ai, enabled: false, consented: false };
    return normalizeConfig(applyLegacyAliases(copy));
}

export function exportConfigJson(config: BlockerConfig): string {
    return JSON.stringify(normalizeConfig(config), null, 2);
}

export function isAutoSource(source: AccountSource) {
    return source === "local-auto" || source === "ai-auto";
}

export { normalizeHandle };
