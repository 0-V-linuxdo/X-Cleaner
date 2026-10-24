/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const PHRASE_INVISIBLE = /[​-‏‪-‮⁠⁦-⁩﻿]/gu;
const VARIATION_SELECTORS = /[︀-️\u{E0100}-\u{E01EF}]/gu;
const CLASSIFIER_INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ\u{E0100}-\u{E01EF}]/gu;
const COMPACT_SEPARATORS = /[\s._\-‐-―·•|｜/\\]+/gu;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

export const HANDLE_RE = /^[a-z0-9_]{1,15}$/;

export function normalizeHandle(raw: unknown): string {
    if (typeof raw !== "string") return "";
    const h = raw.normalize("NFKC").trim().replace(/^@+/, "").toLowerCase();
    return HANDLE_RE.test(h) ? h : "";
}

export function toConfigHandle(raw: unknown): string {
    const h = normalizeHandle(raw);
    return h ? `@${h}` : "";
}

export function normalizePhrase(raw: unknown): string {
    if (typeof raw !== "string") return "";
    return raw.normalize("NFKC").replace(PHRASE_INVISIBLE, "").replace(VARIATION_SELECTORS, "").toLowerCase().trim();
}

export function normalizeText(raw: unknown): string {
    if (typeof raw !== "string") return "";
    return raw.normalize("NFKC").replace(CLASSIFIER_INVISIBLE, "").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");
}

export function compactText(raw: unknown): string {
    return normalizeText(raw).replace(COMPACT_SEPARATORS, "");
}

export function sanitizeField(raw: unknown): string {
    if (typeof raw !== "string") return "";
    return raw.replace(CONTROL, " ").replace(/\s+/gu, " ").trim();
}

export function collapseWhitespace(raw: unknown): string {
    return typeof raw === "string" ? raw.replace(/\s+/gu, " ").trim() : "";
}

export function truncate(raw: string, max: number): string {
    return raw.length > max ? raw.slice(0, max) : raw;
}

const REGEX_SPECIAL = /[\^$\\.*+?()[\]{}|/]/g;

export function escapeRegexLiteral(text: string): string {
    return text.replace(REGEX_SPECIAL, "\\$&");
}

export function codePointLength(text: string): number {
    return [...text].length;
}

export const HAN_RE = /\p{Script=Han}/gu;

export function countHan(text: string): number {
    return text.match(HAN_RE)?.length ?? 0;
}

export function countLetters(text: string): number {
    return text.match(/[a-z]/giu)?.length ?? 0;
}

export function countDigits(text: string): number {
    return text.match(/\d/gu)?.length ?? 0;
}
