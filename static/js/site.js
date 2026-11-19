// RMRRT project page: theme toggle, videos that play while visible, the enlarged video viewer, the
// YouTube facade, reveal on scroll and the BibTeX copy button. No dependencies.
(function () {
  var root = document.documentElement;

  // Theme: the stored choice, else the system setting; storage may be unavailable.
  var toggle = document.querySelector('[data-theme-toggle]');
  function current() { return root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
  function label() { if (toggle) toggle.querySelector('[data-theme-label]').textContent = current() === 'dark' ? 'Light' : 'Dark'; }
  try { var saved = localStorage.getItem('rmrrt-theme'); if (saved) root.setAttribute('data-theme', saved); } catch (e) {}
  label();
  if (toggle) toggle.addEventListener('click', function () {
    var next = current() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('rmrrt-theme', next); } catch (e) {}
    label();
  });

  // Videos play only while visible; reveal sections once.
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if ('IntersectionObserver' in window) {
    var vo = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && !reduce) { var p = e.target.play(); if (p && p.catch) p.catch(function () {}); }
        else e.target.pause();
      });
    }, { threshold: 0.2 });
    document.querySelectorAll('video[data-autoplay]').forEach(function (v) { vo.observe(v); });
    var ro = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); ro.unobserve(e.target); } });
    }, { threshold: 0.1 });
    document.querySelectorAll('.reveal').forEach(function (el) { ro.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in'); });
  }

  // Click a video card to see it large, with controls.
  var viewer = document.querySelector('.video-viewer');
  if (viewer && viewer.showModal) {
    var big = viewer.querySelector('video'), text = viewer.querySelector('p');
    document.querySelectorAll('.video-card video').forEach(function (v) {
      v.setAttribute('role', 'button');
      v.setAttribute('tabindex', '0');
      function open() {
        big.src = v.currentSrc || v.querySelector('source').src;
        var cap = v.closest('figure').querySelector('figcaption');
        text.textContent = cap ? cap.textContent.replace(/\s+/g, ' ').trim() : '';
        viewer.showModal();
        var p = big.play(); if (p && p.catch) p.catch(function () {});
      }
      v.addEventListener('click', open);
      v.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    viewer.querySelector('.video-viewer-close').addEventListener('click', function () { viewer.close(); });
    viewer.addEventListener('close', function () { big.pause(); big.removeAttribute('src'); big.load(); });
    viewer.addEventListener('click', function (e) { if (e.target === viewer) viewer.close(); });
  }

  // YouTube facade: the player loads only on click.
  document.querySelectorAll('[data-yt]').forEach(function (box) {
    box.querySelector('.yt-facade').addEventListener('click', function () {
      var f = document.createElement('iframe');
      f.src = 'https://www.youtube-nocookie.com/embed/' + box.getAttribute('data-yt') + '?autoplay=1&rel=0';
      f.title = box.getAttribute('data-title') || 'Video';
      f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      f.allowFullscreen = true;
      box.replaceChild(f, box.querySelector('.yt-facade'));
    });
  });

  // BibTeX copy.
  var copy = document.querySelector('[data-copy-bib]');
  if (copy) copy.addEventListener('click', function () {
    var text = document.getElementById('bibtex-code').innerText;
    function done() { copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy'; }, 1600); }
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done); else done();
  });
})();
