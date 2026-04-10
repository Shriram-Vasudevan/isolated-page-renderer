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
      var regexStr = '^' + mockPattern
        .replace(/\\{[^}]+\\}/g, '[^/]+')
        .replace(/\\[/g, '\\\\[')
        .replace(/\\]/g, '\\\\]')
        .replace(/\\//g, '\\\\/') + '(\\\\?.*)?$';

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
  indicator.innerHTML = '<span style="font-weight:600;">state-render</span> | scenario: <strong>' +
    __SR_CONFIG__.scenario + '</strong> | ' +
    Object.keys(__SR_CONFIG__.apiMocks).length + ' mocked endpoints';
  indicator.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#1e1e2e;color:#cdd6f4;' +
    'padding:8px 16px;font-family:monospace;font-size:12px;z-index:99999;display:flex;align-items:center;' +
    'gap:12px;border-top:2px solid #89b4fa;';

  // Add scenario switcher buttons
  var scenarios = ['happy', 'empty', 'error', 'loading'];
  var switcherHtml = ' | Switch: ';
  scenarios.forEach(function(s) {
    var isActive = s === __SR_CONFIG__.scenario;
    switcherHtml += '<button onclick="window.__SR_SWITCH_SCENARIO__(\\'' + s + '\\')" style="' +
      'background:' + (isActive ? '#89b4fa' : '#313244') + ';color:' + (isActive ? '#1e1e2e' : '#cdd6f4') + ';' +
      'border:1px solid #45475a;border-radius:4px;padding:2px 8px;margin:0 2px;cursor:pointer;font-family:monospace;font-size:11px;' +
      '">' + s + '</button>';
  });
  indicator.innerHTML += switcherHtml;

  document.addEventListener('DOMContentLoaded', function() {
    document.body.appendChild(indicator);
    document.body.style.paddingBottom = '40px';
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
