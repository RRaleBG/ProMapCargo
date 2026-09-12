using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ProMapCargo.Api.Data;
using ProMapCargo.Api.Models;
using ProMapCargo.Api.Routing;
using ProMapCargo.Api.Services;



var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
builder.Services.AddRazorPages();
builder.Services.AddProblemDetails();
builder.Services.AddHttpContextAccessor();
builder.Services.AddSignalR();
var connectionString = builder.Configuration.GetConnectionString("Postgres")
?? throw new InvalidOperationException("ConnectionStrings:Postgres is not configured.");
builder.Services.AddSingleton(sp =>
{
    var dataSourceBuilder = new NpgsqlDataSourceBuilder(connectionString);
    dataSourceBuilder.UseNetTopologySuite();
    return dataSourceBuilder.Build();
}
);
builder.Services.AddDbContext<ProMapCargoDbContext>(options =>
options.UseNpgsql(connectionString, npgsql => npgsql.UseNetTopologySuite())
        .UseSnakeCaseNamingConvention());
builder.Services
.AddIdentity<ApplicationUser, ApplicationRole>(options =>
{
    options.User.RequireUniqueEmail = false;
    options.Password.RequireNonAlphanumeric = false;
    options.Password.RequiredLength = 8;
}
)
.AddEntityFrameworkStores<ProMapCargoDbContext>()
.AddDefaultTokenProviders();
builder.Services.AddScoped<ICurrentUserContext, CurrentUserContext>();
builder.Services.AddScoped<IUserClaimsPrincipalFactory<ApplicationUser>, IdentityClaimsFactory>();
builder.Services.AddScoped<BusinessService>();
builder.Services.AddHttpClient<IGeocodingService, NominatimGeocodingService>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(15);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("ProMapCargo/1.0");
}
);
builder.Services.AddHttpClient<IRoutingService, OsrmRoutingService>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(30);
}
);


builder.Services.AddScoped<IPostgresRestrictionRepository, PostgresRestrictionRepository>();
builder.Services.AddScoped<IRestrictionEngine, PostgresRestrictionEngine>();
builder.Services.AddSingleton<IRestrictionRepository, JsonRestrictionRepository>();
builder.Services.AddScoped<PostGisRoutingRepository>();
builder.Services.AddScoped<TurnRestrictionMatcher>();
builder.Services.AddScoped<ManeuverBuilder>();
builder.Services.AddScoped<TruckEdgeEvaluator>();
builder.Services.AddScoped<EdgeSnapper>();
builder.Services.AddScoped<PostGisAStarRouter>();
builder.Services.AddScoped<IPostGisRoutingService, PostGisRoutingService>();
var corsOrigins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [];
builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy => policy
    .WithOrigins(corsOrigins)
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials());
}
);
var app = builder.Build();
app.UseExceptionHandler();
app.UseStaticFiles();
app.UseRouting();
app.UseCors("Frontend");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHub<NavigationHub>("/hubs/navigation");
app.MapRazorPages();
app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    service = "ProMapCargo.Api"
}
));

