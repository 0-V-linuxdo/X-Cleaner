import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { plugins, registerPlugin, setPluginEnabled, stopAllPlugins } from "@api/PluginManager";
import { loadSettings, Settings } from "@api/Settings";
import { contextForCaret, contextForProfileButton, fillMenu, fillProfileMenu, ITEM_ATTR } from "@plugins/_api/postMenu";
import { disposeController } from "@plugins/_api/replyFilter";
import { collectThread, toMarkdown } from "@plugins/exportThread";
import { bulkSelection } from "@plugins/panel/kit";
import { ALIAS_ATTR, buildCss as streamerCss, markAlias } from "@plugins/streamerMode";
import { memoryStorage } from "@utils/storage";
import type { Plugin } from "@utils/types";
import Plugins from "~plugins";

import { HEADER } from "../build";
import { freshBackend, mountPage, setUrl, tweetHtml } from "./helpers";

for (const p of Object.values(Plugins)) if (!plugins[(p as Plugin).name]) registerPlugin(p as Plugin);

beforeEach(() => {
    loadSettings(memoryStorage());
    freshBackend();
    document.body.innerHTML = "";
});

afterEach(() => {
    stopAllPlugins();
    disposeController();
    for (const p of Object.values(plugins)) p.isDependency = false;
    document.body.innerHTML = "";
    setUrl("/");
});

const ROW = (text: string) => `<div role="menuitem" tabindex="0"><div><svg viewBox="0 0 24 24" class="r-icon"><g></g></svg></div><div><div dir="ltr"><span>${text}</span></div></div></div>`;

function mountMenu(rows: string) {
    document.body.insertAdjacentHTML("beforeend", `<div id="layers"><div><div class="backdrop"></div><div role="menu"><div>${rows}</div></div></div></div>`);
    return document.querySelector('[role="menu"]')!;
}

describe("auto update", () => {
    test("the script header points script managers at the repository", () => {
        expect(HEADER).toContain("// @updateURL    https://raw.githubusercontent.com/0-V-linuxdo/X-Cleaner/main/dist/X%20Cleaner.meta.js");
        expect(HEADER).toContain("// @downloadURL  https://raw.githubusercontent.com/0-V-linuxdo/X-Cleaner/main/dist/X%20Cleaner.user.js");
        // Changing either would install a second copy instead of updating the first.
        expect(HEADER).toContain("// @name         X Cleaner\n");
        expect(HEADER).toContain("// @namespace    https://github.com/0-V-linuxdo/x-cleaner\n");
    });
});

describe("profile menu", () => {
    test("knows the profile only on a /handle page", () => {
        mountPage([]);
        document.querySelector('[data-testid="primaryColumn"]')!.insertAdjacentHTML("afterbegin", '<button data-testid="userActions"></button>');
        const btn = document.querySelector('[data-testid="userActions"]')!;
        setUrl("/spammer");
        expect(contextForProfileButton(btn)).toMatchObject({ handle: "spammer" });
        setUrl("/spammer/status/1");
        expect(contextForProfileButton(btn)).toBeNull();
    });

    test("profile menu offers the account lists, but not on your own profile", () => {
        setPluginEnabled("AccountBlacklist", true);
        setPluginEnabled("AllowList", true);
        mountPage([], "me");
        const rows = fillProfileMenu(mountMenu(ROW("Mute")), { handle: "spammer", profileUrl: "https://x.com/spammer" });
        expect(rows.map(r => r.getAttribute(ITEM_ATTR))).toEqual(["account-blacklist", "allow-list"]);
        document.querySelector("#layers")!.remove();
        expect(fillProfileMenu(mountMenu(ROW("Mute")), { handle: "me", profileUrl: "https://x.com/me" })).toEqual([]);
    });
});

describe("post menu additions", () => {
    test("rule draft and AI review stay out of the menu when the reply can't be acted on", () => {
        setPluginEnabled("RuleDraft", true);
        setPluginEnabled("AiReview", true);
        setPluginEnabled("ExportThread", true);
        setUrl("/op/status/1");
        mountPage([tweetHtml({ id: "1", handle: "op", text: "root" }), tweetHtml({ id: "2", handle: "spam", text: "加微信" })]);
        const ctx = contextForCaret(document.querySelectorAll('[data-testid="caret"]')[1])!;
        const ids = fillMenu(mountMenu(ROW("Mute")), ctx).map(r => r.getAttribute(ITEM_ATTR));
        // The filter has not processed the page here and AI is off, so only the exports show.
        expect(ids).toEqual(["export-md", "export-json"]);
    });
});

