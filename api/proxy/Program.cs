using System.Net.Http.Headers;

var builder = WebApplication.CreateBuilder(args);

var tabScannerConfig = builder.Configuration.GetSection("TabScanner");
var apiKey = tabScannerConfig["ApiKey"];
var region = tabScannerConfig["Region"];
var link = tabScannerConfig["Link"];

if (string.IsNullOrWhiteSpace(apiKey))
{
    throw new InvalidOperationException(
        "Missing configuration value 'TabScanner:ApiKey'.");
}

if (string.IsNullOrWhiteSpace(region))
{
    throw new InvalidOperationException(
        "Missing configuration value 'TabScanner:Region'.");
}

if (!Uri.TryCreate(link, UriKind.Absolute, out var tabScannerUri) ||
    (tabScannerUri.Scheme != Uri.UriSchemeHttp &&
     tabScannerUri.Scheme != Uri.UriSchemeHttps))
{
    throw new InvalidOperationException(
        "Configuration value 'TabScanner:Link' must be an absolute HTTP or HTTPS URL.");
}

var baseAddress = tabScannerUri.AbsoluteUri.EndsWith('/')
    ? tabScannerUri
    : new Uri($"{tabScannerUri.AbsoluteUri}/");

builder.Services.AddHttpClient("TabScanner", client =>
{
    client.BaseAddress = baseAddress;
    client.Timeout = TimeSpan.FromSeconds(120);
});


builder.Services.AddCors(options =>
{
    options.AddPolicy("LiveServer", policy =>
    {
        policy
            .WithOrigins("http://127.0.0.1:5500", "http://localhost:5500")
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});


var app = builder.Build();

app.UseCors("LiveServer");


app.MapPost("/receipts", async (
    HttpRequest request,
    IHttpClientFactory factory,
    CancellationToken cancellationToken) =>
{
    if (!request.HasFormContentType)
        return Results.BadRequest(new { error = "Expected multipart/form-data" });

    var form = await request.ReadFormAsync(cancellationToken);
    var file = form.Files.GetFile("file");

    if (file is null || file.Length == 0)
        return Results.BadRequest(new { error = "Missing file" });

    if (file.Length > 10 * 1024 * 1024)
        return Results.BadRequest(new { error = "File too large (max 10 MB)" });

    using var content = new MultipartFormDataContent();
    await using var stream = file.OpenReadStream();

    
    if (file.ContentType is not ("image/png" or "image/jpeg"))
    {
        return Results.BadRequest("PNG and JPG files only!");
    }

    using var fileContent = new StreamContent(stream);
    fileContent.Headers.ContentType =
        new MediaTypeHeaderValue(file.ContentType);

    content.Add(fileContent, "file", Path.GetFileName(file.FileName));
    content.Add(new StringContent(region), "region");

    using var message = new HttpRequestMessage(HttpMethod.Post, "v2/receipts");
    message.Headers.Authorization =
        new AuthenticationHeaderValue("Bearer", apiKey);
    message.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
    message.Content = content;

    var client = factory.CreateClient("TabScanner");
    using var response = await client.SendAsync(message, cancellationToken);
    var body = await response.Content.ReadAsStringAsync(cancellationToken);

    return Results.Content(body,
        response.Content.Headers.ContentType?.ToString() ?? "application/json",
        statusCode: (int)response.StatusCode);
});


app.MapGet("/receipts/{token}", async (
    string token,
    IHttpClientFactory factory,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(token) ||
        token.Length > 200 ||
        token.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '_' && c != '-'))
    {
        return Results.BadRequest(new { error = "Invalid token" });
    }

    var client = factory.CreateClient("TabScanner");

    using var message = new HttpRequestMessage(
        HttpMethod.Get, $"v2/receipts/{Uri.EscapeDataString(token)}");

    message.Headers.Authorization =
        new AuthenticationHeaderValue("Bearer", apiKey);

    using var response = await client.SendAsync(message, cancellationToken);
    var body = await response.Content.ReadAsStringAsync(cancellationToken);

    var result = Results.Content(body,
        response.Content.Headers.ContentType?.ToString() ?? "application/json",
        statusCode: (int)response.StatusCode);

    

    return result;
});

app.Run();
