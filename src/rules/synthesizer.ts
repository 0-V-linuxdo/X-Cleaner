/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { N_, t } from "@utils/i18n";
import { codePointLength, countHan, escapeRegexLiteral, sanitizeField } from "@x/text";

import type { RegexField } from "./regex";

export interface DraftRule {
    name: string;
    source: string;
    flags: string;
    fields: RegexField[];
}

export interface Draft {
    rule: DraftRule;
    reason: string;
    confidence: number | null;
    origin: "local-template" | "exact-fallback" | "phrase-selection" | "ai";
    templateId?: string;
}

export interface FieldValues {
    body: string;
    displayName: string;
    handle: string;
    links: string;
}

export function fieldValues(ctx: { bodyText?: string; displayName?: string; authorHandle?: string; visibleUrls?: string[] }): FieldValues {
    return {
        body: sanitizeField(ctx.bodyText ?? ""),
        displayName: sanitizeField(ctx.displayName ?? ""),
        handle: sanitizeField((ctx.authorHandle ?? "").replace(/^@/, "")),
        links: (ctx.visibleUrls ?? []).map(sanitizeField).filter(Boolean).join("\n"),
    };
}

const R = (s: string) => new RegExp(s, "iu");

interface BodyTemplate {
    id: string;
    name: string;
    trigger: RegExp;
    sources: string[];
    confidence: number;
    reason: string;
}

export const BODY_TEMPLATES: BodyTemplate[] = [
    { id: "adult-looks-vs-slut", name: N_("颜值骚对比引流"), trigger: R("比[她我你].{0,2}好看的没[她我你].{0,2}骚|比[她我你].{0,2}骚的没[她我你].{0,2}好看"), sources: ["比[她我你]好看的没[她我你]骚|比[她我你]骚的没[她我你]好看"], confidence: 0.93, reason: N_("复用常见黄推对比口号，任一半句即可命中；代词、@账号、表情和尾号可变。") },
    { id: "adult-play-open", name: N_("玩得开引流模板"), trigger: R("应该没人比[我她你]玩的开了吧"), sources: ["应该没人比[我她你]玩的开了吧.{0,48}(?:我福不黑|不信你看)", "应该没人比[我她你]玩的开了吧"], confidence: 0.91, reason: N_("复用「玩的开」黄推开场白，代词和结尾话术可变。") },
    { id: "adult-too-spicy", name: N_("太涩引流模板"), trigger: R("太涩.{0,36}(?:我福不黑|不信你看)"), sources: ["太涩.{0,36}(?:我福不黑|不信你看)"], confidence: 0.9, reason: N_("复用「太涩…不信你看」黄推话术，中间内容可变。") },
    { id: "adult-contact-funnel", name: N_("加微约炮引流"), trigger: R("(?:加[微v薇]|微信|私信).{0,10}(?:看片|私密|裸照|福利|约炮|可约|看主页)"), sources: ["(?:加[微v薇]|微信|私信).{0,8}(?:看片|私密|裸照|福利|约炮|可约|看主页)"], confidence: 0.9, reason: N_("命中「加微 / 私信 + 成人内容」的引流组合，联系方式本身可变。") },
    { id: "adult-local-hookup", name: N_("同城约炮引流"), trigger: R("(?:同城|附近).{0,8}(?:约炮|裸聊|上门|空降|可约)"), sources: ["(?:同城|附近).{0,8}(?:约炮|裸聊|上门|空降|可约)"], confidence: 0.89, reason: N_("命中「同城 / 附近 + 约炮服务」组合，地名和措辞可变。") },
    { id: "adult-explicit-service", name: N_("成人服务话术"), trigger: R("裸聊|福利姬|约炮|炮友|援交|陪睡"), sources: ["(?:裸聊|福利姬|约炮|炮友|援交|陪睡)"], confidence: 0.86, reason: N_("命中高特异的成人服务词，正常讨论很少使用。") },
    { id: "crypto-claim", name: N_("领取空投导流"), trigger: R("claim\\s*now|领取(?:礼物|空投|福利)|马上领取|点击领取"), sources: ["(?:Claim\\s*now|领取(?:礼物|空投|福利)|马上领取|点击领取)"], confidence: 0.9, reason: N_("命中「领取空投 / Claim now」导流话术。") },
    { id: "crypto-airdrop-funnel", name: N_("免费空投导流"), trigger: R("(?:免费|官方|独家|限时).{0,8}(?:空投|airdrop)|(?:空投|airdrop).{0,8}(?:领取|claim|开放|马上|免费)"), sources: ["(?:(?:免费|官方|独家|限时).{0,8}(?:空投|airdrop)|(?:空投|airdrop).{0,8}(?:领取|claim))"], confidence: 0.88, reason: N_("命中「免费 / 官方空投 + 领取」组合，币种和链接可变。") },
    { id: "crypto-presale", name: N_("预售带单导流"), trigger: R("(?:预售|presale).{0,8}(?:开启|开始|live|now)|百倍币|千倍币|财富密码|稳赚带单|币圈带单"), sources: ["(?:(?:预售|presale).{0,8}(?:开启|开始|live|now)|百倍币|千倍币|财富密码|稳赚带单)"], confidence: 0.87, reason: N_("命中预售开启、百倍币、带单等币圈推广话术。") },
];

