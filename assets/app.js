(function () {
  "use strict";

  var LUX_BOUNDS = L.latLngBounds([49.44, 5.73], [50.19, 6.54]);
  var DATA_URL = "data/installations.json";

  // Respect de prefers-reduced-motion : on coupe toutes les animations de la carte.
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var countEl = document.getElementById("count");
  var updatedEl = document.getElementById("updated");
  var statusEl = document.getElementById("status");

  // Libellés paramétrables via des data-attributes sur <body>.
  function bodyAttr(name, fallback) {
    var v = document.body.getAttribute(name);
    return v === null ? fallback : v;
  }
  var NOUN_SINGULAR = bodyAttr("data-noun-singular", "installation");
  var NOUN_PLURAL = bodyAttr("data-noun-plural", "installations");
  var TITLE_SUFFIX = bodyAttr("data-title-suffix", "au Luxembourg");

  function showStatus(message) {
    statusEl.textContent = message;
    statusEl.hidden = false;
  }

  // Échappe le texte issu du JSON avant insertion dans du HTML.
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function formatDate(iso) {
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("fr-LU", { day: "numeric", month: "long", year: "numeric" });
  }

  function plural(n) {
    return n + " " + (n > 1 ? NOUN_PLURAL : NOUN_SINGULAR);
  }

  function renderTopbar(data) {
    var strong = document.createElement("strong");
    strong.textContent = String(data.total);
    countEl.textContent = "";
    countEl.appendChild(strong);
    countEl.appendChild(document.createTextNode(" " + (data.total > 1 ? NOUN_PLURAL : NOUN_SINGULAR) + (TITLE_SUFFIX ? " " + TITLE_SUFFIX : "")));
    updatedEl.textContent = "Mis à jour le " + formatDate(data.generated_at);
  }

  function createMap() {
    var map = L.map("map", {
      minZoom: 8,
      maxZoom: 17,
      zoomSnap: 0.5,
      maxBounds: LUX_BOUNDS.pad(0.25),
      maxBoundsViscosity: 0.8,
      doubleClickZoom: false,
      zoomAnimation: !reduced,
      fadeAnimation: !reduced,
      markerZoomAnimation: !reduced
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      detectRetina: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    function fitLuxembourg() {
      map.fitBounds(LUX_BOUNDS, { padding: [8, 8] });
    }
    var size = map.getSize();
    if ((size.x === 0 || size.y === 0) && "ResizeObserver" in window) {
      // Conteneur de taille nulle (volet intégré dimensionné plus tard) : on
      // attend la première taille non nulle avant de cadrer le pays (vue
      // provisoire pour que Leaflet et les groupes aient un centre/zoom).
      map.setView(LUX_BOUNDS.getCenter(), 9);
      var observer = new ResizeObserver(function () {
        var c = map.getContainer();
        if (c.clientWidth === 0 || c.clientHeight === 0) return;
        observer.disconnect();
        map.invalidateSize(false);
        fitLuxembourg();
      });
      observer.observe(map.getContainer());
    } else {
      fitLuxembourg();
    }
    return map;
  }

  function sumCount(cluster) {
    return cluster.getAllChildMarkers().reduce(function (acc, m) { return acc + (Number(m.options.count) || 0); }, 0);
  }

  function clusterIcon(cluster) {
    var total = sumCount(cluster);
    var size = total < 10 ? "s" : total < 50 ? "m" : "l";
    var px = { s: 40, m: 50, l: 60 }[size];
    return L.divIcon({
      html: '<div class="cluster cluster--' + size + '" role="img" aria-label="' + plural(total) + '">' + total + "</div>",
      className: "",
      iconSize: [px, px]
    });
  }

  function flagIcon(point) {
    var badge = point.count > 1 ? '<span class="flag__badge" aria-hidden="true">' + point.count + "</span>" : "";
    return L.divIcon({
      html: '<div class="flag"><img src="assets/flag-capner.svg" alt="" width="36" height="44">' + badge + "</div>",
      className: "",
      iconSize: [36, 44],
      iconAnchor: [4, 44],
      popupAnchor: [14, -40]
    });
  }

  function popupHtml(point) {
    var html = '<p class="popup__title">' + esc(point.localite) + "</p>";
    if (point.commune && point.commune !== point.localite) {
      html += '<p class="popup__sub">' + esc(point.commune) + "</p>";
    }
    return html + '<p class="popup__line">' + plural(point.count) + "</p>";
  }

  function createMarker(point) {
    // Leaflet rend l'icône focusable (tabindex=0, role=button) et ouvre la
    // popup sur Entrée ; `title` sert d'infobulle, `aria-label` de nom accessible
    // (sinon le badge numérique serait annoncé seul).
    var label = point.localite + ", " + plural(point.count);
    var marker = L.marker([point.lat, point.lng], {
      icon: flagIcon(point),
      count: point.count,
      title: label
    });
    marker.on("add", function () {
      var el = marker.getElement();
      if (el) el.setAttribute("aria-label", label);
    });
    marker.bindPopup(popupHtml(point), { maxWidth: 280, autoPanPadding: [16, 80] });
    return marker;
  }

  function addPoints(map, points) {
    var clusters = L.markerClusterGroup({
      disableClusteringAtZoom: 13,
      iconCreateFunction: clusterIcon,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: false,
      maxClusterRadius: 60,
      animate: !reduced,
      zoomToBoundsOnClick: !reduced
    });
    if (reduced) {
      // Zoom sans animation au clic sur un groupe.
      clusters.on("clusterclick", function (e) { e.layer.zoomToBounds({ animate: false }); });
    }
    for (var i = 0; i < points.length; i++) {
      var point = points[i];
      // Point malformé : on l'ignore sans compromettre le reste de la carte.
      if (!point || typeof point.lat !== "number" || !isFinite(point.lat) ||
          typeof point.lng !== "number" || !isFinite(point.lng) ||
          typeof point.localite !== "string" || !point.localite ||
          typeof point.count !== "number" || !isFinite(point.count) || point.count < 1) continue;
      clusters.addLayer(createMarker(point));
    }
    map.addLayer(clusters);
  }

  function loadData() {
    return fetch(DATA_URL, { cache: "no-cache" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function (data) {
      if (!data || !Array.isArray(data.points)) throw new Error("format inattendu");
      return data;
    });
  }

  var map = createMap();

  loadData().then(function (data) {
    renderTopbar(data);
    addPoints(map, data.points);
  }).catch(function (err) {
    countEl.textContent = "Données indisponibles";
    updatedEl.textContent = "";
    var http = err && typeof err.message === "string" && err.message.indexOf("HTTP ") === 0;
    showStatus("Impossible de charger les " + NOUN_PLURAL + ". Réessayez plus tard." + (http ? " (" + err.message + ")" : ""));
  });
})();
