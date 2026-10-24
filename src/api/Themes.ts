/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// User CSS after Void++'s Themes API and Quick CSS tab: themes from a URL or a local .css file,
// each with its own switch, plus one free-form Quick CSS box. Theme CSS is cached in settings,
// so nothing is fetched on page load; 「更新」 re-fetches a remote theme on demand.

import { registerStyle, unregisterStyle } from "@utils/css";
import { t } from "@utils/i18n";
import { errorMessage, uid } from "@utils/misc";

import { PlainSettings, Settings, settingsStore, type ThemeData } from "./Settings";

export type { ThemeData };

const THEME_PREFIX = "theme:";
export const QUICK_CSS_STYLE = "quickCss";
const FETCH_TIMEOUT_MS = 15_000;

export function parseThemeMeta(css: string): { name: string; author: string; description: string } {
    const header = css.match(/\/\*\*?[\s\S]*?\*\//)?.[0] ?? "";
    const tag = (name: string) => header.match(new RegExp(`@${name}[ \\t]+(.+?)[ \\t]*(?:\\*\\/|$)`, "m"))?.[1]?.trim() ?? "";
    return { name: tag("name"), author: tag("author"), description: tag("description") };
}

export const getThemes = (): ThemeData[] => PlainSettings.core.themes;

function setThemes(themes: ThemeData[]) {
    Settings.core.themes = themes;
}

export function validateThemeUrl(raw: string): string | null {
    let url: URL;
    try { url = new URL(raw.trim()); } catch { return t("请输入完整的网址，例如 https://example.com/theme.css。"); }
    if (url.protocol !== "https:") return t("只支持 https:// 开头的主题地址。");
    return null;
}

/** Plain-text GET through GM_xmlhttpRequest (no CORS), falling back to fetch outside a userscript manager. */
export function fetchText(url: string): Promise<string> {
    if (typeof GM_xmlhttpRequest !== "function") {
        return fetch(url).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.text();
        });
    }
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: "GET",
            url,
            timeout: FETCH_TIMEOUT_MS,
            onload: r => (r.status >= 200 && r.status < 300 ? resolve(r.responseText) : reject(new Error(`HTTP ${r.status}`))),
            onerror: () => reject(new Error(t("网络错误"))),
            ontimeout: () => reject(new Error(t("请求超时"))),
        });
    });
}

const fileName = (source: string) => source.split(/[?#]/)[0].split("/").filter(Boolean).at(-1)?.replace(/\.css$/i, "") || source;

function makeTheme(css: string, source: string, url?: string): ThemeData {
    const meta = parseThemeMeta(css);
    return { id: uid("t"), name: meta.name || fileName(source), author: meta.author, description: meta.description, url, css, enabled: true, updatedAt: Date.now() };
}

export async function addThemeFromUrl(raw: string): Promise<ThemeData> {
    const invalid = validateThemeUrl(raw);
    if (invalid) throw new Error(invalid);
    const url = new URL(raw.trim()).href;
    if (getThemes().some(t => t.url === url)) throw new Error(t("这个主题已经添加过了。"));
    let css: string;
    try { css = await fetchText(url); } catch (e) { throw new Error(t("下载主题失败：{error}", { error: errorMessage(e) })); }
    const theme = makeTheme(css, url, url);
    setThemes([...getThemes(), theme]);
    return theme;
}

export function addLocalTheme(name: string, css: string): ThemeData {
    const theme = makeTheme(css, name);
    setThemes([...getThemes(), theme]);
    return theme;
}

export async function refreshTheme(id: string): Promise<void> {
    const theme = getThemes().find(t => t.id === id);
    if (!theme?.url) return;
    let css: string;
    try { css = await fetchText(theme.url); } catch (e) { throw new Error(t("更新主题失败：{error}", { error: errorMessage(e) })); }
    const meta = parseThemeMeta(css);
    setThemes(getThemes().map(t => (t.id === id ? { ...t, css, name: meta.name || t.name, author: meta.author || t.author, description: meta.description || t.description, updatedAt: Date.now() } : t)));
}

export function removeTheme(id: string) {
    setThemes(getThemes().filter(t => t.id !== id));
}

export function setThemeEnabled(id: string, enabled: boolean) {
    setThemes(getThemes().map(t => (t.id === id ? { ...t, enabled } : t)));
}

export function setThemesEnabled(enabled: boolean) {
    Settings.core.themesEnabled = enabled;
}

export function setQuickCss(css: string) {
    Settings.core.quickCss = css;
}

export function setQuickCssEnabled(enabled: boolean) {
    Settings.core.quickCssEnabled = enabled;
}

const applied = new Set<string>();

/** Makes the page's user styles match settings: enabled themes in list order, then Quick CSS last so it wins. */
export function applyUserStyles() {
    const { themes, themesEnabled, quickCss, quickCssEnabled } = PlainSettings.core;
    const want = new Map<string, string>();
    if (themesEnabled) for (const t of themes) if (t.enabled && t.css) want.set(THEME_PREFIX + t.id, t.css);
    if (quickCssEnabled && quickCss.trim()) want.set(QUICK_CSS_STYLE, quickCss);
    for (const name of applied) {
        if (want.has(name)) continue;
        unregisterStyle(name);
        applied.delete(name);
    }
    for (const [name, css] of want) {
        // Re-append in order so later entries keep cascade priority.
        if (applied.has(name)) unregisterStyle(name);
        registerStyle(name, css);
        applied.add(name);
    }
}

export function removeUserStyles() {
    for (const name of applied) unregisterStyle(name);
    applied.clear();
}

export function watchUserStyles(): () => void {
    applyUserStyles();
    const offs = ["core.themes", "core.themesEnabled", "core.quickCss", "core.quickCssEnabled"].map(path => settingsStore.addPrefixChangeListener(path, applyUserStyles));
    const offAll = settingsStore.addPrefixChangeListener("", path => { if (path === "") applyUserStyles(); });
    return () => {
        for (const off of offs) off();
        offAll();
        removeUserStyles();
    };
}
