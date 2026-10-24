/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// UI strings are written in Simplified Chinese and looked up in a per-language catalog keyed by
// that Chinese text, so a missing translation falls back to the Chinese original instead of a key.
// The language follows X's own setting (the `lang` X puts on <html>) unless the user picks one.

import { PlainSettings, Settings } from "@api/Settings";

import en from "../locales/en";

export type Locale = "zh" | "en";
export type LocalePreference = "auto" | Locale;

export const LOCALE_NAMES: Record<Locale, string> = { zh: "简体中文", en: "English" };

const CATALOGS: Record<Locale, Record<string, string> | null> = { zh: null, en };

/** Maps a BCP 47 tag (X uses e.g. `en`, `zh`, `zh-Hant`, `ja`) to a supported locale; others get English. */
export function localeFromTag(tag: string | null | undefined): Locale | null {
    const t = (tag ?? "").trim().toLowerCase();
    if (!t) return null;
    return t === "zh" || t.startsWith("zh-") || t.startsWith("zh_") ? "zh" : "en";
}

/** The language X is displayed in, falling back to the browser's language before X has set `lang`. */
export function xLocale(): Locale {
    return localeFromTag(document.documentElement?.getAttribute("lang")) ?? localeFromTag(navigator.language) ?? "en";
}

export function getLocalePreference(): LocalePreference {
    const pref = PlainSettings.core.language;
    return pref === "zh" || pref === "en" ? pref : "auto";
}

export function setLocalePreference(pref: LocalePreference) {
    Settings.core.language = pref;
}

export function getLocale(): Locale {
    const pref = getLocalePreference();
    return pref === "auto" ? xLocale() : pref;
}

/**
 * Translates a UI string written in Chinese. `{name}` placeholders are filled from `vars` after the lookup,
 * so the catalog keeps them, e.g. t("已加入 {n} 个词语。", { n }).
 */
export function t(text: string, vars?: Record<string, string | number>): string {
    const out = CATALOGS[getLocale()]?.[text] ?? text;
    return vars ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : out;
}

/** The language AI replies (rule names, reasons) should be written in, as named in the prompt. */
export const aiLanguageName = () => (getLocale() === "zh" ? "Simplified Chinese" : "English");

/** The tag for Intl / toLocale*String in the current language. */
export const dateLocale = () => (getLocale() === "zh" ? "zh-CN" : "en-US");

/** Joins a list the way the current language does (「、」 in Chinese, ", " in English). */
export const listJoin = (items: readonly string[]) => items.join(getLocale() === "zh" ? "、" : ", ");

export const catalogFor = (locale: Locale) => CATALOGS[locale];

/**
 * Marks a string for translation without translating it yet: for plugin descriptions, setting labels and other
 * text defined when the module loads, before the user's language preference is known. The UI that shows it calls t().
 */
export const N_ = (text: string) => text;