app.MapFallbackToPage("/Index");
await InitializeDatabaseAsync(app);
await app.RunAsync();
static async Task InitializeDatabaseAsync(WebApplication app)
{
    await using var scope = app.Services.CreateAsyncScope();
    var services = scope.ServiceProvider;
    var db = services.GetRequiredService<ProMapCargoDbContext>();
    await db.Database.EnsureCreatedAsync();
    foreach (var file in new[] {
        "03-routing-graph.sql", "01-indexes.sql", "04-operational-indexes.sql"
    }
    )
    {
        var path = Path.Combine(app.Environment.ContentRootPath, "Sql", file);
        if (!File.Exists(path))
        {
            throw new FileNotFoundException("Required SQL bootstrap file was not found.", path);
        }
        var sql = await File.ReadAllTextAsync(path);
        if (!string.IsNullOrWhiteSpace(sql))
        {
            await db.Database.ExecuteSqlRawAsync(sql);
        }
    }
    await SeedAsync(services, app.Configuration, app.Logger);
}
static async Task SeedAsync(IServiceProvider services, IConfiguration configuration, ILogger logger)
{
    if (!configuration.GetValue("Seed:Enabled", true))
    {
        return;
    }
    var db = services.GetRequiredService<ProMapCargoDbContext>();
    var roleManager = services.GetRequiredService<RoleManager<ApplicationRole>>();
    var userManager = services.GetRequiredService<UserManager<ApplicationUser>>();
    foreach (var roleName in new[] {
        "Administrator", "Dispatcher", "Moderator", "Driver", "FleetManager", "Viewer"
    }
    )
    {
        if (await roleManager.RoleExistsAsync(roleName))
        {
            continue;
        }
        EnsureIdentitySuccess(
        await roleManager.CreateAsync(new ApplicationRole
        {
            Name = roleName
        }
        ),
        $"creating role '{roleName}'");
    }
    var company = await db.Companies.FirstOrDefaultAsync(x => x.Name == "ProMap Cargo Demo");
    if (company is null)
    {
        company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "ProMap Cargo Demo",
            LegalName = "ProMap Cargo Demo d.o.o.",
            TaxNumber = "DEMO-001",
            CountryCode = "RS",
            Address = "Bulevar Mihajla Pupina 10",
            City = "Beograd",
            PostalCode = "11070"
        }
        ;
        db.Companies.Add(company);
        await db.SaveChangesAsync();
    }
    var adminEmail = configuration["Seed:AdminEmail"] ?? "admin@promapcargo.local";
    var adminPassword = configuration["Seed:AdminPassword"] ?? "Admin123!";
    var admin = await userManager.FindByEmailAsync(adminEmail);
    if (admin is null)
    {
        admin = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = adminEmail,
            Email = adminEmail,
            EmailConfirmed = true,
            DisplayName = "ProMap Administrator",
            CompanyId = company.Id,
            IsActive = true
        }
        ;
        EnsureIdentitySuccess(await userManager.CreateAsync(admin, adminPassword), "creating seed administrator");
    }
    if (admin.CompanyId != company.Id)
    {
        admin.CompanyId = company.Id;
        EnsureIdentitySuccess(await userManager.UpdateAsync(admin), "updating seed administrator");
    }
    if (!await userManager.IsInRoleAsync(admin, "Administrator"))
    {
        EnsureIdentitySuccess(await userManager.AddToRoleAsync(admin, "Administrator"), "assigning Administrator role");
    }
    if (!await db.Vehicles.AnyAsync(x => x.CompanyId == company.Id))
    {
        db.Vehicles.AddRange(
        new Vehicle
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Registration = "BG-001-PM",
            Make = "Mercedes-Benz",
            Model = "Actros",
            Type = VehicleType.Tractor
        }
        ,
        new Vehicle
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Registration = "BG-002-PM",
            Make = "Volvo",
            Model = "FH",
            Type = VehicleType.Tractor
        }
        );
        await db.SaveChangesAsync();
    }
    if (!await db.Drivers.AnyAsync(x => x.CompanyId == company.Id))
    {
        db.Drivers.AddRange(
        new Driver
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            FullName = "Marko Petrović",
            Phone = "+381 60 000 0001",
            LicenseNumber = "RS-DEMO-001"
        }
        ,
        new Driver
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            FullName = "Nikola Jovanović",
            Phone = "+381 60 000 0002",
            LicenseNumber = "RS-DEMO-002"
        }
        );
        await db.SaveChangesAsync();
    }
    if (!await db.TransportOrders.AnyAsync(x => x.CompanyId == company.Id))
    {
        var order = new TransportOrder
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            OrderNumber = "PM-DEMO-0001",
            CustomerName = "Demo Customer",
            Status = TransportOrderStatus.Planned,
            CargoDescription = "Demo cargo",
            CargoWeightTons = 18
        }
        ;
        db.TransportOrders.Add(order);
        await db.SaveChangesAsync();
        var loading = new TransportStop
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            TransportOrderId = order.Id,
            Sequence = 1,
            Type = TransportStopType.Loading,
            Name = "Demo warehouse",
            City = "Beograd",
            CountryCode = "RS",
            Latitude = 44.8125,
            Longitude = 20.4612,
            ServiceMinutes = 45
        }
        ;
        var unloading = new TransportStop
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            TransportOrderId = order.Id,
            Sequence = 2,
            Type = TransportStopType.Unloading,
            Name = "Demo destination",
            City = "Novi Sad",
            CountryCode = "RS",
            Latitude = 45.2671,
            Longitude = 19.8335,
            ServiceMinutes = 45
        }
        ;
        db.TransportStops.AddRange(loading, unloading);
        await db.SaveChangesAsync();
        var driver = await db.Drivers.FirstAsync(x => x.CompanyId == company.Id);
        var vehicle = await db.Vehicles.FirstAsync(x => x.CompanyId == company.Id);
        var trip = new Trip
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            TransportOrderId = order.Id,
            DriverId = driver.Id,
            VehicleId = vehicle.Id,
            Status = TripStatus.Planned,
            ExecutionState = TripExecutionState.Assigned
        }
        ;
        db.Trips.Add(trip);
        await db.SaveChangesAsync();
        driver.CurrentTripId = trip.Id;
        driver.CurrentVehicleId = vehicle.Id;
        vehicle.CurrentTripId = trip.Id;
        vehicle.CurrentDriverId = driver.Id;
        await db.SaveChangesAsync();
    }
    if (!await db.RoadRestrictions.AnyAsync())
    {
        db.RoadRestrictions.AddRange(
        new RoadRestriction
        {
            Id = 900001,
            OsmWayId = null,
            Name = "Demo zona – visinsko ograničenje 3.80 m",
            RestrictionType = "maxheight",
            MaxHeightMeters = 3.80m,
            Geometry = new NetTopologySuite.Geometries.Point(20.4573, 44.8178)
            {
                SRID = 4326
            }
        }
        ,
        new RoadRestriction
        {
            Id = 900002,
            OsmWayId = null,
            Name = "Demo zona – ograničenje 7.50 t",
            RestrictionType = "maxweight",
            MaxWeightTons = 7.50m,
            Geometry = new NetTopologySuite.Geometries.Point(20.4650, 44.8040)
            {
                SRID = 4326
            }
        }
        );
        await db.SaveChangesAsync();
    }
    logger.LogInformation("Database initialization and demo seed completed for {CompanyId}.", company.Id);
}
static void EnsureIdentitySuccess(IdentityResult result, string operation)
{
    if (result.Succeeded)
    {
        return;
    }
    var errors = string.Join(", ", result.Errors.Select(x => $"{x.Code}: {x.Description}"));
    throw new InvalidOperationException($"Identity operation failed while {operation}: {errors}");
}
