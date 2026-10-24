/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showToast } from "@ui/toast";
import { attachTooltip, type TooltipHandle } from "@ui/tooltip";
import { Icons } from "@ui/icons";
import { N_, t } from "@utils/i18n";
import { Logger } from "@utils/Logger";
import definePlugin, { StartAt } from "@utils/types";
import { contextSignature, findPrimaryColumn, isInNestedStatusCard, listTopLevelTweets, OWNED_ATTR, type ReplyContext, SEL } from "@x/dom";

import { eligibleReplyContext, getController, isFilterActive } from "../_api/replyFilter";
import { draftFor, type DraftTarget } from "../ruleDraft";
import { CHECKS } from "@x/health";

const logger = new Logger("ReplyShield");

const SLOT_ATTR = "data-xrb-inline-rule-slot";
const BUTTON_ATTR = "data-xrb-inline-rule";
const STRIP = ["id", "data-testid", "aria-controls", "aria-describedby", "aria-labelledby", "aria-haspopup", "aria-expanded", "href"];
const SHIELD_SVG = '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>';
const IDLE_LABEL = N_("分析这条回复");
const BUSY_LABEL = N_("正在分析这条回复");
const REPEAT_MS = 500;
const ROUTE_POLL_MS = 400;

interface Binding {
    article: HTMLElement;
    slot: HTMLElement;
    button: HTMLButtonElement;
    tip: TooltipHandle;
    target: DraftTarget;
    path: string;
    busy: boolean;
    lastActivation: number;
}

const bindings = new Map<HTMLElement, Binding>();
let observer: MutationObserver | null = null;
let frame = 0;
let routeTimer: ReturnType<typeof setInterval> | undefined;
let lastPath = "";
let observedColumn: HTMLElement | null = null;

const pagePath = () => `${location.hostname}${location.pathname}`;

/** §16.2: the Grok button in the caret's action row; exactly one candidate or nothing. */
export function findAnchor(article: HTMLElement, tweetId: string): { row: HTMLElement; slot: HTMLElement; native: HTMLElement } | null {
    const caret = [...article.querySelectorAll<HTMLElement>(SEL.caret)].find(c => !isInNestedStatusCard(c, article, tweetId));
    if (!caret) return null;
    const found: { row: HTMLElement; slot: HTMLElement; native: HTMLElement }[] = [];
    for (const el of article.querySelectorAll<HTMLElement>("button, [role='button']")) {
        if (el.hasAttribute(BUTTON_ATTR) || isInNestedStatusCard(el, article, tweetId)) continue;
        const label = `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""}`;
        if (!/grok/i.test(label)) continue;
        let node: HTMLElement = el;
        for (let i = 0; i < 5 && node.parentElement && node !== article; i++) {
            const parent: HTMLElement = node.parentElement;
            if (parent.contains(caret)) {
                found.push({ row: parent, slot: node, native: el });
                break;
            }
            node = parent;
        }
    }
    return found.length === 1 ? found[0] : null;
}

const eligibleContext = eligibleReplyContext;

function buildButton(native: HTMLElement, slotTemplate: HTMLElement): { slot: HTMLElement; button: HTMLButtonElement } {
    const slot = slotTemplate === native ? document.createElement("div") : slotTemplate.cloneNode(false) as HTMLElement;
    const button = (native.tagName === "BUTTON" ? native.cloneNode(false) : document.createElement("button")) as HTMLButtonElement;
    for (const el of [slot, button]) for (const a of STRIP) el.removeAttribute(a);
    slot.setAttribute(OWNED_ATTR, "");
    slot.setAttribute(SLOT_ATTR, "");
    button.setAttribute(OWNED_ATTR, "");
    button.setAttribute(BUTTON_ATTR, "");
    button.setAttribute("type", "button");
    button.setAttribute("role", "button");
    button.removeAttribute("disabled");
    button.classList.add("xrb-inline-rule-button");
    const nativeSvg = native.querySelector("svg");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    if (nativeSvg) {
        const cls = nativeSvg.getAttribute("class");
        if (cls) svg.setAttribute("class", cls);
        const style = nativeSvg.getAttribute("style");
        if (style) svg.setAttribute("style", style);
        const cs = getComputedStyle(nativeSvg);
        const r = nativeSvg.getBoundingClientRect();
        button.style.color = cs.color;
        if (r.width && r.height) {
            svg.style.width = `${r.width}px`;
            svg.style.height = `${r.height}px`;
        }
    } else {
        svg.style.width = svg.style.height = "18.75px";
    }
    svg.style.fill = "none";
    svg.style.stroke = "currentColor";
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.innerHTML = SHIELD_SVG;
    button.replaceChildren(svg);
    slot.replaceChildren(button);
    return { slot, button };
}

function setBusy(b: Binding, busy: boolean) {
    b.busy = busy;
    b.button.disabled = busy;
    b.button.setAttribute("aria-busy", String(busy));
    b.button.setAttribute("aria-label", t(busy ? BUSY_LABEL : IDLE_LABEL));
    b.tip.refresh();
}

function unbind(article: HTMLElement) {
    const b = bindings.get(article);
    if (!b) return;
    bindings.delete(article);
    b.tip.destroy();
    b.slot.remove();
}

