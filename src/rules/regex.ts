/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { N_, t } from "@utils/i18n";

export type RegexField = "body" | "displayName" | "handle" | "links";
export const REGEX_FIELDS: readonly RegexField[] = ["body", "displayName", "handle", "links"];
/** Getters, so each read is in the current UI language. */
export const FIELD_LABELS: Record<RegexField, string> = {
    get body() { return t("回复正文"); },
    get displayName() { return t("显示名"); },
    handle: "@handle",
    get links() { return t("链接"); },
};

export const MAX_SOURCE = 200;
export const MAX_FIELD_TEXT = 4000;
export const MAX_REGEX_RULES = 200;
export const TIMEOUT_MESSAGE = N_("正则执行超过 30ms，已自动禁用。");

export type RegexErrorCode = "empty-source" | "source-too-long" | "stateful-flags" | "invalid-flags" | "missing-fields" | "invalid-fields" | "invalid-expression" | "timeout";

export interface RegexRule {
    id: string;
    name: string;
    source: string;
    flags: string;
    enabled: boolean;
    valid: boolean;
    fields: RegexField[];
    error: string | null;
    errorCode: RegexErrorCode | null;
}

export interface RegexValidation {
    valid: boolean;
    error: string | null;
    errorCode: RegexErrorCode | null;
}

const FIELD_ALIASES: Record<string, RegexField> = {
    body: "body", bodytext: "body", text: "body",
    displayname: "displayName", name: "displayName",
    handle: "handle", authorhandle: "handle",
    links: "links", visibleurls: "links", urls: "links",
};

export function canonicalField(raw: unknown): RegexField | null {
    return typeof raw === "string" ? FIELD_ALIASES[raw.trim().toLowerCase()] ?? null : null;
}

export function orderFlags(flags: string): string {
    return "imsu".split("").filter(f => flags.includes(f)).join("");
}

export function validateRegex(source: string, flags: string, fields: readonly string[]): RegexValidation {
    const fail = (errorCode: RegexErrorCode, error: string): RegexValidation => ({ valid: false, error, errorCode });
    if (!source) return fail("empty-source", t("正则表达式不能为空。"));
    if (source.length > MAX_SOURCE) return fail("source-too-long", t("正则表达式不能超过 200 个字符。"));
    if (/[gy]/.test(flags)) return fail("stateful-flags", t("不支持有状态的 g 或 y flags。"));
    const badFlags = [...new Set(flags.replace(/[imsu]/g, ""))].join("");
    if (badFlags) return fail("invalid-flags", t("不支持的 flags：{badFlags}", { badFlags }));
    if (!fields.length) return fail("missing-fields", t("请至少选择一个匹配字段。"));
    const badField = fields.find(f => !REGEX_FIELDS.includes(f as RegexField));
    if (badField) return fail("invalid-fields", t("不支持的字段：{badField}", { badField }));
    try { new RegExp(source, flags); } catch (e) { return fail("invalid-expression", e instanceof Error ? e.message : String(e)); }
    return { valid: true, error: null, errorCode: null };
}

function rawFields(raw: Record<string, unknown>): string[] {
    const list = Array.isArray(raw.fields) ? raw.fields : raw.field != null ? [raw.field] : [];
    const out: string[] = [];
    for (const item of list) {
        const field = canonicalField(item);
        const value = field ?? String(item);
        if (!out.includes(value)) out.push(value);
    }
    return out;
}

