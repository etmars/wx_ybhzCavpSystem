package com.ybhzcavp.localization;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * 三档分层图距离 KNN 定位器（对齐 Android KnnLocalizer.kt）。
 */
public class KnnLocalizer {

    private static final float RSSI_THRESHOLD = -90f;
    private static final float RSSI_THRESHOLD_FALLBACK = -95f;
    private static final float RSSI_THRESHOLD_REL = -95f;
    private static final int MIN_COMMON_BEACONS = 3;
    private static final float MIN_COVERAGE = 0.3f;
    private static final float DEFAULT_RSSI = -100f;
    private static final float TIER_PCT_STRONG = 0.20f;
    private static final float TIER_PCT_MEDIUM = 0.70f;
    private static final float W_STRONG = 1.0f;
    private static final float W_MEDIUM = 0.5f;
    private static final float W_WEAK = 0.2f;

    private final List<Map<String, Integer>> fpRssiList;
    private final List<double[]> fpLatLngs;
    private final boolean useRelational;

    public KnnLocalizer(LocFingerprintModel model, boolean useRelational) {
        this.fpRssiList = model.fpRssiList();
        this.fpLatLngs = model.fpLatLngs();
        this.useRelational = useRelational;
    }

    public record KnnResult(double latitude, double longitude, float confidence, int nNeighbors, String mode) {
    }

