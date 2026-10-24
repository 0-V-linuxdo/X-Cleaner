/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type BlockerConfig, SENSITIVITY_THRESHOLDS } from "@config/config";
import { compactText, normalizeText } from "@x/text";

import { normalizeDomain } from "./domains";

export type CategoryId = "adult" | "crypto" | "promotional-name";

export interface Signal {
    id: string;
    family: string;
    weight: number;
    label: string;
    strong?: boolean;
}

export interface CategoryScore {
    category: CategoryId;
    score: number;
    signals: Signal[];
    positiveFamilyCount: number;
    hasStrongSignal: boolean;
    hasSemanticSignal: boolean;
}

export interface Classification {
    action: "hide" | "ai-review" | "allow";
    category: CategoryId | null;
    score: number;
    threshold: number;
    reason: string;
    signals: Signal[];
    positiveFamilyCount: number;
    hasSemanticSignal: boolean;
    autoBlacklistEligible: boolean;
    categories: CategoryScore[];
}

export interface ClassifierInput {
    bodyText?: string;
    displayName?: string;
    authorHandle?: string;
    visibleUrls?: string[];
    domains?: string[];
    mediaUrls?: string[];
}

export const CATEGORY_LABELS: Record<CategoryId, string> = { adult: "成人引流", crypto: "加密货币引流", "promotional-name": "推广用户名" };

const R = (s: string) => new RegExp(s, "iu");

const GENERIC_NEGATIVE = R("新闻|报道|研究|论文|分析|数据|监管|执法|打击|封禁|违法|犯罪|案例|科普|曝光|举报|警惕|谨防|小心|反诈|骗局|骗子|诈骗|不要上当|请勿|news|report|research|analysis|study|warning|beware|scam|fraud|expos(?:e|ed|ure)");
const CRYPTO_NEGATIVE = R("开发|代码|协议|审计|漏洞|技术|教程|白皮书|风险|不要(?:点击|购买|买入|连接|参与|领取)|不要买|developer|development|github|source code|security|audit|vulnerability|do not (?:click|buy|connect|claim)|don't (?:click|buy|connect|claim)");

const ADULT_TEMPLATE = [R("应该没人比我玩的开了吧.{0,60}(?:我福不黑|不信你看)"), R("比[我她你]好看的没[我她你]骚"), R("比[我她你]骚的没[我她你]好看"), R("太涩.{0,30}(?:我福不黑|不信你看)")];
const ADULT_CONTACT_COMBO = R("(?:加[微v薇]|微信|私信).{0,8}(?:看片|私密|裸照|福利|约炮)");
const ADULT_STRONG = [R("(?:同城|附近).{0,8}(?:约炮|裸聊|上门|空降|可约)"), R("裸聊|成人视频|成人服务|上门服务|陪睡|援交"), ADULT_CONTACT_COMBO, R("sex\\s*chat|adult\\s*service|escort\\s*service|local\\s*hookup")];
const ADULT_EXPLICIT = R("约炮|裸聊|援交|陪睡|成人服务|上门服务|可约|空降|sex\\s*chat|hookup|escort|nudes?|porn");
const ADULT_PRIVATE = R("私密(?:照|视频|内容)|福利(?:视频|资源)|无码高清|成人视频|黄推|色图|看片|福利姬|onlyfans");
const ADULT_CONTACT = R("(?:加|\\+|➕)(?:微|微信|v|薇)|(?:微信|vx|qq)[:：]?[a-z\\d_-]{4,}|(?:telegram|tg|line|whatsapp|wa)[:：@]?[a-z\\d_-]{3,}");
const ADULT_CTA = R("私信(?:我|联系|获取)|(?:点击|点开|戳)(?:主页|链接)|主页(?:有|看)|进群|扫码|免费领取|立即联系|dm\\s*me|link\\s*in\\s*bio|join\\s*(?:my|our)");
const ADULT_COMMERCE = R("价目|包夜|上门|可空降|同城|附近|全国可飞|付费|会员|一次\\s*[1-9]\\d{1,4}");
const ADULT_DOMAINS = ["onlyfans.com", "fansly.com", "manyvids.com", "pornhub.com", "xvideos.com", "xnxx.com", "stripchat.com", "chaturbate.com"];

