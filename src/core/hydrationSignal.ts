/**
 * Injected before any page script.
 *
 * Primary signal: installs a minimal `__REACT_DEVTOOLS_GLOBAL_HOOK__`. Every React
 * build (16+, prod and dev, bundled or global) reports to this hook, so it works for
 * webpack/Next/Vite apps where `ReactDOM` is never exposed on `window`. When a root
 * commits for the first time out of the dehydrated state, the hydrated DOM is
 * serialized synchronously inside that commit — before passive effects (useEffect)
 * can mutate it.
 *
 * Fallback: if no React renderer ever injects, resolve after load + idle so the
 * caller can still take a "settled" snapshot.
 *
 * Exposes:
 *   window.__hydrationCmp = {
 *     renderers: [{ version, bundleType }],
 *     roots: [{ selector, path, html, at }],   // one entry per hydrated root
 *     fallbackDone: boolean,
 *   }
 */
export const HYDRATION_SIGNAL_SOURCE = String.raw`
(function () {
  var w = window;
  if (w.__hydrationCmp) return;
  var t0 = Date.now();
  var state = { renderers: [], roots: [], fallbackDone: false };
  w.__hydrationCmp = state;

  function describeContainer(el) {
    if (!el || el.nodeType === 9) return { selector: 'html', path: 'html' };
    if (el.nodeType !== 1) return { selector: 'html', path: 'html' };
    var segs = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      var tag = cur.tagName.toLowerCase();
      var n = 0;
      var sib = cur.previousElementSibling;
      while (sib) {
        if (sib.tagName === cur.tagName) n++;
        sib = sib.previousElementSibling;
      }
      segs.unshift(tag + '[' + n + ']');
      cur = cur.parentElement;
    }
    segs.unshift('html');
    var id = el.getAttribute('id');
    return { selector: id ? '#' + id : segs.join(' > '), path: segs.join(' > ') };
  }

  function wasDehydrated(root) {
    try {
      var prev = root.current && root.current.alternate;
      // React 18/19: RootState.isDehydrated on the pre-commit tree
      if (prev && prev.memoizedState && prev.memoizedState.isDehydrated === true) return true;
      // React 16/17 legacy hydrate(): FiberRoot.hydrate flag on first commit
      if (root.hydrate === true && !root.__hydrationCmpSeen) return true;
    } catch (e) {}
    return false;
  }

  var existing = w.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  var nextId = 1;
  var hook = {
    renderers: new Map(),
    supportsFiber: true,
    isDisabled: false,
    inject: function (renderer) {
      var id = nextId++;
      try {
        hook.renderers.set(id, renderer);
        state.renderers.push({ version: renderer.version || null, bundleType: renderer.bundleType });
      } catch (e) {}
      return id;
    },
    checkDCE: function () {},
    onScheduleFiberRoot: function () {},
    onCommitFiberUnmount: function () {},
    onPostCommitFiberRoot: function () {},
    onCommitFiberRoot: function (rendererId, root) {
      try {
        if (!root || root.__hydrationCmpSeen) return;
        var hydrated = wasDehydrated(root);
        root.__hydrationCmpSeen = true;
        if (!hydrated) return;
        var d = describeContainer(root.containerInfo);
        state.roots.push({
          selector: d.selector,
          path: d.path,
          html: document.documentElement ? document.documentElement.outerHTML : '',
          at: Date.now() - t0,
        });
      } catch (e) {}
    },
  };
  if (existing && typeof existing === 'object') {
    // Unlikely in a fresh headless profile, but keep anything already there working.
    ['onCommitFiberRoot', 'inject'].forEach(function (k) {
      var ours = hook[k];
      var theirs = existing[k];
      if (typeof theirs === 'function') {
        hook[k] = function () {
          var r = ours.apply(this, arguments);
          try { theirs.apply(existing, arguments); } catch (e) {}
          return r;
        };
      }
    });
  }
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;

  // Fallback for non-React pages or React builds that never reach the hook.
  function finishFallback() {
    if (state.fallbackDone) return;
    var done = function () { setTimeout(function () { state.fallbackDone = true; }, 500); };
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(done, { timeout: 8000 });
    else setTimeout(done, 300);
  }
  w.addEventListener('load', finishFallback, { once: true });
  setTimeout(finishFallback, 25000);
})();
`.trim();
