package com.ybhzcavp.dispatch;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 调度结果：车位分配 + 规划路径。
 */
public class DispatchResult {

    private boolean success;
    private String provider;
    private String message;
    private Assignment assignment;
    private Route route;
    private Map<String, Object> raw = new LinkedHashMap<>();

    public boolean isSuccess() {
        return success;
    }

    public void setSuccess(boolean success) {
        this.success = success;
    }

    public String getProvider() {
        return provider;
    }

    public void setProvider(String provider) {
        this.provider = provider;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public Assignment getAssignment() {
        return assignment;
    }

    public void setAssignment(Assignment assignment) {
        this.assignment = assignment;
    }

    public Route getRoute() {
        return route;
    }

    public void setRoute(Route route) {
        this.route = route;
    }

    public Map<String, Object> getRaw() {
        return raw;
    }

    public void setRaw(Map<String, Object> raw) {
        this.raw = raw != null ? raw : new LinkedHashMap<>();
    }

    public Map<String, Object> toMap() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("success", success);
        m.put("provider", provider);
        m.put("message", message);
        if (assignment != null) {
            m.put("assignment", assignment.toMap());
        }
        if (route != null) {
            m.put("route", route.toMap());
        }
        if (!raw.isEmpty()) {
            m.put("raw", raw);
        }
        return m;
    }

    public static class Assignment {
        private String spaceId;
        private String lotId;
        private String vehicleId;
        private double cost;

        public String getSpaceId() {
            return spaceId;
        }

        public void setSpaceId(String spaceId) {
            this.spaceId = spaceId;
        }

        public String getLotId() {
            return lotId;
        }

        public void setLotId(String lotId) {
            this.lotId = lotId;
        }

        public String getVehicleId() {
            return vehicleId;
        }

        public void setVehicleId(String vehicleId) {
            this.vehicleId = vehicleId;
        }

        public double getCost() {
            return cost;
        }

        public void setCost(double cost) {
            this.cost = cost;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("spaceId", spaceId);
            m.put("lotId", lotId);
            m.put("vehicleId", vehicleId);
            m.put("cost", cost);
            return m;
        }
    }

    public static class Route {
        private double totalLen;
        private double estTotalTime;
        private List<Object> pointsPos = new ArrayList<>();
        private Map<String, Object> plannerResponse = new LinkedHashMap<>();

        public double getTotalLen() {
            return totalLen;
        }

        public void setTotalLen(double totalLen) {
            this.totalLen = totalLen;
        }

        public double getEstTotalTime() {
            return estTotalTime;
        }

        public void setEstTotalTime(double estTotalTime) {
            this.estTotalTime = estTotalTime;
        }

        public List<Object> getPointsPos() {
            return pointsPos;
        }

        public void setPointsPos(List<Object> pointsPos) {
            this.pointsPos = pointsPos != null ? pointsPos : new ArrayList<>();
        }

        public Map<String, Object> getPlannerResponse() {
            return plannerResponse;
        }

        public void setPlannerResponse(Map<String, Object> plannerResponse) {
            this.plannerResponse = plannerResponse != null ? plannerResponse : new LinkedHashMap<>();
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("totalLen", totalLen);
            m.put("estTotalTime", estTotalTime);
            m.put("pointsPos", pointsPos);
            if (!plannerResponse.isEmpty()) {
                m.put("plannerResponse", plannerResponse);
            }
            return m;
        }
    }
}
