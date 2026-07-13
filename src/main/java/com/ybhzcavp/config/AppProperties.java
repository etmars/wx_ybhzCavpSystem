package com.ybhzcavp.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app")
public class AppProperties {

    private String dataDir = "./data";
    /** 遗留：仅当 syncOsmandroidAssets=true 时从该目录拷贝到 data-dir */
    private String osmandroidAssets = "";
    /** 默认关闭；地图权威源为 parkinglot catalog + 标定服资产 */
    private boolean syncOsmandroidAssets = false;
    private MapSync mapSync = new MapSync();
    private Parking parking = new Parking();
    private Calib calib = new Calib();
    private Navigation navigation = new Navigation();
    private Planner planner = new Planner();
    private Mqtt mqtt = new Mqtt();
    private Config config = new Config();

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

    public boolean isSyncOsmandroidAssets() {
        return syncOsmandroidAssets;
    }

    public void setSyncOsmandroidAssets(boolean syncOsmandroidAssets) {
        this.syncOsmandroidAssets = syncOsmandroidAssets;
    }

    public MapSync getMapSync() {
        return mapSync;
    }

    public void setMapSync(MapSync mapSync) {
        this.mapSync = mapSync;
    }

    public Parking getParking() {
        return parking;
    }

    public void setParking(Parking parking) {
        this.parking = parking;
    }

    public Calib getCalib() {
        return calib;
    }

    public void setCalib(Calib calib) {
        this.calib = calib;
    }

    public Navigation getNavigation() {
        return navigation;
    }

    public void setNavigation(Navigation navigation) {
        this.navigation = navigation;
    }

    public Planner getPlanner() {
        return planner;
    }

    public void setPlanner(Planner planner) {
        this.planner = planner;
    }

    public Mqtt getMqtt() {
        return mqtt;
    }

    public void setMqtt(Mqtt mqtt) {
        this.mqtt = mqtt;
    }

    public Config getConfig() {
        return config;
    }

    public void setConfig(Config config) {
        this.config = config;
    }

    public static class MapSync {
        /** 启动时从 parkinglot + 标定服按 CRC 同步地图到 data/maps */
        private boolean enabled = true;
        private boolean onStartup = true;

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public boolean isOnStartup() {
            return onStartup;
        }

        public void setOnStartup(boolean onStartup) {
            this.onStartup = onStartup;
        }
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
        /** 对齐 Android PARKING_API_BASE_URL，H5 groute 代理转发目标 */
        private String apiBaseUrl = "http://parkinglot.c-avp.com:3000";

        public String getApiBaseUrl() {
            return apiBaseUrl;
        }

        public void setApiBaseUrl(String apiBaseUrl) {
            this.apiBaseUrl = apiBaseUrl;
        }

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

    public static class Calib {
        private String apiBaseUrl = "http://parkinglock.c-avp.com:18181";

        public String getApiBaseUrl() {
            return apiBaseUrl;
        }

        public void setApiBaseUrl(String apiBaseUrl) {
            this.apiBaseUrl = apiBaseUrl;
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

    public static class Planner {
        private String baseUrl = "http://127.0.0.1:18080";

        public String getBaseUrl() {
            return baseUrl;
        }

        public void setBaseUrl(String baseUrl) {
            this.baseUrl = baseUrl;
        }
    }

    public static class Mqtt {
        private String brokerUrl = "tcp://127.0.0.1:1883";
        private boolean enabled = false;

        public String getBrokerUrl() {
            return brokerUrl;
        }

        public void setBrokerUrl(String brokerUrl) {
            this.brokerUrl = brokerUrl;
        }

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }
    }

    public static class Config {
        private String dbPath = "data/config.db";

        public String getDbPath() {
            return dbPath;
        }

        public void setDbPath(String dbPath) {
            this.dbPath = dbPath;
        }
    }
}
