/**
 * Client-side runtime that gets injected into the preview page.
 * This code runs in the browser, not in Node.js.
 *
 * It intercepts fetch, provides mock auth, and injects route params.
 * This file is bundled with esbuild and served as a script tag.
 */

export function generateClientRuntime(config: {
  apiMocks: Record<string, { status: number; data: unknown; delay?: number }>;
  auth: {
    isAuthenticated: boolean;
    user: Record<string, unknown> | null;
    token?: string;
    session?: Record<string, unknown>;
  };
  routeParams: Record<string, string>;
  queryParams: Record<string, string>;
  scenario: string;
}): string {
  return `
(function() {
  'use strict';

  var __SR_CONFIG__ = ${JSON.stringify(config)};

  // === FETCH INTERCEPTOR ===
  var originalFetch = window.fetch;

  window.fetch = function(input, init) {
    var url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
    var method = (init && init.method) || 'GET';
    method = method.toUpperCase();

    // Normalize URL for matching
    var normalizedUrl = url;
    try {
      var parsed = new URL(url, window.location.origin);
      normalizedUrl = parsed.pathname + parsed.search;
    } catch(e) {
      // keep as-is
    }

    // Try to match against mock endpoints
    var mockKey = findMockMatch(method, normalizedUrl);
    if (mockKey) {
      var mock = __SR_CONFIG__.apiMocks[mockKey];
      console.log('[state-render] Intercepted ' + method + ' ' + url + ' -> mock response');

      return new Promise(function(resolve) {
        var delay = mock.delay || 0;
        setTimeout(function() {
          resolve(new Response(JSON.stringify(mock.data), {
            status: mock.status,
            headers: { 'Content-Type': 'application/json' },
          }));
        }, delay);
      });
    }

    // Pass through to real fetch for non-matched requests (like static assets)
    console.log('[state-render] Pass-through: ' + method + ' ' + url);
    return originalFetch.call(window, input, init);
  };

  function findMockMatch(method, url) {
    var mocks = __SR_CONFIG__.apiMocks;

    // Exact match
    var exactKey = method + ':' + url;
    if (mocks[exactKey]) return exactKey;

    // Try without method prefix
    for (var key in mocks) {
      if (!mocks.hasOwnProperty(key)) continue;

      var parts = key.split(':');
      var mockMethod = parts[0];
      var mockPattern = parts.slice(1).join(':');

      if (mockMethod !== method && mockMethod !== 'unknown') continue;

      // Pattern matching (replace {param} with regex)
      // First escape special regex chars in the literal URL parts,
      // then replace {param} placeholders with a capture group.
      var escaped = mockPattern.replace(/\\//g, '\\\\/');
      var regexStr = '^' + escaped
        .replace(/\\{[^}]+\\}/g, '[^/]+') + '(\\\\?.*)?$';

      try {
        var regex = new RegExp(regexStr);
        if (regex.test(url)) return key;
      } catch(e) {
        // fallback to includes
        if (url.includes(mockPattern.replace(/\\{[^}]+\\}/g, ''))) return key;
      }
    }

    return null;
  }

  // === XMLHttpRequest INTERCEPTOR (for axios etc.) ===
  var OriginalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function() {
    var xhr = new OriginalXHR();
    var _open = xhr.open;
    var _method = 'GET';
    var _url = '';

    xhr.open = function(method, url) {
      _method = method.toUpperCase();
      _url = url;
      return _open.apply(xhr, arguments);
    };

    var _send = xhr.send;
    xhr.send = function(body) {
      var normalizedUrl = _url;
      try {
        var parsed = new URL(_url, window.location.origin);
        normalizedUrl = parsed.pathname + parsed.search;
      } catch(e) {}

      var mockKey = findMockMatch(_method, normalizedUrl);
      if (mockKey) {
        var mock = __SR_CONFIG__.apiMocks[mockKey];
        console.log('[state-render] XHR Intercepted ' + _method + ' ' + _url);

        var delay = mock.delay || 0;
        setTimeout(function() {
          Object.defineProperty(xhr, 'status', { get: function() { return mock.status; } });
          Object.defineProperty(xhr, 'readyState', { get: function() { return 4; } });
          Object.defineProperty(xhr, 'responseText', { get: function() { return JSON.stringify(mock.data); } });
          Object.defineProperty(xhr, 'response', { get: function() { return JSON.stringify(mock.data); } });
          if (xhr.onreadystatechange) xhr.onreadystatechange(new Event('readystatechange'));
          if (xhr.onload) xhr.onload(new Event('load'));
        }, delay);
        return;
      }

      return _send.apply(xhr, arguments);
    };

    return xhr;
  };

  // === AUTH MOCK ===
  // Expose mock auth globally for providers to pick up
  window.__STATE_RENDER_AUTH__ = __SR_CONFIG__.auth;
  window.__STATE_RENDER_CONFIG__ = __SR_CONFIG__;

  // Mock next-auth/react's useSession
  if (typeof window !== 'undefined') {
    window.__NEXT_AUTH_SESSION__ = __SR_CONFIG__.auth.isAuthenticated
      ? {
          data: {
            user: __SR_CONFIG__.auth.user,
            expires: new Date(Date.now() + 86400000).toISOString(),
            ...__SR_CONFIG__.auth.session,
          },
          status: 'authenticated',
        }
      : {
          data: null,
          status: 'unauthenticated',
        };
  }

  // === SCENARIO INDICATOR ===
  var indicator = document.createElement('div');
  indicator.id = 'state-render-indicator';
  indicator.style.cssText = [
    'position:fixed', 'bottom:12px', 'left:50%', 'transform:translateX(-50%)',
    'background:rgba(255,255,255,0.96)', 'color:#1a1a1a',
    'border:1px solid rgba(0,0,0,0.08)', 'border-radius:8px',
    'box-shadow:0 1px 3px rgba(0,0,0,0.08),0 4px 12px rgba(0,0,0,0.04)',
    'padding:6px 6px 6px 14px',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    'font-size:12px', 'z-index:99999',
    'display:flex', 'align-items:center', 'gap:10px',
    'backdrop-filter:blur(8px)', '-webkit-backdrop-filter:blur(8px)',
    'user-select:none',
  ].join(';');

  // Build inner HTML
  var endpointCount = Object.keys(__SR_CONFIG__.apiMocks).length;
  var authLabel = __SR_CONFIG__.auth.isAuthenticated
    ? (__SR_CONFIG__.auth.user && __SR_CONFIG__.auth.user.name ? __SR_CONFIG__.auth.user.name : 'authed')
    : 'none';

  var html = '';
  // Logo mark
  html += '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="flex-shrink:0;opacity:0.5;">' +
    '<rect x="1" y="1" width="14" height="14" rx="3" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M5 8h6M8 5v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  // Metadata
  html += '<span style="color:#888;font-size:11px;white-space:nowrap;">' +
    endpointCount + ' mock' + (endpointCount !== 1 ? 's' : '') +
    '<span style="margin:0 5px;opacity:0.3;">&middot;</span>' +
    'auth: ' + authLabel +
    '</span>';

  // Divider
  html += '<span style="width:1px;height:16px;background:rgba(0,0,0,0.08);flex-shrink:0;"></span>';

  // Scenario buttons
  var scenarios = ['happy', 'empty', 'error', 'loading'];
  scenarios.forEach(function(s) {
    var isActive = s === __SR_CONFIG__.scenario;
    html += '<button onclick="window.__SR_SWITCH_SCENARIO__(\\'' + s + '\\')" style="' +
      'all:unset;cursor:pointer;padding:4px 10px;border-radius:5px;font-size:11px;font-weight:500;' +
      'font-family:inherit;transition:background 0.15s,color 0.15s;white-space:nowrap;' +
      'background:' + (isActive ? '#1a1a1a' : 'transparent') + ';' +
      'color:' + (isActive ? '#fff' : '#666') + ';' +
      '" onmouseover="if(!' + isActive + ')this.style.background=\\'rgba(0,0,0,0.04)\\'" ' +
      'onmouseout="if(!' + isActive + ')this.style.background=\\'transparent\\'"' +
      '>' + s + '</button>';
  });

  indicator.innerHTML = html;

  // Respect prefers-color-scheme
  var darkMq = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme(dark) {
    if (dark) {
      indicator.style.background = 'rgba(30,30,30,0.96)';
      indicator.style.color = '#e5e5e5';
      indicator.style.borderColor = 'rgba(255,255,255,0.08)';
      indicator.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3),0 4px 12px rgba(0,0,0,0.15)';
    }
  }
  applyTheme(darkMq.matches);
  darkMq.addEventListener('change', function(e) { applyTheme(e.matches); });

  document.addEventListener('DOMContentLoaded', function() {
    document.body.appendChild(indicator);
    document.body.style.paddingBottom = '48px';
  });

  // Scenario switcher via WebSocket
  window.__SR_SWITCH_SCENARIO__ = function(scenario) {
    if (window.__SR_WS__) {
      window.__SR_WS__.send(JSON.stringify({ type: 'switch-scenario', scenario: scenario }));
    } else {
      window.location.href = window.location.pathname + '?scenario=' + scenario;
    }
  };

  // WebSocket connection for live reload
  try {
    var ws = new WebSocket('ws://localhost:' + (window.location.port || '3899') + '/__sr_ws');
    ws.onmessage = function(event) {
      var msg = JSON.parse(event.data);
      if (msg.type === 'reload') {
        window.location.reload();
      }
    };
    window.__SR_WS__ = ws;
  } catch(e) {
    // WebSocket not available, that's fine
  }

  console.log('[state-render] Runtime initialized. Scenario: ' + __SR_CONFIG__.scenario);
  console.log('[state-render] Mocked endpoints:', Object.keys(__SR_CONFIG__.apiMocks));
  console.log('[state-render] Auth:', __SR_CONFIG__.auth.isAuthenticated ? 'authenticated' : 'unauthenticated');
})();
`;
}
