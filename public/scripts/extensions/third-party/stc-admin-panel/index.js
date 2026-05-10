// @ts-nocheck
// STC Admin Panel Extension - entry point

let userExtInfo = null;
let isAdmin = false;
let adminPanelModule = null;

// ── Lightweight CSRF helper ───────────────────────────────────
let _csrfToken = null;
async function getCsrfHeaders() {
    if (!_csrfToken) {
        try {
            const r = await fetch('/csrf-token');
            if (r.ok) _csrfToken = (await r.json()).token;
        } catch {}
    }
    const h = { 'Content-Type': 'application/json' };
    if (_csrfToken) h['x-csrf-token'] = _csrfToken;
    return h;
}

// ── Storage quota global fetch interceptor ────────────────────
// Wrap the native fetch so any 507 response shows a persistent toast.
(function installStorageGuard() {
    const _fetch = window.fetch.bind(window);
    window.fetch = async function(...args) {
        const resp = await _fetch(...args);
        if (resp.status === 507) {
            // Clone so the caller can still read the body if needed
            const clone = resp.clone();
            try {
                const data = await clone.json();
                showStorageQuotaToast(data);
            } catch { showStorageQuotaToast({}); }
        }
        return resp;
    };
})();

let _storageToastTimeout = null;
function showStorageQuotaToast(data) {
    // Remove any existing toast
    document.getElementById('stc-quota-toast')?.remove();
    clearTimeout(_storageToastTimeout);

    const usedMiB   = data.usedMiB   ?? '?';
    const limitMiB  = data.limitMiB  ?? '?';
    const pct       = data.percent   ?? 100;
    const barW      = Math.min(pct, 100);

    const toast = document.createElement('div');
    toast.id = 'stc-quota-toast';
    toast.style.cssText = `
        position:fixed;bottom:16px;left:50%;transform:translateX(-50%);
        z-index:99999;max-width:420px;width:calc(100% - 32px);
        background:#1e1e2e;border:1px solid rgba(231,76,60,.5);
        border-left:4px solid #e74c3c;border-radius:10px;
        padding:14px 16px;box-shadow:0 6px 24px rgba(0,0,0,.5);
        color:#eee;font-size:.88em;font-family:inherit;
        display:flex;flex-direction:column;gap:8px;
        animation:stcSlideUp .25s ease;
    `;
    toast.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;font-weight:600;color:#f08080">
            <i class="fa-solid fa-triangle-exclamation"></i>
            存储空间已满，写入操作已被阻止
            <button onclick="document.getElementById('stc-quota-toast').remove()"
                style="margin-left:auto;background:none;border:none;color:#aaa;cursor:pointer;font-size:1.1em;line-height:1">
                <i class="fa-solid fa-xmark"></i></button>
        </div>
        <div style="font-size:.85em;color:#ccc">
            已使用 <strong style="color:#e74c3c">${usedMiB} MiB</strong> /
            总计 <strong>${limitMiB} MiB</strong>（${pct}%）
        </div>
        <div style="background:rgba(255,255,255,.1);border-radius:4px;height:6px;overflow:hidden">
            <div style="background:#e74c3c;height:100%;width:${barW}%;border-radius:4px"></div>
        </div>
        <div style="font-size:.8em;color:#aaa;display:flex;align-items:center;gap:6px">
            <i class="fa-solid fa-lightbulb" style="color:#f39c12"></i>
            提示：删除不需要的聊天记录或角色卡以释放空间，或联系管理员扩容。
            <a href="#" onclick="document.getElementById('stc-quota-toast').remove();showUserPanel();return false;"
               style="color:#8ab4f8;white-space:nowrap">查看详情</a>
        </div>`;

    document.documentElement.appendChild(toast);

    // Auto-dismiss after 8 seconds
    _storageToastTimeout = setTimeout(() => {
        toast.style.transition = 'opacity .4s';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
    }, 8000);
}

// ── Expiry Warning Toast (≤5 days) ───────────────────────────
function showExpiryWarningToast(info) {
    if (!info?.expiresAt || info.expiresAt === 0) return; // permanent
    if (isExpiredUser(info)) return;                       // already handled by blocking popup

    const daysLeft = Math.ceil((info.expiresAt - Date.now()) / 86400000);
    if (daysLeft > 5) return; // only remind within 5 days

    // Deduplicate: only show once per session per day
    const storageKey = `stc_expiry_warned_${new Date().toISOString().split('T')[0]}`;
    if (sessionStorage.getItem(storageKey)) return;
    sessionStorage.setItem(storageKey, '1');

    const expDate  = new Date(info.expiresAt).toLocaleDateString('zh-CN');
    const urgency  = daysLeft <= 1;
    const borderColor = urgency ? '#e74c3c' : '#f39c12';
    const iconColor   = urgency ? '#e74c3c' : '#f39c12';
    const titleColor  = urgency ? '#f08080' : '#f5d76e';
    const title       = urgency
        ? `⚠ 账户即将到期（${daysLeft <= 0 ? '今日' : '明日'}）`
        : `🕐 账户将在 ${daysLeft} 天后到期`;
    const body        = urgency
        ? `您的账户将于 <strong style="color:${borderColor}">${expDate}</strong> 到期，届时将被强制退出，请尽快续费！`
        : `您的账户将于 <strong>${expDate}</strong> 到期，请及时获取新激活码续费以避免中断使用。`;

    document.getElementById('stc-expiry-toast')?.remove();

    const toast = document.createElement('div');
    toast.id = 'stc-expiry-toast';
    toast.style.cssText = `
        position:fixed;bottom:${document.getElementById('stc-quota-toast') ? '120px' : '16px'};
        left:50%;transform:translateX(-50%);
        z-index:99998;max-width:420px;width:calc(100% - 32px);
        background:#1e1e2e;border:1px solid ${borderColor}55;
        border-left:4px solid ${borderColor};border-radius:10px;
        padding:14px 16px;box-shadow:0 6px 24px rgba(0,0,0,.5);
        color:#eee;font-size:.88em;font-family:inherit;
        display:flex;flex-direction:column;gap:10px;
        animation:stcSlideUp .25s ease;
    `;
    toast.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;font-weight:600;color:${titleColor}">
            <i class="fa-solid fa-clock" style="color:${iconColor}"></i>
            ${title}
            <button onclick="document.getElementById('stc-expiry-toast').remove()"
                style="margin-left:auto;background:none;border:none;color:#aaa;cursor:pointer;font-size:1.1em;line-height:1">
                <i class="fa-solid fa-xmark"></i></button>
        </div>
        <div style="font-size:.85em;color:#ccc;line-height:1.6">${body}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a href="#" onclick="document.getElementById('stc-expiry-toast').remove();showUserPanel();return false;"
               style="flex:1;padding:8px 14px;border-radius:7px;text-align:center;text-decoration:none;font-size:.84em;
                      font-weight:600;background:linear-gradient(135deg,#4a90e2,#6c63ff);color:#fff;
                      display:flex;align-items:center;justify-content:center;gap:6px">
                <i class="fa-solid fa-rotate-right"></i> 立即续费
            </a>
            ${_purchaseLink ? `
            <a href="${_purchaseLink}" target="_blank" rel="noopener"
               style="flex:1;padding:8px 14px;border-radius:7px;text-align:center;text-decoration:none;font-size:.84em;
                      font-weight:600;border:1px solid ${borderColor}66;color:${borderColor};
                      display:flex;align-items:center;justify-content:center;gap:6px">
                <i class="fa-solid fa-cart-shopping"></i> 购买激活码
            </a>` : ''}
        </div>`;

    document.documentElement.appendChild(toast);

    // Auto-dismiss after 12 seconds (longer than storage toast since it's important)
    setTimeout(() => {
        if (!toast.isConnected) return;
        toast.style.transition = 'opacity .4s';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
    }, 12000);
}

jQuery(async () => {
    // Step 1: Check admin status via official /api/users/me
    try {
        const profileResp = await fetch('/api/users/me');
        if (profileResp.ok) {
            const profile = await profileResp.json();
            isAdmin = !!profile.admin;
        }
    } catch (e) {
        console.debug('[STC-MOD] Could not fetch user profile:', e.message);
    }

    // Step 2: Inject admin panel entry buttons if admin
    if (isAdmin) {
        injectAdminButton();
        injectAdminNavLink();
    }

    // Step 2.5: Fetch public config and inject site nav links (forum / characters)
    try {
        const cfgResp = await fetch('/api/stc/public-config/public-pages');
        if (cfgResp.ok) {
            const cfg = await cfgResp.json();
            _purchaseLink = cfg.purchaseLink || '';
            injectSiteNavLinks(cfg);
        }
    } catch (e) {
        console.debug('[STC-MOD] Could not fetch public config:', e.message);
    }

    // Step 3: Try to fetch STC extended user info (optional)
    try {
        const meResp = await fetch('/api/stc/users/me-ext');
        if (meResp.ok) {
            userExtInfo = await meResp.json();
            // Check expiry immediately – show blocking popup if expired
            if (isExpiredUser(userExtInfo)) {
                await showExpiredPopup();
                return; // stop further injection, user must renew first
            }
            injectUserInfo();
            // Show expiry warning toast if account expires within 5 days
            if (!_purchaseLink) {
                fetch('/api/stc/public-config/public-pages')
                    .then(r => r.ok ? r.json() : {})
                    .then(c => { _purchaseLink = c.purchaseLink || ''; })
                    .catch(() => {})
                    .finally(() => showExpiryWarningToast(userExtInfo));
            } else {
                showExpiryWarningToast(userExtInfo);
            }
        }
    } catch (e) {
        console.debug('[STC-MOD] STC-MOD backend not available:', e.message);
    }

    // Step 4: Heartbeat + periodic expiry check
    if (userExtInfo) {
        setInterval(async () => {
            getCsrfHeaders().then(h => fetch('/api/stc/users/heartbeat', { method: 'POST', headers: h })).catch(() => {});
            // Re-check expiry every 5 minutes (for long sessions)
            try {
                const r = await fetch('/api/stc/users/me-ext');
                if (r.ok) {
                    const fresh = await r.json();
                    if (isExpiredUser(fresh) && !document.getElementById('stc-expired-overlay')) {
                        userExtInfo = fresh;
                        await showExpiredPopup();
                    }
                }
            } catch { /* ignore */ }
        }, 5 * 60 * 1000);
    }

    // Step 5: Show main-site announcements
    showMainAnnouncements();
});

// ── Expiry Detection & Blocking Popup ────────────────────────

function isExpiredUser(info) {
    if (!info?.expiresAt || info.expiresAt === 0) return false;
    return Date.now() > info.expiresAt;
}

