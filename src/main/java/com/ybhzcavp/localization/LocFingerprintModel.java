package com.ybhzcavp.localization;

import java.util.List;
import java.util.Map;

public record LocFingerprintModel(
        List<String> beaconOrder,
        List<Map<String, Integer>> fpRssiList,
        List<double[]> fpLatLngs
) {
}
