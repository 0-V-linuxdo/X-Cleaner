import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { loadSettings, Settings } from "@api/Settings";
import { plugins, registerPlugin, setPluginEnabled, stopAllPlugins } from "@api/PluginManager";
import { flushNow } from "@plugins/_api/domObserver";
import { buildCss, describeEntry, mergeOrder, NAV, PIN_ATTR } from "@plugins/sidebarEntries/entries";
import { readMoreMenu } from "@plugins/sidebarEntries/pins";
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

const link = (href: string, tid: string, label: string, wide: boolean) =>
    `<a href="${href}" data-testid="${tid}" aria-label="${label}"><div><svg class="nav-icon" viewBox="0 0 24 24"><path d="M0"/></svg>${wide ? `<div dir="ltr"><span>${label}</span></div>` : ""}</div></a>`;
const navHtml = (wide: boolean) => `<header role="banner"><nav role="navigation" aria-label="Primary">
    ${link("/home", "AppTabBar_Home_Link", "Home", wide)}
    ${link("/explore", "AppTabBar_Explore_Link", "Explore", wide)}
    <button data-testid="AppTabBar_More_Menu" aria-label="More menu items" aria-expanded="false">More</button>
</nav></header><main></main>`;
const MORE_MENU = `<div><div class="backdrop"></div><div role="menu"><div data-testid="Dropdown">
    <a href="/me/lists" role="menuitem"><svg viewBox="0 0 24 24"><path d="M1"/></svg><div dir="ltr"><span>Lists</span></div></a>
    <div role="menuitem" tabindex="0"><svg viewBox="0 0 24 24"><path d="M2"/></svg><div dir="ltr"><span>Create your Space</span></div></div>
    <a href="https://ads.x.com/?ref=gl" role="menuitem" target="_blank"><svg viewBox="0 0 24 24"><path d="M3"/></svg><div dir="ltr"><span>Ads</span></div></a>
    <a href="/settings" role="menuitem"><svg viewBox="0 0 24 24"><path d="M4"/></svg><div dir="ltr"><span>Settings and privacy</span></div></a>
</div></div></div>`;

function openMoreMenu() {
    let layers = document.querySelector("#layers");
    if (!layers) document.body.insertAdjacentHTML("beforeend", '<div id="layers"></div>');
    layers = document.querySelector("#layers")!;
    layers.innerHTML = MORE_MENU;
    const backdrop = layers.querySelector<HTMLElement>(".backdrop")!;
    backdrop.getBoundingClientRect = () => ({ height: 500 } as DOMRect);
    backdrop.addEventListener("click", () => { layers!.innerHTML = ""; });
    return layers.querySelector('[role="menu"]')!;
}

describe("SidebarEntries: pins from the 「更多」 menu", () => {
    beforeEach(() => { document.body.innerHTML = navHtml(true); });

    test("reads the 「更多」 menu rows with per-user paths normalised", () => {
        expect(readMoreMenu(openMoreMenu()).map(i => i.key)).toEqual(["href:/~/lists", "text:Create your Space", "url:ads.x.com", "href:/settings"]);
    });

    test("records the menu when it opens and pins rows above 「更多」, following the sidebar's collapsed state", async () => {
        setPluginEnabled("SidebarEntries", true);
        flushNow();
        openMoreMenu();
        await flush();
        const s = Settings.plugins.SidebarEntries as any;
        expect(s.moreItems.map((i: any) => i.label)).toEqual(["Lists", "Create your Space", "Ads", "Settings and privacy"]);

        s.pinned = ["href:/~/lists", "url:ads.x.com"];
        await flush();
        const pins = () => [...nav().querySelectorAll<HTMLElement>(`[${PIN_ATTR}]`)];
        expect(pins().map(p => p.getAttribute("aria-label"))).toEqual(["Lists", "Ads"]);
        expect(pins()[1].nextElementSibling!.getAttribute("data-testid")).toBe("AppTabBar_More_Menu");
        expect(pins()[0].getAttribute("href")).toBe("/me/lists");
        expect(pins()[0].hasAttribute("data-testid")).toBe(false);
        expect(pins()[0].textContent).toBe("Lists");
        expect(pins()[0].querySelector("svg")!.getAttribute("class")).toBe("nav-icon");
        expect(pins()[0].querySelector("path")!.getAttribute("d")).toBe("M1");
        expect(pins()[1].getAttribute("target")).toBe("_blank");
        expect(s.known.map((e: any) => e.key)).toContain("pin:href:/~/lists");

        // X redraws the sidebar icon-only: the pins drop their labels too.
        const more = nav().querySelector('[data-testid="AppTabBar_More_Menu"]')!;
        for (const a of nav().querySelectorAll('a[data-testid]')) a.remove();
        more.insertAdjacentHTML("beforebegin", link("/home", "AppTabBar_Home_Link", "Home", false) + link("/explore", "AppTabBar_Explore_Link", "Explore", false));
        await flush();
        expect(pins().map(p => p.textContent)).toEqual(["", ""]);
        expect(pins().at(-1)!.nextElementSibling).toBe(more);

        setPluginEnabled("SidebarEntries", false);
        expect(pins()).toEqual([]);
    });

    test("clicking a pin replays the click on the matching menu row", async () => {
        setPluginEnabled("SidebarEntries", true);
        flushNow();
        const s = Settings.plugins.SidebarEntries as any;
        s.moreItems = readMoreMenu(openMoreMenu());
        document.querySelector("#layers")!.innerHTML = "";
        s.pinned = ["text:Create your Space"];
        await flush();
        const more = nav().querySelector<HTMLElement>('[data-testid="AppTabBar_More_Menu"]')!;
        more.addEventListener("click", () => setTimeout(openMoreMenu, 5));
        let clicked = "";
        document.addEventListener("click", e => { const r = (e.target as Element).closest?.('[role="menuitem"]'); if (r) clicked = r.textContent!.trim(); }, true);
        const pin = nav().querySelector<HTMLElement>(`[${PIN_ATTR}]`)!;
        expect(pin.getAttribute("role")).toBe("button");
        pin.click();
        await new Promise(r => setTimeout(r, 50));
        expect(clicked).toBe("Create your Space");
    });

    test("settings list the menu rows and pin them with a switch", async () => {
        setPluginEnabled("SidebarEntries", true);
        flushNow();
        const s = Settings.plugins.SidebarEntries as any;
        s.moreItems = readMoreMenu(openMoreMenu());
        document.querySelector("#layers")!.innerHTML = "";
        openPluginSettings(plugins.SidebarEntries);
        const row = document.querySelector<HTMLElement>('.xc-sbe-pins [data-key="href:/~/lists"]')!;
        row.querySelector<HTMLButtonElement>('[role="switch"]')!.click();
        expect(s.pinned).toEqual(["href:/~/lists"]);
        await flush();
        expect(nav().querySelector(`[${PIN_ATTR}="href:/~/lists"]`)).not.toBeNull();
        expect([...document.querySelectorAll(".xc-sbe:not(.xc-sbe-pins) .xc-sbe-row strong")].map(e => e.textContent)).toContain("Lists（来自「更多」）");
    });
});
