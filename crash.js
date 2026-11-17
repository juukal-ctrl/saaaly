// crash.js: näyttää käynnistysvirheet ruudulla, koska puhelimessa konsoli ei ole näkyvissä.
// Erillinen tiedosto (ei inline-skripti), jotta sivun sisältösuojauspolitiikka voi kieltää inline-skriptit.
// Toimii vaikka sovelluksen oma koodi ei käynnisty: "Tyhjennä tallennetut tiedot" poistaa rikkoutuneen tallennuksen (Gemini-avain säilyy).
(function () {
  var box;
  var pre;

  function resetData() {
    try {
      Object.keys(localStorage)
        .filter(function (k) {
          return k.indexOf('saaaly.') === 0 && k !== 'saaaly.geminiKey';
        })
        .forEach(function (k) {
          localStorage.removeItem(k);
        });
    } catch (e) {
      /* ei väliä */
    }
    location.reload();
  }

  function button(label, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function show(msg) {
    if (!box) {
      box = document.createElement('div');
      box.id = 'crash';
      box.setAttribute('role', 'alert');
      pre = document.createElement('pre');
      box.appendChild(pre);
      box.appendChild(button('Tyhjennä tallennetut tiedot ja yritä uudelleen', resetData));
      box.appendChild(
        button('Sulje', function () {
          box.remove();
          box = null;
        }),
      );
      document.body.appendChild(box);
    }
    pre.textContent += msg + '\n';
  }

  window.addEventListener('error', function (e) {
    show('Virhe: ' + (e.message || e.type) + (e.filename ? ' (' + String(e.filename).split('/').pop() + ':' + e.lineno + ')' : ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    show('Virhe: ' + ((e.reason && e.reason.message) || e.reason));
  });
})();