async function showExpiredPopup() {
    // Prevent duplicate
    if (document.getElementById('stc-expired-overlay')) return;

    let purchaseLink = '';
    try {
        const r = await fetch('/api/stc/public-config/public-pages');
        if (r.ok) { const c = await r.json(); purchaseLink = c.purchaseLink || ''; }
    } catch { /* ignore */ }

    const overlay = document.createElement('div');
    overlay.id = 'stc-expired-overlay';
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:99999;
        background:rgba(0,0,0,.82);
        display:flex;align-items:center;justify-content:center;
        backdrop-filter:blur(4px);
    `;

    const expStr = userExtInfo?.expiresAt
        ? new Date(userExtInfo.expiresAt).toLocaleDateString('zh-CN')
        : '未知';

    overlay.innerHTML = `
        <div style="
            background:var(--SmartThemeBodyColor2,#16213e);
            border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.12));
            border-radius:14px;padding:32px 28px;max-width:420px;width:90%;
            color:var(--SmartThemeBodyColor,#eee);box-shadow:0 12px 40px rgba(0,0,0,.6);
            display:flex;flex-direction:column;gap:16px;
        ">
            <!-- Icon + title -->
            <div style="text-align:center">
                <i class="fa-solid fa-clock-rotate-left" style="font-size:2.4em;color:#e74c3c;margin-bottom:10px;display:block"></i>
                <h3 style="margin:0 0 6px;font-size:1.2em;color:#f08080">账户使用时间已到期</h3>
                <p style="margin:0;font-size:.85em;opacity:.7">到期时间：${expStr}，请续费后继续使用</p>
            </div>

            <!-- Renewal form -->
            <div style="display:flex;flex-direction:column;gap:10px">
                <input id="stc-exp-code" type="text" placeholder="输入激活码续费" autocomplete="off"
                    style="padding:10px 14px;border-radius:7px;border:1px solid var(--SmartThemeBorderColor,#555);
                    background:var(--SmartThemeBlurTintColor,rgba(255,255,255,.06));color:inherit;
                    font-size:.95em;box-sizing:border-box;width:100%">
                <button id="stc-exp-renew-btn"
                    style="padding:11px;border-radius:7px;border:none;cursor:pointer;font-size:.95em;font-weight:600;
                    background:#2ecc71;color:#fff;transition:background .2s;display:flex;align-items:center;justify-content:center;gap:8px">
                    <i class="fa-solid fa-rotate-right"></i> 立即续费
                </button>
                ${purchaseLink ? `
                <a href="${purchaseLink}" target="_blank" rel="noopener"
                    style="padding:10px;border-radius:7px;border:1px solid #f39c12;
                    background:rgba(243,156,18,.08);color:#f39c12;text-decoration:none;
                    font-size:.88em;font-weight:600;text-align:center;display:flex;align-items:center;justify-content:center;gap:8px;transition:background .2s">
                    <i class="fa-solid fa-cart-shopping"></i> 购买激活码
                </a>` : ''}
                <div id="stc-exp-msg" style="display:none;padding:9px 12px;border-radius:6px;font-size:.84em;text-align:center"></div>
            </div>

            <!-- Logout option -->
            <div style="text-align:center;font-size:.8em;opacity:.5;margin-top:-4px">
                <a href="/login" style="color:inherit">← 退出并切换账号</a>
            </div>
        </div>`;

    document.documentElement.appendChild(overlay);

    const showExpMsg = (text, ok) => {
        const el = document.getElementById('stc-exp-msg');
        if (!el) return;
        el.style.display = '';
        el.style.background = ok ? 'rgba(46,204,113,.12)' : 'rgba(231,76,60,.12)';
        el.style.border = `1px solid ${ok ? 'rgba(46,204,113,.3)' : 'rgba(231,76,60,.3)'}`;
        el.style.color = ok ? '#2ecc71' : '#e74c3c';
        el.textContent = text;
    };

    document.getElementById('stc-exp-renew-btn').addEventListener('click', async function() {
        const code = document.getElementById('stc-exp-code')?.value?.trim();
        if (!code) { showExpMsg('请输入激活码', false); return; }
        const handle = userExtInfo?.handle;
        if (!handle) { showExpMsg('无法获取账号信息，请刷新页面', false); return; }

        this.disabled = true;
        this.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 续费中...';

        try {
            const r = await fetch('/api/stc/users/renew-expired', {
                method: 'POST',
                headers: await getCsrfHeaders(),
                body: JSON.stringify({ handle, inviteCode: code }),
            });
            const d = await r.json();
            if (d.success) {
                const expStr = d.expiresAt ? new Date(d.expiresAt).toLocaleDateString('zh-CN') : '永久';
                showExpMsg(`续费成功！有效期至 ${expStr}，正在刷新...`, true);
                setTimeout(() => location.reload(), 1800);
            } else {
                showExpMsg(d.error || '续费失败，请检查激活码', false);
                this.disabled = false;
                this.innerHTML = '<i class="fa-solid fa-rotate-right"></i> 立即续费';
            }
        } catch (e) {
            showExpMsg('网络错误，请重试', false);
            this.disabled = false;
            this.innerHTML = '<i class="fa-solid fa-rotate-right"></i> 立即续费';
        }
    });
}

// ── Main-site Announcements ───────────────────────────────────
async function showMainAnnouncements() {
    try {
        const r = await fetch('/api/stc/announcements/current');
        if (!r.ok) return;
        const anns = await r.json();
        if (!anns?.length) return;

        // Use SillyTavern's official Popup system (theme-aware)
        const { Popup, POPUP_TYPE } = await import('/scripts/popup.js');
        const content = buildAnnouncementContent(anns);
        const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
            okButton: '我知道了',
            wide: false,
            allowVerticalScrolling: true,
        });
        await popup.show();
    } catch (e) {
        console.debug('[STC-MOD] Announcement popup error:', e.message);
    }
}

/** Build announcement HTML content for the Popup */
function buildAnnouncementContent(anns) {
    const ANN_BORDER = {
        info:    '#4a90e2',
        warning: '#f39c12',
        success: '#27ae60',
        error:   '#e74c3c',
    };

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:12px;width:100%';

    // Header
    const header = document.createElement('h3');
    header.style.cssText = 'margin:0 0 4px;display:flex;align-items:center;gap:8px;font-size:1.1em';
    header.innerHTML = '<i class="fa-solid fa-bullhorn"></i> 系统公告';
    wrap.appendChild(header);

    // One card per announcement
    for (const ann of anns) {
        const borderColor = ANN_BORDER[ann.type] || ANN_BORDER.info;

        const card = document.createElement('div');
        card.style.cssText = `
            border-left: 3px solid ${borderColor};
            padding: 10px 14px;
            border-radius: 4px;
            background: var(--SmartThemeBotMesBlurTintColor, rgba(255,255,255,0.05));
            line-height: 1.6;
            font-size: 0.95em;
        `;

        // Title
        if (ann.title) {
            const titleEl = document.createElement('div');
            titleEl.style.cssText = 'font-weight:600;margin-bottom:6px;font-size:1em';
            titleEl.textContent = ann.title;
            card.appendChild(titleEl);
        }

        // Content - preserve newlines
        if (ann.content) {
            const contentEl = document.createElement('div');
            contentEl.style.cssText = 'white-space:pre-wrap;word-break:break-word';
            contentEl.textContent = ann.content;
            card.appendChild(contentEl);
        }

        // Timestamp
        if (ann.createdAt) {
            const timeEl = document.createElement('div');
            timeEl.style.cssText = 'margin-top:8px;font-size:0.78em;opacity:0.5;text-align:right';
            timeEl.textContent = '发布时间: ' + new Date(ann.createdAt).toLocaleString('zh-CN');
            card.appendChild(timeEl);
        }

        wrap.appendChild(card);
    }

    return wrap;
}

// ── User Info Widget (floating badge) ────────────────────────
function injectUserInfo() {
    if (!userExtInfo) return;
    const existing = document.getElementById('stc-user-info');
    if (existing) existing.remove();

    const infoDiv = document.createElement('div');
    infoDiv.id = 'stc-user-info';

    let html = `<div style="font-weight:600;margin-bottom:2px">${esc(userExtInfo.handle)}</div>`;
    if (userExtInfo.expiresAt && userExtInfo.expiresAt > 0) {
        const days = Math.ceil((userExtInfo.expiresAt - Date.now()) / 86400000);
        const color = days <= 3 ? '#e74c3c' : days <= 7 ? '#f39c12' : '#2ecc71';
        html += `<div style="color:${color};font-size:11px">到期 ${days} 天</div>`;
    }
    if (userExtInfo.storage?.enabled) {
        const s = userExtInfo.storage;
        const pct = s.percent;
        const isOverQuota = pct >= 100;
        const barColor = isOverQuota ? '#e74c3c' : pct >= 90 ? '#e74c3c' : pct >= 70 ? '#f39c12' : '#4a90e2';
        html += `<div style="font-size:11px;margin-top:3px;margin-bottom:2px;display:flex;align-items:center;gap:4px">
            ${isOverQuota ? '<i class="fa-solid fa-triangle-exclamation" style="color:#e74c3c;font-size:10px"></i>' : ''}
            <span style="color:${pct >= 90 ? '#e74c3c' : '#aaa'}">${s.usedMiB}</span>
            <span style="color:#666"> / </span>
            <span>${s.limitMiB} MiB</span>
            ${isOverQuota ? '<span style="color:#e74c3c;font-size:9px;font-weight:600">超限</span>' : ''}
        </div>`;
        html += `<div style="background:rgba(255,255,255,.15);border-radius:3px;height:4px">
            <div style="background:${barColor};height:100%;border-radius:3px;width:${Math.min(pct, 100)}%;transition:width .3s"></div>
        </div>`;
        if (!isOverQuota && s.dailyCheckInMiB > 0) {
            const today = new Date().toISOString().split('T')[0];
            const alreadyCheckedIn = s.lastCheckInDate === today;
            if (!alreadyCheckedIn) {
                html += `<div style="margin-top:4px;font-size:10px;color:#2ecc71">
                    <i class="fa-solid fa-gift"></i> 可签到 +${s.dailyCheckInMiB} MiB</div>`;
            }
        }
        if (isOverQuota) {
            html += `<div style="margin-top:4px;font-size:10px;color:#e74c3c">
                <i class="fa-solid fa-ban"></i> 写入已被限制</div>`;
        }
    }
    // Wrap content + add close button
    const inner = document.createElement('div');
    inner.id = 'stc-user-info-inner';
    inner.innerHTML = html;
    inner.style.cssText = 'cursor:pointer';
    inner.addEventListener('click', showUserPanel);

    const closeBtn = document.createElement('button');
    closeBtn.title = '隐藏（点击悬浮按钮可重新展开）';
    closeBtn.innerHTML = '×';
    closeBtn.style.cssText = [
        'position:absolute', 'top:2px', 'right:4px',
        'background:none', 'border:none', 'color:rgba(220,220,210,.5)',
        'font-size:14px', 'line-height:1', 'cursor:pointer', 'padding:0 2px',
        'pointer-events:auto',
    ].join(';');
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        infoDiv.style.display = 'none';
        // No persistence — hides only for this page load; refreshing always restores it
    });

    // Only add padding-right to make room for the close button.
    // Do NOT set position:relative here — the CSS already sets position:fixed for desktop,
    // and mobile code below sets position:absolute. An inline position:relative would
    // override the CSS fixed and break desktop visibility.
    infoDiv.style.paddingRight = '16px';
    infoDiv.appendChild(inner);
    infoDiv.appendChild(closeBtn);
    infoDiv.title = '';

    // No persistence: always visible on page load; close button hides only within this session

    if (isMobileViewport()) {
        try { localStorage.removeItem('stc_user_info_pos'); } catch { /**/ }
        infoDiv.style.position = 'absolute';
        infoDiv.style.left = '10px';
        infoDiv.style.bottom = '92px';
        infoDiv.style.top = 'auto';
        infoDiv.style.right = 'auto';
        infoDiv.style.zIndex = '99999';
        getStcHost().appendChild(infoDiv);
    } else {
        getStcHost().appendChild(infoDiv);
        makeDraggable(infoDiv, 'stc_user_info_pos', { bottom: '12px', left: '12px' }, () => {});
    }

    // "展开"小按钮 — 隐藏后出现的恢复圆点
    let revealBtn = document.getElementById('stc-user-info-reveal');
    if (!revealBtn) {
        revealBtn = document.createElement('div');
        revealBtn.id = 'stc-user-info-reveal';
        revealBtn.title = '展开用户信息';
        revealBtn.innerHTML = '<i class="fa-solid fa-circle-user"></i>';
        revealBtn.style.cssText = [
            'position:fixed',
            'bottom:12px', 'left:12px',
            'width:30px', 'height:30px',
            'border-radius:50%',
            'background:rgba(22,33,62,.9)',
            'color:rgba(220,220,210,.7)',
            'font-size:14px',
            'display:none',
            'align-items:center', 'justify-content:center',
            'cursor:pointer',
            'z-index:2147483647',
            'box-shadow:0 2px 8px rgba(0,0,0,.4)',
            'pointer-events:auto',
        ].join(';');
        revealBtn.addEventListener('click', () => {
            infoDiv.style.display = '';
            revealBtn.style.display = 'none';
        });
        getStcHost().appendChild(revealBtn);
    }

    // Sync reveal button visibility with infoDiv visibility
    const syncReveal = () => {
        const isHidden = infoDiv.style.display === 'none';
        revealBtn.style.display = isHidden ? 'flex' : 'none';
    };
    new MutationObserver(syncReveal).observe(infoDiv, { attributes: true, attributeFilter: ['style'] });
    syncReveal();

    // Inject nav link for all users with storage
    if (userExtInfo.storage?.enabled) {
        injectUserStorageNavLink();
    }
}

function injectUserStorageNavLink() {
    if (document.getElementById('stc-nav-storage-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'stc-nav-storage-btn';
    btn.className = 'list-group-item';
    btn.title = '我的账户信息与存储空间';
    btn.style.cssText = 'cursor:pointer;display:flex;align-items:center;gap:6px;';
    btn.innerHTML = '<i class="fa-solid fa-circle-user"></i><span>我的账户</span>';
    btn.addEventListener('click', showUserPanel);

    const targets = [
        document.getElementById('stc-nav-admin-btn'),
        document.getElementById('admin_panel_link'),
        document.querySelector('#logout_button'),
        document.querySelector('#user_settings_block .user-info-buttons'),
        document.querySelector('.user-settings-header'),
    ];

    for (const target of targets) {
        if (target) {
            target.parentNode.insertBefore(btn, target);
            return;
        }
    }
    // Fallback: append to body as small badge
    document.body.appendChild(btn);
}

// ── User Storage Panel (Popup) ────────────────────────────────
let _purchaseLink = '';

async function showUserPanel() {
    try {
        const meResp = await fetch('/api/stc/users/me-ext');
        if (meResp.ok) userExtInfo = await meResp.json();
    } catch { /* use cached */ }

    if (!userExtInfo) return;

    // Fetch purchase link (cached after first load)
    if (!_purchaseLink) {
        try {
            const r = await fetch('/api/stc/public-config/public-pages');
            if (r.ok) { const c = await r.json(); _purchaseLink = c.purchaseLink || ''; }
        } catch { /* ignore */ }
    }

    try {
        const { Popup, POPUP_TYPE } = await import('/scripts/popup.js');
        const content = buildUserPanelContent(_purchaseLink);
        const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
            okButton: '关闭',
            wide: false,
            allowVerticalScrolling: true,
        });

        // Wire up buttons inside popup content
        bindUserPanelButtons(content, popup);

        await popup.show();
        // Refresh floating widget after panel closes
        injectUserInfo();
    } catch (e) {
        console.error('[STC-MOD] User panel error:', e);
    }
}

function buildUserPanelContent(purchaseLink = '') {
    const me = userExtInfo;
    const CARD = 'display:flex;flex-direction:column;gap:10px;padding:14px 16px;border-radius:10px;background:var(--SmartThemeBotMesBlurTintColor,rgba(255,255,255,.04));border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.08));max-width:100%;box-sizing:border-box';
    const ROW  = 'display:flex;align-items:center;gap:10px;font-size:.9em;min-width:0';
    const ICON = 'width:16px;text-align:center;opacity:.6;flex-shrink:0';

    const wrap = document.createElement('div');
    const isNarrowMobile = window.innerWidth <= 520;
    wrap.style.cssText = `display:flex;flex-direction:column;gap:14px;width:100%;min-width:${isNarrowMobile ? '0' : '300px'};max-width:100%;box-sizing:border-box;overflow-x:hidden`;

    // ━━━━ 1. Header ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const oauthIcons = { github: 'fa-brands fa-github', discord: 'fa-brands fa-discord', linuxdo: 'fa-solid fa-globe' };
    const oauthIcon = me.oauthProvider ? (oauthIcons[me.oauthProvider] || 'fa-solid fa-link') : null;
    const accountBadge = me.oauthProvider
        ? `<i class="${oauthIcon}" style="font-size:.85em"></i> ${esc(me.oauthProvider)} 账号`
        : '<i class="fa-solid fa-user-shield" style="font-size:.85em"></i> 本地账号';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:14px;padding-bottom:14px;border-bottom:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.1))';
    header.innerHTML = `
        <div style="width:52px;height:52px;border-radius:50%;background:var(--SmartThemeBlurTintColor,rgba(255,255,255,.08));
            display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:1.6em;
            border:2px solid var(--SmartThemeBorderColor,rgba(255,255,255,.15))">
            <i class="fa-solid fa-circle-user" style="opacity:.8"></i>
        </div>
        <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:1.12em;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                title="${esc(me.handle)}">${esc(me.handle)}</div>
            <div style="font-size:.78em;opacity:.5;display:flex;align-items:center;gap:5px">${accountBadge}</div>
        </div>`;
    wrap.appendChild(header);

    // ━━━━ 2. Account Info Card ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const infoCard = document.createElement('div');
    infoCard.style.cssText = CARD;
    infoCard.innerHTML = `<div style="font-weight:600;font-size:.88em;opacity:.7;margin-bottom:2px;display:flex;align-items:center;gap:6px">
        <i class="fa-solid fa-id-card"></i> 账户信息</div>`;

    const infoRows = [];
    // Email
    if (me.email) {
        infoRows.push(`<div style="${ROW}">
            <i class="fa-solid fa-envelope" style="${ICON}"></i>
            <span style="opacity:.7;flex-shrink:0">邮箱</span>
            <span style="margin-left:auto;font-size:.9em;opacity:.9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px" title="${esc(me.email)}">${esc(me.email)}</span>
        </div>`);
    } else {
        infoRows.push(`<div style="${ROW}">
            <i class="fa-solid fa-envelope" style="${ICON}"></i>
            <span style="opacity:.7;flex-shrink:0">邮箱</span>
            <span style="margin-left:auto;opacity:.35;font-size:.85em">未绑定</span>
        </div>`);
    }
    // Registration date
    if (me.createdAt) {
        infoRows.push(`<div style="${ROW}">
            <i class="fa-solid fa-user-plus" style="${ICON}"></i>
            <span style="opacity:.7;flex-shrink:0">注册时间</span>
            <span style="margin-left:auto;font-size:.88em;opacity:.8">${new Date(me.createdAt).toLocaleDateString('zh-CN')}</span>
        </div>`);
    }
    // Last login
    if (me.lastLoginAt) {
        infoRows.push(`<div style="${ROW}">
            <i class="fa-solid fa-right-to-bracket" style="${ICON}"></i>
            <span style="opacity:.7;flex-shrink:0">上次登录</span>
            <span style="margin-left:auto;font-size:.88em;opacity:.8">${new Date(me.lastLoginAt).toLocaleString('zh-CN')}</span>
        </div>`);
    }

    infoCard.innerHTML += infoRows.join('<div style="height:1px;background:var(--SmartThemeBorderColor,rgba(255,255,255,.06));margin:2px 0"></div>');
    wrap.appendChild(infoCard);

    // ━━━━ 3. Subscription / Expiry Card ━━━━━━━━━━━━━━━━━━━━━━━
    const subCard = document.createElement('div');
    subCard.style.cssText = CARD;

    const isPermanent = !me.expiresAt || me.expiresAt === 0;
    const isExpired = !isPermanent && Date.now() > me.expiresAt;
    const daysLeft = isPermanent ? null : Math.ceil((me.expiresAt - Date.now()) / 86400000);

    let expiryColor = '#2ecc71';
    let expiryIcon = 'fa-solid fa-infinity';
    let expiryLabel = '永久有效';
    let expiryBadgeBg = 'rgba(46,204,113,.12)';
    let expiryBadgeBorder = 'rgba(46,204,113,.3)';

    if (!isPermanent) {
        if (isExpired) {
            expiryColor = '#e74c3c'; expiryIcon = 'fa-solid fa-circle-xmark';
            expiryLabel = '已过期'; expiryBadgeBg = 'rgba(231,76,60,.12)'; expiryBadgeBorder = 'rgba(231,76,60,.3)';
        } else if (daysLeft <= 3) {
            expiryColor = '#e74c3c'; expiryIcon = 'fa-solid fa-triangle-exclamation';
            expiryLabel = `剩余 ${daysLeft} 天`; expiryBadgeBg = 'rgba(231,76,60,.1)'; expiryBadgeBorder = 'rgba(231,76,60,.3)';
        } else if (daysLeft <= 7) {
            expiryColor = '#f39c12'; expiryIcon = 'fa-solid fa-clock';
            expiryLabel = `剩余 ${daysLeft} 天`; expiryBadgeBg = 'rgba(243,156,18,.1)'; expiryBadgeBorder = 'rgba(243,156,18,.3)';
        } else {
            expiryIcon = 'fa-solid fa-clock'; expiryLabel = `剩余 ${daysLeft} 天`;
        }
    }

    subCard.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between">
            <div style="font-weight:600;font-size:.88em;opacity:.7;display:flex;align-items:center;gap:6px">
                <i class="fa-solid fa-calendar-check"></i> 账户有效期
            </div>
            <div style="padding:3px 10px;border-radius:20px;font-size:.8em;font-weight:600;
                background:${expiryBadgeBg};border:1px solid ${expiryBadgeBorder};color:${expiryColor};
                display:flex;align-items:center;gap:5px">
                <i class="${expiryIcon}"></i> ${expiryLabel}
            </div>
        </div>`;

    // Specific expiry date row (when not permanent)
    if (!isPermanent) {
        const expDate = new Date(me.expiresAt).toLocaleDateString('zh-CN');
        const expTime = new Date(me.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        subCard.innerHTML += `
            <div style="${ROW};margin-top:2px">
                <i class="fa-regular fa-calendar" style="${ICON}"></i>
                <span style="opacity:.7">到期时间</span>
                <span style="margin-left:auto;font-size:.88em;color:${expiryColor}">${expDate} ${expTime}</span>
            </div>`;
    }

    // ── Renewal section (always visible) ──────────────────────
    const renewSection = document.createElement('div');
    renewSection.style.cssText = 'border-top:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.08));padding-top:10px;display:flex;flex-direction:column;gap:8px';

    const renewHint = isPermanent
        ? '使用激活码可为账户续期（当前永久有效时续期时间从今日起算）'
        : '使用激活码续费（到期前续费时间自当前到期日顺延）';

    renewSection.innerHTML = `
        <div style="font-size:.8em;opacity:.55">${renewHint}</div>
        <div style="display:flex;gap:8px;flex-wrap:${isNarrowMobile ? 'wrap' : 'nowrap'}">
            <input id="stc-renew-code" placeholder="输入激活码" autocomplete="off"
                style="flex:1;min-width:0;padding:8px 12px;border-radius:6px;border:1px solid var(--SmartThemeBorderColor,#444);
                background:var(--SmartThemeBlurTintColor,rgba(0,0,0,.3));color:inherit;font-size:.9em">
            <button id="stc-renew-btn" class="menu_button" style="padding:8px 16px;font-size:.85em;white-space:nowrap;${isNarrowMobile ? 'width:100%' : ''}">
                <i class="fa-solid fa-rotate-right"></i> 激活</button>
        </div>`;

    // Purchase link button (shown if purchaseLink is configured)
    if (purchaseLink) {
        const buyBtn = document.createElement('a');
        buyBtn.href = purchaseLink;
        buyBtn.target = '_blank';
        buyBtn.rel = 'noopener';
        buyBtn.style.cssText = `
            display:flex;align-items:center;justify-content:center;gap:7px;
            padding:9px 14px;border-radius:7px;text-decoration:none;font-size:.86em;font-weight:600;
            border:1px solid rgba(243,156,18,.4);background:rgba(243,156,18,.07);color:#f39c12;
            transition:background .2s;`;
        buyBtn.innerHTML = '<i class="fa-solid fa-cart-shopping"></i> 购买激活码';
        buyBtn.onmouseenter = () => { buyBtn.style.background = 'rgba(243,156,18,.16)'; };
        buyBtn.onmouseleave = () => { buyBtn.style.background = 'rgba(243,156,18,.07)'; };
        renewSection.appendChild(buyBtn);
    }

    subCard.appendChild(renewSection);
    wrap.appendChild(subCard);

    // ━━━━ 4. Storage Card ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (me.storage?.enabled) {
        const s = me.storage;
        const pct = s.percent;
        const barColor = pct >= 90 ? '#e74c3c' : pct >= 70 ? '#f39c12' : '#4a90e2';
        const today = new Date().toISOString().split('T')[0];
        const alreadyCheckedIn = s.lastCheckInDate === today;

        const storageCard = document.createElement('div');
        storageCard.style.cssText = CARD;
        storageCard.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="font-weight:600;font-size:.88em;opacity:.7;display:flex;align-items:center;gap:6px">
                    <i class="fa-solid fa-hard-drive"></i> 存储空间
                </div>
                <div style="font-size:.82em;opacity:.6">${s.usedMiB} / ${s.limitMiB} MiB</div>
            </div>
            <div>
                <div style="background:var(--SmartThemeBorderColor,rgba(255,255,255,.12));border-radius:6px;height:10px;overflow:hidden">
                    <div id="stc-storage-bar" style="background:${barColor};height:100%;border-radius:6px;
                        width:${Math.min(pct, 100)}%;transition:width .5s ease"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:.78em;margin-top:5px;opacity:.55">
                    <span style="color:${pct >= 90 ? '#e74c3c' : 'inherit'}">${pct}% 已使用</span>
                    <span>剩余 ${s.remainingMiB} MiB</span>
                </div>
            </div>`;

        // Check-in row
        if (s.dailyCheckInMiB > 0) {
            const checkinRow = document.createElement('div');
            checkinRow.style.cssText = `border-top:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.08));padding-top:10px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:${isNarrowMobile ? 'wrap' : 'nowrap'}`;
            if (alreadyCheckedIn) {
                checkinRow.innerHTML = `
                    <span style="font-size:.85em;opacity:.55;display:flex;align-items:center;gap:6px">
                        <i class="fa-solid fa-circle-check" style="color:#2ecc71"></i> 今日已签到
                    </span>
                    <span style="font-size:.78em;opacity:.45">明日可领 +${s.dailyCheckInMiB} MiB</span>`;
            } else {
                checkinRow.innerHTML = `
                    <span style="font-size:.85em;opacity:.7;display:flex;align-items:center;gap:6px">
                        <i class="fa-solid fa-gift"></i> 每日签到奖励 +${s.dailyCheckInMiB} MiB
                    </span>
                    <button id="stc-checkin-btn" class="menu_button"
                        style="padding:7px 16px;font-size:.84em;background:#2ecc71;color:#fff;border-color:transparent;white-space:nowrap;flex-shrink:0">
                        签到领取</button>`;
            }
            storageCard.appendChild(checkinRow);
        }

        // Activation code row
        const codeRow = document.createElement('div');
        codeRow.style.cssText = 'border-top:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.08));padding-top:10px;display:flex;flex-direction:column;gap:8px';
        codeRow.innerHTML = `
            <div style="font-size:.8em;opacity:.6"><i class="fa-solid fa-key"></i> 存储激活码</div>
            <div style="display:flex;gap:8px;flex-wrap:${isNarrowMobile ? 'wrap' : 'nowrap'}">
                <input id="stc-storage-code" placeholder="输入激活码" autocomplete="off"
                    style="flex:1;min-width:0;padding:8px 12px;border-radius:6px;border:1px solid var(--SmartThemeBorderColor,#444);
                    background:var(--SmartThemeBlurTintColor,rgba(0,0,0,.3));color:inherit;font-size:.9em">
                <button id="stc-use-code-btn" class="menu_button" style="padding:8px 16px;font-size:.85em;white-space:nowrap;${isNarrowMobile ? 'width:100%' : ''}">
                    <i class="fa-solid fa-bolt"></i> 激活</button>
            </div>`;
        storageCard.appendChild(codeRow);
        wrap.appendChild(storageCard);
    }

    // ━━━━ 4b. API 密钥保险箱 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const vaultCard = document.createElement('div');
    vaultCard.id = 'stc-vault-card';
    vaultCard.style.cssText = CARD;
    vaultCard.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <div style="font-weight:600;font-size:.88em;opacity:.7;display:flex;align-items:center;gap:6px">
                <i class="fa-solid fa-shield-halved"></i> API 密钥保险箱
            </div>
            <div id="stc-vault-badge" style="padding:3px 10px;border-radius:20px;font-size:.78em;font-weight:600;
                background:rgba(127,127,127,.12);border:1px solid rgba(127,127,127,.3);opacity:.75;
                display:inline-flex;align-items:center;gap:5px">
                <i class="fa-solid fa-ellipsis"></i> 加载中…
            </div>
        </div>
        <div id="stc-vault-hint" style="font-size:.8em;opacity:.6;line-height:1.5">
            启用后，API 密钥将使用你单独设置的保险箱密码加密落盘，服务器运维无法直接读取明文。
        </div>
        <div id="stc-vault-actions" style="display:flex;gap:8px;flex-wrap:wrap">
        </div>
        <div id="stc-vault-reset-row" style="display:none;border-top:1px dashed var(--SmartThemeBorderColor,rgba(255,255,255,.12));padding-top:10px;align-items:center;gap:10px;flex-wrap:wrap">
            <div style="font-size:.78em;opacity:.55;line-height:1.5;flex:1 1 200px;min-width:0">
                忘记保险箱密码时可重置：<strong style="color:#e74c3c">当前保险箱内所有已加密的 API 密钥将被一并删除</strong>，需要你重新录入。
            </div>
            <button id="stc-vault-reset-btn" class="menu_button"
                style="padding:7px 14px;font-size:.84em;background:rgba(231,76,60,.1);color:#e74c3c;border:1px solid rgba(231,76,60,.4);white-space:nowrap;flex:0 0 auto">
                <i class="fa-solid fa-triangle-exclamation"></i> 忘记密码 / 重置保险箱
            </button>
        </div>`;
    wrap.appendChild(vaultCard);

    // ━━━━ 4c. 微信 Bot 绑定 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const wechatCard = document.createElement('div');
    wechatCard.id = 'stc-wechat-card';
    wechatCard.style.cssText = CARD;
    wechatCard.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <div style="font-weight:600;font-size:.88em;opacity:.7;display:flex;align-items:center;gap:6px">
                <i class="fa-brands fa-weixin"></i> 微信 Bot 绑定
            </div>
            <div id="stc-wx-badge" style="padding:3px 10px;border-radius:20px;font-size:.78em;font-weight:600;
                background:rgba(127,127,127,.12);border:1px solid rgba(127,127,127,.3);opacity:.75;
                display:inline-flex;align-items:center;gap:5px">
                <i class="fa-solid fa-ellipsis"></i> 加载中…
            </div>
        </div>
        <div id="stc-wx-hint" style="font-size:.8em;opacity:.6;line-height:1.5">
            把一个微信<strong>小号</strong>扫码接管为你的 AI Bot。你的主号加这个小号好友后，主号的消息会经 SillyTavern 用角色卡回复。
        </div>
        <div id="stc-wx-actions" style="display:flex;flex-direction:column;gap:10px">
        </div>`;
    wrap.appendChild(wechatCard);

    // ━━━━ 5. Message area ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const msgArea = document.createElement('div');
    msgArea.id = 'stc-panel-msg';
    msgArea.style.cssText = 'display:none;padding:10px 14px;border-radius:6px;font-size:.88em;text-align:center';
    wrap.appendChild(msgArea);

    return wrap;
}

function bindUserPanelButtons(content, popup) {
    const showMsg = (text, ok = true) => {
        const el = content.querySelector('#stc-panel-msg');
        if (!el) return;
        el.style.display = '';
        el.style.background = ok ? 'rgba(39,174,96,.15)' : 'rgba(231,76,60,.15)';
        el.style.border = `1px solid ${ok ? 'rgba(39,174,96,.4)' : 'rgba(231,76,60,.4)'}`;
        el.style.color = ok ? '#2ecc71' : '#e74c3c';
        el.textContent = text;
    };

    // Renew
    content.querySelector('#stc-renew-btn')?.addEventListener('click', async () => {
        const code = content.querySelector('#stc-renew-code')?.value?.trim();
        if (!code) { showMsg('请输入邀请码', false); return; }
        try {
            const r = await fetch('/api/stc/users/renew', {
                method: 'POST', headers: await getCsrfHeaders(),
                body: JSON.stringify({ inviteCode: code }),
            });
            const d = await r.json();
            if (d.success) {
                showMsg(`续费成功！到期时间：${new Date(d.expiresAt).toLocaleDateString('zh-CN')}`);
                const meResp = await fetch('/api/stc/users/me-ext');
                if (meResp.ok) userExtInfo = await meResp.json();
            } else {
                showMsg(d.error || '续费失败', false);
            }
        } catch (e) { showMsg('请求失败: ' + e.message, false); }
    });

    // Check-in
    content.querySelector('#stc-checkin-btn')?.addEventListener('click', async () => {
        const btn = content.querySelector('#stc-checkin-btn');
        if (btn?.disabled) return;
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 签到中...'; }
        try {
            const r = await fetch('/api/stc/users/check-in', { method: 'POST', headers: await getCsrfHeaders() });
            const d = await r.json();
            if (d.success) {
                showMsg(`🎉 签到成功！本次获得 +${d.addedMiB} MiB，当前总额度 ${d.newLimitMiB} MiB`);
                // Refresh storage data and update bar
                const meResp = await fetch('/api/stc/users/me-ext');
                if (meResp.ok) {
                    userExtInfo = await meResp.json();
                    const s = userExtInfo.storage;
                    if (s) {
                        const bar = content.querySelector('#stc-storage-bar');
                        if (bar) bar.style.width = `${Math.min(s.percent, 100)}%`;
                    }
                }
                if (btn) {
                    btn.disabled = true;
                    btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> 今日已签到';
                    btn.style.background = '';
                    btn.style.opacity = '0.5';
                    btn.style.cursor = 'not-allowed';
                }
            } else {
                showMsg(d.reason || '签到失败', false);
                if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-gift"></i> 每日签到 +${userExtInfo.storage?.dailyCheckInMiB} MiB`; }
            }
        } catch (e) {
            showMsg('请求失败: ' + e.message, false);
            if (btn) { btn.disabled = false; }
        }
    });

    // Storage code activation
    content.querySelector('#stc-use-code-btn')?.addEventListener('click', async () => {
        const code = content.querySelector('#stc-storage-code')?.value?.trim();
        if (!code) { showMsg('请输入激活码', false); return; }
        try {
            const r = await fetch('/api/stc/users/use-storage-code', {
                method: 'POST', headers: await getCsrfHeaders(),
                body: JSON.stringify({ code }),
            });
            const d = await r.json();
            if (d.success) {
                showMsg(`激活成功！+${d.addedMiB} MiB，当前总额度 ${d.newLimitMiB} MiB`);
                content.querySelector('#stc-storage-code').value = '';
                const meResp = await fetch('/api/stc/users/me-ext');
                if (meResp.ok) userExtInfo = await meResp.json();
            } else {
                showMsg(d.reason || '激活失败', false);
            }
        } catch (e) { showMsg('请求失败: ' + e.message, false); }
    });

    // ── API 密钥保险箱 ──────────────────────────────────────
    wireVaultCard(content, showMsg, popup);

    // ── 微信 Bot 绑定 ────────────────────────────────────────
    wireWechatCard(content, showMsg);
}

