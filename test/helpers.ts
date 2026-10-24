import { useBackend } from "@plugins/_api/blockerConfig";
import { createMemoryBackend } from "@config/backend";

export interface TweetSpec {
    id: string;
    handle: string;
    name?: string;
    text?: string;
    links?: { href: string; text: string; expanded?: string }[];
    promoted?: boolean;
    quote?: { id: string; handle: string; text: string };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function tweetHtml(t: TweetSpec): string {
    const links = (t.links ?? []).map(l => `<a href="${esc(l.href)}"${l.expanded ? ` data-expanded-url="${esc(l.expanded)}"` : ""}>${esc(l.text)}</a>`).join(" ");
    const quote = t.quote ? `<div role="link" tabindex="0"><div data-testid="User-Name"><a href="/${t.quote.handle}"><span>Q</span></a></div><a href="/${t.quote.handle}/status/${t.quote.id}"><time>1h</time></a><div data-testid="tweetText">${esc(t.quote.text)}</div></div>` : "";
    const [open, close] = t.promoted ? ['<div data-testid="placementTracking">', "</div>"] : ["", ""];
    return `<div data-testid="cellInnerDiv">${open}<article data-testid="tweet" role="article">
        <div data-testid="User-Name"><a href="/${t.handle}"><span>${esc(t.name ?? t.handle)}</span></a><a href="/${t.handle}"><span>@${t.handle}</span></a>
        <a href="/${t.handle}/status/${t.id}"><time datetime="2026-01-01">1h</time></a></div>
        <div data-testid="tweetText"><span>${esc(t.text ?? "")}</span> ${links}</div>
        ${quote}
        <div role="group"><button data-testid="reply"></button><div><button aria-label="Grok actions"><svg></svg></button></div><button data-testid="caret" aria-label="More"></button></div>
    </article>${close}</div>`;
}

export function headingHtml(text: string): string {
    return `<div data-testid="cellInnerDiv"><div><h2 role="heading">${esc(text)}</h2></div></div>`;
}

export function tombstoneHtml(text = "此帖子不可用。"): string {
    return `<div data-testid="cellInnerDiv"><div data-testid="tombstone"><span>${esc(text)}</span></div></div>`;
}

export function mountPage(cells: string[], self = "me") {
    document.body.innerHTML = `<header role="banner"><nav><a data-testid="AppTabBar_Profile_Link" href="/${self}">Profile</a></nav></header>
    <main><div data-testid="primaryColumn"><section><div class="list">${cells.join("")}</div></section></div></main>`;
}

export function setUrl(path: string) {
    history.replaceState(null, "", path);
}

export function freshBackend(initial: Record<string, string> = {}) {
    const backend = createMemoryBackend(initial);
    useBackend(backend);
    return backend;
}

export const flush = () => new Promise(r => setTimeout(r, 0));

export function cellOfTweet(id: string): HTMLElement {
    const a = document.querySelector(`a[href$="/status/${id}"]`)!;
    return a.closest('[data-testid="cellInnerDiv"]') as HTMLElement;
}

export const isHidden = (id: string) => cellOfTweet(id).getAttribute("data-xrb-hidden") === "true";
