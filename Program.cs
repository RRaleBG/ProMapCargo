using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ProMapCargo.Api.Data;
using ProMapCargo.Api.Models;
using ProMapCargo.Api.Routing;
using ProMapCargo.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// ============================================================
// ASP.NET CORE
// ============================================================

builder.Services.AddControllers();

builder.Services.AddMemoryCache();

builder.Services.AddRazorPages();

builder.Services.AddProblemDetails();

builder.Services.AddHttpContextAccessor();

builder.Services.AddSignalR();


// ============================================================
// DATABASE CONNECTION
// ============================================================

var connectionString =
    builder.Configuration.GetConnectionString("Postgres")
    ?? "Host=localhost;Port=5432;Database=promapcargo;Username=promap;Password=promap_dev_change_me";


// ============================================================
// NPGSQL DATA SOURCE
// ============================================================

builder.Services.AddSingleton<NpgsqlDataSource>(_ =>
{
    var dataSourceBuilder =
        new NpgsqlDataSourceBuilder(
            connectionString);

    dataSourceBuilder.UseNetTopologySuite();

    return dataSourceBuilder.Build();
});


// ============================================================
// ENTITY FRAMEWORK CORE
// ============================================================

builder.Services.AddDbContext<ProMapCargoDbContext>(
    options =>
        options
            .UseNpgsql(
                connectionString,
                npgsql =>
                    npgsql.UseNetTopologySuite())
            .UseSnakeCaseNamingConvention());


// ============================================================
// ASP.NET CORE IDENTITY
// ============================================================

builder.Services
    .AddIdentity<ApplicationUser, ApplicationRole>(
        options =>
        {
            options.User.RequireUniqueEmail = false;

            options.Password.RequireDigit = true;

            options.Password.RequireLowercase = true;

            options.Password.RequireUppercase = true;

            options.Password.RequireNonAlphanumeric = false;

            options.Password.RequiredLength = 8;

            options.SignIn.RequireConfirmedAccount = false;
        })
    .AddEntityFrameworkStores<ProMapCargoDbContext>()
    .AddDefaultTokenProviders();


// ============================================================
// APPLICATION SERVICES
// ============================================================

builder.Services.AddScoped<
    ICurrentUserContext,
    CurrentUserContext>();

builder.Services.AddScoped<
    IUserClaimsPrincipalFactory<ApplicationUser>,
    IdentityClaimsFactory>();

builder.Services.AddScoped<BusinessService>();


// ============================================================
// GEOCODING
// ============================================================

builder.Services.AddHttpClient<
    IGeocodingService,
    NominatimGeocodingService>(
    client =>
    {
        client.Timeout =
            TimeSpan.FromSeconds(15);

        client.DefaultRequestHeaders
            .UserAgent
            .ParseAdd("ProMapCargo/1.0");
    });


// ============================================================
// OSRM ROUTING
// ============================================================

builder.Services.AddHttpClient<
    IRoutingService,
    OsrmRoutingService>(
    client =>
    {
        client.Timeout =
            TimeSpan.FromSeconds(30);

        client.DefaultRequestHeaders
            .UserAgent
            .ParseAdd("ProMapCargo/1.0");
    });


// ============================================================
// MAP TILES
// ============================================================

builder.Services.AddHttpClient(
    "MapTiles",
    client =>
    {
        client.Timeout =
            TimeSpan.FromSeconds(15);

        client.DefaultRequestHeaders
            .UserAgent
            .ParseAdd(
                "ProMapCargo/1.0");
    });


// ============================================================
// ROAD RESTRICTIONS
// ============================================================

builder.Services.AddScoped<
    IPostgresRestrictionRepository,
    PostgresRestrictionRepository>();

builder.Services.AddScoped<
    IRestrictionEngine,
    PostgresRestrictionEngine>();


// ============================================================
// POSTGIS ROUTING
// ============================================================

builder.Services.AddScoped<
    PostGisRoutingRepository>();

builder.Services.AddScoped<
    TurnRestrictionMatcher>();

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


// ============================================================
// CORS
// ============================================================

builder.Services.AddCors(
    options =>
    {
        options.AddPolicy(
            "Frontend",
            policy =>
            {
                var origins =
                    builder.Configuration
                        .GetSection(
                            "Cors:Origins")
                        .Get<string[]>();

                if (origins is not null &&
                    origins.Length > 0)
                {
                    policy
                        .WithOrigins(origins)
                        .AllowAnyHeader()
                        .AllowAnyMethod()
                        .AllowCredentials();

                    return;
                }

                policy
                    .AllowAnyOrigin()
                    .AllowAnyHeader()
                    .AllowAnyMethod();
            });
    });


