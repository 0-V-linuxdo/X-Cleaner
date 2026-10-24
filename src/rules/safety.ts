/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { codePointLength, escapeRegexLiteral, normalizePhrase } from "@x/text";

import { FIELD_LABELS, isSafeSource, MAX_SOURCE, type RegexField, validateRegex } from "./regex";
import { probeRegex, probeRegexSync, type WorkerOutcome } from "./regex-runner";
import { type Draft, type DraftRule, type FieldValues, GENERIC_RULE_TERMS, isLazyExactCopy, unescapeLiteral } from "./synthesizer";

export type SafetyCode = "invalid-rule" | "overbroad-rule" | "lazy-exact-copy" | "target-not-matched" | "empty-match" | "canary-match" | "negative-match" | "protected-match" | "worker-error" | "worker-timeout" | "worker-unavailable";

export interface SafetyResult {
    valid: boolean;
    code: SafetyCode | null;
    message: string;
    targetMatch: boolean;
    canarySafe: boolean;
}

export const CANARIES: { label: string; field: RegexField; value: string }[] = [
    { label: "普通中文回复", field: "body", value: "谢谢分享，这个观点很有帮助。" },
    { label: "正常联络语境", field: "body", value: "如需补充资料可以私信我，我们继续讨论。" },
    { label: "正常福利语境", field: "body", value: "公司正在讨论员工福利和客户服务流程。" },
    { label: "诈骗曝光语境", field: "body", value: "这是关于加密货币诈骗的新闻报道，请勿连接陌生钱包。" },
    { label: "技术与客服讨论", field: "body", value: "我们正在讨论 Web3 安全和客服行业的技术问题。" },
    { label: "English scam warning", field: "body", value: "This is a report about a crypto scam. Do not connect your wallet." },
    { label: "普通显示名", field: "displayName", value: "张三" },
    { label: "正常客服显示名", field: "displayName", value: "产品客服研究" },
    { label: "安全研究显示名", field: "displayName", value: "Crypto Security Research" },
    { label: "普通账号", field: "handle", value: "alice_dev" },
    { label: "安全研究账号", field: "handle", value: "crypto_security" },
    { label: "正常支持账号", field: "handle", value: "customer_support_news" },
    { label: "普通 X 链接", field: "links", value: "https://x.com/openai/status/1234567890" },
    { label: "普通项目链接", field: "links", value: "https://github.com/example/project" },
    { label: "普通 Telegram 链接", field: "links", value: "https://t.me/legitimate_project" },
];

const CATCH_ALL = /^\^?(?:\.\*|\.\+|\[\\s\\S\]\*)\$?$/;
const TEMPLATE_SIGNAL = /比\[?她我你\]?好看的没|应该没人比|太涩.{0,12}(?:我福不黑|不信你看)|Claim\\s\*now|领取(?:礼物|空投|福利)|加\[?微v薇\]?|福利姬|裸聊|约炮|炮友|催情|春药|迷药|pump\\?\.fun/u;
const HIGH_SPECIFIC = /福利姬|裸聊|约炮|炮友|催情|春药|迷药|加(?:v|V|微).{0,6}(?:私密|可约)|0x\[?[a-fA-F0-9]\]?\{40\}|pump\\?\.fun/u;
const REGEX_SYNTAX = /[\\^$.*+?()[\]{}|]/;

export function lexicalUnits(source: string): string[] {
    const stripped = source.replace(/\\u\{[\da-f]+\}|\\u[\da-f]{4}|\\x[\da-f]{2}|\\[a-zA-Z]/giu, " ");
    return stripped.match(/\p{L}[\p{L}\p{N}_]*/gu) ?? [];
}

const allGeneric = (words: string[]) => words.length > 0 && words.every(w => GENERIC_RULE_TERMS.has(w.toLowerCase()));

function anchoredLiteral(source: string): string | null {
    if (!source.startsWith("^") || !source.endsWith("$") || source.length < 2) return null;
    return unescapeLiteral(source.slice(1, -1));
}

