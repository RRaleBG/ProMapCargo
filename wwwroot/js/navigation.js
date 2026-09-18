"use strict";

window.ProMap = window.ProMap || {};

(() => {
    if (window.__promapNavigationInitialized) {
        return;
    }

    const root = document.querySelector('[data-module="navigation"]');
    if (!root) {
        return;
    }

    window.__promapNavigationInitialized = true;

    const $ = (id) => document.getElementById(id);

    const state = {
        map: null,
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
        routeProgressMeters: 0,
        routeCumulativeDistances: [],
        liveFollow: true,
        profile: "truck",
        picking: null,
        geocodeTimers: { start: null, end: null },
        routing: false,
        live: false,
        lastRerouteAt: 0,
    };

    const DEFAULTS = {
        start: {
            latitude: 44.8178,
            longitude: 20.4573,
            label: "Beograd, Srbija",
        },
        destination: {
            latitude: 45.2551,
            longitude: 19.8335,
            label: "Novi Sad, Srbija",
        },
    };

    const PRESETS = {
        "40t": {
            weight: 40,
            height: 4.0,
            width: 2.55,
            length: 16.5,
            axleLoad: 10,
            axles: 5,
            maxSpeed: 90,
        },
        "12t": {
            weight: 12,
            height: 3.8,
            width: 2.55,
            length: 12.0,
            axleLoad: 8,
            axles: 3,
            maxSpeed: 90,
        },
        "7.5t": {
            weight: 7.5,
            height: 3.5,
            width: 2.5,
            length: 9.0,
            axleLoad: 7,
            axles: 2,
            maxSpeed: 90,
        },
        "3.5t": {
            weight: 3.5,
            height: 3.2,
            width: 2.2,
            length: 7.0,
            axleLoad: 4,
            axles: 2,
            maxSpeed: 90,
        },
    };

    function setText(id, value) {
        const element = $(id);

        if (element) {
            element.textContent = value ?? "";
        }
    }

    function setHidden(id, hidden) {
        const element = $(id);

        if (element) {
            element.hidden = hidden;
        }
    }

    function numberValue(id, fallback) {
        const element = $(id);

        if (!element) {
            return fallback;
        }

        const value = Number.parseFloat(element.value);

        return Number.isFinite(value) ? value : fallback;
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

    function setGpsStatus(text, kind = "") {
        const element = $("gpsStatus");

        if (!element) {
            return;
        }

        element.textContent = text;

        element.classList.remove("ready", "warning", "danger");

        if (kind) {
            element.classList.add(kind);
        }
    }

    function setEngine(engine, usedFallback = false) {
        const normalized = String(engine || "PostGIS");

        const summary = usedFallback ? `${normalized} · FALLBACK` : normalized;

        setText("engineHeader", normalized.toUpperCase());

        setText("summaryEngine", summary);

        const badge = $("engineBadge");

        if (badge) {
            badge.classList.remove("error");
            badge.classList.add("ready");

            badge.innerHTML = `<span></span>${escapeHtml(summary.toUpperCase())}`;
        }

        setText("diagnosticEngine", normalized);

        setText("diagnosticFallback", usedFallback ? "DA" : "NE");
    }

    function setRoutingUi(routing) {
        state.routing = routing;

        const button = $("calcRoute");

        if (!button) {
            return;
        }

        button.disabled = routing;

        const label = button.querySelector("strong");

        if (label) {
            if (routing) {
                label.textContent = "Računam rutu…";
            } else {
                label.textContent =
                    state.profile === "truck"
                        ? "Izračunaj truck rutu"
                        : "Izračunaj auto rutu";
            }
        }
    }

    function formatDistance(meters) {
        const value = Number(meters);

        if (!Number.isFinite(value)) {
            return "—";
        }

        if (window.ProMap.Maneuvers?.formatDistance) {
            return window.ProMap.Maneuvers.formatDistance(value);
        }

        if (value >= 1000) {
            return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} km`;
        }

        return `${Math.round(value)} m`;
    }

    function formatDuration(seconds) {
        const value = Number(seconds);

        if (!Number.isFinite(value)) {
            return "—";
        }

        if (window.ProMap.Maneuvers?.formatDuration) {
            return window.ProMap.Maneuvers.formatDuration(value);
        }

        const minutes = Math.max(0, Math.round(value / 60));

        const hours = Math.floor(minutes / 60);

        const remainder = minutes % 60;

        return hours > 0
            ? `${hours} h ${String(remainder).padStart(2, "0")} min`
            : `${minutes} min`;
    }

    function formatEta(value, durationSeconds = null) {
        let date = null;

        if (value) {
            date = new Date(value);
        } else if (Number.isFinite(Number(durationSeconds))) {
            date = new Date(Date.now() + Number(durationSeconds) * 1000);
        }

        if (!date || Number.isNaN(date.getTime())) {
            return "—";
        }

        return new Intl.DateTimeFormat("sr-RS", {
            hour: "2-digit",
            minute: "2-digit",
        }).format(date);
    }

    function normalizePoint(point) {
        if (!point) {
            return null;
        }

        const latitude = Number(point.latitude ?? point.lat ?? point.Lat);

        const longitude = Number(point.longitude ?? point.lon ?? point.Lon);

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
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
                "",
        };
    }

    function parseCoordinateText(value) {
        const text = String(value || "").trim();

        const match = text.match(
            /^\s*(-?\d+(?:[.,]\d+)?)\s*[,;]\s*(-?\d+(?:[.,]\d+)?)\s*$/,
        );

        if (!match) {
            return null;
        }

        return normalizePoint({
            latitude: Number(match[1].replace(",", ".")),
            longitude: Number(match[2].replace(",", ".")),
        });
    }

    function geometryToLatLngs(geometry) {
        if (!geometry) {
            return [];
        }

        let value = geometry;

        if (typeof value === "string") {
            try {
                value = JSON.parse(value);
            } catch {
                return [];
            }
        }

        if (value?.type === "Feature") {
            value = value.geometry;
        }

        if (!value || !value.type || !Array.isArray(value.coordinates)) {
            return [];
        }

        if (value.type === "LineString") {
            return value.coordinates
                .filter((point) => Array.isArray(point) && point.length >= 2)
                .map((point) => [Number(point[1]), Number(point[0])])
                .filter(
                    (point) => Number.isFinite(point[0]) && Number.isFinite(point[1]),
                );
        }

        if (value.type === "MultiLineString") {
            return value.coordinates
                .flatMap((line) =>
                    Array.isArray(line)
                        ? line
                            .filter((point) => Array.isArray(point) && point.length >= 2)
                            .map((point) => [Number(point[1]), Number(point[0])])
                        : [],
                )
                .filter(
                    (point) => Number.isFinite(point[0]) && Number.isFinite(point[1]),
                );
        }

        return [];
    }

    function haversineMeters(aLat, aLon, bLat, bLon) {
        const earth = 6371000;

        const dLat = ((bLat - aLat) * Math.PI) / 180;

        const dLon = ((bLon - aLon) * Math.PI) / 180;

        const lat1 = (aLat * Math.PI) / 180;

        const lat2 = (bLat * Math.PI) / 180;

        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

        return 2 * earth * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function distanceToRouteMeters(latitude, longitude) {
        if (!state.routeCoordinates.length) {
            return null;
        }

        let best = Infinity;

        for (const point of state.routeCoordinates) {
            best = Math.min(
                best,
                haversineMeters(latitude, longitude, point[0], point[1]),
            );
        }

        return Number.isFinite(best) ? best : null;
    }

    function distanceToManeuverMeters(position, maneuver) {
        if (!position || !maneuver) {
            return null;
        }

        const latitude = Number(maneuver.latitude);

        const longitude = Number(maneuver.longitude);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return null;
        }

        return haversineMeters(
            Number(position.latitude),
            Number(position.longitude),
            latitude,
            longitude,
        );
    }

    function getCurrentGpsPosition() {
        const position = window.ProMap.Gps?.getPosition?.();

        if (!position) {
            return null;
        }

        const latitude = Number(position.latitude ?? position.coords?.latitude);

        const longitude = Number(position.longitude ?? position.coords?.longitude);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return null;
        }

        return {
            latitude,
            longitude,
            accuracy: Number(position.accuracy ?? position.coords?.accuracy),
            heading: Number(position.heading ?? position.coords?.heading),
            speed: Number(position.speed ?? position.coords?.speed),
            timestamp: position.timestamp ?? position.coords?.timestamp,
        };
    }


    function initializeMap() {
        if (!$("navMap")) {
            return;
        }

        if (!window.L) {
            showError(
                "Leaflet nije učitan. Proveri _Layout.cshtml."
            );

            return;
        }

        if (state.map) {
            return;
        }

        state.map = L.map(
            "navMap",
            {
                zoomControl: true,
                preferCanvas: true
            }
        ).setView(
            [44.9, 20.5],
            8
        );

        state.map.on(
            "dragstart",
            () => {
                if (state.live) {
                    state.liveFollow = false;
                }
            }
        );

        state.map.on(
            "click",
            event => {
                if (!state.picking) {
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
                    $("navStart").value =
                        point.label;

                    setStart(point);
                }
                else {
                    $("navEnd").value =
                        point.label;

                    setDestination(point);
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

        setTimeout(
            () =>
                state.map?.invalidateSize(),
            150
        );
    }


    function setStart(point) {
        const normalized = normalizePoint(point);

        if (!normalized) {
            return false;
        }

        state.start = normalized;

        if ($("navStartResolved")) {
            $("navStartResolved").textContent =
                normalized.label ||
                `${normalized.latitude.toFixed(6)}, ${normalized.longitude.toFixed(6)}`;
        }

        if (state.map) {
            if (state.startMarker) {
                state.startMarker.remove();
            }

            state.startMarker = L.marker([normalized.latitude, normalized.longitude])
                .addTo(state.map)
                .bindPopup(
                    `<strong>START</strong><br>${escapeHtml(
                        normalized.label ||
                        `${normalized.latitude.toFixed(6)}, ${normalized.longitude.toFixed(6)}`,
                    )}`,
                );
        }

        return true;
    }

    function setDestination(point) {
        const normalized = normalizePoint(point);

        if (!normalized) {
            return false;
        }

        state.destination = normalized;

        if ($("navEndResolved")) {
            $("navEndResolved").textContent =
                normalized.label ||
                `${normalized.latitude.toFixed(6)}, ${normalized.longitude.toFixed(6)}`;
        }

        if (state.map) {
            if (state.destinationMarker) {
                state.destinationMarker.remove();
            }

            state.destinationMarker = L.marker([
                normalized.latitude,
                normalized.longitude,
            ])
                .addTo(state.map)
                .bindPopup(
                    `<strong>ODREDIŠTE</strong><br>${escapeHtml(
                        normalized.label ||
                        `${normalized.latitude.toFixed(6)}, ${normalized.longitude.toFixed(6)}`,
                    )}`,
                );
        }

        return true;
    }

    async function geocode(query) {
        const response = await fetch(
            `/api/geocode?q=${encodeURIComponent(query)}&limit=5`,
            {
                headers: {
                    Accept: "application/json",
                },
            },
        );

        let payload = null;

        try {
            payload = await response.json();
        } catch {
            payload = null;
        }

        if (!response.ok) {
            throw new Error(
                payload?.message || `Geocoding API HTTP ${response.status}`,
            );
        }

        return Array.isArray(payload) ? payload : [];
    }

    function clearSuggestions(target) {
        const box = $(
            target === "start" ? "navStartSuggestions" : "navEndSuggestions",
        );

        if (box) {
            box.innerHTML = "";
        }
    }

    function renderSuggestions(target, items) {
        const box = $(
            target === "start" ? "navStartSuggestions" : "navEndSuggestions",
        );

        if (!box) {
            return;
        }

        box.innerHTML = "";

        for (const item of items.slice(0, 5)) {
            const point = normalizePoint(item);

            if (!point) {
                continue;
            }

            const button = document.createElement("button");

            button.type = "button";
            button.className = "nav-suggestion";

            const display =
                point.label ||
                `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`;

            button.textContent = display;

            button.addEventListener("click", () => {
                if (target === "start") {
                    $("navStart").value = display;

                    setStart({
                        ...point,
                        label: display,
                    });
                } else {
                    $("navEnd").value = display;

                    setDestination({
                        ...point,
                        label: display,
                    });
                }

                clearSuggestions(target);
                showError("");
            });

            box.appendChild(button);
        }
    }

    function scheduleGeocode(target) {
        const input = $(target === "start" ? "navStart" : "navEnd");

        if (!input) {
            return;
        }

        clearTimeout(state.geocodeTimers[target]);

        const value = input.value.trim();

        if (target === "start") {
            state.start = null;

            if ($("navStartResolved")) {
                $("navStartResolved").textContent = "Nije još potvrđeno";
            }
        } else {
            state.destination = null;

            if ($("navEndResolved")) {
                $("navEndResolved").textContent = "Nije još potvrđeno";
            }
        }

        const coordinate = parseCoordinateText(value);

        if (coordinate) {
            if (target === "start") {
                setStart({
                    ...coordinate,
                    label: `${coordinate.latitude.toFixed(6)}, ${coordinate.longitude.toFixed(6)}`,
                });
            } else {
                setDestination({
                    ...coordinate,
                    label: `${coordinate.latitude.toFixed(6)}, ${coordinate.longitude.toFixed(6)}`,
                });
            }

            clearSuggestions(target);
            return;
        }

        if (value.length < 2) {
            clearSuggestions(target);
            return;
        }

        state.geocodeTimers[target] = window.setTimeout(async () => {
            try {
                const items = await geocode(value);

                renderSuggestions(target, items);
            } catch (error) {
                console.warn("Geocoding error:", error);
            }
        }, 300);
    }

    async function resolveInput(target) {
        const input = $(target === "start" ? "navStart" : "navEnd");

        if (!input) {
            return false;
        }

        const value = input.value.trim();

        const coordinate = parseCoordinateText(value);

        if (coordinate) {
            const resolved = {
                ...coordinate,
                label: `${coordinate.latitude.toFixed(6)}, ${coordinate.longitude.toFixed(6)}`,
            };

            if (target === "start") {
                return setStart(resolved);
            }

            return setDestination(resolved);
        }

        if (value.length < 2) {
            return false;
        }

        const items = await geocode(value);

        const point = normalizePoint(items[0]);

        if (!point) {
            return false;
        }

        const display =
            point.label ||
            `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`;

        input.value = display;

        if (target === "start") {
            return setStart({
                ...point,
                label: display,
            });
        }

        return setDestination({
            ...point,
            label: display,
        });
    }

    function truckFromForm() {
        return {
            grossWeightT: numberValue("navWeight", 40),

            heightM: numberValue("navHeight", 4),

            widthM: numberValue("navWidth", 2.55),

            lengthM: numberValue("navLength", 16.5),

            axleLoadT: numberValue("navAxleLoad", 10),

            axles: Math.max(1, Math.round(numberValue("navAxles", 5))),

            maxSpeedKmh: numberValue("navMaxSpeed", 90),

            isHgv: true,
            commercial: true,

            hazmat: $("navHazmat")?.checked ?? false,

            adrClass: $("navAdrClass")?.value?.trim() || null,

            goods: null,
            vehicleClass: "HeavyGoods",
        };
    }

    function validateTruck() {
        if (state.profile !== "truck") {
            return null;
        }

        const checks = [
            ["navWeight", "Masa"],
            ["navHeight", "Visina"],
            ["navWidth", "Širina"],
            ["navLength", "Dužina"],
            ["navAxleLoad", "Osovinsko opterećenje"],
            ["navAxles", "Broj osovina"],
            ["navMaxSpeed", "Maksimalna brzina"],
        ];

        for (const [id, label] of checks) {
            const value = numberValue(id, NaN);

            if (!Number.isFinite(value) || value <= 0) {
                return `${label} mora biti veća od 0.`;
            }
        }

        return null;
    }

    function requestState() {
        return {
            start: state.start,

            destination: state.destination,

            profile: state.profile,

            avoidRestricted: $("navAvoid")?.checked ?? true,

            departureAt: new Date().toISOString(),

            truck: state.profile === "truck" ? truckFromForm() : null,
        };
    }

    function clearRouteLayers() {
        for (const layer of state.routeLayers) {
            try {
                layer.remove();
            } catch { }
        }

        state.routeLayers = [];
        state.routeCoordinates = [];
        state.routeCumulativeDistances = [];
    }

    function clearRouteResult() {
        clearRouteLayers();

        state.routeResponse = null;
        state.selectedRouteIndex = 0;
        state.maneuvers = [];
        state.maneuverIndex = 0;
        state.routeProgressMeters = 0;

        setText("summaryDistance", "—");

        setText("summaryDuration", "—");

        setText("summaryEta", "—");

        setText("summarySafety", "READY");

        setText("summaryDiagnostics", "—");

        setText("mapDistance", "—");

        setText("mapDuration", "—");

        setText("mapEta", "—");

        setText(
            "routeSafeBadge",
            state.profile === "truck" ? "TRUCK SAFE" : "CAR ROUTE",
        );

        setText("nextInstructionIcon", "↑");

        setText("nextInstructionText", "—");

        setText("nextInstructionDistance", "—");

        setText("alternativeCount", "0");

        setText("warningCount", "0");

        setText("maneuverCount", "0");

        if ($("routeAlternatives")) {
            $("routeAlternatives").innerHTML = "";
        }

        if ($("routeWarnings")) {
            $("routeWarnings").innerHTML = "";
        }

        if ($("maneuverList")) {
            $("maneuverList").innerHTML = "";
        }

        setHidden("mapRouteCard", true);

        setHidden("nextInstruction", true);

        setHidden("alternativesCard", true);

        setHidden("warningsCard", true);

        setHidden("maneuversCard", true);

        setText("diagnosticEngine", "—");

        setText("diagnosticGraph", "—");

        setText("diagnosticStates", "—");

        setText("diagnosticFallback", "—");

        showError("");
    }

    function selectedRoute() {
        const routes = state.routeResponse?.routes;

        if (!Array.isArray(routes) || routes.length === 0) {
            return null;
        }

        return routes[state.selectedRouteIndex] || routes[0];
    }

    function updateRouteLayerStyles() {
        for (const entry of state.routeLayers) {
            entry.layer.setStyle({
                weight: entry.index === state.selectedRouteIndex ? 7 : 4,

                opacity: entry.index === state.selectedRouteIndex ? 0.95 : 0.35,
            });

            if (entry.index === state.selectedRouteIndex) {
                entry.layer.bringToFront();
            }
        }
    }

    function routeViolations(route) {
        if (Array.isArray(route?.analysis?.violations)) {
            return route.analysis.violations;
        }

        if (Array.isArray(state.routeResponse?.violations)) {
            return state.routeResponse.violations;
        }

        return [];
    }

    function renderWarnings(violations) {
        const box = $("routeWarnings");

        if (!box) {
            return;
        }

        const items = Array.isArray(violations) ? violations : [];

        box.innerHTML = "";

        for (const item of items) {
            const row = document.createElement("div");

            row.className = "nav-list-item";

            row.innerHTML = `
                <span>${escapeHtml(item.type || "Restriction")}</span>
                <strong>${escapeHtml(item.name || item.id || "Ograničenje")}</strong>
                <small>${escapeHtml(item.reason || "Aktivno ograničenje na izabranoj ruti.")}</small>
            `;

            box.appendChild(row);
        }

        setText("warningCount", String(items.length));

        setHidden("warningsCard", items.length === 0);
    }

    function maneuverIcon(type, modifier) {
        const t = String(type || "").toLowerCase();

        const m = String(modifier || "").toLowerCase();

        if (t === "arrive") {
            return "●";
        }

        if (t === "depart") {
            return "↑";
        }

        if (t === "roundabout" || t === "rotary") {
            return "⟳";
        }

        if (m.includes("uturn")) {
            return "↶";
        }

        if (m.includes("sharp left")) {
            return "↙";
        }

        if (m === "left") {
            return "↰";
        }

        if (m.includes("slight left")) {
            return "↖";
        }

        if (m.includes("sharp right")) {
            return "↘";
        }

        if (m === "right") {
            return "↱";
        }

        if (m.includes("slight right")) {
            return "↗";
        }

        if (m === "straight") {
            return "↑";
        }

        return "↑";
    }

    function buildManeuverInstruction(type, modifier, roadName, roundaboutExit) {
        const t = String(type || "continue").toLowerCase();

        const m = String(modifier || "").toLowerCase();

        const road = roadName ? ` na ${roadName}` : "";

        if (t === "arrive") {
            return "Stigli ste na odredište";
        }

        if (t === "depart") {
            return roadName ? `Krenite na ${roadName}` : "Krenite pravo";
        }

        if (t === "roundabout" || t === "rotary") {
            return roundaboutExit
                ? `Uđite u kružni tok i izađite na ${roundaboutExit}. izlazu${road}`
                : `Uđite u kružni tok${road}`;
        }

        if (m.includes("uturn")) {
            return `Polukružno okretanje${road}`;
        }

        if (m.includes("sharp left")) {
            return `Oštro levo${road}`;
        }

        if (m === "left") {
            return `Skrenite levo${road}`;
        }

        if (m.includes("slight left")) {
            return `Blago levo${road}`;
        }

        if (m.includes("sharp right")) {
            return `Oštro desno${road}`;
        }

        if (m === "right") {
            return `Skrenite desno${road}`;
        }

        if (m.includes("slight right")) {
            return `Blago desno${road}`;
        }

        return roadName ? `Nastavite pravo na ${roadName}` : "Nastavite pravo";
    }

    function normalizeManeuver(item) {
        if (!item) {
            return null;
        }

        const type = item.type || item.maneuver?.type || "continue";

        const modifier = item.modifier || item.maneuver?.modifier || null;

        const roadName = item.roadName || item.name || null;

        const roundaboutExit = item.roundaboutExit ?? item.maneuver?.exit ?? null;

        const distanceMeters = Number(
            item.distanceMeters ??
            item.distanceFromPreviousMeters ??
            item.distance ??
            0,
        );

        const distanceFromRouteStartMeters = Number(
            item.distanceFromRouteStartMeters ?? item.routeDistanceMeters ?? 0,
        );

        const latitude = Number(item.latitude ?? item.maneuver?.latitude);

        const longitude = Number(item.longitude ?? item.maneuver?.longitude);

        const prepared = {
            ...item,

            type,

            modifier,

            roadName,

            roundaboutExit,

            distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : 0,

            distanceFromRouteStartMeters: Number.isFinite(
                distanceFromRouteStartMeters,
            )
                ? distanceFromRouteStartMeters
                : 0,

            latitude: Number.isFinite(latitude) ? latitude : null,

            longitude: Number.isFinite(longitude) ? longitude : null,

            icon: item.icon || maneuverIcon(type, modifier),

            instruction:
                item.instruction ||
                buildManeuverInstruction(type, modifier, roadName, roundaboutExit),
        };

        if (window.ProMap.Maneuvers?.normalize) {
            const normalized = window.ProMap.Maneuvers.normalize(prepared);

            return {
                ...prepared,
                ...normalized,

                icon: normalized?.icon || prepared.icon,

                instruction: normalized?.instruction || prepared.instruction,
            };
        }

        return prepared;
    }

    function extractLegManeuvers(legs) {
        const result = [];

        if (!Array.isArray(legs)) {
            return result;
        }

        let cumulativeDistance = 0;

        for (const leg of legs) {
            const steps = Array.isArray(leg?.steps) ? leg.steps : [];

            for (const step of steps) {
                const maneuver = step?.maneuver || {};

                const location = Array.isArray(maneuver.location)
                    ? maneuver.location
                    : Array.isArray(step?.location)
                        ? step.location
                        : null;

                const stepDistance = Number(step?.distance);

                const distanceMeters = Number.isFinite(stepDistance) ? stepDistance : 0;

                const latitude =
                    location && Number.isFinite(Number(location[1]))
                        ? Number(location[1])
                        : null;

                const longitude =
                    location && Number.isFinite(Number(location[0]))
                        ? Number(location[0])
                        : null;

                result.push(
                    normalizeManeuver({
                        type: maneuver.type || "continue",

                        modifier: maneuver.modifier || null,

                        instruction: step.instruction || null,

                        distanceMeters,

                        distanceFromRouteStartMeters: cumulativeDistance,

                        latitude,

                        longitude,

                        roadName: step.name || null,

                        roadRef: step.ref || null,

                        roundaboutExit: maneuver.exit ?? null,
                    }),
                );

                cumulativeDistance += distanceMeters;
            }
        }

        return result.filter(Boolean);
    }

    function buildRouteCumulativeDistances() {
        state.routeCumulativeDistances = [];

        if (
            !Array.isArray(state.routeCoordinates) ||
            state.routeCoordinates.length === 0
        ) {
            return;
        }

        state.routeCumulativeDistances = new Array(
            state.routeCoordinates.length,
        ).fill(0);

        for (let i = 1; i < state.routeCoordinates.length; i++) {
            state.routeCumulativeDistances[i] =
                state.routeCumulativeDistances[i - 1] +
                haversineMeters(
                    state.routeCoordinates[i - 1][0],
                    state.routeCoordinates[i - 1][1],
                    state.routeCoordinates[i][0],
                    state.routeCoordinates[i][1],
                );
        }
    }

    function routeProgressFromPosition(position) {
        if (!position || state.routeCoordinates.length < 2) {
            return null;
        }

        const lat = Number(position.latitude);

        const lon = Number(position.longitude);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            return null;
        }

        let bestDistance = Infinity;
        let bestProgress = 0;

        for (let i = 0; i < state.routeCoordinates.length; i++) {
            const point = state.routeCoordinates[i];

            const d = haversineMeters(lat, lon, point[0], point[1]);

            if (d < bestDistance) {
                bestDistance = d;

                bestProgress = state.routeCumulativeDistances[i] ?? 0;
            }
        }

        state.routeProgressMeters = bestProgress;

        return bestProgress;
    }

    function getNextManeuver(position = getCurrentGpsPosition()) {
        if (!Array.isArray(state.maneuvers) || state.maneuvers.length === 0) {
            return null;
        }

        if (!position) {
            const first =
                state.maneuvers.find((m) => m.type !== "depart") || state.maneuvers[0];

            return first;
        }

        const progress = routeProgressFromPosition(position);

        if (progress == null) {
            return state.maneuvers[state.maneuverIndex] || state.maneuvers[0];
        }

        const passedTolerance = 18;

        while (
            state.maneuverIndex < state.maneuvers.length - 1 &&
            Number(
                state.maneuvers[state.maneuverIndex].distanceFromRouteStartMeters || 0,
            ) <
            progress - passedTolerance
        ) {
            state.maneuverIndex++;
        }

        while (
            state.maneuverIndex < state.maneuvers.length - 1 &&
            state.maneuvers[state.maneuverIndex].type === "depart"
        ) {
            state.maneuverIndex++;
        }

        return (
            state.maneuvers[state.maneuverIndex] ||
            state.maneuvers[state.maneuvers.length - 1]
        );
    }

    function updateNextInstruction(position = getCurrentGpsPosition()) {
        const maneuver = getNextManeuver(position);

        if (!maneuver) {
            setHidden("nextInstruction", true);

            return;
        }

        let distance =
            Number(maneuver.distanceFromRouteStartMeters) -
            Number(state.routeProgressMeters || 0);

        if (!Number.isFinite(distance) || distance < 0) {
            distance = distanceToManeuverMeters(position, maneuver);
        }

        if (!Number.isFinite(distance) || distance < 0) {
            distance = Number(maneuver.distanceMeters) || 0;
        }

        setText(
            "nextInstructionIcon",
            maneuver.icon || maneuverIcon(maneuver.type, maneuver.modifier),
        );

        setText(
            "nextInstructionText",
            maneuver.instruction ||
            buildManeuverInstruction(
                maneuver.type,
                maneuver.modifier,
                maneuver.roadName,
                maneuver.roundaboutExit,
            ),
        );

        setText("nextInstructionDistance", formatDistance(distance));

        setHidden("nextInstruction", false);
    }

    function renderManeuvers(route) {
        const box = $("maneuverList");

        if (!box) {
            return;
        }

        let source = Array.isArray(state.routeResponse?.maneuvers)
            ? state.routeResponse.maneuvers
            : [];

        let legs = route?.legs;

        if (typeof legs === "string") {
            try {
                legs = JSON.parse(legs);
            } catch {
                legs = null;
            }
        }

        if (!source.length) {
            source = extractLegManeuvers(legs);
        }

        const normalized = source
            .map(normalizeManeuver)
            .filter(Boolean)
            .sort(
                (a, b) =>
                    Number(a.distanceFromRouteStartMeters || 0) -
                    Number(b.distanceFromRouteStartMeters || 0),
            );

        state.maneuvers = normalized;

        state.maneuverIndex = normalized.findIndex(
            (item) => item.type !== "depart",
        );

        if (state.maneuverIndex < 0) {
            state.maneuverIndex = 0;
        }

        state.routeProgressMeters = 0;

        box.innerHTML = "";

        for (const item of normalized.slice(0, 100)) {
            const row = document.createElement("div");

            row.className = "nav-list-item";

            row.innerHTML = `
                <span>${escapeHtml(item.icon || "↑")}</span>
                <strong>${escapeHtml(item.instruction || "Nastavi pravo")}</strong>
                <small>${escapeHtml(formatDistance(item.distanceMeters))}</small>
            `;

            box.appendChild(row);
        }

        setText("maneuverCount", String(normalized.length));

        setHidden("maneuversCard", normalized.length === 0);

        updateNextInstruction();
    }

    function renderAlternatives(routes) {
        const box = $("routeAlternatives");

        if (!box) {
            return;
        }

        box.innerHTML = "";

        if (!Array.isArray(routes) || routes.length <= 1) {
            setText("alternativeCount", "0");

            setHidden("alternativesCard", true);

            return;
        }

        routes.forEach((route, index) => {
            const button = document.createElement("button");

            button.type = "button";
            button.className = "nav-list-item";

            const restricted = Boolean(route?.analysis?.restricted);

            button.innerHTML = `
                    <span>Ruta ${index + 1}${index === state.selectedRouteIndex ? " · izabrana" : ""}</span>
                    <strong>${escapeHtml(formatDistance(route.distance))}</strong>
                    <small>${escapeHtml(formatDuration(route.duration))}${restricted ? " · restrikcija" : ""}</small>
                `;

            button.addEventListener("click", () => {
                selectRoute(index, true);
            });

            box.appendChild(button);
        });

        setText("alternativeCount", String(routes.length));

        setHidden("alternativesCard", false);
    }

    function updateDiagnostics() {
        const diagnostics = state.routeResponse?.diagnostics || {};

        setText("diagnosticEngine", diagnostics.engine || "—");

        setText(
            "diagnosticGraph",
            diagnostics.graphVersion != null ? String(diagnostics.graphVersion) : "—",
        );

        setText(
            "diagnosticStates",
            Number.isFinite(Number(diagnostics.expandedStates))
                ? String(diagnostics.expandedStates)
                : "—",
        );

        setText("diagnosticFallback", diagnostics.usedFallback ? "DA" : "NE");

        setEngine(
            diagnostics.engine || "PostGIS",

            Boolean(diagnostics.usedFallback),
        );
    }

    function updateSelectedRouteUi(route) {
        if (!route) {
            return;
        }

        const response = state.routeResponse || {};

        const summary = response.summary || {};

        const violations = routeViolations(route);

        const restricted =
            Boolean(route?.analysis?.restricted) || violations.length > 0;

        const safe = state.profile !== "truck" || !restricted;

        const distance = Number(route.distance ?? summary.distanceMeters);

        const duration = Number(route.duration ?? summary.durationSeconds);

        const eta =
            summary.estimatedArrival ||
            new Date(Date.now() + Math.max(0, duration || 0) * 1000).toISOString();

        setText("summaryDistance", formatDistance(distance));

        setText("summaryDuration", formatDuration(duration));

        setText("summaryEta", formatEta(eta, duration));

        setText("summarySafety", safe ? "SAFE" : "RESTRIKCIJA");

        setText("mapDistance", formatDistance(distance));

        setText("mapDuration", formatDuration(duration));

        setText("mapEta", formatEta(eta, duration));

        setText(
            "summaryDiagnostics",
            violations.length > 0
                ? `${violations.length} ograničenja`
                : "Bez aktivnih restrikcija",
        );

        setText(
            "routeSafeBadge",
            state.profile === "truck"
                ? safe
                    ? "TRUCK SAFE"
                    : "TRUCK WARNING"
                : "CAR ROUTE",
        );

        const routeStatus = $("mapRouteStatus");

        if (routeStatus) {
            routeStatus.textContent = safe ? "Bezbedna" : "Upozorenje";

            routeStatus.classList.toggle("pm-badge-success", safe);

            routeStatus.classList.toggle("pm-badge-danger", !safe);
        }

        const startLabel = $("navStart")?.value?.trim() || "Start";

        const endLabel = $("navEnd")?.value?.trim() || "Odredište";

        setText("mapRouteTitle", `${startLabel} → ${endLabel}`);

        setHidden("mapRouteCard", false);

        renderWarnings(violations);

        renderManeuvers(route);

        updateDiagnostics();
    }

    function selectRoute(index, fit = false) {
        const routes = state.routeResponse?.routes;

        if (!Array.isArray(routes) || !routes[index]) {
            return;
        }

        state.selectedRouteIndex = index;

        const route = routes[index];

        state.routeCoordinates = geometryToLatLngs(route.geometry);

        buildRouteCumulativeDistances();

        updateRouteLayerStyles();

        updateSelectedRouteUi(route);

        renderAlternatives(routes);

        if (fit && state.routeCoordinates.length > 0 && state.map) {
            state.map.fitBounds(L.latLngBounds(state.routeCoordinates), {
                padding: [30, 30],
            });
        }
    }

    function renderRouteResponse(response) {
        clearRouteLayers();

        if (
            !response ||
            !Array.isArray(response.routes) ||
            response.routes.length === 0
        ) {
            throw new Error("Routing servis nije vratio nijednu rutu.");
        }

        state.routeResponse = response;

        state.maneuverIndex = 0;
        state.routeProgressMeters = 0;

        const requestedIndex = Number(response.selectedRouteIndex ?? 0);

        state.selectedRouteIndex =
            Number.isInteger(requestedIndex) &&
                requestedIndex >= 0 &&
                requestedIndex < response.routes.length
                ? requestedIndex
                : 0;

        response.routes.forEach((route, index) => {
            const coordinates = geometryToLatLngs(route.geometry);

            if (!coordinates.length) {
                return;
            }

            const layer = L.polyline(coordinates, {
                weight: index === state.selectedRouteIndex ? 7 : 4,

                opacity: index === state.selectedRouteIndex ? 0.95 : 0.35,

                className:
                    index === state.selectedRouteIndex
                        ? "pm-route-active"
                        : "pm-route-alternative",
            }).addTo(state.map);

            layer.on("click", () => selectRoute(index, false));

            state.routeLayers.push({
                index,
                layer,
            });
        });

        selectRoute(state.selectedRouteIndex, true);
    }

    async function calculateRoute({ silent = false } = {}) {
        if (state.routing) {
            return;
        }

        showError("");

        try {
            if (!state.start) {
                await resolveInput("start");
            }

            if (!state.destination) {
                await resolveInput("end");
            }
        } catch (error) {
            console.warn("Point resolve error:", error);
        }

        if (!state.start || !state.destination) {
            showError(
                "Izaberi validan start i odredište iz predloga, unesi koordinate ili izaberi tačke na mapi.",
            );

            return;
        }

        const truckError = validateTruck();

        if (truckError) {
            showError(truckError);

            return;
        }

        const directDistance = haversineMeters(
            state.start.latitude,
            state.start.longitude,
            state.destination.latitude,
            state.destination.longitude,
        );

        if (directDistance < 10) {
            showError("Start i odredište su preblizu.");

            return;
        }

        if (!window.ProMap.Routing?.calculate) {
            showError("Routing JS modul nije učitan.");

            return;
        }

        setRoutingUi(true);

        try {
            const response = await window.ProMap.Routing.calculate(requestState());

            renderRouteResponse(response);

            if (!silent) {
                showError("");
            }
        } catch (error) {
            console.error("Navigation routing error:", error);

            let message = error?.message || "Routing servis trenutno nije dostupan.";

            if (error?.code === "InvalidStart") {
                message = "Start nema validne geografske koordinate.";
            } else if (error?.code === "InvalidDestination") {
                message = "Odredište nema validne geografske koordinate.";
            } else if (error?.status === 503) {
                message =
                    "Routing servis trenutno nije dostupan. Proveri PostGIS graph i OSRM fallback.";
            }

            showError(message);

            const badge = $("engineBadge");

            if (badge) {
                badge.classList.remove("ready");

                badge.classList.add("error");
            }
        } finally {
            setRoutingUi(false);
        }
    }

    function applyPreset(value) {
        const preset = PRESETS[value];

        if (!preset) {
            return;
        }

        const values = {
            navWeight: preset.weight,

            navHeight: preset.height,

            navWidth: preset.width,

            navLength: preset.length,

            navAxleLoad: preset.axleLoad,

            navAxles: preset.axles,

            navMaxSpeed: preset.maxSpeed,
        };

        for (const [id, valueToSet] of Object.entries(values)) {
            const element = $(id);

            if (element) {
                element.value = String(valueToSet);
            }
        }
    }

    function updateVehicleMode() {
        const truck = state.profile === "truck";

        $("truckMode")?.classList.toggle("active", truck);

        $("carMode")?.classList.toggle("active", !truck);

        setHidden("truckFields", !truck);

        const preset = $("truckPreset");

        if (preset) {
            preset.disabled = !truck;
        }

        setText("truckModeBadge", truck ? "HGV" : "CAR");

        setText("routeSafeBadge", truck ? "TRUCK SAFE" : "CAR ROUTE");

        const calculate = $("calcRoute");

        const strong = calculate?.querySelector("strong");

        if (strong && !state.routing) {
            strong.textContent = truck
                ? "Izračunaj truck rutu"
                : "Izračunaj auto rutu";
        }
    }

    function setProfile(profile) {
        state.profile = profile === "car" ? "car" : "truck";

        updateVehicleMode();

        if (state.routeResponse) {
            clearRouteResult();
        }
    }

    function swapPoints() {
        const oldStart = state.start;

        const oldDestination = state.destination;

        const startInput = $("navStart");

        const endInput = $("navEnd");

        if (startInput && endInput) {
            const startValue = startInput.value;

            startInput.value = endInput.value;

            endInput.value = startValue;
        }

        state.start = null;
        state.destination = null;

        if (oldDestination) {
            setStart(oldDestination);
        }

        if (oldStart) {
            setDestination(oldStart);
        }

        clearRouteResult();
    }

    function activateMapPick(target) {
        if (!state.map) {
            return;
        }

        state.picking = target;

        state.map.getContainer().style.cursor = "crosshair";

        showError(
            target === "start"
                ? "Klikni na mapu da izabereš polaznu tačku."
                : "Klikni na mapu da izabereš odredište.",
        );
    }

    function fitRoute() {
        if (!state.map) {
            return;
        }

        if (state.routeCoordinates.length > 0) {
            state.map.fitBounds(L.latLngBounds(state.routeCoordinates), {
                padding: [30, 30],
            });

            return;
        }

        const points = [];

        if (state.start) {
            points.push([state.start.latitude, state.start.longitude]);
        }

        if (state.destination) {
            points.push([state.destination.latitude, state.destination.longitude]);
        }

        if (points.length > 0) {
            state.map.fitBounds(L.latLngBounds(points), {
                padding: [30, 30],
                maxZoom: 14,
            });
        }
    }

    function centerGps() {
        const position = getCurrentGpsPosition();

        if (!position || !state.map) {
            showError("GPS trenutno nema dostupnu poziciju.");

            return;
        }

        state.liveFollow = true;

        state.map.setView(
            [position.latitude, position.longitude],
            Math.max(17, state.map.getZoom() || 17),
            {
                animate: true,
            },
        );
    }

    function updateGpsMarker(position) {
        if (!state.map) {
            return;
        }

        const latitude = Number(position?.latitude ?? position?.coords?.latitude);

        const longitude = Number(
            position?.longitude ?? position?.coords?.longitude,
        );

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return;
        }

        const hadGpsMarker = Boolean(state.gpsMarker);

        if (!state.gpsMarker) {
            state.gpsMarker = L.circleMarker([latitude, longitude], {
                radius: 8,
                weight: 3,
            })
                .addTo(state.map)
                .bindPopup("Trenutna GPS pozicija");
        } else {
            state.gpsMarker.setLatLng([latitude, longitude]);
        }

        const rawSpeed = Number(position?.speed ?? position?.coords?.speed);

        const speedKmh =
            Number.isFinite(rawSpeed) && rawSpeed >= 0
                ? Math.round(rawSpeed * 3.6)
                : null;

        const rawAccuracy = Number(
            position?.accuracy ?? position?.coords?.accuracy,
        );

        const accuracy = Number.isFinite(rawAccuracy)
            ? Math.round(rawAccuracy)
            : null;

        setGpsStatus("ON", "ready");

        setText("liveChip", "GPS ON");

        setText("liveSpeed", speedKmh != null ? `${speedKmh} km/h` : "—");

        setText("liveAccuracy", accuracy != null ? `±${accuracy} m` : "—");

        setText("livePosition", `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);

        const offRoute = distanceToRouteMeters(latitude, longitude);

        if (offRoute == null) {
            setText("liveOffRoute", "—");
        } else {
            setText(
                "liveOffRoute",
                offRoute > 60 ? `DA · ${Math.round(offRoute)} m` : "NE",
            );
        }

        updateNextInstruction({
            latitude,
            longitude,
            accuracy,
            speed: rawSpeed,
            heading: Number(position?.heading ?? position?.coords?.heading),
            timestamp: position?.timestamp ?? position?.coords?.timestamp,
        });

        if (state.live && state.liveFollow) {
            const speed = rawSpeed;

            let targetZoom = 17;

            if (Number.isFinite(speed)) {
                if (speed > 22) {
                    targetZoom = 16;
                }

                if (speed > 30) {
                    targetZoom = 15.5;
                }
            }

            if (!hadGpsMarker) {
                state.map.setView([latitude, longitude], targetZoom, {
                    animate: true,
                });
            } else {
                if (state.map.getZoom() < 15) {
                    state.map.setZoom(targetZoom, {
                        animate: true,
                    });
                }

                state.map.panTo([latitude, longitude], {
                    animate: true,
                    duration: 0.35,
                });
            }
        }

        if (
            state.live &&
            state.routeResponse &&
            offRoute != null &&
            offRoute > 100 &&
            Date.now() - state.lastRerouteAt > 30000
        ) {
            state.lastRerouteAt = Date.now();

            state.start = {
                latitude,
                longitude,
                label: "Trenutna GPS lokacija",
            };

            if ($("navStart")) {
                $("navStart").value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
            }

            setText("navStartResolved", "Trenutna GPS lokacija");

            calculateRoute({
                silent: true,
            });
        }
    }

    function gpsErrorMessage(error) {
        switch (error?.code) {
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
        if (!window.ProMap.Gps?.isSupported?.()) {
            showError("Browser ne podržava GPS geolokaciju.");

            return;
        }

        if (!state.routeResponse) {
            showError("");

            try {
                await calculateRoute();
            } catch (error) {
                console.error("Live navigation route preparation error:", error);

                return;
            }

            if (!state.routeResponse) {
                showError("Ruta nije izračunata. Prvo izračunaj rutu.");

                return;
            }
        }

        window.ProMap.Gps.stop();

        state.live = true;

        state.liveFollow = true;

        state.maneuverIndex = 0;

        state.routeProgressMeters = 0;

        state.lastRerouteAt = 0;

        if (state.map) {
            const position = getCurrentGpsPosition();

            if (position) {
                state.map.setView([position.latitude, position.longitude], 17, {
                    animate: true,
                });
            } else if (state.routeCoordinates.length) {
                state.map.fitBounds(L.latLngBounds(state.routeCoordinates), {
                    padding: [50, 50],
                    maxZoom: 15,
                });
            }
        }

        setHidden("startLiveNavigation", true);

        setHidden("stopLiveNavigation", false);

        setGpsStatus("STARTING", "warning");

        setText("liveChip", "GPS STARTING");

        window.ProMap.Gps.start({
            enableHighAccuracy: true,

            maximumAge: 2000,

            timeout: 15000,

            onPosition: (position) => {
                updateGpsMarker(position);
            },

            onError: (error) => {
                console.warn("GPS error:", error);

                showError(gpsErrorMessage(error));

                setGpsStatus("ERROR", "danger");

                setText("liveChip", "GPS ERROR");
            },
        });
    }

    function stopLiveNavigation() {
        window.ProMap.Gps?.stop?.();

        state.live = false;

        state.liveFollow = true;

        setHidden("startLiveNavigation", false);

        setHidden("stopLiveNavigation", true);

        setGpsStatus("OFF");

        setText("liveChip", "GPS OFF");

        setText("liveSpeed", "0 km/h");

        setText("liveAccuracy", "—");

        setText("liveOffRoute", "NE");

        setText("livePosition", "Lokacija nije aktivna");
    }

    function useCurrentLocation() {
        if (!navigator.geolocation) {
            showError("Browser ne podržava GPS geolokaciju.");

            return;
        }

        showError("");

        setGpsStatus("LOCATING", "warning");

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const point = {
                    latitude: position.coords.latitude,

                    longitude: position.coords.longitude,

                    label: "Moja trenutna lokacija",
                };

                $("navStart").value =
                    `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`;

                setStart(point);

                setGpsStatus("READY", "ready");

                if (state.map) {
                    state.map.setView([point.latitude, point.longitude], 14);
                }
            },

            (error) => {
                showError(gpsErrorMessage(error));

                setGpsStatus("ERROR", "danger");
            },

            {
                enableHighAccuracy: true,

                maximumAge: 0,

                timeout: 15000,
            },
        );
    }

    function setMapMode(mode) {
        const ids = {
            route: "mapRouteTab",

            restrictions: "mapRestrictionsTab",

            gps: "mapGpsTab",
        };

        for (const id of Object.values(ids)) {
            $(id)?.classList.remove("active");
        }

        $(ids[mode])?.classList.add("active");

        if (mode === "route") {
            fitRoute();
        }

        if (mode === "restrictions") {
            if ($("warningsCard") && !$("warningsCard").hidden) {
                $("warningsCard").scrollIntoView({
                    behavior: "smooth",

                    block: "nearest",
                });
            } else {
                showError("Izabrana ruta nema aktivna upozorenja.");
            }
        }

        if (mode === "gps") {
            const position = getCurrentGpsPosition();

            if (position) {
                centerGps();
            } else if (!state.live) {
                startLiveNavigation();
            }
        }
    }

    function bindEvents() {
        $("calcRoute")?.addEventListener("click", () => calculateRoute());

        $("swapPoints")?.addEventListener("click", swapPoints);

        $("truckMode")?.addEventListener("click", () => setProfile("truck"));

        $("carMode")?.addEventListener("click", () => setProfile("car"));

        $("truckPreset")?.addEventListener("change", (event) =>
            applyPreset(event.target.value),
        );

        $("useCurrentLocation")?.addEventListener("click", useCurrentLocation);

        $("fitRoute")?.addEventListener("click", fitRoute);

        $("centerGps")?.addEventListener("click", centerGps);

        $("pickStart")?.addEventListener("click", () => activateMapPick("start"));

        $("pickEnd")?.addEventListener("click", () => activateMapPick("end"));

        $("startLiveNavigation")?.addEventListener("click", startLiveNavigation);

        $("stopLiveNavigation")?.addEventListener("click", stopLiveNavigation);

        $("mapRouteTab")?.addEventListener("click", () => setMapMode("route"));

        $("mapRestrictionsTab")?.addEventListener("click", () =>
            setMapMode("restrictions"),
        );

        $("mapGpsTab")?.addEventListener("click", () => setMapMode("gps"));

        $("navStart")?.addEventListener("input", () => scheduleGeocode("start"));

        $("navEnd")?.addEventListener("input", () => scheduleGeocode("end"));

        $("navStart")?.addEventListener("keydown", async (event) => {
            if (event.key !== "Enter") {
                return;
            }

            event.preventDefault();

            try {
                await resolveInput("start");
            } catch (error) {
                showError(error?.message || "Start nije moguće pronaći.");
            }
        });

        $("navEnd")?.addEventListener("keydown", async (event) => {
            if (event.key !== "Enter") {
                return;
            }

            event.preventDefault();

            try {
                await resolveInput("end");
            } catch (error) {
                showError(error?.message || "Odredište nije moguće pronaći.");
            }
        });

        document.addEventListener("click", (event) => {
            if (!event.target.closest(".nav-input-wrapper")) {
                clearSuggestions("start");

                clearSuggestions("end");
            }
        });

        window.addEventListener("resize", () => {
            state.map?.invalidateSize();
        });
    }

    function initializeDefaults() {
        if ($("navStart")) {
            $("navStart").value = $("navStart").value?.trim() || DEFAULTS.start.label;
        }

        if ($("navEnd")) {
            $("navEnd").value =
                $("navEnd").value?.trim() || DEFAULTS.destination.label;
        }

        setStart(DEFAULTS.start);

        setDestination(DEFAULTS.destination);

        applyPreset($("truckPreset")?.value || "40t");

        updateVehicleMode();

        setGpsStatus("OFF");

        setText("engineHeader", "POSTGIS");

        setText("summaryEngine", "—");

        setText("diagnosticEngine", "—");

        setText("diagnosticGraph", "—");

        setText("diagnosticStates", "—");

        setText("diagnosticFallback", "—");

        setText("liveChip", "GPS OFF");

        setText("liveSpeed", "0 km/h");

        setText("liveAccuracy", "—");

        setText("liveOffRoute", "NE");

        setText("livePosition", "Lokacija nije aktivna");
    }

    function init() {
        initializeMap();

        initializeDefaults();

        bindEvents();

        setTimeout(() => {
            state.map?.invalidateSize();

            fitRoute();
        }, 200);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, {
            once: true,
        });
    } else {
        init();
    }
})();
