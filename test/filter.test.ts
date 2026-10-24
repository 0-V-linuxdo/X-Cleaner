import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { loadSettings } from "@api/Settings";
import { registerPlugin, setPluginEnabled, startPlugin, stopAllPlugins, plugins } from "@api/PluginManager";
import { getConfigStore } from "@plugins/_api/blockerConfig";
import { disposeController } from "@plugins/_api/replyFilter";
import { memoryStorage } from "@utils/storage";
import type { Plugin } from "@utils/types";
import Plugins from "~plugins";

import { cellOfTweet, flush, freshBackend, headingHtml, isHidden, mountPage, setUrl, tombstoneHtml, tweetHtml } from "./helpers";

for (const p of Object.values(Plugins)) registerPlugin(p as Plugin);

function boot() {
    for (const name of ["ReplyFilter", "AllowList", "AccountBlacklist", "PhraseBlacklist", "DomainBlacklist", "RegexBlacklist", "BuiltinClassifier", "AutoBlacklist", "RuleStats", "TombstoneFilter"]) {
        setPluginEnabled(name, true);
    }
}

beforeEach(() => {
    loadSettings(memoryStorage());
    freshBackend();
    setUrl("/op/status/1");
});

afterEach(() => {
    stopAllPlugins();
    disposeController();
    for (const p of Object.values(plugins)) p.isDependency = false;
});

describe("reply filter", () => {
    test("hides phrase hits, protects root, self and OP", async () => {
        mountPage([
            tweetHtml({ id: "1", handle: "op", text: "root 加微信" }),
            tweetHtml({ id: "2", handle: "spam1", text: "快来加微信" }),
            tweetHtml({ id: "3", handle: "me", text: "我也加微信" }),
            tweetHtml({ id: "4", handle: "op", text: "OP 加微信" }),
            tweetHtml({ id: "5", handle: "good", text: "nice post" }),
        ]);
        getConfigStore().update(c => { c.blacklists.phrases = ["加微信"]; });
        boot();
        await flush();
        expect(["1", "2", "3", "4", "5"].map(isHidden)).toEqual([false, true, false, false, false]);
        expect(getConfigStore().findAccount("spam1")?.source).toBe("local-auto");
    });

    test("manual blacklist beats OP protection; allowlist beats everything", async () => {
        mountPage([tweetHtml({ id: "1", handle: "op", text: "root" }), tweetHtml({ id: "4", handle: "op", text: "op reply" }), tweetHtml({ id: "6", handle: "friend", text: "约炮，私信我" })]);
        getConfigStore().update(c => { c.blacklists.accounts = [{ handle: "@op", source: "manual", category: "", reason: "", score: null, confidence: null, createdAt: 1 }]; c.allowHandles = ["@friend"]; });
        boot();
        await flush();
        expect(isHidden("4")).toBe(true);
        expect(isHidden("1")).toBe(false);
        expect(isHidden("6")).toBe(false);
    });

    test("recommendations after Discover more are untouched; conversation headings are not boundaries", async () => {
        mountPage([
            tweetHtml({ id: "1", handle: "op", text: "root" }),
            headingHtml("可能的垃圾信息"),
            tweetHtml({ id: "2", handle: "a", text: "spam word" }),
            headingHtml("发现更多"),
            tweetHtml({ id: "3", handle: "b", text: "spam word" }),
        ]);
        getConfigStore().update(c => { c.blacklists.phrases = ["spam word"]; });
        boot();
        await flush();
        expect(isHidden("2")).toBe(true);
        expect(isHidden("3")).toBe(false);
    });

    test("fails open when logged-in account is unknown", async () => {
        mountPage([tweetHtml({ id: "1", handle: "op", text: "root" }), tweetHtml({ id: "2", handle: "a", text: "spam word" })]);
        document.querySelector('[data-testid="AppTabBar_Profile_Link"]')!.remove();
        getConfigStore().update(c => { c.blacklists.phrases = ["spam word"]; });
        boot();
        await flush();
        expect(isHidden("2")).toBe(false);
    });

    test("tombstones are hidden except the deleted root notice", async () => {
        setUrl("/op/status/99");
        mountPage([tombstoneHtml(), tweetHtml({ id: "2", handle: "a", text: "hi" }), tombstoneHtml("This post is unavailable.")]);
        boot();
        await flush();
        const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
        expect(cells[0].getAttribute("data-xrb-hidden")).toBeNull();
        expect(cells[2].getAttribute("data-xrb-tombstone")).toBe("true");
        setPluginEnabled("TombstoneFilter", false);
        expect(cells[2].getAttribute("data-xrb-hidden")).toBeNull();
    });

    test("domain and classifier hide, t.co alone stays visible", async () => {
        mountPage([
            tweetHtml({ id: "1", handle: "op", text: "root" }),
            tweetHtml({ id: "2", handle: "a", text: "look", links: [{ href: "https://t.co/x", text: "shop.bad.example/x", expanded: "https://shop.bad.example/x" }] }),
            tweetHtml({ id: "3", handle: "b", text: "look", links: [{ href: "https://t.co/y", text: "https://t.co/y" }] }),
            tweetHtml({ id: "4", handle: "c", text: "同城裸聊可约，加微信 vx:sexy888 私信我" }),
        ]);
        getConfigStore().update(c => { c.blacklists.domains = ["bad.example", "t.co"]; });
        boot();
        await flush();
        expect([isHidden("2"), isHidden("3"), isHidden("4")]).toEqual([true, false, true]);
    });

    test("quote content is not attributed to the reply", async () => {
        mountPage([tweetHtml({ id: "1", handle: "op", text: "root" }), tweetHtml({ id: "2", handle: "a", text: "看这个", quote: { id: "77", handle: "z", text: "spam word" } })]);
        getConfigStore().update(c => { c.blacklists.phrases = ["spam word"]; });
        boot();
        await flush();
        expect(isHidden("2")).toBe(false);
        expect(cellOfTweet("2")).toBeTruthy();
    });
});
