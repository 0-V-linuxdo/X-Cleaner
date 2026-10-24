import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { setTransport } from "@ai/transport";
import { loadSettings } from "@api/Settings";
import { plugins, registerPlugin, setPluginEnabled, startPlugin, stopAllPlugins } from "@api/PluginManager";
import { getConfigStore } from "@plugins/_api/blockerConfig";
import { disposeController, getController } from "@plugins/_api/replyFilter";
import { requestAiReview } from "@plugins/aiReview";
import { getPanel } from "@plugins/panel";
import { parseImport } from "@plugins/panel/importExport";
import { analyze, encodeSelection, parseSelection, selectionPhrase } from "@plugins/ruleDraft/analysis";
import { activeDraft } from "@plugins/ruleDraft";
import { fieldValues } from "@rules/synthesizer";
import { memoryStorage } from "@utils/storage";
import type { Plugin } from "@utils/types";
import Plugins from "~plugins";

import { flush, freshBackend, isHidden, mountPage, setUrl, tweetHtml } from "./helpers";

for (const p of Object.values(Plugins)) registerPlugin(p as Plugin);

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function bootAll() {
    for (const p of Object.values(plugins)) {
        if (p.required) startPlugin(p);
        else if (p.enabledByDefault) setPluginEnabled(p.name, true);
    }
}

const host = () => document.getElementById("x-cleaner-ui")!;
const tabs = () => [...host().querySelectorAll<HTMLElement>(".xc-main-tabs [role=tab]")].map(t => t.textContent);
const buttonByText = (root: ParentNode, text: string) => [...root.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text)!;

beforeEach(() => {
    loadSettings(memoryStorage());
    freshBackend();
    setUrl("/op/status/1");
    mountPage([
        tweetHtml({ id: "1", handle: "op", text: "root" }),
        tweetHtml({ id: "2", handle: "spam1", name: "Spammer", text: "快来加微信领取" }),
        tweetHtml({ id: "3", handle: "good", text: "nice post" }),
    ]);
});

afterEach(() => {
    setTransport(null);
    stopAllPlugins();
    disposeController();
    for (const p of Object.values(plugins)) p.isDependency = false;
});

