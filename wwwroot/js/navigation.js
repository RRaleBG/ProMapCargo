"use strict";

window.ProMap = window.ProMap || {};

(() => {
    if (window.__promapNavigationInitialized) {
        return;
    }

    const root = document.querySelector(
        '[data-module="navigation"]'
    );

    if (!root) {
        return;
    }

    window.__promapNavigationInitialized = true;

    const $ = (id) => document.getElementById(id);

    /*
     * Server vraća custom TomTom style URL.
     *
     * API key nikada nije u ovom JavaScript fajlu.
     */
    const TOMTOM_STYLE_FALLBACK =
        "/api/map/tomtom/style";

    /*
     * MapLibre učitava dodatne TomTom style/source/sprite/glyph
     * resurse. Oni prolaze kroz server-side proxy tako da API
     * key ostaje na backendu.
     */
    const TOMTOM_PROXY_PREFIX =
        "/api/map/tomtom-proxy";

    const state = {
        map: null,

        /*
         * TomTom custom vector map.
         */
        tomTomMap: null,
        tomTomHost: null,
        tomTomFallbackLayer: null,

        start: null,
        destination: null,

        startMarker: null,
        destinationMarker: null,
        gpsMarker: null,

        routeLayers: [],
        routeResponse: null,
        selectedRouteIndex: 0,
        routeCoordinates: [],

        maneuvers: [],
        maneuverIndex: 0,

        routing: false,
        live: false,
        liveFollow: true,

        picking: null,

        lastRerouteAt: 0,

        geocodeTimers: {
            start: null,
            end: null
        }
    };

    const DEFAULTS = {
        start: {
            latitude: 44.8178,
            longitude: 20.4573,
            label: "Beograd, Srbija"
        },

        destination: {
            latitude: 45.2551,
            longitude: 19.8335,
            label: "Novi Sad, Srbija"
        }
    };

    const PRESETS = {
        "40t": {
            weight: 40,
            height: 4,
            width: 2.55,
            length: 16.5,
            axleLoad: 10,
            axles: 5,
            maxSpeed: 90
        },

        "12t": {
            weight: 12,
            height: 3.8,
            width: 2.55,
            length: 12,
            axleLoad: 8,
            axles: 3,
            maxSpeed: 90
        },

        "7.5t": {
            weight: 7.5,
            height: 3.5,
            width: 2.5,
            length: 9,
            axleLoad: 7,
            axles: 2,
            maxSpeed: 90
        },

        "3.5t": {
            weight: 3.5,
            height: 3.2,
            width: 2.2,
            length: 7,
            axleLoad: 4,
            axles: 2,
            maxSpeed: 90
        }
    };

    // ============================================================
    // COMMON HELPERS
    // ============================================================

    function setText(id, value) {
        const element = $(id);

        if (element) {
            element.textContent = value ?? "";
        }
    }

    function setHidden(id, hidden) {
        const element = $(id);

        if (element) {
            element.hidden = Boolean(hidden);
        }
    }

    function numberValue(id, fallback) {
        const element = $(id);

        if (!element) {
            return fallback;
        }

        const value = Number.parseFloat(
            element.value
        );

        return Number.isFinite(value)
            ? value
            : fallback;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function showError(message) {
        const element = $("navError");

        if (!element) {
            return;
        }

        element.textContent = message || "";
        element.hidden = !message;
    }

    function setGpsStatus(
        value,
        kind = ""
    ) {
        const element = $("gpsStatus");

        if (!element) {
            return;
        }

        element.textContent = value;

        element.classList.remove(
            "ready",
            "warning",
            "danger"
        );

        if (kind) {
            element.classList.add(kind);
        }
    }

    function setEngine(
        engine,
        usedFallback = false
    ) {
        const normalized =
            String(engine || "PostGIS");

        const display =
            usedFallback
                ? `${normalized} · FALLBACK`
                : normalized;

        setText(
            "engineHeader",
            normalized.toUpperCase()
        );

        setText(
            "summaryEngine",
            display
        );

        setText(
            "diagnosticEngine",
            normalized
        );

        setText(
            "diagnosticFallback",
            usedFallback
                ? "DA"
                : "NE"
        );

        const badge =
            $("engineBadge");

        if (badge) {
            badge.classList.remove(
                "error"
            );

            badge.classList.add(
                "ready"
            );

            badge.innerHTML =
                `<span></span>${escapeHtml(
                    display.toUpperCase()
                )}`;
        }

        setText(
            "engineFooter",
            usedFallback
                ? "OSRM fallback"
                : "Graph protected"
        );
    }

    function setRoutingUi(
        isRouting
    ) {
        state.routing =
            isRouting;

        const button =
            $("calcRoute");

        if (!button) {
            return;
        }

        button.disabled =
            isRouting;

        const strong =
            button.querySelector(
                "strong"
            );

        if (strong) {
            strong.textContent =
                isRouting
                    ? "Računam rutu…"
                    : state.profile === "truck"
                        ? "Izračunaj truck rutu"
                        : "Izračunaj auto rutu";
        }
    }

    function formatDistance(
        meters
    ) {
        if (
            window.ProMap.Maneuvers
                ?.formatDistance
        ) {
            return window.ProMap.Maneuvers
                .formatDistance(
                    meters
                );
        }

        const value =
            Number(meters);

        if (
            !Number.isFinite(
                value
            )
        ) {
            return "—";
        }

        if (
            value < 1000
        ) {
            return `${Math.round(
                value
            )} m`;
        }

        return `${(
            value / 1000
        ).toFixed(1)} km`;
    }

    function formatDuration(
        seconds
    ) {
        if (
            window.ProMap.Maneuvers
                ?.formatDuration
        ) {
            return window.ProMap.Maneuvers
                .formatDuration(
                    seconds
                );
        }

        const value =
            Number(seconds);

        if (
            !Number.isFinite(
                value
            )
        ) {
            return "—";
        }

        const minutes =
            Math.max(
                0,
                Math.round(
                    value / 60
                )
            );

        if (
            minutes < 60
        ) {
            return `${minutes} min`;
        }

        return `${Math.floor(
            minutes / 60
        )} h ${minutes % 60} min`;
    }

    function formatEta(
        value,
        durationSeconds
    ) {
        let date = null;

        if (value) {
            date = new Date(
                value
            );
        }
        else if (
            Number.isFinite(
                Number(durationSeconds)
            )
        ) {
            date =
                new Date(
                    Date.now() +
                    Number(durationSeconds) *
                    1000
                );
        }

        if (
            !date ||
            Number.isNaN(
                date.getTime()
            )
        ) {
            return "—";
        }

        return new Intl.DateTimeFormat(
            "sr-RS",
            {
                hour: "2-digit",
                minute: "2-digit"
            }
        ).format(
            date
        );
    }

    // ============================================================
    // COORDINATES
    // ============================================================

    function normalizePoint(
        point
    ) {
        if (!point) {
            return null;
        }

        const latitude =
            Number(
                point.latitude ??
                point.lat ??
                point.Lat
            );

        const longitude =
            Number(
                point.longitude ??
                point.lon ??
                point.Lon
            );

        if (
            !Number.isFinite(
                latitude
            ) ||
            !Number.isFinite(
                longitude
            ) ||
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180
        ) {
            return null;
        }

        return {
            latitude,
            longitude,
            label:
                point.label ??
                point.displayName ??
                point.display_name ??
                point.name ??
                ""
        };
    }

    function parseCoordinateText(
        value
    ) {
        const text =
            String(value || "")
                .trim();

        const match =
            text.match(
                /^\s*(-?\d+(?:[.,]\d+)?)\s*[,;]\s*(-?\d+(?:[.,]\d+)?)\s*$/
            );

        if (!match) {
            return null;
        }

        return normalizePoint({
            latitude:
                Number(
                    match[1].replace(
                        ",",
                        "."
                    )
                ),

            longitude:
                Number(
                    match[2].replace(
                        ",",
                        "."
                    )
                )
        });
    }

    // ============================================================
    // GEOMETRY
    // ============================================================

    function geometryToLatLngs(
        geometry
    ) {
        if (!geometry) {
            return [];
        }

        let value =
            geometry;

        if (
            typeof value ===
            "string"
        ) {
            try {
                value =
                    JSON.parse(
                        value
                    );
            }
            catch {
                return [];
            }
        }

        if (
            value?.type ===
            "Feature"
        ) {
            value =
                value.geometry;
        }

        if (
            !value ||
            !value.type ||
            !Array.isArray(
                value.coordinates
            )
        ) {
            return [];
        }

        const normalizeLine =
            (line) =>
                Array.isArray(line)
                    ? line
                        .filter(
                            (point) =>
                                Array.isArray(
                                    point
                                ) &&
                                point.length >= 2
                        )
                        .map(
                            (point) => [
                                Number(
                                    point[1]
                                ),
                                Number(
                                    point[0]
                                )
                            ]
                        )
                        .filter(
                            (point) =>
                                Number.isFinite(
                                    point[0]
                                ) &&
                                Number.isFinite(
                                    point[1]
                                )
                        )
                    : [];

        if (
            value.type ===
            "LineString"
        ) {
            return normalizeLine(
                value.coordinates
            );
        }

        if (
            value.type ===
            "MultiLineString"
        ) {
            return value.coordinates
                .flatMap(
                    normalizeLine
                );
        }

        return [];
    }

    function haversineMeters(
        aLat,
        aLon,
        bLat,
        bLon
    ) {
        const earth =
            6371000;

        const dLat =
            (
                (bLat - aLat) *
                Math.PI
            ) / 180;

        const dLon =
            (
                (bLon - aLon) *
                Math.PI
            ) / 180;

        const lat1 =
            (
                aLat *
                Math.PI
            ) / 180;

        const lat2 =
            (
                bLat *
                Math.PI
            ) / 180;

        const a =
            Math.sin(
                dLat / 2
            ) ** 2 +
            Math.cos(
                lat1
            ) *
            Math.cos(
                lat2
            ) *
            Math.sin(
                dLon / 2
            ) ** 2;

        return (
            2 *
            earth *
            Math.atan2(
                Math.sqrt(a),
                Math.sqrt(
                    1 - a
                )
            )
        );
    }

    function distanceToRouteMeters(
        latitude,
        longitude
    ) {
        if (
            !Array.isArray(
                state.routeCoordinates
            ) ||
            state.routeCoordinates.length ===
            0
        ) {
            return null;
        }

        let best =
            Infinity;

        for (
            const point
            of state.routeCoordinates
        ) {
            best =
                Math.min(
                    best,
                    haversineMeters(
                        latitude,
                        longitude,
                        point[0],
                        point[1]
                    )
                );
        }

        return Number.isFinite(
            best
        )
            ? best
            : null;
    }

    // ============================================================
    // GPS SERVICE
    // ============================================================

    function getCurrentGpsPosition() {
        const position =
            window.ProMap.Gps
                ?.getPosition?.();

        if (!position) {
            return null;
        }

        const latitude =
            Number(
                position.latitude ??
                position.coords?.latitude
            );

        const longitude =
            Number(
                position.longitude ??
                position.coords?.longitude
            );

        if (
            !Number.isFinite(
                latitude
            ) ||
            !Number.isFinite(
                longitude
            )
        ) {
            return null;
        }

        return {
            latitude,
            longitude,

            accuracy:
                Number(
                    position.accuracy ??
                    position.coords?.accuracy
                ),

            heading:
                Number(
                    position.heading ??
                    position.coords?.heading
                ),

            speed:
                Number(
                    position.speed ??
                    position.coords?.speed
                ),

            timestamp:
                position.timestamp ??
                position.coords?.timestamp
        };
    }

    // ============================================================
    // TOMTOM / MAPLIBRE
    // ============================================================

    function proxyTomTomUrl(
        url
    ) {
        try {
            const parsed =
                new URL(
                    url,
                    window.location.origin
                );

            if (
                parsed.protocol !==
                "https:" ||
                parsed.hostname !==
                "api.tomtom.com"
            ) {
                return url;
            }

            return (
                `${TOMTOM_PROXY_PREFIX}?url=` +
                encodeURIComponent(
                    parsed.toString()
                )
            );
        }
        catch {
            return url;
        }
    }

    function loadMapLibre() {
        if (
            window.maplibregl
        ) {
            return Promise.resolve(
                window.maplibregl
            );
        }

        if (
            window.__promapMapLibrePromise
        ) {
            return window
                .__promapMapLibrePromise;
        }

        window
            .__promapMapLibrePromise =
            new Promise(
                (
                    resolve,
                    reject
                ) => {

                    const cssHref =
                        "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";

                    const jsSrc =
                        "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";

                    if (
                        !document.querySelector(
                            `link[href="${cssHref}"]`
                        )
                    ) {
                        const link =
                            document.createElement(
                                "link"
                            );

                        link.rel =
                            "stylesheet";

                        link.href =
                            cssHref;

                        document.head.appendChild(
                            link
                        );
                    }

                    const existing =
                        document.querySelector(
                            `script[src="${jsSrc}"]`
                        );

                    if (
                        existing
                    ) {
                        existing.addEventListener(
                            "load",
                            () =>
                                window.maplibregl
                                    ? resolve(
                                        window.maplibregl
                                    )
                                    : reject(
                                        new Error(
                                            "MapLibre GL nije dostupan."
                                        )
                                    ),
                            {
                                once: true
                            }
                        );

                        existing.addEventListener(
                            "error",
                            () =>
                                reject(
                                    new Error(
                                        "MapLibre GL JS nije moguće učitati."
                                    )
                                ),
                            {
                                once: true
                            }
                        );

                        return;
                    }

                    const script =
                        document.createElement(
                            "script"
                        );

                    script.src =
                        jsSrc;

                    script.async =
                        true;

                    script.onload =
                        () => {
                            if (
                                window.maplibregl
                            ) {
                                resolve(
                                    window.maplibregl
                                );
                            }
                            else {
                                reject(
                                    new Error(
                                        "MapLibre GL JS nije dostupan."
                                    )
                                );
                            }
                        };

                    script.onerror =
                        () =>
                            reject(
                                new Error(
                                    "MapLibre GL JS CDN nije dostupan."
                                )
                            );

                    document.head.appendChild(
                        script
                    );
                }
            );

        return window
            .__promapMapLibrePromise;
    }

    function syncTomTomBackground() {
        if (
            !state.map ||
            !state.tomTomMap
        ) {
            return;
        }

        const center =
            state.map.getCenter();

        const zoom =
            state.map.getZoom();

        state.tomTomMap.jumpTo({
            center: [
                center.lng,
                center.lat
            ],
            zoom
        });

        state.tomTomMap.resize();
    }

    function activateTomTomRasterFallback() {
        if (
            !state.map ||
            !window.L ||
            state.tomTomFallbackLayer
        ) {
            return;
        }

        state.tomTomFallbackLayer =
            L.tileLayer(
                "/api/map/tiles/dark/{z}/{x}/{y}.png",
                {
                    maxZoom: 22,
                    tileSize: 256,
                    attribution:
                        "&copy; TomTom"
                }
            ).addTo(
                state.map
            );
    }

    function installTomTomBackground() {
        if (
            !state.map ||
            !window.L
        ) {
            return;
        }

        const mapElement =
            $("navMap");

        if (!mapElement) {
            return;
        }

        /*
         * MapLibre renderuje background.
         *
         * Leaflet ostaje iznad njega i služi za:
         * - route polyline
         * - markers
         * - GPS
         * - klik
         * - fitBounds
         */
        const host =
            document.createElement(
                "div"
            );

        host.id =
            "navTomTomMap";

        host.style.position =
            "absolute";

        host.style.inset =
            "0";

        host.style.zIndex =
            "0";

        host.style.width =
            "100%";

        host.style.height =
            "100%";

        host.style.pointerEvents =
            "none";

        host.style.overflow =
            "hidden";

        mapElement.prepend(
            host
        );

        state.tomTomHost =
            host;

        /*
         * Sakrij Leaflet base tile pane.
         * Route/overlay pane-ovi ostaju aktivni.
         */
        const tilePane =
            mapElement.querySelector(
                ".leaflet-tile-pane"
            );

        if (tilePane) {
            tilePane.style.display =
                "none";
        }

        /*
         * URL iz backend konfiguracije.
         */
        const styleUrlPromise =
            fetch(
                "/api/map/config",
                {
                    headers: {
                        Accept:
                            "application/json"
                    }
                }
            )
                .then(
                    (response) => {
                        if (
                            !response.ok
                        ) {
                            throw new Error(
                                `Map config HTTP ${response.status}`
                            );
                        }

                        return response.json();
                    }
                )
                .then(
                    (config) =>
                        config?.customStyleUrl ||
                        TOMTOM_STYLE_FALLBACK
                )
                .catch(
                    () =>
                        TOMTOM_STYLE_FALLBACK
                );

        loadMapLibre()
            .then(
                (maplibregl) =>
                    styleUrlPromise.then(
                        (
                            styleUrl
                        ) => {

                            state.tomTomMap =
                                new maplibregl.Map(
                                    {
                                        container:
                                            host,

                                        style:
                                            styleUrl,

                                        center:
                                            [
                                                20.4633,
                                                44.8176
                                            ],

                                        zoom:
                                            8,

                                        attributionControl:
                                            false,

                                        interactive:
                                            false,

                                        dragPan:
                                            false,

                                        scrollZoom:
                                            false,

                                        boxZoom:
                                            false,

                                        doubleClickZoom:
                                            false,

                                        dragRotate:
                                            false,

                                        keyboard:
                                            false,

                                        touchZoomRotate:
                                            false,

                                        transformRequest:
                                            (
                                                url
                                            ) => ({
                                                url:
                                                    proxyTomTomUrl(
                                                        url
                                                    )
                                            })
                                    }
                                );

                            state.tomTomMap.on(
                                "load",
                                () => {
                                    syncTomTomBackground();

                                    state
                                        .tomTomMap
                                        .resize();

                                    console.log(
                                        "[ProMap Navigation] TomTom custom style loaded."
                                    );
                                }
                            );

                            state.tomTomMap.on(
                                "error",
                                (
                                    event
                                ) => {
                                    console.error(
                                        "[ProMap Navigation] TomTom custom style error:",
                                        event
                                    );

                                    activateTomTomRasterFallback();
                                }
                            );
                        }
                    )
            )
            .catch(
                (error) => {
                    console.error(
                        "[ProMap Navigation] MapLibre load error:",
                        error
                    );

                    activateTomTomRasterFallback();
                }
            );
    }

    // ============================================================
    // MAP
    // ============================================================

    function initializeMap() {
        const mapElement =
            $("navMap");

        if (!mapElement) {
            console.error(
                "[ProMap Navigation] #navMap nije pronađen."
            );

            return;
        }

        if (!window.L) {
            console.error(
                "[ProMap Navigation] Leaflet nije učitan."
            );

            return;
        }

        if (state.map) {
            state.map.invalidateSize();
            return;
        }

        state.map =
            L.map(
                mapElement,
                {
                    zoomControl:
                        true,

                    preferCanvas:
                        true
                }
            ).setView(
                [
                    44.8176,
                    20.4633
                ],
                8
            );

        if (
            state.map.attributionControl
        ) {
            state.map
                .attributionControl
                .addAttribution(
                    "&copy; TomTom"
                );
        }

        /*
         * Traffic overlays i dalje idu preko Leaflet-a.
         */
        const trafficFlowLayer =
            L.tileLayer(
                "/api/map/tiles/flow/{z}/{x}/{y}.png",
                {
                    maxZoom:
                        22,

                    tileSize:
                        256,

                    opacity:
                        0.85,

                    attribution:
                        "&copy; TomTom Traffic"
                }
            );

        const trafficIncidentsLayer =
            L.tileLayer(
                "/api/map/tiles/incidents/{z}/{x}/{y}.png",
                {
                    maxZoom:
                        22,

                    tileSize:
                        256,

                    opacity:
                        0.95,

                    attribution:
                        "&copy; TomTom Traffic"
                }
            );

        L.control.layers(
            null,
            {
                "Traffic Flow":
                    trafficFlowLayer,

                "Traffic Incidents":
                    trafficIncidentsLayer
            },
            {
                collapsed:
                    false,

                position:
                    "topright"
            }
        ).addTo(
            state.map
        );

        state.map.on(
            "move",
            syncTomTomBackground
        );

        state.map.on(
            "zoom",
            syncTomTomBackground
        );

        state.map.on(
            "resize",
            syncTomTomBackground
        );

        state.map.on(
            "dragstart",
            () => {
                if (
                    state.live
                ) {
                    state.liveFollow =
                        false;
                }
            }
        );

        state.map.on(
            "click",
            (event) => {
                if (
                    !state.picking
                ) {
                    return;
                }

                const point = {
                    latitude:
                        event.latlng.lat,

                    longitude:
                        event.latlng.lng,

                    label:
                        `${event.latlng.lat.toFixed(6)}, ${event.latlng.lng.toFixed(6)}`
                };

                if (
                    state.picking ===
                    "start"
                ) {
                    const input =
                        $("navStart");

                    if (input) {
                        input.value =
                            point.label;
                    }

                    setStart(
                        point
                    );
                }
                else {
                    const input =
                        $("navEnd");

                    if (input) {
                        input.value =
                            point.label;
                    }

                    setDestination(
                        point
                    );
                }

                state.picking =
                    null;

                state.map
                    .getContainer()
                    .style.cursor =
                    "";

                showError("");
            }
        );

        installTomTomBackground();

        requestAnimationFrame(
            () =>
                state.map
                    ?.invalidateSize()
        );

        setTimeout(
            () =>
                state.map
                    ?.invalidateSize(),
            300
        );

        setTimeout(
            () =>
                state.map
                    ?.invalidateSize(),
            1000
        );
    }

    // ============================================================
    // START / DESTINATION
    // ============================================================

    function setStart(
        point
    ) {
        const normalized =
            normalizePoint(
                point
            );

        if (!normalized) {
            return false;
        }

        state.start =
            normalized;

        setText(
            "navStartResolved",
            normalized.label ||
            `${normalized.latitude.toFixed(6)}, ${normalized.longitude.toFixed(6)}`
        );

        if (!state.map) {
            return true;
        }

        if (
            state.startMarker
        ) {
            state.startMarker.remove();
        }

        state.startMarker =
            L.circleMarker(
                [
                    normalized.latitude,
                    normalized.longitude
                ],
                {
                    radius:
                        8,

                    weight:
                        3,

                    fillOpacity:
                        1
                }
            )
                .addTo(
                    state.map
                )
                .bindTooltip(
                    "START",
                    {
                        direction:
                            "top",

                        offset:
                            [
                                0,
                                -6
                            ],

                        opacity:
                            0.95
                    }
                );

        return true;
    }

    function setDestination(
        point
    ) {
        const normalized =
            normalizePoint(
                point
            );

        if (!normalized) {
            return false;
        }

        state.destination =
            normalized;

        setText(
            "navEndResolved",
            normalized.label ||
            `${normalized.latitude.toFixed(6)}, ${normalized.longitude.toFixed(6)}`
        );

        if (!state.map) {
            return true;
        }

        if (
            state.destinationMarker
        ) {
            state.destinationMarker.remove();
        }

        state.destinationMarker =
            L.circleMarker(
                [
                    normalized.latitude,
                    normalized.longitude
                ],
                {
                    radius:
                        8,

                    weight:
                        3,

                    fillOpacity:
                        1
                }
            )
                .addTo(
                    state.map
                )
                .bindTooltip(
                    "DESTINACIJA",
                    {
                        direction:
                            "top",

                        offset:
                            [
                                0,
                                -6
                            ],

                        opacity:
                            0.95
                    }
                );

        return true;
    }

    // ============================================================
    // GEOCODING
    // ============================================================

    async function geocode(
        query
    ) {
        const response =
            await fetch(
                `/api/geocode?q=${encodeURIComponent(query)}&limit=5`,
                {
                    headers: {
                        Accept:
                            "application/json"
                    }
                }
            );

        if (!response.ok) {
            throw new Error(
                `Geocoding HTTP ${response.status}`
            );
        }

        const data =
            await response.json();

        return Array.isArray(
            data
        )
            ? data
            : Array.isArray(
                data?.results
            )
                ? data.results
                : [];
    }

    function clearSuggestions(
        target
    ) {
        const id =
            target === "start"
                ? "navStartSuggestions"
                : "navEndSuggestions";

        const box =
            $(id);

        if (box) {
            box.innerHTML =
                "";
        }
    }

    function renderSuggestions(
        target,
        items
    ) {
        const box =
            $(
                target === "start"
                    ? "navStartSuggestions"
                    : "navEndSuggestions"
            );

        if (!box) {
            return;
        }

        box.innerHTML =
            "";

        for (
            const rawItem
            of items.slice(0, 5)
        ) {
            const point =
                normalizePoint(
                    rawItem
                );

            if (!point) {
                continue;
            }

            const button =
                document.createElement(
                    "button"
                );

            button.type =
                "button";

            button.className =
                "nav-suggestion";

            const label =
                point.label ||
                `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`;

            button.textContent =
                label;

            button.addEventListener(
                "click",
                () => {
                    if (
                        target ===
                        "start"
                    ) {
                        $("navStart").value =
                            label;

                        setStart({
                            ...point,
                            label
                        });
                    }
                    else {
                        $("navEnd").value =
                            label;

                        setDestination({
                            ...point,
                            label
                        });
                    }

                    clearSuggestions(
                        target
                    );

                    showError("");
                }
            );

            box.appendChild(
                button
            );
        }
    }

    function scheduleGeocode(
        target
    ) {
        const input =
            $(
                target === "start"
                    ? "navStart"
                    : "navEnd"
            );

        if (!input) {
            return;
        }

        clearTimeout(
            state.geocodeTimers[
            target
            ]
        );

        const value =
            input.value.trim();

        if (
            target ===
            "start"
        ) {
            state.start =
                null;

            setText(
                "navStartResolved",
                "Nije još potvrđeno"
            );
        }
        else {
            state.destination =
                null;

            setText(
                "navEndResolved",
                "Nije još potvrđeno"
            );
        }

        const coordinates =
            parseCoordinateText(
                value
            );

        if (
            coordinates
        ) {
            const label =
                `${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`;

            if (
                target ===
                "start"
            ) {
                setStart({
                    ...coordinates,
                    label
                });
            }
            else {
                setDestination({
                    ...coordinates,
                    label
                });
            }

            clearSuggestions(
                target
            );

            return;
        }

        if (
            value.length < 2
        ) {
            clearSuggestions(
                target
            );

            return;
        }

        state.geocodeTimers[
            target
        ] =
            window.setTimeout(
                async () => {
                    try {
                        renderSuggestions(
                            target,
                            await geocode(
                                value
                            )
                        );
                    }
                    catch (
                    error
                    ) {
                        console.warn(
                            "[ProMap Navigation] Geocoding error:",
                            error
                        );
                    }
                },
                300
            );
    }

    async function resolveInput(
        target
    ) {
        const input =
            $(
                target === "start"
                    ? "navStart"
                    : "navEnd"
            );

        if (!input) {
            return false;
        }

        const value =
            input.value.trim();

        const coordinate =
            parseCoordinateText(
                value
            );

        if (
            coordinate
        ) {
            const label =
                `${coordinate.latitude.toFixed(6)}, ${coordinate.longitude.toFixed(6)}`;

            return target ===
                "start"
                ? setStart({
                    ...coordinate,
                    label
                })
                : setDestination({
                    ...coordinate,
                    label
                });
        }

        if (
            value.length < 2
        ) {
            return false;
        }

        const results =
            await geocode(
                value
            );

        const point =
            normalizePoint(
                results[0]
            );

        if (!point) {
            return false;
        }

        const label =
            point.label ||
            `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`;

        input.value =
            label;

        return target ===
            "start"
            ? setStart({
                ...point,
                label
            })
            : setDestination({
                ...point,
                label
            });
    }

    // ============================================================
    // TRUCK
    // ============================================================

    function truckFromForm() {
        return {
            grossWeightT:
                numberValue(
                    "navWeight",
                    40
                ),

            heightM:
                numberValue(
                    "navHeight",
                    4
                ),

            widthM:
                numberValue(
                    "navWidth",
                    2.55
                ),

            lengthM:
                numberValue(
                    "navLength",
                    16.5
                ),

            axleLoadT:
                numberValue(
                    "navAxleLoad",
                    10
                ),

            axles:
                Math.max(
                    1,
                    Math.round(
                        numberValue(
                            "navAxles",
                            5
                        )
                    )
                ),

            isHgv:
                true,

            commercial:
                true,

            hazmat:
                $("navHazmat")
                    ?.checked ??
                false,

            adrClass:
                $("navAdrClass")
                    ?.value
                    ?.trim() ||
                null,

            vehicleClass:
                "HeavyGoods",

            maxSpeedKmh:
                numberValue(
                    "navMaxSpeed",
                    90
                )
        };
    }

    function validateTruck() {
        if (
            state.profile !==
            "truck"
        ) {
            return null;
        }

        const fields = [
            [
                "navWeight",
                "Masa"
            ],
            [
                "navHeight",
                "Visina"
            ],
            [
                "navWidth",
                "Širina"
            ],
            [
                "navLength",
                "Dužina"
            ],
            [
                "navAxleLoad",
                "Osovinsko opterećenje"
            ],
            [
                "navAxles",
                "Broj osovina"
            ],
            [
                "navMaxSpeed",
                "Maksimalna brzina"
            ]
        ];

        for (
            const [id, label]
            of fields
        ) {
            const value =
                numberValue(
                    id,
                    NaN
                );

            if (
                !Number.isFinite(
                    value
                ) ||
                value <= 0
            ) {
                return `${label} mora biti veća od 0.`;
            }
        }

        return null;
    }

    function requestState() {
        return {
            start:
                state.start,

            destination:
                state.destination,

            profile:
                state.profile,

            avoidRestricted:
                $("navAvoid")
                    ?.checked ??
                true,

            departureAt:
                new Date()
                    .toISOString(),

            truck:
                state.profile ===
                    "truck"
                    ? truckFromForm()
                    : null
        };
    }

    // ============================================================
    // ROUTE STATE
    // ============================================================

    function clearRouteLayers() {
        for (
            const entry
            of state.routeLayers
        ) {
            try {
                entry.layer.remove();
            }
            catch {
                /* noop */
            }
        }

        state.routeLayers =
            [];

        state.routeCoordinates =
            [];
    }

    function clearRouteResult() {
        clearRouteLayers();

        state.routeResponse =
            null;

        state.selectedRouteIndex =
            0;

        state.maneuvers =
            [];

        state.maneuverIndex =
            0;

        setText(
            "summaryDistance",
            "—"
        );

        setText(
            "summaryDuration",
            "—"
        );

        setText(
            "summaryEta",
            "—"
        );

        setText(
            "summarySafety",
            "READY"
        );

        setText(
            "summaryDiagnostics",
            "—"
        );

        setText(
            "mapDistance",
            "—"
        );

        setText(
            "mapDuration",
            "—"
        );

        setText(
            "mapEta",
            "—"
        );

        setText(
            "summaryEngine",
            "—"
        );

        setText(
            "diagnosticEngine",
            "—"
        );

        setText(
            "diagnosticGraph",
            "—"
        );

        setText(
            "diagnosticStates",
            "—"
        );

        setText(
            "diagnosticFallback",
            "—"
        );

        setText(
            "nextInstructionIcon",
            "↑"
        );

        setText(
            "nextInstructionText",
            "—"
        );

        setText(
            "nextInstructionDistance",
            "—"
        );

        setText(
            "alternativeCount",
            "0"
        );

        setText(
            "warningCount",
            "0"
        );

        setText(
            "maneuverCount",
            "0"
        );

        if (
            $("routeAlternatives")
        ) {
            $("routeAlternatives")
                .innerHTML = "";
        }

        if (
            $("routeWarnings")
        ) {
            $("routeWarnings")
                .innerHTML = "";
        }

        if (
            $("maneuverList")
        ) {
            $("maneuverList")
                .innerHTML = "";
        }

        setHidden(
            "mapRouteCard",
            true
        );

        setHidden(
            "nextInstruction",
            true
        );

        setHidden(
            "alternativesCard",
            true
        );

        setHidden(
            "warningsCard",
            true
        );

        setHidden(
            "maneuversCard",
            true
        );

        showError("");
    }

    function routeViolations(
        route
    ) {
        return Array.isArray(
            route?.analysis?.violations
        )
            ? route.analysis.violations
            : [];
    }

    function updateRouteLayerStyles() {
        for (
            const entry
            of state.routeLayers
        ) {
            entry.layer.setStyle({
                weight:
                    entry.index ===
                        state.selectedRouteIndex
                        ? 7
                        : 4,

                opacity:
                    entry.index ===
                        state.selectedRouteIndex
                        ? 0.95
                        : 0.35
            });

            if (
                entry.index ===
                state.selectedRouteIndex
            ) {
                entry.layer.bringToFront();
            }
        }
    }

    // ============================================================
    // ALTERNATIVES
    // ============================================================

    function renderAlternatives(
        routes
    ) {
        const card =
            $("alternativesCard");

        const box =
            $("routeAlternatives");

        if (
            !card ||
            !box
        ) {
            return;
        }

        box.innerHTML =
            "";

        const alternatives =
            routes
                .map(
                    (
                        route,
                        index
                    ) => ({
                        route,
                        index
                    })
                )
                .filter(
                    ({ index }) =>
                        index !==
                        state.selectedRouteIndex
                );

        setText(
            "alternativeCount",
            alternatives.length
        );

        if (
            !alternatives.length
        ) {
            card.hidden =
                true;

            return;
        }

        card.hidden =
            false;

        for (
            const {
                route,
                index
            }
            of alternatives
        ) {
            const button =
                document.createElement(
                    "button"
                );

            button.type =
                "button";

            button.className =
                "nav-alternative";

            button.innerHTML = `
                <strong>Ruta ${index + 1}</strong>
                <span>${escapeHtml(formatDistance(route?.distance))} · ${escapeHtml(formatDuration(route?.duration))}</span>
                <small>Score: ${escapeHtml(route?.analysis?.score ?? "—")}</small>
            `;

            button.addEventListener(
                "click",
                () =>
                    selectRoute(
                        index,
                        true
                    )
            );

            box.appendChild(
                button
            );
        }
    }

    // ============================================================
    // WARNINGS
    // ============================================================

    function renderWarnings(
        route,
        response
    ) {
        const card =
            $("warningsCard");

        const box =
            $("routeWarnings");

        if (
            !card ||
            !box
        ) {
            return;
        }

        box.innerHTML =
            "";

        const violations = [
            ...routeViolations(
                route
            ),

            ...(
                Array.isArray(
                    response?.violations
                )
                    ? response.violations
                    : []
            )
        ];

        const unique = [];
        const seen = new Set();

        for (
            const item
            of violations
        ) {
            const key =
                `${item?.id || ""}|${item?.name || ""}|${item?.reason || ""}`;

            if (
                seen.has(
                    key
                )
            ) {
                continue;
            }

            seen.add(
                key
            );

            unique.push(
                item
            );
        }

        setText(
            "warningCount",
            unique.length
        );

        if (
            !unique.length
        ) {
            card.hidden =
                true;

            return;
        }

        card.hidden =
            false;

        unique.forEach(
            (item) => {
                const row =
                    document.createElement(
                        "div"
                    );

                row.className =
                    "nav-warning";

                row.innerHTML = `
                    <strong>${escapeHtml(item?.name || item?.type || "Restrikcija")}</strong>
                    <span>${escapeHtml(item?.reason || "Ruta sadrži upozorenje.")}</span>
                `;

                box.appendChild(
                    row
                );
            }
        );
    }

    // ============================================================
    // MANEUVERS
    // ============================================================

    function renderManeuvers(
        response
    ) {
        const card =
            $("maneuversCard");

        const box =
            $("maneuverList");

        if (
            !card ||
            !box
        ) {
            return;
        }

        const source =
            Array.isArray(
                response?.maneuvers
            )
                ? response.maneuvers
                : [];

        state.maneuvers =
            source.map(
                (item) =>
                    window.ProMap.Maneuvers
                        ?.normalize
                        ? window.ProMap.Maneuvers
                            .normalize(
                                item
                            )
                        : item
            );

        box.innerHTML =
            "";

        setText(
            "maneuverCount",
            state.maneuvers.length
        );

        if (
            !state.maneuvers.length
        ) {
            card.hidden =
                true;

            return;
        }

        card.hidden =
            false;

        state.maneuvers.forEach(
            (
                maneuver,
                index
            ) => {
                const row =
                    document.createElement(
                        "button"
                    );

                row.type =
                    "button";

                row.className =
                    "nav-maneuver";

                row.innerHTML = `
                    <span class="nav-maneuver-icon">${escapeHtml(maneuver.icon || "↑")}</span>
                    <span>
                        <strong>${escapeHtml(maneuver.instruction || "Nastavi pravo")}</strong>
                        <small>${escapeHtml(formatDistance(maneuver.distanceMeters))}</small>
                    </span>
                `;

                row.addEventListener(
                    "click",
                    () => {
                        const lat =
                            Number(
                                maneuver.latitude
                            );

                        const lon =
                            Number(
                                maneuver.longitude
                            );

                        if (
                            state.map &&
                            Number.isFinite(
                                lat
                            ) &&
                            Number.isFinite(
                                lon
                            )
                        ) {
                            state.map.setView(
                                [
                                    lat,
                                    lon
                                ],
                                Math.max(
                                    state.map.getZoom(),
                                    16
                                )
                            );
                        }

                        state.maneuverIndex =
                            index;

                        updateNextInstruction();
                    }
                );

                box.appendChild(
                    row
                );
            }
        );
    }

    function updateNextInstruction() {
        if (
            !state.maneuvers.length
        ) {
            setHidden(
                "nextInstruction",
                true
            );

            return;
        }

        const index =
            Math.min(
                Math.max(
                    state.maneuverIndex,
                    0
                ),
                state.maneuvers.length -
                1
            );

        const maneuver =
            state.maneuvers[
            index
            ];

        setHidden(
            "nextInstruction",
            false
        );

        setText(
            "nextInstructionIcon",
            maneuver.icon ||
            "↑"
        );

        setText(
            "nextInstructionText",
            maneuver.instruction ||
            "Nastavi pravo"
        );

        setText(
            "nextInstructionDistance",
            formatDistance(
                maneuver.distanceMeters
            )
        );
    }

    function updateSelectedRouteUi(
        route
    ) {
        if (!route) {
            return;
        }

        const distance =
            route.distance ??
            route.Distance ??
            route?.summary
                ?.distanceMeters;

        const duration =
            route.duration ??
            route.Duration ??
            route?.summary
                ?.durationSeconds;

        const summary =
            state.routeResponse
                ?.summary ||
            {};

        setText(
            "summaryDistance",
            formatDistance(
                distance ??
                summary.distanceMeters
            )
        );

        setText(
            "summaryDuration",
            formatDuration(
                duration ??
                summary.durationSeconds
            )
        );

        setText(
            "summaryEta",
            formatEta(
                summary.estimatedArrival,
                duration ??
                summary.durationSeconds
            )
        );

        setText(
            "mapDistance",
            formatDistance(
                distance
            )
        );

        setText(
            "mapDuration",
            formatDuration(
                duration
            )
        );

        setText(
            "mapEta",
            formatEta(
                summary.estimatedArrival,
                duration
            )
        );

        const safe =
            state.routeResponse
                ?.isTruckSafe ??
            !routeViolations(
                route
            ).length;

        setText(
            "summarySafety",
            state.profile ===
                "truck"
                ? safe
                    ? "TRUCK SAFE"
                    : "UPOZORENJE"
                : "READY"
        );

        setText(
            "routeSafeBadge",
            state.profile ===
                "truck"
                ? safe
                    ? "TRUCK SAFE"
                    : "RESTRIKCIJE"
                : "CAR ROUTE"
        );

        const diagnostics =
            state.routeResponse
                ?.diagnostics ||
            {};

        const parts = [];

        if (
            Number.isFinite(
                Number(
                    diagnostics.expandedStates
                )
            )
        ) {
            parts.push(
                `${diagnostics.expandedStates} states`
            );
        }

        if (
            diagnostics.graphVersion !=
            null
        ) {
            parts.push(
                `graph ${diagnostics.graphVersion}`
            );
        }

        if (
            routeViolations(
                route
            ).length
        ) {
            parts.push(
                `${routeViolations(route).length} warnings`
            );
        }

        setText(
            "summaryDiagnostics",
            parts.length
                ? parts.join(
                    " · "
                )
                : "—"
        );

        setText(
            "diagnosticGraph",
            diagnostics.graphVersion !=
                null
                ? String(
                    diagnostics.graphVersion
                )
                : "—"
        );

        setText(
            "diagnosticStates",
            diagnostics.expandedStates !=
                null
                ? String(
                    diagnostics.expandedStates
                )
                : "—"
        );

        setEngine(
            diagnostics.engine,
            Boolean(
                diagnostics.usedFallback
            )
        );

        renderWarnings(
            route,
            state.routeResponse
        );

        updateNextInstruction();
    }

    function selectRoute(
        index,
        fit
    ) {
        const routes =
            state.routeResponse
                ?.routes;

        if (
            !Array.isArray(
                routes
            ) ||
            !routes[index]
        ) {
            return;
        }

        state.selectedRouteIndex =
            index;

        const route =
            routes[index];

        state.routeCoordinates =
            geometryToLatLngs(
                route.geometry
            );

        updateRouteLayerStyles();

        updateSelectedRouteUi(
            route
        );

        renderAlternatives(
            routes
        );

        if (
            fit &&
            state.routeCoordinates
                .length
        ) {
            fitRoute();
        }
    }

    // ============================================================
    // ROUTE RENDERING
    // ============================================================

    function renderRouteResponse(
        response
    ) {
        clearRouteLayers();

        if (
            !response ||
            !Array.isArray(
                response.routes
            ) ||
            response.routes.length === 0
        ) {
            throw new Error(
                "Routing servis nije vratio nijednu rutu."
            );
        }

        state.routeResponse =
            response;

        const requestedIndex =
            Number(
                response.selectedRouteIndex ??
                0
            );

        state.selectedRouteIndex =
            Number.isInteger(
                requestedIndex
            ) &&
                requestedIndex >= 0 &&
                requestedIndex <
                response.routes.length
                ? requestedIndex
                : 0;

        for (
            const [
                index,
                route
            ]
            of response.routes.entries()
        ) {
            const coordinates =
                geometryToLatLngs(
                    route.geometry
                );

            if (
                !coordinates.length
            ) {
                continue;
            }

            const layer =
                L.polyline(
                    coordinates,
                    {
                        weight:
                            index ===
                                state.selectedRouteIndex
                                ? 7
                                : 4,

                        opacity:
                            index ===
                                state.selectedRouteIndex
                                ? 0.95
                                : 0.35,

                        className:
                            index ===
                                state.selectedRouteIndex
                                ? "pm-route-active"
                                : "pm-route-alternative"
                    }
                ).addTo(
                    state.map
                );

            layer.on(
                "click",
                () =>
                    selectRoute(
                        index,
                        false
                    )
            );

            state.routeLayers.push({
                index,
                layer
            });
        }

        renderManeuvers(
            response
        );

        setHidden(
            "mapRouteCard",
            false
        );

        selectRoute(
            state.selectedRouteIndex,
            true
        );
    }

    // ============================================================
    // ROUTING
    // ============================================================

    async function calculateRoute({
        silent = false
    } = {}) {
        if (
            state.routing
        ) {
            return false;
        }

        showError("");

        if (
            !state.start
        ) {
            try {
                await resolveInput(
                    "start"
                );
            }
            catch (error) {
                console.warn(
                    "[ProMap Navigation] Start resolve failed:",
                    error
                );
            }
        }

        if (
            !state.destination
        ) {
            try {
                await resolveInput(
                    "end"
                );
            }
            catch (error) {
                console.warn(
                    "[ProMap Navigation] Destination resolve failed:",
                    error
                );
            }
        }

        if (
            !state.start ||
            !state.destination
        ) {
            showError(
                "Izaberi validan start i odredište iz predloga, unesi koordinate ili izaberi tačke na mapi."
            );

            return false;
        }

        const truckError =
            validateTruck();

        if (
            truckError
        ) {
            showError(
                truckError
            );

            return false;
        }

        const directDistance =
            haversineMeters(
                state.start.latitude,
                state.start.longitude,
                state.destination.latitude,
                state.destination.longitude
            );

        if (
            directDistance < 10
        ) {
            showError(
                "Start i odredište su preblizu."
            );

            return false;
        }

        if (
            !window.ProMap.Routing
                ?.calculate
        ) {
            showError(
                "Routing JS modul nije učitan."
            );

            return false;
        }

        setRoutingUi(
            true
        );

        try {
            const response =
                await window.ProMap.Routing.calculate(
                    requestState()
                );

            renderRouteResponse(
                response
            );

            setText(
                "navStatus",
                "READY"
            );

            if (
                !silent
            ) {
                showError("");
            }

            return true;
        }
        catch (
        error
        ) {
            console.error(
                "[ProMap Navigation] Routing error:",
                error
            );

            let message =
                error?.message ||
                "Routing servis trenutno nije dostupan.";

            if (
                error?.status ===
                503
            ) {
                message =
                    "Routing servis trenutno nije dostupan. Proveri PostGIS graph i OSRM fallback.";
            }

            showError(
                message
            );

            const badge =
                $("engineBadge");

            if (
                badge
            ) {
                badge.classList.remove(
                    "ready"
                );

                badge.classList.add(
                    "error"
                );
            }

            return false;
        }
        finally {
            setRoutingUi(
                false
            );
        }
    }

    // ============================================================
    // VEHICLE
    // ============================================================

    function applyPreset(
        value
    ) {
        const preset =
            PRESETS[value];

        if (!preset) {
            return;
        }

        const values = {
            navWeight:
                preset.weight,

            navHeight:
                preset.height,

            navWidth:
                preset.width,

            navLength:
                preset.length,

            navAxleLoad:
                preset.axleLoad,

            navAxles:
                preset.axles,

            navMaxSpeed:
                preset.maxSpeed
        };

        for (
            const [
                id,
                value
            ]
            of Object.entries(
                values
            )
        ) {
            const element =
                $(id);

            if (
                element
            ) {
                element.value =
                    String(
                        value
                    );
            }
        }
    }

    function setProfile(
        profile
    ) {
        state.profile =
            profile === "car"
                ? "car"
                : "truck";

        $("truckMode")
            ?.classList.toggle(
                "active",
                state.profile ===
                "truck"
            );

        $("carMode")
            ?.classList.toggle(
                "active",
                state.profile ===
                "car"
            );

        setText(
            "truckModeBadge",
            state.profile ===
                "truck"
                ? "HGV"
                : "CAR"
        );

        setText(
            "routeSafeBadge",
            state.profile ===
                "truck"
                ? "TRUCK SAFE"
                : "CAR ROUTE"
        );

        setHidden(
            "truckFields",
            state.profile !==
            "truck"
        );

        clearRouteResult();

        updateVehicleMode();
    }

    function updateVehicleMode() {
        const button =
            $("calcRoute");

        const strong =
            button?.querySelector(
                "strong"
            );

        if (
            strong
        ) {
            strong.textContent =
                state.profile ===
                    "truck"
                    ? "Izračunaj truck rutu"
                    : "Izračunaj auto rutu";
        }
    }

    function swapPoints() {
        const oldStart =
            state.start;

        const oldDestination =
            state.destination;

        if (
            oldStart
        ) {
            setDestination(
                oldStart
            );

            if (
                $("navEnd")
            ) {
                $("navEnd").value =
                    oldStart.label ||
                    `${oldStart.latitude.toFixed(6)}, ${oldStart.longitude.toFixed(6)}`;
            }
        }

        if (
            oldDestination
        ) {
            setStart(
                oldDestination
            );

            if (
                $("navStart")
            ) {
                $("navStart").value =
                    oldDestination.label ||
                    `${oldDestination.latitude.toFixed(6)}, ${oldDestination.longitude.toFixed(6)}`;
            }
        }

        clearRouteResult();
    }

    // ============================================================
    // MAP PICK
    // ============================================================

    function activateMapPick(
        target
    ) {
        if (
            !state.map
        ) {
            return;
        }

        state.picking =
            target ===
                "end"
                ? "destination"
                : target;

        state.map
            .getContainer()
            .style.cursor =
            "crosshair";

        showError(
            state.picking ===
                "start"
                ? "Klikni na mapu da izabereš polaznu tačku."
                : "Klikni na mapu da izabereš odredište."
        );
    }

    // ============================================================
    // FIT ROUTE
    // ============================================================

    function fitRoute() {
        if (
            !state.map
        ) {
            return;
        }

        const points =
            state.routeCoordinates.length
                ? state.routeCoordinates
                : [
                    state.start
                        ? [
                            state.start.latitude,
                            state.start.longitude
                        ]
                        : null,

                    state.destination
                        ? [
                            state.destination.latitude,
                            state.destination.longitude
                        ]
                        : null
                ].filter(
                    Boolean
                );

        if (
            !points.length
        ) {
            return;
        }

        state.map.fitBounds(
            L.latLngBounds(
                points
            ),
            {
                padding: [
                    30,
                    30
                ],

                maxZoom:
                    state.routeCoordinates
                        .length
                        ? undefined
                        : 14
            }
        );

        setTimeout(
            () =>
                syncTomTomBackground(),
            50
        );
    }

    // ============================================================
    // GPS
    // ============================================================

    function centerGps() {
        const position =
            getCurrentGpsPosition();

        if (
            !position ||
            !state.map
        ) {
            showError(
                "GPS trenutno nema dostupnu poziciju."
            );

            return;
        }

        state.liveFollow =
            true;

        state.map.setView(
            [
                position.latitude,
                position.longitude
            ],
            Math.max(
                17,
                state.map.getZoom() ||
                17
            ),
            {
                animate:
                    true
            }
        );
    }

    function updateGpsMarker(
        position
    ) {
        if (
            !state.map
        ) {
            return;
        }

        const latitude =
            Number(
                position?.latitude ??
                position?.coords?.latitude
            );

        const longitude =
            Number(
                position?.longitude ??
                position?.coords?.longitude
            );

        if (
            !Number.isFinite(
                latitude
            ) ||
            !Number.isFinite(
                longitude
            )
        ) {
            return;
        }

        if (
            !state.gpsMarker
        ) {
            state.gpsMarker =
                L.circleMarker(
                    [
                        latitude,
                        longitude
                    ],
                    {
                        radius:
                            8,

                        weight:
                            3,

                        fillOpacity:
                            0.9
                    }
                ).addTo(
                    state.map
                );
        }
        else {
            state.gpsMarker.setLatLng(
                [
                    latitude,
                    longitude
                ]
            );
        }

        const speed =
            Number(
                position?.speed ??
                position?.coords?.speed
            );

        const accuracy =
            Number(
                position?.accuracy ??
                position?.coords?.accuracy
            );

        setGpsStatus(
            "ON",
            "ready"
        );

        setText(
            "liveChip",
            "GPS ON"
        );

        setText(
            "liveSpeed",
            Number.isFinite(
                speed
            )
                ? `${Math.round(
                    speed * 3.6
                )} km/h`
                : "—"
        );

        setText(
            "liveAccuracy",
            Number.isFinite(
                accuracy
            )
                ? `±${Math.round(
                    accuracy
                )} m`
                : "—"
        );

        setText(
            "livePosition",
            `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
        );

        const offRoute =
            distanceToRouteMeters(
                latitude,
                longitude
            );

        setText(
            "liveOffRoute",
            offRoute == null
                ? "—"
                : offRoute > 100
                    ? `DA · ${Math.round(
                        offRoute
                    )} m`
                    : "NE"
        );

        if (
            state.live &&
            state.liveFollow
        ) {
            state.map.panTo(
                [
                    latitude,
                    longitude
                ],
                {
                    animate:
                        true,

                    duration:
                        0.3
                }
            );
        }

        if (
            state.live &&
            state.routeResponse &&
            offRoute != null &&
            offRoute > 100 &&
            Date.now() -
            state.lastRerouteAt >
            30000
        ) {
            state.lastRerouteAt =
                Date.now();

            state.start = {
                latitude,
                longitude,
                label:
                    "Trenutna GPS lokacija"
            };

            if (
                $("navStart")
            ) {
                $("navStart").value =
                    `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
            }

            setText(
                "navStartResolved",
                "Trenutna GPS lokacija"
            );

            calculateRoute({
                silent:
                    true
            });
        }
    }

    function gpsErrorMessage(
        error
    ) {
        switch (
        error?.code
        ) {
            case 1:
                return "GPS dozvola je odbijena.";

            case 2:
                return "GPS lokacija trenutno nije dostupna.";

            case 3:
                return "GPS zahtev je istekao.";

            default:
                return "Greška pri čitanju GPS lokacije.";
        }
    }

    async function startLiveNavigation() {
        if (
            !window.ProMap.Gps
                ?.isSupported?.()
        ) {
            showError(
                "Browser ne podržava GPS geolokaciju."
            );

            return;
        }

        if (
            !state.routeResponse
        ) {
            const ok =
                await calculateRoute();

            if (
                !ok ||
                !state.routeResponse
            ) {
                showError(
                    "Ruta nije izračunata. Prvo izračunaj rutu."
                );

                return;
            }
        }

        window.ProMap.Gps.stop();

        state.live =
            true;

        state.liveFollow =
            true;

        state.lastRerouteAt =
            0;

        setHidden(
            "startLiveNavigation",
            true
        );

        setHidden(
            "stopLiveNavigation",
            false
        );

        setGpsStatus(
            "STARTING",
            "warning"
        );

        setText(
            "liveChip",
            "GPS STARTING"
        );

        window.ProMap.Gps.start({
            enableHighAccuracy:
                true,

            maximumAge:
                2000,

            timeout:
                15000,

            onPosition:
                updateGpsMarker,

            onError:
                (
                    error
                ) => {
                    console.warn(
                        "[ProMap Navigation] GPS error:",
                        error
                    );

                    showError(
                        gpsErrorMessage(
                            error
                        )
                    );

                    setGpsStatus(
                        "ERROR",
                        "danger"
                    );

                    setText(
                        "liveChip",
                        "GPS ERROR"
                    );
                }
        });
    }

    function stopLiveNavigation() {
        window.ProMap.Gps
            ?.stop?.();

        state.live =
            false;

        state.liveFollow =
            true;

        setHidden(
            "startLiveNavigation",
            false
        );

        setHidden(
            "stopLiveNavigation",
            true
        );

        setGpsStatus(
            "OFF"
        );

        setText(
            "liveChip",
            "GPS OFF"
        );

        setText(
            "liveSpeed",
            "0 km/h"
        );

        setText(
            "liveAccuracy",
            "—"
        );

        setText(
            "liveOffRoute",
            "NE"
        );

        setText(
            "livePosition",
            "Lokacija nije aktivna"
        );
    }

    function useCurrentLocation() {
        if (
            !navigator.geolocation
        ) {
            showError(
                "Browser ne podržava GPS geolokaciju."
            );

            return;
        }

        setGpsStatus(
            "LOCATING",
            "warning"
        );

        navigator.geolocation.getCurrentPosition(
            (
                position
            ) => {
                const point = {
                    latitude:
                        position.coords
                            .latitude,

                    longitude:
                        position.coords
                            .longitude,

                    label:
                        "Moja trenutna lokacija"
                };

                if (
                    $("navStart")
                ) {
                    $("navStart").value =
                        `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`;
                }

                setStart(
                    point
                );

                setGpsStatus(
                    "READY",
                    "ready"
                );

                state.map?.setView(
                    [
                        point.latitude,
                        point.longitude
                    ],
                    14
                );
            },

            (
                error
            ) => {
                showError(
                    gpsErrorMessage(
                        error
                    )
                );

                setGpsStatus(
                    "ERROR",
                    "danger"
                );
            },

            {
                enableHighAccuracy:
                    true,

                maximumAge:
                    5000,

                timeout:
                    15000
            }
        );
    }

    // ============================================================
    // DEFAULTS
    // ============================================================

    function initializeDefaults() {
        if (
            $("navStart")
        ) {
            $("navStart").value =
                $("navStart").value.trim() ||
                DEFAULTS.start.label;
        }

        if (
            $("navEnd")
        ) {
            $("navEnd").value =
                $("navEnd").value.trim() ||
                DEFAULTS.destination.label;
        }

        setStart(
            DEFAULTS.start
        );

        setDestination(
            DEFAULTS.destination
        );

        applyPreset(
            $("truckPreset")
                ?.value ||
            "40t"
        );

        setProfile(
            "truck"
        );

        setGpsStatus(
            "OFF"
        );

        setText(
            "engineHeader",
            "POSTGIS"
        );

        setText(
            "summaryEngine",
            "—"
        );

        setText(
            "liveChip",
            "GPS OFF"
        );

        setText(
            "liveSpeed",
            "0 km/h"
        );

        setText(
            "liveAccuracy",
            "—"
        );

        setText(
            "liveOffRoute",
            "NE"
        );

        setText(
            "livePosition",
            "Lokacija nije aktivna"
        );
    }

    // ============================================================
    // EVENTS
    // ============================================================

    function bindEvents() {
        $("calcRoute")
            ?.addEventListener(
                "click",
                () =>
                    calculateRoute()
            );

        $("swapPoints")
            ?.addEventListener(
                "click",
                swapPoints
            );

        $("truckMode")
            ?.addEventListener(
                "click",
                () =>
                    setProfile(
                        "truck"
                    )
            );

        $("carMode")
            ?.addEventListener(
                "click",
                () =>
                    setProfile(
                        "car"
                    )
            );

        $("truckPreset")
            ?.addEventListener(
                "change",
                (
                    event
                ) =>
                    applyPreset(
                        event.target.value
                    )
            );

        $("useCurrentLocation")
            ?.addEventListener(
                "click",
                useCurrentLocation
            );

        $("fitRoute")
            ?.addEventListener(
                "click",
                fitRoute
            );

        $("centerGps")
            ?.addEventListener(
                "click",
                centerGps
            );

        $("pickStart")
            ?.addEventListener(
                "click",
                () =>
                    activateMapPick(
                        "start"
                    )
            );

        $("pickEnd")
            ?.addEventListener(
                "click",
                () =>
                    activateMapPick(
                        "destination"
                    )
            );

        $("startLiveNavigation")
            ?.addEventListener(
                "click",
                startLiveNavigation
            );

        $("stopLiveNavigation")
            ?.addEventListener(
                "click",
                stopLiveNavigation
            );

        $("mapRouteTab")
            ?.addEventListener(
                "click",
                () =>
                    fitRoute()
            );

        $("mapGpsTab")
            ?.addEventListener(
                "click",
                () =>
                    centerGps()
            );

        $("mapRestrictionsTab")
            ?.addEventListener(
                "click",
                () => {
                    const card =
                        $("warningsCard");

                    if (
                        card &&
                        !card.hidden
                    ) {
                        card.scrollIntoView({
                            behavior:
                                "smooth",

                            block:
                                "nearest"
                        });
                    }
                }
            );

        $("navStart")
            ?.addEventListener(
                "input",
                () =>
                    scheduleGeocode(
                        "start"
                    )
            );

        $("navEnd")
            ?.addEventListener(
                "input",
                () =>
                    scheduleGeocode(
                        "end"
                    )
            );

        $("navStart")
            ?.addEventListener(
                "keydown",
                async (
                    event
                ) => {
                    if (
                        event.key !==
                        "Enter"
                    ) {
                        return;
                    }

                    event.preventDefault();

                    try {
                        await resolveInput(
                            "start"
                        );

                        clearSuggestions(
                            "start"
                        );
                    }
                    catch (
                    error
                    ) {
                        showError(
                            error?.message ||
                            "Start nije moguće pronaći."
                        );
                    }
                }
            );

        $("navEnd")
            ?.addEventListener(
                "keydown",
                async (
                    event
                ) => {
                    if (
                        event.key !==
                        "Enter"
                    ) {
                        return;
                    }

                    event.preventDefault();

                    try {
                        await resolveInput(
                            "end"
                        );

                        clearSuggestions(
                            "end"
                        );
                    }
                    catch (
                    error
                    ) {
                        showError(
                            error?.message ||
                            "Odredište nije moguće pronaći."
                        );
                    }
                }
            );

        document.addEventListener(
            "click",
            (
                event
            ) => {
                if (
                    !event.target.closest(
                        ".nav-input-wrapper"
                    )
                ) {
                    clearSuggestions(
                        "start"
                    );

                    clearSuggestions(
                        "end"
                    );
                }
            }
        );

        window.addEventListener(
            "resize",
            () => {
                state.map
                    ?.invalidateSize();

                state.tomTomMap
                    ?.resize();
            }
        );
    }

    // ============================================================
    // INIT
    // ============================================================

    function init() {
        initializeMap();

        initializeDefaults();

        bindEvents();

        setTimeout(
            () => {
                state.map
                    ?.invalidateSize();

                syncTomTomBackground();

                fitRoute();
            },
            250
        );
    }

    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            init,
            {
                once: true
            }
        );
    }
    else {
        init();
    }
})();