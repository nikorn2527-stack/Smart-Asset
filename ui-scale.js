/* Keeps the desktop layout identical across screen sizes by scaling the whole page.
   Design width 1920px; never scaled below 80% and never enlarged; narrow screens keep the responsive layout. */
(function () {
  var DESIGN_WIDTH = 1920, MIN_SCALE = 0.8, MIN_WIDTH = 1024;
  var root = document.documentElement;
  function apply() {
    var w = window.innerWidth, h = window.innerHeight;
    var scale = w < MIN_WIDTH ? 1 : Math.min(1, Math.max(MIN_SCALE, w / DESIGN_WIDTH));
    scale = Math.round(scale * 1000) / 1000;
    if (scale === 1) root.style.removeProperty('zoom'); else root.style.zoom = String(scale);
    // vh/vw ignore zoom, so expose them in the zoomed coordinate space
    root.style.setProperty('--vh', (h / 100 / scale) + 'px');
    root.style.setProperty('--vw', (w / 100 / scale) + 'px');
    root.style.setProperty('--ui-scale', String(scale));
  }
  apply();
  window.addEventListener('resize', apply);
})();
