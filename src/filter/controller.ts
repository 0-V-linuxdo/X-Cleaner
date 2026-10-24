/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { dispatch } from "@api/Events";
import type { BlockerConfig } from "@config/config";
import type { ConfigStore } from "@config/store";
import { isAllowed } from "@rules/lists";
import { aiReady } from "@ai/transport";
import { Logger } from "@utils/Logger";
import { cellOf, contextSignature, detectSelfHandle, extractReplyContext, findIdentityLink, findPrimaryColumn, findRootArticle, listTopLevelTweets, OWNED_ATTR, quickContext, type ReplyContext, resolveOpHandle, SEL, serializeContext } from "@x/dom";
import { normalizeHandle } from "@x/text";
import { parseRoute, type RouteInfo } from "@x/route";
import { mountedIdentities, type ScopeMode, ScopeTracker } from "@x/scope";

import type { EvaluationState, HiddenRecord, Judge, JudgeEnv, Verdict } from "./types";

const logger = new Logger("ReplyFilter", "#f91880");

export const HIDDEN_ATTR = "data-xrb-hidden";
export const TWEET_ID_ATTR = "data-xrb-tweet-id";
export const TOMBSTONE_ATTR = "data-xrb-tombstone";
export const MAX_RECORDS = 500;
const SWEEP_MS = 250;
const ROUTE_POLL_MS = 500;
const RECORD_DEBOUNCE_MS = 50;

export function hideCell(cell: Element, tweetId: string) {
    if (cell.getAttribute(HIDDEN_ATTR) !== "true") cell.setAttribute(HIDDEN_ATTR, "true");
    if (cell.getAttribute(TWEET_ID_ATTR) !== tweetId) cell.setAttribute(TWEET_ID_ATTR, tweetId);
}

export function showCell(cell: Element) {
    for (const a of [HIDDEN_ATTR, TWEET_ID_ATTR, TOMBSTONE_ATTR]) if (cell.hasAttribute(a)) cell.removeAttribute(a);
}

interface CacheEntry {
    signature: string;
    revision: number;
    routeKey: string;
    hidden: boolean;
}

export class ReplyController {
    route: RouteInfo = parseRoute();
    selfHandle = "";
    readonly scope = new ScopeTracker();
    readonly records = new Map<string, HiddenRecord>();
    readonly restored = new Set<string>();
    private judges: { owner: string; judge: Judge }[] = [];
    private cache = new WeakMap<Element, CacheEntry>();
    private processing = new WeakSet<Element>();
    private dirty = new WeakSet<Element>();
    private column: HTMLElement | null = null;
    private observer: MutationObserver | null = null;
    private timers: ReturnType<typeof setInterval>[] = [];
    private stopped = true;
    private lastScrollY = 0;
    private recordTimer: ReturnType<typeof setTimeout> | null = null;
    private unsubConfig: (() => void) | null = null;
    private rootSeenOnce = false;

    constructor(readonly store: ConfigStore) {}

    get config(): BlockerConfig {
        return this.store.config;
    }

    get active(): boolean {
        return !this.stopped;
    }

    addJudge(owner: string, judge: Judge): () => void {
        const entry = { owner, judge };
        this.judges.push(entry);
        this.judges.sort((a, b) => a.judge.priority - b.judge.priority);
        this.scheduleRescan();
        return () => {
            this.judges = this.judges.filter(j => j !== entry);
            this.scheduleRescan();
        };
    }

    private rescanQueued = false;

    scheduleRescan() {
        if (this.rescanQueued || this.stopped) return;
        this.rescanQueued = true;
        queueMicrotask(() => {
            this.rescanQueued = false;
            this.configurationChanged();
        });
    }

