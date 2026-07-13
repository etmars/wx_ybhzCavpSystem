package com.ybhzcavp.dispatch;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 清华云调度：本地不做决策，仅记录「由清华云处理」。
 * 实际路径由 parkinglot 侧归一化 MQTT（groute normalize）下发。
 */
@Component
public class TsinghuaCloudProvider implements DispatchProvider {

    private static final Logger log = LoggerFactory.getLogger(TsinghuaCloudProvider.class);

    @Override
    public String id() {
        return "tsinghua";
    }

    @Override
    public DispatchResult assignAndRoute(String lotId, String vehicleId, String eventType, DispatchContext context) {
        log.info("dispatch delegated to Tsinghua cloud lotId={} vehicleId={} eventType={}",
                lotId, vehicleId, eventType);

        DispatchResult result = new DispatchResult();
        result.setProvider(id());
        result.setSuccess(true);
        result.setMessage("由清华云处理；路径来自 parkinglot 归一化 MQTT");

        Map<String, Object> raw = new LinkedHashMap<>();
        raw.put("delegated", true);
        raw.put("lotId", lotId);
        raw.put("vehicleId", vehicleId);
        raw.put("eventType", eventType);
        raw.put("note", "await groute from parkinglot MQTT normalize");
        if (context != null && context.getExtras() != null) {
            raw.put("context", context.getExtras());
        }
        result.setRaw(raw);
        return result;
    }
}