function activate(b: Binding, e: Event) {
    if (!e.isTrusted) return;
    if (e instanceof MouseEvent && e.button !== 0) return;
    if (e instanceof KeyboardEvent && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const now = Date.now();
    if (b.busy || now - b.lastActivation < REPEAT_MS) return;
    b.lastActivation = now;
    const ctx = eligibleContext(b.article);
    const fresh = ctx && contextSignature(ctx);
    if (!ctx || ctx.tweetId !== b.target.tweetId || ctx.authorHandle !== b.target.handle || fresh !== b.target.signature || getController().route.routeKey !== b.target.routeKey || pagePath() !== b.path) {
        reconcile(b.article);
        return;
    }
    setBusy(b, true);
    let pending: Promise<unknown> | null = null;
    try {
        pending = draftFor(b.target);
    } catch (err) {
        showToast(err instanceof Error && err.message ? err.message : t("无法生成屏蔽规则。"), { type: "error" });
    }
    // The button is busy while the dialog is being opened, not while it stays open.
    queueMicrotask(() => {
        setBusy(b, false);
        reconcile(b.article);
    });
    pending?.catch(err => logger.error("Rule draft failed", err));
}

function bind(article: HTMLElement, ctx: ReplyContext, anchor: NonNullable<ReturnType<typeof findAnchor>>) {
    const { slot, button } = buildButton(anchor.native, anchor.slot);
    const binding: Binding = {
        article, slot, button,
        tip: null as unknown as TooltipHandle,
        target: { routeKey: getController().route.routeKey, tweetId: ctx.tweetId, handle: ctx.authorHandle, signature: contextSignature(ctx) },
        path: pagePath(),
        busy: false,
        lastActivation: 0,
    };
    binding.tip = attachTooltip(button, () => t(binding.busy ? BUSY_LABEL : IDLE_LABEL), "bottom");
    button.setAttribute("aria-label", t(IDLE_LABEL));
    button.addEventListener("click", e => activate(binding, e), true);
    button.addEventListener("keydown", e => activate(binding, e), true);
    for (const ev of ["pointerdown", "mousedown", "pointerup", "mouseup"]) button.addEventListener(ev, e => e.stopPropagation());
    anchor.row.insertBefore(slot, anchor.slot);
    bindings.set(article, binding);
}

function reconcile(article: HTMLElement) {
    const existing = bindings.get(article);
    if (existing?.busy) return;
    const ctx = eligibleContext(article);
    const anchor = ctx && findAnchor(article, ctx.tweetId);
    if (!ctx || !anchor) return unbind(article);
    if (existing) {
        const sameTarget = existing.target.tweetId === ctx.tweetId && existing.target.signature === contextSignature(ctx) && existing.target.routeKey === getController().route.routeKey && existing.path === pagePath();
        const placed = existing.slot.parentElement === anchor.row && existing.slot.nextElementSibling === anchor.slot;
        if (sameTarget && placed) return;
        if (sameTarget && existing.slot.isConnected === false || (sameTarget && !placed)) {
            anchor.row.insertBefore(existing.slot, anchor.slot);
            return;
        }
        unbind(article);
    }
    bind(article, ctx, anchor);
}

function scan() {
    frame = 0;
    const column = findPrimaryColumn();
    if (column !== observedColumn) observe(column);
    for (const article of [...bindings.keys()]) if (!article.isConnected) unbind(article);
    for (const article of listTopLevelTweets(column)) reconcile(article);
}

function schedule() {
    if (!frame) frame = requestAnimationFrame(scan);
}

function observe(column: HTMLElement | null) {
    observer?.disconnect();
    observedColumn = column;
    if (!column) return;
    observer = new MutationObserver(records => {
        if (records.every(r => r.target instanceof Element && (r.target as Element).closest(`[${OWNED_ATTR}]`))) return;
        schedule();
    });
    observer.observe(column, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-label", "class", "data-testid", "hidden", "href", "style"] });
}

function removeAll() {
    for (const article of [...bindings.keys()]) unbind(article);
    document.querySelectorAll(`[${SLOT_ATTR}]`).forEach(el => el.remove());
}

export default definePlugin({
    name: "ReplyShield",
    description: N_("回复旁的盾牌按钮：在每条可处理回复的 Grok 按钮左侧放一个盾牌，点击后打开规则草稿弹窗。"),
    icon: Icons.shield,
    tags: ["replies", "filters"],
    enabledByDefault: true,
    startAt: StartAt.DOMContentLoaded,
    dependencies: ["ReplyFilter", "RuleDraft"],
    managedStyle: `.xrb-inline-rule-button{cursor:pointer;border-radius:9999px;background:transparent;border:0;display:inline-flex;align-items:center;justify-content:center;transition:background-color .2s,color .2s}
.xrb-inline-rule-button:hover,.xrb-inline-rule-button:focus-visible{background-color:rgba(29,155,240,0.1);color:rgb(29,155,240)!important;outline:none}
.xrb-inline-rule-button[aria-busy="true"]{cursor:progress;opacity:.55}`,
    cleanupSelectors: [`[${SLOT_ATTR}]`],
    healthChecks: [CHECKS.postGrok, CHECKS.postCaret],

    events: {
        configurationChanged: schedule,
        filterScan: schedule,
        recordsChanged: schedule,
        filterRouteChanged() {
            removeAll();
            schedule();
        },
    },

    start() {
        lastPath = pagePath();
        routeTimer = setInterval(() => {
            const path = pagePath();
            if (path === lastPath) return;
            lastPath = path;
            removeAll();
            schedule();
        }, ROUTE_POLL_MS);
        schedule();
    },

    stop() {
        clearInterval(routeTimer);
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        observer?.disconnect();
        observer = null;
        observedColumn = null;
        removeAll();
    },
});
