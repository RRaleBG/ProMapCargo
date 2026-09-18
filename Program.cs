using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ProMapCargo.Api.Data;
using ProMapCargo.Api.Models;
using ProMapCargo.Api.Routing;
using ProMapCargo.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

builder.Services.AddMemoryCache();

builder.Services.AddRazorPages();

builder.Services.AddProblemDetails();

builder.Services.AddHttpContextAccessor();

builder.Services.AddSignalR();

var connectionString =
    builder.Configuration.GetConnectionString("Postgres")
    ?? "Host=localhost;Port=5432;Database=promapcargo;Username=promap;Password=promap_dev_change_me";

builder.Services.AddSingleton(sp =>
{
    var dataSourceBuilder =
        new NpgsqlDataSourceBuilder(
            connectionString);

    dataSourceBuilder.UseNetTopologySuite();

    return dataSourceBuilder.Build();
});

builder.Services.AddDbContext<ProMapCargoDbContext>(
    options =>
        options.UseNpgsql(
            connectionString,
            npgsql =>
                npgsql.UseNetTopologySuite()));

builder.Services
    .AddIdentity<ApplicationUser, ApplicationRole>(
        options =>
        {
            options.User.RequireUniqueEmail = false;

            options.Password.RequireNonAlphanumeric = false;

            options.Password.RequiredLength = 8;
        })
    .AddEntityFrameworkStores<ProMapCargoDbContext>()
    .AddDefaultTokenProviders();

builder.Services.AddScoped<
    ICurrentUserContext,
    CurrentUserContext>();

builder.Services.AddScoped<
    IUserClaimsPrincipalFactory<ApplicationUser>,
    IdentityClaimsFactory>();

builder.Services.AddScoped<BusinessService>();

builder.Services.AddHttpClient<
    IGeocodingService,
    NominatimGeocodingService>();

builder.Services.AddHttpClient<
    IRoutingService,
    OsrmRoutingService>();

builder.Services.AddHttpClient(
    "MapTiles",
    client =>
    {
        client.Timeout =
            TimeSpan.FromSeconds(15);

        client.DefaultRequestHeaders.UserAgent.ParseAdd(
            "ProMapCargo/1.0");
    });

builder.Services.AddScoped<
    IPostgresRestrictionRepository,
    PostgresRestrictionRepository>();

builder.Services.AddScoped<
    IRestrictionEngine,
    PostgresRestrictionEngine>();

builder.Services.AddScoped<
    PostGisRoutingRepository>();

builder.Services.AddScoped<
    ManeuverBuilder>();

builder.Services.AddScoped<
    TruckEdgeEvaluator>();

builder.Services.AddScoped<
    EdgeSnapper>();

builder.Services.AddScoped<
    PostGisAStarRouter>();

builder.Services.AddScoped<
    IPostGisRoutingService,
    PostGisRoutingService>();

builder.Services.AddCors(
    options =>
    {
        options.AddPolicy(
            "Frontend",
            policy =>
            {
                var origins =
                    builder.Configuration
                        .GetSection("Cors:Origins")
                        .Get<string[]>();

                policy
                    .WithOrigins(
                        origins
                        ?? new[]
                        {
                            "https://localhost:5001",
                            "http://localhost:5000"
                        })
                    .AllowAnyHeader()
                    .AllowAnyMethod()
                    .AllowCredentials();
            });
    });

var app = builder.Build();

app.UseExceptionHandler();

app.UseStaticFiles();

app.UseRouting();

app.UseCors("Frontend");

app.UseAuthentication();

app.UseAuthorization();

app.MapControllers();

app.MapHub<NavigationHub>(
    "/hubs/navigation");

app.MapRazorPages();

app.MapFallbackToPage(
    "/Index");

await BootstrapAsync(app);

app.Run();

static async Task BootstrapAsync(
    WebApplication app)
{
    using var scope =
        app.Services.CreateScope();

    var db =
        scope.ServiceProvider
            .GetRequiredService<
                ProMapCargoDbContext>();

    try
    {
        await db.Database
            .EnsureCreatedAsync();

        var routingSqlPath =
            Path.Combine(
                app.Environment.ContentRootPath,
                "Sql",
                "03-routing-graph.sql");

        if (File.Exists(routingSqlPath))
        {
            var sql =
                await File.ReadAllTextAsync(
                    routingSqlPath);

            await db.Database
                .ExecuteSqlRawAsync(sql);
        }

        var indexesSqlPath =
            Path.Combine(
                app.Environment.ContentRootPath,
                "Sql",
                "04-operational-indexes.sql");

        if (File.Exists(indexesSqlPath))
        {
            var sql =
                await File.ReadAllTextAsync(
                    indexesSqlPath);

            await db.Database
                .ExecuteSqlRawAsync(sql);
        }

        var roleManager =
            scope.ServiceProvider
                .GetRequiredService<
                    RoleManager<ApplicationRole>>();

        var roles =
            new[]
            {
                "Administrator",
                "Dispatcher",
                "Moderator",
                "Driver",
                "FleetManager",
                "Viewer"
            };

        foreach (var roleName in roles)
        {
            if (!await roleManager
                    .RoleExistsAsync(roleName))
            {
                await roleManager.CreateAsync(
                    new ApplicationRole
                    {
                        Name = roleName
                    });
            }
        }
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(
            ex,
            "Database bootstrap failed. API can still start; run SQL/migrations before routing.");
    }
}