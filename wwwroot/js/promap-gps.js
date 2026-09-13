"use strict";

window.ProMap = window.ProMap || {};

window.ProMap.Gps = (() => {
    let watchId = null;

    const state = {
        enabled: false,
        position: null,
        error: null
    };

    function isSupported() {
        return (
            "geolocation" in navigator &&
            typeof navigator.geolocation.watchPosition === "function"
        );
    }

    function normalizePosition(position) {
        if (!position) {
            return null;
        }

        const coords = position.coords || position;

        const latitude = Number(coords.latitude);
        const longitude = Number(coords.longitude);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return null;
        }

        const accuracyValue = Number(coords.accuracy);
        const headingValue = Number(coords.heading);
        const speedValue = Number(coords.speed);

        const accuracy = Number.isFinite(accuracyValue)
            ? accuracyValue
            : null;

        const heading = Number.isFinite(headingValue)
            ? headingValue
            : null;

        const speed = Number.isFinite(speedValue)
            ? speedValue
            : null;

        return {
            latitude,
            longitude,
            accuracy,
            heading,
            speed,
            timestamp: Number.isFinite(Number(position.timestamp))
                ? Number(position.timestamp)
                : Date.now(),

            /*
             * IMPORTANT:
             *
             * navigation.js expects:
             *
             * position.coords.latitude
             * position.coords.longitude
             *
             * Keep this browser-compatible object.
             */
            coords: {
                latitude,
                longitude,
                accuracy,
                heading,
                speed
            }
        };
    }

    function start(options = {}) {
        if (!isSupported()) {
            state.enabled = false;
            state.error = new Error(
                "Browser ne podržava GPS/geolocation."
            );

            if (typeof options.onError === "function") {
                options.onError(state.error);
            }

            return false;
        }

        stop();

        state.enabled = true;
        state.error = null;

        watchId = navigator.geolocation.watchPosition(
            position => {
                const normalized = normalizePosition(position);

                if (!normalized) {
                    state.error = new Error(
                        "GPS je vratio nevalidne geografske koordinate."
                    );

                    if (typeof options.onError === "function") {
                        options.onError(state.error);
                    }

                    return;
                }

                state.position = normalized;
                state.error = null;

                if (typeof options.onPosition === "function") {
                    options.onPosition(normalized);
                }
            },
            error => {
                state.error = error;

                if (typeof options.onError === "function") {
                    options.onError(error);
                }
            },
            {
                enableHighAccuracy:
                    options.enableHighAccuracy ?? true,

                maximumAge:
                    options.maximumAge ?? 5000,

                timeout:
                    options.timeout ?? 15000
            }
        );

        return true;
    }

    function stop() {
        if (
            watchId !== null &&
            "geolocation" in navigator &&
            typeof navigator.geolocation.clearWatch === "function"
        ) {
            navigator.geolocation.clearWatch(watchId);
        }

        watchId = null;
        state.enabled = false;
    }

    function getPosition() {
        return state.position;
    }

    function getState() {
        return {
            enabled: state.enabled,
            position: state.position,
            error: state.error
        };
    }

    return {
        start,
        stop,
        getPosition,
        getState,
        isSupported
    };
})();