package com.ybhzcavp.dispatch;

/**
 * 可插拔调度提供者。
 */
public interface DispatchProvider {

    /** 提供者标识：internal / tsinghua */
    String id();

    /**
     * 分配车位并生成路径。
     *
     * @param lotId     停车场 ID
     * @param vehicleId 车辆 ID
     * @param eventType 事件类型（如 park=1 / pickup=2）
     * @param context   附加上下文
     */
    DispatchResult assignAndRoute(String lotId, String vehicleId, String eventType, DispatchContext context);
}
