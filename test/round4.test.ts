import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { plugins, registerPlugin, setPluginEnabled, stopAllPlugins } from "@api/PluginManager";
import { definePluginSettings, loadSettings } from "@api/Settings";
import { goTo, X_SHORTCUTS } from "@plugins/moreMenuEntry";
import { buildCss, markInfoRow, VALUE_ATTR } from "@plugins/streamerMode";
import { renderSettingField } from "@ui/fields";
import { memoryStorage } from "@utils/storage";
import { OptionType, type Plugin } from "@utils/types";
import Plugins from "~plugins";

import { setUrl } from "./helpers";

for (const p of Object.values(Plugins)) if (!plugins[(p as Plugin).name]) registerPlugin(p as Plugin);

beforeEach(() => {
    loadSettings(memoryStorage());
    document.body.innerHTML = "";
});

afterEach(() => {
    stopAllPlugins();
    document.body.innerHTML = "";
    setUrl("/");
});

describe("StreamerMode settings info", () => {
    const row = '<main><a href="/settings/email"><div dir="ltr"><span>Email</span></div><div dir="ltr"><span>me@example.com</span></div></a></main>';

    test("marks every line of a row but its label", () => {
        document.body.innerHTML = row;
        const values = markInfoRow(document.querySelector("a")!);
        expect(values.map(v => v.textContent)).toEqual(["me@example.com"]);
        expect(document.querySelectorAll(`[${VALUE_ATTR}]`).length).toBe(1);
    });

    test("blurs marked values and the edit boxes only when switched on", () => {
        expect(buildCss({ settingsInfo: true, blur: 6 }, "")).toContain(`[${VALUE_ATTR}]`);
        expect(buildCss({ settingsInfo: true, blur: 6 }, "")).toContain('input[name="current_email"]');
        expect(buildCss({ settingsInfo: false }, "")).toBe("");
    });

    test("the plugin marks rows as X renders them and unmarks on stop", async () => {
        setPluginEnabled("StreamerMode", true);
        document.body.innerHTML = row;
        await new Promise(r => setTimeout(r, 50));
        expect(document.querySelector(`[${VALUE_ATTR}]`)?.textContent).toBe("me@example.com");
        setPluginEnabled("StreamerMode", false);
        expect(document.querySelector(`[${VALUE_ATTR}]`)).toBeNull();
    });
});

describe("MoreMenuEntry X shortcuts", () => {
    test("point at X's muted words, blocked and muted lists", () => {
        expect(X_SHORTCUTS.map(s => s.path)).toEqual(["/settings/muted_keywords", "/settings/blocked/all", "/settings/muted/all"]);
    });

    test("goTo navigates through history and tells X's router", () => {
        let popped = 0;
        const onPop = () => popped++;
        addEventListener("popstate", onPop);
        goTo("/settings/blocked/all");
        expect(location.pathname).toBe("/settings/blocked/all");
        goTo("/settings/blocked/all");
        expect(popped).toBe(1);
        removeEventListener("popstate", onPop);
    });
});

describe("COLOR setting", () => {
    const make = (value = "") => {
        const s = definePluginSettings({ c: { type: OptionType.COLOR, description: "", placeholder: "#1d9bf0", default: "", isValid: (v: string) => (!v || /^#|^[a-z]+$/i.test(v) ? true : "bad") } });
        s.pluginName = "ColorTest";
        (s.store as any).c = value;
        const field = renderSettingField("c", s.def.c, s);
        return { s, field, picker: field.querySelector<HTMLInputElement>('input[type="color"]')!, text: field.querySelector<HTMLInputElement>('input[type="text"]')!, clear: field.querySelector("button")! };
    };

    test("empty shows the placeholder colour, dimmed, with nothing to clear", () => {
        const { picker, text, clear } = make();
        expect(picker.value).toBe("#1d9bf0");
        expect(picker.classList.contains("xc-color-unset")).toBe(true);
        expect(text.value).toBe("");
        expect(clear.disabled).toBe(true);
    });

    test("picking fills the text box and saves", () => {
        const { s, picker, text } = make();
        picker.value = "#ff0000";
        picker.dispatchEvent(new Event("change"));
        expect(text.value).toBe("#ff0000");
        expect((s.store as any).c).toBe("#ff0000");
    });

    test("a colour name typed by hand still works, and clear empties it", () => {
        const { s, text, clear } = make("#abc");
        expect(text.value).toBe("#abc");
        text.value = "orange";
        text.dispatchEvent(new Event("change"));
        expect((s.store as any).c).toBe("orange");
        clear.click();
        expect((s.store as any).c).toBe("");
    });
});

describe("MoreMenuEntry settle", () => {
    test("hides the menu until X stops moving it, then shows it again", async () => {
        const { hideUntilSettled, OPENING_ATTR } = await import("@plugins/moreMenuEntry");
        const hidden = () => document.documentElement.hasAttribute(OPENING_ATTR);
        const menu = document.createElement("div");
        document.body.appendChild(menu);
        menu.style.top = "68px";
        hideUntilSettled(menu);
        expect(hidden()).toBe(true);
        await new Promise(r => requestAnimationFrame(() => r(null)));
        menu.style.top = "0px";
        for (let i = 0; i < 6; i++) await new Promise(r => requestAnimationFrame(() => r(null)));
        expect(hidden()).toBe(false);
    });
});