const NAME_COMPOUND = "(?:福利姬|裸聊|约炮|空投客服|币圈带单|加[微v薇].{0,6}(?:私密|裸聊|福利)|催情|春药|迷药)";
const NAME_TOKENS = ["福利姬", "春药", "迷药", "催情", "听话", "男用", "女用", "裸聊", "约炮", "炮友", "上门", "空降", "同城", "私密", "看片"];
const STANDALONE_TOKENS = new Set(["催情", "春药", "迷药", "福利姬", "裸聊", "约炮", "炮友"]);
const PROMO_DOMAIN_SOURCE = "(?:onlyfans\\.com|fansly\\.com|pump\\.fun|dexscreener\\.com)";

export const WEAK_WORDS = new Set(["谢谢", "感谢", "同意", "哈哈", "呵呵", "你好", "嗯嗯", "好的", "加油", "thanks", "thankyou", "ok", "okay", "lol", "lmao", "yes", "no", "hi", "hello"]);
export const GENERIC_RULE_TERMS = new Set(["promotion", "promotional", "support", "crypto", "web3", "coin", "token", "airdrop", "claim", "presale", "telegram", "discord", "whatsapp", "wechat", "line", "join", "contact", "message", "group", "channel", "dm", "tg", "推广", "客服", "币圈", "加密", "空投", "预售", "私信", "电报", "群", "频道", "联系"]);

const URL_RE = /(?:https?:\/\/|www\.)\S+|(?:t\.co|x\.com|twitter\.com)\/\S*/giu;
const MENTION_RE = /[@＠﹫][\p{L}\p{N}_]+/gu;
const BARE_DOMAIN_RE = /\b(?:[\p{L}\p{N}-]+\.)+[a-z]{2,}(?:\/\S*)?/giu;
const EMOJI_RE = /(?:\p{Extended_Pictographic}|️|‍|⃣|[♀♂]|[\u{1F3FB}-\u{1F3FF}])+/gu;
const ZERO_WIDTH_RE = /[​-‏⁠﻿]/gu;
const LONE_NUMBER_RE = /(?<![\p{L}\p{N}])\d{1,4}(?![\p{L}\p{N}])/gu;
const SYMBOL_RE = /[^\p{L}\p{N}\s.+-]/gu;
const SEP = "\u0000";

export function denoiseSegments(text: string): string[] {
    return text
        .replace(URL_RE, SEP).replace(MENTION_RE, SEP).replace(BARE_DOMAIN_RE, SEP)
        .replace(EMOJI_RE, SEP).replace(ZERO_WIDTH_RE, "").replace(LONE_NUMBER_RE, SEP).replace(SYMBOL_RE, SEP)
        .split(SEP).map(s => s.replace(/\s+/gu, " ").trim()).filter(Boolean);
}

export function denoise(text: string): string {
    return denoiseSegments(text).join(" ");
}

const VARIABLE_RES = [/(?:https?:\/\/|www\.)\S+|(?:t\.co|x\.com|twitter\.com)\/\S*/iu, /[@＠﹫][\p{L}\p{N}_]+/u, /\p{Extended_Pictographic}/u, /\d+\s*$/u];

export function hasVariableParts(text: string): boolean {
    return VARIABLE_RES.some(r => r.test(text));
}

const isGenericOnly = (text: string) => {
    const words = text.toLowerCase().split(/[\s.+-]+/u).filter(Boolean);
    return words.length > 0 && words.every(w => GENERIC_RULE_TERMS.has(w));
};

export function isDistinctiveCore(core: string): boolean {
    const len = codePointLength(core);
    if (!core || len > 80) return false;
    const lower = core.toLowerCase();
    if (WEAK_WORDS.has(lower.replace(/\s+/g, "")) || isGenericOnly(lower)) return false;
    const han = countHan(core);
    const letters = core.match(/[a-z]/giu)?.length ?? 0;
    if (han >= 6) return true;
    if (han >= 2 && letters >= 3 && len >= 3) return true;
    const words = core.match(/[a-z]{3,}/giu) ?? [];
    return words.length >= 2 && words.some(w => !GENERIC_RULE_TERMS.has(w.toLowerCase())) && len >= 8;
}

interface Candidate extends Draft {
    score: number;
}

const matches = (source: string, value: string) => {
    try { return new RegExp(source, "iu").test(value); } catch { return false; }
};