describe("ExportThread", () => {
    test("collects the loaded posts in order and writes Markdown", () => {
        setUrl("/op/status/1");
        mountPage([tweetHtml({ id: "1", handle: "op", name: "Op", text: "root post" }), tweetHtml({ id: "2", handle: "bob", text: "line one\nline two", links: [{ href: "https://t.co/x", text: "example.com" }] })]);
        const data = collectThread();
        expect(data.posts.map(p => [p.tweetId, p.authorHandle, p.isRoot])).toEqual([["1", "op", true], ["2", "bob", false]]);
        expect(data.posts[0].time).toBe("2026-01-01");
        const md = toMarkdown(data);
        expect(md).toMatch(/^## Op .*\(@op\) · 主帖$/m);
        expect(md).toContain("> line one");
        expect(md).not.toContain("已隐藏");
    });
});

describe("bulk selection", () => {
    test("tick, select all visible, act, and drop keys that disappeared", () => {
        const removed: string[][] = [];
        const bulk = bulkSelection("条目", [{ label: "移除所选", run: keys => { removed.push(keys); return true; } }]);
        bulk.sync(["a", "b", "c"], ["a", "b"]);
        expect(bulk.bar.hidden).toBe(true);
        const box = bulk.box("a", "a");
        box.checked = true;
        box.dispatchEvent(new Event("change"));
        expect(bulk.bar.hidden).toBe(false);
        expect(bulk.bar.textContent).toContain("已选 1 个条目");
        const [selectAll, , remove] = [...bulk.bar.querySelectorAll("button")];
        selectAll.click();
        expect(bulk.bar.textContent).toContain("已选 2 个条目");
        bulk.sync(["b", "c"], ["b", "c"]);
        expect(bulk.bar.textContent).toContain("已选 1 个条目");
        remove.click();
        expect(removed).toEqual([["b"]]);
        expect(bulk.bar.hidden).toBe(true);
    });

    test("a checkbox click never selects the row under it", () => {
        let rowClicks = 0;
        const bulk = bulkSelection("账号", []);
        bulk.sync(["a"], ["a"]);
        const row = document.createElement("div");
        row.addEventListener("click", () => rowClicks++);
        row.append(bulk.box("a", "a"));
        document.body.append(row);
        row.querySelector("input")!.click();
        expect(rowClicks).toBe(0);
    });
});

describe("StreamerMode alias", () => {
    const SWITCHER = '<button data-testid="SideNav_AccountSwitcher_Button"><div><div dir="ltr"><span><span>Real Name</span></span></div><div dir="ltr"><span><svg></svg></span></div></div><div dir="ltr"><span>@real</span></div></button>';

    test("an alias replaces the name instead of blurring it", () => {
        const css = streamerCss({ accountName: true, alias: "Guest" }, "me");
        expect(css).toContain(`[${ALIAS_ATTR}]::after`);
        expect(css).not.toContain("blur(");
        expect(streamerCss({ accountName: true, alias: " " }, "me")).toContain("blur(");
    });

    test("marks the name row and hides the badge and handle rows, and undoes it", () => {
        document.body.innerHTML = SWITCHER;
        const sw = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')!;
        markAlias(sw, "Guest");
        const rows = [...sw.querySelectorAll("[dir]")];
        expect(rows[0].getAttribute(ALIAS_ATTR)).toBe("Guest");
        expect(rows.slice(1).every(r => r.hasAttribute("data-xc-alias-hide"))).toBe(true);
        markAlias(sw, "");
        expect(sw.querySelector(`[${ALIAS_ATTR}], [data-xc-alias-hide]`)).toBeNull();
    });

    test("the running plugin keeps the alias on the account menu", () => {
        document.body.innerHTML = SWITCHER;
        setPluginEnabled("StreamerMode", true);
        Settings.plugins.StreamerMode.alias = "Guest";
        const { flushNow } = require("@plugins/_api/domObserver");
        flushNow();
        expect(document.querySelector(`[${ALIAS_ATTR}]`)?.getAttribute(ALIAS_ATTR)).toBe("Guest");
        setPluginEnabled("StreamerMode", false);
        expect(document.querySelector(`[${ALIAS_ATTR}]`)).toBeNull();
    });
});