/**
 * Prompt the user for a vault passphrase via ST's Popup system.
 * @param {{ title: string, message: string, confirm?: boolean }} opts
 * @returns {Promise<string|null>}
 */
async function askVaultPassphrase({ title, message, confirm = false }) {
    const { Popup, POPUP_TYPE, POPUP_RESULT } = await import('/scripts/popup.js');
    const id = Math.random().toString(36).slice(2);
    const pwId = `stc-vault-pw-${id}`;
    const cfId = `stc-vault-pw-confirm-${id}`;
    const container = document.createElement('div');
    container.className = 'flex-container flexFlowColumn';
    container.innerHTML = `
        <h3 style="margin:0 0 6px">${esc(title)}</h3>
        <p style="margin:0 0 10px;opacity:.8;font-size:.9em;line-height:1.5">${esc(message)}</p>
        <input id="${pwId}" type="password" class="text_pole" autocomplete="new-password"
            placeholder="保险箱密码（至少 8 位）">
        ${confirm ? `<input id="${cfId}" type="password" class="text_pole" style="margin-top:6px" autocomplete="new-password"
            placeholder="再次输入保险箱密码">` : ''}`;

    let pw = '', cf = '';
    const popup = new Popup(container, POPUP_TYPE.CONFIRM, '', {
        okButton: '继续',
        cancelButton: '取消',
        onOpen: () => document.getElementById(pwId)?.focus(),
        onClose: () => {
            pw = document.getElementById(pwId)?.value || '';
            cf = document.getElementById(cfId)?.value || '';
        },
    });

    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) return null;
    if (pw.length < 8) { toastr.error('保险箱密码至少需要 8 个字符。'); return null; }
    if (confirm && pw !== cf) { toastr.error('两次输入的保险箱密码不一致。'); return null; }
    return pw;
}

