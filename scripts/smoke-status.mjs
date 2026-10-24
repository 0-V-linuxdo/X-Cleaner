// Smoke actions for a status page: FAB, review list, shield, rule dialog and narrow layout.
export default async function (page) {
    const out = {};
    const q = (sel) => page.$$eval(sel, els => els.length);
    out.fabVisible = await page.isVisible("#x-cleaner-ui .xc-fab");
    out.badge = await page.textContent("#x-cleaner-ui .xc-fab-badge");
    out.hiddenCells = await q('[data-xrb-hidden="true"]');
    out.shields = await q("[data-xrb-inline-rule]");
    await page.screenshot({ path: "/tmp/claude-0/smoke-1-page.png" });
    // Shield sits left of Grok and opens a local draft without AI.
    out.shieldLeftOfGrok = await page.$eval("[data-xrb-inline-rule-slot]", s => !!s.nextElementSibling?.querySelector('[aria-label="Grok actions"]'));
    let shield = null;
    for (const s of await page.$$("[data-xrb-inline-rule]")) if (await s.isVisible()) { shield = s; break; }
    out.shieldTarget = await shield.evaluate(b => b.closest("article").querySelector("[data-testid=User-Name] a span").textContent);
    await shield.hover();
    await page.waitForTimeout(600);
    out.tooltip = await page.$eval(".xc-native-tooltip", t => t.hidden ? null : t.textContent).catch(() => null);
    await shield.click();
    await page.waitForSelector(".xc-rd-dialog", { timeout: 2000 });
    await page.waitForTimeout(500);
    out.dialog = await page.$eval(".xc-rd-dialog", d => ({
        title: d.querySelector(".xc-rd-title")?.textContent,
        name: d.querySelector('[aria-label="规则名称"]').value,
        source: d.querySelector('[aria-label="正则表达式"]').value,
        cards: [...d.querySelectorAll(".xc-rd-card")].map(c => c.textContent + ":" + c.dataset.state),
        saveDisabled: d.querySelector('button[type="submit"]').disabled,
        focus: document.activeElement?.getAttribute("aria-label"),
    }));
    await page.screenshot({ path: "/tmp/claude-0/smoke-2-dialog.png" });
    await page.keyboard.press("Escape");
    out.dialogClosedByEsc = (await q(".xc-rd-dialog")) === 0;
    // Open the drawer from the FAB.
    await page.click("#x-cleaner-ui .xc-fab");
    await page.waitForTimeout(200);
    out.review = await page.$$eval("#x-cleaner-ui [role=option]", os => os.map(o => o.querySelector(".xc-rec-head")?.textContent));
    out.footer = await page.textContent("#x-cleaner-ui .xc-drawer-footer");
    await page.screenshot({ path: "/tmp/claude-0/smoke-3-review.png" });
    await page.focus("#x-cleaner-ui .xc-main-tabs [role=tab][aria-selected=true]");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(100);
    out.afterArrow = await page.textContent("#x-cleaner-ui .xc-main-tabs [aria-selected=true]");
    out.blacklistSub = await page.textContent("#x-cleaner-ui .xc-sub-tabs [aria-selected=true]");
    await page.screenshot({ path: "/tmp/claude-0/smoke-4-accounts.png" });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(150);
    out.drawerWidthNarrow = await page.$eval("#x-cleaner-ui .xc-drawer", d => Math.round(d.getBoundingClientRect().width));
    await page.screenshot({ path: "/tmp/claude-0/smoke-5-narrow.png" });
    await page.keyboard.press("Escape");
    out.drawerClosed = await page.$eval("#x-cleaner-ui .xc-drawer-overlay", o => o.hidden);
    console.log(JSON.stringify(out, null, 1));
}

export async function extra(page) {
    const out = {};
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.click("#x-cleaner-ui .xc-fab");
    for (const [tab, sub, shot] of [["设置", "AI", "6-ai"], ["黑名单", "正则", "7-regex"], ["设置", "运行", "8-run"], ["插件", null, "9-plugins"]]) {
        await page.click(`#x-cleaner-ui .xc-main-tabs [role=tab]:text-is("${tab}")`);
        if (sub) await page.click(`#x-cleaner-ui .xc-sub-tabs [role=tab]:text-is("${sub}")`);
        await page.waitForTimeout(100);
        await page.screenshot({ path: `/tmp/claude-0/smoke-${shot}.png` });
    }
    out.cancelEditHidden = await page.$eval("#x-cleaner-ui", h => [...h.querySelectorAll("button")].filter(b => b.textContent === "取消编辑").every(b => !b.offsetParent));
    console.log(JSON.stringify(out));
}
