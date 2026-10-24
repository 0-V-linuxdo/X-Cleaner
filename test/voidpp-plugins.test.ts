import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { plugins, registerPlugin, setPluginEnabled, stopAllPlugins } from "@api/PluginManager";
import { loadSettings, PlainSettings, Settings } from "@api/Settings";
import { flushNow } from "@plugins/_api/domObserver";
import { disposeController } from "@plugins/_api/replyFilter";
import { closeMenu, contextForCaret, fillMenu, ITEM_ATTR } from "@plugins/_api/postMenu";
import { formatTime } from "@plugins/absoluteTimestamps";
import { buildCss as linkCss, expandedUrl } from "@plugins/betterLinks";
import { AD_ATTR, buildCss as declutterCss, isAdTweet, stripTitleCount } from "@plugins/declutter";
import { buildCss as postEntriesCss, RULES as POST_ENTRY_RULES } from "@plugins/hidePostEntries";
import { buildCss as rightSidebarCss, DIVIDER as SIDEBAR_DIVIDER, RULES as SIDEBAR_RULES } from "@plugins/rightSidebarCleaner";
import { ENTRY_ATTR, fillMoreMenu } from "@plugins/moreMenuEntry";
import { resetHealth, runChecks } from "@plugins/selectorHealth";
import { buildCss as streamerCss } from "@plugins/streamerMode";
import { buildCss as widerCss } from "@plugins/widerTimeline";
import { memoryStorage } from "@utils/storage";
import definePlugin, { type Plugin } from "@utils/types";
import Plugins from "~plugins";

import { freshBackend, mountPage, tweetHtml } from "./helpers";

for (const p of Object.values(Plugins)) if (!plugins[(p as Plugin).name]) registerPlugin(p as Plugin);

const styleText = (name: string) => document.querySelector<HTMLStyleElement>(`style[data-xc="${name}"]`)?.textContent ?? "";

beforeEach(() => {
    loadSettings(memoryStorage());
    freshBackend();
    document.body.innerHTML = "";
});

afterEach(() => {
    stopAllPlugins();
    disposeController();
    resetHealth();
    for (const p of Object.values(plugins)) p.isDependency = false;
    document.body.innerHTML = "";
});

