package com.ybhzcavp.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app")
public class AppProperties {

    private String dataDir = "./data";
    private String osmandroidAssets = "";
    private Parking parking = new Parking();
    private Navigation navigation = new Navigation();

    public String getDataDir() {
        return dataDir;
    }

    public void setDataDir(String dataDir) {
        this.dataDir = dataDir;
    }

    public String getOsmandroidAssets() {
        return osmandroidAssets;
    }

    public void setOsmandroidAssets(String osmandroidAssets) {
        this.osmandroidAssets = osmandroidAssets;
    }

    public Parking getParking() {
        return parking;
    }

    public void setParking(Parking parking) {
        this.parking = parking;
    }

    public Navigation getNavigation() {
        return navigation;
    }

    public void setNavigation(Navigation navigation) {
        this.navigation = navigation;
    }

    public static class Parking {
        private double nearbyLng = 116.491829413;
        private double nearbyLat = 39.729580309;
        private int nearbyRadius = 15000;
        private String defaultParkingId = "000002";
        private String vehicleId = "I1000110";
        private String parkingSpaceNumber = "B117";
        private double parkingLng = 116.4915732;
        private double parkingLat = 39.7305491;

        public double getNearbyLng() {
            return nearbyLng;
        }

        public void setNearbyLng(double nearbyLng) {
            this.nearbyLng = nearbyLng;
        }

        public double getNearbyLat() {
            return nearbyLat;
        }

        public void setNearbyLat(double nearbyLat) {
            this.nearbyLat = nearbyLat;
        }

        public int getNearbyRadius() {
            return nearbyRadius;
        }

        public void setNearbyRadius(int nearbyRadius) {
            this.nearbyRadius = nearbyRadius;
        }

        public String getDefaultParkingId() {
            return defaultParkingId;
        }

        public void setDefaultParkingId(String defaultParkingId) {
            this.defaultParkingId = defaultParkingId;
        }

        public String getVehicleId() {
            return vehicleId;
        }

        public void setVehicleId(String vehicleId) {
            this.vehicleId = vehicleId;
        }

        public String getParkingSpaceNumber() {
            return parkingSpaceNumber;
        }

        public void setParkingSpaceNumber(String parkingSpaceNumber) {
            this.parkingSpaceNumber = parkingSpaceNumber;
        }

        public double getParkingLng() {
            return parkingLng;
        }

        public void setParkingLng(double parkingLng) {
            this.parkingLng = parkingLng;
        }

        public double getParkingLat() {
            return parkingLat;
        }

        public void setParkingLat(double parkingLat) {
            this.parkingLat = parkingLat;
        }
    }

    public static class Navigation {
        private double arrivalMeters = 8.0;
        private double walkSpeedMps = 1.15;

        public double getArrivalMeters() {
            return arrivalMeters;
        }

        public void setArrivalMeters(double arrivalMeters) {
            this.arrivalMeters = arrivalMeters;
        }

        public double getWalkSpeedMps() {
            return walkSpeedMps;
        }

        public void setWalkSpeedMps(double walkSpeedMps) {
            this.walkSpeedMps = walkSpeedMps;
        }
    }
}
