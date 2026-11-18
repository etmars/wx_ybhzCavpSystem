/**
 * 室内底图配色。对齐 OsmAndroid IndoorMapPalette light() / dark()。
 * 路线和定位点不在这里。
 */
(function attach(api) {
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.IndoorMapPalette = api;
}({
  light() {
    return {
      light: true,
      background: '#E8EDF3',
      viewportLight: '#ffffff',
      viewportIntensity: 0.40,
      lightRadial: 1.35,
      lightAzimuth: 90,
      lightPolar: 50,
      floor: '#D1D5DB',
      floorRange: '#F4F6F9',
      floorBase: '#E8EDF3',
      floorTextureOpacity: 0.45,
      road: '#6B7280',
      junctionFill: '#F5E6A3',
      junctionFillOpacity: 0.92,
      junctionEdge: '#C4A35A',
      laneBound: '#F8FAFC',
      junctionText: '#0F766E',
      junctionHalo: '#F8FAFC',
      room: '#F4F6F9',
      parkingFill: '#E2E8F0',
      parkingFillOpacity: 0.55,
      parkingEdge: '#9AA8B8',
      parkingEdgeOpacity: 0.75,
      arrow: '#2E6BB0',
      wall: '#F0F3F7',
      blockerFill: '#FFFFFF',
      blockerEdge: '#FFFFFF',
    };
  },
  dark() {
    return {
      light: false,
      background: '#071018',
      viewportLight: '#fffaf0',
      viewportIntensity: 0.35,
      lightRadial: 1.45,
      lightAzimuth: 90,
      lightPolar: 52,
      floor: '#1A1F26',
      floorRange: '#1C242F',
      floorBase: '#1C242F',
      floorTextureOpacity: 0.75,
      road: '#3F4652',
      junctionFill: '#E8D48B',
      junctionFillOpacity: 0.88,
      junctionEdge: '#C9B06A',
      laneBound: '#F1F5F9',
      junctionText: '#E9FFF9',
      junctionHalo: '#0F2A2A',
      room: '#121C2E',
      parkingFill: '#0E1828',
      parkingFillOpacity: 0.4,
      parkingEdge: '#2F4668',
      parkingEdgeOpacity: 0.5,
      arrow: '#D7E1F2',
      wall: '#D6E6F2',
      blockerFill: '#A6B4CB',
      blockerEdge: '#D6E0EF',
    };
  },
  of(theme) {
    return String(theme || '').toLowerCase() === 'light' ? this.light() : this.dark();
  },
}));