export function breadthCheck(rule: DraftRule): string | null {
    const { source, flags } = rule;
    const field = rule.fields[0];
    if (CATCH_ALL.test(source)) return "AI rule is a catch-all pattern.";
    const multiline = flags.includes("m");
    const anchored = anchoredLiteral(source);
    const handleExact = field === "handle" && anchored != null && !multiline && anchored.length > 0;
    const literalWords = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
    const anchoredExempt = anchored != null && !multiline && codePointLength(anchored) >= 3 && !allGeneric(literalWords(anchored));
    const plainLiteral = (field === "body" || field === "displayName") && !REGEX_SYNTAX.test(source) && codePointLength(source) >= 3 && codePointLength(source) <= 80 && /\p{Script=Han}/u.test(source) && !allGeneric(literalWords(source));
    const templateExempt = TEMPLATE_SIGNAL.test(source) || HIGH_SPECIFIC.test(source);
    const exempt = handleExact || anchoredExempt || plainLiteral || templateExempt;
    const units = lexicalUnits(source);
    if (!units.length && !exempt) return "AI rule must contain a durable literal signal.";
    if (!handleExact && (allGeneric(units) || (anchored != null && allGeneric(literalWords(anchored))))) return "AI rule uses only broad generic terms.";
    if ((field === "body" || field === "displayName") && units.length < 2 && !exempt) return "AI rule needs at least two durable literal signals for reply text or display names.";
    return null;
}

export interface SafetyInput {
    rule: DraftRule;
    target: FieldValues;
    negatives?: string[];
    protectedContexts?: FieldValues[];
    skipBreadth?: boolean;
    checkLazy?: boolean;
}

const MESSAGES: Record<SafetyCode, string> = {
    "invalid-rule": "规则结构无效。",
    "overbroad-rule": "规则范围过宽。",
    "lazy-exact-copy": "规则只是整条回复的精确拷贝，无法复用。",
    "target-not-matched": "规则没有命中当前回复。",
    "empty-match": "规则会命中空内容。",
    "canary-match": "规则命中了内置安全样本。",
    "negative-match": "规则命中了负例。",
    "protected-match": "规则命中了当前对话中受保护的内容。",
    "worker-error": "正则 Worker 返回了无效结果。",
    "worker-timeout": "规则执行超时，已按不安全处理。",
    "worker-unavailable": "正则 Worker 不可用，无法完成安全校验。",
};

const result = (code: SafetyCode | null, targetMatch: boolean, canarySafe: boolean, message?: string): SafetyResult => ({ valid: code == null, code, message: message ?? (code ? MESSAGES[code] : ""), targetMatch, canarySafe });

