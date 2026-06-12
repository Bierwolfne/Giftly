(function () {
  // ── CSS ───────────────────────────────────────────────────
  if (!document.getElementById('navjs-styles')) {
    const s = document.createElement('style');
    s.id = 'navjs-styles';
    s.textContent = [
      '#siteNav{display:flex;justify-content:space-between;align-items:center;',
      'padding:1.5rem 2.5rem;border-bottom:1px solid var(--border);',
      'position:sticky;top:0;background:var(--cream);z-index:10;}',

      '#siteNav .logo{font-family:"DM Serif Display",serif;font-size:1.6rem;',
      'letter-spacing:-0.02em;color:var(--ink);text-decoration:none;}',

      '#siteNav .nav-right{display:flex;align-items:center;gap:0.75rem;}',

      '#siteNav .nav-cta{background:var(--ink);color:var(--cream);border:none;',
      'padding:0.55rem 1.3rem;border-radius:100px;font-family:Inter,sans-serif;',
      'font-size:0.9rem;font-weight:500;cursor:pointer;text-decoration:none;transition:background 0.2s;}',
      '#siteNav .nav-cta:hover{background:var(--blush-dark);}',

      '.user-menu{position:relative;}',

      '.user-btn{display:flex;align-items:center;gap:0.55rem;background:#fff;',
      'border:1.5px solid var(--border);border-radius:100px;',
      'padding:0.42rem 1rem 0.42rem 0.5rem;font-family:Inter,sans-serif;',
      'font-size:0.9rem;font-weight:500;color:var(--ink);cursor:pointer;',
      'transition:border-color 0.15s;white-space:nowrap;}',
      '.user-btn:hover,.user-btn.open{border-color:var(--ink);}',

      '.user-avatar{width:26px;height:26px;border-radius:50%;background:var(--blush);',
      'color:var(--ink);font-size:0.72rem;font-weight:700;display:flex;',
      'align-items:center;justify-content:center;flex-shrink:0;}',

      '.user-dropdown{position:absolute;top:calc(100% + 8px);right:0;background:#fff;',
      'border:1px solid var(--border);border-radius:14px;',
      'box-shadow:0 8px 30px rgba(26,20,16,0.12);min-width:200px;overflow:hidden;',
      'display:none;z-index:50;animation:navDropIn 0.15s ease;}',
      '.user-dropdown.open{display:block;}',

      '@keyframes navDropIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}',

      '.dropdown-item{display:flex;align-items:center;gap:0.6rem;padding:0.7rem 1rem;',
      'font-family:Inter,sans-serif;font-size:0.9rem;font-weight:500;color:var(--ink);',
      'text-decoration:none;background:transparent;border:none;',
      'width:100%;text-align:left;cursor:pointer;transition:background 0.1s;}',
      '.dropdown-item:hover{background:var(--cream);}',

      '.dropdown-divider{height:1px;background:var(--border);margin:0.3rem 0;}',

      '.dropdown-logout{color:var(--muted);font-weight:400;}',
      '.dropdown-logout:hover{color:var(--ink);}',
    ].join('');
    document.head.appendChild(s);
  }

  // ── Helpers ───────────────────────────────────────────────
  function resolveFirstName(email) {
    var stored = sessionStorage.getItem('giftlyName');
    if (stored && stored.trim()) {
      var part = stored.trim().split(' ')[0];
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }
    var part = email.split('@')[0].split(/[._+\-]/)[0];
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }

  function esc(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Build nav ─────────────────────────────────────────────
  function buildNav() {
    var nav = document.getElementById('siteNav');
    if (!nav) return;

    var email = sessionStorage.getItem('giftlyEmail');

    if (email) {
      var firstName = resolveFirstName(email);
      nav.innerHTML =
        '<a href="index.html" class="logo">Giftly</a>' +
        '<div class="nav-right">' +
          '<div class="user-menu">' +
            '<button class="user-btn" id="navUserBtn" aria-expanded="false" aria-haspopup="true">' +
              '<span class="user-avatar">' + esc(firstName[0]) + '</span>' +
              'Hello, ' + esc(firstName) + ' ▾' +
            '</button>' +
            '<div class="user-dropdown" id="navUserDropdown">' +
              '<a href="dashboard.html" class="dropdown-item">📊 Dashboard</a>' +
              '<a href="gifts.html"     class="dropdown-item">🎁 Browse gifts</a>' +
              '<a href="profiles.html"  class="dropdown-item">⚙️ Profile settings</a>' +
              '<div class="dropdown-divider"></div>' +
              '<button class="dropdown-item dropdown-logout" id="navLogoutBtn">← Log out</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      document.getElementById('navUserBtn').addEventListener('click', function (e) {
        e.stopPropagation();
        var dd      = document.getElementById('navUserDropdown');
        var opening = !dd.classList.contains('open');
        dd.classList.toggle('open', opening);
        this.classList.toggle('open', opening);
        this.setAttribute('aria-expanded', String(opening));
      });

      document.getElementById('navLogoutBtn').addEventListener('click', function () {
        sessionStorage.removeItem('giftlyEmail');
        sessionStorage.removeItem('giftlyName');
        window.location.href = 'index.html';
      });
    } else {
      nav.innerHTML =
        '<a href="index.html" class="logo">Giftly</a>' +
        '<div class="nav-right">' +
          '<a href="signup.html" class="nav-cta">Get started</a>' +
        '</div>';
    }
  }

  // ── Close on outside click ────────────────────────────────
  document.addEventListener('click', function () {
    var dd  = document.getElementById('navUserDropdown');
    var btn = document.getElementById('navUserBtn');
    if (dd)  dd.classList.remove('open');
    if (btn) { btn.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
  });

  // With defer, DOM is fully parsed when this runs
  buildNav();
}());
