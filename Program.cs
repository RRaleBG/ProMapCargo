using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ProMapCargo.Api.Data;
using ProMapCargo.Api.Models;
using ProMapCargo.Api.Routing;
using ProMapCargo.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// ============================================================
// MVC / RAZOR / API
// ============================================================

builder.Services.AddControllers();

builder.Services.AddRazorPages();

builder.Services.AddProblemDetails();

builder.Services.AddHttpContextAccessor();

builder.Services.AddSignalR();


// ============================================================
// DATABASE CONNECTION
// ============================================================

var connectionString =
    builder.Configuration.GetConnectionString("Postgres");

if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException(
        "ConnectionStrings:Postgres is not configured."
    );
}


// ============================================================
// NPGSQL DATA SOURCE
// ============================================================

builder.Services.AddSingleton<NpgsqlDataSource>(_ =>
{
    var dataSourceBuilder =
        new NpgsqlDataSourceBuilder(connectionString);

    dataSourceBuilder.UseNetTopologySuite();

    return dataSourceBuilder.Build();
});


// ============================================================
// ENTITY FRAMEWORK CORE
// ============================================================

builder.Services.AddDbContext<ProMapCargoDbContext>(
    options =>
    {
        options
            .UseNpgsql(
                connectionString,
                npgsqlOptions =>
                {
                    npgsqlOptions.UseNetTopologySuite();
                }
            )
            .UseSnakeCaseNamingConvention();
    }
);


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
        }
    )
    .AddEntityFrameworkStores<ProMapCargoDbContext>()
    .AddDefaultTokenProviders();


// ============================================================
// APPLICATION SERVICES
// ============================================================

builder.Services.AddScoped<
    ICurrentUserContext,
    CurrentUserContext
>();

builder.Services.AddScoped<
    IUserClaimsPrincipalFactory<ApplicationUser>,
    IdentityClaimsFactory
>();

builder.Services.AddScoped<BusinessService>();


// ============================================================
// HTTP CLIENT FACTORY
// ============================================================

builder.Services.AddHttpClient();


// ============================================================
// GEOCODING
// ============================================================

builder.Services.AddHttpClient<
    IGeocodingService,
    NominatimGeocodingService
>(
    client =>
    {
        client.Timeout =
            TimeSpan.FromSeconds(15);

        var userAgent =
            builder.Configuration[
                "Geocoding:UserAgent"
            ]
            ?? "ProMapCargo/1.0";

        client.DefaultRequestHeaders
            .UserAgent
            .ParseAdd(userAgent);
    }
);


// ============================================================
// OSRM ROUTING
// ============================================================
//
// OSRM je fallback routing engine.
//
// Primarni routing engine:
//
//     PostGIS / OSM graph
//
// Fallback:
//
//     OSRM
//
// IRoutingService mora biti kompatibilan sa
// OsrmRoutingService i RoutingController.
//
// ============================================================

builder.Services.AddHttpClient<
    IRoutingService,
    OsrmRoutingService
>(
    client =>
    {
        client.Timeout =
            TimeSpan.FromSeconds(30);

        var userAgent =
            builder.Configuration[
                "Routing:UserAgent"
            ]
            ?? "ProMapCargo/1.0";

        client.DefaultRequestHeaders
            .UserAgent
            .ParseAdd(userAgent);
    }
);


// ============================================================
// ROAD RESTRICTIONS
// ============================================================

builder.Services.AddScoped<
    IPostgresRestrictionRepository,
    PostgresRestrictionRepository
>();

builder.Services.AddScoped<
    IRestrictionEngine,
    PostgresRestrictionEngine
>();

builder.Services.AddSingleton<
    IRestrictionRepository,
    JsonRestrictionRepository
>();


// ============================================================
// POSTGIS ROUTING
// ============================================================
//
// PostGIS routing pipeline:
//
// RouteRequest
//      |
//      v
// PostGisRoutingService
//      |
//      +--> EdgeSnapper
//      |
//      +--> PostGisRoutingRepository
//      |
//      +--> PostGisAStarRouter
//      |
//      +--> TruckEdgeEvaluator
//      |
//      +--> TurnRestrictionMatcher
//      |
//      +--> ManeuverBuilder
//      |
//      v
// RouteResponse
//
// ============================================================

