/**
 * Post-processes dist/index.html after `expo export --platform web`.
 *
 * Expo Router does not use web/index.html, so the PWA bits are injected here:
 *   - manifest + theme-color + apple-touch icons
 *   - an instant CSS splash screen (shown before the JS bundle parses)
 *   - the install banner (Android beforeinstallprompt / iOS Add-to-Home-Screen)
 *   - service worker registration
 *
 * Run: node scripts/inject-pwa.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const BASE = '/stay-close';
const indexPath = join(DIST, 'index.html');

if (!existsSync(indexPath)) {
  console.error(`[inject-pwa] ${indexPath} not found — did expo export run?`);
  process.exit(1);
}

let html = readFileSync(indexPath, 'utf8');

if (html.includes('data-pwa-injected')) {
  console.log('[inject-pwa] already injected, skipping');
  process.exit(0);
}

const HEAD = `
  <meta name="pwa" data-pwa-injected="1" />
  <link rel="manifest" href="${BASE}/manifest.json" />
  <meta name="theme-color" content="#7C3AED" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <meta name="apple-mobile-web-app-title" content="Stay Close" />
  <link rel="apple-touch-icon" href="${BASE}/icons/apple-touch-icon.png" />
  <link rel="icon" type="image/png" sizes="32x32" href="${BASE}/icons/favicon-32.png" />
  <style>
    #sc-splash{position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      background:linear-gradient(160deg,#7C3AED 0%,#EC4899 100%);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      transition:opacity .35s ease;}
    #sc-splash.sc-hide{opacity:0;pointer-events:none;}
    #sc-splash .sc-heart{font-size:64px;line-height:1;animation:sc-beat 1.2s ease-in-out infinite;}
    #sc-splash h1{color:#fff;font-size:26px;font-weight:700;margin:18px 0 6px;letter-spacing:-.4px;}
    #sc-splash p{color:rgba(255,255,255,.85);font-size:14px;margin:0;}
    #sc-splash .sc-spin{margin-top:26px;width:26px;height:26px;border-radius:50%;
      border:3px solid rgba(255,255,255,.3);border-top-color:#fff;animation:sc-rot .8s linear infinite;}
    @keyframes sc-beat{0%,100%{transform:scale(1)}50%{transform:scale(1.14)}}
    @keyframes sc-rot{to{transform:rotate(360deg)}}

    #sc-install{position:fixed;left:12px;right:12px;bottom:12px;z-index:99998;
      display:none;align-items:center;gap:12px;padding:14px 16px;border-radius:16px;
      background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.18);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      transform:translateY(140%);transition:transform .35s cubic-bezier(.2,.8,.2,1);}
    #sc-install.sc-show{display:flex;transform:translateY(0);}
    #sc-install img{width:42px;height:42px;border-radius:10px;flex:0 0 auto;}
    #sc-install .sc-txt{flex:1;min-width:0;}
    #sc-install .sc-t{font-size:15px;font-weight:700;color:#111;}
    #sc-install .sc-s{font-size:12.5px;color:#666;margin-top:2px;}
    #sc-install button{border:0;cursor:pointer;font-weight:700;border-radius:10px;}
    #sc-install .sc-go{background:#7C3AED;color:#fff;font-size:14px;padding:10px 18px;}
    #sc-install .sc-x{background:transparent;color:#999;font-size:22px;padding:4px 8px;line-height:1;}
    @media(min-width:640px){#sc-install{left:auto;right:20px;bottom:20px;width:390px;}}

    #sc-ios{position:fixed;inset:0;z-index:99999;display:none;align-items:flex-end;
      background:rgba(0,0,0,.5);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}
    #sc-ios.sc-show{display:flex;}
    #sc-ios .sc-sheet{background:#fff;width:100%;border-radius:20px 20px 0 0;padding:24px 22px 34px;}
    #sc-ios h2{margin:0 0 4px;font-size:19px;color:#111;}
    #sc-ios .sc-sub{font-size:13.5px;color:#666;margin:0 0 18px;}
    #sc-ios .sc-step{display:flex;gap:13px;align-items:flex-start;margin-bottom:15px;}
    #sc-ios .sc-n{flex:0 0 26px;height:26px;border-radius:50%;background:#7C3AED;color:#fff;
      font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;}
    #sc-ios .sc-d{font-size:14.5px;color:#222;line-height:1.45;}
    #sc-ios .sc-close{width:100%;margin-top:8px;padding:14px;border:0;border-radius:12px;
      background:#F1F0F6;color:#333;font-size:15px;font-weight:700;cursor:pointer;}
  </style>`;

const BODY = `
  <div id="sc-splash">
    <div class="sc-heart">\u{1F49C}</div>
    <h1>Stay Close</h1>
    <p>Loading your circles…</p>
    <div class="sc-spin"></div>
  </div>

  <div id="sc-install">
    <img src="${BASE}/icons/icon-192.png" alt="" />
    <div class="sc-txt">
      <div class="sc-t">Install Stay Close</div>
      <div class="sc-s">Add to your home screen — works offline</div>
    </div>
    <button class="sc-go" id="sc-go">Install</button>
    <button class="sc-x" id="sc-dismiss" aria-label="Dismiss">&times;</button>
  </div>

  <div id="sc-ios">
    <div class="sc-sheet">
      <h2>Install Stay Close</h2>
      <p class="sc-sub">Add it to your Home Screen in 3 taps.</p>
      <div class="sc-step"><div class="sc-n">1</div><div class="sc-d">Tap the <strong>Share</strong> button at the bottom of Safari.</div></div>
      <div class="sc-step"><div class="sc-n">2</div><div class="sc-d">Scroll and tap <strong>Add to Home Screen</strong>.</div></div>
      <div class="sc-step"><div class="sc-n">3</div><div class="sc-d">Tap <strong>Add</strong> — done!</div></div>
      <button class="sc-close" id="sc-ios-close">Got it</button>
    </div>
  </div>

  <script>
  (function () {
    // ---- splash: hide once React paints into #root ----
    var splash = document.getElementById('sc-splash');
    var root = document.getElementById('root');
    var done = false;
    function hideSplash() {
      if (done) return;
      done = true;
      splash.classList.add('sc-hide');
      setTimeout(function () { splash.remove(); }, 400);
      setTimeout(maybeShowInstall, 900);
    }
    if (root) {
      if (root.childElementCount > 0) hideSplash();
      new MutationObserver(function (_m, obs) {
        if (root.childElementCount > 0) { obs.disconnect(); hideSplash(); }
      }).observe(root, { childList: true });
    }
    setTimeout(hideSplash, 12000); // hard fallback

    // ---- install banner ----
    var banner = document.getElementById('sc-install');
    var iosSheet = document.getElementById('sc-ios');
    var deferred = null;
    var DISMISS_KEY = 'sc_install_dismissed';
    var dismissed = false;
    try { dismissed = sessionStorage.getItem(DISMISS_KEY) === '1'; } catch (e) {}

    var ua = navigator.userAgent || '';
    var isIOS = /iPad|iPhone|iPod/.test(ua) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
    var installed = window.matchMedia('(display-mode: standalone)').matches ||
                    window.navigator.standalone === true;

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferred = e;
      maybeShowInstall();
    });

    function maybeShowInstall() {
      if (installed || dismissed || !done) return;
      if (deferred || (isIOS && isSafari)) banner.classList.add('sc-show');
    }

    document.getElementById('sc-go').addEventListener('click', function () {
      if (deferred) {
        deferred.prompt();
        deferred.userChoice.then(function () {
          deferred = null;
          banner.classList.remove('sc-show');
        });
      } else if (isIOS) {
        iosSheet.classList.add('sc-show');
      }
    });
    document.getElementById('sc-dismiss').addEventListener('click', function () {
      banner.classList.remove('sc-show');
      dismissed = true;
      try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
    });
    document.getElementById('sc-ios-close').addEventListener('click', function () {
      iosSheet.classList.remove('sc-show');
    });
    iosSheet.addEventListener('click', function (e) {
      if (e.target === iosSheet) iosSheet.classList.remove('sc-show');
    });
    window.addEventListener('appinstalled', function () {
      installed = true;
      banner.classList.remove('sc-show');
    });

    // ---- service worker ----
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('${BASE}/sw.js').catch(function () {});
      });
    }
  })();
  </script>`;

html = html.replace('</head>', `${HEAD}\n</head>`);
html = html.replace('</body>', `${BODY}\n</body>`);

writeFileSync(indexPath, html, 'utf8');
console.log('[inject-pwa] injected splash + install banner + manifest into dist/index.html');