// ============================================================
// BUILD APPLICATION
// ============================================================

var app = builder.Build();


// ============================================================
// ERROR HANDLING
// ============================================================

if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
}
else
{
    app.UseExceptionHandler();
}


// ============================================================
// HTTP PIPELINE
// ============================================================

app.UseStaticFiles();

app.UseRouting();

app.UseCors("Frontend");

app.UseAuthentication();

app.UseAuthorization();


// ============================================================
// API CONTROLLERS
// ============================================================

app.MapControllers();


// ============================================================
// SIGNALR
// ============================================================

app.MapHub<NavigationHub>(
    "/hubs/navigation");


// ============================================================
// RAZOR PAGES
// ============================================================

app.MapRazorPages();


// ============================================================
// DATABASE BOOTSTRAP
// ============================================================

await BootstrapAsync(app);


// ============================================================
// RUN
// ============================================================

await app.RunAsync();


// ============================================================
// DATABASE BOOTSTRAP
// ============================================================

static async Task BootstrapAsync(
    WebApplication app)
{
    using var scope =
        app.Services.CreateScope();

    var services =
        scope.ServiceProvider;

    var db =
        services.GetRequiredService<
            ProMapCargoDbContext>();

    try
    {
        // ====================================================
        // DATABASE CONNECTION
        // ====================================================

        var canConnect =
            await db.Database
                .CanConnectAsync();

        if (!canConnect)
        {
            app.Logger.LogWarning(
                "PostgreSQL database is not available. " +
                "Database bootstrap will be skipped.");

            return;
        }


        // ====================================================
        // EF CORE DATABASE
        // ====================================================

        await db.Database
            .EnsureCreatedAsync();


        // ====================================================
        // ROUTING GRAPH SQL
        // ====================================================

        await ExecuteSqlFileAsync(
            app,
            db,
            "03-routing-graph.sql");


        // ====================================================
        // OPERATIONAL INDEXES
        // ====================================================

        await ExecuteSqlFileAsync(
            app,
            db,
            "04-operational-indexes.sql");


        // ====================================================
        // ROLES
        // ====================================================

        var roleManager =
            services.GetRequiredService<
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
            if (await roleManager
                    .RoleExistsAsync(
                        roleName))
            {
                continue;
            }

            var result =
                await roleManager.CreateAsync(
                    new ApplicationRole
                    {
                        Name = roleName
                    });

            if (!result.Succeeded)
            {
                var errors =
                    string.Join(
                        ", ",
                        result.Errors.Select(
                            error =>
                                $"{error.Code}: {error.Description}"));

                app.Logger.LogWarning(
                    "Failed creating role {RoleName}: {Errors}",
                    roleName,
                    errors);
            }
        }


        // ====================================================
        // BOOTSTRAP COMPLETE
        // ====================================================

        app.Logger.LogInformation(
            "ProMap Cargo database bootstrap completed.");
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(
            ex,
            "Database bootstrap failed. " +
            "API can still start; run SQL/migrations before routing.");
    }
}


// ============================================================
// SQL FILE EXECUTION
// ============================================================

static async Task ExecuteSqlFileAsync(
    WebApplication app,
    ProMapCargoDbContext db,
    string fileName)
{
    var sqlPath =
        Path.Combine(
            app.Environment.ContentRootPath,
            "Sql",
            fileName);

    if (!File.Exists(sqlPath))
    {
        app.Logger.LogWarning(
            "SQL bootstrap file not found: {SqlFile}",
            sqlPath);

        return;
    }

    try
    {
        var sql =
            await File.ReadAllTextAsync(
                sqlPath);

        if (string.IsNullOrWhiteSpace(sql))
        {
            app.Logger.LogWarning(
                "SQL bootstrap file is empty: {SqlFile}",
                sqlPath);

            return;
        }

        await db.Database
            .ExecuteSqlRawAsync(sql);

        app.Logger.LogInformation(
            "Executed SQL bootstrap file: {SqlFile}",
            fileName);
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(
            ex,
            "Failed executing SQL bootstrap file: {SqlFile}",
            sqlPath);
    }
}