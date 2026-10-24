/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { AccountSource, BlockerConfig } from "@config/config";
import type { Classification, Signal } from "@rules/classifier";
import type { RegexResult } from "@rules/regex";
import type { ReplyContext, SerializableContext } from "@x/dom";
import type { RouteInfo } from "@x/route";

export type RecordSource = "account" | "auto-account" | "phrase" | "domain" | "regex" | "classifier" | "ai";

export interface MatchInfo {
    kind: "phrase" | "domain" | "regex" | "account";
    value: string;
    field?: string;
}

export interface AutoEntryRequest {
    source: Exclude<AccountSource, "manual">;
    category: string;
    reason: string;
    score?: number | null;
    confidence?: number | null;
}

export interface Verdict {
    action: "hide" | "allow";
    source?: RecordSource | "protection";
    category?: string;
    reason?: string;
    score?: number | null;
    threshold?: number | null;
    confidence?: number | null;
    signals?: Signal[];
    regexMatch?: RegexResult | null;
    match?: MatchInfo | null;
    statsKey?: string | null;
    autoEntry?: AutoEntryRequest | null;
}

export interface JudgeEnv {
    config: BlockerConfig;
    route: RouteInfo;
    selfHandle: string;
    state: EvaluationState;
    aiReady: boolean;
}

export interface EvaluationState {
    classification?: Classification;
    deferredRegex?: boolean;
    [key: string]: unknown;
}

export interface QuickInput {
    bodyText: string;
    displayName: string;
    authorHandle: string;
}

export interface Judge {
    id: string;
    priority: number;
    judge(ctx: ReplyContext, env: JudgeEnv): Verdict | null | Promise<Verdict | null>;
    quick?(input: QuickInput, env: Omit<JudgeEnv, "state" | "route"> & { route: RouteInfo }): Verdict | null;
}

export interface HiddenRecord {
    tweetId: string;
    context: SerializableContext;
    source: RecordSource;
    category: string;
    reason: string;
    score: number | null;
    threshold: number | null;
    confidence: number | null;
    signals: Signal[];
    regexMatch: RegexResult | null;
    match: MatchInfo | null;
    hidden: boolean;
    detectedAt: number;
    aiStatus: string | null;
}

export interface ReplyEvent {
    ctx: ReplyContext;
    verdict: Verdict;
    record: HiddenRecord;
}

export interface VisibleEvent {
    ctx: ReplyContext;
    state: EvaluationState;
    env: JudgeEnv;
}

declare module "@utils/types" {
    interface PluginHooks {
        replyJudges?: Judge[];
    }
    interface XCleanerEventMap {
        replyHidden: ReplyEvent;
        replyVisible: VisibleEvent;
        replyOutOfScope: { tweetId: string; handle: string };
        recordsChanged: HiddenRecord[];
        filterRouteChanged: { route: RouteInfo; previous: RouteInfo };
        filterScan: { column: HTMLElement | null; route: RouteInfo; rootMounted: boolean; active: boolean };
        filterStopped: void;
        configurationChanged: { config: BlockerConfig };
    }
}
