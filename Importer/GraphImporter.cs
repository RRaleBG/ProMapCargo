using NetTopologySuite;
using NetTopologySuite.Geometries;
using Npgsql;
using NpgsqlTypes;
using OsmSharp;
using OsmSharp.Streams;
using OsmSharp.Tags;
using System.Globalization;
using System.Text.Json;

namespace ProMapCargo.OsmImporter;

public sealed class GraphImporter(string connection)
{
    static readonly GeometryFactory Gf = NtsGeometryServices.Instance.CreateGeometryFactory(4326);
    static readonly HashSet<string> Highways = new(StringComparer.OrdinalIgnoreCase) {
        "motorway","motorway_link","trunk","trunk_link","primary","primary_link","secondary","secondary_link","tertiary","unclassified","residential","living_street","service"
    };

    public async Task ImportAsync(string pbf, long version, CancellationToken ct)
    {
        await using var ds = CreateDataSource();
        await using var db = await ds.OpenConnectionAsync(ct);
        await using (var cmd = new NpgsqlCommand(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Sql", "03-routing-graph.sql")), db)) await cmd.ExecuteNonQueryAsync(ct);
        await using (var cleanup = new NpgsqlCommand("DELETE FROM routing_overlay_edges WHERE graph_version=@v; DELETE FROM routing_edge_cells WHERE graph_version=@v; DELETE FROM routing_node_cells WHERE graph_version=@v; DELETE FROM routing_boundaries WHERE graph_version=@v; DELETE FROM routing_cell_adjacency WHERE graph_version=@v; DELETE FROM routing_cells WHERE graph_version=@v; DELETE FROM compiled_turn_restrictions WHERE graph_version=@v; DELETE FROM turn_restrictions WHERE graph_version=@v; DELETE FROM road_edges WHERE graph_version=@v; DELETE FROM osm_way_nodes WHERE graph_version=@v; DELETE FROM osm_ways WHERE graph_version=@v; DELETE FROM osm_nodes WHERE graph_version=@v; DELETE FROM routing_graph_versions WHERE graph_version=@v;", db))
        {
            cleanup.Parameters.AddWithValue("v", version);
            await cleanup.ExecuteNonQueryAsync(ct);
        }
        await using (var cmd = new NpgsqlCommand("INSERT INTO routing_graph_versions(graph_version,status) VALUES(@v,'building')", db))
        {
            cmd.Parameters.AddWithValue("v", version);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        var nodes = new Dictionary<long, Coordinate>();
        var ways = new List<WayRecord>();
        var restrictions = new List<RelationRecord>();
        using (var fs = File.OpenRead(pbf))
        {
            using var src = new PBFOsmStreamSource(fs);
            foreach (var osm in src)
            {
                ct.ThrowIfCancellationRequested();
                if (osm is Node n && n.Id.HasValue && n.Latitude.HasValue && n.Longitude.HasValue)
                    nodes[n.Id.Value] = new Coordinate(n.Longitude.Value, n.Latitude.Value);
                else if (osm is Way w && w.Id.HasValue && w.Nodes is not null)
                {
                    var tags = Tags(w.Tags);
                    if (tags.TryGetValue("highway", out var hw) && Highways.Contains(hw))
                        ways.Add(new WayRecord(w.Id.Value, w.Nodes.Select(nid => (long)nid).ToArray(), tags));
                }
                else if (osm is Relation rel && rel.Id.HasValue)
                {
                    var tags = Tags(rel.Tags);
                    if (tags.TryGetValue("type", out var type) && type.Equals("restriction", StringComparison.OrdinalIgnoreCase))
                        restrictions.Add(new RelationRecord(rel.Id.Value, rel.Members?.ToArray() ?? [], tags));
                }
            }
        }
        await CopyNodes(ds, nodes, version, ct);
        await CopyWays(ds, ways, nodes, version, ct);
        await CopyRestrictions(ds, restrictions, version, ct);
        await using (var cmd = new NpgsqlCommand("UPDATE routing_graph_versions SET status='ready',activated_at=now() WHERE graph_version=@v;", db))
        {
            cmd.Parameters.AddWithValue("v", version);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        Console.WriteLine($"Graph {version} ready: nodes={nodes.Count:n0}, ways={ways.Count:n0}, restrictions={restrictions.Count:n0}");
    }

    NpgsqlDataSource CreateDataSource()
    {
        var b = new NpgsqlDataSourceBuilder(connection);
        b.UseNetTopologySuite();
        return b.Build();
    }

    static Dictionary<string, string> Tags(TagsCollectionBase? t) =>
        t?.ToDictionary(x => x.Key, x => x.Value, StringComparer.OrdinalIgnoreCase) ?? new(StringComparer.OrdinalIgnoreCase);

    async Task CopyNodes(NpgsqlDataSource ds, Dictionary<long, Coordinate> nodes, long v, CancellationToken ct)
    {
        await using var c = await ds.OpenConnectionAsync(ct);
        await using var w = c.BeginBinaryImport("COPY osm_nodes(graph_version,id,geom) FROM STDIN (FORMAT BINARY)");
        foreach (var (id, co) in nodes)
        {
            await w.StartRowAsync(ct);
            w.Write(v);
            w.Write(id);
            w.Write(Gf.CreatePoint(co), NpgsqlDbType.Geometry);
        }
        await w.CompleteAsync(ct);
    }

    async Task CopyWays(NpgsqlDataSource ds, List<WayRecord> ways, Dictionary<long, Coordinate> nodes, long v, CancellationToken ct)
    {
        await using var c = await ds.OpenConnectionAsync(ct);
        await using var ec = await ds.OpenConnectionAsync(ct);
        await using var ww = c.BeginBinaryImport("COPY osm_ways(graph_version,way_id,highway,name,ref,oneway,access,vehicle,motor_vehicle,hgv,goods,hazmat,maxheight,maxwidth,maxlength,maxweight,maxaxleload,maxspeed,maxspeed_hgv,tags) FROM STDIN (FORMAT BINARY)");
        await using var wn = c.BeginBinaryImport("COPY osm_way_nodes(graph_version,way_id,seq,node_id) FROM STDIN (FORMAT BINARY)");
        foreach (var x in ways)
        {
            var t = x.Tags;
            await ww.StartRowAsync(ct);
            ww.Write(v);
            ww.Write(x.Id);
            Write(ww, V(t, "highway"));
            Write(ww, V(t, "name"));
            Write(ww, V(t, "ref"));
            Write(ww, V(t, "oneway"));
            Write(ww, V(t, "access"));
            Write(ww, V(t, "vehicle"));
            Write(ww, V(t, "motor_vehicle"));
            Write(ww, V(t, "hgv"));
            Write(ww, V(t, "goods"));
            Write(ww, V(t, "hazmat"));
            Write(ww, Num(t, "maxheight"));
            Write(ww, Num(t, "maxwidth"));
            Write(ww, Num(t, "maxlength"));
            Write(ww, Weight(t, "maxweight"));
            Write(ww, Weight(t, "maxaxleload"));
            Write(ww, Speed(t, "maxspeed"));
            Write(ww, Speed(t, "maxspeed:hgv"));
            ww.Write(JsonSerializer.Serialize(t), NpgsqlDbType.Jsonb);
            for (var i = 0; i < x.Nodes.Length; i++)
            {
                await wn.StartRowAsync(ct);
                wn.Write(v);
                wn.Write(x.Id);
                wn.Write(i);
                wn.Write(x.Nodes[i]);
            }
            await WriteEdges(ec, x, nodes, v, ct);
        }
        await ww.CompleteAsync(ct);
        await wn.CompleteAsync(ct);
    }

    async Task WriteEdges(NpgsqlConnection c, WayRecord x, Dictionary<long, Coordinate> nodes, long v, CancellationToken ct)
    {
        if (x.Nodes.Length < 2) return;
        var dir = Direction(x.Tags);
        for (var i = 0; i < x.Nodes.Length - 1; i++)
        {
            if (!nodes.TryGetValue(x.Nodes[i], out var a) || !nodes.TryGetValue(x.Nodes[i + 1], out var b)) continue;
            var line = Gf.CreateLineString([a, b]);
            await using var cmd = new NpgsqlCommand("INSERT INTO road_edges(graph_version,way_id,source_node,target_node,direction,highway,access,vehicle,motor_vehicle,hgv,goods,hazmat,maxheight,maxwidth,maxlength,maxweight,maxaxleload,maxspeed,maxspeed_hgv,speed_kmh,length_m,routable,tags,geom,is_connector) VALUES(@v,@w,@s,@t,@d,@hw,@a,@ve,@mv,@h,@g,@hz,@mh,@mw,@ml,@mwt,@mal,@ms,@msh,@speed,ST_Length(@geom::geography),true,@tags,@geom,@conn)", c);
            cmd.Parameters.AddWithValue("v", v);
            cmd.Parameters.AddWithValue("w", x.Id);
            cmd.Parameters.AddWithValue("s", x.Nodes[i]);
            cmd.Parameters.AddWithValue("t", x.Nodes[i + 1]);
            cmd.Parameters.AddWithValue("d", dir);
            cmd.Parameters.AddWithValue("hw", (object?)V(x.Tags, "highway") ?? DBNull.Value);
            foreach (var k in new[] { "access", "vehicle", "motor_vehicle", "hgv", "goods", "hazmat" })
                cmd.Parameters.AddWithValue(k, (object?)V(x.Tags, k) ?? DBNull.Value);
            cmd.Parameters.AddWithValue("mh", (object?)Num(x.Tags, "maxheight")?.ToString() ?? DBNull.Value);
            cmd.Parameters.AddWithValue("mw", (object?)Num(x.Tags, "maxwidth")?.ToString() ?? DBNull.Value);
            cmd.Parameters.AddWithValue("ml", (object?)Num(x.Tags, "maxlength")?.ToString() ?? DBNull.Value);
            cmd.Parameters.AddWithValue("mwt", (object?)Weight(x.Tags, "maxweight")?.ToString() ?? DBNull.Value);
            cmd.Parameters.AddWithValue("mal", (object?)Weight(x.Tags, "maxaxleload")?.ToString() ?? DBNull.Value);
            cmd.Parameters.AddWithValue("ms", (object?)Speed(x.Tags, "maxspeed")?.ToString() ?? DBNull.Value);
            cmd.Parameters.AddWithValue("msh", (object?)Speed(x.Tags, "maxspeed:hgv")?.ToString() ?? DBNull.Value);
            cmd.Parameters.AddWithValue("speed", DefaultSpeed(V(x.Tags, "highway")));
            cmd.Parameters.AddWithValue("tags", JsonSerializer.Serialize(x.Tags));
            cmd.Parameters.AddWithValue("geom", line);
            cmd.Parameters.AddWithValue("conn", V(x.Tags, "highway")?.EndsWith("_link", StringComparison.OrdinalIgnoreCase) == true);
            await cmd.ExecuteNonQueryAsync(ct);
        }
    }

    async Task CopyRestrictions(NpgsqlDataSource ds, List<RelationRecord> rs, long v, CancellationToken ct)
    {
        await using var c = await ds.OpenConnectionAsync(ct);
        foreach (var r in rs)
        {
            var from = r.Members.FirstOrDefault(m => m.Role == "from");
            var to = r.Members.FirstOrDefault(m => m.Role == "to");
            var viaNodes = r.Members.Where(m => m.Role == "via" && m.Type.ToString().Equals("Node", StringComparison.OrdinalIgnoreCase)).Select(m => (long)m.Id).ToArray();
            var viaWays = r.Members.Where(m => m.Role == "via" && m.Type.ToString().Equals("Way", StringComparison.OrdinalIgnoreCase)).Select(m => (long)m.Id).ToArray();
            if (from is null || to is null) continue;
            await using var cmd = new NpgsqlCommand("INSERT INTO turn_restrictions(graph_version,osm_relation_id,restriction,from_way_id,to_way_id,via_node_ids,via_way_ids,except_values,conditional,tags) VALUES(@v,@id,@r,@f,@t,@vn,@vw,@ex,@c,@tags) ON CONFLICT DO NOTHING", c);
            cmd.Parameters.AddWithValue("v", v);
            cmd.Parameters.AddWithValue("id", r.Id);
            cmd.Parameters.AddWithValue("r", (object?)V(r.Tags, "restriction") ?? DBNull.Value);
            cmd.Parameters.AddWithValue("f", from.Id);
            cmd.Parameters.AddWithValue("t", to.Id);
            cmd.Parameters.AddWithValue("vn", viaNodes);
            cmd.Parameters.AddWithValue("vw", viaWays);
            cmd.Parameters.AddWithValue("ex", (object?)V(r.Tags, "except") ?? DBNull.Value);
            cmd.Parameters.AddWithValue("c", (object?)V(r.Tags, "restriction:conditional") ?? DBNull.Value);
            cmd.Parameters.AddWithValue("tags", JsonSerializer.Serialize(r.Tags));
            await cmd.ExecuteNonQueryAsync(ct);
        }
    }

    static void Write(NpgsqlBinaryImporter w, string? v)
    {
        if (v is null) w.WriteNull();
        else w.Write(v);
    }

    static void Write(NpgsqlBinaryImporter w, double? v)
    {
        if (v is null) w.WriteNull();
        else w.Write(v.Value);
    }

    static string? V(Dictionary<string, string> t, string k) => t.TryGetValue(k, out var v) ? v : null;
    static double? Num(Dictionary<string, string> t, string k) => Parse(V(t, k), true);
    static double? Weight(Dictionary<string, string> t, string k)
    {
        var x = Parse(V(t, k), false);
        if (x is null) return null;
        return V(t, k)!.Contains("kg", StringComparison.OrdinalIgnoreCase) ? x / 1000d : x;
    }
    static double? Speed(Dictionary<string, string> t, string k)
    {
        var x = Parse(V(t, k), false);
        return x;
    }
    static double? Parse(string? s, bool meters)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = s.Replace(',', '.');
        var n = new string(s.TakeWhile(c => char.IsDigit(c) || c == '.' || c == '-').ToArray());
        if (!double.TryParse(n, NumberStyles.Float, CultureInfo.InvariantCulture, out var x)) return null;
        if (meters && s.Contains("ft", StringComparison.OrdinalIgnoreCase)) x *= .3048;
        return x;
    }
    static short Direction(Dictionary<string, string> t) => V(t, "oneway") switch
    {
        "yes" or "true" or "1" => 1,
        "-1" => -1,
        _ => 0
    };


    static double DefaultSpeed(string? hw) => hw switch
    {
        "motorway" => 110,
        "motorway_link" => 70,
        "trunk" => 90,
        "trunk_link" => 60,
        "primary" => 80,
        "primary_link" => 60,
        "secondary" => 70,
        "secondary_link" => 50,
        "tertiary" => 60,
        "residential" => 50,
        "living_street" => 20,
        "service" => 20,
        _ => 30
    };

    sealed record WayRecord(long Id, long[] Nodes, Dictionary<string, string> Tags);
    sealed record RelationRecord(long Id, OsmSharp.RelationMember[] Members, Dictionary<string, string> Tags);
}