export function normalizeRegexRule(input: unknown, index: number): RegexRule {
    const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const sourceRaw = [raw.source, raw.expression, raw.pattern].find(v => typeof v === "string") as string | undefined;
    const source = (sourceRaw ?? "").slice(0, MAX_SOURCE + 1);
    const flagsRaw = typeof raw.flags === "string" ? raw.flags : "";
    const fields = rawFields(raw);
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 120) : `regex-${index + 1}`;
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 100) : t("正则规则 {n}", { n: index + 1 });
    const check = validateRegex(source, flagsRaw, fields);
    const rule: RegexRule = {
        id,
        name,
        source,
        flags: check.valid ? orderFlags(flagsRaw) : flagsRaw.slice(0, 8),
        enabled: raw.enabled !== false,
        valid: check.valid,
        fields: fields.filter((f): f is RegexField => REGEX_FIELDS.includes(f as RegexField)),
        error: check.error,
        errorCode: check.errorCode,
    };
    if (rule.valid && raw.valid === false && typeof raw.errorCode === "string" && raw.errorCode !== "timeout") {
        rule.valid = false;
        rule.errorCode = raw.errorCode as RegexErrorCode;
        rule.error = typeof raw.error === "string" ? raw.error : t("规则无效。");
    }
    if (!rule.valid) rule.enabled = false;
    if (rule.valid && raw.enabled === false && raw.errorCode === "timeout") {
        rule.enabled = false;
        rule.errorCode = "timeout";
        rule.error = TIMEOUT_MESSAGE;
    }
    return rule;
}

export function normalizeRegexRules(list: unknown, max = MAX_REGEX_RULES): RegexRule[] {
    if (!Array.isArray(list)) return [];
    const out: RegexRule[] = [];
    for (const [i, item] of list.slice(0, max).entries()) {
        const rule = normalizeRegexRule(item, i);
        let id = rule.id;
        for (let k = 2; out.some(r => r.id === id); k++) id = `${rule.id}-${k}`;
        out.push({ ...rule, id });
    }
    return out;
}

export function isSafeSource(source: string): boolean {
    if (!source || source.length > MAX_SOURCE) return false;
    if (/\\[1-9]/.test(source)) return false;
    if (/\{\d+,\}/.test(source)) return false;
    const rest = source
        .replace(/\\[sSdDwW][*+?]/g, "")
        .replace(/\\[sSdDwW]\{\d+(?:,\d+)?\}/g, "")
        .replace(/\{\d+(?:,\d+)?\}/g, "");
    return !/[+*]/.test(rest);
}

export interface RegexContext {
    body: string;
    displayName: string;
    handle: string;
    links: string;
}

export function regexContextOf(ctx: { bodyText?: string; displayName?: string; authorHandle?: string; visibleUrls?: string[] }): RegexContext {
    const cut = (s: string) => s.slice(0, MAX_FIELD_TEXT);
    return {
        body: cut(ctx.bodyText ?? ""),
        displayName: cut(ctx.displayName ?? ""),
        handle: cut((ctx.authorHandle ?? "").replace(/^@/, "")),
        links: cut((ctx.visibleUrls ?? []).join("\n")),
    };
}

export interface RegexMatch {
    ruleId: string;
    name: string;
    field: RegexField;
    preview: string;
    matchedText: string;
    index: number;
}

export interface RegexResult {
    ruleId: string;
    ruleName: string;
    field: RegexField;
    preview: string;
    matches: RegexMatch[];
}

type RunnableRule = Pick<RegexRule, "id" | "name" | "source" | "flags" | "fields">;

export function runRulesSync(rules: readonly RunnableRule[], context: RegexContext): RegexMatch[] {
    const matches: RegexMatch[] = [];
    for (const rule of rules) {
        let re: RegExp;
        try { re = new RegExp(rule.source, rule.flags); } catch { continue; }
        for (const field of rule.fields) {
            const text = context[field] ?? "";
            re.lastIndex = 0;
            const m = re.exec(text);
            if (!m) continue;
            matches.push({ ruleId: rule.id, name: rule.name, field, preview: text.slice(0, 160), matchedText: m[0].slice(0, 160), index: m.index });
            break;
        }
    }
    return matches;
}

export function toResult(matches: RegexMatch[]): RegexResult | null {
    const first = matches[0];
    return first ? { ruleId: first.ruleId, ruleName: first.name, field: first.field, preview: first.preview, matches } : null;
}

export const activeRules = (rules: readonly RegexRule[]) => rules.filter(r => r.enabled && r.valid);

export function newRegexId(prefix = "regex", randomLen = 5): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 2 + randomLen).padEnd(randomLen, "0")}`;
}
