/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Void++ ExportChat for X: saves the post and the replies already on the page as Markdown or JSON,
// with X Cleaner's verdict on each reply. Only what is loaded is exported; nothing is fetched.

import type { PostMenuContext, PostMenuItem } from "@plugins/_api/postMenu";
import { Icons } from "@ui/icons";
import { showToast } from "@ui/toast";
import { N_, t } from "@utils/i18n";
import definePlugin from "@utils/types";
import { extractReplyContext, findPrimaryColumn, listTopLevelTweets, type SerializableContext, serializeContext } from "@x/dom";
import { parseRoute } from "@x/route";

import { getController, isFilterActive } from "../_api/replyFilter";

export interface ExportedPost extends Omit<SerializableContext, "identityComplete"> {
    time: string | null;
    hidden: boolean;
    hiddenReason: string | null;
}

export interface ThreadExport {
    url: string;
    exportedAt: string;
    posts: ExportedPost[];
}

function timeOf(article: HTMLElement, tweetId: string): string | null {
    for (const t of article.querySelectorAll("time[datetime]")) {
        if (t.closest("a")?.getAttribute("href")?.includes(`/status/${tweetId}`)) return t.getAttribute("datetime");
    }
    return null;
}

/** Every post on the page in reading order; replies X Cleaner hid are included and marked. */
export function collectThread(doc: Document = document): ThreadExport {
    const route = parseRoute(doc.location?.href ?? location.href);
    const records = isFilterActive() ? getController().records : null;
    const posts: ExportedPost[] = [];
    const seen = new Set<string>();
    for (const article of listTopLevelTweets(findPrimaryColumn(doc))) {
        const ctx = extractReplyContext(article, { route });
        if (!ctx || seen.has(ctx.tweetId)) continue;
        seen.add(ctx.tweetId);
        const { identityComplete: _i, ...rest } = serializeContext(ctx);
        const rec = records?.get(ctx.tweetId);
        posts.push({ ...rest, time: timeOf(article, ctx.tweetId), hidden: !!rec?.hidden, hiddenReason: rec?.hidden ? rec.reason : null });
    }
    return { url: route.pathname ? new URL(route.pathname, location.origin).href : location.href, exportedAt: new Date().toISOString(), posts };
}

const quote = (text: string) => text.split("\n").map(l => `> ${l}`).join("\n");

export function toMarkdown(data: ThreadExport): string {
    const out = [`# ${data.url}`, "", t("导出时间：{exportedAt}，共 {n} 条（只含页面上已加载的内容）。", { exportedAt: data.exportedAt, n: data.posts.length }), ""];
    for (const p of data.posts) {
        const who = p.displayName ? `${p.displayName} (@${p.authorHandle})` : `@${p.authorHandle}`;
        const tags = [p.isRoot ? t("主帖") : "", p.isOp && !p.isRoot ? t("楼主") : "", p.hidden ? t("已隐藏：{reason}", { reason: p.hiddenReason ?? "" }) : ""].filter(Boolean);
        out.push(`## ${who}${tags.length ? ` · ${tags.join(" · ")}` : ""}`, "", `${p.time ?? ""} · ${p.statusUrl}`.replace(/^ · /, ""), "");
        if (p.bodyText) out.push(quote(p.bodyText), "");
        for (const u of p.visibleUrls) out.push(t("- 链接：{url}", { url: u }));
        for (const m of p.mediaUrls) out.push(t("- 图片：{url}", { url: m }));
        if (p.visibleUrls.length || p.mediaUrls.length) out.push("");
    }
    return out.join("\n");
}

function download(name: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportAs(format: "md" | "json", ctx: PostMenuContext) {
    const data = collectThread();
    if (!data.posts.length) {
        showToast(t("页面上没有可导出的帖子。"), { type: "error" });
        return;
    }
    const name = `x-${ctx.handle}-${ctx.tweetId}-${data.exportedAt.slice(0, 10)}.${format}`;
    if (format === "md") download(name, toMarkdown(data), "text/markdown;charset=utf-8");
    else download(name, JSON.stringify(data, null, 2), "application/json");
    showToast(t("已导出 {n} 条帖子。", { n: data.posts.length }), { type: "success" });
}

const onStatusPage = () => parseRoute().isStatusRoute;

export const exportMenuItems: PostMenuItem[] = [
    { id: "export-md", order: 60, icon: Icons.download, label: () => t("导出本页帖子和回复（Markdown）"), visible: onStatusPage, run: ctx => exportAs("md", ctx) },
    { id: "export-json", order: 61, icon: Icons.download, label: () => t("导出本页帖子和回复（JSON）"), visible: onStatusPage, run: ctx => exportAs("json", ctx) },
];

export default definePlugin({
    name: "ExportThread",
    description: N_("导出帖子：在帖子页的「…」菜单里，把主帖和已加载的回复导出为 Markdown 或 JSON，并标出 X Cleaner 隐藏了哪些回复、原因是什么。只导出页面上已有的内容。"),
    icon: Icons.download,
    tags: ["replies", "moderation"],
    enabledByDefault: true,
    postMenuItems: exportMenuItems,
});
