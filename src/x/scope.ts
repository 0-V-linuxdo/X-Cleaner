/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { cellOf, findIdentityLink, isTombstoneCell, listTopLevelTweets, SEL } from "./dom";

export type HeadingKind = "conversation" | "pending" | "recommendation";

const CONVERSATION_HEADING = /^(?:可能的垃圾信息|可能是垃圾信息|可能的垃圾訊息|可能是垃圾訊息|probable spam|likely spam|potential spam|回复|回覆|replies|reply|显示更多回复|顯示更多回覆|show more replies|more replies|相关回复|相關回覆|relevant replies|most relevant|latest|最新|最相关)$/iu;

export function headingCellKind(cell: Element): HeadingKind | null {
    if (cell.querySelector(SEL.tweet) || isTombstoneCell(cell)) return null;
    const heading = cell.querySelector('h2, [role="heading"]');
    if (!heading) return null;
    const text = (heading.textContent ?? "").normalize("NFKC").trim().toLowerCase();
    if (!text) return "pending";
    return CONVERSATION_HEADING.test(text) ? "conversation" : "recommendation";
}

const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

export type ScopeMode = "auto" | "manual";

export class ScopeTracker {
    knownReplies = new Set<string>();
    recommended = new Set<string>();
    seenBoundary = false;
    rootEverMounted = false;
    domReady = false;
    scrollDirection: "up" | "down" | null = null;
    residualIds = new Set<string>();
    residualIdentities = new Set<string>();
    private boundaries = new Map<Element, HeadingKind>();

    reset(previousMounted: { tweetId: string; handle: string }[] = []) {
        this.knownReplies.clear();
        this.recommended.clear();
        this.seenBoundary = false;
        this.rootEverMounted = false;
        this.domReady = false;
        this.boundaries.clear();
        this.residualIds = new Set(previousMounted.map(m => m.tweetId));
        this.residualIdentities = new Set(previousMounted.map(m => `${m.tweetId}|${m.handle}`));
    }

    markRootMounted() {
        this.rootEverMounted = true;
        if (!this.domReady) {
            this.domReady = true;
            this.residualIds.clear();
            this.residualIdentities.clear();
        }
    }

    isResidual(tweetId: string, handle: string): boolean {
        return !this.domReady && (this.residualIds.has(tweetId) || this.residualIdentities.has(`${tweetId}|${handle}`));
    }

    boundaryCells(column: Element | null): Map<Element, HeadingKind> {
        const out = new Map<Element, HeadingKind>();
        if (!column) return out;
        for (const cell of column.querySelectorAll(SEL.cell)) {
            const kind = headingCellKind(cell);
            if (kind === "recommendation" || kind === "pending") out.set(cell, kind);
        }
        return out;
    }

    refreshBoundaries(column: Element | null): { changed: boolean; invalidated: boolean; firstSeen: boolean } {
        const next = this.boundaryCells(column);
        let invalidated = false;
        for (const [cell, kind] of this.boundaries) {
            if (kind !== "recommendation") continue;
            if (next.get(cell) !== "recommendation" && (!cell.isConnected || headingCellKind(cell) === "conversation")) invalidated = true;
        }
        const hasConfirmed = [...next.values()].includes("recommendation");
        const firstSeen = hasConfirmed && !this.seenBoundary;
        const changed = invalidated || next.size !== this.boundaries.size || [...next].some(([c, k]) => this.boundaries.get(c) !== k);
        if (invalidated) {
            this.recommended.clear();
            this.seenBoundary = hasConfirmed;
        }
        if (hasConfirmed) this.seenBoundary = true;
        this.boundaries = next;
        return { changed, invalidated, firstSeen };
    }

    precedingBoundary(article: Element): HeadingKind | null {
        const cell = cellOf(article) ?? article;
        let found: HeadingKind | null = null;
        for (const [boundary, kind] of this.boundaries) {
            if (!boundary.isConnected || !before(boundary, cell)) continue;
            if (kind === "recommendation") return kind;
            found = kind;
        }
        return found;
    }

    inScope(article: Element, tweetId: string, handle: string, root: Element | null, isRoot: boolean, routeValid: boolean, mode: ScopeMode = "auto"): boolean {
        if (isRoot) return mode === "auto";
        if (this.isResidual(tweetId, handle)) return false;
        if (this.recommended.has(tweetId)) return false;
        const boundary = this.precedingBoundary(article);
        if (boundary === "recommendation") {
            this.seenBoundary = true;
            this.recommended.add(tweetId);
            return false;
        }
        if (boundary === "pending") return false;
        const confirmedMounted = [...this.boundaries].some(([c, k]) => k === "recommendation" && c.isConnected);
        if (this.seenBoundary && !confirmedMounted && this.scrollDirection !== "up") {
            this.recommended.add(tweetId);
            return false;
        }
        if (this.knownReplies.has(tweetId)) return true;
        if (root) {
            if (before(root, article)) {
                this.knownReplies.add(tweetId);
                return true;
            }
            return false;
        }
        if (mode === "manual") return true;
        if (this.rootEverMounted) return this.scrollDirection !== "up";
        return routeValid && this.scrollDirection !== "up";
    }
}

export function mountedIdentities(column: Element | null): { tweetId: string; handle: string }[] {
    return listTopLevelTweets(column).flatMap(a => {
        const id = findIdentityLink(a);
        return id ? [{ tweetId: id.tweetId, handle: id.handle }] : [];
    });
}
