package com.ybhzcavp.dispatch;

import com.ybhzcavp.config.dao.ConfigDao;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 按 parking_lot_dispatch.provider 选择调度实现。
 */
@Service
public class DispatchRouter {

    private static final Logger log = LoggerFactory.getLogger(DispatchRouter.class);

    private final ConfigDao configDao;
    private final Map<String, DispatchProvider> providers = new HashMap<>();

    public DispatchRouter(ConfigDao configDao, List<DispatchProvider> providerList) {
        this.configDao = configDao;
        for (DispatchProvider p : providerList) {
            providers.put(p.id(), p);
        }
        log.info("Dispatch providers registered: {}", providers.keySet());
    }

    public DispatchResult trigger(String lotId, String vehicleId, String eventType, DispatchContext context) {
        String providerId = configDao.getDispatch(lotId)
                .map(m -> String.valueOf(m.get("provider")))
                .orElse("internal");
        DispatchProvider provider = providers.get(providerId);
        if (provider == null) {
            log.warn("unknown provider={}, fallback to internal", providerId);
            provider = providers.get("internal");
        }
        if (provider == null) {
            DispatchResult fail = new DispatchResult();
            fail.setSuccess(false);
            fail.setProvider(providerId);
            fail.setMessage("no dispatch provider available");
            return fail;
        }
        log.info("dispatch route lotId={} provider={} vehicleId={} eventType={}",
                lotId, provider.id(), vehicleId, eventType);
        return provider.assignAndRoute(lotId, vehicleId, eventType, context);
    }
}
