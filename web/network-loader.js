/** Browser data source: generated map tiles only. No invented OSM geometry.
 * Country-wide map baselayer and simulation road overlay are separate.
 */
export function chooseMapTiles(manifest,bounds,zoom,limit=80){
  if(!manifest||!Array.isArray(manifest.tiles))throw Error("Ungültiges Netzmanifest");
  if(zoom<7)return [];
  const [south,west,north,east]=bounds;
  const overlaps=(b)=>b[0]<=north&&b[2]>=south&&b[1]<=east&&b[3]>=west;
  const picked=manifest.tiles.filter(t=>overlaps(t.bbox));
  if(picked.length>limit)throw Error("Zu viele Netzkacheln. Bitte weiter hineinzoomen.");
  return picked;
}
export function createTileRepository(base="./data/tiles/"){
  const pending=new Map();
  const baseUrl=new URL(base,import.meta.url);
  async function getTile(meta){
    if(!/^-?\d+_-?\d+\.json\.gz$/.test(meta.file))
      throw Error("Unerwarteter Kachel-Dateiname");
    if(!pending.has(meta.key)){
      const task=(async()=>{
        const path=new URL(meta.file,baseUrl);
        const response=await fetch(path);
        if(!response.ok)throw Error("Netzkachel "+meta.key+" (HTTP "+response.status+")");
        if(typeof DecompressionStream!=="function")
          throw Error("Für komprimierte Netzkarten wird ein aktueller Browser benötigt");
        const buffer=await response.arrayBuffer();
        const stream=new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
        const tile=JSON.parse(await new Response(stream).text());
        if(tile.schemaVersion!==1||tile.key!==meta.key||!Array.isArray(tile.edges))
          throw Error("Kachelformat stimmt nicht mit dem Manifest überein: "+meta.key);
        return tile;
      })().catch(e=>{pending.delete(meta.key);throw e});
      pending.set(meta.key,task);
    }
    return pending.get(meta.key);
  }
  return {getTile,loadedCount:()=>pending.size};
}
export function edgeSummary(tiles){
  const unique=new Map();
  for(const tile of tiles)for(const edge of tile.edges){
    const old=unique.get(edge.id);
    if(old&&JSON.stringify(old.geometry)!==JSON.stringify(edge.geometry))
      throw Error("Widersprüchliche OSM-Kartengeometrie für "+edge.id);
    unique.set(edge.id,edge);
  }
  const roads=[...unique.values()].filter(e=>e.kind!=="public");
  return {roads:roads.length,ramps:roads.filter(e=>e.kind==="ramp").length};
}
