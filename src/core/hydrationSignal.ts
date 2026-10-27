/**
 * Injected before any page script. Tries to patch window.ReactDOM when present;
 * always schedules a fallback resolve after idle + rAF so bundled apps still complete.
 */
export const HYDRATION_SIGNAL_SOURCE = String.raw`
(function () {
  var w = typeof window !== 'undefined' ? window : {};
  var resolved = false;
  function resolve(reason) {
    if (resolved) return;
    resolved = true;
    try {
      w.__hydrationCmpDone = { reason: reason, at: Date.now() };
      if (typeof w.__hydrationCmpResolve === 'function') w.__hydrationCmpResolve(reason);
    } catch (e) {}
  }

  w.__hydrationCmpPromise = new Promise(function (res) {
    w.__hydrationCmpResolve = res;
  });

  function afterPaint(cb) {
    if (typeof w.requestAnimationFrame === 'function') {
      w.requestAnimationFrame(function () {
        w.requestAnimationFrame(cb);
      });
    } else {
      setTimeout(cb, 32);
    }
  }

  function patchReactDOM(RD) {
    if (!RD || RD.__hydrationCmpPatched) return false;
    var patched = false;
    if (typeof RD.hydrateRoot === 'function') {
      var ohr = RD.hydrateRoot;
      RD.hydrateRoot = function () {
        var root = ohr.apply(this, arguments);
        afterPaint(function () {
          resolve('hydrateRoot');
        });
        return root;
      };
      patched = true;
    }
    if (typeof RD.hydrate === 'function') {
      var oh = RD.hydrate;
      RD.hydrate = function () {
        var ret = oh.apply(this, arguments);
        afterPaint(function () {
          resolve('hydrate');
        });
        return ret;
      };
      patched = true;
    }
    if (patched) RD.__hydrationCmpPatched = true;
    return patched;
  }

  var poll = setInterval(function () {
    try {
      if (w.ReactDOM) patchReactDOM(w.ReactDOM);
    } catch (e) {}
  }, 16);

  var maxPoll = 60000;
  setTimeout(function () {
    clearInterval(poll);
  }, maxPoll);

  function scheduleFallback() {
    var done = false;
    function finish(reason) {
      if (done) return;
      done = true;
      clearInterval(poll);
      resolve(reason);
    }
    function idleThenFinish() {
      if (typeof w.requestIdleCallback === 'function') {
        w.requestIdleCallback(
          function () {
            afterPaint(function () {
              setTimeout(function () {
                finish('fallback-idle');
              }, 500);
            });
          },
          { timeout: 8000 }
        );
      } else {
        afterPaint(function () {
          setTimeout(function () {
            finish('fallback-timeout');
          }, 800);
        });
      }
    }
    if (typeof w.requestIdleCallback === 'function') {
      w.addEventListener('load', idleThenFinish, { once: true });
    } else {
      w.addEventListener('load', idleThenFinish, { once: true });
    }
    setTimeout(function () {
      if (!resolved) idleThenFinish();
    }, 25000);
  }
  scheduleFallback();

  /** Suspense / streaming: wait until no visible template placeholders from RSC (heuristic) */
  try {
    var mo = new MutationObserver(function () {});
    if (w.document && w.document.documentElement) {
      mo.observe(w.document.documentElement, { childList: true, subtree: true });
    }
    setTimeout(function () {
      try {
        mo.disconnect();
      } catch (e) {}
    }, 30000);
  } catch (e) {}
})();
`.trim();
