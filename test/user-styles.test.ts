import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { PlainSettings, loadSettings, importSettings, exportSettings } from "@api/Settings";
import { addLocalTheme, addThemeFromUrl, applyUserStyles, getThemes, parseThemeMeta, removeTheme, removeUserStyles, setQuickCss, setQuickCssEnabled, setThemeEnabled, setThemesEnabled, validateThemeUrl, watchUserStyles } from "@api/Themes";
import { openSettingsPanel } from "@plugins/_core/settings/panel";
import { memoryStorage } from "@utils/storage";

const styleNames = () => [...document.querySelectorAll<HTMLStyleElement>("style[data-xc]")].filter(s => !s.disabled).map(s => s.dataset.xc!).filter(n => n.startsWith("theme:") || n === "quickCss");

let stop: (() => void) | null = null;
beforeEach(() => {
    loadSettings(memoryStorage());
    stop = watchUserStyles();
});
afterEach(() => {
    stop?.();
    removeUserStyles();
    for (const o of document.querySelectorAll(".xc-pm-overlay")) o.remove();
});

describe("themes", () => {
    test("parses the @name / @author / @description header", () => {
        expect(parseThemeMeta("/**\n * @name Midnight\n * @author GG\n * @description Dark blue\n */\nbody{}")).toEqual({ name: "Midnight", author: "GG", description: "Dark blue" });
        expect(parseThemeMeta("body{}")).toEqual({ name: "", author: "", description: "" });
    });

    test("only https theme URLs are accepted", () => {
        expect(validateThemeUrl("https://a.example/t.css")).toBeNull();
        expect(validateThemeUrl("http://a.example/t.css")).not.toBeNull();
        expect(validateThemeUrl("not a url")).not.toBeNull();
    });

    test("local themes apply immediately, follow their switch and the master switch, and go away when removed", () => {
        const t = addLocalTheme("dark.css", "body { color: red }");
        expect(t.name).toBe("dark");
        expect(styleNames()).toEqual([`theme:${t.id}`]);
        setThemeEnabled(t.id, false);
        expect(styleNames()).toEqual([]);
        setThemeEnabled(t.id, true);
        setThemesEnabled(false);
        expect(styleNames()).toEqual([]);
        setThemesEnabled(true);
        expect(styleNames()).toEqual([`theme:${t.id}`]);
        removeTheme(t.id);
        expect(getThemes()).toEqual([]);
        expect(styleNames()).toEqual([]);
    });

    test("remote themes are fetched once and cached in settings", async () => {
        const original = globalThis.fetch;
        let calls = 0;
        globalThis.fetch = (async () => { calls++; return new Response("/** @name Remote */ a{}", { status: 200 }); }) as unknown as typeof fetch;
        try {
            const t = await addThemeFromUrl("https://cdn.example/remote.css");
            expect(t.name).toBe("Remote");
            expect(t.url).toBe("https://cdn.example/remote.css");
            expect(PlainSettings.core.themes[0].css).toContain("a{}");
            await expect(addThemeFromUrl("https://cdn.example/remote.css")).rejects.toThrow();
            expect(calls).toBe(1);
        } finally {
            globalThis.fetch = original;
        }
    });

    test("Quick CSS loads after themes and follows its switch", () => {
        addLocalTheme("a.css", "a{}");
        setQuickCss("b{}");
        expect(styleNames().at(-1)).toBe("quickCss");
        setQuickCssEnabled(false);
        expect(styleNames()).not.toContain("quickCss");
    });

    test("themes and Quick CSS travel with the settings backup", () => {
        addLocalTheme("a.css", "a{}");
        setQuickCss("b{}");
        const backup = exportSettings();
        loadSettings(memoryStorage());
        applyUserStyles();
        expect(styleNames()).toEqual([]);
        expect(importSettings(backup)).toBe(true);
        expect(styleNames().length).toBe(2);
    });

    test("the plugin manager has Themes and Quick CSS tabs", async () => {
        const close = openSettingsPanel({ tab: "quickCss" });
        const editor = document.querySelector<HTMLTextAreaElement>(".xc-pm-css-editor")!;
        editor.value = "c{}";
        editor.dispatchEvent(new Event("input"));
        close();
        expect(PlainSettings.core.quickCss).toBe("c{}");
        openSettingsPanel({ tab: "themes" });
        expect(document.querySelector(".xc-pm-themes")?.textContent).toContain("还没有主题");
        addLocalTheme("x.css", "/** @name Xtheme */");
        expect(document.querySelector('.xc-pm-theme .xc-pm-card-title')?.textContent).toBe("Xtheme");
    });
});
