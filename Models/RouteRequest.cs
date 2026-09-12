using System.Text.Json.Serialization;
namespace ProMapCargo.Api.Models;
public sealed class RouteRequest
{
    public GeoPoint Start { get; init; } = new(0, 0);
    [JsonPropertyName("destination")]
    public GeoPoint? Destination { get; init; }
    [JsonPropertyName("end")]
    public GeoPoint? End { get; init; }
    public string Profile { get; init; } = "truck";
    public bool AvoidRestricted { get; init; } = true;
    public TruckProfile? Truck { get; init; }
    public DateTimeOffset? DepartureAt { get; init; }
    [JsonIgnore]
    public bool HasDestination => Destination is not null || End is not null;
    [JsonIgnore]
    public GeoPoint Target => Destination ?? End ?? new GeoPoint(0, 0);
}
