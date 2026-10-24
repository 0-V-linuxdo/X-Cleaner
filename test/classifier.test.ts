import { describe, expect, test } from "bun:test";

import { defaultConfig } from "@config/config";
import { classify } from "@rules/classifier";

const cfg = (sensitivity: "conservative" | "balanced" | "aggressive" = "balanced") => ({ ...defaultConfig(), sensitivity });

describe("classifier", () => {
    test("约炮，私信我 depends on sensitivity", () => {
        expect(classify({ bodyText: "约炮，私信我" }, cfg("conservative")).action).toBe("allow");
        expect(classify({ bodyText: "约炮，私信我" }, cfg("balanced")).action).toBe("hide");
        expect(classify({ bodyText: "约炮，私信我" }, cfg("aggressive")).action).toBe("hide");
    });
    test("weak signals of different categories do not add up", () => {
        expect(classify({ bodyText: "私密内容，有一个空投，欢迎研究" }, cfg()).action).toBe("allow");
    });
    test("benign samples pass", () => {
        expect(classify({ bodyText: "0x52908400098527886E0F7030069857D2E4169EE7" }, cfg()).action).toBe("allow");
        expect(classify({ bodyText: "看看 $BTC" }, cfg()).action).toBe("allow");
        for (const name of ["客服", "Web3 Builder", "市场推广经理 Alice"]) expect(classify({ displayName: name, authorHandle: "alice" }, cfg()).action).toBe("allow");
    });
    test("positive samples hide", () => {
        const a = classify({ bodyText: "比她好看的没她骚@ffoo8899 8" }, cfg());
        expect([a.action, a.category]).toEqual(["hide", "adult"]);
        const n = classify({ displayName: "👉催情💊春💊🌞🎉", authorHandle: "abc" }, cfg());
        expect([n.action, n.category]).toEqual(["hide", "promotional-name"]);
        expect(classify({ bodyText: "同城裸聊可约，加微信 vx:sexy888 私信我" }, cfg()).action).toBe("hide");
        const c = classify({ bodyText: "官方空投马上领取！合约地址: 0x52908400098527886E0F7030069857D2E4169EE7 点击链接连接钱包" }, cfg());
        expect([c.action, c.category]).toEqual(["hide", "crypto"]);
        expect(n.reason.startsWith("推广用户名：")).toBe(true);
    });
    test("all categories off", () => {
        const c = { ...cfg(), categories: { adult: false, crypto: false, promotionalName: false } };
        expect(classify({ bodyText: "约炮" }, c).reason).toBe("所有内置识别类别均已关闭");
    });
    test("no signal reason", () => {
        expect(classify({ bodyText: "今天天气不错" }, cfg()).reason).toBe("未发现可疑的内置规则信号");
    });
});