    start() {
        if (!this.stopped) return;
        this.stopped = false;
        this.route = parseRoute();
        this.selfHandle = detectSelfHandle();
        this.unsubConfig = this.store.subscribe(() => this.configurationChanged());
        this.timers.push(setInterval(() => this.sweep(), SWEEP_MS));
        this.timers.push(setInterval(() => this.checkRoute(), ROUTE_POLL_MS));
        addEventListener("scroll", this.onScroll, { passive: true, capture: true });
        this.connect();
        this.scheduleRescan();
    }

    stop() {
        if (this.stopped) return;
        this.stopped = true;
        for (const t of this.timers) clearInterval(t);
        this.timers = [];
        removeEventListener("scroll", this.onScroll, { capture: true } as EventListenerOptions);
        this.observer?.disconnect();
        this.observer = null;
        this.unsubConfig?.();
        this.unsubConfig = null;
        this.unhideAll();
        this.records.clear();
        this.emitRecords();
        dispatch("filterStopped");
    }

    private onScroll = () => {
        const y = scrollY;
        if (Math.abs(y - this.lastScrollY) <= 2) return;
        this.scope.scrollDirection = y < this.lastScrollY ? "up" : "down";
        this.lastScrollY = y;
    };

    private connect() {
        this.observer?.disconnect();
        this.column = findPrimaryColumn();
        if (!this.column) return;
        this.observer = new MutationObserver(records => this.onMutations(records));
        this.observer.observe(this.column, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["href", "src", "title", "aria-label", "tabindex"] });
    }

    private onMutations(records: MutationRecord[]) {
        if (this.stopped) return;
        const articles = new Set<HTMLElement>();
        for (const r of records) {
            const target = r.target instanceof Element ? r.target : r.target.parentElement;
            if (!target || target.closest(`[${OWNED_ATTR}]`)) continue;
            const nodes = r.type === "childList" ? [...r.addedNodes, target] : [target];
            for (const node of nodes) {
                if (!(node instanceof Element)) continue;
                const host = node.closest<HTMLElement>(SEL.tweet);
                if (host) articles.add(this.topArticle(host));
                for (const a of node.querySelectorAll<HTMLElement>(SEL.tweet)) articles.add(this.topArticle(a));
            }
        }
        const boundary = this.scope.refreshBoundaries(this.column);
        if (boundary.invalidated) this.cache = new WeakMap();
        if (boundary.changed || boundary.firstSeen || !this.rootSeenOnce) {
            this.fullScan();
            return;
        }
        for (const a of articles) this.processArticle(a);
        this.emitScan();
    }

    private topArticle(a: HTMLElement): HTMLElement {
        let top = a;
        for (let p = a.parentElement?.closest<HTMLElement>(SEL.tweet); p; p = p.parentElement?.closest<HTMLElement>(SEL.tweet)) top = p;
        return top;
    }

    private checkRoute() {
        if (this.stopped) return;
        const next = parseRoute();
        if (next.routeKey !== this.route.routeKey || next.active !== this.route.active) {
            this.changeRoute(next);
            return;
        }
        const self = detectSelfHandle();
        if (self !== this.selfHandle) {
            this.selfHandle = self;
            this.configurationChanged();
        }
        if (findPrimaryColumn() !== this.column) {
            this.connect();
            this.fullScan();
        }
    }

    navigate() {
        this.checkRoute();
    }

    private changeRoute(next: RouteInfo) {
        const previous = this.route;
        const mounted = mountedIdentities(this.column ?? findPrimaryColumn());
        this.route = next;
        this.unhideAll();
        this.records.clear();
        this.restored.clear();
        this.scope.reset(mounted);
        this.cache = new WeakMap();
        this.rootSeenOnce = false;
        this.emitRecords();
        dispatch("filterRouteChanged", { route: next, previous });
        this.connect();
        this.fullScan();
    }

    configurationChanged() {
        if (this.stopped) return;
        this.cache = new WeakMap();
        dispatch("configurationChanged", { config: this.config });
        this.fullScan();
    }

    private unhideAll() {
        for (const cell of document.querySelectorAll(`[${HIDDEN_ATTR}]`)) {
            if (!cell.hasAttribute(TOMBSTONE_ATTR)) showCell(cell);
        }
    }

    sweep() {
        if (this.stopped) return;
        this.reapplyHidden();
        this.fullScan();
    }

    private reapplyHidden() {
        const byId = new Map<string, HTMLElement>();
        for (const a of listTopLevelTweets(this.column)) {
            const id = findIdentityLink(a)?.tweetId;
            if (id) byId.set(id, a);
        }
        for (const rec of this.records.values()) {
            if (!rec.hidden) continue;
            const cell = byId.get(rec.tweetId) && cellOf(byId.get(rec.tweetId)!);
            if (cell) hideCell(cell, rec.tweetId);
        }
    }

    fullScan() {
        if (this.stopped) return;
        if (!this.column?.isConnected) this.connect();
        this.scope.refreshBoundaries(this.column);
        const tweets = listTopLevelTweets(this.column);
        const root = findRootArticle(this.column, this.route);
        if (root) {
            this.rootSeenOnce = true;
            this.scope.markRootMounted();
            let after = false;
            for (const a of tweets) {
                if (a === root) { after = true; continue; }
                if (!after) {
                    const cell = cellOf(a);
                    if (cell?.getAttribute(HIDDEN_ATTR) === "true") showCell(cell);
                    continue;
                }
                this.processArticle(a);
            }
            this.processArticle(root);
        } else {
            for (const a of tweets) this.processArticle(a);
        }
        this.emitScan();
    }

    private emitScan() {
        dispatch("filterScan", { column: this.column, route: this.route, rootMounted: !!findRootArticle(this.column, this.route), active: !this.stopped && this.config.enabled });
    }

    env(state: EvaluationState = {}): JudgeEnv {
        return { config: this.config, route: this.route, selfHandle: this.selfHandle, state, aiReady: aiReady(this.config.ai) };
    }

    extract(article: HTMLElement): ReplyContext | null {
        return extractReplyContext(article, { route: this.route, selfHandle: this.selfHandle, column: this.column });
    }

    rootArticle(): HTMLElement | null {
        return findRootArticle(this.column, this.route);
    }

    inScope(ctx: ReplyContext, mode: ScopeMode = "auto"): boolean {
        return this.scope.inScope(ctx.article, ctx.tweetId, ctx.authorHandle, this.rootArticle(), ctx.isRoot, this.route.isStatusRoute, mode);
    }

    isProtected(ctx: Pick<ReplyContext, "isRoot" | "isSelf" | "isOp" | "authorHandle">): boolean {
        return ctx.isRoot || ctx.isSelf || isAllowed(this.config, ctx.authorHandle) || (ctx.isOp && this.config.protections.op);
    }

    private setVisible(article: HTMLElement) {
        const cell = cellOf(article);
        if (cell && cell.getAttribute(HIDDEN_ATTR) === "true" && !cell.hasAttribute(TOMBSTONE_ATTR)) showCell(cell);
    }

    private gateOpen(): boolean {
        return !this.stopped && this.config.enabled && this.route.isStatusRoute && !!this.selfHandle;
    }

    processArticle(article: HTMLElement) {
        if (!article.isConnected) return;
        if (this.processing.has(article)) {
            this.dirty.add(article);
            return;
        }
        if (!this.gateOpen()) {
            this.setVisible(article);
            return;
        }
        const ctx = this.extract(article);
        if (!ctx) {
            this.quickHide(article);
            return;
        }
        if (ctx.isRoot) this.scope.markRootMounted();
        const signature = contextSignature(ctx);
        const cached = this.cache.get(article);
        if (cached && cached.signature === signature && cached.revision === this.store.revision && cached.routeKey === this.route.routeKey) {
            if (cached.hidden && ctx.cell) hideCell(ctx.cell, ctx.tweetId);
            else this.setVisible(article);
            return;
        }
        if (!ctx.opIdentityKnown || ctx.isPromoted) {
            this.setVisible(article);
            return;
        }
        if (!this.inScope(ctx)) {
            this.setVisible(article);
            this.cache.set(article, { signature, revision: this.store.revision, routeKey: this.route.routeKey, hidden: false });
            dispatch("replyOutOfScope", { tweetId: ctx.tweetId, handle: ctx.authorHandle });
            return;
        }
        if (this.restored.has(ctx.tweetId)) {
            this.setVisible(article);
            return;
        }
        this.evaluate(ctx, signature);
    }

    private quickHide(article: HTMLElement) {
        const cell = cellOf(article);
        if (!cell || !this.route.isStatusRoute) return;
        const root = this.rootArticle();
        if (root && !(root.compareDocumentPosition(article) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
        if (this.scope.precedingBoundary(article)) return;
        const input = quickContext(article);
        if (input.authorHandle && (input.authorHandle === this.selfHandle || isAllowed(this.config, input.authorHandle))) return;
        const env = { ...this.env(), route: this.route };
        for (const { judge } of this.judges) {
            const v = judge.quick?.(input, env);
            if (v?.action === "allow") return;
            if (v?.action === "hide") {
                if (cell.getAttribute(HIDDEN_ATTR) !== "true") hideCell(cell, "pending");
                return;
            }
        }
    }

    private evaluate(ctx: ReplyContext, signature: string) {
        const state: EvaluationState = {};
        const env = this.env(state);
        const revision = this.store.revision;
        const routeKey = this.route.routeKey;
        if (ctx.isRoot || ctx.isSelf) return this.finish(ctx, signature, { action: "allow", source: "protection" }, state, env);
        const run = (index: number): void => {
            for (let i = index; i < this.judges.length; i++) {
                let verdict: Verdict | null | Promise<Verdict | null>;
                try { verdict = this.judges[i].judge.judge(ctx, env); } catch (e) {
                    logger.error(`Judge ${this.judges[i].judge.id} failed`, e);
                    continue;
                }
                if (verdict instanceof Promise) {
                    this.processing.add(ctx.article);
                    verdict.then(v => {
                        this.processing.delete(ctx.article);
                        const stale = this.stopped || this.route.routeKey !== routeKey || this.store.revision !== revision || !ctx.article.isConnected;
                        const changed = !stale && contextSignature(this.extract(ctx.article) ?? ctx) !== signature;
                        if (stale || changed || this.dirty.has(ctx.article)) {
                            this.dirty.delete(ctx.article);
                            if (!this.stopped && ctx.article.isConnected) this.processArticle(ctx.article);
                            return;
                        }
                        if (v) this.finish(ctx, signature, v, state, env);
                        else run(i + 1);
                    }, e => {
                        this.processing.delete(ctx.article);
                        logger.error("Async judge failed", e);
                        run(i + 1);
                    });
                    return;
                }
                if (verdict) return this.finish(ctx, signature, verdict, state, env);
            }
            this.finish(ctx, signature, { action: "allow" }, state, env);
        };
        run(0);
    }

    private finish(ctx: ReplyContext, signature: string, verdict: Verdict, state: EvaluationState, env: JudgeEnv) {
        const hidden = verdict.action === "hide";
        this.cache.set(ctx.article, { signature, revision: this.store.revision, routeKey: this.route.routeKey, hidden });
        if (!hidden) {
            this.setVisible(ctx.article);
            const rec = this.records.get(ctx.tweetId);
            if (rec?.hidden && rec.source === "ai" && !verdict.source && ctx.cell) {
                hideCell(ctx.cell, ctx.tweetId);
                return;
            }
            if (rec?.hidden) {
                this.records.delete(ctx.tweetId);
                this.emitRecords();
            }
            dispatch("replyVisible", { ctx, state, env });
            return;
        }
        this.hide(ctx, verdict);
    }

    hide(ctx: ReplyContext, verdict: Verdict): HiddenRecord {
        if (ctx.cell) hideCell(ctx.cell, ctx.tweetId);
        const previous = this.records.get(ctx.tweetId);
        const record: HiddenRecord = {
            tweetId: ctx.tweetId,
            context: serializeContext(ctx),
            source: verdict.source && verdict.source !== "protection" ? verdict.source : "classifier",
            category: verdict.category ?? "",
            reason: verdict.reason ?? "",
            score: verdict.score ?? null,
            threshold: verdict.threshold ?? null,
            confidence: verdict.confidence ?? null,
            signals: verdict.signals ?? [],
            regexMatch: verdict.regexMatch ?? null,
            match: verdict.match ?? null,
            hidden: true,
            detectedAt: previous?.detectedAt ?? Date.now(),
            aiStatus: previous?.aiStatus ?? null,
        };
        this.records.delete(ctx.tweetId);
        this.records.set(ctx.tweetId, record);
        while (this.records.size > MAX_RECORDS) this.records.delete(this.records.keys().next().value!);
        const changed = !previous || previous.reason !== record.reason || !previous.hidden;
        if (changed) this.emitRecords();
        dispatch("replyHidden", { ctx, verdict, record });
        return record;
    }

    /** Hide a reply from a verdict that arrived outside the judge pipeline (AI review), keeping the cache consistent. */
    hideExternal(ctx: ReplyContext, verdict: Verdict): HiddenRecord {
        this.cache.set(ctx.article, { signature: contextSignature(ctx), revision: this.store.revision, routeKey: this.route.routeKey, hidden: true });
        return this.hide(ctx, verdict);
    }

    setAiStatus(tweetId: string, status: string | null) {
        const rec = this.records.get(tweetId);
        if (!rec) return;
        rec.aiStatus = status;
        this.emitRecords();
    }

    restore(tweetId: string) {
        this.restored.add(tweetId);
        const rec = this.records.get(tweetId);
        if (rec) rec.hidden = false;
        for (const cell of document.querySelectorAll(`[${TWEET_ID_ATTR}="${CSS.escape(tweetId)}"]`)) showCell(cell);
        this.emitRecords();
    }

    unrestore(raw: string) {
        const handle = normalizeHandle(raw);
        for (const rec of this.records.values()) if (rec.context.authorHandle === handle) this.restored.delete(rec.tweetId);
        this.cache = new WeakMap();
    }

    restoreAuthor(raw: string) {
        const handle = normalizeHandle(raw);
        for (const rec of this.records.values()) {
            if (rec.context.authorHandle === handle) {
                rec.hidden = false;
                this.restored.add(rec.tweetId);
                for (const cell of document.querySelectorAll(`[${TWEET_ID_ATTR}="${CSS.escape(rec.tweetId)}"]`)) showCell(cell);
            }
        }
        this.emitRecords();
    }

    findArticle(tweetId: string): HTMLElement | null {
        return listTopLevelTweets(this.column ?? findPrimaryColumn()).find(a => findIdentityLink(a)?.tweetId === tweetId) ?? null;
    }

    liveContext(tweetId: string): ReplyContext | null {
        const article = this.findArticle(tweetId);
        return article ? this.extract(article) : null;
    }

    opHandle(): string {
        return resolveOpHandle(this.route, this.column);
    }

    visibleRecords(): HiddenRecord[] {
        return [...this.records.values()].filter(r => r.hidden !== false).sort((a, b) => b.detectedAt - a.detectedAt);
    }

    private emitRecords() {
        if (this.recordTimer) return;
        this.recordTimer = setTimeout(() => {
            this.recordTimer = null;
            dispatch("recordsChanged", this.visibleRecords());
        }, RECORD_DEBOUNCE_MS);
    }

    protectedContexts(limit = 50): ReplyContext[] {
        const out: ReplyContext[] = [];
        for (const a of listTopLevelTweets(this.column)) {
            const ctx = this.extract(a);
            if (ctx && this.isProtected(ctx)) out.push(ctx);
            if (out.length >= limit) break;
        }
        return out;
    }
}
