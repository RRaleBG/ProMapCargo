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
        return "geolocation" in navigator;
    }

    function start(options = {}) {
        if (!isSupported()) {
            state.enabled = false;
            state.error = "GEOLOCATION_UNSUPPORTED";
            options.onError?.(
                new Error(
                    "Browser does not support geolocation."
                )
            );
            return;
        }


        state.enabled = true;
        state.error = null;
        watchId = navigator.geolocation.watchPosition(
            position => {
                state.position = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    heading: position.coords.heading,
                    speed: position.coords.speed
                };

                options.onPosition?.(
                    state.position
                );
            },

            error => {
                state.error = error;
                options.onError?.(error);
            },
            {
                enableHighAccuracy: options.enableHighAccuracy ?? true,
                maximumAge: options.maximumAge ?? 5000,
                timeout: options.timeout ?? 15000
            }
        );
    }

    function stop() {
        if (watchId !== null) {
            navigator.geolocation.clearWatch(
                watchId
            );
            watchId = null;
        }
        state.enabled = false;
    }

    function getPosition() {
        return state.position;
    }

    function getState() {
        return {
            ...state
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