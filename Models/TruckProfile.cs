using System.Text.Json.Serialization;

namespace ProMapCargo.Api.Models;

public sealed class TruckProfile
{
    public decimal GrossWeightTons { get; init; }
    public decimal HeightMeters { get; init; }
    public decimal WidthMeters { get; init; }
    public decimal LengthMeters { get; init; }
    public decimal? AxleLoadTons { get; init; }
    public int Axles { get; init; } = 5;
    public bool IsHgv { get; init; } = true;
    public bool Commercial { get; init; } = true;
    public bool Hazmat { get; init; }
    public string? Goods { get; init; }
    public string? AdrClass { get; init; }
    public string VehicleClass { get; init; } = "HeavyGoods";

    [JsonPropertyName("maxSpeedKmh")]
    public decimal MaxSpeedKmh { get; init; } = 90;

    [JsonPropertyName("grossWeightT")]
    public decimal GrossWeightT
    {
        init => GrossWeightTons = value;
    }

    [JsonPropertyName("heightM")]
    public decimal HeightM
    {
        init => HeightMeters = value;
    }

    [JsonPropertyName("widthM")]
    public decimal WidthM
    {
        init => WidthMeters = value;
    }

    [JsonPropertyName("lengthM")]
    public decimal LengthM
    {
        init => LengthMeters = value;
    }

    [JsonPropertyName("axleLoadT")]
    public decimal AxleLoadT
    {
        init => AxleLoadTons = value;
    }
}