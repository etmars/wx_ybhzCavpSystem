package com.ybhzcavp.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OsmMapSceneParserTest {

    private static final String SAMPLE = """
            <osm>
              <node id="1" lat="39.7300" lon="116.4900" />
              <node id="2" lat="39.7301" lon="116.4900" />
              <node id="3" lat="39.7301" lon="116.4901" />
              <node id="4" lat="39.7300" lon="116.4901" />
              <node id="5" lat="39.7302" lon="116.4902" />
              <node id="6" lat="39.7303" lon="116.4903" />
              <node id="7" lat="39.7304" lon="116.4904" />
              <node id="8" lat="39.7305" lon="116.4905" />
              <way id="10">
                <nd ref="1" /><nd ref="2" /><nd ref="3" /><nd ref="4" /><nd ref="1" />
                <tag k="sType" v="0" />
                <tag k="id" v="1000" />
              </way>
              <way id="11">
                <nd ref="1" /><nd ref="2" /><nd ref="3" /><nd ref="1" />
                <tag k="sType" v="1000" />
              </way>
              <way id="12">
                <nd ref="2" /><nd ref="3" /><nd ref="4" /><nd ref="2" />
                <tag k="sType" v="1002" />
              </way>
              <way id="13">
                <nd ref="5" /><nd ref="6" />
                <tag k="lane_id" v="L1" />
                <tag k="hd_link_id" v="H1" />
              </way>
              <way id="14">
                <nd ref="7" /><nd ref="8" />
                <tag k="bound_type" v="2" />
                <tag k="lane_id" v="L2" />
              </way>
              <way id="15">
                <nd ref="5" /><nd ref="6" />
                <tag k="bound_type" v="1" />
                <tag k="lane_id" v="L3" />
              </way>
            </osm>
            """;

    @TempDir
    Path tmp;

    @Test
    void parsesIndoorWallsAndHdLanesFromSameOsm() throws Exception {
        Path osm = tmp.resolve("sample.osm");
        Files.writeString(osm, SAMPLE, StandardCharsets.UTF_8);
        OsmMapSceneParser.MapScene scene = OsmMapSceneParser.parse(osm);
        assertEquals(1, scene.walls1000().size());
        assertEquals(1, scene.parkingEdge().size());
        assertEquals(1, scene.hdRoads().size());
        assertEquals(1, scene.laneBounds().size());
        assertEquals(116.4902, scene.hdRoads().get(0)[0][1], 0.0000001);
        assertEquals(39.7302, scene.hdRoads().get(0)[0][0], 0.0000001);
        assertTrue(scene.toJson().path("layers").path("hdRoads").size() > 0);
        assertTrue(scene.toJson().path("layers").path("laneBounds").size() > 0);
    }

    @Test
    void gqyq1FOsmHasHdRoadsLikeNavTiles() {
        Path osm = Path.of("D:/osmandroid/gqyq-1F.osm");
        if (!Files.exists(osm)) {
            return;
        }
        OsmMapSceneParser.MapScene scene = OsmMapSceneParser.parse(osm);
        assertTrue(scene.hdRoads().size() > 10, "hdRoads=" + scene.hdRoads().size());
        assertTrue(scene.laneBounds().size() > 10, "laneBounds=" + scene.laneBounds().size());
        assertEquals(0, scene.walls1000().size());
    }
}