const CRYPTO_STRONG = R("(?:免费|官方|独家|限时).{0,8}(?:空投|airdrop)|(?:空投|airdrop).{0,8}(?:领取|claim|开放|开始|马上|免费)|(?:预售|presale).{0,8}(?:开启|开始|live|now)|百倍币|千倍币|财富密码|稳赚带单|币圈带单|合约带单|buy\\s*now|claim\\s*now|guaranteed\\s*(?:profit|returns?)");
const CRYPTO_LANGUAGE = R("空投|airdrop|预售|presale|claim|\\bmint\\b|领币|发币|新币|new\\s*token|token\\s*launch|fair\\s*launch|白名单");
const CRYPTO_CTA = R("立即买入|现在买|buy\\s*now|点击领取|马上领取|连接钱包|connect\\s*(?:your\\s*)?wallet|join.{0,16}(?:group|telegram)|加入.{0,12}(?:群|社区)|进群|私信获取|link\\s*in\\s*bio|点开链接|点击链接");
const CRYPTO_CONTRACT = [R("\\b0x[a-f\\d]{40}\\b"), R("(?:\\bca\\b|合约地址|contract)\\s*[:：]\\s*[1-9a-hj-np-z]{32,44}\\b")];
const CRYPTO_PROMO_CONTEXT = R("(?:\\bca\\b|合约地址)\\s*[:：]|立即买入|buy\\s*now|进群");
const CRYPTO_CONTACT = R("t\\.me/|telegram|\\btg\\b|电报群|进群|加群");
const CRYPTO_PROFIT = R("稳赚不赔|保本收益|暴涨|百倍|千倍|\\b(?:10|50|100|1000)x\\b|to\\s*the\\s*moon|guaranteed\\s*(?:profit|returns?)");
const CRYPTO_CASHTAG = R("\\$[a-z][a-z\\d]{1,9}\\b");
const CRYPTO_DOMAINS = ["pump.fun", "dexscreener.com", "dextools.io", "geckoterminal.com", "birdeye.so"];

const NAME_STRONG = R("福利姬|裸聊.{0,4}(?:约炮|服务|客服)|约炮.{0,4}(?:客服|资源|同城)|空投.{0,4}(?:客服|助理|导师|领取)|币圈.{0,4}(?:带单|喊单|导师|助理)|(?:招商|私域).{0,4}(?:引流|推广)|(?:加[微v薇]|微信).{0,6}(?:私密|裸聊|福利|看片)|成人.{0,4}(?:资源|客服)|(?:usdt|虚拟币).{0,4}(?:客服|承兑)|(?:带单|喊单).{0,4}(?:老师|导师|助理)|同城.{0,5}(?:上门|空降|选妃|约炮)|(?:上门|空降).{0,5}(?:选妃|约炮|服务)|(?:返佣|返现).{0,6}(?:领取|客服|visa|usdt)|催情|春药|迷药");
const NAME_SUSPICIOUS = R("裸聊|约炮|福利姬|私密|成人资源|空投|带单|喊单|百倍币|财富密码");
const NAME_WEAK = R("推广|客服|招商|引流|crypto|web3");
const NAME_CONTACT = R("(?:加|\\+|➕)(?:微|微信|v|薇)|(?:微信|vx|tg|telegram|line|whatsapp|wa)[:：@]*[a-z\\d_-]{3,}");
const NAME_EMOJI = /[🔞💦💋🚀💰📈]/u;
const NAME_LEGIT = R("开发者|工程师|研究员|记者|律师|学者|产品经理|市场推广经理|品牌推广|研究院|developer|engineer|researcher|journalist|attorney|security|builder");

const countAny = (text: string, chars: string[]) => chars.reduce((n, c) => n + (text.split(c).length - 1), 0);

function hostMatches(hosts: string[], list: string[]): boolean {
    return hosts.some(h => list.some(d => h === d || h.endsWith(`.${d}`)));
}

export function linkHosts(input: ClassifierInput): string[] {
    const out = new Set<string>();
    for (const v of [...(input.domains ?? []), ...(input.visibleUrls ?? [])]) {
        const host = normalizeDomain(String(v).replace(/[……]+$/u, ""));
        if (host) out.add(host);
    }
    return [...out];
}

function score(category: CategoryId, raw: Signal[]): CategoryScore {
    const best = new Map<string, Signal>();
    for (const s of raw) {
        const cur = best.get(s.family);
        if (!cur || s.weight > cur.weight) best.set(s.family, s);
    }
    const signals = [...best.values()];
    const positive = signals.filter(s => s.weight > 0);
    return {
        category,
        score: Math.max(0, signals.reduce((n, s) => n + s.weight, 0)),
        signals,
        positiveFamilyCount: positive.length,
        hasStrongSignal: positive.some(s => s.strong),
        hasSemanticSignal: positive.some(s => s.family.endsWith("-semantic")),
    };
}

