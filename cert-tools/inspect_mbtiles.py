import sqlite3
p = r'F:\wx_ybhzCavpSystem\data\maps\ziguang_1-B2\parking.mbtiles'
conn = sqlite3.connect(p)
c = conn.cursor()
c.execute("SELECT name FROM sqlite_master WHERE type='table'")
print('tables:', [r[0] for r in c.fetchall()])
c.execute('SELECT min(zoom_level),max(zoom_level),count(*) FROM tiles')
print('zoom range + count:', c.fetchone())
print('first 10 tiles (z,x,tms_y):')
for r in c.execute('SELECT zoom_level,tile_column,tile_row FROM tiles ORDER BY zoom_level,tile_column,tile_row LIMIT 10'):
    print(' ', r)
c.execute('SELECT min(tile_column),max(tile_column),min(tile_row),max(tile_row) FROM tiles WHERE zoom_level=(SELECT max(zoom_level) FROM tiles)')
print('max-zoom col/row range:', c.fetchone())
print('metadata:')
for r in c.execute("SELECT key,value FROM metadata"):
    print(' ', r)
