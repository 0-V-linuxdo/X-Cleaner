import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { loadSettings, Settings } from "@api/Settings";
import { plugins, registerPlugin } from "@api/PluginManager";
import { openSettingsPanel } from "@plugins/_core/settings/panel";
import { classify } from "@rules/classifier";
import { FIELD_LABELS } from "@rules/regex";
import { getLocale, listJoin, localeFromTag, t } from "@utils/i18n";
import { memoryStorage } from "@utils/storage";
import type { Plugin, SettingDef } from "@utils/types";
import Plugins from "~plugins";

import en from "../src/locales/en";

for (const p of Object.values(Plugins)) registerPlugin(p as Plugin);

const HAN = /[一-鿿]/u;
const CALL = /\b(?:t|N_)\(\s*"((?:[^"\\\n]|\\.)*)"/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) sourceFiles(path, out);
        else if (path.endsWith(".ts") && !path.includes("locales")) out.push(path);
    }
    return out;
}

/** Every literal passed to t() or N_() in src, with the file it first appears in. */
function sourceKeys(): Map<string, string> {
    const keys = new Map<string, string>();
    for (const file of sourceFiles("src")) {
        for (const m of readFileSync(file, "utf8").matchAll(CALL)) {
            const key = JSON.parse(`"${m[1]}"`) as string;
            if (!keys.has(key)) keys.set(key, file);
        }
    }
    return keys;
}

/** The text plugins declare up front and the UI translates when it shows it. */
function declaredStrings(): string[] {
    const out: string[] = [];
    for (const p of Object.values(Plugins) as Plugin[]) {
        out.push(p.description);
        for (const page of (p as any).panelPages ?? []) out.push(page.label);
        for (const check of p.healthChecks ?? []) out.push(check.label);
        for (const def of Object.values((p.settings?.def ?? {}) as Record<string, SettingDef>)) {
            out.push(def.label ?? "", def.description, def.placeholder ?? "");
            if ("options" in def) out.push(...def.options.map(o => o.label));
        }
    }
    return out.filter(s => s && HAN.test(s));
}

const setLang = (lang: string) => document.documentElement.setAttribute("lang", lang);

beforeEach(() => {
    loadSettings(memoryStorage());
    setLang("zh");
});

afterEach(() => {
    document.querySelectorAll(".xc-pm-overlay").forEach(el => el.remove());
    setLang("zh");
});

describe("English catalog", () => {
    test("covers every string marked with t() or N_()", () => {
        const missing = [...sourceKeys()].filter(([k]) => !(k in en)).map(([k, file]) => `${file}: ${k}`);
        expect(missing).toEqual([]);
    });

    test("covers every plugin description, setting, page and health check label", () => {
        expect(declaredStrings().filter(s => !(s in en))).toEqual([]);
    });

    test("only uses placeholders the Chinese text provides", () => {
        const bad = Object.entries(en).filter(([k, v]) => (v.match(/\{\w+\}/g) ?? []).some(p => !k.includes(p)));
        expect(bad).toEqual([]);
    });

    test("has no entries the source no longer uses", () => {
        const keys = sourceKeys();
        expect(Object.keys(en).filter(k => !keys.has(k))).toEqual([]);
    });
});

describe("locale", () => {
    test("maps X's lang values", () => {
        expect(localeFromTag("zh")).toBe("zh");
        expect(localeFromTag("zh-Hant")).toBe("zh");
        expect(localeFromTag("zh-CN")).toBe("zh");
        expect(localeFromTag("en")).toBe("en");
        expect(localeFromTag("ja")).toBe("en");
        expect(localeFromTag("")).toBeNull();
    });

    test("follows X's <html lang> by default", () => {
        expect(getLocale()).toBe("zh");
        expect(t("关闭")).toBe("关闭");
        setLang("en");
        expect(getLocale()).toBe("en");
        expect(t("关闭")).toBe("Close");
        expect(t("搜索 {n} 个插件...", { n: 3 })).toBe("Search 3 plugins…");
        expect(listJoin(["a", "b"])).toBe("a, b");
    });

    test("a chosen language wins over X's", () => {
        setLang("en");
        Settings.core.language = "zh";
        expect(t("关闭")).toBe("关闭");
        setLang("zh");
        Settings.core.language = "en";
        expect(t("关闭")).toBe("Close");
    });

    test("unknown text falls back to the original", () => {
        setLang("en");
        expect(t("没有这条翻译 {x}", { x: 1 })).toBe("没有这条翻译 1");
    });

    test("lookup tables and classifier reasons follow the language", () => {
        setLang("en");
        expect(FIELD_LABELS.body).toBe("Reply text");
        const reason = classify({ bodyText: "约炮" }, { categories: { adult: false, crypto: false, promotionalName: false }, sensitivity: "balanced" }).reason;
        expect(reason).toBe("All built-in detection categories are off");
    });
});

describe("plugin manager", () => {
    const navText = () => [...document.querySelectorAll(".xc-pm-nav-item")].map(b => b.textContent);

    test("renders in X's language", () => {
        setLang("en");
        openSettingsPanel();
        expect(navText()).toEqual(["Plugins", "Themes", "Quick CSS", "Backup", "Language"]);
        [...document.querySelectorAll<HTMLButtonElement>(".xc-pm-tab")].find(b => b.textContent === "All")!.click();
        const card = document.querySelector<HTMLElement>('.xc-pm-card[data-plugin="TombstoneFilter"] .xc-pm-card-desc')!;
        expect(card.textContent).toBe(en[plugins.TombstoneFilter.description]);
        expect(document.querySelector<HTMLInputElement>(".xc-pm-search")!.placeholder).toMatch(/^Search \d+ plugins…$/);
    });

    test("the Language tab sits next to Backup and switches the language", () => {
        openSettingsPanel({ tab: "language" });
        expect(navText()).toEqual(["插件", "主题", "快速 CSS", "备份", "语言"]);
        const radio = (v: string) => document.querySelector<HTMLInputElement>(`.xc-pm-lang-option[data-locale="${v}"] input`)!;
        expect(radio("auto").checked).toBe(true);
        radio("en").click();
        expect(Settings.core.language).toBe("en");
        expect(navText()).toEqual(["Plugins", "Themes", "Quick CSS", "Backup", "Language"]);
        expect(document.querySelector(".xc-pm-title")!.textContent).toBe("Language");
        expect(radio("en").checked).toBe(true);
        expect(document.querySelectorAll(".xc-pm-overlay").length).toBe(1);
    });
});