export async function checkCandidate(input: SafetyInput, probe: typeof probeRegex = probeRegex): Promise<SafetyResult> {
    const { rule } = input;
    const check = validateRegex(rule.source, rule.flags, rule.fields);
    if (!check.valid || rule.fields.length !== 1) return result("invalid-rule", false, false, check.error ?? "AI 规则必须且只能选择一个字段。");
    const field = rule.fields[0];
    if (!input.skipBreadth) {
        const broad = breadthCheck(rule);
        if (broad) return result("overbroad-rule", false, false, broad);
    }
    if (input.checkLazy && isLazyExactCopy(rule.source, input.target.body)) return result("lazy-exact-copy", false, false);
    const samples = [
        { key: "target", text: input.target[field] },
        { key: "empty", text: "" },
        ...CANARIES.filter(c => c.field === field).map((c, i) => ({ key: `canary:${i}`, text: c.value })),
        ...(input.negatives ?? []).slice(0, 16).map((n, i) => ({ key: `negative:${i}`, text: n })),
        ...(input.protectedContexts ?? []).slice(0, 50).map((p, i) => ({ key: `protected:${i}`, text: p[field] })).filter(s => s.text),
    ];
    let outcome: WorkerOutcome<string[]> = await probe(rule.source, rule.flags, samples);
    if (outcome.status === "unavailable" && isSafeSource(rule.source)) outcome = { status: "ok", value: probeRegexSync(rule.source, rule.flags, samples) };
    if (outcome.status === "timeout") return result("worker-timeout", false, false);
    if (outcome.status === "unavailable") return result("worker-unavailable", false, false);
    if (outcome.status === "error") return result("worker-error", false, false);
    const hit = new Set(outcome.value);
    const targetMatch = hit.has("target");
    const has = (prefix: string) => [...hit].some(k => k.startsWith(prefix));
    const canarySafe = !hit.has("empty") && !has("canary:") && !has("negative:") && !has("protected:");
    if (!targetMatch) return result("target-not-matched", false, canarySafe);
    if (hit.has("empty")) return result("empty-match", true, false);
    if (has("canary:")) {
        const idx = Number([...hit].find(k => k.startsWith("canary:"))!.split(":")[1]);
        const label = CANARIES.filter(c => c.field === field)[idx]?.label ?? "";
        return result("canary-match", true, false, `${MESSAGES["canary-match"]}（${label}）`);
    }
    if (has("negative:")) return result("negative-match", true, false);
    if (has("protected:")) return result("protected-match", true, false);
    return result(null, true, true);
}

const EXACT_NAMES: Record<"body" | "displayName" | "handle", string> = { body: "精确匹配回复正文", displayName: "精确匹配显示名", handle: "精确匹配账号 handle" };
const EXACT_LABEL: Record<"body" | "displayName" | "handle", string> = { body: "回复正文", displayName: "显示名", handle: "账号 handle" };

export function exactRule(values: FieldValues, field: "body" | "displayName" | "handle"): DraftRule | null {
    const value = values[field];
    if (!value) return null;
    const source = `^${escapeRegexLiteral(value)}$`;
    if (source.length > MAX_SOURCE) return null;
    return { name: EXACT_NAMES[field], source, flags: "iu", fields: [field] };
}

export function exactFallback(values: FieldValues, only?: "body" | "displayName" | "handle", reason?: string): Draft | null {
    const fields = only ? [only] : (["body", "displayName", "handle"] as const);
    for (const field of fields) {
        const rule = exactRule(values, field);
        if (!rule || !validateRegex(rule.source, rule.flags, rule.fields).valid || breadthCheck(rule)) continue;
        return { rule, reason: reason ?? `未找到可安全复用的模板；仅精确匹配当前${EXACT_LABEL[field]}，保存前仍需用户确认。`, confidence: null, origin: "exact-fallback" };
    }
    return null;
}

export interface SelectedPhrase {
    phrase: string;
    field: "body" | "displayName" | "handle";
}

const FIELD_TIE_ORDER = ["displayName", "handle", "body"] as const;

export function phraseRule(selected: SelectedPhrase[]): Draft | null {
    const phrases = [...new Set(selected.map(s => normalizePhrase(s.phrase)).filter(Boolean))];
    if (!phrases.length) return null;
    const counts = new Map<string, number>();
    for (const s of selected) counts.set(s.field, (counts.get(s.field) ?? 0) + 1);
    const max = Math.max(...counts.values());
    const field = FIELD_TIE_ORDER.find(f => counts.get(f) === max) ?? "body";
    const escaped = phrases.map(escapeRegexLiteral);
    return {
        rule: {
            name: phrases.length === 1 ? `划词：${phrases[0]}` : `划词：${phrases.length} 个词语`,
            source: escaped.length === 1 ? escaped[0] : `(?:${escaped.join("|")})`,
            flags: "iu",
            fields: [field],
        },
        reason: `根据勾选词语生成规则：${phrases.join("、")}`,
        confidence: 0.88,
        origin: "phrase-selection",
    };
}

export { FIELD_LABELS };
