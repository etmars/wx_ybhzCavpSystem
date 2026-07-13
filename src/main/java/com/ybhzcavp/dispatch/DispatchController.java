package com.ybhzcavp.dispatch;

import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/dispatch")
public class DispatchController {

    private final DispatchRouter dispatchRouter;

    public DispatchController(DispatchRouter dispatchRouter) {
        this.dispatchRouter = dispatchRouter;
    }

    /**
     * 触发调度：body 示例 {@code {"vehicleId":"I1000110","eventType":"1","memberId":"1"}}。
     */
    @PostMapping("/{lotId}/trigger")
    public Map<String, Object> trigger(@PathVariable String lotId, @RequestBody Map<String, Object> body) {
        Object vehicleId = body.get("vehicleId");
        if (vehicleId == null) {
            vehicleId = body.get("vehicle_id");
        }
        Object eventType = body.get("eventType");
        if (eventType == null) {
            eventType = body.get("event_type");
        }
        if (vehicleId == null) {
            return Map.of("success", false, "message", "vehicleId required");
        }
        String et = eventType != null ? String.valueOf(eventType) : "1";
        DispatchContext ctx = DispatchContext.fromMap(body);
        DispatchResult result = dispatchRouter.trigger(lotId, String.valueOf(vehicleId), et, ctx);
        return result.toMap();
    }
}