describe("panel", () => {
    test("registers tabs from plugins and lists hidden replies with working actions", async () => {
        getConfigStore().update(c => { c.blacklists.phrases = ["加微信"]; c.autoBlacklistAccounts = false; });
        bootAll();
        await wait(80);
        expect(isHidden("2")).toBe(true);
        const panel = getPanel()!;
        expect(host().querySelector(".xc-fab-badge")!.textContent).toBe("1");
        panel.show("review");
        expect(tabs()).toEqual(["复查", "黑名单", "白名单", "设置", "插件"]);
        const options = host().querySelectorAll("[role=option]");
        expect(options.length).toBe(1);
        expect(options[0].textContent).toContain("词语");
        const footer = host().querySelector(".xc-drawer-footer")!;
        expect(footer.textContent).toContain("已选 Spammer · @spam1");
        expect(buttonByText(footer, "加入黑名单")).toBeTruthy();
        buttonByText(footer, "恢复").click();
        await wait(80);
        expect(isHidden("2")).toBe(false);
        expect(host().querySelector(".xc-empty")!.textContent).toBe("当前对话暂无已隐藏回复。");
    });

    test("blacklist defaults to the accounts subpage; the phrase form saves", async () => {
        bootAll();
        await flush();
        const panel = getPanel()!;
        panel.show("blacklist");
        const sub = [...host().querySelectorAll(".xc-sub-tabs [role=tab]")].map(t => [t.textContent, t.getAttribute("aria-selected")]);
        expect(sub).toEqual([["词语", "false"], ["域名", "false"], ["正则", "false"], ["账号", "true"]]);
        panel.show("blacklist", "phrases");
        const input = host().querySelector<HTMLInputElement>('input[placeholder="要屏蔽的词语"]')!;
        input.value = "  ＶＸ领取 ";
        input.closest("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
        expect(getConfigStore().config.blacklists.phrases).toEqual(["vx领取"]);
        await wait(80);
        expect(isHidden("2")).toBe(false);
    });

    test("import turns AI off and keeps the stored API key", () => {
        bootAll();
        const store = getConfigStore();
        store.setApiKey("sk-test");
        store.importConfig(parseImport(JSON.stringify({ ai: { enabled: true, consented: true, endpoint: "https://example.com/v1", apiKey: "leak" } })));
        expect(store.config.ai.enabled).toBe(false);
        expect(store.config.ai.endpoint).toBe("https://example.com/v1");
        expect(store.apiKey).toBe("sk-test");
        expect(store.exportConfig()).not.toContain("sk-test");
        expect(() => parseImport("[]")).toThrow("配置必须是 JSON 对象。");
        expect(() => parseImport(JSON.stringify({ blacklists: { regexRules: [{ name: "坏", source: "(", fields: ["body"] }] } }))).toThrow("正则规则无效：坏");
    });
});

describe("AI review", () => {
    test("a confident malicious verdict hides the reply and records the AI status", async () => {
        const store = getConfigStore();
        store.update(c => { c.ai.enabled = true; c.ai.consented = true; c.autoBlacklistAccounts = false; });
        store.setApiKey("k");
        const bodies: any[] = [];
        setTransport(async opts => {
            bodies.push(opts.body);
            return { choices: [{ message: { content: '{"verdict":"crypto","confidence":0.95,"reason":"空投引流"}' } }] };
        });
        bootAll();
        await wait(20);
        const ctx = getController().liveContext("3")!;
        expect(requestAiReview({ ...ctx, article: undefined, cell: undefined } as any)).toBe(true);
        await wait(80);
        expect(bodies.length).toBe(1);
        expect(isHidden("3")).toBe(true);
        const rec = getController().records.get("3")!;
        expect(rec.source).toBe("ai");
        expect(rec.aiStatus).toBe("AI：空投引流（95%）");
        expect(store.findAccount("good")).toBeUndefined();
        // A rescan keeps the AI decision.
        getController().configurationChanged();
        await wait(20);
        expect(isHidden("3")).toBe(true);
    });

    test("confidence ≥ 0.9 adds an ai-auto account entry", async () => {
        const store = getConfigStore();
        store.update(c => { c.ai.enabled = true; c.ai.consented = true; });
        setTransport(async () => ({ choices: [{ message: { content: '{"verdict":"adult","confidence":0.92,"reason":"成人引流"}' } }] }));
        bootAll();
        await wait(20);
        const ctx = getController().liveContext("3")!;
        requestAiReview({ ...ctx } as any);
        await wait(80);
        expect(isHidden("3")).toBe(true);
        expect(store.findAccount("good")?.source).toBe("ai-auto");
        expect(store.findAccount("good")?.category).toBe("adult");
    });

    test("nothing is sent when AI is off", () => {
        let calls = 0;
        setTransport(async () => { calls++; return {}; });
        bootAll();
        const ctx = getController().liveContext("3")!;
        expect(requestAiReview({ ...ctx } as any)).toBe(false);
        expect(calls).toBe(0);
    });
});

describe("rule draft", () => {
    test("selection encoding round-trips and validates phrases", () => {
        const selected = [{ phrase: "领取", field: "body" as const }, { phrase: "vx", field: "displayName" as const }];
        expect(encodeSelection(selected)).toBe("请根据用户勾选的词语生成可复用规则，优先命中：领取、vx（显示名）");
        expect(parseSelection(encodeSelection(selected))).toEqual(selected);
        expect(selectionPhrase("币")).toBe("币");
        expect(selectionPhrase("a")).toBeNull();
        expect(selectionPhrase("!!")).toBeNull();
    });

    test("body-only selection uses the phrase rule when AI is unavailable (现状 fix)", async () => {
        const values = fieldValues({ bodyText: "今天免费领取空投，私信我", displayName: "Bob", authorHandle: "bob123" });
        const result = await analyze(encodeSelection([{ phrase: "领取空投", field: "body" }]), {
            values, negatives: [], protectedContexts: [], aiUnavailable: "AI 未启用或尚未确认数据发送范围",
            runAi: () => Promise.reject(new Error("should not run")), targetIntact: () => true,
        });
        expect(result.draft.origin).toBe("phrase-selection");
        expect(result.draft.rule).toEqual({ name: "划词：领取空投", source: "领取空投", flags: "iu", fields: ["body"] });
    });

    test("AI errors fall back to a local draft with the spec reason", async () => {
        const values = fieldValues({ bodyText: "比她好看的没她骚比她骚的没她好看@txx7iu 👰0", displayName: "Amy", authorHandle: "amy" });
        const result = await analyze("重新生成", {
            values, negatives: [], protectedContexts: [], aiUnavailable: null,
            runAi: () => Promise.reject(new Error("AI request timed out.")), targetIntact: () => true,
        });
        expect(result.draft.reason).toBe("AI 分析暂未完成（AI request timed out.）；已生成本地可复用规则，仍需你确认保存。");
        expect(result.draft.origin).not.toBe("ai");
    });

    test("the shield opens a local draft without calling AI and saving hides the reply", async () => {
        let calls = 0;
        setTransport(async () => { calls++; return {}; });
        bootAll();
        await wait(50);
        const shield = document.querySelector<HTMLButtonElement>('[data-xrb-inline-rule]');
        expect(shield).toBeTruthy();
        // Root and self never get a shield; only replies 2 and 3 do.
        expect(document.querySelectorAll("[data-xrb-inline-rule]").length).toBe(2);
        const slot = shield!.closest("[data-xrb-inline-rule-slot]")!;
        expect(slot.nextElementSibling?.querySelector('[aria-label="Grok actions"]')).toBeTruthy();
        // Untrusted clicks are ignored.
        shield!.click();
        expect(activeDraft()).toBeNull();
    });
});

describe("plugin manager", () => {
    test("opens on favorites, lists required plugins last and toggles plugins", async () => {
        const { openSettingsPanel } = await import("@plugins/_core/settings/panel");
        bootAll();
        const close = openSettingsPanel();
        const active = () => document.querySelector(".xc-pm-tab.is-active")!.textContent;
        expect(active()).toBe("收藏");
        expect(document.querySelector(".xc-pm-empty")!.textContent).toBe("还没有收藏。给插件点星后会出现在这里。");
        buttonByText(document.querySelector(".xc-pm-tabs")!, "全部").click();
        const cards = [...document.querySelectorAll<HTMLElement>(".xc-pm-card")];
        const names = cards.map(c => c.dataset.plugin);
        expect(names.slice(-2)).toEqual(["ReplyFilter", "Settings"]);
        expect(cards.at(-1)!.classList.contains("is-required")).toBe(true);
        expect(cards.at(-1)!.querySelector<HTMLButtonElement>(".xc-switch")!.disabled).toBe(true);
        expect(cards[0].querySelector(".xc-pm-card-author")!.textContent).toBe("X Cleaner Contributors");
        expect(document.querySelector('.xc-pm-card[data-plugin="AccountBlacklist"] .xc-pm-card-title wbr')).toBeTruthy();
        document.querySelector<HTMLButtonElement>('.xc-pm-card[data-plugin="RuleStats"] .xc-switch')!.click();
        expect(plugins.RuleStats.started).toBe(false);
        close();
        expect(document.querySelector(".xc-pm-shell")).toBeNull();
    });
});