builder.Services.AddScoped<
    PostGisRoutingRepository
>();

builder.Services.AddScoped<
    TurnRestrictionMatcher
>();

builder.Services.AddScoped<
    ManeuverBuilder
>();

builder.Services.AddScoped<
    TruckEdgeEvaluator
>();

builder.Services.AddScoped<
    EdgeSnapper
>();

builder.Services.AddScoped<
    PostGisAStarRouter
>();

builder.Services.AddScoped<
    IPostGisRoutingService,
    PostGisRoutingService
>();


// ============================================================
// CORS
// ============================================================

var corsOrigins =
    builder.Configuration
        .GetSection("Cors:Origins")
        .Get<string[]>()
    ?? Array.Empty<string>();

builder.Services.AddCors(
    options =>
    {
        options.AddPolicy(
            "Frontend",
            policy =>
            {
                if (corsOrigins.Length == 0)
                {
                    policy
                        .AllowAnyOrigin()
                        .AllowAnyHeader()
                        .AllowAnyMethod();

                    return;
                }

                policy
                    .WithOrigins(corsOrigins)
                    .AllowAnyHeader()
                    .AllowAnyMethod()
                    .AllowCredentials();
            }
        );
    }
);


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
    "/hubs/navigation"
);


// ============================================================
// RAZOR PAGES
// ============================================================

app.MapRazorPages();


// ============================================================
// HEALTH CHECK
// ============================================================

app.MapGet(
    "/health",
    () =>
        Results.Ok(
            new
            {
                status = "ok",
                service = "ProMapCargo.Api",
                timestamp = DateTimeOffset.UtcNow
            }
        )
);


// ============================================================
// FALLBACK
// ============================================================

app.MapFallbackToPage(
    "/Index"
);


// ============================================================
// DATABASE INITIALIZATION
// ============================================================

await InitializeDatabaseAsync(app);


// ============================================================
// RUN
// ============================================================

await app.RunAsync();


// ============================================================
// DATABASE INITIALIZATION
// ============================================================

static async Task InitializeDatabaseAsync(
    WebApplication app
)
{
    try
    {
        await using var scope =
            app.Services.CreateAsyncScope();

        var services =
            scope.ServiceProvider;

        var db =
            services.GetRequiredService<
                ProMapCargoDbContext
            >();

        app.Logger.LogInformation(
            "Initializing ProMap Cargo database..."
        );


        // ====================================================
        // TEST DATABASE CONNECTION
        // ====================================================

        var canConnect =
            await db.Database.CanConnectAsync();

        if (!canConnect)
        {
            app.Logger.LogWarning(
                "PostgreSQL database is not available. " +
                "Application will continue without database initialization."
            );

            return;
        }


        // ====================================================
        // CREATE EF DATABASE OBJECTS
        // ====================================================

        try
        {
            await db.Database.EnsureCreatedAsync();

            app.Logger.LogInformation(
                "EF Core database schema verified."
            );
        }
        catch (Exception ex)
        {
            app.Logger.LogError(
                ex,
                "EF Core database schema initialization failed."
            );
        }


        // ====================================================
        // SQL BOOTSTRAP
        // ====================================================

        var sqlFiles =
            new[]
            {
                "03-routing-graph.sql",
                "01-indexes.sql",
                "04-operational-indexes.sql"
            };

        foreach (var fileName in sqlFiles)
        {
            await ExecuteSqlBootstrapFileAsync(
                app,
                db,
                fileName
            );
        }


        // ====================================================
        // DEMO / DEVELOPMENT SEED
        // ====================================================

        try
        {
            await SeedAsync(
                services,
                app.Configuration,
                app.Logger
            );
        }
        catch (Exception ex)
        {
            app.Logger.LogError(
                ex,
                "Database seed failed. Application will continue running."
            );
        }


        app.Logger.LogInformation(
            "ProMap Cargo database initialization completed."
        );
    }
    catch (Exception ex)
    {
        app.Logger.LogError(
            ex,
            "Database initialization failed. " +
            "Application will continue running."
        );
    }
}


