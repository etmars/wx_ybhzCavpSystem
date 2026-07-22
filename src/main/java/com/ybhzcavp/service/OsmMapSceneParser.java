package com.ybhzcavp.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.xml.sax.Attributes;
import org.xml.sax.helpers.DefaultHandler;

import javax.xml.parsers.SAXParserFactory;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 从 OSM 解析室内地图全图层（对齐 Android mbtiles / MainActivity.addRenderLayers）。
 */
public final class OsmMapSceneParser {

    private static final Logger log = LoggerFactory.getLogger(OsmMapSceneParser.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private OsmMapSceneParser() {
    }

    public static MapScene parse(Path osmFile) {
        try {
            Handler handler = new Handler();
            SAXParserFactory.newInstance().newSAXParser().parse(osmFile.toFile(), handler);
            return handler.build();
        } catch (Exception e) {
            log.error("OSM scene parse failed: {}", osmFile, e);
            return MapScene.empty();
        }
    }

    public record MapScene(
            double centerLat,
            double centerLon,
            double mapBearingDeg,
            List<double[][]> road2005,
            List<double[][]> road2005Ramp,
            List<double[][]> room2008,
            List<double[][]> parkingFill,
            List<double[][]> parkingEdge,
            List<double[][]> arrow1001,
            List<double[][]> walls1000,
            List<double[][]> blocker100202,
            List<double[][]> blocker100202Edge,
            List<LabelPoint> parkingLabels,
            List<LabelPoint> poiPoints,
            List<double[][]> speedBumps1003,
            List<double[][]> lane1004
    ) {
        static MapScene empty() {
            return new MapScene(0, 0, 0,
                    List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
                    List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
                    List.of());
        }

        /** 减速带（sType=1003）→ GeoJSON FeatureCollection（Polygon）。对齐 NavSpeedBumps 消费格式。 */
        public ObjectNode speedBumpsGeoJson() {
            ObjectNode fc = MAPPER.createObjectNode();
            fc.put("type", "FeatureCollection");
            ArrayNode features = fc.putArray("features");
            int seq = 0;
            for (double[][] ring : speedBumps1003) {
                if (ring.length < 3) continue;
                ObjectNode feature = features.addObject();
                feature.put("type", "Feature");
                ObjectNode props = feature.putObject("properties");
                props.put("sType", 1003);
                props.put("id", "sb_" + seq);
                ObjectNode geom = feature.putObject("geometry");
                geom.put("type", "Polygon");
                ArrayNode rings = geom.putArray("coordinates");
                rings.add(ringCoords(ring));
                seq++;
            }
            return fc;
        }

        public ObjectNode toJson() {
            ObjectNode root = MAPPER.createObjectNode();
            root.put("centerLat", centerLat);
            root.put("centerLon", centerLon);
            root.put("mapBearingDeg", mapBearingDeg);
            ObjectNode layers = root.putObject("layers");
            layers.set("road2005", polys(road2005));
            layers.set("road2005Ramp", polys(road2005Ramp));
            layers.set("room2008", polys(room2008));
            layers.set("parkingFill", polys(parkingFill));
            layers.set("parkingEdge", polylines(parkingEdge));
            layers.set("arrow1001", polys(arrow1001));
            layers.set("walls1000", polys(walls1000));
            layers.set("blocker100202", polys(blocker100202));
            layers.set("blocker100202Edge", polylines(blocker100202Edge));
            layers.set("parkingLabels", labels(parkingLabels));
            layers.set("poiPoints", labels(poiPoints));
            layers.set("speedBumps1003", polys(speedBumps1003));
            layers.set("lane1004", polylines(lane1004));
            return root;
        }

        private static ArrayNode polys(List<double[][]> polys) {
            ArrayNode arr = MAPPER.createArrayNode();
            for (double[][] ring : polys) {
                arr.add(ringCoords(ring));
            }
            return arr;
        }

        private static ArrayNode polylines(List<double[][]> lines) {
            ArrayNode arr = MAPPER.createArrayNode();
            for (double[][] line : lines) {
                arr.add(ringCoords(line));
            }
            return arr;
        }

        private static ArrayNode ringCoords(double[][] ring) {
            ArrayNode coords = MAPPER.createArrayNode();
            for (double[] p : ring) {
                ArrayNode c = MAPPER.createArrayNode();
                c.add(p[1]);
                c.add(p[0]);
                coords.add(c);
            }
            return coords;
        }

        private static ArrayNode labels(List<LabelPoint> points) {
            ArrayNode arr = MAPPER.createArrayNode();
            for (LabelPoint p : points) {
                ObjectNode o = MAPPER.createObjectNode();
                o.put("lon", p.lon());
                o.put("lat", p.lat());
                o.put("label", p.label());
                o.put("id", p.id());
                arr.add(o);
            }
            return arr;
        }
    }

    public record LabelPoint(double lat, double lon, String label, String id) {
    }

    private static class Handler extends DefaultHandler {
        private final Map<Long, double[]> nodes = new HashMap<>();
        private final Map<Long, Map<String, String>> nodeTags = new HashMap<>();
        private final List<Way> ways = new ArrayList<>();
        private Way currentWay;
        private Long currentNodeId;

        private double centerLat = 0;
        private double centerLon = 0;
        private double mapBearingDeg = 0;
        private boolean hasCenter = false;

        @Override
        public void startElement(String uri, String localName, String qName, Attributes attrs) {
            switch (qName) {
                case "node" -> {
                    currentNodeId = Long.parseLong(attrs.getValue("id"));
                    double lat = Double.parseDouble(attrs.getValue("lat"));
                    double lon = Double.parseDouble(attrs.getValue("lon"));
                    nodes.put(currentNodeId, new double[]{lat, lon});
                }
                case "way" -> currentWay = new Way();
                case "nd" -> {
                    if (currentWay != null) {
                        currentWay.refs.add(Long.parseLong(attrs.getValue("ref")));
                    }
                }
                case "tag" -> {
                    String k = attrs.getValue("k");
                    String v = attrs.getValue("v");
                    if (currentWay != null) {
                        currentWay.tags.put(k, v);
                    } else if (currentNodeId != null) {
                        nodeTags.computeIfAbsent(currentNodeId, id -> new HashMap<>()).put(k, v);
                        if ("sType".equals(k) && "0".equals(v)) {
                            Map<String, String> tags = nodeTags.get(currentNodeId);
                            if (tags != null && "0".equals(tags.get("id"))) {
                                double[] p = nodes.get(currentNodeId);
                                if (p != null) {
                                    centerLat = p[0];
                                    centerLon = p[1];
                                    hasCenter = true;
                                }
                            }
                            if (tags != null && tags.containsKey("mapBearing")) {
                                try {
                                    mapBearingDeg = Double.parseDouble(tags.get("mapBearing"));
                                } catch (NumberFormatException ignored) {
                                }
                            }
                        }
                    }
                }
                default -> {
                }
            }
        }

        @Override
        public void endElement(String uri, String localName, String qName) {
            if ("way".equals(qName) && currentWay != null) {
                ways.add(currentWay);
                currentWay = null;
            }
            if ("node".equals(qName)) {
                currentNodeId = null;
            }
        }

        MapScene build() {
            List<double[][]> road2005 = new ArrayList<>();
            List<double[][]> road2005Ramp = new ArrayList<>();
            List<double[][]> room2008 = new ArrayList<>();
            List<double[][]> parkingFill = new ArrayList<>();
            List<double[][]> parkingEdge = new ArrayList<>();
            List<double[][]> arrow1001 = new ArrayList<>();
            List<double[][]> walls1000 = new ArrayList<>();
            List<double[][]> blocker100202 = new ArrayList<>();
            List<double[][]> blocker100202Edge = new ArrayList<>();
            List<LabelPoint> parkingLabels = new ArrayList<>();
            List<LabelPoint> poiPoints = new ArrayList<>();
            List<double[][]> speedBumps1003 = new ArrayList<>();
            List<double[][]> lane1004 = new ArrayList<>();

            for (Way way : ways) {
                String sType = way.tags.get("sType");
                if (sType == null) continue;
                List<double[]> coords = resolveCoords(way);
                if (coords.isEmpty()) continue;

                switch (sType) {
                    case "2005" -> {
                        if (isClosed(way) && coords.size() >= 3) {
                            if ("yes".equalsIgnoreCase(way.tags.get("ramp"))) {
                                road2005Ramp.add(toArray(coords));
                            } else {
                                road2005.add(toArray(coords));
                            }
                        }
                    }
                    case "2008" -> {
                        if (isClosed(way) && coords.size() >= 3) {
                            room2008.add(toArray(coords));
                        }
                    }
                    case "1002" -> {
                        if (isClosed(way) && coords.size() >= 3) {
                            parkingFill.add(toArray(coords));
                            parkingEdge.add(toArray(coords));
                            String label = way.tags.getOrDefault("name", way.tags.get("id"));
                            double[] c = centroid(coords);
                            parkingLabels.add(new LabelPoint(c[0], c[1], label != null ? label : "", way.tags.get("id")));
                        }
                    }
                    case "1001" -> {
                        if (coords.size() >= 3) {
                            arrow1001.add(toArray(coords));
                        }
                    }
                    case "1000" -> {
                        if (isClosed(way) && coords.size() >= 3) {
                            walls1000.add(toArray(coords));
                        } else if (coords.size() >= 2) {
                            walls1000.add(toArray(coords));
                        }
                    }
                    case "100202" -> {
                        if (isClosed(way) && coords.size() >= 3) {
                            blocker100202.add(toArray(coords));
                            blocker100202Edge.add(toArray(coords));
                        } else if (coords.size() >= 2) {
                            blocker100202Edge.add(toArray(coords));
                        }
                    }
                    case "1003" -> {
                        if (coords.size() >= 3) {
                            speedBumps1003.add(toArray(coords));
                        }
                    }
                    case "1004" -> {
                        // 车道线：开放折线，nd 顺序即数字化方向（direction=2 顺向）
                        if (coords.size() >= 2) {
                            lane1004.add(toArray(coords));
                        }
                    }
                    default -> {
                    }
                }
            }

            for (Map.Entry<Long, Map<String, String>> e : nodeTags.entrySet()) {
                String sType = e.getValue().get("sType");
                if (sType == null) continue;
                double[] p = nodes.get(e.getKey());
                if (p == null) continue;
                if ("1002".equals(sType) || "1001".equals(sType) || "2005".equals(sType)) {
                    String name = e.getValue().getOrDefault("name", e.getValue().get("id"));
                    poiPoints.add(new LabelPoint(p[0], p[1], name != null ? name : "", e.getValue().get("id")));
                }
            }

            if (!hasCenter && !nodes.isEmpty()) {
                double sumLat = 0, sumLon = 0;
                int n = 0;
                for (double[] p : nodes.values()) {
                    sumLat += p[0];
                    sumLon += p[1];
                    n++;
                }
                centerLat = sumLat / n;
                centerLon = sumLon / n;
            }

            return new MapScene(centerLat, centerLon, mapBearingDeg,
                    road2005, road2005Ramp, room2008, parkingFill, parkingEdge, arrow1001,
                    walls1000, blocker100202, blocker100202Edge, parkingLabels, poiPoints,
                    speedBumps1003, lane1004);
        }

        private static boolean isClosed(Way way) {
            if (way.refs.size() < 2) return false;
            return way.refs.get(0).equals(way.refs.get(way.refs.size() - 1));
        }

        private List<double[]> resolveCoords(Way way) {
            List<double[]> list = new ArrayList<>();
            for (long ref : way.refs) {
                double[] p = nodes.get(ref);
                if (p != null) list.add(p);
            }
            return list;
        }

        private static double[][] toArray(List<double[]> coords) {
            return coords.toArray(new double[0][]);
        }

        private static double[] centroid(List<double[]> coords) {
            double lat = 0, lon = 0;
            for (double[] p : coords) {
                lat += p[0];
                lon += p[1];
            }
            int n = coords.size();
            return new double[]{lat / n, lon / n};
        }
    }

    private static class Way {
        final List<Long> refs = new ArrayList<>();
        final Map<String, String> tags = new HashMap<>();
    }
}
