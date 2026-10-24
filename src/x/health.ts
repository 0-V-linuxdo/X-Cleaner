/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Shared health checks (see SelectorHealth): the X elements several plugins rely on, and the
// pages where X is expected to render them.

import type { HealthCheck } from "@utils/types";

import { SEL } from "./dom";
import { parseRoute } from "./route";

const NAV = 'header[role="banner"] nav[role="navigation"]';

export const onStatusPage = () => parseRoute().isStatusRoute;
export const hasPosts = () => !!document.querySelector(SEL.tweet);
export const hasBanner = () => !!document.querySelector('header[role="banner"]');

export const CHECKS = {
    primaryColumn: { id: "primaryColumn", label: "主栏", selector: SEL.primaryColumn, when: onStatusPage },
    posts: { id: "posts", label: "帖子页上的帖子", selector: SEL.tweet, when: () => onStatusPage() && !!document.querySelector(SEL.primaryColumn) && !document.querySelector('[data-testid="emptyState"], [data-testid="error-detail"]') },
    postCaret: { id: "postCaret", label: "帖子的「更多」按钮", selector: `${SEL.tweet} ${SEL.caret}`, when: hasPosts },
    postGrok: { id: "postGrok", label: "帖子上的 Grok 按钮", selector: `${SEL.tweet} button[aria-label*="Grok"]`, when: () => onStatusPage() && hasPosts() },
    postTime: { id: "postTime", label: "帖子的发布时间", selector: `${SEL.tweet} time[datetime]`, when: hasPosts },
    sideNav: { id: "sideNav", label: "左侧栏", selector: NAV, when: hasBanner },
    accountSwitcher: { id: "accountSwitcher", label: "左下角账号菜单", selector: SEL.accountSwitcher, when: () => !!document.querySelector(NAV) && innerWidth >= 500 },
    moreMenuButton: { id: "moreMenuButton", label: "左侧栏的「更多」", selector: '[data-testid="AppTabBar_More_Menu"]', when: () => !!document.querySelector(NAV) },
} satisfies Record<string, HealthCheck>;