// ============================================================
// SQL BOOTSTRAP FILE EXECUTION
// ============================================================

static async Task ExecuteSqlBootstrapFileAsync(
    WebApplication app,
    ProMapCargoDbContext db,
    string fileName
)
{
    var path =
        Path.Combine(
            app.Environment.ContentRootPath,
            "Sql",
            fileName
        );

    if (!File.Exists(path))
    {
        app.Logger.LogWarning(
            "SQL bootstrap file not found: {SqlFile}",
            path
        );

        return;
    }

    string sql;

    try
    {
        sql =
            await File.ReadAllTextAsync(path);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(
            ex,
            "Failed reading SQL bootstrap file: {SqlFile}",
            path
        );

        return;
    }

    if (string.IsNullOrWhiteSpace(sql))
    {
        app.Logger.LogWarning(
            "SQL bootstrap file is empty: {SqlFile}",
            path
        );

        return;
    }

    try
    {
        await db.Database.ExecuteSqlRawAsync(sql);

        app.Logger.LogInformation(
            "Executed SQL bootstrap file: {SqlFile}",
            fileName
        );
    }
    catch (Exception ex)
    {
        app.Logger.LogError(
            ex,
            "Failed executing SQL bootstrap file: {SqlFile}. " +
            "Application will continue.",
            fileName
        );
    }
}


// ============================================================
// DATABASE SEED
// ============================================================

