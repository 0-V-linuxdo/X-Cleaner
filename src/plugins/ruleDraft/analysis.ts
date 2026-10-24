/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ParsedRuleResponse, RuleGenerationInput } from "@ai/rule-generator";
import { checkCandidate, exactFallback, phraseRule, type SafetyInput, type SafetyResult, type SelectedPhrase } from "@rules/safety";
import { type Draft, type DraftRule, type FieldValues, synthesizeLocalRule } from "@rules/synthesizer";
import { normalizePhrase } from "@x/text";

export type Checker = (input: SafetyInput) => Promise<SafetyResult>;

const SELECT_FIELD_LABELS: Record<SelectedPhrase["field"], string> = { body: "回复正文", displayName: "显示名", handle: "@handle" };
const LABEL_TO_FIELD: Record<string, SelectedPhrase["field"]> = { 回复正文: "body", 显示名: "displayName", "@handle": "handle" };

/** `请根据用户勾选的词语生成可复用规则，优先命中：词1、词2（显示名）` — body phrases carry no annotation. */
export function encodeSelection(selected: SelectedPhrase[]): string {
    const parts = selected.map(s => (s.field === "body" ? s.phrase : `${s.phrase}（${SELECT_FIELD_LABELS[s.field]}）`));
    return `请根据用户勾选的词语生成可复用规则，优先命中：${parts.join("、")}`;
}

export function parseSelection(feedback: string): SelectedPhrase[] {
    const at = feedback.indexOf("优先命中：");
    if (at < 0) return [];
    const out: SelectedPhrase[] = [];
    for (const raw of feedback.slice(at + "优先命中：".length).split("、")) {
        const m = /^(.*?)(?:（(回复正文|显示名|@handle)）)?$/su.exec(raw.trim());
        const phrase = normalizePhrase(m?.[1] ?? "");
        if (phrase) out.push({ phrase, field: m?.[2] ? LABEL_TO_FIELD[m[2]] : "body" });
    }
    return out;
}

/** §17.3: normalized like a phrase, ≤80 chars, has a letter/digit/Han char, and ≥2 chars unless it is a single Han char. */
export function selectionPhrase(raw: string): string | null {
    const phrase = normalizePhrase(raw);
    if (!phrase || [...phrase].length > 80) return null;
    if (!/[\p{L}\p{N}\p{Script=Han}]/u.test(phrase)) return null;
    if ([...phrase].length < 2 && !/^\p{Script=Han}$/u.test(phrase)) return null;
    return phrase;
}

export function ruleMatchesSelection(rule: DraftRule, selected: SelectedPhrase[]): boolean {
    const forced = selected.filter(s => s.field !== "body");
    if (!forced.length) return true;
    if (!forced.some(s => s.field === rule.fields[0])) return false;
    let re: RegExp;
    try { re = new RegExp(rule.source, rule.flags); } catch { return false; }
    return selected.filter(s => s.field === rule.fields[0]).every(s => re.test(s.phrase));
}

export interface AnalysisEnv {
    values: FieldValues;
    negatives: string[];
    protectedContexts: FieldValues[];
    /** Null when AI can be used; otherwise the reason it cannot. */
    aiUnavailable: string | null;
    runAi(input: RuleGenerationInput): Promise<ParsedRuleResponse>;
    /** True while the target reply is still mounted with the same content. */
    targetIntact(): boolean;
    check?: Checker;
}

export interface AnalysisResult {
    draft: Draft;
    /** Negative examples the AI suggested; they join the user's for later validation. */
    aiNegatives: string[];
}

/** §17.4 step 6: first exact field that validates; else the handle version; else the first generated one. */
export async function validatedExactFallback(env: AnalysisEnv, check: Checker): Promise<Draft | null> {
    const generated: Draft[] = [];
    for (const field of ["body", "displayName", "handle"] as const) {
        const draft = exactFallback(env.values, field);
        if (!draft) continue;
        generated.push(draft);
        const result = await check({ rule: draft.rule, target: env.values, negatives: env.negatives, protectedContexts: env.protectedContexts });
        if (result.valid) return draft;
    }
    return generated.find(d => d.rule.fields[0] === "handle") ?? generated[0] ?? null;
}

export async function analyze(feedback: string, env: AnalysisEnv): Promise<AnalysisResult> {
    const check = env.check ?? (input => checkCandidate(input));
    const selected = parseSelection(feedback);
    const phrase = phraseRule(selected);
    const phraseUsable = !!phrase && (await check({ rule: phrase.rule, target: env.values, negatives: env.negatives, protectedContexts: env.protectedContexts, skipBreadth: true })).valid;
    const forced = selected.some(s => s.field !== "body");

    const local = async (): Promise<Draft> => {
        // 「现状」fix: a usable phrase rule now wins whenever there is a selection, not only for name/handle phrases.
        if (phraseUsable && phrase) return phrase;
        const template = synthesizeLocalRule({ bodyText: env.values.body, displayName: env.values.displayName, authorHandle: env.values.handle, visibleUrls: env.values.links.split("\n").filter(Boolean) });
        if (template) return template;
        const exact = await validatedExactFallback(env, check);
        if (exact) return exact;
        throw new Error("当前回复没有可用于生成规则的稳定字段。");
    };

    if (env.aiUnavailable) return { draft: await local(), aiNegatives: [] };

    let response: ParsedRuleResponse;
    try {
        const template = synthesizeLocalRule({ bodyText: env.values.body, displayName: env.values.displayName, authorHandle: env.values.handle, visibleUrls: env.values.links.split("\n").filter(Boolean) });
        response = await env.runAi({
            values: env.values,
            suggested: phrase ?? template,
            exactFallback: exactFallback(env.values),
            feedback,
            selected,
            negatives: env.negatives,
            mentions: [...new Set(env.values.body.match(/@\w{1,15}/g) ?? [])],
        });
    } catch (e) {
        if (e instanceof AnalysisAbort) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        const draft = await local();
        return { draft: { ...draft, reason: `AI 分析暂未完成（${msg}）；已生成本地可复用规则，仍需你确认保存。` }, aiNegatives: [] };
    }
    if (!env.targetIntact()) throw new AnalysisAbort("AI 返回前回复内容或页面已变化，结果已丢弃。");

    if (response.decision !== "rule" || !response.rule) return { draft: await local(), aiNegatives: response.negatives };
    const rule = response.rule;
    const verdict = await check({ rule, target: env.values, negatives: [...env.negatives, ...response.negatives].slice(0, 16), protectedContexts: env.protectedContexts, checkLazy: true });
    if (!verdict.valid) return { draft: await local(), aiNegatives: response.negatives };
    if (forced && phraseUsable && phrase && !ruleMatchesSelection(rule, selected)) return { draft: phrase, aiNegatives: response.negatives };
    return { draft: { rule, reason: response.reason, confidence: response.confidence, origin: "ai" }, aiNegatives: response.negatives };
}

/** An analysis outcome that must be shown as-is instead of falling back to a local draft. */
export class AnalysisAbort extends Error {}