/**
 * Fetch current vault status and render the actions + badge into the panel.
 */
async function wireVaultCard(content, showMsg, parentPopup) {
    const card = content.querySelector('#stc-vault-card');
    if (!card) return;
    const badgeEl = card.querySelector('#stc-vault-badge');
    const hintEl = card.querySelector('#stc-vault-hint');
    const actionsEl = card.querySelector('#stc-vault-actions');
    const resetRowEl = card.querySelector('#stc-vault-reset-row');
    const resetBtn = card.querySelector('#stc-vault-reset-btn');

    const setBadge = (html, fg, bg, border) => {
        badgeEl.innerHTML = html;
        badgeEl.style.color = fg;
        badgeEl.style.background = bg;
        badgeEl.style.border = `1px solid ${border}`;
        badgeEl.style.opacity = '1';
    };

    const renderActions = (status) => {
        actionsEl.innerHTML = '';
        const mkBtn = (id, label, icon, extraStyle = '') => {
            const b = document.createElement('button');
            b.id = id;
            b.className = 'menu_button';
            b.style.cssText = `padding:8px 14px;font-size:.85em;white-space:nowrap;${extraStyle}`;
            b.innerHTML = `<i class="fa-solid ${icon}"></i> ${label}`;
            actionsEl.appendChild(b);
            return b;
        };

        if (!status.enabled) {
            mkBtn('stc-vault-enable-btn', '启用保险箱', 'fa-lock-open');
            hintEl.innerHTML = '启用后，已保存的 API 密钥会被加密，新保存的密钥也会自动加密。忘记密码将无法恢复密钥。';
            resetRowEl.style.display = 'none';
        } else if (status.unlocked) {
            mkBtn('stc-vault-lock-btn', '立即锁定', 'fa-lock');
            const exp = status.expiresAt
                ? new Date(status.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                : null;
            hintEl.innerHTML = exp
                ? `保险箱已解锁，将在 <strong>${exp}</strong> 左右到期自动锁定（活动访问会自动续期）。`
                : '保险箱已解锁。';
            resetRowEl.style.display = 'flex';
        } else {
            mkBtn('stc-vault-unlock-btn', '解锁', 'fa-key');
            hintEl.innerHTML = '保险箱已启用但处于锁定状态。使用或更新 API 密钥前需要先输入保险箱密码解锁。';
            resetRowEl.style.display = 'flex';
        }
    };

    const refresh = async () => {
        try {
            const r = await fetch('/api/stc/privacy-vault/status', {
                method: 'POST', headers: await getCsrfHeaders(),
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const status = await r.json();

            if (!status.enabled) {
                setBadge('<i class="fa-solid fa-circle-exclamation"></i> 未启用', '#f39c12', 'rgba(243,156,18,.1)', 'rgba(243,156,18,.3)');
            } else if (status.unlocked) {
                setBadge('<i class="fa-solid fa-lock-open"></i> 已解锁', '#2ecc71', 'rgba(46,204,113,.12)', 'rgba(46,204,113,.3)');
            } else {
                setBadge('<i class="fa-solid fa-lock"></i> 已锁定', '#4a90e2', 'rgba(74,144,226,.12)', 'rgba(74,144,226,.3)');
            }

            renderActions(status);
            wireActionButtons(status);
        } catch (e) {
            setBadge('<i class="fa-solid fa-triangle-exclamation"></i> 状态未知', '#e74c3c', 'rgba(231,76,60,.1)', 'rgba(231,76,60,.3)');
            hintEl.textContent = '无法读取保险箱状态：' + e.message;
            actionsEl.innerHTML = '';
            resetRowEl.style.display = 'none';
        }
    };

    const wireActionButtons = (status) => {
        card.querySelector('#stc-vault-enable-btn')?.addEventListener('click', async () => {
            const pw = await askVaultPassphrase({
                title: '启用 API 密钥保险箱',
                message: '请设置一个独立的保险箱密码。启用后，已保存的 API 密钥会被加密保存；忘记该密码将无法恢复密钥。',
                confirm: true,
            });
            if (!pw) return;
            try {
                const r = await fetch('/api/stc/privacy-vault/enable', {
                    method: 'POST', headers: await getCsrfHeaders(),
                    body: JSON.stringify({ passphrase: pw }),
                });
                const d = await r.json();
                if (!r.ok || !d.success) throw new Error(d.message || '启用失败');
                showMsg(`保险箱已启用，已加密密钥数：${d.encryptedCount ?? 0}`);
                await refresh();
            } catch (e) { showMsg('启用失败：' + e.message, false); }
        });

        card.querySelector('#stc-vault-unlock-btn')?.addEventListener('click', async () => {
            const pw = await askVaultPassphrase({
                title: '解锁 API 密钥保险箱',
                message: '请输入保险箱密码，以使用或更新已保存的 API 密钥。',
            });
            if (!pw) return;
            try {
                const r = await fetch('/api/stc/privacy-vault/unlock', {
                    method: 'POST', headers: await getCsrfHeaders(),
                    body: JSON.stringify({ passphrase: pw }),
                });
                const d = await r.json();
                if (r.status === 401) { showMsg('密码不正确。', false); return; }
                if (!r.ok || !d.success) throw new Error(d.message || '解锁失败');
                showMsg('保险箱已解锁。');
                await refresh();
            } catch (e) { showMsg('解锁失败：' + e.message, false); }
        });

        card.querySelector('#stc-vault-lock-btn')?.addEventListener('click', async () => {
            try {
                const r = await fetch('/api/stc/privacy-vault/lock', {
                    method: 'POST', headers: await getCsrfHeaders(),
                });
                const d = await r.json();
                if (!r.ok || !d.success) throw new Error(d.message || '锁定失败');
                showMsg('保险箱已立即锁定。');
                await refresh();
            } catch (e) { showMsg('锁定失败：' + e.message, false); }
        });
    };

    resetBtn?.addEventListener('click', async () => {
        const { Popup, POPUP_TYPE, POPUP_RESULT } = await import('/scripts/popup.js');
        const confirmInputId = `stc-vault-reset-confirm-${Math.random().toString(36).slice(2)}`;
        const box = document.createElement('div');
        box.className = 'flex-container flexFlowColumn';
        box.innerHTML = `
            <h3 style="margin:0 0 6px;color:#e74c3c">重置 API 密钥保险箱</h3>
            <p style="margin:0 0 8px;font-size:.92em;line-height:1.55">
                此操作会：
            </p>
            <ul style="margin:0 0 10px 18px;font-size:.88em;line-height:1.65;opacity:.85">
                <li>删除当前保险箱记录（密码、盐、校验数据）；</li>
                <li><strong style="color:#e74c3c">清空所有已加密的 API 密钥</strong>（因为没有密码后再也无法解密）；</li>
                <li>保留未加密的明文密钥和非 API key 类型的秘密数据。</li>
            </ul>
            <p style="margin:0 0 6px;font-size:.88em;opacity:.85">请在下方输入 <code>RESET</code> 确认执行：</p>
            <input id="${confirmInputId}" class="text_pole" autocomplete="off" placeholder="输入 RESET 以确认">`;
        let typed = '';
        const popup = new Popup(box, POPUP_TYPE.CONFIRM, '', {
            okButton: '确认重置',
            cancelButton: '取消',
            onOpen: () => document.getElementById(confirmInputId)?.focus(),
            onClose: () => { typed = document.getElementById(confirmInputId)?.value || ''; },
        });
        const result = await popup.show();
        if (result !== POPUP_RESULT.AFFIRMATIVE) return;
        if (typed.trim() !== 'RESET') {
            showMsg('未输入 RESET，已取消重置。', false);
            return;
        }

        try {
            const r = await fetch('/api/stc/privacy-vault/reset', {
                method: 'POST', headers: await getCsrfHeaders(),
                body: JSON.stringify({ confirm: 'RESET' }),
            });
            const d = await r.json();
            if (!r.ok || !d.success) throw new Error(d.message || '重置失败');
            showMsg(`保险箱已重置${d.removedKeys ? `，已清理 ${d.removedKeys} 条加密密钥` : ''}。请重新录入所需的 API 密钥。`);
            await refresh();
        } catch (e) { showMsg('重置失败：' + e.message, false); }
    });

    refresh();
}

/**
 * Fetch WeChat binding status and render the card actions.
 */
async function wireWechatCard(content, showMsg) {
    const card = content.querySelector('#stc-wechat-card');
    if (!card) return;
    const badgeEl = card.querySelector('#stc-wx-badge');
    const hintEl = card.querySelector('#stc-wx-hint');
    const actionsEl = card.querySelector('#stc-wx-actions');

    const setBadge = (html, fg, bg, border) => {
        badgeEl.innerHTML = html;
        badgeEl.style.color = fg;
        badgeEl.style.background = bg;
        badgeEl.style.border = `1px solid ${border}`;
        badgeEl.style.opacity = '1';
    };

    const refresh = async () => {
        try {
            const r = await fetch('/api/stc/wechat/status', { headers: await getCsrfHeaders() });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const status = await r.json();

            if (!status.enabled) {
                // Hide the entire card when wechat is not enabled by admin
                card.style.display = 'none';
                return;
            }

            if (!status.bound) {
                setBadge('<i class="fa-solid fa-link-slash"></i> 未绑定', '#f39c12', 'rgba(243,156,18,.1)', 'rgba(243,156,18,.3)');
                hintEl.innerHTML = '把一个微信<strong>小号</strong>扫码接管为你的 AI Bot。<br><span style="color:#e74c3c;font-size:.85em">⚠ 不要用常用主号扫码！</span>';
                actionsEl.innerHTML = `
                    <button id="stc-wx-bind-btn" class="menu_button" style="padding:9px 16px;font-size:.88em;white-space:nowrap">
                        <i class="fa-solid fa-qrcode"></i> 扫码绑定小号
                    </button>`;
                card.querySelector('#stc-wx-bind-btn')?.addEventListener('click', startQrLogin);
                return;
            }

            // Bound state
            const statusLabel = {
                connected: '已连接',
                disconnected: '已断开',
                token_invalid: 'Token 失效',
                suspended: '已挂起',
                reconnecting: '重连中',
            }[status.status] || status.status;

            const statusColor = status.workerRunning ? '#2ecc71' : '#e74c3c';
            setBadge(`<i class="fa-solid fa-link"></i> ${statusLabel}`, statusColor,
                status.workerRunning ? 'rgba(46,204,113,.12)' : 'rgba(231,76,60,.1)',
                status.workerRunning ? 'rgba(46,204,113,.3)' : 'rgba(231,76,60,.3)');

            const charName = status.activeCharacterName || '未选择';
            const stats = status.stats || { inbound: 0, outbound: 0, failed: 0 };

            hintEl.innerHTML = '';
            actionsEl.innerHTML = `
                <div style="display:flex;flex-direction:column;gap:8px;font-size:.85em">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                        <span style="opacity:.6">Bot ID:</span>
                        <span style="font-family:monospace;opacity:.8">${esc(status.botId || '****')}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                        <span style="opacity:.6">默认角色卡:</span>
                        <select id="stc-wx-char-select" style="flex:1;min-width:120px;padding:5px 8px;border-radius:5px;
                            border:1px solid var(--SmartThemeBorderColor,#444);background:var(--SmartThemeBlurTintColor,rgba(0,0,0,.3));
                            color:inherit;font-size:.92em">
                            <option value="">-- 选择角色卡 --</option>
                        </select>
                    </div>
                    <div style="display:flex;align-items:center;gap:12px;opacity:.6;font-size:.9em">
                        <span>入站 ${stats.inbound}</span>
                        <span>出站 ${stats.outbound}</span>
                        <span style="color:${stats.failed ? '#e74c3c' : 'inherit'}">失败 ${stats.failed}</span>
                    </div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.08));padding-top:10px">
                    <button id="stc-wx-unbind-btn" class="menu_button"
                        style="padding:7px 14px;font-size:.84em;background:rgba(231,76,60,.1);color:#e74c3c;border:1px solid rgba(231,76,60,.4);white-space:nowrap">
                        <i class="fa-solid fa-link-slash"></i> 解绑
                    </button>
                </div>
                <details style="font-size:.82em;opacity:.7;margin-top:4px">
                    <summary style="cursor:pointer">微信指令帮助</summary>
                    <pre style="margin:8px 0 0;white-space:pre-wrap;line-height:1.6;opacity:.85">/help   列指令
/chars  列角色卡
/use xx 切换角色卡
/new    清空上下文
/who    当前角色
/undo   撤销上轮</pre>
                </details>`;

            // Populate character select
            populateCharSelect(status.activeCharacterId);

            // Wire events
            card.querySelector('#stc-wx-char-select')?.addEventListener('change', async (e) => {
                const charId = e.target.value;
                if (!charId) return;
                try {
                    const r = await fetch('/api/stc/wechat/set-character', {
                        method: 'POST', headers: await getCsrfHeaders(),
                        body: JSON.stringify({ characterId: charId }),
                    });
                    const d = await r.json();
                    if (r.ok && d.success) {
                        showMsg(`微信默认角色已切换为：${d.characterName}`);
                    } else {
                        showMsg(d.message || '切换失败', false);
                    }
                } catch (err) { showMsg('请求失败: ' + err.message, false); }
            });

            card.querySelector('#stc-wx-unbind-btn')?.addEventListener('click', async () => {
                const { Popup, POPUP_TYPE, POPUP_RESULT } = await import('/scripts/popup.js');
                const confirmId = `stc-wx-unbind-${Math.random().toString(36).slice(2)}`;
                const box = document.createElement('div');
                box.className = 'flex-container flexFlowColumn';
                box.innerHTML = `
                    <h3 style="margin:0 0 6px;color:#e74c3c">解绑微信 Bot</h3>
                    <p style="margin:0 0 10px;font-size:.9em;line-height:1.5">
                        解绑后 Bot 将停止工作，所有微信对话数据保留在服务器上。<br>
                        请输入 <code>UNBIND</code> 确认：
                    </p>
                    <input id="${confirmId}" class="text_pole" autocomplete="off" placeholder="输入 UNBIND">`;
                let typed = '';
                const popup = new Popup(box, POPUP_TYPE.CONFIRM, '', {
                    okButton: '确认解绑', cancelButton: '取消',
                    onClose: () => { typed = document.getElementById(confirmId)?.value || ''; },
                });
                const result = await popup.show();
                if (result !== POPUP_RESULT.AFFIRMATIVE || typed.trim() !== 'UNBIND') {
                    showMsg('已取消解绑。', false); return;
                }
                try {
                    const r = await fetch('/api/stc/wechat/unbind', {
                        method: 'POST', headers: await getCsrfHeaders(),
                        body: JSON.stringify({ confirm: 'UNBIND' }),
                    });
                    const d = await r.json();
                    if (r.ok && d.success) { showMsg('微信 Bot 已解绑。'); await refresh(); }
                    else { showMsg(d.message || '解绑失败', false); }
                } catch (err) { showMsg('请求失败: ' + err.message, false); }
            });
        } catch (e) {
            setBadge('<i class="fa-solid fa-triangle-exclamation"></i> 错误', '#e74c3c', 'rgba(231,76,60,.1)', 'rgba(231,76,60,.3)');
            hintEl.textContent = '无法获取微信 Bot 状态：' + e.message;
            actionsEl.innerHTML = '';
        }
    };

    async function populateCharSelect(activeId) {
        try {
            const r = await fetch('/api/stc/wechat/chars', { headers: await getCsrfHeaders() });
            if (!r.ok) return;
            const { characters } = await r.json();
            const select = card.querySelector('#stc-wx-char-select');
            if (!select) return;
            for (const c of characters) {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.name;
                if (c.id === activeId) opt.selected = true;
                select.appendChild(opt);
            }
        } catch { /* ignore */ }
    }

    async function startQrLogin() {
        const { Popup, POPUP_TYPE, POPUP_RESULT } = await import('/scripts/popup.js');

        // Show QR popup
        const box = document.createElement('div');
        box.className = 'flex-container flexFlowColumn';
        box.style.cssText = 'align-items:center;gap:14px;min-width:280px';
        box.innerHTML = `
            <h3 style="margin:0;display:flex;align-items:center;gap:8px">
                <i class="fa-brands fa-weixin" style="color:#07c160"></i> 微信扫码绑定
            </h3>
            <p style="margin:0;font-size:.85em;opacity:.7;text-align:center;line-height:1.5">
                请用要作为 Bot 的<strong style="color:#e74c3c">小号</strong>微信扫描下方二维码。<br>
                扫码后该小号将被 AI 接管回复。
            </p>
            <div id="stc-wx-qr-container" style="width:220px;height:220px;display:flex;align-items:center;justify-content:center;
                background:rgba(255,255,255,.05);border-radius:10px;border:1px dashed var(--SmartThemeBorderColor,#555)">
                <i class="fa-solid fa-spinner fa-spin" style="font-size:1.5em;opacity:.5"></i>
            </div>
            <div id="stc-wx-qr-status" style="font-size:.82em;opacity:.6">正在获取二维码...</div>`;

        const popup = new Popup(box, POPUP_TYPE.TEXT, '', { okButton: '取消' });

        // Don't await popup.show() — we need to interact with the DOM while it's open
        const popupPromise = popup.show();

        try {
            // Request QR
            const startResp = await fetch('/api/stc/wechat/qr/start', {
                method: 'POST', headers: await getCsrfHeaders(),
            });
            const startData = await startResp.json();

            if (!startResp.ok || !startData.success) {
                box.querySelector('#stc-wx-qr-container').innerHTML = `<span style="color:#e74c3c">${esc(startData.message || '获取二维码失败')}</span>`;
                box.querySelector('#stc-wx-qr-status').textContent = '';
                await popupPromise;
                return;
            }

            // Show QR image
            const qrContainer = box.querySelector('#stc-wx-qr-container');
            qrContainer.innerHTML = `<img src="data:image/png;base64,${startData.qrImageBase64}" style="width:200px;height:200px;border-radius:6px">`;
            box.querySelector('#stc-wx-qr-status').textContent = '等待扫码... (3分钟内有效)';

            // Poll status
            const qrId = startData.qrId;
            let resolved = false;
            const pollInterval = setInterval(async () => {
                if (resolved) { clearInterval(pollInterval); return; }
                try {
                    const r = await fetch('/api/stc/wechat/qr/status', {
                        method: 'POST', headers: await getCsrfHeaders(),
                        body: JSON.stringify({ qrId }),
                    });
                    const d = await r.json();
                    const statusEl = box.querySelector('#stc-wx-qr-status');

                    switch (d.status) {
                        case 'scanned':
                            if (statusEl) statusEl.textContent = '已扫码，请在手机上确认...';
                            break;
                        case 'confirmed':
                            resolved = true;
                            clearInterval(pollInterval);
                            if (statusEl) statusEl.innerHTML = '<span style="color:#2ecc71"><i class="fa-solid fa-circle-check"></i> 绑定成功！</span>';
                            showMsg('微信 Bot 绑定成功！');
                            setTimeout(() => { popup.complete(POPUP_RESULT.AFFIRMATIVE); refresh(); }, 1500);
                            break;
                        case 'expired':
                            resolved = true;
                            clearInterval(pollInterval);
                            if (statusEl) statusEl.innerHTML = '<span style="color:#e74c3c">二维码已过期，请重新操作。</span>';
                            break;
                    }
                } catch { /* ignore poll errors */ }
            }, 2500);

            await popupPromise;
            resolved = true;
            clearInterval(pollInterval);
        } catch (err) {
            showMsg('扫码绑定失败：' + err.message, false);
            await popupPromise;
        }

        // Refresh card after popup closes
        await refresh();
    }

    // Initial load
    refresh();
}

// ── Admin Panel Buttons ───────────────────────────────────────

/**
 * Close SillyTavern's right/left nav drawer if it's open.
 * ST uses openDrawer/closedDrawer CSS classes to toggle drawers.
 * This ensures our admin modal appears above the settings panel.
 */
function closeStDrawer() {
    const openDrawers = document.querySelectorAll('.openDrawer:not(.pinnedOpen)');
    openDrawers.forEach(drawer => {
        drawer.classList.remove('openDrawer');
        drawer.classList.add('closedDrawer');
    });
    // Also reset any open icons in the nav bar
    document.querySelectorAll('.openIcon:not(.drawerPinnedOpen)').forEach(icon => {
        icon.classList.remove('openIcon');
        icon.classList.add('closedIcon');
    });
}

let _stcDrawerSuppressed = false;
function isMobileViewport() {
    return window.innerWidth <= 900;
}

function getStcHost() {
    if (!isMobileViewport()) return document.documentElement;
    const host = document.getElementById('sheld') || document.body || document.documentElement;
    try {
        const pos = window.getComputedStyle(host).position;
        if (pos === 'static') host.style.position = 'relative';
    } catch { /**/ }
    return host;
}
function suppressStDrawersForAdminModal() {
    if (_stcDrawerSuppressed) return;
    const targets = document.querySelectorAll('#right-nav-panel, #left-nav-panel, .drawer-content');
    targets.forEach((el) => {
        el.dataset.stcPrevPointerEvents = el.style.pointerEvents || '';
        el.dataset.stcPrevZIndex = el.style.zIndex || '';
        el.dataset.stcPrevDisplay = el.style.display || '';
        // Prevent drawer from intercepting taps over admin modal on mobile.
        el.style.pointerEvents = 'none';
        el.style.zIndex = '1';
        if (isMobileViewport()) el.style.setProperty('display', 'none', 'important');
    });
    _stcDrawerSuppressed = true;
}

function restoreStDrawersAfterAdminModal() {
    if (!_stcDrawerSuppressed) return;
    const targets = document.querySelectorAll('#right-nav-panel, #left-nav-panel, .drawer-content');
    targets.forEach((el) => {
        el.style.pointerEvents = el.dataset.stcPrevPointerEvents ?? '';
        el.style.zIndex = el.dataset.stcPrevZIndex ?? '';
        el.style.display = el.dataset.stcPrevDisplay ?? '';
        delete el.dataset.stcPrevPointerEvents;
        delete el.dataset.stcPrevZIndex;
        delete el.dataset.stcPrevDisplay;
    });
    _stcDrawerSuppressed = false;
}

// ── Draggable floating element helper ────────────────────────
/**
 * Make a fixed-position element draggable.
 * Position is stored in localStorage under `storageKey`.
 * A drag of ≤5px counts as a click and fires `onClick`.
 * @param {HTMLElement} el
 * @param {string} storageKey
 * @param {{ bottom:string, left?:string, right?:string }} defaultPos
 * @param {Function} onClick
 */
function makeDraggable(el, storageKey, defaultPos, onClick) {
    // Restore saved position, clamped to current viewport to handle
    // cases where the widget was saved on a larger (desktop) screen.
    const saved = (() => { try { return JSON.parse(localStorage.getItem(storageKey)); } catch { return null; } })();

    const applyPos = (pos) => {
        el.style.bottom = pos.bottom ?? 'auto';
        el.style.top    = pos.top    ?? 'auto';
        el.style.left   = pos.left   ?? 'auto';
        el.style.right  = pos.right  ?? 'auto';
    };

    if (saved) {
        applyPos(saved);
        const clampWhenConnected = (tries = 0) => {
            if (!el.isConnected) {
                if (tries < 10) requestAnimationFrame(() => clampWhenConnected(tries + 1));
                return;
            }
            const rect = el.getBoundingClientRect();
            const W = window.innerWidth, H = window.innerHeight;
            const isOffScreen = rect.right < 8 || rect.bottom < 8 || rect.left > W - 8 || rect.top > H - 8;
            if (isOffScreen) {
                applyPos(defaultPos);
                try { localStorage.removeItem(storageKey); } catch { /**/ }
            }
        };
        requestAnimationFrame(() => clampWhenConnected());
    } else {
        applyPos(defaultPos);
    }

    let startX, startY, startLeft, startTop, dragging = false;

    el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        // If the click target is a child interactive element, skip drag handling
        if (e.target !== el && (e.target.tagName === 'BUTTON' || e.target.tagName === 'A' || e.target.closest('button,a'))) return;
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        startX    = e.clientX;
        startY    = e.clientY;
        startLeft = rect.left;
        startTop  = rect.top;
        dragging  = false;
        el.style.cursor = 'grabbing';

        const onMove = (e) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (!dragging && Math.hypot(dx, dy) > 5) dragging = true;
            if (!dragging) return;

            const W = window.innerWidth, H = window.innerHeight;
            const w = el.offsetWidth, h = el.offsetHeight;
            const newLeft = Math.max(0, Math.min(W - w, startLeft + dx));
            const newTop  = Math.max(0, Math.min(H - h, startTop  + dy));

            el.style.left   = newLeft + 'px';
            el.style.top    = newTop  + 'px';
            el.style.right  = 'auto';
            el.style.bottom = 'auto';
        };

        const onUp = (e) => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            el.style.cursor = '';

            if (!dragging) {
                onClick(e);
                return;
            }
            // Snap: if closer to right edge use right, else use left
            const W = window.innerWidth, H = window.innerHeight;
            const rect2 = el.getBoundingClientRect();
            const pos = {
                left:   rect2.left + 'px',
                top:    rect2.top  + 'px',
                right:  'auto',
                bottom: 'auto',
            };
            applyPos(pos);
            try { localStorage.setItem(storageKey, JSON.stringify(pos)); } catch {}
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    // Touch support
    el.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        const rect = el.getBoundingClientRect();
        startX    = t.clientX;
        startY    = t.clientY;
        startLeft = rect.left;
        startTop  = rect.top;
        dragging  = false;

        const onMove = (e) => {
            const t = e.touches[0];
            const dx = t.clientX - startX, dy = t.clientY - startY;
            if (!dragging && Math.hypot(dx, dy) > 5) dragging = true;
            if (!dragging) return;
            e.preventDefault();
            const W = window.innerWidth, H = window.innerHeight;
            const newLeft = Math.max(0, Math.min(W - el.offsetWidth,  startLeft + dx));
            const newTop  = Math.max(0, Math.min(H - el.offsetHeight, startTop  + dy));
            el.style.left = newLeft + 'px'; el.style.top = newTop + 'px';
            el.style.right = 'auto'; el.style.bottom = 'auto';
        };

        const onEnd = (e) => {
            el.removeEventListener('touchmove', onMove);
            el.removeEventListener('touchend', onEnd);
            if (!dragging) { onClick(e); return; }
            const rect2 = el.getBoundingClientRect();
            const pos = { left: rect2.left + 'px', top: rect2.top + 'px', right: 'auto', bottom: 'auto' };
            applyPos(pos);
            try { localStorage.setItem(storageKey, JSON.stringify(pos)); } catch {}
        };

        el.addEventListener('touchmove', onMove, { passive: false });
        el.addEventListener('touchend', onEnd);
    }, { passive: true });
}