    public KnnResult predict(Map<String, Float> rssiMap) {
        if (fpRssiList.isEmpty()) {
            return null;
        }

        float effectiveThreshold = useRelational ? RSSI_THRESHOLD_REL :
                (countAbove(rssiMap, RSSI_THRESHOLD) >= MIN_COMMON_BEACONS ? RSSI_THRESHOLD : RSSI_THRESHOLD_FALLBACK);

        List<String> queryActiveKeys = new ArrayList<>();
        for (Map.Entry<String, Float> e : rssiMap.entrySet()) {
            if (e.getValue() >= effectiveThreshold) {
                queryActiveKeys.add(e.getKey());
            }
        }
        if (queryActiveKeys.size() < MIN_COMMON_BEACONS) {
            return null;
        }

        int needMin = Math.max(MIN_COMMON_BEACONS, (int) (queryActiveKeys.size() * 0.3f));
        int k = 8;
        float[] distances = new float[fpRssiList.size()];
        int candidateCnt = 0;

        for (int fi = 0; fi < fpRssiList.size(); fi++) {
            Map<String, Integer> fpEntries = fpRssiList.get(fi);
            if (useRelational) {
                List<BeaconPair> pairs = new ArrayList<>();
                int common = 0;
                for (String key : queryActiveKeys) {
                    Integer fpVal = fpEntries.get(key);
                    if (fpVal == null || fpVal < effectiveThreshold) {
                        continue;
                    }
                    float queryVal = rssiMap.getOrDefault(key, DEFAULT_RSSI);
                    float avg = (queryVal + fpVal) / 2f;
                    float diff = queryVal - fpVal;
                    pairs.add(new BeaconPair(avg, diff));
                    common++;
                }
                pairs.sort(Comparator.comparingDouble((BeaconPair p) -> p.avgRssi).reversed());

                if (common < needMin) {
                    distances[fi] = Float.MAX_VALUE;
                    continue;
                }
                int fpActiveCount = Math.max(1, countFpAbove(fpEntries, effectiveThreshold));
                float coverage = common / (float) fpActiveCount;
                if (coverage < MIN_COVERAGE) {
                    distances[fi] = Float.MAX_VALUE;
                    continue;
                }

                int n = pairs.size();
                int strongEnd = (int) (n * TIER_PCT_STRONG);
                int mediumEnd = strongEnd + (int) (n * TIER_PCT_MEDIUM);

                List<Float> strongDiffs = new ArrayList<>();
                List<Float> mediumDiffs = new ArrayList<>();
                List<Float> weakDiffs = new ArrayList<>();
                for (int i = 0; i < n; i++) {
                    float diff = pairs.get(i).diff;
                    if (i < strongEnd) {
                        strongDiffs.add(diff);
                    } else if (i < mediumEnd) {
                        mediumDiffs.add(diff);
                    } else {
                        weakDiffs.add(diff);
                    }
                }

                float totalDist = 0f;
                float totalW = 0f;
                float strongDist = tierPairwiseDist(strongDiffs);
                if (strongDiffs.size() >= 2 && strongDist > 0f) {
                    totalDist += W_STRONG * strongDist;
                    totalW += W_STRONG;
                }
                float medDist = tierPairwiseDist(mediumDiffs);
                if (mediumDiffs.size() >= 2 && medDist > 0f) {
                    totalDist += W_MEDIUM * medDist;
                    totalW += W_MEDIUM;
                }
                float weakDist = tierPairwiseDist(weakDiffs);
                if (weakDiffs.size() >= 2 && weakDist > 0f) {
                    totalDist += W_WEAK * weakDist;
                    totalW += W_WEAK;
                }
                if (totalW <= 0f) {
                    List<Float> all = new ArrayList<>();
                    all.addAll(strongDiffs);
                    all.addAll(mediumDiffs);
                    all.addAll(weakDiffs);
                    float sumSq = 0f;
                    for (float d : all) {
                        sumSq += d * d;
                    }
                    totalDist = (float) Math.sqrt(sumSq / common);
                    totalW = 1f;
                }
                distances[fi] = (totalDist / totalW) / Math.max(MIN_COVERAGE, coverage);
                candidateCnt++;
            } else {
                float sumSq = 0f;
                int common = 0;
                for (String key : queryActiveKeys) {
                    Integer fpVal = fpEntries.get(key);
                    if (fpVal != null && fpVal >= effectiveThreshold) {
                        float queryVal = rssiMap.getOrDefault(key, DEFAULT_RSSI);
                        float diff = queryVal - fpVal;
                        float weight = Math.max(0.2f, Math.min(2.0f, ((queryVal + fpVal) / 2f + 100f) / 30f));
                        sumSq += diff * diff * weight;
                        common++;
                    }
                }
                if (common < needMin) {
                    distances[fi] = Float.MAX_VALUE;
                    continue;
                }
                int fpActiveCount = Math.max(1, countFpAbove(fpEntries, effectiveThreshold));
                float coverage = common / (float) fpActiveCount;
                if (coverage < MIN_COVERAGE) {
                    distances[fi] = Float.MAX_VALUE;
                    continue;
                }
                distances[fi] = (float) (Math.sqrt(sumSq / common) / Math.max(MIN_COVERAGE, coverage));
                candidateCnt++;
            }
        }

        if (candidateCnt == 0) {
            return null;
        }

        List<Integer> topK = new ArrayList<>();
        for (int i = 0; i < distances.length; i++) {
            if (distances[i] < Float.MAX_VALUE) {
                topK.add(i);
            }
        }
        topK.sort(Comparator.comparingDouble(i -> distances[i]));
        if (topK.size() > k) {
            topK = topK.subList(0, k);
        }

        float bestDistForW = Math.max(0f, distances[topK.get(0)]);
        float d0 = Math.max(1f, bestDistForW);
        float totalWeight = 0f;
        double sumLat = 0;
        double sumLon = 0;
        for (int idx : topK) {
            float dist = Math.max(0f, distances[idx]);
            float w = 1f / (dist + d0);
            totalWeight += w;
            double[] ll = fpLatLngs.get(idx);
            sumLat += ll[0] * w;
            sumLon += ll[1] * w;
        }
        if (totalWeight <= 0f) {
            return null;
        }

        double predLat = sumLat / totalWeight;
        double predLon = sumLon / totalWeight;
        float bestDist = distances[topK.get(0)];
        float secondDist = topK.size() > 1 ? distances[topK.get(1)] : bestDist;
        float consensus;
        if (secondDist >= bestDist && (secondDist - bestDist) < bestDist * 0.5f) {
            consensus = Math.max(0.2f, Math.min(1f, 1f / (1f + bestDist / 30f)));
        } else {
            consensus = Math.max(0.1f, Math.min(1f, 1f / (1f + bestDist / 20f)));
        }

        return new KnnResult(predLat, predLon, consensus, topK.size(), useRelational ? "rel" : "abs");
    }

    private static int countAbove(Map<String, Float> map, float threshold) {
        int c = 0;
        for (float v : map.values()) {
            if (v >= threshold) {
                c++;
            }
        }
        return c;
    }

    private static int countFpAbove(Map<String, Integer> map, float threshold) {
        int c = 0;
        for (int v : map.values()) {
            if (v >= threshold) {
                c++;
            }
        }
        return c;
    }

    private static float tierPairwiseDist(List<Float> diffs) {
        if (diffs.size() < 2) {
            return 0f;
        }
        float sumSq = 0f;
        int cnt = 0;
        for (int i = 0; i < diffs.size(); i++) {
            for (int j = i + 1; j < diffs.size(); j++) {
                float d = diffs.get(i) - diffs.get(j);
                sumSq += d * d;
                cnt++;
            }
        }
        return cnt > 0 ? (float) Math.sqrt(sumSq / cnt) : 0f;
    }

    private record BeaconPair(float avgRssi, float diff) {
    }
}
