"use strict";

window.ProMap = window.ProMap || {};

window.ProMap.Navigation = (() => {

    let map = null;

    let startMarker = null;
    let destinationMarker = null;
    let vehicleMarker = null;
    let routeLayer = null;

    let start = null;
    let destination = null;

    let route = null;


    function initialize() {

        if (typeof L === "undefined") {
            throw new Error(
                "Leaflet is not loaded."
            );
        }


        map = L.map("map", {
            zoomControl: false
        }).setView(
            [44.8125, 20.4612],
            8
        );


        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                maxZoom: 19,
                attribution:
                    "&copy; OpenStreetMap contributors"
            }
        ).addTo(map);


        bindMapClicks();
        bindControls();
        initializeGps();
    }


    function bindMapClicks() {

        map.on("click", event => {

            const point = {
                latitude: event.latlng.lat,
                longitude: event.latlng.lng
            };


            if (!start) {
                setStart(point);
                return;
            }


            if (!destination) {
                setDestination(point);
                return;
            }


            setStart(point);
            setDestination(null);
        });
    }


    function bindControls() {

        document
            .getElementById("calculateRoute")
            ?.addEventListener(
                "click",
                calculateRoute
            );


        document
            .getElementById("clearRoute")
            ?.addEventListener(
                "click",
                clear
            );


        document
            .getElementById("useGpsStart")
            ?.addEventListener(
                "click",
                useGpsAsStart
            );


        document
            .getElementById("locateMe")
            ?.addEventListener(
                "click",
                locateMe
            );


        document
            .getElementById("zoomIn")
            ?.addEventListener(
                "click",
                () => map.zoomIn()
            );


        document
            .getElementById("zoomOut")
            ?.addEventListener(
                "click",
                () => map.zoomOut()
            );
    }


    function initializeGps() {

        if (!window.ProMap.Gps.isSupported()) {

            setGpsStatus(
                "GPS N/A",
                "error"
            );

            return;
        }


        window.ProMap.Gps.start({

            onPosition(position) {

                setGpsStatus(
                    "GPS ACTIVE",
                    "active"
                );

                updateVehicleMarker(
                    position
                );
            },

            onError() {

                setGpsStatus(
                    "GPS ERROR",
                    "error"
                );
            }
        });
    }


    function setStart(point) {

        start = point;

        if (startMarker) {
            map.removeLayer(startMarker);
        }


        startMarker =
            L.marker([
                point.latitude,
                point.longitude
            ])
                .addTo(map)
                .bindTooltip("START");


        updateCoordinates(
            "startCoordinates",
            point
        );
    }


    function setDestination(point) {

        destination = point;


        if (destinationMarker) {

            map.removeLayer(
                destinationMarker
            );

            destinationMarker = null;
        }


        if (!point) {

            updateCoordinates(
                "destinationCoordinates",
                null
            );

            return;
        }


        destinationMarker =
            L.marker([
                point.latitude,
                point.longitude
            ])
                .addTo(map)
                .bindTooltip("DESTINATION");


        updateCoordinates(
            "destinationCoordinates",
            point
        );
    }


    async function calculateRoute() {

        if (!start) {

            showMessage(
                "Postavi početnu tačku."
            );

            return;
        }


        if (!destination) {

            showMessage(
                "Postavi odredište."
            );

            return;
        }


        setRoutingStatus(
            "ROUTING",
            "loading"
        );


        try {

            const state = {
                start,
                destination,

                vehicle: {
                    weightTons:
                        getNumber("vehicleWeight"),

                    heightMeters:
                        getNumber("vehicleHeight"),

                    widthMeters:
                        getNumber("vehicleWidth"),

                    lengthMeters:
                        getNumber("vehicleLength")
                },

                options: {

                    avoidTolls:
                        getChecked("avoidTolls"),

                    avoidFerries:
                        getChecked("avoidFerries"),

                    avoidLowClearance:
                        getChecked(
                            "avoidLowClearance"
                        )
                }
            };


            route =
                await window.ProMap.Routing.calculate(
                    state
                );


            renderRoute(route);

            setRoutingStatus(
                "ROUTE FOUND",
                "success"
            );
        }
        catch (error) {

            console.error(
                "Routing error:",
                error
            );


            setRoutingStatus(
                error.code ||
                "ROUTING ERROR",
                "error"
            );


            showMessage(
                error.message ||
                "Nije moguće izračunati rutu."
            );
        }
    }


    function renderRoute(data) {

        if (!data.geometry) {

            throw new Error(
                "ROUTE_GEOMETRY_MISSING"
            );
        }


        if (routeLayer) {
            map.removeLayer(routeLayer);
        }


        const coordinates =
            geometryToLeaflet(
                data.geometry
            );


        routeLayer =
            L.polyline(
                coordinates,
                {
                    weight: 6,
                    opacity: 0.9
                }
            ).addTo(map);


        if (coordinates.length > 0) {

            map.fitBounds(
                routeLayer.getBounds(),
                {
                    padding: [40, 40]
                }
            );
        }


        updateRouteSummary(data);

        renderManeuvers(
            data.maneuvers || []
        );
    }


    function geometryToLeaflet(geometry) {

        if (
            !geometry ||
            geometry.type !== "LineString"
        ) {
            return [];
        }


        return geometry.coordinates.map(
            coordinate => [
                coordinate[1],
                coordinate[0]
            ]
        );
    }


    function renderManeuvers(maneuvers) {

        const navigation =
            document.getElementById(
                "activeNavigation"
            );


        if (!navigation || !maneuvers.length) {

            if (navigation) {
                navigation.hidden = true;
            }

            return;
        }


        const current =
            window.ProMap.Maneuvers.normalize(
                maneuvers[0]
            );


        const next =
            maneuvers.length > 1
                ? window.ProMap.Maneuvers.normalize(
                    maneuvers[1]
                )
                : null;


        navigation.hidden = false;


        document.getElementById(
            "currentManeuverIcon"
        ).textContent =
            current.icon;


        document.getElementById(
            "currentManeuver"
        ).textContent =
            current.instruction;


        document.getElementById(
            "currentManeuverDistance"
        ).textContent =
            window.ProMap.Maneuvers.formatDistance(
                current.distanceMeters
            );


        document.getElementById(
            "nextManeuver"
        ).textContent =
            next
                ? `Sledeće: ${next.instruction}`
                : "Nema sledećeg manevra";
    }


    function updateRouteSummary(data) {

        const summary =
            document.getElementById(
                "routeSummary"
            );


        summary.hidden = false;


        document.getElementById(
            "routeDistance"
        ).textContent =
            window.ProMap.Maneuvers.formatDistance(
                Number(data.distanceMeters)
            );


        document.getElementById(
            "routeDuration"
        ).textContent =
            window.ProMap.Maneuvers.formatDuration(
                Number(data.durationSeconds)
            );


        document.getElementById(
            "routeGraphVersion"
        ).textContent =
            data.graphVersion ??
            "—";
    }


    function updateVehicleMarker(position) {

        if (!map) {
            return;
        }


        const latLng = [
            position.latitude,
            position.longitude
        ];


        if (!vehicleMarker) {

            vehicleMarker =
                L.circleMarker(
                    latLng,
                    {
                        radius: 8
                    }
                ).addTo(map);

            return;
        }


        vehicleMarker.setLatLng(
            latLng
        );
    }


    function useGpsAsStart() {

        const position =
            window.ProMap.Gps.getPosition();


        if (!position) {

            showMessage(
                "GPS lokacija još nije dostupna."
            );

            return;
        }


        setStart({
            latitude: position.latitude,
            longitude: position.longitude
        });


        map.setView(
            [
                position.latitude,
                position.longitude
            ],
            14
        );
    }


    function locateMe() {

        const position =
            window.ProMap.Gps.getPosition();


        if (!position) {
            return;
        }


        map.setView(
            [
                position.latitude,
                position.longitude
            ],
            15
        );
    }


    function clear() {

        start = null;
        destination = null;
        route = null;


        [
            startMarker,
            destinationMarker,
            routeLayer
        ].forEach(layer => {

            if (layer) {
                map.removeLayer(layer);
            }
        });


        startMarker = null;
        destinationMarker = null;
        routeLayer = null;


        updateCoordinates(
            "startCoordinates",
            null
        );

        updateCoordinates(
            "destinationCoordinates",
            null
        );


        document.getElementById(
            "routeSummary"
        ).hidden = true;


        document.getElementById(
            "activeNavigation"
        ).hidden = true;


        hideMessage();


        setRoutingStatus(
            "READY",
            "idle"
        );
    }


    function updateCoordinates(id, point) {

        const element =
            document.getElementById(id);


        if (!element) {
            return;
        }


        element.textContent =
            point
                ? `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`
                : "Nije postavljeno";
    }


    function getNumber(id) {

        return Number(
            document.getElementById(id)?.value || 0
        );
    }


    function getChecked(id) {

        return Boolean(
            document.getElementById(id)?.checked
        );
    }


    function setRoutingStatus(
        text,
        type
    ) {

        const element =
            document.getElementById(
                "routingStatus"
            );


        if (!element) {
            return;
        }


        element.textContent = text;

        element.className =
            `pm-status pm-status-${type}`;
    }


    function setGpsStatus(
        text,
        type
    ) {

        const element =
            document.getElementById(
                "gpsStatus"
            );


        if (!element) {
            return;
        }


        element.textContent = text;

        element.className =
            `pm-status pm-status-gps pm-status-${type}`;
    }


    function showMessage(message) {

        const element =
            document.getElementById(
                "mapMessage"
            );


        if (!element) {
            return;
        }


        element.textContent =
            message;

        element.hidden = false;
    }


    function hideMessage() {

        const element =
            document.getElementById(
                "mapMessage"
            );


        if (element) {
            element.hidden = true;
        }
    }


    return {
        initialize,
        setStart,
        setDestination,
        clear
    };

})();