import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { loadSettings, Settings } from "@api/Settings";
import { plugins, registerPlugin, setPluginEnabled, stopAllPlugins } from "@api/PluginManager";
import { flushNow } from "@plugins/_api/domObserver";
import { buildCss, describeEntry, mergeOrder, NAV } from "@plugins/sidebarEntries/entries";
import { openPluginSettings } from "@plugins/_core/settings/panel";
import { memoryStorage } from "@utils/storage";
import type { Plugin } from "@utils/types";
import Plugins from "~plugins";

import { flush } from "./helpers";

for (const p of Object.values(Plugins)) if (!plugins[(p as Plugin).name]) registerPlugin(p as Plugin);

const NAV_HTML = `<header role="banner"><nav role="navigation" aria-label="Primary">
    <a href="/home" data-testid="AppTabBar_Home_Link" aria-label="Home">Home</a>
    <a href="/explore" data-testid="AppTabBar_Explore_Link" aria-label="Search and explore">Explore</a>
    <a href="/i/grok" aria-label="Grok">Grok</a>
    <a href="/me/lists" aria-label="Lists">Lists</a>
    <a href="/me" data-testid="AppTabBar_Profile_Link" aria-label="Profile">Profile</a>
    <button data-testid="AppTabBar_More_Menu" aria-label="More menu items">More</button>
</nav></header><main></main>`;

const layoutCss = () => document.querySelector<HTMLStyleElement>('style[data-xc="sidebarEntries:layout"]')?.textContent ?? "";
const nav = () => document.querySelector(NAV)!;

beforeEach(() => {
    loadSettings(memoryStorage());
    document.body.innerHTML = NAV_HTML;
});

afterEach(() => {
    stopAllPlugins();
    for (const o of document.querySelectorAll(".xc-pm-overlay")) o.remove();
});

describe("SidebarEntries", () => {
    test("identifies entries by testid or path, with per-user paths normalised", () => {
        const [home, , grok, lists] = [...nav().children].map(describeEntry);
        expect(home).toEqual({ key: "tid:AppTabBar_Home_Link", selector: '[data-testid="AppTabBar_Home_Link"]', label: "主页" });
        expect(grok!.key).toBe("href:/i/grok");
        expect(lists).toEqual({ key: "href:/~/lists", selector: '[href$="/lists"]', label: "列表" });
    });

    test("mergeOrder keeps new X entries next to their natural neighbour", () => {
        expect(mergeOrder(["c", "a"], ["a", "b", "c"])).toEqual(["c", "a", "b"]);
        expect(mergeOrder([], ["a", "b"])).toEqual(["a", "b"]);
        expect(mergeOrder(["b"], ["x", "a", "b"])).toEqual(["x", "a", "b"]);
    });

    test("default layout injects no CSS, so X's sidebar is untouched", () => {
        const entries = [...nav().children].map(describeEntry).filter(e => e !== null);
        expect(buildCss(entries, { order: [], hidden: [] })).toBe("");
        expect(buildCss(entries, { order: entries.map(e => e.key), hidden: [] })).toBe("");
    });

    test("records the sidebar and applies hidden and order via CSS without touching X's DOM", async () => {
        setPluginEnabled("SidebarEntries", true);
        flushNow();
        const s = Settings.plugins.SidebarEntries as any;
        expect(s.known.map((e: any) => e.key)).toEqual([
            "tid:AppTabBar_Home_Link", "tid:AppTabBar_Explore_Link", "href:/i/grok", "href:/~/lists", "tid:AppTabBar_Profile_Link", "tid:AppTabBar_More_Menu",
        ]);
        expect(layoutCss()).toBe("");

        s.layout = { order: ["href:/i/grok", "tid:AppTabBar_Home_Link", "tid:AppTabBar_Explore_Link", "href:/~/lists", "tid:AppTabBar_Profile_Link", "tid:AppTabBar_More_Menu"], hidden: ["href:/~/lists"] };
        await flush();
        const css = layoutCss();
        expect(css).toContain(`${NAV} > [href="/i/grok"]{order:0 !important}`);
        expect(css).toContain(`${NAV} > [data-testid="AppTabBar_Home_Link"]{order:1 !important}`);
        expect(css).toContain(`${NAV} > [href$="/lists"]{display:none !important}`);
        expect(nav().children[0].getAttribute("href")).toBe("/home");

        setPluginEnabled("SidebarEntries", false);
        expect(layoutCss()).toBe("");
    });

    test("picks up entries X adds later and keeps them after their neighbour", async () => {
        setPluginEnabled("SidebarEntries", true);
        flushNow();
        const s = Settings.plugins.SidebarEntries as any;
        s.layout = { order: ["tid:AppTabBar_More_Menu", "tid:AppTabBar_Home_Link", "tid:AppTabBar_Explore_Link", "href:/i/grok", "href:/~/lists", "tid:AppTabBar_Profile_Link"], hidden: [] };
        const bm = document.createElement("a");
        bm.setAttribute("href", "/i/bookmarks");
        bm.textContent = "Bookmarks";
        nav().insertBefore(bm, nav().children[3]);
        await flush();
        expect(s.known.map((e: any) => e.key)).toContain("href:/i/bookmarks");
        expect(layoutCss()).toContain('[href="/i/bookmarks"]{order:4 !important}');
    });

    test("settings editor toggles visibility and reorders", async () => {
        setPluginEnabled("SidebarEntries", true);
        flushNow();
        openPluginSettings(plugins.SidebarEntries);
        const rows = () => [...document.querySelectorAll<HTMLElement>(".xc-sbe-row")];
        expect(rows().map(r => r.querySelector("strong")!.textContent)).toEqual(["主页", "探索", "Grok", "列表", "个人资料", "更多"]);

        rows()[2].querySelector<HTMLButtonElement>('[aria-label="上移 Grok"]')!.click();
        expect(rows().map(r => r.querySelector("strong")!.textContent).slice(0, 3)).toEqual(["主页", "Grok", "探索"]);

        rows()[5].querySelector<HTMLButtonElement>('[role="switch"]')!.click();
        expect(rows()[5].classList.contains("is-hidden")).toBe(true);
        expect(rows()[5].textContent).toContain("设置和隐私");

        const s = Settings.plugins.SidebarEntries as any;
        expect(s.layout.hidden).toEqual(["tid:AppTabBar_More_Menu"]);
        expect(s.layout.order.slice(0, 3)).toEqual(["tid:AppTabBar_Home_Link", "href:/i/grok", "tid:AppTabBar_Explore_Link"]);
        await flush();
        expect(layoutCss()).toContain('[data-testid="AppTabBar_More_Menu"]{display:none !important}');
    });
});
