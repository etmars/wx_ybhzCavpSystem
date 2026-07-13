package com.ybhzcavp.dispatch;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 调度上下文：车辆/会员/事件附加信息。
 */
public class DispatchContext {

    private String memberId;
    private Double startLat;
    private Double startLon;
    private String startFloor;
    private Map<String, Object> extras = new LinkedHashMap<>();

    public String getMemberId() {
        return memberId;
    }

    public void setMemberId(String memberId) {
        this.memberId = memberId;
    }

    public Double getStartLat() {
        return startLat;
    }

    public void setStartLat(Double startLat) {
        this.startLat = startLat;
    }

    public Double getStartLon() {
        return startLon;
    }

    public void setStartLon(Double startLon) {
        this.startLon = startLon;
    }

    public String getStartFloor() {
        return startFloor;
    }

    public void setStartFloor(String startFloor) {
        this.startFloor = startFloor;
    }

    public Map<String, Object> getExtras() {
        return extras;
    }

    public void setExtras(Map<String, Object> extras) {
        this.extras = extras != null ? extras : new LinkedHashMap<>();
    }

    @SuppressWarnings("unchecked")
    public static DispatchContext fromMap(Map<String, Object> body) {
        DispatchContext ctx = new DispatchContext();
        if (body == null) {
            return ctx;
        }
        Object mid = body.get("memberId");
        if (mid == null) {
            mid = body.get("member_id");
        }
        if (mid != null) {
            ctx.setMemberId(String.valueOf(mid));
        }
        Object lat = body.get("startLat");
        if (lat == null) {
            lat = body.get("start_lat");
        }
        if (lat instanceof Number n) {
            ctx.setStartLat(n.doubleValue());
        }
        Object lon = body.get("startLon");
        if (lon == null) {
            lon = body.get("start_lon");
        }
        if (lon instanceof Number n) {
            ctx.setStartLon(n.doubleValue());
        }
        Object floor = body.get("startFloor");
        if (floor == null) {
            floor = body.get("start_floor");
        }
        if (floor != null) {
            ctx.setStartFloor(String.valueOf(floor));
        }
        Object extras = body.get("extras");
        if (extras instanceof Map<?, ?> m) {
            ctx.setExtras((Map<String, Object>) m);
        }
        return ctx;
    }
}
