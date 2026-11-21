/* 和 IPDSV 一样，把 avpmap 解密、解压、解析放到 Worker，主线程先把页面画出来。 */
importScripts('./avpmap-web.iife.js?v=20261121f');

self.onmessage = function onDecode(event) {
  var body = event.data || {};
  var key = body.key;
  AvpMapWeb.readAvpMap(body.bytes, {
    mapId: body.mapId,
    keyProvider: function provideKey() {
      if (!key || key.byteLength !== 32) throw new Error('missing avpmap key');
      return Promise.resolve(key);
    },
  }).then(function (data) {
    self.postMessage({ data: data });
  }, function (error) {
    self.postMessage({ error: String(error && error.message || error) });
  });
};