static async Task SeedAsync(
    IServiceProvider services,
    IConfiguration configuration,
    ILogger logger
)
{
    // ========================================================
    // SEED ENABLED?
    // ========================================================

    if (!configuration.GetValue(
            "Seed:Enabled",
            true
        ))
    {
        logger.LogInformation(
            "Database seed is disabled."
        );

        return;
    }


    var db =
        services.GetRequiredService<
            ProMapCargoDbContext
        >();

    var roleManager =
        services.GetRequiredService<
            RoleManager<ApplicationRole>
        >();

    var userManager =
        services.GetRequiredService<
            UserManager<ApplicationUser>
        >();


    // ========================================================
    // ROLES
    // ========================================================

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
        if (await roleManager.RoleExistsAsync(
                roleName
            ))
        {
            continue;
        }

        var result =
            await roleManager.CreateAsync(
                new ApplicationRole
                {
                    Name = roleName
                }
            );

        EnsureIdentitySuccess(
            result,
            $"creating role '{roleName}'"
        );
    }


    // ========================================================
    // DEMO COMPANY
    // ========================================================

    var company =
        await db.Companies
            .FirstOrDefaultAsync(
                x =>
                    x.Name ==
                    "ProMap Cargo Demo"
            );

    if (company is null)
    {
        company =
            new Company
            {
                Id =
                    Guid.NewGuid(),

                Name =
                    "ProMap Cargo Demo",

                LegalName =
                    "ProMap Cargo Demo d.o.o.",

                TaxNumber =
                    "DEMO-001",

                CountryCode =
                    "RS",

                Address =
                    "Bulevar Mihajla Pupina 10",

                City =
                    "Beograd",

                PostalCode =
                    "11070"
            };

        db.Companies.Add(company);

        await db.SaveChangesAsync();
    }


    // ========================================================
    // ADMIN USER CONFIGURATION
    // ========================================================

    var adminEmail =
        configuration[
            "Seed:AdminEmail"
        ]
        ?? "admin@promapcargo.local";

    var adminPassword =
        configuration[
            "Seed:AdminPassword"
        ]
        ?? "Admin123!";


    // ========================================================
    // ADMIN USER
    // ========================================================

    var admin =
        await userManager.FindByEmailAsync(
            adminEmail
        );

    if (admin is null)
    {
        admin =
            new ApplicationUser
            {
                Id =
                    Guid.NewGuid(),

                UserName =
                    adminEmail,

                Email =
                    adminEmail,

                EmailConfirmed =
                    true,

                DisplayName =
                    "ProMap Administrator",

                CompanyId =
                    company.Id,

                IsActive =
                    true
            };

        var createResult =
            await userManager.CreateAsync(
                admin,
                adminPassword
            );

        EnsureIdentitySuccess(
            createResult,
            "creating seed administrator"
        );
    }


    // ========================================================
    // ADMIN COMPANY
    // ========================================================

    if (admin.CompanyId != company.Id)
    {
        admin.CompanyId =
            company.Id;

        var updateResult =
            await userManager.UpdateAsync(
                admin
            );

        EnsureIdentitySuccess(
            updateResult,
            "updating seed administrator"
        );
    }


    // ========================================================
    // ADMIN ROLE
    // ========================================================

    if (!await userManager.IsInRoleAsync(
            admin,
            "Administrator"
        ))
    {
        var roleResult =
            await userManager.AddToRoleAsync(
                admin,
                "Administrator"
            );

        EnsureIdentitySuccess(
            roleResult,
            "assigning Administrator role"
        );
    }


    // ========================================================
    // VEHICLES
    // ========================================================

    if (!await db.Vehicles.AnyAsync(
            x =>
                x.CompanyId ==
                company.Id
        ))
    {
        var vehicle1 =
            new Vehicle
            {
                Id =
                    Guid.NewGuid(),

                CompanyId =
                    company.Id,

                Registration =
                    "BG-001-PM",

                Make =
                    "Mercedes-Benz",

                Model =
                    "Actros",

                Type =
                    VehicleType.Tractor
            };

        var vehicle2 =
            new Vehicle
            {
                Id =
                    Guid.NewGuid(),

                CompanyId =
                    company.Id,

                Registration =
                    "BG-002-PM",

                Make =
                    "Volvo",

                Model =
                    "FH",

                Type =
                    VehicleType.Tractor
            };

        db.Vehicles.AddRange(
            vehicle1,
            vehicle2
        );

        await db.SaveChangesAsync();
    }


    // ========================================================
    // DRIVERS
    // ========================================================

    if (!await db.Drivers.AnyAsync(
            x =>
                x.CompanyId ==
                company.Id
        ))
    {
        var driver1 =
            new Driver
            {
                Id =
                    Guid.NewGuid(),

                CompanyId =
                    company.Id,

                FullName =
                    "Marko Petrović",

                Phone =
                    "+381 60 000 0001",

                LicenseNumber =
                    "RS-DEMO-001"
            };

        var driver2 =
            new Driver
            {
                Id =
                    Guid.NewGuid(),

                CompanyId =
                    company.Id,

                FullName =
                    "Nikola Jovanović",

                Phone =
                    "+381 60 000 0002",

                LicenseNumber =
                    "RS-DEMO-002"
            };

        db.Drivers.AddRange(
            driver1,
            driver2
        );

        await db.SaveChangesAsync();
    }


    // ========================================================
    // TRANSPORT ORDER
    // ========================================================

    if (!await db.TransportOrders.AnyAsync(
            x =>
                x.CompanyId ==
                company.Id
        ))
    {
        var order =
            new TransportOrder
            {
                Id =
                    Guid.NewGuid(),

                CompanyId =
                    company.Id,

                OrderNumber =
                    "PM-DEMO-0001",

                CustomerName =
                    "Demo Customer",

                Status =
                    TransportOrderStatus.Planned,

                CargoDescription =
                    "Demo cargo",

                CargoWeightTons =
                    18
            };

        db.TransportOrders.Add(order);

        await db.SaveChangesAsync();


        // ====================================================
        // LOADING STOP
        // ====================================================

        var loading =
            new TransportStop
            {
                Id =
                    Guid.NewGuid(),

                CompanyId =
                    company.Id,

                TransportOrderId =
                    order.Id,

                Sequence =
                    1,

                Type =
                    TransportStopType.Loading,

                Name =
                    "Demo warehouse",

                City =
                    "Beograd",

                CountryCode =
                    "RS",

                Latitude =
                    44.8125,

                Longitude =
                    20.4612,

                ServiceMinutes =
                    45
            };


        // ====================================================
        // UNLOADING STOP
        // ====================================================

        var unloading =
            new TransportStop
            {
                Id =
                    Guid.NewGuid(),

                CompanyId =
                    company.Id,

                TransportOrderId =
                    order.Id,

                Sequence =
                    2,

                Type =
                    TransportStopType.Unloading,

                Name =
                    "Demo destination",

                City =
                    "Novi Sad",

                CountryCode =
                    "RS",

                Latitude =
                    45.2671,

                Longitude =
                    19.8335,

                ServiceMinutes =
                    45
            };

        db.TransportStops.AddRange(
            loading,
            unloading
        );

        await db.SaveChangesAsync();


        // ====================================================
        // DRIVER
        // ====================================================

        var driver =
            await db.Drivers
                .FirstAsync(
                    x =>
                        x.CompanyId ==
                        company.Id
                );


        // ====================================================
        // VEHICLE
        // ====================================================

        var vehicle =
            await db.Vehicles
                .FirstAsync(
                    x =>
                        x.CompanyId ==
                        company.Id
                );


        // ====================================================
        // TRIP
        // ====================================================

        var trip =
            new Trip
            {
                Id =
                    Guid.NewGuid(),

                CompanyId =
                    company.Id,

                TransportOrderId =
                    order.Id,

                DriverId =
                    driver.Id,

                VehicleId =
                    vehicle.Id,

                Status =
                    TripStatus.Planned,

                ExecutionState =
                    TripExecutionState.Assigned
            };

        db.Trips.Add(trip);

        await db.SaveChangesAsync();


        // ====================================================
        // CONNECT ACTIVE DRIVER / VEHICLE / TRIP
        // ====================================================

        driver.CurrentTripId =
            trip.Id;

        driver.CurrentVehicleId =
            vehicle.Id;

        vehicle.CurrentTripId =
            trip.Id;

        vehicle.CurrentDriverId =
            driver.Id;

        await db.SaveChangesAsync();
    }


    // ========================================================
    // DEMO ROAD RESTRICTIONS
    // ========================================================

    if (!await db.RoadRestrictions.AnyAsync())
    {
        var heightRestriction =
            new RoadRestriction
            {
                Id =
                    900001,

                OsmWayId =
                    null,

                Name =
                    "Demo zona – visinsko ograničenje 3.80 m",

                RestrictionType =
                    "maxheight",

                MaxHeightMeters =
                    3.80m,

                Geometry =
                    new NetTopologySuite.Geometries.Point(
                        20.4573,
                        44.8178
                    )
                    {
                        SRID =
                            4326
                    }
            };

        var weightRestriction =
            new RoadRestriction
            {
                Id =
                    900002,

                OsmWayId =
                    null,

                Name =
                    "Demo zona – ograničenje 7.50 t",

                RestrictionType =
                    "maxweight",

                MaxWeightTons =
                    7.50m,

                Geometry =
                    new NetTopologySuite.Geometries.Point(
                        20.4650,
                        44.8040
                    )
                    {
                        SRID =
                            4326
                    }
            };

        db.RoadRestrictions.AddRange(
            heightRestriction,
            weightRestriction
        );

        await db.SaveChangesAsync();
    }


    // ========================================================
    // SEED COMPLETE
    // ========================================================

    logger.LogInformation(
        "Database initialization and demo seed completed for company {CompanyId}.",
        company.Id
    );
}


// ============================================================
// IDENTITY RESULT CHECK
// ============================================================

static void EnsureIdentitySuccess(
    IdentityResult result,
    string operation
)
{
    if (result.Succeeded)
    {
        return;
    }

    var errors =
        string.Join(
            ", ",
            result.Errors.Select(
                x =>
                    $"{x.Code}: {x.Description}"
            )
        );

    throw new InvalidOperationException(
        $"Identity operation failed while {operation}: {errors}"
    );
}