function injectAdminButton() {
    if (document.getElementById('stc-admin-btn')) return;

    // Hide admin button on mobile - use nav link instead
    const isMobile = isMobileViewport();
    if (isMobile) return;

    const btn = document.createElement('div');
    btn.id = 'stc-admin-btn';
    btn.innerHTML = '<i class="fa-solid fa-screwdriver-wrench"></i>';
    btn.title = 'STC 管理面板（可拖动）';

    btn.style.cssText = [
        'position:fixed',
        'bottom:55px',
        'right:10px',
        'width:42px',
        'height:42px',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'border-radius:50%',
        'background:#6c63ff',
        'color:#fff',
        'font-size:18px',
        'box-shadow:0 2px 12px rgba(108,99,255,.6)',
        'cursor:grab',
        'user-select:none',
        'z-index:2147483647',
        'pointer-events:auto',
    ].join(';');

    getStcHost().appendChild(btn);
    makeDraggable(btn, 'stc_admin_btn_pos', { bottom: '55px', right: '10px' }, openAdminPanel);
}

function injectAdminNavLink() {
    if (document.getElementById('stc-nav-admin-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'stc-nav-admin-btn';
    btn.className = 'list-group-item';
    btn.title = '打开 STC 管理面板';
    btn.style.cssText = 'cursor:pointer;display:flex;align-items:center;gap:6px;';
    btn.innerHTML = '<i class="fa-solid fa-screwdriver-wrench"></i><span>STC管理</span>';
    btn.addEventListener('click', openAdminPanel);

    const targets = [
        document.getElementById('admin_panel_link'),
        document.querySelector('#logout_button'),
        document.querySelector('#user_settings_block .user-info-buttons'),
        document.querySelector('.user-settings-header'),
    ];

    let inserted = false;
    for (const target of targets) {
        if (target) {
            target.parentNode.insertBefore(btn, target.nextSibling);
            inserted = true;
            break;
        }
    }

    if (!inserted) {
        // Mobile fallback to top ribbon gets hidden under official chat header.
        // Skip this fallback on mobile; floating admin button is the primary入口.
        if (isMobileViewport()) return;
        btn.style.cssText = `position:fixed;top:0;left:50%;transform:translateX(-50%);
            background:#6c63ff;color:#fff;padding:6px 20px;border-radius:0 0 10px 10px;
            cursor:pointer;z-index:2147483647;font-size:14px;
            display:flex;align-items:center;gap:8px;box-shadow:0 2px 8px rgba(0,0,0,.3);`;
        getStcHost().appendChild(btn);
    }
}

// ── Site Navigation Buttons (注入到欢迎界面按钮行) ──────────────
/**
 * Build and return the STC nav bar element.
 * @param {{ enableForum: boolean, enablePublicCharacters: boolean }} cfg
 * @returns {HTMLElement|null}
 */
function buildNavBar(cfg) {
    const links = [
        { id: 'stc-nav-home-btn',  icon: 'fa-house',         label: '首页',   href: '/',                  show: true },
        { id: 'stc-nav-forum-btn', icon: 'fa-comments',      label: '论坛',   href: '/forum',             show: cfg.enableForum },
        { id: 'stc-nav-chars-btn', icon: 'fa-masks-theater', label: '角色卡', href: '/public-characters', show: cfg.enablePublicCharacters },
    ].filter(l => l.show);

    if (!links.length) return null;

    const bar = document.createElement('div');
    bar.id = 'stc-quick-nav-bar';
    // className will be overwritten in tryInjectNavIntoWelcome to match the official row
    bar.className = 'flex-container';

    links.forEach(link => {
        const btn = document.createElement('button');
        btn.id = link.id;
        btn.className = 'menu_button menu_button_icon inline-flex';
        btn.innerHTML = `<i class="fa-solid ${link.icon}"></i><span>${link.label}</span>`;
        btn.addEventListener('click', () => window.open(link.href, '_blank'));
        bar.appendChild(btn);
    });

    return bar;
}

/**
 * Try to inject nav bar into the welcome prompt area once.
 * The welcome prompt creates a .flex-container with .drawer-opener buttons.
 * @param {{ enableForum: boolean, enablePublicCharacters: boolean }} cfg
 * @returns {boolean} true if successfully injected
 */
function tryInjectNavIntoWelcome(cfg) {
    if (document.getElementById('stc-quick-nav-bar')) return true;

    // The welcomePrompt renders a .flex-container containing .drawer-opener buttons
    // (API Connections, Character Management, Extensions) inside #chat.
    const chat = document.getElementById('chat');
    if (!chat) return false;

    // Find the container holding the welcomePrompt drawer-opener buttons.
    // IMPORTANT: DOMPurify renames .flex-container → .custom-flex-container inside messages,
    // but .drawer-opener on <button> is preserved (because it has .menu_button class).
    // Strategy: find the button first, then walk up to its parent container.
    const apiBtn = chat.querySelector(
        'button.drawer-opener[data-target="sys-settings-button"], ' +
        'button.drawer-opener[data-target="rightNavHolder"]'
    );
    if (!apiBtn) return false;

    // The direct parent of the button group (custom-flex-container or flex-container)
    const promptRow = apiBtn.parentElement;
    if (!promptRow) return false;

    const bar = buildNavBar(cfg);
    if (!bar) return true; // nothing to inject, consider done

    // Copy the same className from the official prompt row so both rows share
    // identical flex/padding/margin styles (custom-flex-container or flex-container)
    if (promptRow.className) {
        bar.className = promptRow.className;
    }
    bar.id = 'stc-quick-nav-bar'; // restore id after className overwrite

    // Inject as a sibling row directly after the welcome prompt row
    promptRow.after(bar);
    return true;
}

/**
 * Inject 首页/论坛/角色卡 buttons into the welcome panel prompt area.
 * Uses a MutationObserver to handle the case where the panel is rendered
 * asynchronously after the extension loads.
 * @param {{ enableForum: boolean, enablePublicCharacters: boolean }} cfg
 */
function injectSiteNavLinks(cfg) {
    // Try immediately (panel may already be present)
    if (tryInjectNavIntoWelcome(cfg)) return;

    // Watch #chat for the welcome prompt to appear
    const chat = document.getElementById('chat') || document.body;
    const obs = new MutationObserver(() => {
        if (tryInjectNavIntoWelcome(cfg)) obs.disconnect();
    });
    obs.observe(chat, { childList: true, subtree: true });

    // Safety timeout — disconnect after 60 s to avoid leaking observers
    setTimeout(() => obs.disconnect(), 60000);
}

// ── Admin Panel Launcher ──────────────────────────────────────
async function openAdminPanel() {
    if (document.getElementById('stc-admin-modal')) {
        document.getElementById('stc-admin-modal').remove();
        restoreStDrawersAfterAdminModal();
        return;
    }

    // Lazy-load the full admin panel module
    try {
        if (!adminPanelModule) {
            const scriptDir = import.meta.url.replace('/index.js', '');
            adminPanelModule = await import(`${scriptDir}/admin-panel.js`);
        }
        closeStDrawer();
        suppressStDrawersForAdminModal();
        // Append to host container (mobile uses #sheld same stacking context)
        const tmp = document.createElement('div');
        tmp.innerHTML = adminPanelModule.buildAdminPanelHTML();
        const modalEl = tmp.firstElementChild;
        if (isMobileViewport()) {
            modalEl.style.position = 'absolute';
            modalEl.style.inset = '0';
            modalEl.style.zIndex = '999999';
        }
        getStcHost().appendChild(modalEl);
        await adminPanelModule.initAdminPanel();
        // Restore ST drawers once modal is closed/removed
        const modal = document.getElementById('stc-admin-modal');
        const observer = new MutationObserver(() => {
            if (!document.getElementById('stc-admin-modal')) {
                observer.disconnect();
                restoreStDrawersAfterAdminModal();
            }
        });
        observer.observe(getStcHost(), { childList: true, subtree: true });
        modal?.addEventListener('remove', () => {
            observer.disconnect();
            restoreStDrawersAfterAdminModal();
        }, { once: true });
    } catch (e) {
        console.error('[STC-MOD] Failed to load admin panel module:', e);
        restoreStDrawersAfterAdminModal();
        // Fallback: simple error display
        const overlay = document.createElement('div');
        overlay.id = 'stc-admin-modal';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2147483647;display:flex;align-items:center;justify-content:center';
        overlay.innerHTML = `<div style="background:#16213e;border-radius:12px;padding:30px;color:#eee;max-width:400px;text-align:center">
            <i class="fa-solid fa-triangle-exclamation" style="color:#e74c3c;font-size:2em;margin-bottom:12px;display:block"></i>
            <h3 style="margin:0 0 10px">管理面板加载失败</h3>
            <p style="color:#888;font-size:.9em">${e.message}</p>
            <button onclick="document.getElementById('stc-admin-modal').remove()" class="menu_button" style="margin-top:16px;padding:8px 20px">关闭</button>
        </div>`;
        overlay.addEventListener('click', ev => { if (ev.target === overlay) overlay.remove(); });
        getStcHost().appendChild(overlay);
    }
}

function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
}