function bodyCandidates(body: string): Candidate[] {
    const out: Candidate[] = [];
    if (!body) return out;
    for (const tpl of BODY_TEMPLATES) {
        if (!tpl.trigger.test(body)) continue;
        const source = tpl.sources.find(s => matches(s, body));
        if (!source) continue;
        out.push({ rule: { name: t(tpl.name), source, flags: "iu", fields: ["body"] }, reason: t(tpl.reason), confidence: tpl.confidence, origin: "local-template", templateId: tpl.id, score: 100 + Math.round(tpl.confidence * 10) });
    }
    for (const core of denoiseSegments(body)) {
        if (!isDistinctiveCore(core)) continue;
        const source = escapeRegexLiteral(core);
        if (source.length > 200 || !matches(source, body)) continue;
        const han = countHan(core);
        out.push({
            rule: { name: han >= 6 ? t("可复用口号") : t("可复用短语"), source, flags: "iu", fields: ["body"] },
            reason: t("提取回复中稳定的口号，去掉 @账号、链接、表情和数字等可变部分。"),
            confidence: han >= 8 ? 0.88 : 0.8,
            origin: "local-template",
            templateId: "stable-core",
            score: 70 + Math.min(20, han + Math.min(codePointLength(core), 12)),
        });
    }
    return out;
}

export function displayNameTokens(name: string): string[] {
    const han = denoise(name).replace(/[a-z]{3,}\d{3,}|\d{3,}[a-z]{3,}/giu, "").replace(/[^\p{Script=Han}]/gu, "");
    const tokens: string[] = [];
    const sorted = [...NAME_TOKENS].sort((a, b) => b.length - a.length);
    for (let i = 0; i < han.length;) {
        const hit = sorted.find(t => han.startsWith(t, i));
        if (hit) { tokens.push(hit); i += hit.length; } else i++;
    }
    return tokens;
}

function nameCandidates(name: string): Candidate[] {
    const out: Candidate[] = [];
    if (!name) return out;
    if (matches(NAME_COMPOUND, name)) out.push({ rule: { name: t("推广显示名"), source: NAME_COMPOUND, flags: "iu", fields: ["displayName"] }, reason: t("显示名含成人或币圈推广的复合词。"), confidence: 0.84, origin: "local-template", templateId: "name-adult-compound", score: 108 });
    const tokens = displayNameTokens(name);
    if (tokens.length >= 2 || (tokens.length === 1 && STANDALONE_TOKENS.has(tokens[0]))) {
        const source = tokens.slice(0, 4).map(escapeRegexLiteral).join(".{0,12}");
        if (matches(source, name)) out.push({ rule: { name: t("{tokens}引流", { tokens: tokens.slice(0, 3).join("") }), source, flags: "iu", fields: ["displayName"] }, reason: t("按显示名中的引流词组合生成，词之间允许夹杂表情和符号。"), confidence: tokens.length >= 2 ? 0.88 : 0.84, origin: "local-template", templateId: "display-name-tokens", score: 115 + tokens.length });
    }
    return out;
}

function linkCandidates(links: string): Candidate[] {
    return links && matches(PROMO_DOMAIN_SOURCE, links)
        ? [{ rule: { name: t("推广域名"), source: PROMO_DOMAIN_SOURCE, flags: "iu", fields: ["links"] }, reason: t("链接指向常见成人或币圈推广域名。"), confidence: 0.85, origin: "local-template", templateId: "promo-domain", score: 109 }]
        : [];
}

const NORMALIZE_RE = /[​-‏⁠﻿]/gu;
const normalizeForCompare = (s: string) => s.normalize("NFKC").replace(NORMALIZE_RE, "").replace(/\s+/gu, " ").trim().toLowerCase();
const LITERAL_ONLY = /^(?:\\[\^$\\.*+?()[\]{}|/]|[^\\^$.*+?()[\]{}|/])*$/u;

export function unescapeLiteral(source: string): string | null {
    if (!LITERAL_ONLY.test(source)) return null;
    return source.replace(/\\(.)/gu, "$1");
}

export function isLazyExactCopy(source: string, body: string): boolean {
    if (!source.startsWith("^") || !source.endsWith("$")) return false;
    const literal = unescapeLiteral(source.slice(1, -1));
    if (literal == null || !body) return false;
    if (normalizeForCompare(literal) !== normalizeForCompare(body)) return false;
    return hasVariableParts(body) || normalizeForCompare(denoise(body)) !== normalizeForCompare(body) || BODY_TEMPLATES.some(t => t.trigger.test(body)) || codePointLength(body) > 24;
}

export function synthesizeLocalRule(ctx: Parameters<typeof fieldValues>[0]): Draft | null {
    const values = fieldValues(ctx);
    const all = [...bodyCandidates(values.body), ...nameCandidates(values.displayName), ...linkCandidates(values.links)];
    all.sort((a, b) => b.score - a.score || a.rule.source.length - b.rule.source.length);
    const best = all[0];
    if (!best || isLazyExactCopy(best.rule.source, values.body)) return null;
    const { score: _s, ...draft } = best;
    return draft;
}
