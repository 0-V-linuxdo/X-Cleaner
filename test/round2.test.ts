import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { plugins, registerPlugin, setPluginEnabled, stopAllPlugins } from "@api/PluginManager";
import { loadSettings, PlainSettings, Settings } from "@api/Settings";
import { contextForCaret, contextForProfileButton, fillMenu, fillProfileMenu, ITEM_ATTR } from "@plugins/_api/postMenu";
import { disposeController } from "@plugins/_api/replyFilter";
import { collectThread, toMarkdown } from "@plugins/exportThread";
import { bulkSelection } from "@plugins/panel/kit";
import { buildCss as identityCss, HANDLE_ATTR, HIDE_ATTR, markIdentity, NAME_ATTR } from "@plugins/customSidebarIdentity";
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

describe("CustomSidebarIdentity", () => {
    const SWITCHER = '<button data-testid="SideNav_AccountSwitcher_Button"><div data-testid="UserAvatar-Container-real"><div style="background-image: url(&quot;a.png&quot;);"></div><img src="a.png"></div><div><div dir="ltr"><span><span>Real Name</span></span></div><div dir="ltr"><span><svg></svg></span></div></div><div dir="ltr"><span>@real</span></div></button>';

    test("draws the avatar over X's own and sizes it only in the expanded button", () => {
        const css = identityCss({ avatarUrl: "data:image/png;base64,AAAA", avatarSize: 56, applyToMenu: true }, "real");
        expect(css).toContain('background-image: url("data:image/png;base64,AAAA")');
        expect(css).toContain('[data-testid="UserAvatar-Container-real" i]');
        expect(css).toContain(":has([dir])");
        expect(css).toContain("56px");
        expect(identityCss({ avatarUrl: "javascript:alert(1)", avatarSize: 40 }, "real")).toBe("");
        expect(identityCss({ avatarUrl: "data:image/png;base64,AAAA" }, "real", false)).toBe("");
    });

    test("marks the name and handle rows, hides the badge, and undoes it", () => {
        document.body.innerHTML = SWITCHER;
        const sw = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')!;
        markIdentity(sw, "Guest", "");
        const rows = [...sw.querySelectorAll("[dir]")];
        expect(rows[0].getAttribute(NAME_ATTR)).toBe("Guest");
        expect(rows[1].hasAttribute(HIDE_ATTR)).toBe(true);
        expect(rows[2].hasAttribute(HANDLE_ATTR)).toBe(false);
        markIdentity(sw, "", "guest");
        expect(rows[0].hasAttribute(NAME_ATTR)).toBe(false);
        expect(rows[1].hasAttribute(HIDE_ATTR)).toBe(false);
        expect(rows[2].getAttribute(HANDLE_ATTR)).toBe("@guest");
    });

    test("the running plugin keeps the marks on the account button", () => {
        document.body.innerHTML = SWITCHER;
        setPluginEnabled("CustomSidebarIdentity", true);
        Settings.plugins.CustomSidebarIdentity.displayName = "Guest";
        Settings.plugins.CustomSidebarIdentity.displayHandle = "@guest";
        const { flushNow } = require("@plugins/_api/domObserver");
        flushNow();
        expect(document.querySelector(`[${NAME_ATTR}]`)?.getAttribute(NAME_ATTR)).toBe("Guest");
        expect(document.querySelector(`[${HANDLE_ATTR}]`)?.getAttribute(HANDLE_ATTR)).toBe("@guest");
        setPluginEnabled("CustomSidebarIdentity", false);
        expect(document.querySelector(`[${NAME_ATTR}], [${HANDLE_ATTR}], [${HIDE_ATTR}]`)).toBeNull();
    });

    test("moves StreamerMode's old alias over and keeps it on when StreamerMode was on", () => {
        const storage = memoryStorage();
        storage.set("XCleanerSettings", { plugins: { StreamerMode: { enabled: true, alias: "Guest" } }, core: {} });
        loadSettings(storage);
        plugins.CustomSidebarIdentity.migrate!();
        expect(PlainSettings.plugins.StreamerMode.alias).toBeUndefined();
        expect(PlainSettings.plugins.CustomSidebarIdentity.displayName).toBe("Guest");
        expect(PlainSettings.plugins.CustomSidebarIdentity.enabled).toBe(true);
    });
});