export function scoreAdult(input: ClassifierInput, hosts = linkHosts(input)): CategoryScore {
    const body = normalizeText(input.bodyText);
    const compact = compactText(input.bodyText);
    const s: Signal[] = [];
    const template = ADULT_TEMPLATE.some(r => r.test(body));
    if (template) s.push({ id: "adult-funnel-template", family: "adult-semantic", weight: 8, label: "高置信黄推引流模板", strong: true });
    const strong = ADULT_STRONG.some(r => r.test(body)) || ADULT_CONTACT_COMBO.test(compact);
    if (strong) s.push({ id: "adult-strong-service", family: "adult-semantic", weight: 8, label: "成人服务复合语义", strong: true });
    if (!template && !strong && ADULT_EXPLICIT.test(body)) s.push({ id: "adult-explicit-language", family: "adult-semantic", weight: 5, label: "露骨成人语义" });
    if (ADULT_PRIVATE.test(body)) s.push({ id: "adult-private-content", family: "adult-content", weight: 4, label: "成人或私密内容" });
    if (ADULT_CONTACT.test(compact)) s.push({ id: "adult-contact-channel", family: "adult-contact", weight: 4, label: "站外联系方式" });
    if (ADULT_CTA.test(body)) s.push({ id: "adult-call-to-action", family: "adult-action", weight: 3, label: "引流行动号召" });
    if (ADULT_COMMERCE.test(body)) s.push({ id: "adult-commercial-context", family: "adult-commerce", weight: 3, label: "交易或同城语境" });
    if (hostMatches(hosts, ADULT_DOMAINS)) s.push({ id: "adult-domain", family: "adult-domain", weight: 5, label: "成人内容域名" });
    if (countAny(body, ["🔞", "💦", "🍑", "👄", "💋"]) >= 2) s.push({ id: "adult-emoji-cluster", family: "adult-emoji", weight: 1, label: "成人导向表情组合" });
    if (s.length && GENERIC_NEGATIVE.test(body)) s.push({ id: "adult-negative-context", family: "adult-negative", weight: -3, label: "新闻、研究或反诈语境" });
    return score("adult", s);
}

export function scoreCrypto(input: ClassifierInput, hosts = linkHosts(input)): CategoryScore {
    const body = normalizeText(input.bodyText);
    const linksText = normalizeText((input.visibleUrls ?? []).join(" "));
    const negative = GENERIC_NEGATIVE.test(body) || CRYPTO_NEGATIVE.test(body);
    const promoDomain = hostMatches(hosts, CRYPTO_DOMAINS);
    const s: Signal[] = [];
    const strong = CRYPTO_STRONG.test(body);
    if (strong) s.push({ id: "crypto-strong-promotion", family: "crypto-semantic", weight: 8, label: "币圈推广复合语义", strong: true });
    const language = !strong && CRYPTO_LANGUAGE.test(body);
    if (language) s.push({ id: "crypto-promotion-language", family: "crypto-semantic", weight: 5, label: "空投、预售或发币语义" });
    const promoSemantic = strong || language;
    if (CRYPTO_CTA.test(body) && (promoSemantic || promoDomain) && !negative) s.push({ id: "crypto-call-to-action", family: "crypto-action", weight: 4, label: "买入、领取或进群号召" });
    if (CRYPTO_CONTRACT.some(r => r.test(body)) && (promoSemantic || promoDomain || CRYPTO_PROMO_CONTEXT.test(body)) && !negative) s.push({ id: "crypto-contract-address", family: "crypto-contract", weight: 4, label: "带推广语境的合约地址" });
    if (promoDomain) s.push({ id: "crypto-promotion-domain", family: "crypto-domain", weight: 4, label: "加密资产推广域名" });
    if ((promoSemantic || promoDomain) && CRYPTO_CONTACT.test(`${body} ${linksText}`) && !negative) s.push({ id: "crypto-contact-channel", family: "crypto-contact", weight: 3, label: "币圈群组或联系渠道" });
    if (CRYPTO_PROFIT.test(body)) s.push({ id: "crypto-profit-promise", family: "crypto-profit", weight: 3, label: "夸张收益或保证性话术" });
    if (CRYPTO_CASHTAG.test(body)) s.push({ id: "crypto-cashtag", family: "crypto-weak", weight: 1, label: "Cashtag 弱信号" });
    if (countAny(body, ["🚀", "💎", "🤑", "🌙"]) >= 2) s.push({ id: "crypto-emoji-cluster", family: "crypto-emoji", weight: 1, label: "币圈推广表情组合" });
    if (s.length && negative) s.push({ id: "crypto-negative-context", family: "crypto-negative", weight: -3, label: "新闻、技术或反诈语境" });
    return score("crypto", s);
}

