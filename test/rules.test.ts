import { describe, expect, test } from "bun:test";

import { defaultConfig, normalizeConfig, prepareImport } from "@config/config";
import { domainWarning, normalizeDomain } from "@rules/domains";
import { matchDomain, matchPhrase } from "@rules/lists";
import { isSafeSource, normalizeRegexRules, validateRegex } from "@rules/regex";
import { runRegexRules } from "@rules/regex-runner";
import { breadthCheck, checkCandidate, exactFallback, phraseRule } from "@rules/safety";
import { fieldValues, synthesizeLocalRule } from "@rules/synthesizer";
import { parseRoute } from "@x/route";

describe("route", () => {
    test("status routes", () => {
        expect(parseRoute("https://x.com/Foo/status/123/photo/1").routeKey).toBe("foo/status/123");
        expect(parseRoute("https://mobile.twitter.com/i/web/status/9").routeKey).toBe("i/status/9");
        expect(parseRoute("https://x.com.evil.com/a/status/1").active).toBe(false);
        expect(parseRoute("https://x.com/home").isStatusRoute).toBe(false);
    });
});

describe("lists", () => {
    test("phrase matching is NFKC + zero width insensitive", () => {
        expect(matchPhrase(["加微信"], { bodyText: "快来加​微信" })?.phrase).toBe("加微信");
        expect(matchPhrase(["abc"], { bodyText: "ＡＢＣ" })?.field).toBe("body");
        expect(matchPhrase(["spam"], { authorHandle: "spammer" })?.field).toBe("handle");
    });
    test("domain matching", () => {
        expect(normalizeDomain("例子.中国")).toBe("xn--fsqu00a.xn--fiqs8s");
        expect(matchDomain(["example.com"], { visibleUrls: ["https://a.example.com/x"] })?.domain).toBe("example.com");
        expect(matchDomain(["t.co"], { visibleUrls: ["https://t.co/abc"] })).toBeNull();
        expect(domainWarning("bit.ly").warning?.level).toBe("warning");
        expect(domainWarning("com").warning?.message).toContain("过宽");
        expect(domainWarning("::").warning?.level).toBe("error");
    });
});

describe("regex", () => {
    test("validation", () => {
        expect(validateRegex("a", "g", ["body"]).errorCode).toBe("stateful-flags");
        expect(validateRegex("a", "x", ["body"]).error).toBe("不支持的 flags：x");
        expect(validateRegex("(", "", ["body"]).errorCode).toBe("invalid-expression");
        expect(validateRegex("a", "i", []).errorCode).toBe("missing-fields");
    });
    test("normalization keeps invalid imports invalid and dedupes ids", () => {
        const rules = normalizeRegexRules([{ id: "a", source: "x", flags: "gi", fields: ["text"] }, { id: "a", pattern: "y", field: "name" }, { source: "z", fields: ["nope"] }]);
        expect(rules.map(r => r.id)).toEqual(["a", "a-2", "regex-3"]);
        expect(rules[0].valid).toBe(false);
        expect(rules[1].fields).toEqual(["displayName"]);
        expect(rules[2].errorCode).toBe("invalid-fields");
        expect(rules[2].enabled).toBe(false);
    });
    test("safe source detection", () => {
        expect(isSafeSource("加[微v薇].{0,8}看片")).toBe(true);
        expect(isSafeSource("a\\s*b")).toBe(true);
        expect(isSafeSource("(a+)+")).toBe(false);
        expect(isSafeSource("a{2,}")).toBe(false);
        expect(isSafeSource("(a)\\1")).toBe(false);
    });
    test("worker timeout disables only the running unsafe rule", async () => {
        const base = { enabled: true, valid: true, error: null, errorCode: null, flags: "", fields: ["body" as const] };
        const r = await runRegexRules([{ ...base, id: "s", name: "s", source: "zzz" }, { ...base, id: "evil", name: "e", source: "(a+)+$x" }], { body: "a".repeat(32) + "!", displayName: "", handle: "", links: "" });
        expect(r.status).toBe("timeout");
        expect(r.timedOutRuleIds).toEqual(["evil"]);
    });
});

describe("config", () => {
    test("import forces AI off and drops keys", () => {
        const c = prepareImport({ ai: { enabled: true, consented: true, apiKey: "sk", endpoint: "https://e.example/v1" }, apiKey: "x", whitelist: ["@A"], manualHandles: ["b"], autoBlacklist: [{ handle: "c", source: "ai" }] });
        expect(c.ai.enabled).toBe(false);
        expect(c.ai.consented).toBe(false);
        expect(c.ai.endpoint).toBe("https://e.example/v1");
        expect(JSON.stringify(c)).not.toContain("sk");
        expect(c.allowHandles).toEqual(["@a"]);
        expect(c.blacklists.accounts.map(a => [a.handle, a.source])).toEqual([["@b", "manual"], ["@c", "ai-auto"]]);
    });
    test("normalization clamps", () => {
        const c = normalizeConfig({ sensitivity: "x", enabled: 0, ai: { concurrency: 9, timeoutMs: "1" } });
        expect(c.sensitivity).toBe("balanced");
        expect(c.enabled).toBe(true);
        expect(c.ai.concurrency).toBe(4);
        expect(c.ai.timeoutMs).toBe(5000);
        expect(defaultConfig().ai.model).toBe("gpt-4o-mini");
    });
});

describe("rule drafting", () => {
    test("breadth check", () => {
        expect(breadthCheck({ name: "", source: ".*", flags: "", fields: ["body"] })).toContain("catch-all");
        expect(breadthCheck({ name: "", source: "airdrop", flags: "i", fields: ["body"] })).toContain("generic");
        expect(breadthCheck({ name: "", source: "hello", flags: "i", fields: ["body"] })).toContain("two durable");
        expect(breadthCheck({ name: "", source: "^bob$", flags: "i", fields: ["handle"] })).toBeNull();
        expect(breadthCheck({ name: "", source: "约炮", flags: "iu", fields: ["body"] })).toBeNull();
    });
    test("candidate validation rejects canaries and accepts templates", async () => {
        const target = fieldValues({ bodyText: "比她好看的没她骚比她骚的没她好看@txx7iu 👰0", displayName: "Amy", authorHandle: "txx7iu" });
        const draft = synthesizeLocalRule({ bodyText: target.body })!;
        const ok = await checkCandidate({ rule: draft.rule, target });
        expect(ok.valid).toBe(true);
        const bad = await checkCandidate({ rule: { name: "x", source: "私信", flags: "iu", fields: ["body"] }, target: fieldValues({ bodyText: "私信我 看片 福利" }), skipBreadth: true });
        expect(bad.code).toBe("canary-match");
        expect(bad.targetMatch).toBe(true);
        expect(bad.canarySafe).toBe(false);
    });
    test("exact fallback and phrase rule", () => {
        const values = fieldValues({ bodyText: "ok", displayName: "", authorHandle: "spam_bot99" });
        expect(exactFallback(values)?.rule.source).toBe("^spam_bot99$");
        const p = phraseRule([{ phrase: "看片", field: "body" }, { phrase: "福利", field: "displayName" }]);
        expect(p?.rule.fields).toEqual(["displayName"]);
        expect(p?.rule.source).toBe("(?:看片|福利)");
    });
});