describe("Declutter", () => {
    test("builds one hiding rule per enabled switch", () => {
        expect(declutterCss({})).toBe("");
        const css = declutterCss({ hidePromoted: true, hideViewCounts: true });
        expect(css).toContain(AD_ATTR);
        expect(css).toContain('a[href$="/analytics"]');
        expect(css).not.toContain("premium");
    });

    test("the Grok-button rule never hides the reply shield", () => {
        expect(declutterCss({ hideGrokButtons: true })).toContain(":not([data-xrb-inline-rule])");
    });

    test("marks promoted posts by placement wrapper or bare 「Ad」 label, not by display names", () => {
        mountPage([
            tweetHtml({ id: "1", handle: "a", text: "normal" }),
            tweetHtml({ id: "2", handle: "ad", name: "Ad", text: "named Ad" }),
            tweetHtml({ id: "3", handle: "b", text: "ad text", promoted: true }),
        ]);
        const arts = [...document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')];
        arts[0].querySelector('[role="group"]')!.insertAdjacentHTML("beforebegin", "<div><span>Ad</span></div>");
        expect(arts.map(isAdTweet)).toEqual([true, false, true]);
    });

    test("strips the unread count from titles", () => {
        expect(stripTitleCount("(3) Home / X")).toBe("Home / X");
        expect(stripTitleCount("(20+) 主页 / X")).toBe("主页 / X");
        expect(stripTitleCount("Home / X")).toBe("Home / X");
    });

    test("running plugin injects CSS, marks ad cells and cleans up on stop", () => {
        mountPage([tweetHtml({ id: "9", handle: "p", text: "x", promoted: true })]);
        setPluginEnabled("Declutter", true);
        flushNow();
        expect(styleText("declutter:rules")).toContain("data-xc-ad");
        expect(document.querySelector(`[${AD_ATTR}]`)).not.toBeNull();
        Settings.plugins.Declutter.hidePromoted = false;
        expect(styleText("declutter:rules")).not.toContain("data-xc-ad");
        setPluginEnabled("Declutter", false);
        expect(styleText("declutter:rules")).toBe("");
        expect(document.querySelector(`[${AD_ATTR}]`)).toBeNull();
    });
});

describe("RightSidebarCleaner", () => {
    const sidebar = `<div data-testid="sidebarColumn"><div>
        <div id="search"><form role="search"><input></form></div><div id="spacer"></div><div id="divider"></div>
        <div id="trends"><section><div data-testid="trend">t</div></section></div>
        <div id="follow"><div><aside><div data-testid="UserCell">u</div></aside></div></div>
        <div id="footer"><nav role="navigation"><a href="/tos">Terms</a></nav></div>
    </div></div>`;

    test("builds one rule per switch", () => {
        expect(rightSidebarCss({})).toBe("");
        const css = rightSidebarCss({ hideTrends: true, hideFooter: true });
        expect(css).toContain('[data-testid="trend"]');
        expect(css).toContain('nav[role="navigation"]');
        expect(css).not.toContain("UserCell");
        expect(css).toContain(SIDEBAR_DIVIDER);
    });

    test("each rule matches only its own card", () => {
        document.body.innerHTML = sidebar;
        // happy-dom reads `:has(> …)` loosely and also matches the unnamed column wrapper, so only
        // the named cards are compared; on x.com each rule matches exactly one wrapper.
        const ids = (sel: string) => [...document.querySelectorAll(sel)].map(e => e.id).filter(Boolean);
        expect(ids(SIDEBAR_RULES.hideTrends)).toEqual(["trends"]);
        expect(ids(SIDEBAR_RULES.hideWhoToFollow)).toEqual(["follow"]);
        expect(ids(SIDEBAR_RULES.hideFooter)).toEqual(["footer"]);
        // happy-dom also ignores the complex :not() that spares the search spacer; Chrome honours it.
        expect(ids(SIDEBAR_DIVIDER)).toContain("divider");
        expect(SIDEBAR_DIVIDER).toContain(':not(div:has(form[role="search"]) + div)');
    });

    test("is on by default with all three cards hidden, and cleans up on stop", () => {
        expect(plugins.RightSidebarCleaner.enabledByDefault).toBe(true);
        setPluginEnabled("RightSidebarCleaner", true);
        const css = styleText("rightSidebarCleaner:rules");
        expect(css).toContain("trend");
        expect(css).toContain("UserCell");
        expect(css).toContain("navigation");
        Settings.plugins.RightSidebarCleaner.hideWhoToFollow = false;
        expect(styleText("rightSidebarCleaner:rules")).not.toContain("UserCell");
        setPluginEnabled("RightSidebarCleaner", false);
        expect(styleText("rightSidebarCleaner:rules")).toBe("");
    });
});

describe("HidePostEntries", () => {
    test("hides the Home post box and the sidebar Post button, but not a post page's reply box", () => {
        document.body.innerHTML = `
            <header><nav></nav><div id="post"><a data-testid="SideNav_NewTweet_Button" href="/compose/post"></a></div></header>
            <main><div data-testid="primaryColumn"><div>
                <div id="tabs"></div>
                <div id="composer"><div><div data-testid="tweetTextarea_0"></div></div></div>
                <div id="list"><div data-testid="cellInnerDiv"><div><div data-testid="tweetTextarea_0"></div></div></div></div>
            </div></div></main>`;
        const ids = (sel: string) => [...document.querySelectorAll(sel)].map(e => e.id).filter(Boolean);
        expect(ids(POST_ENTRY_RULES.hideHomeComposer)).toEqual(["composer"]);
        expect(ids(POST_ENTRY_RULES.hideSideNavButton)).toEqual(["post"]);
    });

    test("follows its switches and cleans up on stop", () => {
        expect(postEntriesCss({})).toBe("");
        expect(postEntriesCss({ hideSideNavButton: true })).not.toContain("tweetTextarea_0");
        expect(plugins.HidePostEntries.enabledByDefault).toBe(true);
        setPluginEnabled("HidePostEntries", true);
        expect(styleText("hidePostEntries:rules")).toContain("SideNav_NewTweet_Button");
        Settings.plugins.HidePostEntries.hideHomeComposer = false;
        expect(styleText("hidePostEntries:rules")).not.toContain("tweetTextarea_0");
        setPluginEnabled("HidePostEntries", false);
        expect(styleText("hidePostEntries:rules")).toBe("");
    });
});

describe("StreamerMode and WiderTimeline", () => {
    test("blur targets follow the switches and the detected handle", () => {
        const css = streamerCss({ accountAvatar: true, accountName: false, ownAvatars: true, revealOnHover: true, blur: 6 }, "me_1");
        expect(css).toContain('UserAvatar-Container-me_1" i]');
        expect(css).toContain("blur(6px)");
        expect(css).toContain(":hover");
        expect(streamerCss({ ownAvatars: true }, "")).toBe("");
    });

    test("wider column keeps room for the sidebar unless it is hidden", () => {
        expect(widerCss(800, false)).toContain("width: 1190px");
        expect(widerCss(800, false)).toContain("max-width: 800px");
        const noSide = widerCss(900, true);
        expect(noSide).toContain("width: 900px");
        expect(noSide).toContain('sidebarColumn"] { display: none');
    });
});

describe("AbsoluteTimestamps", () => {
    const now = new Date(2026, 9, 23, 22, 0);
    test("smart format shortens today and this year", () => {
        expect(formatTime(new Date(2026, 9, 23, 14, 5), "smart", now)).toBe("14:05");
        expect(formatTime(new Date(2026, 0, 2, 3, 4), "smart", now)).toBe("01-02 03:04");
        expect(formatTime(new Date(2025, 9, 23, 14, 5), "smart", now)).toBe("2025-10-23 14:05");
        expect(formatTime(new Date(2026, 9, 23, 14, 5, 9), "seconds", now)).toBe("2026-10-23 14:05:09");
        expect(formatTime(new Date(2026, 9, 23, 14, 5), "full", now)).toBe("2026-10-23 14:05");
    });

    test("labels post times through an attribute and removes it on stop", () => {
        mountPage([tweetHtml({ id: "5", handle: "t", text: "x" })]);
        document.querySelector("time")!.setAttribute("datetime", "2026-10-23T18:29:37.000Z");
        setPluginEnabled("AbsoluteTimestamps", true);
        flushNow();
        const time = document.querySelector("time")!;
        expect(time.getAttribute("data-xc-abs")).toMatch(/\d\d:\d\d/);
        expect(time.textContent).toBe("1h");
        setPluginEnabled("AbsoluteTimestamps", false);
        expect(time.hasAttribute("data-xc-abs")).toBe(false);
    });
});

describe("BetterLinks", () => {
    const link = (html: string) => {
        document.body.innerHTML = `<article data-testid="tweet"><div data-testid="tweetText">${html}</div></article>`;
        return document.querySelector("a")!;
    };

    test("reads the real address X prints in a t.co link", () => {
        const a = link('<a href="https://t.co/JOfGG0mTx2"><span aria-hidden="true">https://</span>github.com/zen-browser/de<span aria-hidden="true">sktop</span><span aria-hidden="true">…</span></a>');
        expect(expandedUrl(a)).toBe("https://github.com/zen-browser/desktop");
        expect(expandedUrl(link('<a href="https://t.co/x">pic.x.com/abc</a>'))).toBe("https://pic.x.com/abc");
        expect(expandedUrl(link('<a href="https://t.co/x">Read more</a>'))).toBeNull();
        expect(expandedUrl(link('<a href="https://t.co/x"><span>From github.com</span></a>'))).toBeNull();
        expect(expandedUrl(link('<a href="/someone">@someone</a>'))).toBeNull();
    });

    test("rewrites a link only when pointed at, and restores it on stop", () => {
        const a = link('<a href="https://t.co/abc"><span>https://</span>example.com/page</a>');
        setPluginEnabled("BetterLinks", true);
        expect(a.getAttribute("href")).toBe("https://t.co/abc");
        a.dispatchEvent(new Event("pointerover", { bubbles: true }));
        expect(a.getAttribute("href")).toBe("https://example.com/page");
        expect(a.title).toBe("https://example.com/page");
        setPluginEnabled("BetterLinks", false);
        expect(a.getAttribute("href")).toBe("https://t.co/abc");
    });

    test("only valid colours become CSS", () => {
        expect(linkCss("", "")).toBe("");
        expect(linkCss("#ff0000", "purple")).toContain(":visited");
        expect(linkCss("red; } body { display:none", "")).toBe("");
    });
});

function mountMenu(rows: string) {
    document.body.insertAdjacentHTML("beforeend", `<div id="layers"><div><div class="backdrop" style="height:500px"></div><div role="menu"><div data-testid="Dropdown">${rows}</div></div></div></div>`);
    const backdrop = document.querySelector<HTMLElement>("#layers .backdrop")!;
    backdrop.getBoundingClientRect = () => ({ height: 500 } as DOMRect);
    let closed = 0;
    backdrop.addEventListener("click", () => { closed++; document.querySelector("#layers")!.remove(); });
    return { menu: document.querySelector('[role="menu"]')!, closed: () => closed };
}

const ROW = (text: string, testid = "") => `<div role="menuitem" tabindex="0"${testid ? ` data-testid="${testid}"` : ""}><div><svg viewBox="0 0 24 24" class="r-icon"><g></g></svg></div><div><div dir="ltr"><span>${text}</span></div></div></div>`;

describe("post menu", () => {
    test("finds the post behind its own caret, but not a quoted card's", () => {
        mountPage([tweetHtml({ id: "11", handle: "alice", text: "hi" })]);
        const ctx = contextForCaret(document.querySelector('[data-testid="caret"]')!);
        expect(ctx).toMatchObject({ tweetId: "11", handle: "alice" });
        expect(contextForCaret(document.querySelector("header")!)).toBeNull();
    });

    test("blacklist and allowlist rows are cloned from X's row, and running one closes the menu", async () => {
        setPluginEnabled("AccountBlacklist", true);
        setPluginEnabled("AllowList", true);
        mountPage([tweetHtml({ id: "12", handle: "spammer", text: "buy" })], "me");
        const ctx = contextForCaret(document.querySelector('[data-testid="caret"]')!)!;
        const { menu, closed } = mountMenu(ROW("Mute") + ROW("Block @spammer", "block"));
        const rows = fillMenu(menu, ctx);
        expect(rows.map(r => r.getAttribute(ITEM_ATTR))).toEqual(["account-blacklist", "allow-list"]);
        expect(rows[0].textContent).toBe("加入 X Cleaner 黑名单：@spammer");
        expect(rows[0].querySelector("svg")!.getAttribute("class")).toBe("r-icon");
        expect(rows[0].hasAttribute("data-testid")).toBe(false);
        expect(fillMenu(menu, ctx)).toEqual([]);
        rows[0].click();
        await Promise.resolve();
        await Promise.resolve();
        expect(closed()).toBe(1);
        const { getConfigStore } = await import("@plugins/_api/blockerConfig");
        expect(getConfigStore().findAccount("spammer")?.source).toBe("manual");
    });

    test("no rows for your own posts", () => {
        setPluginEnabled("AccountBlacklist", true);
        mountPage([tweetHtml({ id: "13", handle: "me", text: "mine" })], "me");
        const ctx = contextForCaret(document.querySelector('[data-testid="caret"]')!)!;
        const { menu } = mountMenu(ROW("Mute"));
        expect(fillMenu(menu, ctx)).toEqual([]);
    });

    test("closeMenu falls back to Escape without a backdrop", () => {
        document.body.innerHTML = '<div><div role="menu"></div></div>';
        let esc = false;
        document.addEventListener("keydown", e => { if (e.key === "Escape") esc = true; }, { once: true });
        closeMenu(document.querySelector('[role="menu"]')!);
        expect(esc).toBe(true);
    });
});

describe("MoreMenuEntry", () => {
    test("adds the manager entry and one switch per starred plugin", () => {
        PlainSettings.core.starredPlugins = ["Declutter", "Settings"];
        setPluginEnabled("MoreMenuEntry", true);
        const { menu } = mountMenu('<div><div><a href="/settings" role="link" data-testid="settings"><svg class="r-icon"></svg><div dir="ltr"><span>Settings and privacy</span></div></a></div></div>');
        const rows = fillMoreMenu(menu);
        expect(rows.map(r => r.getAttribute(ENTRY_ATTR))).toEqual(["manager", "plugin:Declutter"]);
        expect(rows[0].textContent).toBe("X Cleaner 插件管理");
        expect(rows[0].querySelector("a")!.hasAttribute("href")).toBe(false);
        expect(rows[1].textContent).toBe("启用 Declutter");
        rows[1].click();
        expect(plugins.Declutter.started).toBe(true);
    });
});

describe("SelectorHealth", () => {
    test("reports a selector only after two consecutive misses, and clears it once it matches again", () => {
        const p = definePlugin({ name: "HealthProbe", description: "", healthChecks: [{ id: "x", label: "测试元素", selector: "#probe-target" }] });
        registerPlugin(p);
        setPluginEnabled(p.name, true);
        expect(runChecks().pending).toBe(true);
        expect(p.healthWarnings).toBeUndefined();
        runChecks();
        expect(p.healthWarnings).toEqual(["测试元素"]);
        expect(document.querySelector(".xc-notice")?.textContent).toContain("HealthProbe 找不到「测试元素」");
        document.body.insertAdjacentHTML("beforeend", '<div id="probe-target"></div>');
        runChecks();
        expect(p.healthWarnings).toBeUndefined();
    });

    test("checks whose condition does not hold are skipped", () => {
        const p = definePlugin({ name: "HealthProbe2", description: "", healthChecks: [{ id: "y", label: "y", selector: "#nope", when: () => false }] });
        registerPlugin(p);
        setPluginEnabled(p.name, true);
        runChecks();
        runChecks();
        expect(p.healthWarnings).toBeUndefined();
    });
});