export function scoreName(input: ClassifierInput): CategoryScore {
    const raw = input.displayName ?? "";
    const name = compactText(raw);
    const handle = (input.authorHandle ?? "").replace(/^@/, "");
    const s: Signal[] = [];
    if (NAME_STRONG.test(name)) s.push({ id: "name-strong-compound", family: "name-semantic", weight: 8, label: "推广用户名复合语义", strong: true });
    else if (NAME_SUSPICIOUS.test(name)) s.push({ id: "name-suspicious-semantic", family: "name-semantic", weight: 5, label: "成人或币圈推广语义" });
    else if (NAME_WEAK.test(name)) s.push({ id: "name-weak-role", family: "name-semantic", weight: 2, label: "弱推广角色词" });
    if (NAME_CONTACT.test(name)) s.push({ id: "name-contact-channel", family: "name-contact", weight: 4, label: "用户名含站外联系方式" });
    if (NAME_EMOJI.test(raw)) s.push({ id: "name-promotion-emoji", family: "name-emoji", weight: 1, label: "用户名含推广导向表情" });
    if (handle.length >= 8 && /[a-z]/i.test(handle) && (handle.match(/\d/g)?.length ?? 0) >= 3) s.push({ id: "name-random-handle", family: "name-handle", weight: 1, label: "英文数字混合 handle 弱信号" });
    if (s.length && NAME_LEGIT.test(normalizeText(raw))) s.push({ id: "name-legitimate-context", family: "name-negative", weight: -3, label: "职业或研究语境" });
    return score("promotional-name", s);
}

const ORDER: CategoryId[] = ["adult", "crypto", "promotional-name"];

export function classify(input: ClassifierInput, config: Pick<BlockerConfig, "categories" | "sensitivity">, aiEnabled = false): Classification {
    const threshold = SENSITIVITY_THRESHOLDS[config.sensitivity] ?? 8;
    const empty = (reason: string): Classification => ({ action: "allow", category: null, score: 0, threshold, reason, signals: [], positiveFamilyCount: 0, hasSemanticSignal: false, autoBlacklistEligible: false, categories: [] });
    const { adult, crypto, promotionalName } = config.categories;
    if (!adult && !crypto && !promotionalName) return empty("所有内置识别类别均已关闭");
    const hosts = linkHosts(input);
    const categories: CategoryScore[] = [];
    if (adult) categories.push(scoreAdult(input, hosts));
    if (crypto) categories.push(scoreCrypto(input, hosts));
    if (promotionalName) categories.push(scoreName(input));
    categories.sort((a, b) => b.score - a.score || b.positiveFamilyCount - a.positiveFamilyCount || ORDER.indexOf(a.category) - ORDER.indexOf(b.category));
    const labels = (c: CategoryScore) => c.signals.filter(s => s.weight > 0).slice(0, 3).map(s => s.label).join("、");
    const build = (action: Classification["action"], c: CategoryScore, reason: string): Classification => ({
        action, category: c.category, score: c.score, threshold, reason, signals: c.signals,
        positiveFamilyCount: c.positiveFamilyCount, hasSemanticSignal: c.hasSemanticSignal,
        autoBlacklistEligible: action === "hide" && c.score >= threshold + 2, categories,
    });
    const hideable = categories.find(c => c.score >= threshold && (c.positiveFamilyCount >= 2 || c.hasStrongSignal));
    if (hideable) return build("hide", hideable, `${CATEGORY_LABELS[hideable.category]}：${labels(hideable)}`);
    const top = categories.find(c => c.positiveFamilyCount > 0);
    if (!top) return { ...empty("未发现可疑的内置规则信号"), categories };
    if (aiEnabled) {
        const hasMedia = (input.mediaUrls ?? []).length > 0;
        const candidate = categories.find(c => (c.score >= threshold - 3 && c.score < threshold && c.positiveFamilyCount >= 2) || (hasMedia && c.hasSemanticSignal && c.score > 0));
        if (candidate) return build("ai-review", candidate, `建议 AI 复核：${labels(candidate)}`);
    }
    return build("allow", top, `低于屏蔽阈值：${labels(top)}`);
}
